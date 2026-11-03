/**
 * database.md §11: a realistic shop with N days of history (default 60), built ONLY through the real
 * services with a fake clock and seeded PRNGs. Counters, movements, average costs, business dates and
 * refunds come out exactly as the app produces them, so reconciliation proves the data is consistent.
 *
 *   npm run seed -- --reset            # drop the database first (refused in production unless forced)
 *   npm run seed -- --reset --days 7   # a quick local seed
 *
 * Needs SEED_DEMO_PASSWORD (every demo login uses it). The only direct write is
 * mustChangePassword: false for demo users, so the demo logins work at once.
 */
import { parseArgs } from 'node:util';
import mongoose, { type Types } from 'mongoose';
import {
  addDaysToDate,
  adjustmentSchema,
  createBranchSchema,
  createPOSchema,
  createProductSchema,
  createReturnSchema,
  createSaleSchema,
  createStaffSchema,
  createTransferSchema,
  receivePOSchema,
  setupSchema,
  supplierSchema,
  toBusinessDate,
} from '@shopstock/shared';
import { randomUUID } from 'node:crypto';
import { env } from '../src/config/env';
import { connectDb } from '../src/db/connection';
import { syncAllIndexes } from '../src/db/indexes';
import {
  Branch,
  Inventory,
  PurchaseOrder,
  Sale,
  SaleReturn,
  StockMovement,
  Transfer,
  User,
} from '../src/db/models';
import { applyValidators } from '../src/db/validators';
import { getSettings, invalidateCache } from '../src/lib/cache';
import { AppError } from '../src/lib/errors';
import { chance, mulberry32, pick, randInt, type Rand } from '../src/lib/random';
import { DEMO_DOMAIN } from '../src/middleware/demoGuard';
import { createBranch } from '../src/modules/branches/branch.service';
import { createCategory } from '../src/modules/catalog/category.service';
import { createProduct } from '../src/modules/catalog/product.service';
import { createAdjustment } from '../src/modules/inventory/adjustment.service';
import { reconcile } from '../src/modules/inventory/reconcile.service';
import { closePO, createPO, orderPO, receivePO } from '../src/modules/purchasing/po.service';
import { createReturn } from '../src/modules/returns/return.service';
import { createSale } from '../src/modules/sales/sale.service';
import { setup } from '../src/modules/setup/setup.service';
import { createStaff } from '../src/modules/staff/staff.service';
import { createSupplier } from '../src/modules/suppliers/supplier.service';
import { createTransfer, dispatchTransfer, receiveTransfer } from '../src/modules/transfers/transfer.service';
import { branchCtxFor, ctxFor, type SeedBranch, type SeedUser } from './seed/actors';
import { randomBasket, type CatalogItem } from './seed/basket';
import { FakeClock } from './seed/clock';
import { CATEGORIES, PRODUCTS } from './seed-data/products';
import { SUPPLIERS } from './seed-data/suppliers';

const args = parseArgs({
  options: { reset: { type: 'boolean' }, days: { type: 'string', default: '60' } },
}).values;
const DAYS = Number(args.days);
const TZ = 'Asia/Dhaka';
const TARGET_STOCK = 120; // weekly reorders top a branch up to about this many units
const started = Date.now();

if (!Number.isInteger(DAYS) || DAYS < 1 || DAYS > 400) throw new Error('--days must be 1–400');
const PASSWORD = env.SEED_DEMO_PASSWORD;
if (!PASSWORD) throw new Error('Set SEED_DEMO_PASSWORD (the password of every demo login).');
if (args.reset && env.NODE_ENV === 'production' && process.env.SEED_ALLOW_PROD_RESET !== 'yes-really') {
  throw new Error(
    'Refusing to reset a production database. Set SEED_ALLOW_PROD_RESET=yes-really if you mean it.',
  );
}

await connectDb(process.env.MONGODB_OPS_URI ?? env.MONGODB_URI);
if (args.reset) {
  await mongoose.connection.dropDatabase();
  await applyValidators(); // validators FIRST, then indexes (db-sync's order): dropping removed both
  await syncAllIndexes();
}
invalidateCache();

const rand = mulberry32(20261026); // shop-wide, sequential steps (reorders, transfers)
const today = toBusinessDate(new Date(), TZ);
const day0 = addDaysToDate(today, -DAYS);
const realNow = Date.now();
const stats = { sales: 0, insufficient: 0, returns: 0, poReceipts: 0, transfers: 0 };

