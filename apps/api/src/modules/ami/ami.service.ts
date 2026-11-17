import type { AmiStatus } from '@cc/shared';
import {
  BadGatewayException,
  BadRequestException,
  GatewayTimeoutException,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { AmiCommands } from '../../common/ports/ami-commands.port.js';
import { AppConfig } from '../../config/app-config.js';
import { AmiClient, AmiError, type ActionOptions, type AmiResponse } from './ami.client.js';
import { AmiHeaderInjectionError, type AmiFieldValue, type AmiMessage, assertSafeAmiValue } from './ami.protocol.js';

const ASTDB_FAMILY = /^[A-Za-z0-9_-]{1,64}$/;
const ASTDB_KEY = /^[A-Za-z0-9_.+-]{1,64}$/;
const QUEUE_NAME = /^[A-Za-z0-9_-]{1,64}$/;
const INTERFACE = /^(Local|SIP|PJSIP|IAX2)\/[A-Za-z0-9_.@/-]{1,80}$/;
/** Real channel names: "SIP/101-0000002a", "Local/101@from-queue-00000003;1". */
const CHANNEL = /^[A-Za-z0-9]+\/[A-Za-z0-9_.@+-]{1,80}(;[12])?$/;
const EXTEN = /^[0-9*#+]{1,32}$/;
const CONTEXT = /^[A-Za-z0-9_-]{1,64}$/;

type Listener<T extends unknown[]> = (...args: T) => void;

/**
 * Nest wrapper around AmiClient: lifecycle from config, typed commands with input validation,
 * mapping of AMI failures to HTTP errors. Provides the `AMI_COMMANDS` port (see ami.module.ts).
 *
 * When AMI_* is not configured the service stays `disabled` and every command answers 503.
 */
@Injectable()
export class AmiService implements AmiCommands, OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(AmiService.name);
  private readonly client: AmiClient | null;
  private readonly eventListeners = new Set<Listener<[AmiMessage]>>();
  private readonly stateListeners = new Set<Listener<[AmiStatus]>>();

  constructor(private readonly config: AppConfig) {
    if (!config.amiEnabled) {
      this.client = null;
      return;
    }
    this.client = new AmiClient({
      host: config.get('AMI_HOST')!,
      port: config.get('AMI_PORT'),
      username: config.get('AMI_USER')!,
      secret: config.get('AMI_PASSWORD')!,
      pingIntervalMs: config.get('AMI_PING_INTERVAL_SEC') * 1000,
      log: (level, message) => this.logger[level](message),
    });
    this.client.on('event', (evt) => {
      for (const l of this.eventListeners) {
        try {
          l(evt);
        } catch (err) {
          this.logger.error(`AMI event listener failed on ${evt.event}: ${(err as Error).stack ?? String(err)}`);
        }
      }
    });
    this.client.on('state', (state) => {
      if (state === 'connected')
        this.logger.log(`AMI connected to ${config.get('AMI_HOST')}:${config.get('AMI_PORT')}`);
      const status = this.status();
      for (const l of this.stateListeners) l(status);
    });
  }

  onApplicationBootstrap(): void {
    if (!this.client) {
      this.logger.warn('AMI_* not configured — live telephony and call actions are disabled');
      return;
    }
    this.client.start();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.client?.stop();
  }

  get enabled(): boolean {
    return this.client !== null;
  }

  get connected(): boolean {
    return this.client?.connected ?? false;
  }

  status(): AmiStatus {
    if (!this.client) return { enabled: false, state: 'disabled', since: null, lastError: null };
    return {
      enabled: true,
      state: this.client.state,
      since: this.client.since?.toISOString() ?? null,
      lastError: this.client.state === 'connected' ? null : this.client.lastError,
    };
  }

  /** Unsolicited AMI events (not the ones returned by list actions). Returns an unsubscribe function. */
  onEvent(listener: Listener<[AmiMessage]>): () => void {
    this.eventListeners.add(listener);
    return () => this.eventListeners.delete(listener);
  }

  onStatus(listener: Listener<[AmiStatus]>): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  // --- AmiCommands port -----------------------------------------------------------------------

  async dbPut(family: string, key: string, value: string): Promise<void> {
    this.check(ASTDB_FAMILY, 'family', family);
    this.check(ASTDB_KEY, 'key', key);
    this.safe('value', value, 255);
    await this.send('DBPut', { Family: family, Key: key, Val: value });
  }

  async dbDel(family: string, key: string): Promise<void> {
    this.check(ASTDB_FAMILY, 'family', family);
    this.check(ASTDB_KEY, 'key', key);
    try {
      await this.send('DBDel', { Family: family, Key: key });
    } catch (err) {
      // Deleting a missing key is not an error for callers.
      if (err instanceof BadGatewayException && /not found|failed to delete/i.test(err.message)) return;
      throw err;
    }
  }

  async dbGet(family: string, key: string): Promise<string | null> {
    this.check(ASTDB_FAMILY, 'family', family);
    this.check(ASTDB_KEY, 'key', key);
    try {
      const res = await this.send(
        'DBGet',
        { Family: family, Key: key },
        // Asterisk 13+ ends the list with DBGetComplete; older versions send only DBGetResponse.
        { list: true, until: (e) => e.event === 'DBGetResponse' || e.event === 'DBGetComplete' },
      );
      const hit = res.events.find((e) => e.event === 'DBGetResponse');
      return hit?.val ?? null;
    } catch (err) {
      if (err instanceof BadGatewayException && /not found/i.test(err.message)) return null;
      throw err;
    }
  }

  async queuePause(params: { queue?: string; member: string; paused: boolean; reason?: string }): Promise<void> {
    this.check(INTERFACE, 'member', params.member);
    if (params.queue !== undefined) this.check(QUEUE_NAME, 'queue', params.queue);
    if (params.reason !== undefined) this.safe('reason', params.reason, 64);
    await this.send('QueuePause', {
      Interface: params.member,
      Paused: params.paused,
      Queue: params.queue,
      Reason: params.reason,
    });
  }

  // --- Telephony helpers ----------------------------------------------------------------------

  async redirect(params: { channel: string; exten: string; context: string; priority?: number }): Promise<void> {
    this.check(CHANNEL, 'channel', params.channel);
    this.check(EXTEN, 'exten', params.exten);
    this.check(CONTEXT, 'context', params.context);
    await this.send('Redirect', {
      Channel: params.channel,
      Exten: params.exten,
      Context: params.context,
      Priority: params.priority ?? 1,
    });
  }

  /**
   * Async originate (B38: the HTTP request must not wait for the operator to pick up).
   * `channel` is the operator phone (e.g. "SIP/101"); after it answers it is connected to `exten`.
   */
  async originate(params: {
    channel: string;
    exten: string;
    context: string;
    callerId?: string;
    timeoutMs?: number;
  }): Promise<void> {
    this.check(INTERFACE, 'channel', params.channel);
    this.check(EXTEN, 'exten', params.exten);
    this.check(CONTEXT, 'context', params.context);
    if (params.callerId !== undefined) this.safe('callerId', params.callerId, 80);
    await this.send('Originate', {
      Channel: params.channel,
      Exten: params.exten,
      Context: params.context,
      Priority: 1,
      CallerID: params.callerId,
      Timeout: params.timeoutMs ?? 30_000,
      Async: true,
    });
  }

  async hangup(channel: string, cause = 16): Promise<void> {
    this.check(CHANNEL, 'channel', channel);
    await this.send('Hangup', { Channel: channel, Cause: cause });
  }

  async coreShowChannels(): Promise<AmiMessage[]> {
    return (await this.send('CoreShowChannels', {}, { list: true, timeoutMs: 15_000 })).events;
  }

  /** QueueParams + QueueMember + QueueEntry events of all (or one) queue. */
  async queueStatus(queue?: string): Promise<AmiMessage[]> {
    if (queue !== undefined) this.check(QUEUE_NAME, 'queue', queue);
    return (await this.send('QueueStatus', { Queue: queue }, { list: true, timeoutMs: 15_000 })).events;
  }

  /** chan_sip peers (`PeerEntry`) or PJSIP endpoints (`EndpointList`), depending on AMI_CHANNEL_TECH. */
  async peers(): Promise<AmiMessage[]> {
    const action = this.config.get('AMI_CHANNEL_TECH') === 'PJSIP' ? 'PJSIPShowEndpoints' : 'SIPpeers';
    return (await this.send(action, {}, { list: true, timeoutMs: 15_000 })).events;
  }

  // --- internals ------------------------------------------------------------------------------

  private async send(
    action: string,
    fields: Record<string, AmiFieldValue>,
    opts?: ActionOptions,
  ): Promise<AmiResponse> {
    if (!this.client) throw new ServiceUnavailableException('AMI is not configured');
    if (!this.client.connected) throw new ServiceUnavailableException('AMI is not connected');
    try {
      return await this.client.action(action, fields, opts);
    } catch (err) {
      if (err instanceof AmiHeaderInjectionError) throw new BadRequestException(err.message);
      if (err instanceof AmiError) {
        if (err.kind === 'timeout') throw new GatewayTimeoutException(`AMI ${action} timed out`);
        if (err.kind === 'disconnected') throw new ServiceUnavailableException('AMI is not connected');
        throw new BadGatewayException(`AMI ${action} failed: ${err.message}`);
      }
      throw err;
    }
  }

  private check(re: RegExp, field: string, value: string): void {
    if (!re.test(value)) throw new BadRequestException(`Invalid AMI ${field}`);
  }

  private safe(field: string, value: string, max: number): void {
    try {
      assertSafeAmiValue(field, value);
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }
    if (value.length > max) throw new BadRequestException(`AMI ${field} is too long`);
  }
}
