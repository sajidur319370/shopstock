import type { Currency } from './money';
import type {
  AdjustmentReason,
  MovementType,
  PaymentMethod,
  PoStatus,
  RefType,
  ReturnReason,
  TransferStatus,
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

export interface SupplierDto {
  id: Id;
  name: string;
  contactName: string;
  phone: string;
  email: string;
  address: string;
  notes: string;
  isActive: boolean;
}

/** One PO line. `remaining` is derived (ordered − received), never stored. */
export interface POLineDto {
  productId: Id;
  sku: string;
  name: string;
  orderedQty: number;
  receivedQty: number;
  remaining: number;
  unitCost: number;
}

export interface POReceiptDto {
  id: Id;
  receivedAt: string;
  receivedByName: string;
  lines: { productId: Id; qty: number; unitCost: number }[];
  note: string;
}

/** PO costs are visible to everyone who may see POs (Manager+): no stripping. */
export interface PODto {
  id: Id;
  poNumber: string; // 'PO-2026-0007'
  supplierId: Id;
  supplierName: string;
  status: PoStatus;
  items: POLineDto[];
  receipts: POReceiptDto[];
  expectedDate: string | null;
  notes: string;
  createdAt: string;
  orderedAt: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  closedAt: string | null;
  /** Derived from the lines and receipts in the mapper, so they can't drift. */
  totals: { orderedValue: number; receivedValue: number };
}

/** One row of the PO list (no lines). */
export interface PORowDto {
  id: Id;
  poNumber: string;
  supplierId: Id;
  supplierName: string;
  status: PoStatus;
  lineCount: number;
  orderedValue: number;
  expectedDate: string | null;
  createdAt: string;
}

export interface SupplierDetailDto {
  supplier: SupplierDto;
  /** The 10 most recent POs from this supplier at the actor's branches. */
  recentPOs: (PORowDto & { branchCode: string })[];
}

/** A low or out-of-stock product with a suggested order quantity (FR-PO-11). */
export interface POSuggestionDto {
  productId: Id;
  sku: string;
  name: string;
  unit: Unit;
  quantity: number;
  reorderLevel: number;
  status: 'low' | 'out';
  suggestedQty: number; // max(2 × reorderLevel − quantity, 1)
  lastCost: number | null; // the last purchase receipt cost at this branch (pre-fills unitCost)
}

/** Seen from the viewer's branch: they sent it (outgoing) or it comes to them (incoming). */
export type TransferDirection = 'outgoing' | 'incoming';

export interface TransferLineDto {
  productId: Id;
  sku: string;
  name: string;
  qty: number;
  unitCost?: number | null; // null until dispatch; only with inventory:viewCost
}

export interface TransferDto {
  id: Id;
  transferNo: string; // 'TR-2026-0003'
  fromCode: string;
  toCode: string;
  direction: TransferDirection;
  status: TransferStatus;
  items: TransferLineDto[];
  totals: { units: number; value?: number | null }; // value: once dispatched, with inventory:viewCost
  note: string;
  createdByName: string;
  dispatchedByName: string | null;
  dispatchedAt: string | null;
  receivedByName: string | null;
  receivedAt: string | null;
  cancelledByName: string | null;
  cancelledAt: string | null;
  createdAt: string;
}

/** One row of the transfers list (no lines). */
export interface TransferRowDto {
  id: Id;
  transferNo: string;
  fromCode: string;
  toCode: string;
  direction: TransferDirection;
  status: TransferStatus;
  lineCount: number;
  units: number;
  createdAt: string;
  dispatchedAt: string | null;
  receivedAt: string | null;
}

/** "In transit: 20 GUL → DHN" on the product page (FR-TRF-07). */
export interface InTransitDto {
  from: string;
  to: string;
  qty: number;
}

/** A low or out-of-stock row at one branch. No costs: cashiers may see the list. */
export interface LowStockRowDto {
  productId: Id;
  sku: string;
  name: string;
  unit: Unit;
  categoryId: Id;
  quantity: number;
  reorderLevel: number;
  status: 'low' | 'out';
  suggestedQty: number; // max(2 × reorderLevel − quantity, 1)
}

export interface LowStockListDto {
  items: LowStockRowDto[];
  truncated: boolean; // more rows exist than the 500 returned (NFR-PERF-08: no unbounded arrays)
}

export interface LowStockSummaryDto {
  lowCount: number;
  outCount: number;
  top: LowStockRowDto[]; // the 10 lowest, quantity ÷ reorderLevel ascending
}

/** FR-DSH-01: today (the shop's business date) at one branch, for Manager+. No costs or profit. */
export interface BranchDashboardDto {
  kind: 'branch';
  today: string;
  sales: { count: number; net: number; total: number; avgBasket: number };
  /** Cash = collected (tendered − change), like the shift summary. Every method present, 0 if none. */
  byMethod: Record<PaymentMethod, number>;
  byHour: { hour: number; count: number; total: number }[]; // always 24 rows, shop time
  refunds: { count: number; amount: number };
  lowStock: LowStockSummaryDto;
  incomingTransfers: {
    id: Id;
    transferNo: string;
    fromCode: string;
    units: number;
    dispatchedAt: string | null;
  }[];
  outgoingPending: number;
  openPOs: {
    id: Id;
    poNumber: string;
    supplierName: string;
    status: PoStatus;
    expectedDate: string | null;
  }[];
  recentSales: { id: Id; invoiceNo: string; cashierName: string; total: number; createdAt: string }[];
}

/** FR-DSH-02: a cashier's own shift and the branch's low-stock count. Nobody else's numbers. */
export interface ShiftDashboardDto {
  kind: 'shift';
  today: string;
  shift: ShiftSummaryDto;
  lowStockCount: number;
}

export type DashboardDto = BranchDashboardDto | ShiftDashboardDto;

export interface OverviewRowDto {
  branchId: Id;
  code: string;
  name: string;
  isActive: boolean;
  sales: { count: number; net: number; total: number };
  lowCount: number;
  outCount: number;
  incomingTransfers: number;
}

/** FR-DSH-03: every branch the actor may see, plus shop totals. */
export interface OverviewDto {
  today: string;
  branches: OverviewRowDto[];
  totals: Omit<OverviewRowDto, 'branchId' | 'code' | 'name' | 'isActive'>;
}

/* ---------- Reports (FR-RPT, queries.md §18–20). All money in minor units; margins in bps. ---------- */

export interface ReportBranchDto {
  branchId: Id;
  code: string;
  name: string;
}

/** One (day, branch) or all-branches row. netSales/tax are net of the day's returns; total is gross of them. */
export interface DailySums {
  sales: number;
  gross: number;
  discount: number;
  netSales: number;
  tax: number;
  total: number;
  refundCount: number;
  refunds: number;
  collected: number; // total − refunds
  avgBasket: number; // round_half_up(total / sales)
}

export interface DailySalesDto {
  branches: ReportBranchDto[];
  days: { day: string; all: DailySums; branches: (DailySums & { branchId: Id; code: string })[] }[];
  totals: DailySums; // the period, all branches (table footer)
}

export interface BestSellerRowDto {
  productId: Id;
  sku: string;
  name: string;
  categoryId: Id | null;
  qty: number;
  revenue: number; // net of discounts and of returns in the period
  cost: number;
  profit: number;
  marginBps: number; // negative when sold at a loss
}

export interface BestSellersDto {
  branches: ReportBranchDto[];
  rows: BestSellerRowDto[];
}

export interface ProfitRowDto {
  sales: number;
  returns: number;
  netSales: number;
  cogs: number;
  refunds: number;
  grossProfit: number;
  marginBps: number;
  shrinkage: number; // negative = loss
  profitAfterShrinkage: number;
}

export interface ProfitDto {
  rows: (ProfitRowDto & { branchId: Id; code: string; name: string })[];
  total: ProfitRowDto; // summed columns; the margin recomputed from the sums, never averaged
}

export interface MonthRowDto {
  month: string; // 'YYYY-MM'
  netSales: number;
  grossProfit: number;
  sales: number;
  total: number;
  avgBasket: number;
  growthBps: number | null; // vs the previous month; null when that was 0 (undefined, not infinite)
  movingAvg3: number; // net sales, this and the two previous months
}

export interface MonthlyDto {
  branches: ReportBranchDto[];
  perBranch: (ReportBranchDto & { months: MonthRowDto[] })[];
  shop: MonthRowDto[];
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