/** Expected business conflicts (shelves do run empty) are counted; anything else stops the seed. */
async function tolerate<T>(code: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof AppError && err.code === code) {
      if (code === 'INSUFFICIENT_STOCK') stats.insufficient++;
      return null;
    }
    throw err;
  }
}

// ---------------------------------------------------------------- day 0: shop, people, catalog, stock
const boot = new FakeClock(`${day0}T00:00:00Z`);
boot.setLocal(day0, '08:00', TZ);
const email = (local: string) => `${local}${DEMO_DOMAIN}`;
const { owner } = await setup(
  setupSchema.parse({
    shopName: 'Daily Needs Mart',
    currency: { code: 'BDT', symbol: '৳', minorUnits: 2 },
    timezone: TZ,
    taxRateBps: 500, // caps: the defaults (cashier 10%, manager 30%) are database.md §11's
    owner: { name: 'Karim Rahman', email: email('owner'), password: PASSWORD },
    branch: { code: 'GUL', name: 'Gulshan', address: 'Road 11, Gulshan-2, Dhaka', phone: '01700-000001' },
  }),
  boot.now(),
);
invalidateCache();
const ownerUser: SeedUser = { _id: owner._id, name: owner.name, role: 'owner', branchIds: [] };
const ownerCtx = async () =>
  ctxFor(
    ownerUser,
    boot.now,
    (await Branch.find().lean()).map((b) => b._id),
  );

for (const b of [
  { code: 'DHN', name: 'Dhanmondi', address: 'Road 27, Dhanmondi, Dhaka', phone: '01700-000002' },
  { code: 'UTT', name: 'Uttara', address: 'Sector 7, Uttara, Dhaka', phone: '01700-000003' },
]) {
  await createBranch(await ownerCtx(), createBranchSchema.parse(b));
  invalidateCache();
}
const branches: SeedBranch[] = ['GUL', 'DHN', 'UTT'].map((code) => ({
  code,
  _id: null as unknown as Types.ObjectId,
}));
for (const b of branches) b._id = (await Branch.findOne({ code: b.code }).lean())!._id;
const allIds = branches.map((b) => b._id);
const [GUL, DHN, UTT] = branches as [SeedBranch, SeedBranch, SeedBranch];

/** Staff through the service (temporary password), then the one direct write: no forced change. */
async function staff(local: string, name: string, role: 'manager' | 'cashier', at: SeedBranch[]) {
  await createStaff(
    await ownerCtx(),
    createStaffSchema.parse({
      name,
      email: email(local),
      role,
      branchIds: at.map((b) => String(b._id)),
      temporaryPassword: PASSWORD,
    }),
  );
  const u = (await User.findOne({ email: email(local) }).lean())!;
  return { _id: u._id, name: u.name, role, branchIds: u.branchIds } as SeedUser;
}
const managers = [
  await staff('manager.gul', 'Mina Akter', 'manager', [GUL]),
  await staff('manager.dhn', 'Nadia Islam', 'manager', [DHN, UTT]), // a multi-branch manager
];
const cashiers = [
  await staff('cashier.gul', 'Rafi Ahmed', 'cashier', [GUL]),
  await staff('cashier.dhn', 'Sumi Das', 'cashier', [DHN]),
  await staff('cashier.utt', 'Tanvir Hasan', 'cashier', [UTT]),
];
for (let n = 1; n <= 10; n++) await staff(`load.cashier${n}`, `Load Cashier ${n}`, 'cashier', [GUL]); // the load test
await User.updateMany(
  { email: { $regex: `${DEMO_DOMAIN.replace('.', '\\.')}$` } },
  { $set: { mustChangePassword: false } },
);
const managerOf = (b: SeedBranch) => managers.find((m) => m.branchIds.some((id) => id.equals(b._id)))!;
const cashierOf = (b: SeedBranch) => cashiers.find((c) => c.branchIds.some((id) => id.equals(b._id)))!;

// Catalog: categories, suppliers, products (through the services, like the admin pages).
const categoryId = new Map<string, string>();
for (const name of CATEGORIES) categoryId.set(name, (await createCategory(name)).id);
const supplierId = new Map<string, string>();
for (const s of SUPPLIERS) supplierId.set(s.name, (await createSupplier(supplierSchema.parse(s))).id);
const catalog: (CatalogItem & (typeof PRODUCTS)[number])[] = [];
for (const p of PRODUCTS) {
  const dto = await createProduct(
    await ownerCtx(),
    createProductSchema.parse({
      sku: p.sku,
      barcode: p.barcode,
      name: p.name,
      categoryId: categoryId.get(p.category),
      price: p.price,
      unit: p.unit,
      reorderLevel: p.reorderLevel,
    }),
  );
  catalog.push({ ...p, id: dto.id });
}

