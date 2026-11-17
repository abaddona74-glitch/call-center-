/**
 * Operator groups of the board tabs: "Asosiy" (100–199) and "Zangiota" (200+), as in legacy.
 * TODO(S1): replace with the operator-groups model from the session/users API once merged.
 */
export type OperatorGroup = 'main' | 'secondary';
export type OperatorGroupFilter = OperatorGroup | 'all';

export function operatorGroupOf(extension: string): OperatorGroup {
  const n = Number(extension);
  return n >= 200 ? 'secondary' : 'main';
}

export function inGroup(extension: string, filter: OperatorGroupFilter): boolean {
  return filter === 'all' || operatorGroupOf(extension) === filter;
}
