/**
 * Dashboards (queries.md §17). "Today" is the shop's BUSINESS date, matched on the
 * { branchId, businessDate } index; hours are bucketed in the shop timezone, never UTC.
 * No cost or profit here: money analysis lives in the reports (Day 19).
 */
import type { Types } from 'mongoose';
import {
  divRoundHalfUp,
  PAYMENT_METHODS,
  PO_OPEN_STATUSES,
  toBusinessDate,
  type BranchDashboardDto,
  type OverviewDto,
  type PaymentMethod,
  type PoStatus,
  type ShiftDashboardDto,
} from '@shopstock/shared';
import { PurchaseOrder, Sale, SaleReturn, Transfer } from '../../db/models';
import { listBranches } from '../../lib/cache';
import { canAccess, type BranchCtx, type Ctx } from '../../types/ctx';
import { lowStockSummary } from '../inventory/lowStock.service';
import { myShiftSummary } from '../sales/sale.service';

type SalesFacet = {
  totals: { count: number; net: number; total: number }[];
  byMethod: { _id: PaymentMethod; amount: number }[];
  byHour: { _id: number; count: number; total: number }[];
  recent: {
    _id: Types.ObjectId;
    invoiceNo: string;
    cashierName: string;
    totals: { total: number };
    createdAt: Date;
  }[];
};

const iso = (d?: Date | null) => (d ? d.toISOString() : null);

/** FR-DSH-01 (Manager+). The sales part is ONE $facet round trip; the rest run in parallel with it. */
export async function branchDashboard(ctx: BranchCtx): Promise<BranchDashboardDto> {
  const today = toBusinessDate(ctx.now(), ctx.settings.timezone);
  const tz = ctx.settings.timezone;

  const [[sales], [refunds], lowStock, incoming, outgoingPending, openPOs] = await Promise.all([
    Sale.aggregate<SalesFacet>([
      { $match: { branchId: ctx.branchId, businessDate: today } }, // { branchId, businessDate } index
      {
        $facet: {
          totals: [
            {
              $group: {
                _id: null,
                count: { $sum: 1 },
                net: { $sum: '$totals.net' },
                total: { $sum: '$totals.total' },
              },
            },
          ],
          byMethod: [
            { $unwind: '$payments' },
            {
              $group: {
                _id: '$payments.method',
                // Cash COLLECTED = tendered − change, like the shift summary (what's in the drawer)
                amount: {
                  $sum: {
                    $cond: [
                      { $eq: ['$payments.method', 'cash'] },
                      { $subtract: ['$payments.amount', '$change'] },
                      '$payments.amount',
                    ],
                  },
                },
              },
            },
          ],
          byHour: [
            {
              $group: {
                _id: { $hour: { date: '$createdAt', timezone: tz } }, // shop time, not UTC
                count: { $sum: 1 },
                total: { $sum: '$totals.total' },
              },
            },
          ],
          recent: [
            { $sort: { createdAt: -1, _id: -1 } }, // in memory over today's sales only (≤ ~1,000)
            { $limit: 10 },
            { $project: { invoiceNo: 1, cashierName: 1, 'totals.total': 1, createdAt: 1 } },
          ],
        },
      },
    ]),
    SaleReturn.aggregate<{ count: number; amount: number }>([
      { $match: { branchId: ctx.branchId, businessDate: today } }, // returns count on the day they HAPPEN
      { $group: { _id: null, count: { $sum: 1 }, amount: { $sum: '$totals.total' } } },
    ]),
    lowStockSummary(ctx),
    Transfer.find({ toBranchId: ctx.branchId, status: 'in_transit' })
      .select('transferNo fromCode items.qty dispatchedAt')
      .sort({ dispatchedAt: 1 })
      .lean(),
    Transfer.countDocuments({ fromBranchId: ctx.branchId, status: 'pending' }),
    PurchaseOrder.find({ branchId: ctx.branchId, status: { $in: PO_OPEN_STATUSES } })
      .select('poNumber supplierName status expectedDate')
      .sort({ createdAt: -1 })
      .limit(10)
      .lean(),
  ]);

  // $group over NO documents produces no row: every facet defaults to zeros, never undefined.
  const t = sales?.totals[0] ?? { count: 0, net: 0, total: 0 };
  const hours = new Map((sales?.byHour ?? []).map((h) => [h._id, h]));
  return {
    kind: 'branch',
    today,
    sales: { count: t.count, net: t.net, total: t.total, avgBasket: divRoundHalfUp(t.total, t.count) },
    byMethod: Object.fromEntries(
      PAYMENT_METHODS.map((m) => [m, sales?.byMethod.find((b) => b._id === m)?.amount ?? 0]),
    ) as Record<PaymentMethod, number>,
    byHour: Array.from({ length: 24 }, (_, hour) => ({
      hour,
      count: hours.get(hour)?.count ?? 0,
      total: hours.get(hour)?.total ?? 0,
    })),
    refunds: { count: refunds?.count ?? 0, amount: refunds?.amount ?? 0 },
    lowStock,
    incomingTransfers: incoming.map((x) => ({
      id: String(x._id),
      transferNo: x.transferNo,
      fromCode: x.fromCode,
      units: x.items.reduce((s, i) => s + i.qty, 0),
      dispatchedAt: iso(x.dispatchedAt),
    })),
    outgoingPending,
    openPOs: openPOs.map((p) => ({
      id: String(p._id),
      poNumber: p.poNumber,
      supplierName: p.supplierName,
      status: p.status as PoStatus,
      expectedDate: p.expectedDate ?? null,
    })),
    recentSales: (sales?.recent ?? []).map((s) => ({
      id: String(s._id),
      invoiceNo: s.invoiceNo,
      cashierName: s.cashierName,
      total: s.totals.total,
      createdAt: s.createdAt.toISOString(),
    })),
  };
}