// Opening stock at every branch, a little different per branch (not shrinkage: opening_balance).
for (const [bi, b] of branches.entries()) {
  const r = mulberry32(777 + bi);
  const mgr = await branchCtxFor(managerOf(b), b, boot.now, allIds);
  await createAdjustment(
    mgr,
    adjustmentSchema.parse({
      reason: 'opening_balance',
      note: 'Opening stock',
      lines: catalog.map((p) => ({ productId: p.id, qtyChange: randInt(r, 90, 150), unitCost: p.cost })),
    }),
  );
  boot.advanceMinutes(1);
}
const settings = await getSettings();

// ---------------------------------------------------------------- state the days share
type RecentSale = { id: string; day: string; lines: { id: string; qty: number }[] };
type DuePO = {
  id: string;
  code: string;
  dueDay: string;
  partial: boolean;
  lines: { productId: string; qty: number }[];
};
const recent: RecentSale[][] = branches.map(() => []);
const duePOs: DuePO[] = [];
const dueTransfers: { id: string; to: SeedBranch; dueDay: string }[] = [];
let partialCount = 0;

/** Manager work at the end of a branch's day, on that branch's clock (after its last sale). */
async function endOfDay(b: SeedBranch, bi: number, day: string, c: FakeClock, r: Rand, weekly: boolean) {
  const mgr = await branchCtxFor(managerOf(b), b, c.now, allIds);
  const next = () => c.advanceMinutes(1);

  // POs ordered earlier arrive (some partially; a partial one gets its rest later, or is closed).
  for (const po of duePOs.filter((x) => x.code === b.code && x.dueDay === day)) {
    next();
    const lines = po.partial
      ? po.lines.map((l) => ({ ...l, qty: Math.max(1, Math.floor(l.qty * 0.6)) }))
      : po.lines;
    const res = await tolerate('INVALID_STATE', () =>
      receivePO(
        mgr,
        new mongoose.Types.ObjectId(po.id),
        receivePOSchema.parse({ clientReceiptId: randomUUID(), lines }),
      ),
    );
    if (!res) continue;
    stats.poReceipts++;
    if (po.partial) {
      po.partial = false;
      po.lines = res.purchaseOrder.items
        .filter((i) => i.remaining > 0)
        .map((i) => ({ productId: i.productId, qty: i.remaining }));
      if (++partialCount % 4 === 0) {
        next();
        await closePO(mgr, new mongoose.Types.ObjectId(po.id)); // "the rest won't come"
      } else {
        po.dueDay = addDaysToDate(day, 2);
      }
    }
  }
  // Transfers dispatched yesterday arrive.
  for (const t of dueTransfers.filter((x) => x.to.code === b.code && x.dueDay === day)) {
    next();
    await receiveTransfer(mgr, new mongoose.Types.ObjectId(t.id));
  }
  // ~1% of sales come back 2–5 days later (some damaged: written off, not restocked).
  const window = recent[bi]!.filter(
    (s) => s.day <= addDaysToDate(day, -2) && s.day >= addDaysToDate(day, -5),
  );
  if (window.length && chance(r, 0.6)) {
    const s = pick(r, window);
    const line = pick(r, s.lines);
    const restock = chance(r, 0.75);
    next();
    const done = await tolerate('RETURN_EXCEEDS_SOLD', () =>
      createReturn(
        mgr,
        createReturnSchema.parse({
          clientReturnId: randomUUID(),
          saleId: s.id,
          reason: restock ? 'changed_mind' : 'damaged',
          lines: [{ saleLineId: line.id, qty: 1, restock }],
        }),
      ),
    );
    if (done) stats.returns++;
  }
  // Weekly: a few damaged / expired items.
  if (weekly) {
    for (let k = randInt(r, 2, 4); k > 0; k--) {
      const p = pick(r, catalog);
      next();
      await tolerate('INSUFFICIENT_STOCK', () =>
        createAdjustment(
          mgr,
          adjustmentSchema.parse({
            reason: pick(r, ['damaged', 'expired'] as const),
            note: '',
            lines: [{ productId: p.id, qtyChange: -randInt(r, 1, 2) }],
          }),
        ),
      );
    }
  }
}

