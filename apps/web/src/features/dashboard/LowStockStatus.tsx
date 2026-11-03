/** Icon + text, never colour alone (NFR-A11Y-02). */
export function LowStockStatus({ status }: { status: 'low' | 'out' }) {
  return status === 'out' ? (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-red-700">
      <span aria-hidden>✕</span> Out
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700">
      <span aria-hidden>▲</span> Low
    </span>
  );
}
