/**
 * database.md §16 · TR-14 · NFR-PERF-03: 10 cashiers at ONE branch (GUL) for 60 s against a seeded
 * database, each ringing up random 1–6 line sales with a little think time. Then: reconciliation clean,
 * invoice numbers gapless, no unexpected error (INSUFFICIENT_STOCK is expected when shelves run out).
 *
 *   npm run seed -- --reset                                   (creates load.cashier1..10 at GUL)
 *   npm run build && NODE_ENV=production node apps/api/dist/server.js   # terminal 1
 *   npm run load:pos                                          # terminal 2
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import mongoose from 'mongoose';
import { env } from '../src/config/env';
import { connectDb } from '../src/db/connection';
import { Branch, Sale } from '../src/db/models';
import { reconcile } from '../src/modules/inventory/reconcile.service';
import { DEMO_DOMAIN } from '../src/middleware/demoGuard';

const BASE = process.env.LOAD_BASE_URL ?? `http://localhost:${env.PORT}`;
const CASHIERS = 10;
const SECONDS = Number(process.env.LOAD_SECONDS ?? 60);
const password = env.SEED_DEMO_PASSWORD;
if (!password) throw new Error('Set SEED_DEMO_PASSWORD (the seed gave the load cashiers that password).');

async function login(email: string) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`login ${email}: ${res.status} (did you run the seed?)`);
  return ((await res.json()) as { accessToken: string }).accessToken;
}

const api = async <T>(token: string, path: string, body?: unknown): Promise<T> => {
  const res = await fetch(`${BASE}/api${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return (await res.json()) as T;
};
type Row = { productId: string; quantity: number; avgCost?: number };
async function allInventory(token: string) {
  const rows: Row[] = [];
  let cursor = '';
  do {
    const page = await api<{ items: Row[]; nextCursor: string | null }>(
      token,
      `/b/GUL/inventory${cursor && `?cursor=${encodeURIComponent(cursor)}`}`,
    );
    rows.push(...page.items);
    cursor = page.nextCursor ?? '';
  } while (cursor);
  return rows;
}

// A delivery before the rush (through the normal API): the test measures SALES, not empty shelves.
const manager = await login(`manager.gul${DEMO_DOMAIN}`);
const stocked = (await allInventory(manager)).filter((r) => r.avgCost !== undefined);
const { items: suppliers } = await api<{ items: { id: string }[] }>(manager, '/suppliers');
const { purchaseOrder: po } = await api<{ purchaseOrder: { id: string } }>(
  manager,
  '/b/GUL/purchase-orders',
  {
    supplierId: suppliers[0]!.id,
    lines: stocked.map((r) => ({ productId: r.productId, orderedQty: 400, unitCost: r.avgCost })),
    notes: 'Load test: delivery before the rush',
  },
);
await api(manager, `/b/GUL/purchase-orders/${po.id}/order`, {});
await api(manager, `/b/GUL/purchase-orders/${po.id}/receive`, {
  clientReceiptId: randomUUID(),
  lines: stocked.map((r) => ({ productId: r.productId, qty: 400 })),
});

const tokens = await Promise.all(
  Array.from({ length: CASHIERS }, (_, i) => login(`load.cashier${i + 1}${DEMO_DOMAIN}`)),
);
const products = (await allInventory(tokens[0]!)).filter((r) => r.quantity > 0).map((r) => r.productId);
const pickDistinct = (n: number) => [...products].sort(() => Math.random() - 0.5).slice(0, n);

const results: { ms: number; status: number; code?: string }[] = [];
const until = Date.now() + SECONDS * 1000;
console.log(`${CASHIERS} cashiers × ${SECONDS} s at GUL → ${BASE} (${products.length} products in stock)`);
await Promise.all(
  tokens.map(async (token) => {
    while (Date.now() < until) {
      const lines = pickDistinct(1 + Math.floor(Math.random() * 6)).map((productId) => ({
        productId,
        qty: 1 + Math.floor(Math.random() * 3),
      }));
      const t0 = performance.now();
      const res = await fetch(`${BASE}/api/b/GUL/sales`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify({
          clientSaleId: randomUUID(),
          lines,
          payments: [{ method: 'cash', amount: 1_000_000_000 }],
        }),
      });
      const body = (await res.json()) as { error?: { code?: string } };
      results.push({ ms: performance.now() - t0, status: res.status, code: body.error?.code });
      await sleep(150 + Math.random() * 150); // think time: a real cashier isn't a loop
    }
  }),
);

const pct = (xs: number[], q: number) => {
  const ms = [...xs].sort((a, b) => a - b);
  return Math.round(ms[Math.min(ms.length - 1, Math.floor(q * ms.length))] ?? 0);
};
const all = results.map((r) => r.ms);
const sold = results.filter((r) => r.status === 201).map((r) => r.ms); // the transactions that did the work
const unexpected = results.filter((r) => r.status >= 400 && r.code !== 'INSUFFICIENT_STOCK');
const summary = {
  requests: results.length,
  'req/s': +(results.length / SECONDS).toFixed(1),
  'p50 ms': pct(all, 0.5),
  'p95 ms': pct(all, 0.95),
  'p99 ms': pct(all, 0.99),
  'p95 ms (completed sales)': pct(sold, 0.95),
  ok: results.filter((r) => r.status === 201).length,
  insufficientStock: results.filter((r) => r.code === 'INSUFFICIENT_STOCK').length,
  unexpected: unexpected.length,
};

// Afterwards: reconciliation clean and invoice numbers gapless (database.md §16).
await connectDb(process.env.MONGODB_OPS_URI ?? env.MONGODB_URI);
const gul = (await Branch.findOne({ code: 'GUL' }).lean())!;
const seqs = (await Sale.find({ branchId: gul._id }).distinct('seq')).sort((a, b) => a - b);
const gapless = seqs.every((s, i) => s === i + 1);
const mismatches = await reconcile({ branchId: gul._id });
console.table({ ...summary, invoices: seqs.length, gapless, reconciled: mismatches.length === 0 });
await mongoose.disconnect();

assert(gapless, 'invoice numbers have a gap');
assert.equal(mismatches.length, 0, `reconciliation failed: ${JSON.stringify(mismatches.slice(0, 3))}`);
assert.equal(unexpected.length, 0, `unexpected errors: ${JSON.stringify(unexpected.slice(0, 5))}`);
assert(summary['p95 ms'] < 800, `p95 ${summary['p95 ms']} ms ≥ 800 ms (NFR-PERF-03)`);
assert(summary['p95 ms (completed sales)'] < 800, 'p95 of completed sales ≥ 800 ms');
console.log('✅ NFR-PERF-03: 0 unexpected, p95 < 800 ms, gapless, reconciled');
