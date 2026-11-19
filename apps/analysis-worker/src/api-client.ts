import {
  type SkipReason,
  type WorkerAck,
  WorkerAckSchema,
  type WorkerLeaseResponse,
  WorkerLeaseResponseSchema,
  type WorkerResult,
  type WorkerTranscript,
  WorkerTranscriptSchema,
} from '@cc/shared';
import { ServiceError } from './stt/stt-client.js';

/** The posted result is read by the API as this type (it can exceed the API's 100 KB JSON limit). */
export const RESULT_CONTENT_TYPE = 'application/vnd.cc.analysis-result+json';
const MAX_RECORDING_BYTES = 100 * 1024 * 1024;

export interface ApiClient {
  lease(limit: number, leaseSec: number): Promise<WorkerLeaseResponse>;
  recording(callId: string): Promise<Buffer>;
  /** Stored transcript of a leased `llm_only` job. */
  transcript(callId: string): Promise<WorkerTranscript>;
  submit(callId: string, result: WorkerResult): Promise<WorkerAck>;
  fail(callId: string, error: string, retryable: boolean): Promise<WorkerAck>;
  skip(callId: string, reason: SkipReason): Promise<WorkerAck>;
}

/** The call-center API, worker side (service token). */
export class HttpApiClient implements ApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly workerId: string,
  ) {}

  private async request(path: string, init: RequestInit & { timeoutMs?: number }): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/api/call-analysis/worker${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${this.token}`, ...init.headers },
        signal: AbortSignal.timeout(init.timeoutMs ?? 60_000),
      });
    } catch (err) {
      throw new ServiceError('api', `${path.split('/')[1] ?? path} request failed (${(err as Error).name})`, true);
    }
    if (!res.ok) {
      const kind = path.split('/').at(-1);
      throw new ServiceError('api', `${kind} HTTP ${res.status}`, res.status >= 500 || res.status === 429, res.status);
    }
    return res;
  }

  private json(body: unknown, contentType = 'application/json'): RequestInit {
    return { method: 'POST', headers: { 'Content-Type': contentType }, body: JSON.stringify(body) };
  }

  async lease(limit: number, leaseSec: number): Promise<WorkerLeaseResponse> {
    const res = await this.request('/lease', this.json({ workerId: this.workerId, limit, leaseSec }));
    return WorkerLeaseResponseSchema.parse(await res.json());
  }

  async recording(callId: string): Promise<Buffer> {
    const q = new URLSearchParams({ workerId: this.workerId });
    const res = await this.request(`/jobs/${encodeURIComponent(callId)}/recording?${q}`, {
      method: 'GET',
      timeoutMs: 300_000,
    });
    const size = Number(res.headers.get('content-length') ?? 0);
    if (size > MAX_RECORDING_BYTES) throw new ServiceError('api', 'recording is larger than 100 MiB', false);
    return Buffer.from(await res.arrayBuffer());
  }

  async transcript(callId: string): Promise<WorkerTranscript> {
    const q = new URLSearchParams({ workerId: this.workerId });
    const res = await this.request(`/jobs/${encodeURIComponent(callId)}/transcript?${q}`, { method: 'GET' });
    return WorkerTranscriptSchema.parse(await res.json());
  }

  async submit(callId: string, result: WorkerResult): Promise<WorkerAck> {
    const res = await this.request(
      `/jobs/${encodeURIComponent(callId)}/result`,
      this.json(result, RESULT_CONTENT_TYPE),
    );
    return WorkerAckSchema.parse(await res.json());
  }

  async fail(callId: string, error: string, retryable: boolean): Promise<WorkerAck> {
    const res = await this.request(
      `/jobs/${encodeURIComponent(callId)}/fail`,
      this.json({ workerId: this.workerId, error: error.slice(0, 500), retryable }),
    );
    return WorkerAckSchema.parse(await res.json());
  }

  async skip(callId: string, reason: SkipReason): Promise<WorkerAck> {
    const res = await this.request(
      `/jobs/${encodeURIComponent(callId)}/skip`,
      this.json({ workerId: this.workerId, reason }),
    );
    return WorkerAckSchema.parse(await res.json());
  }
}
