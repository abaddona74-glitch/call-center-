import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type E2eContext, auditRows, createE2eApp } from './e2e-app.js';

let ctx: E2eContext;
let key101: string;
let device101: number;
const http = () => request(ctx.app.getHttpServer());

// Compat mode is on for this suite, limited to 10.0.0.0/8 (requests come through a trusted loopback proxy).
beforeAll(async () => {
  ctx = await createE2eApp('agent', { AGENT_COMPAT_MODE: 'true', AGENT_COMPAT_ALLOWED_CIDRS: '10.0.0.0/8' });
}, 60_000);

afterAll(async () => {
  await ctx?.close();
});

describe('device keys (admin)', () => {
  it('operators cannot manage devices, releases or read agent data', async () => {
    const a = ctx.users.op101.auth;
    await http().get('/api/agent/devices').set('Authorization', a).expect(403);
    await http().post('/api/agent/devices').set('Authorization', a).send({ name: 'PC', extension: '101' }).expect(403);
    await http().post('/api/agent/devices/1/revoke').set('Authorization', a).expect(403);
    await http().get('/api/agent/status').set('Authorization', a).expect(403);
    await http().post('/api/agent/releases').set('Authorization', a).send({ version: '2.0.0' }).expect(403);
    await http().get('/api/agent/update-logs').set('Authorization', a).expect(403);
    await http().get('/api/agent/events').set('Authorization', a).expect(403);
  });

  it('issues a key once and stores only its hash', async () => {
    const res = await http()
      .post('/api/agent/devices')
      .set('Authorization', ctx.users.admin.auth)
      .send({ name: 'Operator 101 PC', extension: '101' })
      .expect(201);
    key101 = res.body.apiKey;
    device101 = res.body.device.id;
    expect(key101).toMatch(/^cca_[A-Za-z0-9_-]{43}$/);
    expect(res.body.device).toMatchObject({
      name: 'Operator 101 PC',
      extension: '101',
      keyPrefix: key101.slice(0, 10),
      online: false,
    });

    const stored = await ctx.db.query('select key_hash, key_prefix from agent_devices where id = $1', [device101]);
    expect(stored.rows[0].key_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(stored.rows)).not.toContain(key101);
    const list = await http().get('/api/agent/devices').set('Authorization', ctx.users.admin.auth).expect(200);
    expect(JSON.stringify(list.body)).not.toContain(key101);
    expect(list.body.compatMode).toBe(true);
    expect((await auditRows(ctx.db, 'agent.device.create'))[0].details).toMatchObject({ extension: '101' });
  });

  it('validates device input', async () => {
    await http()
      .post('/api/agent/devices')
      .set('Authorization', ctx.users.admin.auth)
      .send({ name: '', extension: '101' })
      .expect(400);
    await http()
      .post('/api/agent/devices')
      .set('Authorization', ctx.users.admin.auth)
      .send({ name: 'PC', extension: '1' })
      .expect(400);
  });
});

