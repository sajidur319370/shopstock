/**
 * TR-07: hundreds of random operations, run in concurrent waves, across sales, returns, PO receipts,
 * transfers and adjustments. Afterwards: no negative stock, every failure a LEGITIMATE business
 * conflict, units conserved between shelves and trucks, and (afterEach) clean reconciliation.
 *
 * The seed fixes the CHOICES (every r() call happens in nextOp, before anything runs). Which of two
 * racing requests wins still varies run to run, and the invariants must hold for every interleaving.
 */
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { Inventory, StockMovement, Transfer } from '../src/db/models';
import { oid } from '../src/lib/ids';
import { chance, mulberry32, pick, randInt, type Rand } from '../src/lib/random';
import { as } from './helpers/auth';
import { makeCategory, makeProduct } from './factories/catalog';
import { makeSupplier, orderedPO, receive } from './factories/purchasing';
import { sell } from './factories/sales';
import { makeShop } from './factories/shop';
import { stockUp } from './factories/stock';
import { dispatch, makeTransfer, receiveTransfer } from './factories/transfers';

const OK_CONFLICTS = new Set([
  'INSUFFICIENT_STOCK',
  'INVALID_STATE',
  'RETURN_EXCEEDS_SOLD',
  'RECEIVE_EXCEEDS_ORDERED',
]);
const WAVES = Number(process.env.WAVES ?? 50);
const PER_WAVE = 10;

type Code = 'GUL' | 'DHN';
type Res = { status: number; body: unknown };
type World = Awaited<ReturnType<typeof makeWorld>>;
const errorCode = (body: unknown) => (body as { error?: { code?: string } } | null)?.error?.code;

async function makeWorld() {
  const s = await makeShop();
  const cat = await makeCategory(s.owner.token);
  const products = await Promise.all(
    [1, 2, 3, 4, 5].map((i) => makeProduct(s.owner.token, { categoryId: cat.id, price: 1000 * i })),
  );
  for (const code of ['GUL', 'DHN']) {
    await stockUp(
      s.owner.token,
      code,
      products.map((p) => ({ productId: p.id, qty: 20, unitCost: 500 })),
    );
  }
  const supplier = await makeSupplier(s.owner.token);
  const staff = {
    GUL: { cashier: s.cashierGul.token, manager: s.managerGul.token },
    DHN: { cashier: s.cashierDhn.token, manager: s.managerDhn.token },
  };
  return {
    s,
    products,
    supplier,
    staff,
    saleLines: [] as { code: Code; saleId: string; lineId: string; qty: number }[],
    openPOs: [] as { code: Code; id: string; productId: string; left: number }[],
    pending: [] as { code: Code; id: string }[],
    inTransit: [] as { to: Code; id: string }[],
  };
}

/** Picks an operation and its targets NOW (synchronously, from the seed); runs it later, in parallel with others. */
function nextOp(r: Rand, w: World): () => Promise<Res> {
  const code = pick(r, ['GUL', 'DHN'] as const);
  const other: Code = code === 'GUL' ? 'DHN' : 'GUL';
  const { cashier, manager } = w.staff[code];
  const product = () => pick(r, w.products).id;
  const roll = r();

  if (roll < 0.35) {
    // a sale of 1–3 lines
    const ids = [...new Set([product(), product(), product()].slice(0, randInt(r, 1, 3)))];
    const lines = ids.map((productId) => ({ productId, qty: randInt(r, 1, 4) }));
    return async () => {
      const res = await sell(cashier, code, lines);
      if (res.status === 201) {
        for (const l of res.body.sale.items as { id: string; qty: number }[]) {
          w.saleLines.push({ code, saleId: res.body.sale.id, lineId: l.id, qty: l.qty });
        }
      }
      return res;
    };
  }
  if (roll < 0.45 && w.saleLines.length) {
    // return 1–2 units, restocked or written off
    const l = pick(r, w.saleLines);
    const body = {
      clientReturnId: randomUUID(),
      saleId: l.saleId,
      reason: 'changed_mind',
      lines: [{ saleLineId: l.lineId, qty: randInt(r, 1, Math.min(2, l.qty)), restock: chance(r, 0.7) }],
    };
    return () => as(w.staff[l.code].manager).post(`/api/b/${l.code}/returns`).send(body);
  }
  if (roll < 0.52) {
    // a new PO, ordered
    const productId = product();
    const qty = randInt(r, 5, 15);
    const unitCost = randInt(r, 400, 700);
    return async () => {
      const po = await orderedPO(manager, code, w.supplier.id, [{ productId, orderedQty: qty, unitCost }]);
      w.openPOs.push({ code, id: po.id, productId, left: qty });
      return { status: 201, body: po };
    };
  }
  if (roll < 0.62 && w.openPOs.length) {
    // receive, sometimes more than is left
    const p = pick(r, w.openPOs);
    const qty = randInt(r, 1, p.left + 2);
    return async () => {
      const res = await receive(w.staff[p.code].manager, p.code, p.id, [{ productId: p.productId, qty }]);
      if (res.status === 200) p.left -= qty;
      return res;
    };
  }
  if (roll < 0.72) {
    // a new pending transfer
    const lines = [{ productId: product(), qty: randInt(r, 1, 8) }];
    return async () => {
      const t = await makeTransfer(manager, code, other, lines);
      w.pending.push({ code, id: t.id });
      return { status: 201, body: t };
    };
  }
  if (roll < 0.8 && w.pending.length) {
    // dispatch (sometimes twice: that's the point)
    const t = pick(r, w.pending);
    return async () => {
      const res = await dispatch(w.staff[t.code].manager, t.code, t.id);
      if (res.status === 200) w.inTransit.push({ to: res.body.transfer.toCode, id: t.id });
      return res;
    };
  }
  if (roll < 0.83 && w.pending.length) {
    // cancel a pending transfer (or one that was dispatched meanwhile: INVALID_STATE)
    const t = pick(r, w.pending);
    return () => as(w.staff[t.code].manager).post(`/api/b/${t.code}/transfers/${t.id}/cancel`);
  }
  if (roll < 0.9 && w.inTransit.length) {
    // receive at the destination
    const t = pick(r, w.inTransit);
    return () => receiveTransfer(w.staff[t.to].manager, t.to, t.id);
  }
  // damaged (out) or found (in)
  const loss = chance(r, 0.6);
  const body = {
    reason: loss ? 'damaged' : 'found',
    note: '',
    lines: [
      {
        productId: product(),
        qtyChange: (loss ? -1 : 1) * randInt(r, 1, 3),
        ...(!loss && { unitCost: 500 }),
      },
    ],
  };
  return () => as(manager).post(`/api/b/${code}/adjustments`).send(body);
}

