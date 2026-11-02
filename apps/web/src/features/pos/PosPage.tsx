import { useCallback, useEffect, useRef } from 'react';
import { useActor } from '@/features/auth/useActor';
import { useBranch } from '@/features/branch/useBranch';
import { CartTable } from './CartTable';
import { useCart } from './cartStore';
import { DiscountDialog } from './DiscountDialog';
import { PayDialog } from './PayDialog';
import { PosSearch } from './PosSearch';
import { ShortcutHelp } from './ShortcutHelp';
import { TotalsPanel } from './TotalsPanel';
import { usePosShortcuts } from './usePosShortcuts';

export function PosPage() {
  const branch = useBranch();
  const { user } = useActor();
  const searchRef = useRef<HTMLInputElement>(null);
  // Focus discipline: after every action the cursor goes back to the search box.
  const focusSearch = useCallback(() => setTimeout(() => searchRef.current?.focus(), 0), []);

  // A cart started at GUL must never be submitted to DHN.
  useEffect(() => {
    if (useCart.getState().branchCode !== branch.code) useCart.getState().reset(branch.code);
  }, [branch.code]);

  usePosShortcuts({ searchRef, focusSearch });

  if (!branch.isActive) {
    return (
      <p className="rounded bg-amber-100 p-4 text-amber-900">
        {branch.code} is inactive: no sales can be made here (FR-POS-16).
      </p>
    );
  }

  return (
    <div className="flex h-[calc(100vh-7rem)] flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <h1 className="text-lg font-semibold">
          POS · {branch.code} · {user.name}
        </h1>
        <span className="text-xs text-gray-500">Press ? for shortcuts</span>
      </div>
      <PosSearch inputRef={searchRef} onAdded={focusSearch} />
      <div className="grid min-h-0 flex-1 gap-3 md:grid-cols-[1fr_320px]">
        <CartTable onChanged={focusSearch} />
        <TotalsPanel onDone={focusSearch} />
      </div>
      <DiscountDialog onClosed={focusSearch} />
      <PayDialog onClosed={focusSearch} />
      <ShortcutHelp onClosed={focusSearch} />
    </div>
  );
}
