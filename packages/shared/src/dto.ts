import type { Currency } from './money';
import type {
  AdjustmentReason,
  MovementType,
  PaymentMethod,
  RefType,
  ReturnReason,
  Role,
  Unit,
} from './constants';
import type { Discount } from './pricing';

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
/** POS search: the catalog search plus on-hand at THIS branch (never cost). */
export interface PosSearchResponse {
  exactId: Id | null;
  results: (ProductDto & { onHand: number })[];
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
/** One sale line: the price AND cost as they were at the moment of sale (snapshots). */
export interface SaleLineDto {
  id: Id; // saleLineId: what returns point to
  productId: Id;
  sku: string;
  name: string;
  qty: number;
  unitPrice: number;
  discount: Discount | null; // the line discount INPUT
  lineDiscount: number;
  cartShare: number;
  net: number;
  tax: number;
  total: number;
  returnedQty: number;
  unitCost?: number; // Manager+ only
}

export interface SaleDto {
  id: Id;
  invoiceNo: string; // 'GUL-000124'
  branchCode: string;
  cashierId: Id;
  cashierName: string;
  items: SaleLineDto[];
  discount: Discount | null; // the cart discount INPUT
  taxRateBps: number;
  totals: {
    subtotal: number;
    discount: number;
    net: number;
    tax: number;
    total: number;
    itemCount: number;
    cost?: number; // Manager+ only
  };
  payments: { method: PaymentMethod; amount: number; reference: string }[];
  change: number;
  customer: { name: string; phone: string };
  note: string;
  returnStatus: 'none' | 'partial' | 'full';
  printCount: number;
  businessDate: string;
  createdAt: string;
  /** Detail only, and only with return:view: the returns made against this sale, oldest first. */
  returns?: SaleReturnLinkDto[];
}

export interface SaleReturnLinkDto {
  id: Id;
  returnNo: string;
  total: number;
  createdAt: string;
}
/** One row of the sales history (no lines). */
export interface SaleRowDto {
  id: Id;
  invoiceNo: string;
  cashierName: string;
  total: number;
  itemCount: number;
  methods: PaymentMethod[];
  returnStatus: 'none' | 'partial' | 'full';
  businessDate: string;
  createdAt: string;
}

/** One returned line: the customer's exact share of the sale line (telescoping portions). */
export interface ReturnLineDto {
  saleLineId: Id;
  productId: Id;
  sku: string;
  name: string;
  qty: number;
  unitPrice: number;
  net: number;
  tax: number;
  total: number;
  restock: boolean;
  unitCost?: number; // Manager+ only (inventory:viewCost)
  writeOffCost?: number; // Manager+ only
}

export interface ReturnDto {
  id: Id;
  returnNo: string; // 'GUL-R-000012'
  saleId: Id;
  invoiceNo: string;
  items: ReturnLineDto[];
  totals: {
    net: number;
    tax: number;
    total: number;
    itemCount: number;
    costRestocked?: number; // Manager+ only
    writeOff?: number; // Manager+ only
  };
  refund: { method: PaymentMethod; amount: number };
  reason: ReturnReason;
  note: string;
  processedByName: string;
  businessDate: string;
  createdAt: string;
}

/** One row of the returns list (no lines). */
export interface ReturnRowDto {
  id: Id;
  returnNo: string;
  saleId: Id;
  invoiceNo: string;
  itemCount: number;
  refund: { method: PaymentMethod; amount: number };
  reason: ReturnReason;
  processedByName: string;
  businessDate: string;
  createdAt: string;
}

/** "My shift today" for the cashier at the POS (FR-SAL-12). */
export interface ShiftSummaryDto {
  businessDate: string;
  count: number;
  total: number;
  items: number;
  /** Money actually collected per method: cash = tendered − change. */
  byMethod: Partial<Record<PaymentMethod, number>>;
}

export interface SetupStatusDto {
  needsSetup: boolean;
  tokenRequired: boolean; // production: POST /setup needs the x-setup-token header
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
