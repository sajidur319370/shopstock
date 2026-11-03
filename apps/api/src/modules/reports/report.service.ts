/**
 * Reports (queries.md §18–20). Each is ONE aggregation pipeline (C-2) over business dates, which are
 * strings in the shop timezone fixed at write time: '2026-10-01' ≤ d ≤ '2026-10-31' is a plain range
 * on { branchId, businessDate }, and "October" is $substrBytes(businessDate, 0, 7).
 *
 * Returns count in the period they HAPPEN ($unionWith, as negative amounts). Every $unionWith
 * sub-pipeline starts with its own branch $match: the guard only inspects the outer pipeline.
 * Pipelines return raw integer sums; rounding (half up), empty days and total rows are done in TS.
 */
import type { PipelineStage, Types } from 'mongoose';
import {
  addDaysToDate,
  addMonths,
  divRoundHalfUp,
  SHRINKAGE_REASONS,
  signedDiv,
  toBusinessDate,
  type BestSellersDto,
  type BestSellersQuery,
  type DailySalesDto,
  type DailySums,
  type MonthlyDto,
  type MonthlyQuery,
  type MonthRowDto,
  type PeriodQuery,
  type ProfitDto,
  type ProfitRowDto,
  type ReportBranchDto,
} from '@shopstock/shared';
import { Sale } from '../../db/models';
import { oid } from '../../lib/ids';
import type { Ctx } from '../../types/ctx';
import { assertReportBranches, reportBranches } from './scope';

const periodMatch = (branchIds: Types.ObjectId[], f: { from: string; to: string }) => ({
  branchId: { $in: branchIds },
  businessDate: { $gte: f.from, $lte: f.to },
});

/* ---------- §18 daily sales · FR-RPT-01 ---------- */

type DailyRaw = Omit<DailySums, 'avgBasket'> & { day: string; branchId: Types.ObjectId };
type Sums = Omit<DailySums, 'avgBasket'>;
const ZERO: Sums = {
  sales: 0,
  gross: 0,
  discount: 0,
  netSales: 0,
  tax: 0,
  total: 0,
  refundCount: 0,
  refunds: 0,
  collected: 0,
};
const SUM_KEYS = Object.keys(ZERO) as (keyof Sums)[];
const addSums = (a: Sums, b: Sums): Sums => Object.fromEntries(SUM_KEYS.map((k) => [k, a[k] + b[k]])) as Sums;
const withBasket = (s: Sums): DailySums => ({ ...s, avgBasket: divRoundHalfUp(s.total, s.sales) });

