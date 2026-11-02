import { useEffect, type RefObject } from 'react';
import { useCart, usePosUi } from './cartStore';

/**
 * Keyboard-first POS (FR-POS-11). Line keys (+ − Delete ↑ ↓) act on the cart when focus is NOT in a
 * text field, or when it's in the EMPTY search box (an empty box has nothing to edit, so the cashier
 * never has to leave it). Once something is typed, those keys belong to the search.
 */
export function usePosShortcuts({
  searchRef,
  focusSearch,
}: {
  searchRef: RefObject<HTMLInputElement | null>;
  focusSearch: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const ui = usePosUi.getState();
      if (ui.payOpen || ui.discountFor !== null || ui.helpOpen) return; // an open dialog owns the keyboard
      const s = useCart.getState();
      const target = e.target as HTMLElement;
      const inSearch = target === searchRef.current;
      const searchEmpty = inSearch && (searchRef.current?.value ?? '') === '';
      const typing = (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') && !searchEmpty;

      if (e.key === 'F7') {
        e.preventDefault();
        if (s.selected >= 0) ui.setDiscountFor(s.selected);
        return;
      }
      if (e.key === 'F8') {
        e.preventDefault();
        if (s.lines.length) ui.setDiscountFor('cart');
        return;
      }
      if (e.key === 'F9') {
        e.preventDefault();
        if (s.lines.length) ui.setPayOpen(true);
        return;
      }
      if (typing) return;
      if (e.key === '/' && !inSearch) {
        e.preventDefault();
        focusSearch();
        return;
      }
      if (e.key === '?') {
        e.preventDefault();
        ui.setHelpOpen(true);
        return;
      }
      if (s.selected < 0 || !s.lines.length) return;
      const line = s.lines[s.selected]!;
      const handled: Record<string, () => void> = {
        '+': () => s.setQty(s.selected, line.qty + 1),
        '-': () => s.setQty(s.selected, line.qty - 1),
        Delete: () => s.remove(s.selected),
        ArrowDown: () => s.select(Math.min(s.selected + 1, s.lines.length - 1)),
        ArrowUp: () => s.select(Math.max(s.selected - 1, 0)),
      };
      const run = handled[e.key];
      if (run) {
        e.preventDefault(); // e.g. "+" must not be typed into the empty search box
        run();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [searchRef, focusSearch]);
}
