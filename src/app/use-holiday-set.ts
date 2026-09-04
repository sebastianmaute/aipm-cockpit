"use client";
import { useEffect, useMemo, useState } from "react";
import { holidaysForCountries } from "./holidays";

interface UseHolidaySetArgs {
  holidayCountries: string[];
}

/** The set plus the readiness flag plus the countries they answer FOR. One
 *  object so a reader can never observe a set from one country list beside a
 *  readiness flag from another. */
interface HolidayState {
  readonly set: Set<string>;
  readonly ready: boolean;
  readonly key: string;
}

export function useHolidaySet({ holidayCountries }: UseHolidaySetArgs): {
  holidaySet: Set<string>;
  /** ★★★ FALSE means "this set cannot be read as an answer" — the fetch has
   *  not resolved yet, or it REJECTED. A consumer deciding whether a date is
   *  a holiday must not treat a not-ready empty set as "no holidays": that is
   *  how a rule reports itself evaluated while blind, and `reconcileInsights`
   *  reads a rule that produced nothing as RESOLVED. See the floor on
   *  `timelogNonWorkingDay` in `timelog-policy.ts`.
   *  ★ An empty `holidayCountries` reaches ready = TRUE. A user who configured
   *  no countries has a legitimately empty set, which is a real answer. */
  holidaysReady: boolean;
} {
  // ★★★ THE DERIVED KEY IS THE ONLY THING THIS HOOK REACTS TO, and that is a
  // fix, not a shortcut. Keying the effect on the ARRAY meant its identity, so
  // a caller passing a fresh literal (`useHolidaySet({ holidayCountries: [...] })`
  // inline) re-ran the fetch on EVERY render — and every resolve stores a new
  // `Set`, which is a new state identity, which is another render. Resolve →
  // render → re-fetch → resolve is an unbounded loop; it stayed invisible only
  // because the app's one hot call site threads a stable `settings` field and
  // the old test resolved before anyone waited for quiescence. Measured: a test
  // whose fetch REJECTS (nothing to settle on) spins until the 20s timeout.
  // ★ Ordering is significant only in that a reorder re-fetches, which is
  // harmless — the resolved set is identical either way.
  const key = holidayCountries.join(",");
  const [state, setState] = useState<HolidayState>(() => ({
    set: new Set<string>(),
    ready: false,
    key,
  }));

  // Render-time reconcile, NOT a useEffect: `react-hooks/set-state-in-effect`
  // is banned and fatal. A change of countries invalidates BOTH halves at
  // once, so no render can report ready against the previous countries' data.
  if (state.key !== key) {
    setState({ set: new Set<string>(), ready: false, key });
  }

  // Round-tripped from the key rather than passed through, so the value
  // FETCHED and the value KEYED ON cannot disagree. `"".split(",")` is `[""]`,
  // not `[]`, hence the guard — an empty list must stay empty or the fetch
  // would ask for a country code of "".
  const codes = useMemo(() => (key === "" ? [] : key.split(",")), [key]);

  useEffect(() => {
    let cancelled = false;
    void holidaysForCountries(codes)
      .then((set) => {
        if (!cancelled) setState({ set, ready: true, key });
      })
      .catch(() => {
        // Without this the rejection is UNHANDLED and readiness would keep
        // whatever it had. Stay empty and NOT ready: a failed fetch is an
        // absent answer, never an empty one.
        if (!cancelled) setState({ set: new Set<string>(), ready: false, key });
      });
    return () => {
      cancelled = true;
    };
  }, [codes, key]);

  return { holidaySet: state.set, holidaysReady: state.ready };
}
