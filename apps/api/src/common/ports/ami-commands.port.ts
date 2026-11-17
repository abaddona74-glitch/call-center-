import { Inject } from '@nestjs/common';

/**
 * Commands other modules may send to Asterisk. Implemented by the AMI module (S3),
 * consumed e.g. by blacklist (S4). Tests use an in-memory fake.
 *
 * Implementations MUST reject values containing CR/LF (AMI header injection) and
 * validate extensions/numbers; callers still validate their own inputs.
 */
export interface AmiCommands {
  readonly connected: boolean;
  /** AstDB put, e.g. dbPut('blacklist', '901234567', '1'). */
  dbPut(family: string, key: string, value: string): Promise<void>;
  dbDel(family: string, key: string): Promise<void>;
  dbGet(family: string, key: string): Promise<string | null>;
  /** Pause/unpause a queue member (interface like `Local/101@from-queue/n`). */
  queuePause(params: { queue?: string; member: string; paused: boolean; reason?: string }): Promise<void>;
}

export const AMI_COMMANDS = Symbol('AMI_COMMANDS');
export const InjectAmiCommands = () => Inject(AMI_COMMANDS);
