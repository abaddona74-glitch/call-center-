import type { CdrRow } from '../../src/pbx/calls/cdr-row.js';

/** In-memory stand-in for CdrRepository (same method contracts, fixture rows instead of MariaDB). */
export class FakeCdrRepository {
  readonly enabled = true;
  constructor(
    private readonly rows: CdrRow[],
    private readonly names: { extension: string; name: string | null }[],
  ) {}

  async rowsBetween(fromWall: string, toWall: string): Promise<CdrRow[]> {
    return this.rows.filter((r) => r.calldate >= fromWall && r.calldate < toWall);
  }

  async callRows(id: string, fromWall: string, toWall: string): Promise<CdrRow[]> {
    return (await this.rowsBetween(fromWall, toWall)).filter((r) => r.linkedid === id || r.uniqueid === id);
  }

  async calldateOf(uniqueid: string): Promise<string | null> {
    return this.rows.find((r) => r.uniqueid === uniqueid)?.calldate ?? null;
  }

  async daysWithNumbers(numbers: string[], limit: number): Promise<string[]> {
    const days = new Set(
      this.rows.filter((r) => numbers.includes(r.src) || numbers.includes(r.dst)).map((r) => r.calldate.slice(0, 10)),
    );
    return [...days].sort().reverse().slice(0, limit);
  }

  async operatorNames() {
    return this.names;
  }
}
