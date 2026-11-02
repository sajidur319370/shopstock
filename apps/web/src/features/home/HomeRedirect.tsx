import { Navigate } from 'react-router';
import { useActor } from '@/features/auth/useActor';
import { lastBranch } from '@/lib/lastBranch';
import { branchHome } from '@/layout/nav';

/** `/` sends you somewhere useful: cashiers to the POS, everyone else to the dashboard. */
export function HomeRedirect() {
  const { user, branches } = useActor();
  const code = lastBranch(branches.filter((b) => b.isActive));
  if (!code) {
    return (
      <p className="p-8 text-gray-600">You&apos;re not assigned to any active branch yet. Ask the owner.</p>
    );
  }
  return <Navigate to={branchHome(user.role, code)} replace />;
}
