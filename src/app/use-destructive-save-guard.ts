"use client";

// The DESTRUCTIVE save lockout — the peer of `use-load-truncation.ts`, which
// owns the truncation lockout. Both pause saving, both report an ongoing
// blocking state, and both hand the user one explicit way out; keeping them the
// same shape is what lets ONE banner render either cause.
//
// ★★★ THE TWO LOCKOUTS CANNOT BE ACTIVE AT ONCE, AND IT TAKES TWO MECHANISMS.
// The early return is only half the argument: `use-storage-backend.ts` calls
// `mayCommitAfterIncompleteLoad()` and returns above `evaluate` below, which
// proves a NEW destructive verdict cannot be RAISED while a truncation lockout
// stands — and says nothing about the other order, a STANDING refusal meeting a
// newly-raised truncation. Both directions are closed, one each:
//   (a) truncation-first — `allowIncompleteSave` clears all three truncation
//       states (`use-load-truncation.ts`), so the lockout it holds is the only
//       one that can outlive itself;
//   (b) refusal-first — the save effect's suppress-after-load branch calls
//       `clearRefusal`, and every load/switch/create sets that flag, so a
//       refusal cannot outlive the workspace whose baselines raised it.
// ★★ (b) IS NEW, AND ITS ABSENCE MADE THE COMBINED STATE REACHABLE: a refusal
// raised on one project survived a switch to another and stood there alongside
// that project's fresh truncation. Every comment that called the state
// impossible cited the early return alone, which never covered this direction.
// Do not shorten either half back to "the save effect returns on truncation".
//
// ★★ `evaluate` SETS STATE, and that is why it lives here rather than inline in
// the save effect. `react-hooks/set-state-in-effect` is fatal under
// `--max-warnings=0`, and a bare `setRefusal(...)` written into the effect body
// would trip it. Calling through this module is the same indirection
// `emitToast` already relies on at the very same site. Do NOT inline it back.

import { useCallback, useRef, useState } from "react";
import { evaluateSaveGuard, type SaveGuardVerdict } from "./save-guard";

/** A refusal standing right now: saving is paused until the user authorises the
 *  deletion or reloads.
 *
 *  ★ The COUNTS are the state, not a boolean. The surface has to name a
 *  magnitude ("847 of 900 records"), and a separate boolean beside them would be
 *  a second source of truth that can drift — `use-load-truncation.ts` stores its
 *  counts rather than a flag for exactly this reason. */
export interface DestructiveRefusal {
  prevCollections: number;
  prevRecords: number;
  curCollections: number;
  curRecords: number;
  /** Selects the confirm TIER on the recourse: a full wipe takes
   *  `TypeToConfirmDialog`, a mass deletion the lighter `ConfirmDialog`. */
  fullWipe: boolean;
}

export interface DestructiveSaveGuard {
  /** Arm a one-shot bypass so the NEXT save may destroy data (a confirmed
   *  clear-all / bulk delete). Without this an unexplained mass deletion is
   *  refused by the persistence guard.
   *
   *  ★★★ ARM IN THE SAME SYNCHRONOUS BLOCK AS THE MUTATION. A site that arms,
   *  AWAITS, then mutates loses its permission and its deletion is refused —
   *  every consumer of the workspace counts commits with the mutation, so the
   *  arm must too. Enumerate the sites before adding one:
   *    grep -rn "allowDestructiveSave" src/app --include=*.ts --include=*.tsx */
  allowDestructiveSave: () => void;
  /** The user's exit from a standing refusal: arm the bypass AND clear the
   *  refusal state. Clearing is what re-runs the save effect (the state is one
   *  of its deps), so the authorised save actually WRITES rather than waiting
   *  for an unrelated edit — the same mechanism `allowIncompleteSave` uses. */
  allowDestructiveSaveAnyway: () => void;
  /** The standing refusal, or null. */
  refusal: DestructiveRefusal | null;
  /** Read the one-shot arm and clear it, in one call.
   *
   *  ★★★ THE SAVE EFFECT CALLS THIS ONCE, AT ITS VERY TOP. That is the whole
   *  point: every path below then spends the arm BY CONSTRUCTION, so a new
   *  early return cannot leak a bypass into the next unrelated save. Spending
   *  it used to be a per-early-return obligation written out by hand at each
   *  one, which is open-followups §294. */
  consumeArm: () => boolean;
  /** Run the guard against the stored baselines and record a refusal if it
   *  refuses. Returns the verdict. */
  evaluate: (curCollections: number, curRecords: number, armed: boolean) => SaveGuardVerdict;
  /** Adopt the given counts as the new baselines — a committed save, or a
   *  load/apply the suppress branch is folding in. */
  syncBaselines: (curCollections: number, curRecords: number) => void;
  /** The baselines, for the forensic record a refusal writes. */
  readBaselines: () => { collections: number; records: number };
  /** Drop a standing refusal without arming anything — a save committed. */
  clearRefusal: () => void;
}

