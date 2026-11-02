import { Route, Routes } from 'react-router';
import { RequireAuth, RequirePasswordOk, RequireSetupDone } from '@/features/auth/gates';
import { SetupPage } from '@/features/setup/SetupPage';
import { LoginPage } from '@/features/auth/LoginPage';
import { ChangePasswordPage } from '@/features/auth/ChangePasswordPage';
import { ProfilePage } from '@/features/auth/ProfilePage';
import { NotFoundPage } from '@/components/NotFoundPage';
import { ComingSoon } from '@/components/ComingSoon';
import { RequirePermission } from '@/components/RequirePermission';
import { AppShell } from '@/layout/AppShell';
import { BranchLayout } from '@/features/branch/BranchLayout';
import { HomeRedirect } from '@/features/home/HomeRedirect';
import { BranchesPage } from '@/features/admin/BranchesPage';
import { StaffPage } from '@/features/admin/StaffPage';
import { SettingsPage } from '@/features/admin/SettingsPage';

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/setup" element={<SetupPage />} />
      <Route element={<RequireSetupDone />}>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<RequireAuth />}>
          <Route path="/change-password" element={<ChangePasswordPage />} />
          <Route element={<RequirePasswordOk />}>
            <Route element={<AppShell />}>
              <Route path="/" element={<HomeRedirect />} />
              <Route path="/profile" element={<ProfilePage />} />

              <Route path="/b/:branchCode" element={<BranchLayout />}>
                <Route path="pos" element={<ComingSoon title="POS" day={12} />} />
                <Route path="dashboard" element={<ComingSoon title="Dashboard" day={18} />} />
                <Route path="sales" element={<ComingSoon title="Sales" day={13} />} />
                <Route path="returns" element={<ComingSoon title="Returns" day={14} />} />
                <Route path="inventory" element={<ComingSoon title="Inventory" day={9} />} />
                <Route path="purchase-orders" element={<ComingSoon title="Purchase orders" day={16} />} />
                <Route path="transfers" element={<ComingSoon title="Transfers" day={17} />} />
              </Route>

              <Route path="/catalog/products" element={<ComingSoon title="Products" day={9} />} />
              <Route path="/suppliers" element={<ComingSoon title="Suppliers" day={16} />} />
              <Route path="/reports" element={<ComingSoon title="Reports" day={19} />} />
              <Route
                path="/admin/branches"
                element={
                  <RequirePermission p="branch:manage">
                    <BranchesPage />
                  </RequirePermission>
                }
              />
              <Route
                path="/admin/staff"
                element={
                  <RequirePermission p="staff:view">
                    <StaffPage />
                  </RequirePermission>
                }
              />
              <Route
                path="/admin/settings"
                element={
                  <RequirePermission p="settings:update">
                    <SettingsPage />
                  </RequirePermission>
                }
              />
            </Route>
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
