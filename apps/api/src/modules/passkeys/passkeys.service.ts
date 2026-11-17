import type { Passkey, SessionUser, WebAuthnOptionsJSON } from '@cc/shared';
import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { AppConfig } from '../../config/app-config.js';
import { AuditService } from '../audit/audit.service.js';
import { AuthRepository } from '../auth/auth.repository.js';
import { AuthService, type LoginResult, type RequestMeta } from '../auth/auth.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { ChallengeStore, readClientChallenge, userHandleFromUuid, uuidFromUserHandle } from './domain/challenge-store.js';
import { FailTracker } from './domain/fail-tracker.js';
import { type PasskeyRow, PasskeysRepository, toPasskeyDto } from './passkeys.repository.js';

export const MAX_PASSKEYS_PER_USER = 10;
const LOGIN_FAILED = 'Passkey sign-in failed';

/**
 * WebAuthn registration and passwordless login (@simplewebauthn/server v14).
 * Storage and user handles are compatible with legacy webauthnService.js, so imported
 * passkeys keep working as long as WEBAUTHN_RP_ID stays the same.
 */
@Injectable()
export class PasskeysService {
  private readonly logger = new Logger(PasskeysService.name);
  private readonly challenges = new ChallengeStore();
  /** Wrong signatures per credential: 5 per minute. */
  private readonly credentialFails = new FailTracker(5, 60_000);

  constructor(
    private readonly config: AppConfig,
    private readonly repo: PasskeysRepository,
    private readonly authRepo: AuthRepository,
    private readonly auth: AuthService,
    private readonly realtime: RealtimeService,
    private readonly audit: AuditService,
  ) {}

  private get rp(): { id: string; name: string; origins: string[] } {
    const id = this.config.get('WEBAUTHN_RP_ID');
    const origins = this.config.get('WEBAUTHN_ORIGINS');
    if (!id || origins.length === 0) throw new ServiceUnavailableException('Passkeys are not configured');
    return { id, name: this.config.get('WEBAUTHN_RP_NAME'), origins };
  }

  async list(userId: number): Promise<Passkey[]> {
    return (await this.repo.listByUser(userId)).map(toPasskeyDto);
  }

  // --- registration (logged in, password re-check) ---------------------------------------

  async registrationOptions(user: SessionUser, password: string, name: string, ip: string | undefined): Promise<WebAuthnOptionsJSON> {
    const rp = this.rp;
    const account = await this.auth.verifyCurrentPassword(user.id, password, ip);
    const existing = await this.repo.listByUser(user.id);
    if (existing.length >= MAX_PASSKEYS_PER_USER) {
      throw new BadRequestException(`At most ${MAX_PASSKEYS_PER_USER} passkeys per account`);
    }
    const labels = account.extension
      ? { userName: `${account.extension} · ${account.username}`, displayName: `Operator ${account.extension} (${account.username})` }
      : { userName: account.username, displayName: account.username };

    const options = await generateRegistrationOptions({
      rpName: rp.name,
      rpID: rp.id,
      userID: userHandleFromUuid(account.webauthnUserId),
      userName: labels.userName,
      userDisplayName: labels.displayName,
      attestationType: 'none',
      excludeCredentials: existing.map((pk) => ({ id: pk.id, transports: pk.transports ?? undefined })),
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    });
    this.challenges.put(options.challenge, { type: 'registration', userId: user.id, name });
    return options as unknown as WebAuthnOptionsJSON;
  }

