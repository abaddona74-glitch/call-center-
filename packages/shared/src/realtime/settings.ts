/**
 * Server → client events of system settings (session S11).
 * No data: the server already filters what it sends, clients only refetch over REST.
 */
export interface SettingsServerEvents {
  /** The excluded operators list changed: refetch per-operator statistics (the live board is re-pushed). */
  'excludedOperators.changed': { at: string };
}
