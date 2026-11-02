import type { Currency } from './money';
import type { Role, Unit } from './constants';

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
export interface AuthResponse {
  accessToken: string;
  user: UserDto;
}
export interface MeResponse {
  user: UserDto;
  branches: BranchSummaryDto[];
  settings: PublicSettingsDto;
}
