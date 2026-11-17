import { mkdir, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ZipJob } from '@cc/shared';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type S5TestApp, type TestUser, createS5TestApp } from '../../../test/s5-harness.js';
import type { CdrRecordingRow } from './domain/cdr-recording.js';
import { RecordingsRepository } from './recordings.repository.js';
import { LocalRecordingStorage } from './storage/local-recording-storage.js';
import { RECORDING_STORAGE } from './storage/recording-storage.port.js';

const DAY = '2026/11/17';
const Q_FILE = 'q-200-901234567-20261117-100000-1763370000.1.wav';
const OUT_FILE = 'out-935551122-103-20261117-102000-1763371200.3.wav';

function cdr(over: Partial<CdrRecordingRow>): CdrRecordingRow {
  return {
    calldate: '2026-11-17 10:00:00',
    uniqueid: '',
    linkedid: '',
    src: '',
    dst: '',
    cnum: '',
    channel: '',
    dstchannel: '',
    recordingfile: '',
    ...over,
  };
}

/** CDR stand-in (the PBX MariaDB is not available in CI). */
class FakeCdrRepository {
  rows: CdrRecordingRow[] = [
    // inbound via queue, answered by 101
    cdr({ uniqueid: '1763370000.1', linkedid: '1763370000.1', src: '901234567', dst: '200', channel: 'SIP/712020159-1', dstchannel: 'Local/101@from-queue-1;1', recordingfile: Q_FILE }),
    // outbound from 103
    cdr({ uniqueid: '1763371200.3', linkedid: '1763371200.3', src: '103', dst: '935551122', channel: 'SIP/103-3', dstchannel: 'SIP/712020159-4', recordingfile: OUT_FILE, calldate: '2026-11-17 10:20:00' }),
    // answered by 101, no recording
    cdr({ uniqueid: '1763372000.5', linkedid: '1763372000.5', src: '901111111', dstchannel: 'Local/101@from-queue-5;1' }),
    // a value that points outside the monitor folder
    cdr({ uniqueid: '1763373000.7', linkedid: '1763373000.7', src: '901111112', dstchannel: 'Local/101@from-queue-7;1', recordingfile: '/etc/passwd' }),
  ];

  async rowsForCall(uid: string): Promise<CdrRecordingRow[]> {
    return this.rows.filter((r) => r.uniqueid === uid || r.linkedid === uid);
  }

  async recordedCallsInRange(): Promise<CdrRecordingRow[]> {
    return this.rows.filter((r) => r.recordingfile);
  }
}

