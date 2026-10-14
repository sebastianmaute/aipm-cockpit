// src/app/use-denomination-epoch.ts
//
// §476 — the money DENOMINATION as a component of the undo epoch.
//
// A baseline-currency switch (`BaselineCurrencyControl`) re-denominates every stored
// money field: role rates, bucket overrides, change cost impacts. An undo or redo image
// taken before it holds amounts in the OLD currency, so replaying one after the switch
// writes `{ costImpact: 1000 }` (EUR) back to be read as £1000. The stack already drops
// an entry whose epoch moved (§628), so this hook counts every change of the
// denomination and `useStorageBackend` adds the count to `getUndoEpoch`.
//
// ★ The key is the plan's currency PLUS the history length, not the currency alone. A
//   round trip (EUR→GBP→EUR) seen step by step moves the count twice either way, but one
//   that reaches this window in ONE apply (a peer tab's synced state, coalesced) ends on
//   the same currency with the amounts converted twice — only the history length sees it.
// ★ Derived from the LIVE slices, so a peer tab whose synced workspace carries the
//   switch moves too — its own pre-switch stack is retired without any message.
// ★ A project load usually changes the key as well. That is harmless: the scope epoch
//   has moved for a different project anyway, and the components only ever increase,
//   so their sum moves whenever any one of them does.
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Returns a STABLE reader of how many times the denomination has changed since mount.
 * `onChange` runs after each change commits (`useStorageBackend` passes the undo
 * stack's `pruneStale`, so the retired entries leave the history at once rather than
 * on the next Ctrl+Z).
 */
export function useDenominationEpoch(currency: string, historyLength: number, onChange?: () => void): () => number {
  const key = `${currency}|${historyLength}`;
  const [seen, setSeen] = useState({ key, count: 0 });
  // Render-time reconcile (`set-state-in-effect` is banned).
  if (seen.key !== key) setSeen({ key, count: seen.count + 1 });
  const countRef = useRef(0);
  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; }, [onChange]);
  useEffect(() => {
    countRef.current = seen.count;
    if (seen.count > 0) onChangeRef.current?.();
  }, [seen.count]);
  return useCallback(() => countRef.current, []);
}
