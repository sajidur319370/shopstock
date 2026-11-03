import { useState } from 'react';
import { fromMinor, toMinor } from '@shopstock/shared';
import { Input } from '@/components/ui/input';
import { useActor } from '@/features/auth/useActor';

type Props = {
  id?: string;
  value: number | null;
  onChange: (minor: number | null) => void;
  placeholder?: string;
  autoFocus?: boolean;
  'aria-invalid'?: boolean;
  'aria-label'?: string;
};

/** Typed text → integer minor units. Never parseFloat. `null` while the text isn't a valid amount. */
export function MoneyInput({ value, onChange, ...rest }: Props) {
  const { settings } = useActor();
  const mu = settings.currency.minorUnits;
  const [text, setText] = useState(value == null ? '' : fromMinor(value, mu));
  const [seen, setSeen] = useState(value);

  // The value changed from OUTSIDE (form reset): re-sync the text. Done during render, not in an effect,
  // and only when the text doesn't already mean that value, so typing "12." never jumps the cursor.
  if (value !== seen) {
    setSeen(value);
    if (value == null ? text.trim() !== '' && toMinor(text, mu) != null : toMinor(text, mu) !== value) {
      setText(value == null ? '' : fromMinor(value, mu));
    }
  }

  return (
    <div className="relative">
      <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-gray-500">
        {settings.currency.symbol}
      </span>
      <Input
        {...rest}
        inputMode="decimal"
        autoComplete="off"
        className="pl-7 text-right tabular-nums"
        value={text}
        onChange={(e) => {
          const next = e.target.value;
          const minor = next.trim() === '' ? null : toMinor(next, mu);
          setText(next);
          setSeen(minor);
          onChange(minor);
        }}
      />
    </div>
  );
}
