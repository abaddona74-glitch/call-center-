import { type ReactNode, createContext, useContext } from 'react';

/**
 * Which API serves shared cards (call details, AI analysis, recordings, ticket card):
 *  - `default`: the regular endpoints, by the session's own permissions;
 *  - `overview`: the overview dashboard's read-only endpoints (`/api/overview/*`, permission `overview.view`) — how an
 *    observer opens the records behind a number without the history, recordings or tickets permissions.
 */
export type ApiScope = 'default' | 'overview';

const ApiScopeContext = createContext<ApiScope>('default');

export function ApiScopeProvider({ scope, children }: { scope: ApiScope; children: ReactNode }) {
  return <ApiScopeContext.Provider value={scope}>{children}</ApiScopeContext.Provider>;
}

export function useApiScope(): ApiScope {
  return useContext(ApiScopeContext);
}
