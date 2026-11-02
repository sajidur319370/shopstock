import { useEffect, useState } from 'react';

/** The value, but only after it stopped changing for `ms` (search-as-you-type without a request per key). */
export function useDebounce<T>(value: T, ms = 150): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}
