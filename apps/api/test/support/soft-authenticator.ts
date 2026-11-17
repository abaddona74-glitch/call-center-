import { createHash, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { isoCBOR } from '@simplewebauthn/server/helpers';

const b64url = (b: Uint8Array | Buffer) => Buffer.from(b).toString('base64url');
const sha256 = (b: Uint8Array | Buffer | string) => createHash('sha256').update(b).digest();

/**
 * Minimal software passkey (ES256, "none" attestation, discoverable) for e2e tests.
 * Produces the same JSON a browser gives to @simplewebauthn/browser.
 */
export class SoftAuthenticator {
  private readonly keys = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  readonly credentialId = randomBytes(16);
  counter = 0;
  /** base64url user handle given at registration (returned on login). */
  userHandle: string | null = null;

  constructor(
    readonly rpId: string,
    readonly origin: string,
  ) {}

  get id(): string {
    return b64url(this.credentialId);
  }

  cosePublicKey(): Uint8Array {
    const jwk = this.keys.publicKey.export({ format: 'jwk' });
    const cose = new Map<number, number | Uint8Array>([
      [1, 2], // kty: EC2
      [3, -7], // alg: ES256
      [-1, 1], // crv: P-256
      [-2, new Uint8Array(Buffer.from(jwk.x!, 'base64url'))],
      [-3, new Uint8Array(Buffer.from(jwk.y!, 'base64url'))],
    ]);
    return isoCBOR.encode(cose);
  }

  private authData(flags: number, attested?: Buffer): Buffer {
    const counter = Buffer.alloc(4);
    counter.writeUInt32BE(this.counter);
    return Buffer.concat([sha256(this.rpId), Buffer.from([flags]), counter, ...(attested ? [attested] : [])]);
  }

  register(options: { challenge: string; user: { id: string } }, origin = this.origin) {
    this.userHandle = options.user.id;
    const clientDataJSON = Buffer.from(
      JSON.stringify({ type: 'webauthn.create', challenge: options.challenge, origin, crossOrigin: false }),
    );
    const idLen = Buffer.alloc(2);
    idLen.writeUInt16BE(this.credentialId.length);
    const attested = Buffer.concat([Buffer.alloc(16), idLen, this.credentialId, Buffer.from(this.cosePublicKey())]);
    // UP | UV | AT
    const authData = this.authData(0x01 | 0x04 | 0x40, attested);
    const attestation = new Map<string, string | Uint8Array | Map<string, string>>();
    attestation.set('fmt', 'none');
    attestation.set('attStmt', new Map<string, string>());
    attestation.set('authData', new Uint8Array(authData));
    const attestationObject = isoCBOR.encode(attestation);
    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key' as const,
      response: {
        clientDataJSON: b64url(clientDataJSON),
        attestationObject: b64url(attestationObject),
        transports: ['internal'],
      },
      clientExtensionResults: {},
      authenticatorAttachment: 'platform',
    };
  }

  authenticate(options: { challenge: string }, overrides: { userHandle?: string | null; origin?: string } = {}) {
    this.counter += 1;
    const clientDataJSON = Buffer.from(
      JSON.stringify({ type: 'webauthn.get', challenge: options.challenge, origin: overrides.origin ?? this.origin }),
    );
    const authData = this.authData(0x01 | 0x04);
    const signature = sign('sha256', Buffer.concat([authData, sha256(clientDataJSON)]), this.keys.privateKey);
    const userHandle = overrides.userHandle === undefined ? this.userHandle : overrides.userHandle;
    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key' as const,
      response: {
        clientDataJSON: b64url(clientDataJSON),
        authenticatorData: b64url(authData),
        signature: b64url(signature),
        ...(userHandle ? { userHandle } : {}),
      },
      clientExtensionResults: {},
      authenticatorAttachment: 'platform',
    };
  }
}