  async registrationVerify(user: SessionUser, credential: unknown): Promise<Passkey> {
    const rp = this.rp;
    const response = credential as RegistrationResponseJSON;
    const challenge = readClientChallenge(response.response.clientDataJSON);
    const pending = this.challenges.take(challenge, 'registration');
    if (!pending || pending.userId !== user.id || !challenge) {
      throw new BadRequestException('The registration request expired. Try again');
    }

    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response,
        expectedChallenge: challenge,
        expectedOrigin: rp.origins,
        expectedRPID: rp.id,
        requireUserVerification: true,
      });
    } catch (err) {
      this.logger.warn(`passkey registration rejected: ${err instanceof Error ? err.message : String(err)}`);
      throw new BadRequestException('The passkey could not be verified');
    }
    if (!verification.verified) throw new BadRequestException('The passkey could not be verified');

    const { credential: cred, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
    if (await this.repo.findById(cred.id)) throw new ConflictException('This passkey is already registered');
    if ((await this.repo.countByUser(user.id)) >= MAX_PASSKEYS_PER_USER) {
      throw new BadRequestException(`At most ${MAX_PASSKEYS_PER_USER} passkeys per account`);
    }

    await this.repo.insert({
      id: cred.id,
      userId: user.id,
      publicKey: Buffer.from(cred.publicKey),
      counter: cred.counter ?? 0,
      deviceType: credentialDeviceType ?? null,
      backedUp: Boolean(credentialBackedUp),
      transports: cred.transports?.length ? [...cred.transports] : null,
      name: pending.name,
    });
    await this.audit.record('passkeys.register', { target: `user:${user.id}`, details: { name: pending.name } });
    return toPasskeyDto((await this.repo.findById(cred.id))!);
  }

  // --- own passkeys -----------------------------------------------------------------------

  async rename(userId: number, id: string, name: string): Promise<Passkey> {
    const pk = await this.ownPasskey(userId, id);
    await this.repo.rename(pk.id, name);
    await this.audit.record('passkeys.rename', { target: `user:${userId}`, details: { from: pk.name, to: name } });
    return toPasskeyDto((await this.repo.findById(pk.id))!);
  }

  async remove(userId: number, id: string, reason: 'owner' | 'admin'): Promise<void> {
    const pk = await this.ownPasskey(userId, id);
    const sessionIds = await this.repo.delete(pk.id);
    for (const sessionId of sessionIds) this.realtime.terminate({ sessionId }, 'passkey_deleted');
    await this.audit.record(reason === 'admin' ? 'passkeys.delete_by_admin' : 'passkeys.delete', {
      target: `user:${userId}`,
      details: { name: pk.name, endedSessions: sessionIds.length },
    });
  }

  // --- passwordless login (anonymous) ------------------------------------------------------

  async loginOptions(): Promise<WebAuthnOptionsJSON> {
    const rp = this.rp;
    const options = await generateAuthenticationOptions({
      rpID: rp.id,
      userVerification: 'required',
      // discoverable credentials: the device shows its own account picker
      allowCredentials: [],
    });
    this.challenges.put(options.challenge, { type: 'authentication' });
    return options as unknown as WebAuthnOptionsJSON;
  }

  async loginVerify(credential: unknown, meta: RequestMeta): Promise<LoginResult> {
    const rp = this.rp;
    const response = credential as AuthenticationResponseJSON;
    const challenge = readClientChallenge(response.response.clientDataJSON);
    if (!challenge || !this.challenges.take(challenge, 'authentication')) {
      throw new UnauthorizedException('The sign-in request expired. Try again');
    }

    const pk = await this.repo.findById(response.id);
    if (!pk) throw new UnauthorizedException(LOGIN_FAILED);
    if (this.credentialFails.isBlocked(pk.id)) {
      throw new HttpException('Too many attempts. Try again later', HttpStatus.TOO_MANY_REQUESTS);
    }
    const fail = (): never => {
      this.credentialFails.fail(pk.id);
      throw new UnauthorizedException(LOGIN_FAILED);
    };

    const user = await this.authRepo.findById(pk.userId);
    const handle = uuidFromUserHandle(response.response.userHandle);
    if (!user || !user.isActive || !handle || handle !== user.webauthnUserId.toLowerCase()) return fail();

    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge: challenge,
        expectedOrigin: rp.origins,
        expectedRPID: rp.id,
        credential: {
          id: pk.id,
          publicKey: new Uint8Array(pk.publicKey),
          counter: pk.counter,
          transports: (pk.transports ?? undefined) as RegistrationResponseJSON['response']['transports'],
        },
        requireUserVerification: true,
      });
    } catch (err) {
      this.logger.warn(`passkey login rejected: ${err instanceof Error ? err.message : String(err)}`);
      return fail();
    }
    if (!verification.verified) return fail();

    this.credentialFails.reset(pk.id);
    await this.repo.touch(pk.id, verification.authenticationInfo.newCounter);
    return this.auth.startSession(user, meta, pk.id);
  }

  private async ownPasskey(userId: number, id: string): Promise<PasskeyRow> {
    const pk = await this.repo.findById(id);
    // Another user's passkey looks exactly like a missing one.
    if (!pk || pk.userId !== userId) throw new NotFoundException('Passkey not found');
    return pk;
  }
}
