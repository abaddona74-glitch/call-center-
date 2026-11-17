import type { AmiCommands } from '../../common/ports/ami-commands.port.js';

/**
 * Used when no AMI implementation is registered (AMI module absent or not configured):
 * reports "not connected", so changes stay pending until AMI is available.
 */
export class DisconnectedAmiCommands implements AmiCommands {
  readonly connected = false;
  async dbPut(): Promise<void> {
    throw new Error('AMI is not available');
  }
  async dbDel(): Promise<void> {
    throw new Error('AMI is not available');
  }
  async dbGet(): Promise<string | null> {
    throw new Error('AMI is not available');
  }
  async queuePause(): Promise<void> {
    throw new Error('AMI is not available');
  }
}
