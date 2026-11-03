import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { BestSellersDto, DailySalesDto, DailySums, MonthlyDto, ProfitDto } from '@shopstock/shared';
import { invalidateCache } from '../src/lib/cache';
import { monthlyTrends } from '../src/modules/reports/report.service';
import { createSale } from '../src/modules/sales/sale.service';
import { as, makeUser } from './helpers/auth';
import { ownerCtxFor } from './helpers/ctx';
import { at, pick, sum } from './helpers/report';
import { makeCategory } from './factories/catalog';
import { buildReportFixture } from './fixtures/reportEvents';
import expected from './fixtures/reports.json';

type Fixture = Awaited<ReturnType<typeof buildReportFixture>>;
const q = '?from=2026-10-01&to=2026-10-03';
const DAILY_KEYS = [
  'sales',
  'gross',
  'discount',
  'netSales',
  'tax',
  'total',
  'refunds',
  'collected',
] as const;
const MONTH_KEYS = ['month', 'netSales', 'grossProfit', 'sales', 'growthBps', 'movingAvg3'] as const;

const get = async <T>(token: string, path: string) => {
  const res = await as(token).get(`/api/reports/${path}`);
  if (res.status !== 200) throw new Error(`${res.status} ${JSON.stringify(res.body)}`);
  return res.body as T;
};
/** Monthly trends "as of" a given day, for the Owner across GUL and DHN. */
const monthlyAsOf = async (f: Fixture, day: string, months = 3) =>
  monthlyTrends(
    { ...(await ownerCtxFor(f.s.gul._id, 'GUL', at(day))), branchIds: [f.s.gul._id, f.s.dhn._id] },
    { months, branchIds: [] },
  );