/** Weekly: one PO per supplier for this branch's items below about half the target, arriving in 1–2 days. */
async function reorder(b: SeedBranch, c: FakeClock, day: string) {
  const mgr = await branchCtxFor(managerOf(b), b, c.now, allIds);
  const rows = await Inventory.find({ branchId: b._id }).select('productId quantity').lean();
  const low = rows.filter((x) => x.quantity < TARGET_STOCK / 2);
  const bySupplier = new Map<string, { productId: string; orderedQty: number; unitCost: number }[]>();
  for (const row of low) {
    const p = catalog.find((x) => x.id === String(row.productId))!;
    const lines = bySupplier.get(p.supplier) ?? [];
    lines.push({
      productId: p.id,
      orderedQty: Math.ceil((TARGET_STOCK - row.quantity) / 10) * 10,
      unitCost: p.cost,
    });
    bySupplier.set(p.supplier, lines);
  }
  for (const [sup, lines] of bySupplier) {
    c.advanceMinutes(1);
    const po = await createPO(mgr, createPOSchema.parse({ supplierId: supplierId.get(sup), lines }));
    await orderPO(mgr, new mongoose.Types.ObjectId(po.id));
    duePOs.push({
      id: po.id,
      code: b.code,
      dueDay: addDaysToDate(day, randInt(rand, 1, 2)),
      partial: chance(rand, 0.15),
      lines: lines.map((l) => ({ productId: l.productId, qty: l.orderedQty })),
    });
  }
}

/** Every 5 days: from the branch with the most of some product to the one with the least; arrives tomorrow. */
async function oneTransfer(day: string, clocks: FakeClock[]) {
  const p = pick(rand, catalog);
  const rows = await Promise.all(
    branches.map(
      async (b) => (await Inventory.findOne({ branchId: b._id, productId: p.id }).lean())?.quantity ?? 0,
    ),
  );
  const from = rows.indexOf(Math.max(...rows));
  const to = rows.indexOf(Math.min(...rows));
  const qty = Math.min(30, Math.floor((rows[from]! - rows[to]!) / 3));
  if (from === to || qty < 5) return;
  const src = branches[from]!;
  clocks[from]!.advanceMinutes(1);
  const mgr = await branchCtxFor(managerOf(src), src, clocks[from]!.now, allIds);
  const t = await createTransfer(
    mgr,
    createTransferSchema.parse({
      toBranchCode: branches[to]!.code,
      lines: [{ productId: p.id, qty }],
      note: 'Rebalancing',
    }),
  );
  const sent = await tolerate('INSUFFICIENT_STOCK', () =>
    dispatchTransfer(mgr, new mongoose.Types.ObjectId(t.id)),
  );
  if (sent) {
    stats.transfers++;
    dueTransfers.push({ id: t.id, to: branches[to]!, dueDay: addDaysToDate(day, 1) });
  }
}

// ---------------------------------------------------------------- every day
const branchRand = branches.map((_, i) => mulberry32(20261026 + i + 1)); // one PRNG per PARALLEL loop
for (let i = 1; i <= DAYS; i++) {
  const day = addDaysToDate(day0, i);
  const isToday = day === today;
  const weekly = i % 7 === 0;
  // Branches share no documents (except products, and the PO/TR counters), so their days run in parallel.
  const clocks = await Promise.all(
    branches.map(async (b, bi) => {
      const r = branchRand[bi]!;
      const c = new FakeClock(`${day}T00:00:00Z`);
      c.setLocal(day, '09:00', TZ);
      const cashier = await branchCtxFor(cashierOf(b), b, c.now, allIds);
      const n = randInt(r, 40, 80);
      const step = Math.floor((13 * 60) / n); // spread over 09:00–22:00
      const baskets = Array.from({ length: n }, () => ({
        wait: randInt(r, 1, step),
        basket: randomBasket(r, catalog, settings.taxRateBps),
      }));
      for (const { wait, basket } of baskets) {
        c.advanceMinutes(wait);
        if (isToday && c.now().getTime() > realNow) break; // today: only what has happened so far
        const res = await tolerate('INSUFFICIENT_STOCK', () =>
          createSale(cashier, createSaleSchema.parse(basket)),
        );
        if (res) {
          stats.sales++;
          recent[bi]!.push({
            id: res.sale.id,
            day,
            lines: res.sale.items.map((x) => ({ id: x.id, qty: x.qty })),
          });
        }
      }
      recent[bi] = recent[bi]!.filter((s) => s.day >= addDaysToDate(day, -6));
      if (!isToday) c.setLocal(day, '22:05', TZ);
      await endOfDay(b, bi, day, c, r, weekly);
      return c;
    }),
  );
  if (!isToday) {
    for (const c of clocks) c.setLocal(day, '23:00', TZ); // shop-wide steps after every branch's day
    if (weekly) for (const [bi, b] of branches.entries()) await reorder(b, clocks[bi]!, day);
    if (i % 5 === 0) await oneTransfer(day, clocks);
  } else {
    await makeTodayInteresting(clocks);
  }
  if (i % 10 === 0 || i === DAYS) {
    console.log(
      `  day ${i}/${DAYS} (${day}): ${stats.sales} sales so far, ${stats.insufficient} out-of-stock attempts`,
    );
  }
}