export async function dailySales(ctx: Ctx, f: PeriodQuery): Promise<DailySalesDto> {
  const branchIds = assertReportBranches(ctx, f.branchIds);
  const period = periodMatch(branchIds, f);
  const key = { day: '$businessDate', branchId: '$branchId' };

  const rows = await Sale.aggregate<DailyRaw>([
    { $match: period }, // { branchId, businessDate } index
    {
      $group: {
        _id: key,
        sales: { $sum: 1 },
        gross: { $sum: '$totals.subtotal' },
        discount: { $sum: '$totals.discount' },
        net: { $sum: '$totals.net' },
        tax: { $sum: '$totals.tax' },
        total: { $sum: '$totals.total' },
      },
    },
    {
      // Returns count on the day they happened, as negative amounts in the same rows.
      $unionWith: {
        coll: 'returns',
        pipeline: [
          { $match: period }, // sub-pipelines must scope too (§1.2)
          {
            $group: {
              _id: key,
              refundCount: { $sum: 1 },
              refundNet: { $sum: '$totals.net' },
              refundTax: { $sum: '$totals.tax' },
              refunds: { $sum: '$totals.total' },
            },
          },
        ],
      },
    },
    {
      // Merge the sale row and the return row of the same (day, branch). $sum of a missing field is 0.
      $group: {
        _id: '$_id',
        sales: { $sum: '$sales' },
        gross: { $sum: '$gross' },
        discount: { $sum: '$discount' },
        net: { $sum: '$net' },
        tax: { $sum: '$tax' },
        total: { $sum: '$total' },
        refundCount: { $sum: '$refundCount' },
        refundNet: { $sum: '$refundNet' },
        refundTax: { $sum: '$refundTax' },
        refunds: { $sum: '$refunds' },
      },
    },
    {
      $project: {
        _id: 0,
        day: '$_id.day',
        branchId: '$_id.branchId',
        sales: 1,
        gross: 1,
        discount: 1,
        refundCount: 1,
        refunds: 1,
        total: 1,
        netSales: { $subtract: ['$net', '$refundNet'] },
        tax: { $subtract: ['$tax', '$refundTax'] },
        collected: { $subtract: ['$total', '$refunds'] },
      },
    },
    { $sort: { day: 1, branchId: 1 } },
  ]);

  // Presentation: every day of the period (zeros where nothing happened), per branch + all branches.
  const branches = await reportBranches(branchIds);
  const byKey = new Map(rows.map((r) => [`${r.day}|${String(r.branchId)}`, r]));
  const days: DailySalesDto['days'] = [];
  let totals = { ...ZERO };
  for (let day = f.from; day <= f.to; day = addDaysToDate(day, 1)) {
    const perBranch = branches.map((b) => {
      const r = byKey.get(`${day}|${b.branchId}`);
      const sums = r ? (Object.fromEntries(SUM_KEYS.map((k) => [k, r[k]])) as Sums) : { ...ZERO };
      return { branchId: b.branchId, code: b.code, ...withBasket(sums) };
    });
    const all = perBranch.reduce<Sums>((acc, r) => addSums(acc, r), { ...ZERO });
    totals = addSums(totals, all);
    days.push({ day, all: withBasket(all), branches: perBranch });
  }
  return { branches, days, totals: withBasket(totals) };
}

/* ---------- §19 best sellers · FR-RPT-02 ---------- */

type BestRaw = {
  productId: Types.ObjectId;
  name: string;
  sku: string;
  categoryId?: Types.ObjectId | null;
  qty: number;
  revenue: number;
  cost: number;
  profit: number;
};

export async function bestSellers(ctx: Ctx, f: BestSellersQuery): Promise<BestSellersDto> {
  const branchIds = assertReportBranches(ctx, f.branchIds);
  const period = periodMatch(branchIds, f);

  const rows = await Sale.aggregate<BestRaw>([
    { $match: period },
    { $unwind: '$items' },
    {
      $group: {
        _id: '$items.productId',
        name: { $last: '$items.name' },
        sku: { $last: '$items.sku' },
        qty: { $sum: '$items.qty' },
        revenue: { $sum: '$items.net' }, // the line's share after line AND cart discounts
        cost: { $sum: { $multiply: ['$items.unitCost', '$items.qty'] } }, // the cost snapshot, never today's
      },
    },
    {
      $unionWith: {
        coll: 'returns',
        pipeline: [
          { $match: period },
          { $unwind: '$items' },
          {
            $group: {
              _id: '$items.productId',
              qty: { $sum: { $multiply: ['$items.qty', -1] } },
              revenue: { $sum: { $multiply: ['$items.net', -1] } },
              // returned units were not "sold": reverse their cost whether restocked or written off
              cost: { $sum: { $multiply: ['$items.unitCost', '$items.qty', -1] } },
            },
          },
        ],
      },
    },
    {
      $group: {
        _id: '$_id',
        name: { $max: '$name' }, // the returns rows have no name: $max skips null ($first wouldn't)
        sku: { $max: '$sku' },
        qty: { $sum: '$qty' },
        revenue: { $sum: '$revenue' },
        cost: { $sum: '$cost' },
      },
    },
    { $match: { qty: { $gt: 0 } } },
    { $addFields: { profit: { $subtract: ['$revenue', '$cost'] } } },
    {
      // Category as of TODAY (sale lines don't snapshot categories). Only the distinct products get here.
      $lookup: {
        from: 'products',
        localField: '_id',
        foreignField: '_id',
        pipeline: [{ $project: { categoryId: 1 } }],
        as: 'product',
      },
    },
    { $set: { categoryId: { $first: '$product.categoryId' } } },
    ...(f.categoryId ? [{ $match: { categoryId: oid(f.categoryId) } }] : []),
    { $sort: { [f.sortBy]: -1, _id: 1 } },
    { $limit: f.limit },
    {
      $project: {
        _id: 0,
        productId: '$_id',
        name: 1,
        sku: 1,
        categoryId: 1,
        qty: 1,
        revenue: 1,
        cost: 1,
        profit: 1,
      },
    },
  ] as PipelineStage[]);

  return {
    branches: await reportBranches(branchIds),
    rows: rows.map((r) => ({
      productId: String(r.productId),
      sku: r.sku,
      name: r.name,
      categoryId: r.categoryId ? String(r.categoryId) : null,
      qty: r.qty,
      revenue: r.revenue,
      cost: r.cost,
      profit: r.profit,
      marginBps: r.revenue > 0 ? signedDiv(r.profit * 10_000, r.revenue) : 0,
    })),
  };
}

