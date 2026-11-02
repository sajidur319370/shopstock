import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ProductDto, SearchResponse } from '@shopstock/shared';
import { http } from '@/api/client';
import { qk } from '@/api/keys';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { useDebounce } from '@/lib/useDebounce';

/**
 * Type → debounced /products/search → pick with arrows + Enter (or a click) → onPick(product).
 * Reused for adjustments today, and for purchase orders and transfers later.
 */
export function ProductPicker({
  onPick,
  placeholder = 'Search by name, SKU or barcode…',
  exclude = [],
  autoFocus,
}: {
  onPick: (p: ProductDto) => void;
  placeholder?: string;
  exclude?: string[];
  autoFocus?: boolean;
}) {
  const [q, setQ] = useState('');
  const debounced = useDebounce(q.trim(), 150);
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState(false);
  const search = useQuery({
    queryKey: qk.productSearch(debounced),
    queryFn: () => http.get<SearchResponse>(`/products/search?q=${encodeURIComponent(debounced)}`),
    enabled: debounced.length >= 2,
    staleTime: 10_000,
  });
  const results = (search.data?.results ?? []).filter((p) => !exclude.includes(p.id));
  const shown = open && debounced.length >= 2;

  const pick = (p: ProductDto) => {
    onPick(p);
    setQ('');
    setActive(0);
  };

  return (
    <div className="relative">
      <Input
        value={q}
        placeholder={placeholder}
        autoFocus={autoFocus}
        role="combobox"
        aria-expanded={shown && results.length > 0}
        aria-autocomplete="list"
        onChange={(e) => {
          setQ(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') setActive((i) => Math.min(i + 1, results.length - 1));
          if (e.key === 'ArrowUp') setActive((i) => Math.max(i - 1, 0));
          if (e.key === 'Escape') setOpen(false);
          if (e.key === 'Enter') {
            e.preventDefault(); // never submit the surrounding form from the search box
            const chosen = results[active];
            if (chosen) pick(chosen);
          }
        }}
      />
      {shown && (
        <ul
          role="listbox"
          className="absolute z-50 mt-1 max-h-72 w-full overflow-auto rounded-md border bg-white shadow"
        >
          {results.map((p, i) => (
            <li
              key={p.id}
              role="option"
              aria-selected={i === active}
              className={cn(
                'flex cursor-pointer justify-between gap-3 px-3 py-2 text-sm',
                i === active && 'bg-gray-100',
              )}
              onMouseDown={(e) => {
                e.preventDefault(); // keep focus in the input
                pick(p);
              }}
              onMouseEnter={() => setActive(i)}
            >
              <span>{p.name}</span>
              <span className="font-mono text-xs text-gray-500">{p.sku}</span>
            </li>
          ))}
          {results.length === 0 && !search.isFetching && (
            <li className="px-3 py-2 text-sm text-gray-500">No matching products</li>
          )}
        </ul>
      )}
    </div>
  );
}