/** database.md §11 "Today": a PO ordered, one partially received, a transfer in transit to DHN. */
async function makeTodayInteresting(clocks: FakeClock[]) {
  const [cg, cd] = clocks as [FakeClock, FakeClock];
  const gul = await branchCtxFor(managerOf(GUL), GUL, cg.now, allIds);
  const dhn = await branchCtxFor(managerOf(DHN), DHN, cd.now, allIds);
  const items = (sup: string) => catalog.filter((p) => p.supplier === sup).slice(0, 3);

  cg.advanceMinutes(1);
  const ordered = await createPO(
    gul,
    createPOSchema.parse({
      supplierId: supplierId.get('Fresh Foods Ltd'),
      lines: items('Fresh Foods Ltd').map((p) => ({ productId: p.id, orderedQty: 40, unitCost: p.cost })),
      expectedDate: addDaysToDate(today, 2),
    }),
  );
  await orderPO(gul, new mongoose.Types.ObjectId(ordered.id));

  cd.advanceMinutes(1);
  const partial = await createPO(
    dhn,
    createPOSchema.parse({
      supplierId: supplierId.get('Dairy Fresh'),
      lines: items('Dairy Fresh').map((p) => ({ productId: p.id, orderedQty: 30, unitCost: p.cost })),
    }),
  );
  await orderPO(dhn, new mongoose.Types.ObjectId(partial.id));
  cd.advanceMinutes(1);
  await receivePO(
    dhn,
    new mongoose.Types.ObjectId(partial.id),
    receivePOSchema.parse({
      clientReceiptId: randomUUID(),
      lines: items('Dairy Fresh').map((p) => ({ productId: p.id, qty: 18 })),
      note: 'First truck',
    }),
  );

  cg.advanceMinutes(1);
  const p = catalog.find((x) => x.sku === 'SUGAR-1KG')!;
  const t = await createTransfer(
    gul,
    createTransferSchema.parse({
      toBranchCode: 'DHN',
      lines: [{ productId: p.id, qty: 10 }],
      note: 'DHN ran short',
    }),
  );
  await tolerate('INSUFFICIENT_STOCK', () => dispatchTransfer(gul, new mongoose.Types.ObjectId(t.id)));
}

// ---------------------------------------------------------------- prove it, then summarise
for (const b of branches) {
  const m = await reconcile({ branchId: b._id });
  if (m.length) throw new Error(`Seed broke reconciliation at ${b.code}: ${JSON.stringify(m.slice(0, 3))}`);
}
const mine = { branchId: { $in: allIds } };
console.table({
  days: DAYS,
  sales: await Sale.countDocuments(mine),
  returns: await SaleReturn.countDocuments(mine),
  movements: await StockMovement.countDocuments(mine),
  purchaseOrders: await PurchaseOrder.countDocuments(mine),
  transfers: await Transfer.countDocuments({ fromBranchId: { $in: allIds } }),
  outOfStockAttempts: stats.insufficient,
  reconciliation: 'clean (3 branches)',
  seconds: Math.round((Date.now() - started) / 1000),
});
console.log(
  `Demo logins (password: SEED_DEMO_PASSWORD): ${['owner', 'manager.gul', 'manager.dhn', 'cashier.gul', 'cashier.dhn', 'cashier.utt'].map(email).join(', ')}`,
);
await mongoose.disconnect();
