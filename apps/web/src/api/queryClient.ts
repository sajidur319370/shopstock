import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { ApiError } from './client';
import { qk } from './keys';

const onError = (err: unknown) => {
  if (!(err instanceof ApiError)) return;
  // A 401 that survives the refresh attempt means "logged out": clear `me`, RequireAuth redirects.
  if (err.status === 401) queryClient.setQueryData(qk.me, null);
  // Forced password change: refetch me, RequirePasswordOk redirects.
  if (err.code === 'PASSWORD_CHANGE_REQUIRED') queryClient.invalidateQueries({ queryKey: qk.me });
  // A branch route answered 404: I was probably just removed from that branch. Refresh my branch list,
  // so BranchLayout shows "Branch not available" instead of a page that keeps failing.
  if (err.status === 404 && err.path?.startsWith('/b/')) queryClient.invalidateQueries({ queryKey: qk.me });
};

export const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError }),
  mutationCache: new MutationCache({ onError }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      retry: (count, err) => !(err instanceof ApiError && err.status > 0 && err.status < 500) && count < 2,
    },
  },
});
