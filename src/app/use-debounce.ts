// Returns a value that mirrors `value` after it has stayed stable for at
// least `delay` ms. Each new value resets the timer; the previous pending
// update is cancelled and the cleanup fires when the component unmounts.
//
// Use this when an expensive downstream computation (filter, fetch,
// recompute) should be skipped on every keystroke but still settle quickly
// after typing stops.
//
//   const [search, setSearch] = useState("");
//   const debounced = useDebounce(search, 150);
//   // bind the input to `search` (immediate); read `debounced` in the
//   // filter useMemo so it only re-runs after the user pauses.
//
// Side-effect debouncing (the input value isn't the thing you want to
// memoize, but you want to delay a write/fetch) is NOT this hook's job —
// keep those as inline useEffect + setTimeout where the cancellation
// guard and dependency set are right there to read.

import { useEffect, useState } from "react";

export function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);

  return debounced;
}