/* ---------- §20.1 profit per branch · FR-RPT-03 ---------- */

type ProfitRaw = Omit<ProfitRowDto, 'marginBps'> & { branchId: Types.ObjectId };
const PROFIT_ZERO: Omit<ProfitRowDto, 'marginBps'> = {
  sales: 0,
  returns: 0,
  netSales: 0,
  cogs: 0,
  refunds: 0,
  grossProfit: 0,
  shrinkage: 0,
  profitAfterShrinkage: 0,
};
/** Margin = gross profit ÷ net sales, 0 when there are no net sales. */
const withMargin = (r: Omit<ProfitRowDto, 'marginBps'>): ProfitRowDto => ({
  ...r,
  marginBps: r.netSales > 0 ? signedDiv(r.grossProfit * 10_000, r.netSales) : 0,
});

export async function profitByBranch(ctx: Ctx, f: PeriodQuery): Promise<ProfitDto> {
  const branchIds = assertReportBranches(ctx, f.branchIds);
  const period = periodMatch(branchIds, f);

  const rows = await Sale.aggregate<ProfitRaw>([
    { $match: period },
    {
      $group: {
        _id: '$branchId',
        salesNet: { $sum: '$totals.net' },
        salesCost: { $sum: '$totals.cost' },
        sales: { $sum: 1 },
      },
    },
    {
      $unionWith: {
        coll: 'returns',
        pipeline: [
          { $match: period },
          {
            $group: {
              _id: '$branchId',
              refundNet: { $sum: '$totals.net' },
              costRestocked: { $sum: '$totals.costRestocked' },
              writeOff: { $sum: '$totals.writeOff' },
              returns: { $sum: 1 },
            },
          },
        ],
      },
    },
    {
      $unionWith: {
        coll: 'stockMovements',
        pipeline: [
          // { branchId, type, businessDate } index. Opening stock is not shrinkage.
          { $match: { ...period, type: 'adjustment', reason: { $in: SHRINKAGE_REASONS } } },
          { $group: { _id: '$branchId', adjustValue: { $sum: '$valueChange' } } },
        ],
      },
    },
    {
      $group: {
        _id: '$_id',
        sales: { $sum: '$sales' },
        returns: { $sum: '$returns' },
        salesNet: { $sum: '$salesNet' },
        salesCost: { $sum: '$salesCost' },
        refundNet: { $sum: '$refundNet' },
        costRestocked: { $sum: '$costRestocked' },
        writeOff: { $sum: '$writeOff' },
        adjustValue: { $sum: '$adjustValue' },
      },
    },
    {
      $project: {
        _id: 0,
        branchId: '$_id',
        sales: 1,
        returns: 1,
        netSales: { $subtract: ['$salesNet', '$refundNet'] },
        // returned units weren't sold: their cost leaves COGS (restocked or not)…
        cogs: { $subtract: ['$salesCost', { $add: ['$costRestocked', '$writeOff'] }] },
        refunds: '$refundNet',
        // …and a written-off return is a LOSS, so it moves to shrinkage. Negative = loss.
        shrinkage: { $subtract: ['$adjustValue', '$writeOff'] },
      },
    },
    { $addFields: { grossProfit: { $subtract: ['$netSales', '$cogs'] } } },
    { $addFields: { profitAfterShrinkage: { $add: ['$grossProfit', '$shrinkage'] } } },
  ]);

  // Every selected branch gets a row (zeros if nothing happened), biggest net sales first.
  const byBranch = new Map(rows.map((r) => [String(r.branchId), r]));
  const branches = await reportBranches(branchIds);
  const out = branches
    .map((b) => {
      const r = byBranch.get(b.branchId);
      const sums = r
        ? (Object.fromEntries(
            Object.keys(PROFIT_ZERO).map((k) => [k, r[k as keyof typeof PROFIT_ZERO]]),
          ) as Omit<ProfitRowDto, 'marginBps'>)
        : { ...PROFIT_ZERO };
      return { ...b, ...withMargin(sums) };
    })
    .sort((a, b) => b.netSales - a.netSales || a.code.localeCompare(b.code));
  // The total row sums every column, then recomputes the margin from the sums (never averages margins).
  const total = withMargin(
    Object.fromEntries(
      Object.keys(PROFIT_ZERO).map((k) => [k, out.reduce((s, r) => s + r[k as keyof typeof PROFIT_ZERO], 0)]),
    ) as Omit<ProfitRowDto, 'marginBps'>,
  );
  return { rows: out, total };
}

