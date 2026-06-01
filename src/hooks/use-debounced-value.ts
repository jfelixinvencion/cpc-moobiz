import { useEffect, useState } from "react";

/** Retrasa la propagación de `value` por `ms` (p. ej. búsquedas autocomplete). */
export function useDebouncedValue<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);

  return debounced;
}
