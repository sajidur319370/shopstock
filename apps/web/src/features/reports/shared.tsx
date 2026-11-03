import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { http } from '@/api/client';
import { useActor } from '@/features/auth/useActor';
import { useFormat } from '@/lib/useFormat';

/** One fixed colour per branch, by its place in MY branch list (A→Z): GUL is the same colour everywhere. */
const PALETTE = ['#2563eb', '#16a34a', '#d97706', '#9333ea', '#dc2626', '#0891b2', '#4b5563', '#db2777'];
export function useBranchColor() {
  const { branches } = useActor();
  const codes = [...branches.map((b) => b.code)].sort();
  return (code: string) => PALETTE[codes.indexOf(code) % PALETTE.length] ?? PALETTE[0]!;
}

/** Money for tables and tooltips; compact major units for axes ("12.5K"); bps as a signed percent. */
export function useReportFormat() {
  const { settings } = useActor();
  const { money } = useFormat();
  const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
  return {
    money,
    tick: (v: number) => compact.format(v / 10 ** settings.currency.minorUnits),
    pct: (bps: number | null) => (bps === null ? '—' : `${bps > 0 ? '+' : ''}${(bps / 100).toFixed(1)}%`),
  };
}

export type ReportScope = { from: string; to: string; branchIds: string[] };

/** GET /api/reports/<path>?from&to&branchIds (none = all mine) + extra params. */
export function useReport<T>(
  path: string,
  params: Record<string, string | number | undefined>,
  enabled = true,
) {
  const sp = new URLSearchParams(
    Object.entries(params).filter(
      (e): e is [string, string | number] => e[1] !== undefined && e[1] !== '',
    ) as [string, string][],
  );
  return useQuery({
    queryKey: ['report', path, sp.toString()],
    queryFn: () => http.get<T>(`/reports/${path}?${sp}`),
    enabled,
    staleTime: 60_000,
    placeholderData: (prev) => prev, // keep the old chart while a new period loads
  });
}

/** A chart is described for screen readers; the table under it is the accessible version (NFR-A11Y-01). */
export function ChartFigure({
  title,
  summary,
  children,
}: {
  title: string;
  summary: string;
  children: ReactNode;
}) {
  return (
    <figure className="space-y-2">
      <figcaption className="font-medium">{title}</figcaption>
      <div role="img" aria-label={summary} className="h-72 w-full">
        {children}
      </div>
    </figure>
  );
}

export const Empty = ({ children }: { children: ReactNode }) => (
  <p className="rounded-md border border-dashed p-6 text-center text-sm text-gray-500">{children}</p>
);