/* ---------- §20.2 monthly trends · FR-RPT-04 ---------- */

/** '2026-10' → Date('2026-10-01T00:00:00Z'): month steps on UTC midnights for $densify. */
export const utcMonthStart = (month: string) => new Date(`${month}-01T00:00:00Z`);

type MonthRaw = {
  branchId: Types.ObjectId | null;
  month: string;
  netSales: number;
  grossProfit: number;
  sales: number;
  total: number;
  prevNet: number | null;
  movingSum: number;
  movingCount: number;
};

async function monthlyPipeline(
  branchIds: Types.ObjectId[],
  firstMonth: string,
  thisMonth: string,
  perBranch: boolean,
): Promise<MonthRaw[]> {
  const period = periodMatch(branchIds, { from: `${firstMonth}-01`, to: `${thisMonth}-31` });
  const key = { month: { $substrBytes: ['$businessDate', 0, 7] }, branchId: perBranch ? '$branchId' : null };
  return Sale.aggregate<MonthRaw>([
    { $match: period },
    {
      $group: {
        _id: key,
        net: { $sum: '$totals.net' },
        cost: { $sum: '$totals.cost' },
        total: { $sum: '$totals.total' },
        sales: { $sum: 1 },
      },
    },
    {
      $unionWith: {
        coll: 'returns',
        pipeline: [
          { $match: period },
          {
            $group: {
              _id: key,
              refundNet: { $sum: '$totals.net' },
              refundCost: { $sum: { $add: ['$totals.costRestocked', '$totals.writeOff'] } },
            },
          },
        ],
      },
    },
    {
      $group: {
        _id: '$_id',
        net: { $sum: '$net' },
        cost: { $sum: '$cost' },
        total: { $sum: '$total' },
        sales: { $sum: '$sales' },
        refundNet: { $sum: '$refundNet' },
        refundCost: { $sum: '$refundCost' },
      },
    },
    {
      $project: {
        _id: 0,
        branchId: '$_id.branchId',
        monthStart: { $dateFromString: { dateString: { $concat: ['$_id.month', '-01'] }, timezone: 'UTC' } },
        netSales: { $subtract: ['$net', '$refundNet'] },
        grossProfit: {
          $subtract: [{ $subtract: ['$net', '$refundNet'] }, { $subtract: ['$cost', '$refundCost'] }],
        },
        sales: 1,
        total: 1,
      },
    },
    // Months with no sales at all (per branch) get rows, so the window functions see every month.
    // The upper bound is EXCLUSIVE: next month, or this month would never be generated.
    {
      $densify: {
        field: 'monthStart',
        partitionByFields: ['branchId'],
        range: {
          step: 1,
          unit: 'month',
          bounds: [utcMonthStart(firstMonth), utcMonthStart(addMonths(thisMonth, 1))],
        },
      },
    },
    {
      $fill: {
        partitionByFields: ['branchId'],
        sortBy: { monthStart: 1 },
        output: {
          netSales: { value: 0 },
          grossProfit: { value: 0 },
          sales: { value: 0 },
          total: { value: 0 },
        },
      },
    },
    {
      // Raw window sums: the division (half up, like every money rule) happens in TS, not in $round.
      $setWindowFields: {
        partitionBy: '$branchId',
        sortBy: { monthStart: 1 },
        output: {
          prevNet: { $shift: { output: '$netSales', by: -1, default: null } },
          movingSum: { $sum: '$netSales', window: { documents: [-2, 0] } },
          movingCount: { $sum: 1, window: { documents: [-2, 0] } },
        },
      },
    },
    {
      $project: {
        _id: 0,
        branchId: 1,
        netSales: 1,
        grossProfit: 1,
        sales: 1,
        total: 1,
        prevNet: 1,
        movingSum: 1,
        movingCount: 1,
        month: { $dateToString: { date: '$monthStart', format: '%Y-%m', timezone: 'UTC' } },
      },
    },
    { $sort: { branchId: 1, month: 1 } },
  ] as PipelineStage[]);
}