/** Two refusals describing the same standing state.
 *
 *  ★★★ IDENTITY STABILITY IS LOAD-BEARING, NOT AN OPTIMISATION. `use-storage-backend.ts`
 *  lists `destructive.refusal` in the save effect's dep array, so a fresh object per
 *  evaluation is an INFINITE LOOP: refuse -> setRefusal(new object) -> dep identity
 *  changes -> effect re-runs -> the counts and baselines are unchanged so it refuses
 *  again -> forever. Measured, not reasoned: before this guard, running the single
 *  test "keeps refusing every later save while a refusal stands" in isolation on an
 *  idle 20-core machine with 9 GB free died with "Ineffective mark-compacts near heap
 *  limit". Do not replace the functional setter below with a plain `setRefusal(next)`. */
function sameRefusal(a: DestructiveRefusal, b: DestructiveRefusal): boolean {
  return a.prevCollections === b.prevCollections && a.prevRecords === b.prevRecords
    && a.curCollections === b.curCollections && a.curRecords === b.curRecords
    && a.fullWipe === b.fullWipe;
}

export function useDestructiveSaveGuard(): DestructiveSaveGuard {
  // Non-empty-collection count of the last observed workspace — drives the
  // Layer-3 persistence guard against a multi-collection simultaneous wipe.
  const prevCollectionCountRef = useRef(0);
  // Total record count of the last observed workspace — drives the Layer-B
  // mass-deletion guard.
  const prevRecordCountRef = useRef(0);
  // One-shot bypass for the L3/B guards, set by an explicit user bulk-op
  // (clear-all / bulk delete) and consumed by the next save.
  const allowDestructiveRef = useRef(false);
  const [refusal, setRefusal] = useState<DestructiveRefusal | null>(null);

  // ★ useCallback with EMPTY deps: it only writes a ref, so it closes over
  // nothing that can go stale — and `use-register-tools.ts` lists it in an
  // exhaustive useMemo deps array that assumes every member is identity-stable.
  const allowDestructiveSave = useCallback(() => { allowDestructiveRef.current = true; }, []);

  const allowDestructiveSaveAnyway = useCallback(() => {
    allowDestructiveRef.current = true;
    setRefusal(null);
  }, []);

  const clearRefusal = useCallback(() => { setRefusal(null); }, []);

  const consumeArm = (): boolean => {
    const armed = allowDestructiveRef.current;
    allowDestructiveRef.current = false;
    return armed;
  };

  const syncBaselines = (curCollections: number, curRecords: number): void => {
    prevCollectionCountRef.current = curCollections;
    prevRecordCountRef.current = curRecords;
  };

  const readBaselines = () => ({
    collections: prevCollectionCountRef.current,
    records: prevRecordCountRef.current,
  });

  const evaluate = (curCollections: number, curRecords: number, armed: boolean): SaveGuardVerdict => {
    const prevCollections = prevCollectionCountRef.current;
    const prevRecords = prevRecordCountRef.current;
    const verdict = evaluateSaveGuard({ prevCollections, prevRecords, curCollections, curRecords, allowDestructive: armed });
    if (verdict.refuse) {
      const next: DestructiveRefusal = { prevCollections, prevRecords, curCollections, curRecords, fullWipe: verdict.refusedBy === "full-wipe" };
      setRefusal((cur) => (cur !== null && sameRefusal(cur, next) ? cur : next));
    }
    return verdict;
  };

  return {
    allowDestructiveSave, allowDestructiveSaveAnyway, refusal,
    consumeArm, evaluate, syncBaselines, readBaselines, clearRefusal,
  };
}
