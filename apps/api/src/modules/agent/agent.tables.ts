import type { AgentAuthMode, AgentEventType, AgentUpdateStep } from '@cc/shared';
import type { Generated } from 'kysely';

export interface AgentDevicesTable {
  id: Generated<number>;
  name: string;
  extension: string;
  keyHash: string;
  keyPrefix: string;
  createdAt: Generated<Date>;
  createdByUserId: number | null;
  createdByLabel: string | null;
  revokedAt: Date | null;
  revokedByLabel: string | null;
  lastSeenAt: Date | null;
  lastIp: string | null;
  hostname: string | null;
  appVersion: string | null;
}

export interface AgentStatusTable {
  extension: string;
  deviceId: number | null;
  authMode: AgentAuthMode;
  hostname: string | null;
  appVersion: string | null;
  ip: string | null;
  lastSeenAt: Date;
}

export interface AgentCallEventsTable {
  id: Generated<number>;
  deviceId: number | null;
  authMode: AgentAuthMode;
  extension: string;
  eventType: AgentEventType;
  rawEventType: string;
  callerId: Generated<string>;
  phone: string | null;
  durationSec: Generated<number>;
  startedAt: Date | null;
  endedAt: Date | null;
  rawStartTime: Generated<string>;
  eventAt: Date;
  hostname: string | null;
  details: Generated<string>;
  ip: string | null;
  receivedAt: Generated<Date>;
}

export interface AgentReleasesTable {
  id: Generated<number>;
  version: string;
  releaseNotes: Generated<string>;
  minVersion: string | null;
  updateUrl: string;
  createdAt: Generated<Date>;
  createdByUserId: number | null;
  createdByLabel: string | null;
}

export interface AgentUpdateLogsTable {
  id: Generated<number>;
  at: Generated<Date>;
  extension: string;
  deviceId: number | null;
  hostname: string | null;
  version: string | null;
  targetVersion: string | null;
  step: AgentUpdateStep;
  message: Generated<string>;
}

declare module '../../database/db.js' {
  interface DB {
    agentDevices: AgentDevicesTable;
    agentStatus: AgentStatusTable;
    agentCallEvents: AgentCallEventsTable;
    agentReleases: AgentReleasesTable;
    agentUpdateLogs: AgentUpdateLogsTable;
  }
}
