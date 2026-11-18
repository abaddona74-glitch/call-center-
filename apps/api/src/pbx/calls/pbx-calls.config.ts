import type { AppConfig } from '../../config/app-config.js';
import type { PbxDialplan } from './dialplan.js';

export interface OperatorGroup {
  id: string;
  from: number;
  to: number;
}

/** Dialplan conventions from PBX_* configuration (defaults = production Issabel). */
export function dialplanFromConfig(config: AppConfig): PbxDialplan {
  return {
    trunkPeers: config.get('PBX_TRUNK_PEERS'),
    serviceNumbers: config.get('PBX_SERVICE_NUMBERS'),
    inboundContexts: config.get('PBX_INBOUND_CONTEXTS'),
    queueContexts: config.get('PBX_QUEUE_CONTEXTS'),
    internalContext: 'from-internal',
    transferContext: 'from-internal-xfer',
    queueMemberContext: 'from-queue',
    offHoursMarkers: config.get('PBX_OFF_HOURS_MARKERS'),
    extensionPattern: new RegExp(config.get('PBX_EXTENSION_PATTERN')),
    dialPrefixes: config.get('PBX_DIAL_PREFIXES'),
  };
}

export function groupOf(ext: string, groups: readonly OperatorGroup[]): string | null {
  const n = Number(ext);
  if (!Number.isInteger(n)) return null;
  return groups.find((g) => n >= g.from && n <= g.to)?.id ?? null;
}
