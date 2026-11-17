import type { AgentStatus, AgentUpdateLog } from '../agent.js';

/**
 * Server → client events of the 3CX desktop agent module (admin only). Kept apart from the callbacks
 * events so the agent can be removed in one step (owner decision pending: the agent duplicates PBX data).
 */
export interface AgentServerEvents {
  /** An agent came online / went offline / reported a new version. */
  'agents.status': AgentStatus;
  /** An agent reported an OTA update step. */
  'agents.updateLog': AgentUpdateLog;
}
