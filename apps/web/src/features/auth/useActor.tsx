import type { ReactNode } from 'react';
import { can, type Permission } from '@shopstock/shared';
import { useMe } from './useMe';

/** Everything components need about "who am I". Only used under <RequireAuth>, so data is present. */
export function useActor() {
  const { data } = useMe();
  const me = data!;
  return {
    user: me.user,
    branches: me.branches,
    settings: me.settings,
    can: (p: Permission) => can(me.user.role, p),
  };
}

/** Hides UI the role can't use. Convenience only: the API still decides (Day 5). */
export function Can({
  permission,
  children,
  fallback = null,
}: {
  permission: Permission;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  return useActor().can(permission) ? <>{children}</> : <>{fallback}</>;
}
