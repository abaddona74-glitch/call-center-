import { type AddressInfo, type Server, type Socket, createServer } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { AmiClient, AmiError } from './ami.client.js';
import { type AmiMessage, AmiParser } from './ami.protocol.js';

/** Tiny scripted AMI server: answers Login/Ping, lets the test answer everything else. */
function fakeAmi(handler: (msg: AmiMessage, reply: (lines: Record<string, string>) => void, socket: Socket) => void) {
  const sockets = new Set<Socket>();
  const server: Server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.setEncoding('utf8');
    const parser = new AmiParser();
    parser.push('banner\r\n');
    socket.write('Asterisk Call Manager/2.10.6\r\n');
    const reply = (fields: Record<string, string>) =>
      socket.write(
        `${Object.entries(fields)
          .map(([k, v]) => `${k}: ${v}`)
          .join('\r\n')}\r\n\r\n`,
      );
    socket.on('data', (chunk: string) => {
      for (const msg of parser.push(chunk)) {
        if (msg.action === 'Login') {
          reply(
            msg.secret === 'good'
              ? { Response: 'Success', ActionID: msg.actionid, Message: 'Authentication accepted' }
              : { Response: 'Error', ActionID: msg.actionid, Message: 'Authentication failed' },
          );
        } else if (msg.action === 'Ping') {
          reply({ Response: 'Success', ActionID: msg.actionid, Ping: 'Pong' });
        } else {
          handler(msg, reply, socket);
        }
      }
    });
  });
  return new Promise<{ port: number; server: Server; sockets: Set<Socket> }>((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve({ port: (server.address() as AddressInfo).port, server, sockets })),
  );
}

const waitFor = async (cond: () => boolean, ms = 2_000) => {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 10));
  }
};

describe('AmiClient', () => {
  const cleanups: Array<() => Promise<void> | void> = [];
  afterEach(async () => {
    for (const c of cleanups.splice(0)) await c();
  });

  async function setup(handler: Parameters<typeof fakeAmi>[0], secret = 'good') {
    const srv = await fakeAmi(handler);
    const client = new AmiClient({
      host: '127.0.0.1',
      port: srv.port,
      username: 'u',
      secret,
      reconnectMinMs: 20,
      reconnectMaxMs: 50,
      authFailedRetryMs: 10_000,
    });
    cleanups.push(async () => {
      await client.stop();
      for (const s of srv.sockets) s.destroy();
      await new Promise((r) => srv.server.close(r));
    });
    return { client, srv };
  }

  it('logs in, correlates responses by ActionID and streams events', async () => {
    const events: AmiMessage[] = [];
    const { client } = await setup((msg, reply) => {
      if (msg.action === 'Hangup') {
        reply({ Event: 'Hangup', Channel: msg.channel, Uniqueid: '1.1' });
        reply({ Response: 'Success', ActionID: msg.actionid, Message: 'Channel Hungup' });
      }
    });
    client.on('event', (e) => events.push(e));
    client.start();
    await waitFor(() => client.connected);
    const res = await client.action('Hangup', { Channel: 'SIP/101-00000001' });
    expect(res.fields.message).toBe('Channel Hungup');
    expect(events).toEqual([{ event: 'Hangup', channel: 'SIP/101-00000001', uniqueid: '1.1' }]);
  });

  it('collects list actions and does not emit their events', async () => {
    const events: AmiMessage[] = [];
    const { client } = await setup((msg, reply) => {
      if (msg.action === 'CoreShowChannels') {
        reply({ Response: 'Success', ActionID: msg.actionid, EventList: 'start', Message: 'Channels will follow' });
        reply({ Event: 'CoreShowChannel', ActionID: msg.actionid, Channel: 'SIP/101-1' });
        reply({ Event: 'Newchannel', Channel: 'SIP/102-2' }); // unsolicited, interleaved
        reply({ Event: 'CoreShowChannel', ActionID: msg.actionid, Channel: 'SIP/103-3' });
        reply({ Event: 'CoreShowChannelsComplete', ActionID: msg.actionid, EventList: 'Complete', ListItems: '2' });
      }
    });
    client.on('event', (e) => events.push(e));
    client.start();
    await waitFor(() => client.connected);
    const res = await client.action('CoreShowChannels', {}, { list: true });
    expect(res.events.map((e) => e.channel)).toEqual(['SIP/101-1', 'SIP/103-3']);
    expect(events.map((e) => e.event)).toEqual(['Newchannel']);
  });

  it('rejects error responses and header injection', async () => {
    const { client } = await setup((msg, reply) => {
      reply({ Response: 'Error', ActionID: msg.actionid, Message: 'No such channel' });
    });
    client.start();
    await waitFor(() => client.connected);
    await expect(client.action('Hangup', { Channel: 'SIP/x' })).rejects.toMatchObject({
      kind: 'rejected',
      message: 'No such channel',
    });
    await expect(client.action('Hangup', { Channel: 'SIP/x\r\nAction: Command' })).rejects.toThrow(
      /forbidden character/,
    );
  });

  it('reports auth_failed and does not spin', async () => {
    const { client } = await setup(() => {}, 'bad');
    const states: string[] = [];
    client.on('state', (s) => states.push(s));
    client.start();
    await waitFor(() => client.state === 'auth_failed');
    await new Promise((r) => setTimeout(r, 100));
    expect(states.filter((s) => s === 'connecting')).toHaveLength(1);
    expect(client.lastError).toMatch(/Authentication failed/);
  });

  it('reconnects after the server drops the connection and fails pending actions', async () => {
    const { client, srv } = await setup(() => {
      /* never answers */
    });
    client.start();
    await waitFor(() => client.connected);
    const pending = client.action('Hangup', { Channel: 'SIP/101-1' });
    for (const s of srv.sockets) s.destroy();
    await expect(pending).rejects.toBeInstanceOf(AmiError);
    await waitFor(() => client.state !== 'connected');
    await waitFor(() => client.connected);
  });

  it('refuses actions while disconnected', async () => {
    const client = new AmiClient({ host: '127.0.0.1', port: 1, username: 'u', secret: 's' });
    await expect(client.action('Ping')).rejects.toMatchObject({ kind: 'disconnected' });
  });
});
