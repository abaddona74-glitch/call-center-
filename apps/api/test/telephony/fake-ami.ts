import { type AddressInfo, type Server, type Socket, createServer } from 'node:net';
import { AmiParser, type AmiMessage } from '../../src/modules/ami/ami.protocol.js';

export interface FakeAmiOptions {
  username: string;
  secret: string;
  /** Answers for list actions (SIPpeers, QueueStatus, CoreShowChannels). */
  lists?: Partial<Record<'sippeers' | 'queuestatus' | 'coreshowchannels', () => Array<Record<string, string>>>>;
}

/**
 * Scripted Asterisk Manager for e2e tests: logs every action it receives, answers them like
 * Asterisk 13, and lets the test push events (e.g. recorded simulator fixtures).
 */
export class FakeAmi {
  readonly actions: AmiMessage[] = [];
  private server: Server | null = null;
  private sockets = new Set<Socket>();
  /** Per-action override: return an error message to fail it. */
  failNext = new Map<string, string>();

  constructor(private readonly opts: FakeAmiOptions) {}

  async start(): Promise<number> {
    this.server = createServer((socket) => this.onConnection(socket));
    await new Promise<void>((resolve) => this.server!.listen(0, '127.0.0.1', () => resolve()));
    return (this.server!.address() as AddressInfo).port;
  }

  async stop(): Promise<void> {
    for (const s of this.sockets) s.destroy();
    await new Promise((r) => this.server?.close(r));
  }

  /** Drop every client connection (simulates a PBX restart / network loss). */
  dropClients(): void {
    for (const s of this.sockets) s.destroy();
  }

  get clients(): number {
    return [...this.sockets].filter((s) => (s as Socket & { loggedIn?: boolean }).loggedIn).length;
  }

  push(event: Record<string, string>): void {
    const frame = serialize(event);
    for (const s of this.sockets) if ((s as Socket & { loggedIn?: boolean }).loggedIn) s.write(frame);
  }

  lastAction(name: string): AmiMessage | undefined {
    return [...this.actions].reverse().find((a) => a.action?.toLowerCase() === name.toLowerCase());
  }

  private onConnection(socket: Socket & { loggedIn?: boolean }): void {
    this.sockets.add(socket);
    socket.on('close', () => this.sockets.delete(socket));
    socket.on('error', () => {});
    socket.setEncoding('utf8');
    socket.write('Asterisk Call Manager/2.10.6\r\n');
    const parser = new AmiParser();
    parser.push('banner\r\n');
    socket.on('data', (chunk: string) => {
      for (const msg of parser.push(chunk)) this.onAction(socket, msg);
    });
  }

  private onAction(socket: Socket & { loggedIn?: boolean }, msg: AmiMessage): unknown {
    const id = msg.actionid;
    const reply = (f: Record<string, string>) => socket.write(serialize({ ...f, ActionID: id }));
    const action = (msg.action ?? '').toLowerCase();
    if (action === 'login') {
      const ok = msg.username === this.opts.username && msg.secret === this.opts.secret;
      socket.loggedIn = ok;
      return reply(
        ok
          ? { Response: 'Success', Message: 'Authentication accepted' }
          : { Response: 'Error', Message: 'Authentication failed' },
      );
    }
    if (!socket.loggedIn) return reply({ Response: 'Error', Message: 'Permission denied' });
    if (action === 'ping') return reply({ Response: 'Success', Ping: 'Pong' });
    this.actions.push(msg);

    const failure = this.failNext.get(action);
    if (failure) {
      this.failNext.delete(action);
      return reply({ Response: 'Error', Message: failure });
    }
    const list = this.opts.lists?.[action as 'sippeers'];
    if (list || ['sippeers', 'queuestatus', 'coreshowchannels'].includes(action)) {
      const items = list?.() ?? [];
      reply({ Response: 'Success', EventList: 'start', Message: 'Will follow' });
      for (const e of items) socket.write(serialize({ ...e, ActionID: id }));
      const complete = {
        sippeers: 'PeerlistComplete',
        queuestatus: 'QueueStatusComplete',
        coreshowchannels: 'CoreShowChannelsComplete',
      }[action];
      return socket.write(
        serialize({
          Event: complete ?? 'Complete',
          ActionID: id,
          EventList: 'Complete',
          ListItems: String(items.length),
        }),
      );
    }
    return reply({ Response: 'Success', Message: `${msg.action} ok` });
  }
}

function serialize(fields: Record<string, string>): string {
  return `${Object.entries(fields)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\r\n')}\r\n\r\n`;
}
