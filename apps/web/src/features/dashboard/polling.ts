import { useEffect } from 'react';
import { toast } from 'sonner';
import { ApiError } from '@/api/client';

/**
 * FR-DSH-04: every 60 s and when the window regains focus. A HIDDEN tab stops polling
 * (refetchIntervalInBackground defaults to false), so ten open laptops don't hammer the API.
 * Focus refetches 'always', even within staleTime: coming back to the tab must show now, not 29 s ago.
 */
export const POLLING = {
  refetchInterval: 60_000,
  refetchOnWindowFocus: 'always',
  staleTime: 30_000,
} as const;

/**
 * E6: access to this branch was removed while the page was open. Say so in words; the query
 * client's global 404 handler already refreshes /me, so the layout swaps to "Branch not available".
 */
export function useLostAccess(error: unknown, code: string) {
  useEffect(() => {
    if (error instanceof ApiError && error.status === 404)
      toast.error(`You no longer have access to ${code}.`);
  }, [error, code]);
}
