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
import { ReceiptPage } from '@/features/sales/ReceiptPage';
import { SaleDetailPage } from '@/features/sales/SaleDetailPage';
import { SalesHistoryPage } from '@/features/sales/SalesHistoryPage';
import { NewReturnPage } from '@/features/returns/NewReturnPage';
import { ReturnDetailPage } from '@/features/returns/ReturnDetailPage';
import { ReturnsPage } from '@/features/returns/ReturnsPage';
import { POListPage } from '@/features/purchasing/POListPage';
import { POEditorPage } from '@/features/purchasing/POEditorPage';
import { PODetailPage } from '@/features/purchasing/PODetailPage';
import { ReceivePage } from '@/features/purchasing/ReceivePage';
import { SuppliersPage } from '@/features/suppliers/SuppliersPage';
import { SupplierFormPage } from '@/features/suppliers/SupplierFormPage';
import { SupplierDetailPage } from '@/features/suppliers/SupplierDetailPage';
import { TransfersPage } from '@/features/transfers/TransfersPage';
import { NewTransferPage } from '@/features/transfers/NewTransferPage';
import { TransferDetailPage } from '@/features/transfers/TransferDetailPage';

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
                <Route path="sales" element={<SalesHistoryPage />} />
                <Route path="sales/:saleId" element={<SaleDetailPage />} />
                <Route path="sales/:saleId/print" element={<ReceiptPage />} />
                <Route path="dashboard" element={<ComingSoon title="Dashboard" day={18} />} />
                <Route
                  path="returns"
                  element={
                    <RequirePermission p="return:view">
                      <ReturnsPage />
                    </RequirePermission>
                  }
                />
                <Route
                  path="returns/new"
                  element={
                    <RequirePermission p="return:create">
                      <NewReturnPage />
                    </RequirePermission>
                  }
                />
                <Route
                  path="returns/:returnId"
                  element={
                    <RequirePermission p="return:view">
                      <ReturnDetailPage />
                    </RequirePermission>
                  }
                />
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
                <Route
                  path="purchase-orders"
                  element={
                    <RequirePermission p="po:view">
                      <POListPage />
                    </RequirePermission>
                  }
                />
                <Route
                  path="purchase-orders/new"
                  element={
                    <RequirePermission p="po:manage">
                      <POEditorPage />
                    </RequirePermission>
                  }
                />
                <Route
                  path="purchase-orders/:id"
                  element={
                    <RequirePermission p="po:view">
                      <PODetailPage />
                    </RequirePermission>
                  }
                />
                <Route
                  path="purchase-orders/:id/edit"
                  element={
                    <RequirePermission p="po:manage">
                      <POEditorPage />
                    </RequirePermission>
                  }
                />
                <Route
                  path="purchase-orders/:id/receive"
                  element={
                    <RequirePermission p="po:receive">
                      <ReceivePage />
                    </RequirePermission>
                  }
                />
                <Route
                  path="transfers"
                  element={
                    <RequirePermission p="transfer:view">
                      <TransfersPage />
                    </RequirePermission>
                  }
                />
                <Route
                  path="transfers/new"
                  element={
                    <RequirePermission p="transfer:manage">
                      <NewTransferPage />
                    </RequirePermission>
                  }
                />
                <Route
                  path="transfers/:id"
                  element={
                    <RequirePermission p="transfer:view">
                      <TransferDetailPage />
                    </RequirePermission>
                  }
                />
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
              <Route
                path="/suppliers/*"
                element={
                  <RequirePermission p="supplier:view">
                    <Routes>
                      <Route index element={<SuppliersPage />} />
                      <Route
                        path="new"
                        element={
                          <RequirePermission p="supplier:manage">
                            <SupplierFormPage />
                          </RequirePermission>
                        }
                      />
                      <Route path=":id" element={<SupplierDetailPage />} />
                      <Route
                        path=":id/edit"
                        element={
                          <RequirePermission p="supplier:manage">
                            <SupplierFormPage />
                          </RequirePermission>
                        }
                      />
                      <Route path="*" element={<NotFoundPage />} />
                    </Routes>
                  </RequirePermission>
                }
              />
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
