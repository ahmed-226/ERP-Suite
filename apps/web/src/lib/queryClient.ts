import { QueryClient } from '@tanstack/react-query';
import { isDataError } from '@/data/errors';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        // Never retry auth or validation failures.
        if (isDataError(error) && error.status < 500) return false;
        return failureCount < 2;
      },
    },
  },
});