describe('ingest authentication', () => {
  it('accepts a valid key and reports the latest version (legacy response shape)', async () => {
    const res = await http()
      .post('/api/agent/heartbeat')
      .set('x-agent-key', key101)
      .send({ operatorId: '101', hostname: 'PC-101', appVersion: '1.0.3' })
      .expect(200);
    expect(res.body).toEqual({
      success: true,
      timestamp: expect.any(Number),
      latestVersion: '1.0.4',
      updateUrl: '/downloads/agent.exe',
    });

    const status = await http().get('/api/agent/status').set('Authorization', ctx.users.admin.auth).expect(200);
    expect(status.body.items).toEqual([
      expect.objectContaining({
        extension: '101',
        authMode: 'key',
        deviceName: 'Operator 101 PC',
        hostname: 'PC-101',
        appVersion: '1.0.3',
        online: true,
        isLatest: false,
      }),
    ]);
  });

  it('a key may only report for its own extension', async () => {
    await http().post('/api/agent/heartbeat').set('x-agent-key', key101).send({ operatorId: '103' }).expect(403);
  });

  it('rejects missing or wrong keys from outside the compat networks', async () => {
    await http().post('/api/agent/heartbeat').send({ operatorId: '101' }).expect(401);
    await http()
      .post('/api/agent/heartbeat')
      .set('x-agent-key', 'cca_wrongwrongwrongwrongwrong')
      .send({ operatorId: '101' })
      .expect(401);
    await http()
      .post('/api/agent/heartbeat')
      .set('X-Forwarded-For', '192.168.5.5')
      .send({ operatorId: '101' })
      .expect(401);
  });

  it('compat mode accepts legacy agents only from the configured private range', async () => {
    await http()
      .post('/api/agent/heartbeat')
      .set('X-Forwarded-For', '10.1.2.3')
      .send({ operatorId: '120', version: '1.0.4' })
      .expect(200);
    const status = await http().get('/api/agent/status').set('Authorization', ctx.users.admin.auth).expect(200);
    expect(status.body.items.find((s: { extension: string }) => s.extension === '120')).toMatchObject({
      authMode: 'legacy',
      ip: '10.1.2.3',
      isLatest: true,
    });
  });

  it('a revoked key stops working', async () => {
    const created = await http()
      .post('/api/agent/devices')
      .set('Authorization', ctx.users.admin.auth)
      .send({ name: 'Old PC', extension: '111' })
      .expect(201);
    await http()
      .post('/api/agent/heartbeat')
      .set('x-agent-key', created.body.apiKey)
      .send({ operatorId: '111' })
      .expect(200);
    const revoked = await http()
      .post(`/api/agent/devices/${created.body.device.id}/revoke`)
      .set('Authorization', ctx.users.admin.auth)
      .expect(200);
    expect(revoked.body).toMatchObject({ revokedBy: 'admin1', online: false });
    await http()
      .post('/api/agent/heartbeat')
      .set('x-agent-key', created.body.apiKey)
      .send({ operatorId: '111' })
      .expect(401);
    await http().post('/api/agent/devices/999999/revoke').set('Authorization', ctx.users.admin.auth).expect(404);
    expect((await auditRows(ctx.db, 'agent.device.revoke')).length).toBe(1);
  });

  it('the version endpoint stays public, as in legacy', async () => {
    const res = await http().get('/api/agent/version').expect(200);
    expect(res.body).toMatchObject({ success: true, latestVersion: '1.0.4' });
  });
});

describe('call events', () => {
  it('validates and sanitizes every field', async () => {
    await http()
      .post('/api/agent/call-event')
      .set('x-agent-key', key101)
      .send({
        operatorId: 101,
        eventType: 'answered<script>',
        callerId: '+998 90 123-45-67<img src=x onerror=alert(1)>',
        durationSec: '15',
        startTime: '2026/11/17 10:00:00',
        endTime: '2026-11-17 10:00:15',
        hostname: 'PC-101;rm -rf /',
        details: 'ok\u0000<b>bold</b>',
      })
      .expect(200);
    const { rows } = await ctx.db.query('select * from agent_call_events order by id desc limit 1');
    expect(rows[0]).toMatchObject({
      extension: '101',
      event_type: 'UNKNOWN', // "ANSWEREDSCRIPT" is not a known type; the raw value is kept apart
      raw_event_type: 'ANSWEREDSCRIPT',
      caller_id: '+998 90 123-45-67img srcx onerroralert(1', // markup chars stripped, 40 chars max
      duration_sec: 15,
      hostname: 'PC-101rm -rf',
      details: 'okbbold/b',
      auth_mode: 'key',
    });
    expect(new Date(rows[0].started_at).toISOString()).toBe('2026-11-17T05:00:00.000Z');
  });

  it('stores normal events with the normalized phone', async () => {
    await http()
      .post('/api/agent/call-event')
      .set('x-agent-key', key101)
      .send({
        operatorId: '101',
        eventType: 'answered',
        callerId: '998935551122',
        durationSec: 42,
        startTime: '2026-11-17 11:00:00',
      })
      .expect(200);
    const res = await http()
      .get('/api/agent/events?date=2026-11-17')
      .set('Authorization', ctx.users.admin.auth)
      .expect(200);
    expect(res.body.items[0]).toMatchObject({
      eventType: 'ANSWERED',
      phone: '935551122',
      durationSec: 42,
      extension: '101',
    });
  });

  it.each([
    [{ eventType: 'ANSWERED' }, 'operatorId missing'],
    [{ operatorId: '1', eventType: 'ANSWERED' }, 'operatorId too short'],
    [{ operatorId: '101 OR 1=1', eventType: 'ANSWERED' }, 'operatorId not digits'],
    [{ operatorId: '101', eventType: '' }, 'empty eventType'],
    [{ operatorId: '101', eventType: 'ENDED', durationSec: 'abc' }, 'non-numeric duration'],
    [{ operatorId: '101', eventType: 'ENDED', durationSec: -5 }, 'negative duration'],
  ] as Array<[object, string]>)('rejects %j (%s)', async (body) => {
    await http().post('/api/agent/call-event').set('x-agent-key', key101).send(body).expect(400);
  });

  it('sync-batch ignores re-sent events and skips invalid items', async () => {
    const calls = [
      { eventType: 'MISSED', callerId: '977001122', startTime: '2026-11-17 12:00:00' },
      { eventType: 'MISSED', callerId: '977001122', startTime: '2026-11-17 12:00:00' }, // duplicate
      { eventType: 'DIALLED', callerId: '977001122', durationSec: 0, startTime: '2026-11-17 12:05:00' },
      { eventType: 42 }, // not a string → still accepted as "42" → UNKNOWN
      { callerId: 'no type' }, // invalid
      'garbage',
    ];
    const first = await http()
      .post('/api/agent/sync-batch')
      .set('x-agent-key', key101)
      .send({ operatorId: '101', hostname: 'PC-101', calls })
      .expect(200);
    expect(first.body).toEqual({ success: true, count: 3, skipped: 3 });
    const again = await http()
      .post('/api/agent/sync-batch')
      .set('x-agent-key', key101)
      .send({ operatorId: '101', calls })
      .expect(200);
    expect(again.body).toEqual({ success: true, count: 1, skipped: 5 }); // only the event without startTime is new again
  });

  it('refuses batches over the legacy item limit', async () => {
    const calls = Array.from({ length: 20_001 }, () => ({ eventType: 'INFO' }));
    await http()
      .post('/api/agent/sync-batch')
      .set('x-agent-key', key101)
      .send({ operatorId: '101', calls })
      .expect(400);
  });
});

