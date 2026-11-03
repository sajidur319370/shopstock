import { Navigate } from 'react-router';
import { useActor } from '@/features/auth/useActor';
import { lastBranch } from '@/lib/lastBranch';
import { branchHome } from '@/layout/nav';

/**
 * `/` sends you somewhere useful: the Owner and managers of several branches to the overview,
 * a one-branch manager to that branch's dashboard, cashiers to the POS.
 */
export function HomeRedirect() {
  const { user, branches, can } = useActor();
  const active = branches.filter((b) => b.isActive);
  if (can('report:view') && (user.role === 'owner' || active.length > 1))
    return <Navigate to="/overview" replace />;
  const code = lastBranch(active);
  if (!code) {
    return (
      <p className="p-8 text-gray-600">You&apos;re not assigned to any active branch yet. Ask the owner.</p>
    );
  }
  return <Navigate to={branchHome(user.role, code)} replace />;
}