describe('reports fixture (AC-RPT-01, queries.md §22)', () => {
  let f: Fixture;
  beforeEach(async () => {
    f = await buildReportFixture();
  });

  it('daily sales', async () => {
    const r = await get<DailySalesDto>(f.s.owner.token, `daily-sales${q}`);
    expect(r.days.map((d) => ({ day: d.day, ...pick(d.all, DAILY_KEYS) }))).toEqual(expected.daily);
    const on3 = (code: string) => r.days[2]!.branches.find((b) => b.code === code)!;
    expect(on3('GUL')).toMatchObject(expected.dailyBranch['GUL|2026-10-03']);
    expect(on3('DHN')).toMatchObject(expected.dailyBranch['DHN|2026-10-03']);
    // the footer: the whole period
    expect(r.totals).toMatchObject({ sales: 9, netSales: 499500, refundCount: 1, refunds: 10500 });
    expect(r.branches.map((b) => b.code)).toEqual(['DHN', 'GUL']);
  });

  it.each(['qty', 'revenue', 'profit'] as const)('best sellers by %s', async (sortBy) => {
    const r = await get<BestSellersDto>(f.s.owner.token, `best-sellers${q}&sortBy=${sortBy}`);
    expect(r.rows.map((x) => x.sku)).toEqual(expected.bestSellersOrder[sortBy]);
    for (const e of expected.bestSellers) expect(r.rows.find((x) => x.sku === e.sku)).toMatchObject(e);
    expect(r.rows.find((x) => x.sku === 'P1')).toMatchObject({ name: 'Tea 400g', marginBps: 3285 }); // 68500/208500
  });

  it('profit per branch', async () => {
    const r = await get<ProfitDto>(f.s.owner.token, `profit${q}`);
    expect(r.rows.map((x) => x.code)).toEqual(['DHN', 'GUL']); // biggest net sales first
    expect(r.rows.find((x) => x.code === 'GUL')).toMatchObject(expected.profit.GUL);
    expect(r.rows.find((x) => x.code === 'DHN')).toMatchObject(expected.profit.DHN);
    expect(r.total).toMatchObject(expected.profit.total);
    expect(r.rows.find((x) => x.code === 'GUL')).toMatchObject({ sales: 5, returns: 1, refunds: 10000 });
  });

  it('monthly trends, 3 months ending October 2026', async () => {
    const r = await monthlyAsOf(f, '2026-10-26');
    for (const code of ['GUL', 'DHN'] as const) {
      const series = r.perBranch.find((b) => b.code === code)!.months;
      expect(series.map((m) => pick(m, MONTH_KEYS))).toEqual(expected.monthly[code]);
    }
    // the shop total: one series, both branches
    expect(r.shop.map((m) => pick(m, MONTH_KEYS))).toEqual([
      { month: '2026-08', netSales: 0, grossProfit: 0, sales: 0, growthBps: null, movingAvg3: 0 },
      { month: '2026-09', netSales: 0, grossProfit: 0, sales: 0, growthBps: null, movingAvg3: 0 },
      {
        month: '2026-10',
        netSales: 499500,
        grossProfit: 146500,
        sales: 9,
        growthBps: null,
        movingAvg3: 166500,
      },
    ]);
  });

  it('cross-checks: Σ best-seller profit = total gross profit, Σ revenue = total net sales', async () => {
    const [b, p] = await Promise.all([
      get<BestSellersDto>(f.s.owner.token, `best-sellers${q}`),
      get<ProfitDto>(f.s.owner.token, `profit${q}`),
    ]);
    expect(sum(b.rows, (x) => x.profit)).toBe(p.total.grossProfit);
    expect(sum(b.rows, (x) => x.revenue)).toBe(p.total.netSales);
  });

  it('growth vs the previous month: a drop is negative, rounded half up on the magnitude', async () => {
    await createSale(await ownerCtxFor(f.s.gul._id, 'GUL', at('2026-11-02')), {
      clientSaleId: randomUUID(),
      lines: [{ productId: f.p2.id, qty: 1 }],
      payments: [{ method: 'cash', amount: 1_000_000 }],
    });
    const r = await monthlyAsOf(f, '2026-11-05');
    const gul = r.perBranch.find((b) => b.code === 'GUL')!.months;
    expect(gul.map((m) => m.month)).toEqual(['2026-09', '2026-10', '2026-11']); // the current month included
    // (12000 − 229000) / 229000 = −0.947598… → −9476 bps; (0 + 229000 + 12000) / 3 = 80333.33 → 80333
    expect(gul[2]).toMatchObject({ netSales: 12000, growthBps: -9476, movingAvg3: 80333, avgBasket: 12600 });
    expect(r.perBranch.find((b) => b.code === 'DHN')!.months[2]).toMatchObject({
      netSales: 0,
      growthBps: -10000,
    });
  });

  it('AC-RPT-03: changing a price after the fact changes no report', async () => {
    const all = () =>
      Promise.all([
        get(f.s.owner.token, `daily-sales${q}`),
        get(f.s.owner.token, `best-sellers${q}&sortBy=profit`),
        get(f.s.owner.token, `profit${q}`),
        monthlyAsOf(f, '2026-10-26'),
      ]);
    const before = await all();
    await as(f.s.owner.token).patch(`/api/products/${f.p1.id}`).send({ price: 99900 });
    expect(await all()).toEqual(before);
  });

  it('best sellers: the category filter (category as of today)', async () => {
    const soapAisle = await makeCategory(f.s.owner.token, 'Soap aisle');
    await as(f.s.owner.token).patch(`/api/products/${f.p3.id}`).send({ categoryId: soapAisle.id });
    const r = await get<BestSellersDto>(f.s.owner.token, `best-sellers${q}&categoryId=${soapAisle.id}`);
    expect(r.rows.map((x) => [x.sku, x.categoryId])).toEqual([['P3', soapAisle.id]]);
  });

  it('empty days are listed with zeros', async () => {
    const r = await get<DailySalesDto>(f.s.owner.token, 'daily-sales?from=2026-09-28&to=2026-10-03');
    expect(r.days.map((d) => d.day)).toEqual([
      '2026-09-28',
      '2026-09-29',
      '2026-09-30', // opening stock that day: not a sale
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
    ]);
    const zero: DailySums = {
      sales: 0,
      gross: 0,
      discount: 0,
      netSales: 0,
      tax: 0,
      total: 0,
      refundCount: 0,
      refunds: 0,
      collected: 0,
      avgBasket: 0,
    };
    for (const d of r.days.slice(0, 3)) {
      expect(d.all).toEqual(zero);
      expect(d.branches.every((b) => b.sales === 0)).toBe(true);
    }
  });
});