/** BR-08 / I16: what came in minus what left equals what's on shelves PLUS what's in trucks. */
async function expectConservation(w: World) {
  const branchIds = [w.s.gul._id, w.s.dhn._id];
  for (const p of w.products) {
    const productId = oid(p.id);
    const moves = await StockMovement.aggregate<{ _id: string; qty: number }>([
      { $match: { branchId: { $in: branchIds }, productId } },
      { $group: { _id: '$type', qty: { $sum: '$qtyChange' } } },
    ]);
    const by = Object.fromEntries(moves.map((m) => [m._id, m.qty])) as Record<string, number>;
    const rows = await Inventory.find({ branchId: { $in: branchIds }, productId })
      .select('quantity')
      .lean();
    const onHand = rows.reduce((a, row) => a + row.quantity, 0);
    const [t] = await Transfer.aggregate<{ qty: number }>([
      {
        $match: {
          $or: [{ fromBranchId: { $in: branchIds } }, { toBranchId: { $in: branchIds } }],
          status: 'in_transit',
        },
      },
      { $unwind: '$items' },
      { $match: { 'items.productId': productId } },
      { $group: { _id: null, qty: { $sum: '$items.qty' } } },
    ]);
    const inTransit = t?.qty ?? 0;
    // sales are negative movements, receipts/returns/found positive, damaged negative
    const external = (by.purchase_receipt ?? 0) + (by.adjustment ?? 0) + (by.return ?? 0) + (by.sale ?? 0);
    const transferred = -(by.transfer_out ?? 0) - (by.transfer_in ?? 0); // out is negative

    expect(rows.every((row) => row.quantity >= 0)).toBe(true);
    expect(transferred, `${p.name}: units that left minus units that arrived = in transit`).toBe(inTransit);
    expect(external, `${p.name}: in − out = on hand + in transit`).toBe(onHand + inTransit);
  }
}

describe.each([1, 42, 20261026])('TR-07 invariants, seed %i', (seed) => {
  it(`${WAVES * PER_WAVE} random concurrent operations`, { timeout: 300_000 }, async () => {
    const r = mulberry32(seed);
    const w = await makeWorld();
    const unexpected: string[] = [];
    const tally: Record<string, number> = {};

    for (let wave = 0; wave < WAVES; wave++) {
      const ops = Array.from({ length: PER_WAVE }, () => nextOp(r, w)); // targets chosen before anything runs
      const results = await Promise.all(ops.map((op) => op()));
      for (const res of results) {
        const key = res.status < 400 ? String(res.status) : `${res.status} ${errorCode(res.body)}`;
        tally[key] = (tally[key] ?? 0) + 1;
        if (res.status < 400) continue;
        if (res.status === 409 && OK_CONFLICTS.has(errorCode(res.body) ?? '')) continue;
        unexpected.push(`wave ${wave}: ${res.status} ${JSON.stringify(res.body)}`);
      }
    }
    if (process.env.TALLY) console.log(`seed ${seed}`, JSON.stringify(tally));
    expect(unexpected, `seed ${seed}`).toEqual([]);
    // The run must actually exercise the races, not just succeed: some of every kind of conflict happened.
    expect(tally['200'] ?? 0, JSON.stringify(tally)).toBeGreaterThan(0);
    expect(tally['409 INSUFFICIENT_STOCK'] ?? 0, JSON.stringify(tally)).toBeGreaterThan(0);
    expect(w.inTransit.length, 'some transfers were dispatched').toBeGreaterThan(0);
    await expectConservation(w);
    // afterEach(expectReconciled) then checks Σ movements == quantity for every row (I8).
  });
});
