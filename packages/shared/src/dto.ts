import type { Currency } from './money';
import type { Role } from './constants';

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
export interface AuthResponse {
  accessToken: string;
  user: UserDto;
}
export interface MeResponse {
  user: UserDto;
  branches: BranchSummaryDto[];
  settings: PublicSettingsDto;
}