/** FR-DSH-02 (cashier): their own shift (Day 13's summary) and the branch's low-stock COUNT only. */
export async function shiftDashboard(ctx: BranchCtx): Promise<ShiftDashboardDto> {
  const [shift, low] = await Promise.all([myShiftSummary(ctx), lowStockSummary(ctx)]);
  return {
    kind: 'shift',
    today: toBusinessDate(ctx.now(), ctx.settings.timezone),
    shift,
    lowStockCount: low.lowCount + low.outCount,
  };
}

/** FR-DSH-03 (report:view): one row per branch the actor may see, zeros where nothing happened, plus totals. */
export async function overview(ctx: Ctx): Promise<OverviewDto> {
  const today = toBusinessDate(ctx.now(), ctx.settings.timezone);
  const branches = (await listBranches()).filter((b) => canAccess(ctx, b._id));
  const [sales, incoming, low] = await Promise.all([
    Sale.aggregate<{ _id: Types.ObjectId; count: number; total: number; net: number }>([
      { $match: { branchId: { $in: ctx.branchIds }, businessDate: today } },
      {
        $group: {
          _id: '$branchId',
          count: { $sum: 1 },
          total: { $sum: '$totals.total' },
          net: { $sum: '$totals.net' },
        },
      },
    ]),
    Transfer.aggregate<{ _id: Types.ObjectId; n: number }>([
      { $match: { toBranchId: { $in: ctx.branchIds }, status: 'in_transit' } },
      { $group: { _id: '$toBranchId', n: { $sum: 1 } } },
    ]),
    // One small pipeline per branch, in parallel (≤ 50 branches).
    Promise.all(branches.map((b) => lowStockSummary({ ...ctx, branchId: b._id, branchCode: b.code }))),
  ]);
  const salesBy = new Map(sales.map((s) => [String(s._id), s]));
  const incomingBy = new Map(incoming.map((x) => [String(x._id), x.n]));
  const rows = branches.map((b, i) => {
    const s = salesBy.get(String(b._id));
    return {
      branchId: String(b._id),
      code: b.code,
      name: b.name,
      isActive: b.isActive, // inactive branches stay listed (flagged) for the Owner
      sales: { count: s?.count ?? 0, net: s?.net ?? 0, total: s?.total ?? 0 },
      lowCount: low[i]!.lowCount,
      outCount: low[i]!.outCount,
      incomingTransfers: incomingBy.get(String(b._id)) ?? 0,
    };
  });
  const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((a, r) => a + f(r), 0);
  return {
    today,
    branches: rows,
    totals: {
      sales: {
        count: sum((r) => r.sales.count),
        net: sum((r) => r.sales.net),
        total: sum((r) => r.sales.total),
      },
      lowCount: sum((r) => r.lowCount),
      outCount: sum((r) => r.outCount),
      incomingTransfers: sum((r) => r.incomingTransfers),
    },
  };
}
