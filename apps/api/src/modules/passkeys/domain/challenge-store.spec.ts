import { ChallengeStore, readClientChallenge, userHandleFromUuid, uuidFromUserHandle } from './challenge-store.js';

describe('ChallengeStore', () => {
  it('returns an entry once', () => {
    const store = new ChallengeStore();
    store.put('c1', { type: 'registration', userId: 7, name: 'Laptop' });
    expect(store.take('c1', 'registration')).toMatchObject({ userId: 7, name: 'Laptop' });
    expect(store.take('c1', 'registration')).toBeNull();
  });

  it('rejects a challenge used for the wrong ceremony and burns it', () => {
    const store = new ChallengeStore();
    store.put('c2', { type: 'authentication' });
    expect(store.take('c2', 'registration')).toBeNull();
    expect(store.take('c2', 'authentication')).toBeNull();
  });

  it('expires challenges', () => {
    let now = 1_000;
    const store = new ChallengeStore(100, 10, () => now);
    store.put('c3', { type: 'authentication' });
    now = 1_200;
    expect(store.take('c3', 'authentication')).toBeNull();
  });

  it('keeps memory bounded', () => {
    const store = new ChallengeStore(60_000, 3);
    for (let i = 0; i < 10; i++) store.put(`c${i}`, { type: 'authentication' });
    expect(store.size).toBe(3);
    expect(store.take('c9', 'authentication')).not.toBeNull();
    expect(store.take('c0', 'authentication')).toBeNull();
  });
});

describe('webauthn helpers', () => {
  it('reads the challenge from clientDataJSON', () => {
    const json = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge: 'abc' })).toString('base64url');
    expect(readClientChallenge(json)).toBe('abc');
    expect(readClientChallenge('%%%')).toBeNull();
  });

  it('encodes the user handle like legacy (UTF-8 of the UUID string)', () => {
    const uuid = '6f1c2a0e-3b7d-4c55-9a1e-0f6c2d9b8a71';
    const handle = userHandleFromUuid(uuid);
    expect(handle.length).toBe(36);
    expect(Buffer.from(handle).toString('utf8')).toBe(uuid);
    expect(uuidFromUserHandle(Buffer.from(handle).toString('base64url'))).toBe(uuid);
    expect(uuidFromUserHandle(Buffer.from('not-a-uuid').toString('base64url'))).toBeNull();
    expect(uuidFromUserHandle(undefined)).toBeNull();
  });
});
