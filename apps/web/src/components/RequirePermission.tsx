import type { ReactNode } from 'react';
import type { Permission } from '@shopstock/shared';
import { useActor } from '@/features/auth/useActor';

/** A friendly page instead of a broken one. The API enforces the same rule anyway. */
export function RequirePermission({ p, children }: { p: Permission; children: ReactNode }) {
  if (useActor().can(p)) return <>{children}</>;
  return (
    <div className="grid min-h-[50vh] place-items-center text-center">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">You don&apos;t have access to this page</h1>
        <p className="text-gray-500">Ask the owner if you think you should.</p>
      </div>
    </div>
  );
}
