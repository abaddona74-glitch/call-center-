/**
 * Single-use WebAuthn challenges kept in memory (one API process, like legacy).
 * A challenge is taken (and removed) exactly once; expired or wrong-type entries are rejected.
 */
export type ChallengeEntry =
  | { type: 'registration'; userId: number; name: string; expiresAt: number }
  | { type: 'authentication'; expiresAt: number };

type NewEntry = { type: 'registration'; userId: number; name: string } | { type: 'authentication' };

export class ChallengeStore {
  private readonly entries = new Map<string, ChallengeEntry>();

  constructor(
    private readonly ttlMs = 2 * 60_000,
    private readonly maxEntries = 5_000,
    private readonly now: () => number = Date.now,
  ) {}

  put(challenge: string, entry: NewEntry): void {
    this.sweep();
    if (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.set(challenge, { ...entry, expiresAt: this.now() + this.ttlMs } as ChallengeEntry);
  }

  take<T extends ChallengeEntry['type']>(
    challenge: string | null | undefined,
    type: T,
  ): Extract<ChallengeEntry, { type: T }> | null {
    if (!challenge) return null;
    const entry = this.entries.get(challenge);
    if (!entry) return null;
    this.entries.delete(challenge);
    if (entry.type !== type || entry.expiresAt <= this.now()) return null;
    return entry as Extract<ChallengeEntry, { type: T }>;
  }

  get size(): number {
    return this.entries.size;
  }

  private sweep(): void {
    const now = this.now();
    for (const [k, v] of this.entries) if (v.expiresAt <= now) this.entries.delete(k);
  }
}

/** The challenge the browser signed (from clientDataJSON), or null. */
export function readClientChallenge(clientDataJSON: string): string | null {
  try {
    const data = JSON.parse(Buffer.from(clientDataJSON, 'base64url').toString('utf8')) as { challenge?: unknown };
    return typeof data.challenge === 'string' ? data.challenge : null;
  } catch {
    return null;
  }
}

/**
 * Legacy-compatible user handle: the UTF-8 bytes of the UUID string (not the 16 raw bytes).
 */
export function userHandleFromUuid(uuid: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(Buffer.from(uuid.toLowerCase(), 'utf8'));
}

export function uuidFromUserHandle(handleBase64url: string | undefined): string | null {
  if (!handleBase64url) return null;
  const text = Buffer.from(handleBase64url, 'base64url').toString('utf8').toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(text) ? text : null;
}
