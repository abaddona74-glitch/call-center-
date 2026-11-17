import { afterEach, describe, expect, it } from 'vitest';
import { FakeAmi } from '../../../test/telephony/fake-ami.js';
import type { AppConfig } from '../../config/app-config.js';
import { AmiService } from './ami.service.js';

const waitFor = async (cond: () => boolean, ms = 3_000) => {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 10));
  }
};

function config(port: number, extra: Record<string, unknown> = {}): AppConfig {
  const values: Record<string, unknown> = {
    AMI_HOST: '127.0.0.1',
    AMI_PORT: port,
    AMI_USER: 'live',
    AMI_PASSWORD: 'live-secret',
    AMI_PING_INTERVAL_SEC: 20,
    AMI_CHANNEL_TECH: 'SIP',
    ...extra,
  };
  return { amiEnabled: true, get: (k: string) => values[k] } as unknown as AppConfig;
}

describe('AmiService', () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const c of cleanups.splice(0)) await c();
  });

  async function start(extra: Record<string, unknown> = {}) {
    // One fake PBX that accepts both users, like a real manager.conf with two sections.
    const pbx = new FakeAmi({ username: 'live', secret: 'live-secret' });
    const astdbPbx = new FakeAmi({ username: 'astdb', secret: 'astdb-secret' });
    const port = await pbx.start();
    const astdbPort = await astdbPbx.start();
    const svc = new AmiService(config(port, extra));
    // Route the AstDB connection to the second fake (same host:port in production).
    if (extra.AMI_ASTDB_USER) (svc as unknown as { astdb: { o: { port: number } } }).astdb.o.port = astdbPort;
    svc.onApplicationBootstrap();
    cleanups.push(async () => {
      await svc.onApplicationShutdown();
      await pbx.stop();
      await astdbPbx.stop();
    });
    return { svc, pbx, astdbPbx };
  }

  it('without AMI_ASTDB_USER everything goes through the main user', async () => {
    const { svc, pbx } = await start();
    await waitFor(() => svc.commands.connected);
    await svc.commands.dbPut('blacklist_114', '901234567', '1');
    await svc.commands.queuePause({ member: 'Local/101@from-queue/n', paused: true });
    expect(pbx.actions.map((a) => a.action)).toEqual(expect.arrayContaining(['DBPut', 'QueuePause']));
    expect(pbx.logins[0].events).toBe('on');
  });

  it('with AMI_ASTDB_USER, AstDB writes use the dedicated events-off user and nothing else does', async () => {
    const { svc, pbx, astdbPbx } = await start({ AMI_ASTDB_USER: 'astdb', AMI_ASTDB_PASSWORD: 'astdb-secret' });
    await waitFor(() => svc.commands.connected);
    await svc.commands.dbPut('blacklist_114', '901234567', 'Spam');
    await svc.commands.dbDel('blacklist', '901234567');
    await svc.commands.queuePause({ member: 'Local/101@from-queue/n', paused: false });
    await svc.redirect({ channel: 'SIP/712020159-00000001', exten: '103', context: 'from-internal' });

    expect(astdbPbx.logins[0]).toMatchObject({ username: 'astdb', events: 'off' });
    expect(astdbPbx.actions.map((a) => a.action)).toEqual(['DBPut', 'DBDel']);
    expect(pbx.actions.map((a) => a.action)).toEqual(expect.arrayContaining(['QueuePause', 'Redirect']));
    expect(pbx.actions.some((a) => a.action?.startsWith('DB'))).toBe(false);
  });

  it('the port reports not connected until the AstDB user is in', async () => {
    const { svc } = await start({ AMI_ASTDB_USER: 'astdb', AMI_ASTDB_PASSWORD: 'wrong' });
    await waitFor(() => svc.connected);
    expect(svc.commands.connected).toBe(false);
    await expect(svc.commands.dbPut('blacklist', '901234567', '1')).rejects.toThrow(/not connected/);
  });
});
