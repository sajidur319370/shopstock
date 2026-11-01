export const ROLES = ['owner', 'manager', 'cashier'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LEVEL: Record<Role, number> = {
  owner: 30,
  manager: 20,
  cashier: 10,
};

export const STAFF_ROLES = ['manager', 'cashier'] as const; // roles that can be created via the API
export type StaffRole = (typeof STAFF_ROLES)[number];

export const UNITS = ['pcs', 'pack', 'box', 'bottle', 'bag', 'kg', 'litre'] as const;
export type Unit = (typeof UNITS)[number];

export const PAYMENT_METHODS = ['cash', 'card', 'mobile'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const DISCOUNT_TYPES = ['percent', 'amount'] as const;

export const MOVEMENT_TYPES = [
  'sale',
  'return',
  'purchase_receipt',
  'transfer_out',
  'transfer_in',
  'adjustment',
] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

export const REF_TYPES = ['sale', 'return', 'purchaseOrder', 'transfer', 'adjustment'] as const;
export type RefType = (typeof REF_TYPES)[number];

export const ADJUSTMENT_REASONS = [
  'opening_balance',
  'found',
  'damaged',
  'expired',
  'lost',
  'count_correction',
] as const;
export type AdjustmentReason = (typeof ADJUSTMENT_REASONS)[number];

/** Which sign each reason allows (count_correction: either). */
export const REASON_SIGN: Record<AdjustmentReason, 1 | -1 | 0> = {
  opening_balance: 1,
  found: 1,
  damaged: -1,
  expired: -1,
  lost: -1,
  count_correction: 0,
};

/** Adjustment reasons that count as shrinkage in the profit report (opening stock doesn't). */
export const SHRINKAGE_REASONS = ['found', 'damaged', 'expired', 'lost', 'count_correction'] as const;

export const PO_STATUSES = [
  'draft',
  'ordered',
  'partially_received',
  'received',
  'cancelled',
  'closed',
] as const;
export type PoStatus = (typeof PO_STATUSES)[number];
export const PO_OPEN_STATUSES = ['ordered', 'partially_received'] as const;

export const TRANSFER_STATUSES = ['pending', 'in_transit', 'received', 'cancelled'] as const;
export type TransferStatus = (typeof TRANSFER_STATUSES)[number];

export const SALE_RETURN_STATUSES = ['none', 'partial', 'full'] as const;
export const RETURN_REASONS = ['changed_mind', 'damaged', 'wrong_item', 'expired', 'other'] as const;
export type ReturnReason = (typeof RETURN_REASONS)[number];

export const RECEIPT_FORMATS = ['80mm', 'a4'] as const;

export const BPS = 10_000; // 100% in basis points

export const LIMITS = {
  branches: 50,
  staff: 200,
  branchesPerManager: 10,
  products: 20_000,
  categories: 200,
  saleLines: 100,
  maxLineQty: 9_999,
  payments: 3,
  returnLines: 100,
  adjustmentLines: 200,
  poLines: 200,
  receiptsPerPo: 20,
  transferLines: 200,
  maxDocQty: 100_000,
  maxMoney: 1_000_000_000,
  searchResults: 20,
  pageSize: 50,
  reportMaxDays: 366,
  reportMaxMonths: 24,
} as const;

export const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
export const BRANCH_CODE = /^[A-Z][A-Z0-9]{1,7}$/;
export const SKU = /^[A-Z0-9][A-Z0-9._-]{1,31}$/;
export const BARCODE = /^[A-Za-z0-9-]{4,32}$/;
