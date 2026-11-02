import { useState } from 'react';
import { fromMinor, toMinor } from '@shopstock/shared';
import { Input } from '@/components/ui/input';

type Props = {
  id?: string;
  value: number | null;
  onChange: (bps: number | null) => void;
  /** Highest allowed percent (e.g. 50 for VAT). */
  max?: number;
  autoFocus?: boolean;
  'aria-invalid'?: boolean;
};

/** '7.5' → 750 bps (1 bps = 0.01%, so it's just toMinor(text, 2)). 750 → '7.5'. */
const bpsToText = (bps: number) => fromMinor(bps, 2).replace(/\.?0+$/, '');

/** Percent text ↔ integer basis points. Never parseFloat. `null` while invalid or above `max`. */
export function PercentInput({ value, onChange, max = 100, ...rest }: Props) {
  const [text, setText] = useState(value == null ? '' : bpsToText(value));
  const [seen, setSeen] = useState(value);

  if (value !== seen) {
    // Changed from outside (form reset): re-sync, unless the text already means this value.
    setSeen(value);
    if (value != null && toMinor(text, 2) !== value) setText(bpsToText(value));
    if (value == null && toMinor(text, 2) != null) setText('');
  }

  return (
    <div className="relative">
      <Input
        {...rest}
        inputMode="decimal"
        autoComplete="off"
        className="pr-7 text-right tabular-nums"
        value={text}
        onChange={(e) => {
          const bps = toMinor(e.target.value, 2);
          const next = bps != null && bps <= max * 100 ? bps : null;
          setText(e.target.value);
          setSeen(next);
          onChange(next);
        }}
      />
      <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-gray-500">%</span>
    </div>
  );
}
