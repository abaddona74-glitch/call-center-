import { type ExcludedOperatorsInput, ExcludedOperatorsSchema } from '@cc/shared';
import { queryOptions } from '@tanstack/react-query';
import { api } from '@/shared/api';

export const excludedOperatorsKeys = {
  all: ['excluded-operators'] as const,
};

/** The list with the PBX directory (settings screen only: the server filters everything else). */
export const excludedOperatorsQuery = queryOptions({
  queryKey: excludedOperatorsKeys.all,
  queryFn: ({ signal }) => api('/excluded-operators', { schema: ExcludedOperatorsSchema, signal }),
  staleTime: 60_000,
});

export function saveExcludedOperators(body: ExcludedOperatorsInput) {
  return api('/excluded-operators', { method: 'PUT', body, schema: ExcludedOperatorsSchema });
}
