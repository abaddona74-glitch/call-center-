import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import type { AppConfig } from '../../config/app-config.js';

/** A worker that never answers (stands in for a stuck conversion). */
class SilentWorker extends EventEmitter {
  static created: SilentWorker[] = [];
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  terminated = false;
  constructor(
    readonly url: URL,
    readonly options: { resourceLimits?: { maxOldGenerationSizeMb?: number }; env?: object },
  ) {
    super();
    SilentWorker.created.push(this);
  }
  postMessage(): void {}
  terminate(): Promise<number> {
    this.terminated = true;
    return Promise.resolve(1);
  }
}

vi.mock('node:worker_threads', () => ({ Worker: SilentWorker }));

const { ConverterService } = await import('./converter.service.js');

const config = {
  get: (k: string) => ({ TOOLS_CONVERT_TIMEOUT_SEC: 5, TOOLS_CONVERT_CONCURRENCY: 1, TOOLS_CONVERT_MEMORY_MB: 256 })[k],
} as unknown as AppConfig;
const txt = (name = 'a.txt') => ({ originalname: name, size: 5, buffer: Buffer.from('salom') });

describe('ConverterService limits', () => {
  beforeEach(() => {
    SilentWorker.created = [];
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('runs each conversion in a worker with a heap limit and no environment', async () => {
    const svc = new ConverterService(config);
    const pending = svc.convert(txt(), 'pdf').catch((e: unknown) => e);
    const w = SilentWorker.created[0];
    expect(w.options.resourceLimits?.maxOldGenerationSizeMb).toBe(256);
    expect(w.options.env).toEqual({});
    vi.advanceTimersByTime(5_000);
    expect(await pending).toMatchObject({ status: 422 });
    expect(w.terminated).toBe(true);
  });

  it('answers 503 when all converter slots are busy, and frees the slot afterwards', async () => {
    const svc = new ConverterService(config);
    const first = svc.convert(txt(), 'pdf').catch((e: unknown) => e);
    await expect(svc.convert(txt(), 'pdf')).rejects.toMatchObject({ status: 503 });
    vi.advanceTimersByTime(5_000);
    await first;
    const again = svc.convert(txt(), 'docx').catch((e: unknown) => e);
    expect(SilentWorker.created).toHaveLength(2);
    vi.advanceTimersByTime(5_000);
    await again;
  });

  it('maps an out-of-memory worker to 422 and terminates everything on shutdown', async () => {
    const svc = new ConverterService(config);
    const pending = svc.convert(txt(), 'pdf').catch((e: unknown) => e);
    SilentWorker.created[0].emit('error', Object.assign(new Error('oom'), { code: 'ERR_WORKER_OUT_OF_MEMORY' }));
    expect(await pending).toMatchObject({ status: 422 });

    void svc.convert(txt(), 'pdf').catch(() => undefined);
    svc.onModuleDestroy();
    expect(SilentWorker.created[1].terminated).toBe(true);
  });

  it('rejects before starting a worker: no file, wrong type, wrong pair, fake content', async () => {
    const svc = new ConverterService(config);
    await expect(svc.convert(undefined, 'pdf')).rejects.toMatchObject({ status: 400 });
    await expect(svc.convert(txt('photo.png'), 'pdf')).rejects.toMatchObject({ status: 415 });
    await expect(svc.convert(txt('a.txt'), 'txt')).rejects.toMatchObject({ status: 400 });
    await expect(svc.convert(txt('a.pdf'), 'txt')).rejects.toMatchObject({ status: 415 });
    expect(SilentWorker.created).toHaveLength(0);
  });
});
