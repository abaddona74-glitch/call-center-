import { QueryClient } from '@tanstack/react-query';
import { isHttpError } from './http';

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 15_000,
        refetchOnWindowFocus: false,
        // Don't retry auth/permission/validation errors.
        retry: (count, err) => !(isHttpError(err) && err.status < 500) && count < 2,
      },
      mutations: { retry: false },
    },
  });
}