const toMonthRow = (r: MonthRaw): MonthRowDto => ({
  month: r.month,
  netSales: r.netSales,
  grossProfit: r.grossProfit,
  sales: r.sales,
  total: r.total,
  avgBasket: divRoundHalfUp(r.total, r.sales),
  // no previous month, or it was 0: growth is undefined, not "infinite"
  growthBps:
    r.prevNet !== null && r.prevNet > 0 ? signedDiv((r.netSales - r.prevNet) * 10_000, r.prevNet) : null,
  movingAvg3: signedDiv(r.movingSum, r.movingCount),
});

/** All-zero months for a series that had no documents at all ($densify can only extend partitions that exist). */
function zeroMonths(firstMonth: string, n: number): MonthRowDto[] {
  return Array.from({ length: n }, (_, i) => ({
    month: addMonths(firstMonth, i),
    netSales: 0,
    grossProfit: 0,
    sales: 0,
    total: 0,
    avgBasket: 0,
    growthBps: null,
    movingAvg3: 0,
  }));
}

export async function monthlyTrends(ctx: Ctx, f: MonthlyQuery): Promise<MonthlyDto> {
  const branchIds = assertReportBranches(ctx, f.branchIds);
  const thisMonth = toBusinessDate(ctx.now(), ctx.settings.timezone).slice(0, 7); // '2026-10'
  const firstMonth = addMonths(thisMonth, -(f.months - 1));
  // Two runs in parallel: one series per branch, and the shop total (branchId: null = one partition).
  const [per, shop, branches] = await Promise.all([
    monthlyPipeline(branchIds, firstMonth, thisMonth, true),
    monthlyPipeline(branchIds, firstMonth, thisMonth, false),
    reportBranches(branchIds),
  ]);
  const series = (b: ReportBranchDto) => {
    const rows = per.filter((r) => String(r.branchId) === b.branchId);
    return rows.length ? rows.map(toMonthRow) : zeroMonths(firstMonth, f.months);
  };
  return {
    branches,
    perBranch: branches.map((b) => ({ ...b, months: series(b) })),
    shop: shop.length ? shop.map(toMonthRow) : zeroMonths(firstMonth, f.months),
  };
}
