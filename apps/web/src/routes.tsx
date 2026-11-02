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
import { ProductsPage } from '@/features/catalog/ProductsPage';
import { ProductFormPage } from '@/features/catalog/ProductFormPage';
import { ProductDetailPage } from '@/features/catalog/ProductDetailPage';
import { CategoriesPage } from '@/features/catalog/CategoriesPage';
import { InventoryPage } from '@/features/inventory/InventoryPage';
import { StockCountPage } from '@/features/inventory/StockCountPage';
import { ProductHistoryPage } from '@/features/inventory/ProductHistoryPage';
import { PosPage } from '@/features/pos/PosPage';
import { SaleDonePage } from '@/features/pos/SaleDonePage';

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
                <Route
                  path="pos"
                  element={
                    <RequirePermission p="sale:create">
                      <PosPage />
                    </RequirePermission>
                  }
                />
                <Route path="sales/:saleId/print" element={<SaleDonePage />} />
                <Route path="dashboard" element={<ComingSoon title="Dashboard" day={18} />} />
                <Route path="sales" element={<ComingSoon title="Sales" day={13} />} />
                <Route path="returns" element={<ComingSoon title="Returns" day={14} />} />
                <Route path="inventory" element={<InventoryPage />} />
                <Route
                  path="inventory/count"
                  element={
                    <RequirePermission p="inventory:adjust">
                      <StockCountPage />
                    </RequirePermission>
                  }
                />
                <Route
                  path="inventory/:productId"
                  element={
                    <RequirePermission p="movement:view">
                      <ProductHistoryPage />
                    </RequirePermission>
                  }
                />
                <Route path="purchase-orders" element={<ComingSoon title="Purchase orders" day={16} />} />
                <Route path="transfers" element={<ComingSoon title="Transfers" day={17} />} />
              </Route>

              <Route
                path="/catalog/*"
                element={
                  <RequirePermission p="catalog:manage">
                    <Routes>
                      <Route path="products" element={<ProductsPage />} />
                      <Route path="products/new" element={<ProductFormPage />} />
                      <Route path="products/:id" element={<ProductDetailPage />} />
                      <Route path="products/:id/edit" element={<ProductFormPage />} />
                      <Route path="categories" element={<CategoriesPage />} />
                      <Route path="*" element={<NotFoundPage />} />
                    </Routes>
                  </RequirePermission>
                }
              />
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
