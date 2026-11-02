import type { Currency } from './money';
import type { AdjustmentReason, MovementType, RefType, Role, Unit } from './constants';

export type Id = string;

export interface UserDto {
  id: Id;
  email: string;
  name: string;
  role: Role;
  mustChangePassword: boolean;
}
export interface BranchSummaryDto {
  id: Id;
  code: string;
  name: string;
  isActive: boolean;
}
export interface BranchDto extends BranchSummaryDto {
  address: string;
  phone: string;
}
export interface StaffDto {
  id: Id;
  email: string;
  name: string;
  role: Role;
  branchIds: Id[];
  isActive: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null; // ISO
}
export interface PublicSettingsDto {
  shopName: string;
  currency: Currency;
  timezone: string;
  taxRateBps: number;
  taxLabel: string;
  discountCapBps: number; // the CURRENT user's cap (owner: 10000)
  returnWindowDays: number;
  receiptFormat: '80mm' | 'a4';
  invoiceFooter: string;
}
/** GET /settings/full (Owner): everything stored, including BOTH discount caps. */
export interface ShopSettingsDto {
  shopName: string;
  currency: Currency;
  timezone: string;
  taxRateBps: number;
  taxLabel: string;
  discountCapsBps: { cashier: number; manager: number };
  returnWindowDays: number;
  invoiceFooter: string;
  receiptFormat: '80mm' | 'a4';
}
export interface CategoryDto {
  id: Id;
  name: string;
}
export interface ProductDto {
  id: Id;
  sku: string;
  barcode: string | null;
  name: string;
  categoryId: Id;
  price: number; // minor units
  unit: Unit;
  reorderLevel: number; // default for new inventory rows
  isActive: boolean;
  priceUpdatedAt: string | null; // ISO
}
/** `exactId`: a scanner typed a full barcode/SKU, so the POS can add that product straight away. */
export interface SearchResponse {
  exactId: Id | null;
  results: ProductDto[];
}
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}
export type StockStatus = 'ok' | 'low' | 'out' | 'not_stocked';

/** One product at one branch. Cost fields only with inventory:viewCost (NFR-SEC-14: never for cashiers). */
export interface InventoryRowDto {
  productId: Id;
  sku: string;
  name: string;
  unit: Unit;
  categoryId: Id;
  quantity: number; // 0 when not stocked
  reorderLevel: number;
  status: StockStatus;
  avgCost?: number;
  value?: number; // quantity × avgCost
}

/** Product detail: this product at each of MY branches. */
export interface BranchStockDto {
  branchId: Id;
  branchCode: string;
  quantity: number;
  reorderLevel: number;
  status: StockStatus;
  avgCost?: number;
}

export interface MovementDto {
  id: Id;
  productId: Id;
  productName?: string;
  type: MovementType;
  qtyChange: number;
  quantityAfter: number;
  refType: RefType;
  refId: Id;
  refNo: string;
  reason: AdjustmentReason | null;
  note: string;
  userName: string;
  businessDate: string;
  createdAt: string;
  unitCost?: number; // only with inventory:viewCost
  valueChange?: number;
}

export interface AdjustmentResultDto {
  refNo: string | null; // null: a stock count where nothing differed
  refId: Id | null;
  lines: number;
}
export interface AuthResponse {
  accessToken: string;
  user: UserDto;
}
export interface MeResponse {
  user: UserDto;
  branches: BranchSummaryDto[];
  settings: PublicSettingsDto;
}
