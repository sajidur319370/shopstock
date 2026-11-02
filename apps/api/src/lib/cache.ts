import type { Types } from 'mongoose';
import { Branch, Settings } from '../db/models';

export interface ShopSettings {
  shopName: string;
  currency: { code: string; symbol: string; minorUnits: number };
  timezone: string;
  taxRateBps: number;
  taxLabel: string;
  discountCapsBps: { cashier: number; manager: number };
  returnWindowDays: number;
  invoiceFooter: string;
  receiptFormat: '80mm' | 'a4';
}
export type BranchRow = {
  _id: Types.ObjectId;
  code: string;
  name: string;
  address: string;
  phone: string;
  isActive: boolean;
};

const TTL_MS = 60_000;
let settings: { at: number; value: ShopSettings } | null = null;
let branches: { at: number; value: BranchRow[] } | null = null;
const fresh = (e: { at: number } | null) => !!e && Date.now() - e.at < TTL_MS;

export async function getSettings(): Promise<ShopSettings> {
  if (!fresh(settings)) {
    const doc = await Settings.findById('shop').lean();
    if (!doc) throw new Error('Shop is not set up'); // routes behind loadActor only exist after setup
    // Setup and schema defaults always fill the nested paths; Mongoose's types can't prove it.
    settings = { at: Date.now(), value: doc as unknown as ShopSettings };
  }
  return settings!.value;
}

export async function listBranches(): Promise<BranchRow[]> {
  if (!fresh(branches)) {
    branches = {
      at: Date.now(),
      value: await Branch.find().select('code name address phone isActive').sort({ code: 1 }).lean(),
    };
  }
  return branches!.value;
}

export const allBranchIds = async () => (await listBranches()).map((b) => b._id);
export const getBranchByCode = async (code: string) =>
  (await listBranches()).find((b) => b.code === code) ?? null;

/** Call after writing settings or branches. Other instances catch up within TTL_MS. */
export function invalidateCache() {
  settings = null;
  branches = null;
}
