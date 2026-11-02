import { Navigate, Outlet, useLocation } from 'react-router';
import { useMe, useSetupStatus } from './useMe';

const Splash = () => <div className="grid h-screen place-items-center text-gray-500">Loading…</div>;

/** Fresh database → the wizard. Everything else waits until setup is done. */
export function RequireSetupDone() {
  const status = useSetupStatus();
  if (status.isPending) return <Splash />;
  if (status.data?.needsSetup) return <Navigate to="/setup" replace />;
  return <Outlet />;
}

export function RequireAuth() {
  const me = useMe();
  const location = useLocation();
  if (me.isPending) return <Splash />;
  if (!me.data) {
    return (
      <Navigate to={`/login?returnTo=${encodeURIComponent(location.pathname + location.search)}`} replace />
    );
  }
  return <Outlet />;
}

/** New staff must change the temporary password before using anything (FR-AUTH-12). */
export function RequirePasswordOk() {
  const me = useMe();
  if (me.data?.user.mustChangePassword) return <Navigate to="/change-password" replace />;
  return <Outlet />;
}
