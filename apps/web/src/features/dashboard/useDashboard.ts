import { useQuery } from '@tanstack/react-query';
import type { DashboardDto } from '@shopstock/shared';
import { http } from '@/api/client';
import { qk } from '@/api/keys';
import { useBranch } from '@/features/branch/useBranch';
import { POLLING, useLostAccess } from './polling';

/** One route, two shapes: narrow on `data.kind` ('branch' for Manager+, 'shift' for cashiers). */
export function useDashboard() {
  const branch = useBranch();
  const q = useQuery({
    queryKey: qk.dashboard(branch.code),
    queryFn: () => http.get<DashboardDto>(`/b/${branch.code}/dashboard`),
    ...POLLING,
  });
  useLostAccess(q.error, branch.code);
  return q;
}
