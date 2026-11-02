import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { usePosUi } from './cartStore';

const SHORTCUTS: [string, string][] = [
  ['/', 'Focus the search box'],
  ['Enter', 'Add the scanned/typed product (exact barcode or SKU first)'],
  ['↑ ↓', 'Pick a search result · with an empty search box: select a cart line'],
  ['+ −', 'Change the selected line’s quantity (empty search box)'],
  ['Delete', 'Remove the selected line (empty search box)'],
  ['F7', 'Discount on the selected line'],
  ['F8', 'Discount on the whole cart'],
  ['F9', 'Pay'],
  ['Esc', 'Clear the search box / close a dialog'],
  ['?', 'This help'],
];

export function ShortcutHelp({ onClosed }: { onClosed: () => void }) {
  const open = usePosUi((s) => s.helpOpen);
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        usePosUi.getState().setHelpOpen(o);
        if (!o) onClosed();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
        </DialogHeader>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          {SHORTCUTS.map(([key, what]) => (
            <div key={key} className="contents">
              <dt>
                <kbd className="rounded border bg-gray-50 px-1.5 py-0.5 font-mono text-xs">{key}</kbd>
              </dt>
              <dd>{what}</dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}
