import { useEffect } from 'react';
import { Outlet, useParams } from 'react-router';
import { useActor } from '@/features/auth/useActor';
import { rememberBranch } from '@/lib/lastBranch';
import { BranchUnavailable } from './BranchUnavailable';
import { BranchContext } from './useBranch';

export function BranchLayout() {
  const { branchCode = '' } = useParams();
  const { branches, user } = useActor();
  const branch = branches.find((b) => b.code === branchCode.toUpperCase());
  const usable = !!branch && (branch.isActive || user.role === 'owner');
  const rememberedCode = usable ? branch.code : null;

  useEffect(() => {
    if (rememberedCode) rememberBranch(rememberedCode); // for shop pages and the next login
  }, [rememberedCode]);

  // Not assigned (or no such branch): the API would answer 404 too (FR-SCOPE-01).
  if (!branch) return <BranchUnavailable code={branchCode} />;
  if (!usable) return <BranchUnavailable code={branchCode} inactive />;

  return (
    <BranchContext.Provider value={branch}>
      {!branch.isActive && (
        <div className="mb-3 rounded bg-amber-100 p-2 text-sm">This branch is inactive: read-only.</div>
      )}
      <Outlet />
    </BranchContext.Provider>
  );
}
