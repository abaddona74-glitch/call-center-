import {
  type AgentDevice,
  AgentDeviceListResponseSchema,
  AgentDeviceSchema,
  AgentReleaseListResponseSchema,
  AgentReleaseSchema,
  AgentStatusListResponseSchema,
  AgentUpdateLogListResponseSchema,
  type CreateAgentDeviceRequest,
  CreateAgentDeviceResponseSchema,
  type CreateAgentReleaseRequest,
} from '@cc/shared';
import { queryOptions } from '@tanstack/react-query';
import { api } from '@/shared/api';

export const agentKeys = {
  all: ['agent'] as const,
  devices: ['agent', 'devices'] as const,
  status: ['agent', 'status'] as const,
  releases: ['agent', 'releases'] as const,
  updateLogs: ['agent', 'update-logs'] as const,
};

export const agentDevicesQuery = queryOptions({
  queryKey: agentKeys.devices,
  queryFn: ({ signal }) => api('/agent/devices', { schema: AgentDeviceListResponseSchema, signal }),
});

export const agentStatusQuery = queryOptions({
  queryKey: agentKeys.status,
  queryFn: ({ signal }) => api('/agent/status', { schema: AgentStatusListResponseSchema, signal }),
  // "online" is derived from the last heartbeat, so refresh it now and then
  refetchInterval: 20_000,
});

export const agentReleasesQuery = queryOptions({
  queryKey: agentKeys.releases,
  queryFn: ({ signal }) => api('/agent/releases', { schema: AgentReleaseListResponseSchema, signal }),
});

export const agentUpdateLogsQuery = queryOptions({
  queryKey: agentKeys.updateLogs,
  queryFn: ({ signal }) => api('/agent/update-logs', { schema: AgentUpdateLogListResponseSchema, signal }),
});

export function createAgentDevice(body: CreateAgentDeviceRequest) {
  return api('/agent/devices', { body, schema: CreateAgentDeviceResponseSchema });
}

export function revokeAgentDevice(id: number): Promise<AgentDevice> {
  return api(`/agent/devices/${id}/revoke`, { method: 'POST', schema: AgentDeviceSchema });
}

export function publishAgentRelease(body: CreateAgentReleaseRequest) {
  return api('/agent/releases', { body, schema: AgentReleaseSchema });
}
