import { useState, type RefObject } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { PosSearchResponse } from '@shopstock/shared';
import { http } from '@/api/client';
import { Input } from '@/components/ui/input';
import { useBranch } from '@/features/branch/useBranch';
import { cn } from '@/lib/utils';
import { useDebounce } from '@/lib/useDebounce';
import { useFormat } from '@/lib/useFormat';
import { useCart } from './cartStore';

type Result = PosSearchResponse['results'][number];

/** Scanner-first: a USB scanner "types" the barcode fast and presses Enter. */
export function PosSearch({
  inputRef,
  onAdded,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  onAdded: () => void;
}) {
  const branch = useBranch();
  const { money } = useFormat();
  const add = useCart((s) => s.add);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const debounced = useDebounce(q.trim(), 150);
  const fetchSearch = (term: string) =>
    http.get<PosSearchResponse>(`/b/${branch.code}/pos/search?q=${encodeURIComponent(term)}`);

  const search = useQuery({
    queryKey: ['pos-search', branch.code, debounced],
    queryFn: () => fetchSearch(debounced),
    enabled: debounced.length >= 2,
    staleTime: 5_000,
  });
  const results = q.trim() && debounced === q.trim() ? (search.data?.results ?? []) : [];

  const setQuery = (v: string) => {
    setQ(v);
    setActive(0);
  };
  const addProduct = (p: Result) => {
    add({ id: p.id, name: p.name, sku: p.sku, price: p.price, onHand: p.onHand });
    setQuery('');
    onAdded();
  };

  const onEnter = async () => {
    const term = q.trim();
    if (!term) return;
    // The scanner hits Enter BEFORE the debounce fires: ask with the FULL term and prefer an exact match.
    const res = search.data && debounced === term ? search.data : await fetchSearch(term).catch(() => null);
    if (!res) return void toast.error('Search failed. Check the connection.');
    const exact = res.results.find((r) => r.id === res.exactId);
    if (exact) return addProduct(exact);
    const picked = res.results[active];
    if (picked) return addProduct(picked);
    toast.error(`No product matches "${term}"`); // FR-POS-02
    inputRef.current?.select();
  };

  return (
    <div className="relative">
      <Input
        ref={inputRef}
        autoFocus
        value={q}
        placeholder="Scan or search…  ( / )"
        aria-label="Scan or search products"
        className="h-12 text-lg"
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void onEnter();
          }
          if (results.length && e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((i) => Math.min(i + 1, results.length - 1));
          }
          if (results.length && e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
          }
          if (e.key === 'Escape') setQuery('');
        }}
      />
      {results.length > 0 && (
        <ul
          role="listbox"
          className="absolute z-40 mt-1 w-full overflow-hidden rounded-md border bg-white shadow-lg"
        >
          {results.map((p, i) => (
            <li
              key={p.id}
              role="option"
              aria-selected={i === active}
              className={cn(
                'grid cursor-pointer grid-cols-[1fr_auto_auto_auto] gap-4 px-3 py-2',
                i === active && 'bg-gray-100',
              )}
              onMouseDown={(e) => {
                e.preventDefault();
                addProduct(p);
              }}
            >
              <span className="font-medium">{p.name}</span>
              <span className="font-mono text-xs text-gray-500">{p.sku}</span>
              <span className="tabular-nums">{money(p.price)}</span>
              <span
                className={cn(
                  'text-sm tabular-nums',
                  p.onHand > 0 ? 'text-gray-600' : 'font-medium text-red-700',
                )}
              >
                {p.onHand > 0 ? `${p.onHand} in stock` : '✕ Out of stock'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