describe('reports: rules', () => {
  it('AC-RPT-02: 23:30 on 31 Oct and 00:30 on 1 Nov in Dhaka land on their own business days', async () => {
    const f = await buildReportFixture();
    for (const iso of ['2026-10-31T17:30:00Z', '2026-10-31T18:30:00Z']) {
      await createSale(await ownerCtxFor(f.s.gul._id, 'GUL', () => new Date(iso)), {
        clientSaleId: randomUUID(),
        lines: [{ productId: f.p3.id, qty: 1 }],
        payments: [{ method: 'cash', amount: 1_000_000 }],
      });
    }
    const r = await get<DailySalesDto>(f.s.owner.token, 'daily-sales?from=2026-10-31&to=2026-11-01');
    expect(r.days.map((d) => [d.day, d.all.sales])).toEqual([
      ['2026-10-31', 1],
      ['2026-11-01', 1],
    ]);
  });

  it('scope: a manager of DHN + UTT sees only those; GUL in branchIds → 404', async () => {
    const f = await buildReportFixture();
    await as(f.s.owner.token).post('/api/branches').send({ code: 'UTT', name: 'Uttara' });
    invalidateCache();
    const utt = (await as(f.s.owner.token).get('/api/branches')).body.branches.find(
      (b: { code: string }) => b.code === 'UTT',
    );
    const m = await makeUser('manager', [f.s.dhn._id, utt.id]);

    const daily = await get<DailySalesDto>(m.token, `daily-sales${q}`);
    expect(daily.branches.map((b) => b.code)).toEqual(['DHN', 'UTT']);
    expect(daily.days[0]!.branches.map((b) => b.code)).toEqual(['DHN', 'UTT']);
    expect(daily.totals.netSales).toBe(270500); // DHN only
    const profit = await get<ProfitDto>(m.token, `profit${q}`);
    expect(profit.rows.map((r) => [r.code, r.netSales])).toEqual([
      ['DHN', 270500],
      ['UTT', 0], // no activity: still a row
    ]);
    const best = await get<BestSellersDto>(m.token, `best-sellers${q}`);
    expect(sum(best.rows, (x) => x.revenue)).toBe(270500);
    const monthly = await get<MonthlyDto>(m.token, 'monthly?months=2');
    expect(monthly.perBranch.map((b) => b.code)).toEqual(['DHN', 'UTT']);
    expect(monthly.perBranch[1]!.months.every((x) => x.netSales === 0 && x.growthBps === null)).toBe(true);

    for (const path of [
      `daily-sales${q}&branchIds=${f.s.gul._id}`,
      `profit${q}&branchIds=${f.s.dhn._id},${f.s.gul._id}`,
      `best-sellers${q}&branchIds=${f.s.gul._id}`,
      `monthly?branchIds=${f.s.gul._id}`,
    ]) {
      expect((await as(m.token).get(`/api/reports/${path}`)).status, path).toBe(404);
    }
    const one = await get<DailySalesDto>(m.token, `daily-sales${q}&branchIds=${utt.id}`);
    expect(one.branches.map((b) => b.code)).toEqual(['UTT']);
  });

  it('periods: from > to or 367 days → 400 INVALID_DATE_RANGE; 366 is fine; months=25 → 400', async () => {
    const f = await buildReportFixture();
    const t = f.s.owner.token;
    const status = async (path: string) => {
      const res = await as(t).get(`/api/reports/${path}`);
      return [res.status, res.body.error?.code];
    };
    expect(await status('daily-sales?from=2026-10-03&to=2026-10-01')).toEqual([400, 'INVALID_DATE_RANGE']);
    expect(await status('profit?from=2025-01-01&to=2026-01-02')).toEqual([400, 'INVALID_DATE_RANGE']); // 367 days
    expect(await status('best-sellers?from=2025-01-01&to=2026-01-01')).toEqual([200, undefined]); // 366 days
    expect(await status('monthly?months=25')).toEqual([400, 'VALIDATION_ERROR']);
    expect(await status('best-sellers?from=2026-10-01&to=2026-10-03&limit=5')).toEqual([
      400,
      'VALIDATION_ERROR',
    ]);
  });

  it('a cashier gets 403 from every report', async () => {
    const f = await buildReportFixture();
    for (const path of [`daily-sales${q}`, `best-sellers${q}`, `profit${q}`, 'monthly']) {
      expect((await as(f.s.cashierGul.token).get(`/api/reports/${path}`)).status, path).toBe(403);
    }
  });
});
