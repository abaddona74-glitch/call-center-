/**
 * E2E: AI call analysis — permissions (per-call = recordings right, aggregates = statistics right, queue = superuser),
 * the worker's service token, backfill/enqueue selection, the job queue (lease order, lease ownership, expiry, retry,
 * attempts), result validation and storage, the ground truth from tickets, and the aggregates.
 * The PBX is faked (CDR rows in memory), recordings come from a temp monitor folder.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { type WorkerResult } from '@cc/shared';
import { sql } from 'kysely';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CallAnalysisEnqueuer } from '../src/modules/call-analysis/call-analysis.enqueuer.js';
import '../src/modules/call-analysis/call-analysis.tables.js';
import { sha256Hex } from '../src/modules/call-analysis/domain/job-policy.js';
import type { CdrRecordingRow } from '../src/modules/recordings/domain/cdr-recording.js';
import { RecordingsRepository } from '../src/modules/recordings/recordings.repository.js';
import { LocalRecordingStorage } from '../src/modules/recordings/storage/local-recording-storage.js';
import { RECORDING_STORAGE } from '../src/modules/recordings/storage/recording-storage.port.js';
import type { CdrRow } from '../src/pbx/calls/cdr-row.js';
import { CdrRepository } from '../src/pbx/calls/cdr.repository.js';
import { inbound, outbound } from '../src/pbx/calls/testing/cdr-fixtures.js';
import { FakeCdrRepository } from './cdr/fake-cdr-repository.js';
import { Client, type E2eApp, ROOT, createE2eApp, createUser, loginAs } from './support/e2e-app.js';

const TOKEN = 'e2e-worker-token-0123456789abcdef';

// Tue 2026-11-17 (Asia/Tashkent): newest first = c4, c3, c1 among the analysable ones.
const c1 = inbound({ at: '2026-11-17 09:00:00', caller: '901234567', outcome: 'answered', answeredBy: '101', talk: 90 });
const cShort = inbound({ at: '2026-11-17 09:30:00', caller: '901234568', outcome: 'answered', answeredBy: '101', talk: 10 });
const cAbandoned = inbound({ at: '2026-11-17 10:00:00', caller: '901234569', outcome: 'abandoned', abandonAfter: 30 });
const c3 = outbound({ at: '2026-11-17 11:00:00', ext: '103', number: '935551122', disposition: 'ANSWERED', talk: 40 });
const c4 = inbound({ at: '2026-11-17 12:00:00', caller: '901234570', outcome: 'answered', answeredBy: '103', talk: 120 });
const rows: CdrRow[] = [c1, cShort, cAbandoned, c3, c4].flat();
const idOf = (legs: CdrRow[]) => legs[0].linkedid || legs[0].uniqueid;
const [ID1, ID3, ID4] = [idOf(c1), idOf(c3), idOf(c4)];

class FakeRecordingsRepository {
  async rowsForCall(uid: string): Promise<CdrRecordingRow[]> {
    return rows
      .filter((r) => r.uniqueid === uid || r.linkedid === uid)
      .map((r) => ({
        calldate: r.calldate,
        uniqueid: r.uniqueid,
        linkedid: r.linkedid ?? '',
        src: r.src,
        dst: r.dst,
        cnum: '',
        channel: r.channel,
        dstchannel: r.dstchannel,
        recordingfile: r.recordingfile,
      }));
  }
  async recordedCallsInRange(): Promise<CdrRecordingRow[]> {
    return [];
  }
}

function result(over: Partial<WorkerResult> = {}): WorkerResult {
  return {
    workerId: 'w1',
    transcript: {
      language: 'uz',
      audioSec: 90,
      segments: [
        { start: 0, end: 3, role: 'operator', speaker: 'SPEAKER_01', text: 'Assalomu alaykum, Unicon call-markaz' },
        { start: 3.2, end: 8, role: 'client', speaker: 'SPEAKER_00', text: 'Kalitim ishlamayapti' },
      ],
    },
    analysis: {
      topicCode: 'eri_key',
      subtopic: { uz: 'Kalit', ru: 'Ключ' },
      problem: { uz: 'Kalit ishlamaydi', ru: 'Не работает ключ ЭЦП' },
      summary: { uz: 'Hal qilindi', ru: 'Решено' },
      outcome: 'ticket_opened',
      scores: { greeting: 5, politeness: 4, understanding: 4, solution: 3, closing: 5 },
      overall: 8,
      redFlags: [{ code: 'interrupting', note: 'Перебивал', at: 4 }],
      sentimentStart: 'negative',
      sentimentEnd: 'positive',
      language: 'uz',
      recommendation: { uz: 'Tinglang', ru: 'Дослушивать' },
    },
    meta: {
      promptVersion: 'v1-test',
      sttStrategy: 'turns',
      sttModel: 'whisper-uz',
      llmModel: 'deepseek',
      thinking: false,
      sttMs: 1000,
      llmMs: 500,
      llmAttempts: 1,
      sttRerun: false,
    },
    ...over,
  };
}

let e2e: E2eApp;
let monitor: string;
let root: Client;
let executive: Client;
let observer: Client;
let operator: Client;

const worker = () => ({
  post: (p: string, body: object, token = TOKEN) =>
    request(e2e.app.getHttpServer())
      .post(`/api/call-analysis/worker${p}`)
      .set('Authorization', `Bearer ${token}`)
      .send(body),
  get: (p: string, token = TOKEN) =>
    request(e2e.app.getHttpServer()).get(`/api/call-analysis/worker${p}`).set('Authorization', `Bearer ${token}`),
});
const lease = (workerId: string, limit = 1) => worker().post('/lease', { workerId, limit, leaseSec: 600 });
const jobRow = (id: string) =>
  e2e.db.selectFrom('callAnalysisJobs').selectAll().where('callId', '=', id).executeTakeFirstOrThrow();

beforeAll(async () => {
  process.env.CALL_ANALYSIS_WORKER_TOKEN_SHA256 = sha256Hex(TOKEN);
  process.env.CALL_ANALYSIS_MIN_TALK_SEC = '20';
  process.env.CALL_ANALYSIS_MAX_ATTEMPTS = '2';
  process.env.SFTP_HOST = '';
  monitor = await mkdtemp(path.join(tmpdir(), 'cc-analysis-monitor-'));
  for (const legs of [c1, c3, c4]) {
    const file = legs.find((r) => r.recordingfile)!.recordingfile;
    await mkdir(path.join(monitor, '2026/11/17'), { recursive: true });
    await writeFile(path.join(monitor, '2026/11/17', file), Buffer.alloc(16_044, 7));
  }
  e2e = await createE2eApp((b) =>
    b
      .overrideProvider(CdrRepository)
      .useValue(new FakeCdrRepository(rows, [{ extension: '101', name: 'Aziza' }]))
      .overrideProvider(RECORDING_STORAGE)
      .useValue(new LocalRecordingStorage(monitor))
      .overrideProvider(RecordingsRepository)
      .useValue(new FakeRecordingsRepository()),
  );
  root = await loginAs(e2e, ROOT.username, ROOT.password);
  for (const [username, role, extension] of [
    ['ca_exec', 'executive', null],
    ['ca_obs', 'observer', null],
    ['ca_op', 'operator', '101'],
  ] as const) {
    await createUser(root, { username, role, extension, password: 'Strong-Pass-123' });
  }
  executive = await loginAs(e2e, 'ca_exec', 'Strong-Pass-123');
  observer = await loginAs(e2e, 'ca_obs', 'Strong-Pass-123');
  operator = await loginAs(e2e, 'ca_op', 'Strong-Pass-123');
}, 60_000);

afterAll(async () => {
  await e2e?.close();
  if (monitor) await rm(monitor, { recursive: true, force: true });
  for (const k of ['CALL_ANALYSIS_WORKER_TOKEN_SHA256', 'CALL_ANALYSIS_MIN_TALK_SEC', 'CALL_ANALYSIS_MAX_ATTEMPTS']) {
    delete process.env[k];
  }
});

describe('access', () => {
  it('per call: the recordings right; aggregates: the statistics right; the queue: superuser only', async () => {
    await operator.get(`/call-analysis/calls/${ID1}`).expect(403);
    await operator.get('/call-analysis/status?ids=1.1').expect(403);
    await operator.get('/call-analysis/stats?from=2026-11-17&to=2026-11-17').expect(403);
    await observer.get(`/call-analysis/calls/${ID1}`).expect(200);
    await observer.get('/call-analysis/stats?from=2026-11-17&to=2026-11-17').expect(200);
    await executive.get('/call-analysis/stats?from=2026-11-17&to=2026-11-17').expect(200);
    for (const c of [operator, observer, executive]) {
      await c.get('/call-analysis/queue').expect(403);
      await c.post('/call-analysis/backfill', { from: '2026-11-17', to: '2026-11-17' }).expect(403);
      await c.post('/call-analysis/queue/retry-failed').expect(403);
    }
    await root.get('/call-analysis/queue').expect(200);
    await new Client(e2e).get(`/call-analysis/calls/${ID1}`).expect(401);
  });

  it('the worker API needs the service token, a session is not enough', async () => {
    await worker().post('/lease', { workerId: 'w1' }, 'wrong-token-0123456789').expect(401);
    await request(e2e.app.getHttpServer()).post('/api/call-analysis/worker/lease').send({ workerId: 'w1' }).expect(401);
    await root.post('/call-analysis/worker/lease', { workerId: 'w1' }).expect(401);
    await worker().post('/lease', { workerId: 'bad id!' }).expect(400);
  });
});

describe('queueing', () => {
  it('the enqueuer takes answered recorded calls with enough talk from the lookback window only', async () => {
    const enqueuer = e2e.app.get(CallAnalysisEnqueuer);
    // 6 h before 12:30 → from 06:30: all calls of the day; the short and the abandoned one are not analysable
    const r = await enqueuer.tick(Date.parse('2026-11-17T12:30:00+05:00'));
    expect(r).toEqual({ eligible: 3, enqueued: 3 });
    const again = await enqueuer.tick(Date.parse('2026-11-17T12:30:00+05:00'));
    expect(again).toEqual({ eligible: 3, enqueued: 0 });
    const jobs = await e2e.db.selectFrom('callAnalysisJobs').select(['callId', 'source', 'operatorExt', 'direction']).execute();
    expect(jobs.map((j) => j.callId).sort()).toEqual([ID1, ID3, ID4].sort());
    expect(jobs.find((j) => j.callId === ID4)).toMatchObject({ source: 'auto', operatorExt: '103', direction: 'inbound' });
    expect(jobs.find((j) => j.callId === ID3)).toMatchObject({ operatorExt: '103', direction: 'outbound' });
  });

  it('a later window sees only its calls', async () => {
    await e2e.db.deleteFrom('callAnalysisJobs').execute();
    const r = await e2e.app.get(CallAnalysisEnqueuer).tick(Date.parse('2026-11-17T17:30:00+05:00'));
    expect(r).toEqual({ eligible: 1, enqueued: 1 }); // from 11:30: only c4
  });

  it('backfill by range and by call ids (superuser); unknown or unanalysable ids are rejected', async () => {
    const range = await root.post('/call-analysis/backfill', { from: '2026-11-17', to: '2026-11-17' }).expect(200);
    expect(range.body).toEqual({ eligible: 3, enqueued: 2, existing: 1, rejected: 0 });
    const ids = await root
      .post('/call-analysis/backfill', { callIds: [ID1, idOf(cShort), '1700000000.999'] })
      .expect(200);
    expect(ids.body).toEqual({ eligible: 1, enqueued: 0, existing: 1, rejected: 2 });
    await root.post('/call-analysis/backfill', { from: '2026-11-17', to: '2026-11-17', callIds: [ID1] }).expect(400);
  });
});

describe('worker flow', () => {
  it('leases newest first, never the same job twice', async () => {
    const a = await lease('w1').expect(200);
    expect(a.body.jobs.map((j: { callId: string }) => j.callId)).toEqual([ID4]);
    expect(a.body.jobs[0]).toMatchObject({ direction: 'inbound', operatorExt: '103', attempts: 1, talkSec: 120 });
    expect(a.body.topics.map((t: { code: string }) => t.code)).toContain('other');
    const b = await lease('w2', 5).expect(200);
    expect(b.body.jobs.map((j: { callId: string }) => j.callId)).toEqual([ID3, ID1]);
    expect((await lease('w3', 5).expect(200)).body.jobs).toEqual([]);
  });

  it('only the lease holder downloads the recording and posts results', async () => {
    const rec = await worker().get(`/jobs/${ID4}/recording?workerId=w1`).expect(200);
    expect(rec.headers['content-type']).toBe('audio/wav');
    expect(Number(rec.headers['content-length'])).toBe(16_044);
    await worker().get(`/jobs/${ID4}/recording?workerId=w2`).expect(409);
    await worker().post(`/jobs/${ID4}/result`, result({ workerId: 'w2' })).expect(409);
    await worker().post(`/jobs/${ID4}/fail`, { workerId: 'w2', error: 'x', retryable: true }).expect(409);
  });

  it('rejects invalid results and unknown topics; accepts large results posted with the result content type', async () => {
    const bad = await worker()
      .post(`/jobs/${ID4}/result`, { ...result(), analysis: { ...result().analysis, overall: 42 } })
      .expect(400);
    expect(JSON.stringify(bad.body)).toContain('analysis.overall');
    await worker()
      .post(`/jobs/${ID4}/result`, { ...result(), analysis: { ...result().analysis, topicCode: 'no_such_topic' } })
      .expect(422);
    expect((await jobRow(ID4)).status).toBe('processing');

    const segments = Array.from({ length: 1500 }, (_, i) => ({
      start: i * 2,
      end: i * 2 + 1.5,
      role: i % 2 ? 'client' : 'operator',
      speaker: i % 2 ? 'SPEAKER_00' : 'SPEAKER_01',
      text: 'Assalomu alaykum, kalitim ishlamayapti, yordam bering iltimos. '.repeat(2),
    }));
    const big = JSON.stringify(result({ transcript: { language: 'uz', audioSec: 3000, segments } as WorkerResult['transcript'] }));
    expect(big.length).toBeGreaterThan(150_000);
    const ok = await request(e2e.app.getHttpServer())
      .post(`/api/call-analysis/worker/jobs/${ID4}/result`)
      .set('Authorization', `Bearer ${TOKEN}`)
      .set('Content-Type', 'application/vnd.cc.analysis-result+json')
      .send(big)
      .expect(200);
    expect(ok.body).toEqual({ ok: true, status: 'done' });
    // a finished job takes no second result
    await worker().post(`/jobs/${ID4}/result`, result()).expect(409);
  });

  it('a normal-sized result as plain JSON', async () => {
    await worker().post(`/jobs/${ID1}/result`, result({ workerId: 'w2' })).expect(200);
    const job = await jobRow(ID1);
    expect(job).toMatchObject({ status: 'done', leaseOwner: null, lastError: null });
    expect(job.finishedAt).not.toBeNull();
  });

  it('retryable failures wait and come back; the last attempt fails; retry-failed requeues', async () => {
    const f = await worker().post(`/jobs/${ID3}/fail`, { workerId: 'w2', error: 'STT 503 for 998901234567', retryable: true });
    expect(f.status).toBe(200);
    expect(f.body.status).toBe('queued');
    const job = await jobRow(ID3);
    expect(job.lastError).toBe('STT 503 for ***');
    expect(job.notBefore!.getTime()).toBeGreaterThan(Date.now());
    expect((await lease('w1').expect(200)).body.jobs).toEqual([]); // still waiting
    await e2e.db.updateTable('callAnalysisJobs').set({ notBefore: sql<Date>`now() - interval '1 second'` }).where('callId', '=', ID3).execute();
    const again = await lease('w1').expect(200);
    expect(again.body.jobs[0]).toMatchObject({ callId: ID3, attempts: 2 });
    const last = await worker().post(`/jobs/${ID3}/fail`, { workerId: 'w1', error: 'LLM timeout', retryable: true });
    expect(last.body.status).toBe('failed'); // CALL_ANALYSIS_MAX_ATTEMPTS = 2

    const queue = await root.get('/call-analysis/queue').expect(200);
    expect(queue.body.counts).toEqual({ queued: 0, processing: 0, done: 2, failed: 1, skipped: 0 });
    expect(queue.body.recentFailures[0]).toMatchObject({ callId: ID3, lastError: 'LLM timeout' });
    expect(queue.body.workers.map((w: { workerId: string }) => w.workerId).sort()).toEqual(['w1', 'w2', 'w3']);
    expect(queue.body.workerConfigured).toBe(true);

    expect((await root.post('/call-analysis/queue/retry-failed').expect(200)).body).toEqual({ requeued: 1 });
    expect(await jobRow(ID3)).toMatchObject({ status: 'queued', attempts: 0 });
  });

  it('an expired lease goes to another worker; the old holder loses it; exhausted leases fail', async () => {
    expect((await lease('w1').expect(200)).body.jobs[0].callId).toBe(ID3);
    await e2e.db.updateTable('callAnalysisJobs').set({ leaseUntil: sql<Date>`now() - interval '1 second'` }).where('callId', '=', ID3).execute();
    const taken = await lease('w2').expect(200);
    expect(taken.body.jobs[0]).toMatchObject({ callId: ID3, attempts: 2 });
    await worker().post(`/jobs/${ID3}/result`, result({ workerId: 'w1' })).expect(409);
    await e2e.db.updateTable('callAnalysisJobs').set({ leaseUntil: sql<Date>`now() - interval '1 second'` }).where('callId', '=', ID3).execute();
    expect((await lease('w3').expect(200)).body.jobs).toEqual([]);
    expect(await jobRow(ID3)).toMatchObject({ status: 'failed', lastError: 'lease expired' });
  });

  it('skip', async () => {
    await root.post('/call-analysis/queue/retry-failed').expect(200);
    await lease('w1').expect(200);
    await worker().post(`/jobs/${ID3}/skip`, { workerId: 'w1', reason: 'no_speech' }).expect(200);
    expect(await jobRow(ID3)).toMatchObject({ status: 'skipped', skipReason: 'no_speech' });
    const d = await observer.get(`/call-analysis/calls/${ID3}`).expect(200);
    expect(d.body.job).toMatchObject({ status: 'skipped', lastError: 'no_speech' });
    expect(d.body.analysis).toBeNull();
  });
});

describe('reads', () => {
  it('per-call transcript and analysis, with the tickets of the call as ground truth', async () => {
    await sql`insert into tickets (creator_label, origin_call_id) values ('e2e', ${ID1})`.execute(e2e.db);
    const d = await observer.get(`/call-analysis/calls/${ID1}`).expect(200);
    expect(d.body.job).toMatchObject({ status: 'done', attempts: 1 });
    expect(d.body.transcript.segments).toHaveLength(2);
    expect(d.body.transcript.segments[0]).toMatchObject({ role: 'operator', start: 0 });
    expect(d.body.analysis).toMatchObject({
      topicCode: 'eri_key',
      topicName: { ru: 'Ключ ЭЦП (E-imzo), Uzcrypto' },
      outcome: 'ticket_opened',
      overall: 8,
      promptVersion: 'v1-test',
      scores: { greeting: 5, politeness: 4, understanding: 4, solution: 3, closing: 5 },
    });
    expect(d.body.tickets).toHaveLength(1);
    const none = await observer.get('/call-analysis/calls/1700000000.1').expect(200);
    expect(none.body).toMatchObject({ job: null, transcript: null, analysis: null, tickets: [] });
  });

  it('statuses for a history page', async () => {
    const s = await observer.get(`/call-analysis/status?ids=${ID1},${ID3},1700000000.1`).expect(200);
    expect(s.body.items).toHaveLength(2);
    expect(s.body.items.find((i: { callId: string }) => i.callId === ID1)).toMatchObject({
      status: 'done',
      overall: 8,
      topicCode: 'eri_key',
      redFlags: 1,
    });
  });

  it('aggregates for a period and an operator', async () => {
    const s = await executive.get('/call-analysis/stats?from=2026-11-17&to=2026-11-17').expect(200);
    expect(s.body.totals).toMatchObject({
      analyzed: 2,
      avgOverall: 8,
      redFlagCalls: 2,
      ticketClaimed: 2,
      ticketClaimedConfirmed: 1,
      ticketMissed: 0,
    });
    expect(s.body.operators.map((o: { ext: string; name: string | null }) => [o.ext, o.name])).toEqual([
      ['101', 'Aziza'],
      ['103', null],
    ]);
    expect(s.body.topics[0]).toMatchObject({ code: 'eri_key', count: 2 });
    const one = await executive.get('/call-analysis/stats?from=2026-11-17&to=2026-11-17&operator=101').expect(200);
    expect(one.body.totals.analyzed).toBe(1);
    const other = await executive.get('/call-analysis/stats?from=2026-11-16&to=2026-11-16').expect(200);
    expect(other.body.totals.analyzed).toBe(0);
    await executive.get('/call-analysis/stats?from=2026-11-17&to=2026-11-16').expect(400);
  });
});

describe('re-analysis with a new prompt version (llm_only)', () => {
  it('superuser only', async () => {
    for (const c of [operator, observer, executive]) {
      await c.post('/call-analysis/reanalyze', { callIds: [ID1] }).expect(403);
    }
  });

  it('requeues only analysed calls; the worker gets the stored transcript instead of the recording', async () => {
    const r = await root.post('/call-analysis/reanalyze', { callIds: [ID1, ID3] }).expect(200);
    expect(r.body).toEqual({ requeued: 1 }); // ID3 was skipped: nothing to re-score
    expect(await jobRow(ID1)).toMatchObject({ status: 'queued', mode: 'llm_only', attempts: 0 });

    const leased = await lease('w1', 5).expect(200);
    expect(leased.body.jobs).toEqual([expect.objectContaining({ callId: ID1, mode: 'llm_only', attempts: 1 })]);
    const t = await worker().get(`/jobs/${ID1}/transcript?workerId=w1`).expect(200);
    expect(t.body).toMatchObject({ language: 'uz', sttStrategy: 'turns', sttModel: 'whisper-uz', sttMs: 1000, sttRerun: false });
    expect(t.body.segments).toHaveLength(2);
    await worker().get(`/jobs/${ID1}/transcript?workerId=w2`).expect(409);

    const v2 = result({ workerId: 'w1' });
    v2.meta.promptVersion = 'v2-test';
    v2.analysis.overall = 6;
    await worker().post(`/jobs/${ID1}/result`, v2).expect(200);
    const d = await observer.get(`/call-analysis/calls/${ID1}`).expect(200);
    expect(d.body.analysis).toMatchObject({ promptVersion: 'v2-test', overall: 6 });
    expect(d.body.transcript.segments).toHaveLength(2);
  });

  it('a period re-scores every analysed call of it', async () => {
    const r = await root.post('/call-analysis/reanalyze', { from: '2026-11-17', to: '2026-11-17' }).expect(200);
    expect(r.body).toEqual({ requeued: 2 });
    const jobs = (await lease('w1', 5).expect(200)).body.jobs as Array<{ callId: string; mode: string }>;
    expect(jobs.map((j) => [j.callId, j.mode]).sort()).toEqual([[ID1, 'llm_only'], [ID4, 'llm_only']].sort());
  });
});