describe('releases and OTA log', () => {
  it('publishing a release changes what agents are told, audited', async () => {
    await http()
      .post('/api/agent/releases')
      .set('Authorization', ctx.users.admin.auth)
      .send({ version: 'bad version!' })
      .expect(400);
    await http()
      .post('/api/agent/releases')
      .set('Authorization', ctx.users.admin.auth)
      .send({ version: '1.1.0', updateUrl: 'javascript:alert(1)' })
      .expect(400);
    const rel = await http()
      .post('/api/agent/releases')
      .set('Authorization', ctx.users.admin.auth)
      .send({ version: '1.1.0', releaseNotes: 'Faster sync', minVersion: '1.0.0' })
      .expect(201);
    expect(rel.body).toMatchObject({ version: '1.1.0', updateUrl: '/downloads/agent.exe', createdBy: 'admin1' });

    const version = await http().get('/api/agent/version').expect(200);
    expect(version.body).toMatchObject({ latestVersion: '1.1.0', releaseNotes: 'Faster sync', minVersion: '1.0.0' });
    const hb = await http()
      .post('/api/agent/heartbeat')
      .set('x-agent-key', key101)
      .send({ operatorId: '101', appVersion: '1.1.0' })
      .expect(200);
    expect(hb.body.latestVersion).toBe('1.1.0');
    expect((await auditRows(ctx.db, 'agent.release.create')).length).toBe(1);
  });

  it('stores OTA update steps', async () => {
    await http()
      .post('/api/agent/update-log')
      .set('x-agent-key', key101)
      .send({
        operatorId: '101',
        hostname: 'PC-101',
        version: '1.0.4',
        targetVersion: '1.1.0',
        step: 'downloading',
        message: 'Downloading 3 MB',
      })
      .expect(200);
    await http()
      .post('/api/agent/update-log')
      .set('x-agent-key', key101)
      .send({ operatorId: '101', step: 'weird' })
      .expect(200);
    const logs = await http().get('/api/agent/update-logs').set('Authorization', ctx.users.admin.auth).expect(200);
    expect(logs.body.items.map((l: { step: string }) => l.step)).toEqual(['INFO', 'DOWNLOADING']);
  });
});