describe('recordings (e2e)', () => {
  let t: S5TestApp;
  let admin: TestUser;
  let admin2: TestUser;
  let op101: TestUser;
  let op103: TestUser;
  let monitor: string;

  const http = () => request(t.app.getHttpServer());

  beforeAll(async () => {
    process.env.RECORDINGS_ZIP_MAX_FILES = '3';
    const { mkdtemp } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    monitor = await mkdtemp(path.join(tmpdir(), 'cc-s5-monitor-'));
    const day = path.join(monitor, DAY);
    await mkdir(day, { recursive: true });
    await mkdir(path.join(monitor, '2026/11/16'), { recursive: true });
    await writeFile(path.join(day, Q_FILE), Buffer.alloc(32_044, 1));
    await writeFile(path.join(day, OUT_FILE), Buffer.alloc(16_044, 2));
    await writeFile(path.join(day, 'q-200-935551122-20261117-101000-1763370600.2.wav'), Buffer.alloc(44));
    await writeFile(path.join(day, 'notes.txt'), 'not audio');
    await writeFile(path.join(day, 'index.html'), '<script>alert(1)</script>');
    await symlink('/etc/hosts', path.join(day, 'link.wav'));

    t = await createS5TestApp((b) =>
      b
        .overrideProvider(RECORDING_STORAGE)
        .useValue(new LocalRecordingStorage(monitor))
        .overrideProvider(RecordingsRepository)
        .useValue(new FakeCdrRepository()),
    );
    admin = await t.createUser('executive', null);
    admin2 = await t.createUser('superuser', null);
    op101 = await t.createUser('operator', '101');
    op103 = await t.createUser('operator', '103');
  });

  afterAll(async () => {
    delete process.env.RECORDINGS_ZIP_MAX_FILES;
    await t?.close();
  });

  describe('browsing', () => {
    it('requires a session and the admin role', async () => {
      await http().get('/api/recordings/tree').expect(401);
      await http().get('/api/recordings/tree').set('Authorization', op101.auth).expect(403);
      await http().get(`/api/recordings/stream?path=${DAY}/${Q_FILE}`).set('Authorization', op101.auth).expect(403);
    });

    it('lists folders and only regular audio files', async () => {
      const root = await http().get('/api/recordings/tree').set('Authorization', admin.auth).expect(200);
      expect(root.body.directories.map((d: { name: string }) => d.name)).toEqual(['2026']);

      const res = await http().get(`/api/recordings/tree?path=${DAY}`).set('Authorization', admin.auth).expect(200);
      const names = res.body.files.map((f: { name: string }) => f.name).sort();
      expect(names).toEqual([OUT_FILE, 'q-200-935551122-20261117-101000-1763370600.2.wav', Q_FILE].sort());
      const empty = res.body.files.find((f: { size: number }) => f.size === 44);
      expect(empty.kind).toBe('empty');
      expect(res.body.files.find((f: { name: string }) => f.name === OUT_FILE).kind).toBe('talk');
    });

    it.each([
      '../../etc',
      '2026/../../..',
      '2026\\11',
      '2026/11/%2e%2e',
      '..%2f..%2fetc',
    ])('rejects traversal in tree path %s', async (p) => {
      await http().get('/api/recordings/tree').query({ path: p }).set('Authorization', admin.auth).expect(400);
    });

    it('returns 404 for a missing folder (absolute-looking paths stay inside the monitor root)', async () => {
      await http().get('/api/recordings/tree?path=2030/01/01').set('Authorization', admin.auth).expect(404);
      await http().get('/api/recordings/tree?path=/etc/passwd').set('Authorization', admin.auth).expect(404);
    });
  });

  describe('streaming', () => {
    const url = `/api/recordings/stream?path=${DAY}/${Q_FILE}`;

    it('serves byte ranges for the player', async () => {
      const res = await http().get(url).set('Authorization', admin.auth).set('Range', 'bytes=100-199').expect(206);
      expect(res.headers['content-range']).toBe('bytes 100-199/32044');
      expect(res.headers['content-type']).toBe('audio/wav');
      expect(res.headers['accept-ranges']).toBe('bytes');
      expect(Number(res.headers['content-length'])).toBe(100);
    });

    it('serves the whole file, and downloads as attachment', async () => {
      const res = await http().get(`${url}&download=1`).set('Authorization', admin.auth).buffer(true).expect(200);
      expect(Number(res.headers['content-length'])).toBe(32_044);
      expect(res.headers['content-disposition']).toMatch(/^attachment; filename="q-200-901234567/);
    });

    it('answers 416 for ranges past the end', async () => {
      const res = await http().get(url).set('Authorization', admin.auth).set('Range', 'bytes=999999-').expect(416);
      expect(res.headers['content-range']).toBe('bytes */32044');
    });

    it('refuses empty recordings, symlinks, non-audio and traversal', async () => {
      await http()
        .get(`/api/recordings/stream?path=${DAY}/q-200-935551122-20261117-101000-1763370600.2.wav`)
        .set('Authorization', admin.auth)
        .expect(422);
      await http().get(`/api/recordings/stream?path=${DAY}/link.wav`).set('Authorization', admin.auth).expect(404);
      await http().get(`/api/recordings/stream?path=${DAY}/index.html`).set('Authorization', admin.auth).expect(400);
      await http().get(`/api/recordings/stream?path=${DAY}/notes.txt`).set('Authorization', admin.auth).expect(400);
      await http().get('/api/recordings/stream?path=../../../../etc/hosts.wav').set('Authorization', admin.auth).expect(400);
      await http().get('/api/recordings/stream?path=/etc/hosts.wav').set('Authorization', admin.auth).expect(400);
    });

    it('audits downloads', async () => {
      const rows = await t.db
        .selectFrom('auditLog')
        .select(['action', 'target'])
        .where('actorUserId', '=', admin.id)
        .where('action', 'in', ['recordings.download', 'recordings.play'])
        .execute();
      expect(rows).toContainEqual({ action: 'recordings.download', target: `recording:${DAY}/${Q_FILE}` });
      expect(rows).toContainEqual({ action: 'recordings.play', target: `recording:${DAY}/${Q_FILE}` });
    });
  });

  describe('recording of a call', () => {
    it('finds the exact file for admins', async () => {
      const res = await http().get('/api/recordings/calls/1763370000.1').set('Authorization', admin.auth).expect(200);
      expect(res.body.file.path).toBe(`${DAY}/${Q_FILE}`);
    });

    it('lets operators fetch only calls they took part in', async () => {
      await http().get('/api/recordings/calls/1763370000.1').set('Authorization', op101.auth).expect(200);
      await http().get('/api/recordings/calls/1763370000.1').set('Authorization', op103.auth).expect(403);
      await http().get('/api/recordings/calls/1763370000.1/stream').set('Authorization', op103.auth).expect(403);
      await http().get('/api/recordings/calls/1763371200.3').set('Authorization', op103.auth).expect(200);
      const res = await http()
        .get('/api/recordings/calls/1763370000.1/stream')
        .set('Authorization', op101.auth)
        .set('Range', 'bytes=0-99')
        .expect(206);
      expect(res.headers['content-range']).toBe('bytes 0-99/32044');

      const denied = await t.db
        .selectFrom('auditLog')
        .select('target')
        .where('actorUserId', '=', op103.id)
        .where('action', '=', 'recordings.denied')
        .execute();
      expect(denied.length).toBeGreaterThan(0);
    });

    it('does not guess: no recording, unsafe value or unknown call → 404', async () => {
      const none = await http().get('/api/recordings/calls/1763372000.5').set('Authorization', op101.auth).expect(404);
      expect(none.body.message).toMatch(/no recording/);
      await http().get('/api/recordings/calls/1763373000.7').set('Authorization', admin.auth).expect(404);
      await http().get('/api/recordings/calls/1700000000.9').set('Authorization', admin.auth).expect(404);
      await http().get('/api/recordings/calls/1;DROP').set('Authorization', admin.auth).expect(400);
    });
  });

  describe('zip jobs', () => {
    async function waitFor(id: string, user: TestUser): Promise<ZipJob> {
      for (let i = 0; i < 50; i++) {
        const res = await http().get(`/api/recordings/zip-jobs/${id}`).set('Authorization', user.auth).expect(200);
        if (!['queued', 'processing'].includes(res.body.status)) return res.body;
        await new Promise((r) => setTimeout(r, 50));
      }
      throw new Error('zip job did not finish');
    }

    it('is admin-only', async () => {
      await http()
        .post('/api/recordings/zip-jobs')
        .set('Authorization', op101.auth)
        .send({ source: 'files', paths: [`${DAY}/${Q_FILE}`] })
        .expect(403);
    });

    it('builds an archive, skipping empty files and symlinks; only the owner sees it', async () => {
      const created = await http()
        .post('/api/recordings/zip-jobs')
        .set('Authorization', admin.auth)
        .send({
          source: 'files',
          paths: [`${DAY}/${Q_FILE}`, `${DAY}/link.wav`, `${DAY}/q-200-935551122-20261117-101000-1763370600.2.wav`],
          zipName: 'export<1>',
        })
        .expect(201);
      const job = await waitFor(created.body.id, admin);
      expect(job).toMatchObject({ status: 'ready', added: 1, skipped: 2, zipName: 'export_1_.zip', progress: 100 });

      await http().get(`/api/recordings/zip-jobs/${job.id}`).set('Authorization', admin2.auth).expect(404);
      await http().get(`/api/recordings/zip-jobs/${job.id}/download`).set('Authorization', admin2.auth).expect(404);

      const dl = await http()
        .get(`/api/recordings/zip-jobs/${job.id}/download`)
        .set('Authorization', admin.auth)
        .buffer(true)
        .parse((res, cb) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => cb(null, Buffer.concat(chunks)));
        })
        .expect(200);
      expect(dl.headers['content-type']).toBe('application/zip');
      expect(dl.headers['content-disposition']).toContain('attachment; filename="export_1_.zip"');
      expect((dl.body as Buffer).subarray(0, 2).toString()).toBe('PK');
      expect((dl.body as Buffer).includes(Buffer.from(Q_FILE))).toBe(true);
    });

    it('exports calls by uniqueid', async () => {
      const created = await http()
        .post('/api/recordings/zip-jobs')
        .set('Authorization', admin.auth)
        .send({ source: 'calls', uniqueids: ['1763370000.1', '1763371200.3', '1763372000.5'] })
        .expect(201);
      const job = await waitFor(created.body.id, admin);
      expect(job).toMatchObject({ status: 'ready', added: 2 });
    });

    it('enforces the file limit and validates input', async () => {
      const paths = ['a', 'b', 'c', 'd'].map((n) => `${DAY}/${n}.wav`);
      const res = await http()
        .post('/api/recordings/zip-jobs')
        .set('Authorization', admin.auth)
        .send({ source: 'files', paths })
        .expect(400);
      expect(res.body.message).toMatch(/limit is 3/);
      await http()
        .post('/api/recordings/zip-jobs')
        .set('Authorization', admin.auth)
        .send({ source: 'files', paths: ['../../etc/passwd.wav'] })
        .expect(400);
      await http().post('/api/recordings/zip-jobs').set('Authorization', admin.auth).send({ source: 'shell' }).expect(400);
      await http().get('/api/recordings/zip-jobs/..%2F..%2Fetc').set('Authorization', admin.auth).expect(400);
    });

    it('fails cleanly when nothing is playable', async () => {
      const created = await http()
        .post('/api/recordings/zip-jobs')
        .set('Authorization', admin.auth)
        .send({ source: 'files', paths: [`${DAY}/link.wav`] })
        .expect(201);
      const job = await waitFor(created.body.id, admin);
      expect(job.status).toBe('failed');
      expect(job.error).toMatch(/playable/);
      await http().get(`/api/recordings/zip-jobs/${job.id}/download`).set('Authorization', admin.auth).expect(409);
    });
  });
});
