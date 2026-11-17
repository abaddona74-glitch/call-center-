import type { AmiCommands } from '../../../common/ports/ami-commands.port.js';

/** In-memory AstDB for tests (and the dev fallback is a disconnected stub, see ami-fallback.ts). */
export class InMemoryAmiCommands implements AmiCommands {
  connected = true;
  /** When set, the next commands fail with this error. */
  failWith: Error | null = null;
  readonly db = new Map<string, string>();
  readonly calls: string[] = [];

  private check(...values: string[]): void {
    if (!this.connected) throw new Error('AMI not connected');
    if (this.failWith) throw this.failWith;
    if (values.some((v) => /[\r\n]/.test(v))) throw new Error('CR/LF not allowed');
  }

  async dbPut(family: string, key: string, value: string): Promise<void> {
    this.check(family, key, value);
    this.calls.push(`put ${family}/${key}=${value}`);
    this.db.set(`${family}/${key}`, value);
  }

  async dbDel(family: string, key: string): Promise<void> {
    this.check(family, key);
    this.calls.push(`del ${family}/${key}`);
    this.db.delete(`${family}/${key}`);
  }

  async dbGet(family: string, key: string): Promise<string | null> {
    this.check(family, key);
    return this.db.get(`${family}/${key}`) ?? null;
  }

  async queuePause(): Promise<void> {
    this.check();
  }

  family(name: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of this.db) if (k.startsWith(`${name}/`)) out[k.slice(name.length + 1)] = v;
    return out;
  }
}
