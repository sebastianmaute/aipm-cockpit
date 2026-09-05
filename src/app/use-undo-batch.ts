// src/app/use-undo-batch.ts — collapse a burst of AI undo captures into ONE entry.
//
// ★★★ THE PROBLEM THIS EXISTS FOR. Every AI update and delete captures its own
// undo entry (fourteen `undoRef.current?.captureComposite({…})` sites across
// `use-chat-dispatcher.ts` and `use-register-tools.ts`). That is right for a
// turn that writes ONE row and applies immediately. It is wrong for an APPLIED
// STAGED PLAN: replaying five kept rows would push FIVE entries, so the user
// who approved one reviewed plan has to press undo five times to walk it back —
// and, worse, `UNDO_CAP` is 25, so a 40-row plan evicts their entire undo
// history to make room for its own fragments.
//
// ★★ THE MECHANISM IS `captureComposite` ITSELF, NOT A NEW ONE. Its own doc
// says a fan-out of edits becoming ONE entry instead of N is what its `parts`
// array is for, and `use-bulk-operations.ts` / `use-reference-data.ts` already
// build multi-array composites that way. What did NOT exist is a way to
// INTERCEPT captures made by code that does not know it is being batched —
// which is exactly the fourteen sites' situation. So this module adds the
// interception and reuses the existing collapse.
//
// ★ Installed as the dispatcher's `undo` prop, not inside the dispatcher: the
// hook syncs `undoRef` from `args.undo` in an EFFECT, so anything that swapped
// `undoRef.current` around an AWAIT could be silently reverted mid-replay by a
// re-render. A wrapper handed in as the prop is stable by construction and
// needs no change to `use-chat-dispatcher.ts`.
"use client";
import { useEffect, useMemo, useRef } from "react";
import { isDeleteKind, type ActivityKind } from "./activity-log";
import type {
  CaptureCompositeOpts,
  CompositeFragment,
  UndoEntityKey,
  UndoStackApi,
} from "./undo/use-undo-stack";

/** The one method the fourteen capture sites reach for. Deliberately the same
 *  `Pick` `ChatDispatcherArgs.undo` declares, so this wrapper is substitutable
 *  for the real stack at that prop without widening anything. */
export type CaptureSurface = Pick<UndoStackApi, "captureComposite">;

export interface UndoBatch {
  /** Hand this to `useChatDispatcher` as its `undo` prop. Outside a batch it
   *  forwards to the real stack unchanged, so ordinary (unstaged) AI writes keep
   *  capturing exactly one entry each. */
  readonly undo: CaptureSurface;
  /** Run `fn` with every capture collected instead of pushed, then push at most
   *  ONE entry carrying all of their fragments.
   *
   *  ★★ THE PUSH IS IN A `finally`. A plan that throws part-way through has
   *  still WRITTEN whatever it wrote, and dropping the collected fragments
   *  because the run ended badly is precisely the unrecoverable-write failure
   *  the capture exists to prevent. */
  runBatched: <T>(fn: () => Promise<T>) => Promise<T>;
}

/**
 * Fold N collected captures into the single `captureComposite` call that
 * reproduces them, or `null` when they contributed no reversible fragment at
 * all (an all-creates plan is the live case — see below).
 *
 * ★★★ CREATES AND DOCUMENT WRITES CONTRIBUTE NOTHING, BY CONSTRUCTION RATHER
 * THAN BY A FILTER HERE. No `create_*` handler captures (the undo engine's
 * `UndoOp` is "delete" | "edit" — restoring a "removed" image for a row that is
 * still live takes the id-reuse branch and splices in a SECOND copy, so
 * capturing a create would DUPLICATE it on undo), and `use-document-tools.ts`
 * captures at none of its sites. Measured, not assumed: the fourteen sites'
 * kinds are all `*.updated` / `*.deleted` — no site emits a `bulk.*` kind, the
 * `delete_all_tasks` capture included: it mirrors the human bulk delete
 * (`use-bulk-operations.ts`) and captures `task.deleted` with a count
 *   grep -n 'kind: "' src/app/use-chat-dispatcher.ts src/app/use-register-tools.ts
 * — 14 lines, one per site. ★★★ DELIBERATELY NOT AN `-A<n>` WINDOW ON
 * `captureComposite({`, and the history is the argument: a site's `kind:` sits
 * ONE line below its call at some sites and THIRTEEN at another, so every fixed
 * window is wrong again the next time a comment there grows. `-A2` returned 13;
 * widening to `-A6` returned 14; rewriting that site's comment put it back to
 * 13 — each time silently dropping the one site under discussion while still
 * reading as verification. This form has no window.
 * ★ It is exact only while those two files hold no OTHER `kind: "` literal —
 * cross-check against `grep -c "captureComposite({"` on the same two files.
 * And `grep -c captureComposite src/app/use-document-tools.ts` is 0. So this
 * function never has to decide what is reversible — the unreversible calls
 * simply hand it nothing.
 *
 * ★★ FRAGMENTS ARE REVERSED — newest capture first, which is the order
 * `undo()` itself pops entries in. Each fragment's before-image was frozen at
 * ITS OWN call time, so images taken later must land first for each to be
 * applied to the state it was taken from. The `parts` of ONE capture keep their
 * internal order, because a capture's own first fragment is its primary by
 * convention.
 * ★★ REASONED, NOT MEASURED, and the case that would make it observable is
 * currently UNREACHABLE: two writes to the same row in one plan would need two
 * valid `expectedToken`s for that row, and the plan is stamped once at propose
 * time — so the second write is refused as stale before it can prove the
 * ordering either way. This is the standard-correct order rather than a fix for
 * a defect anything here can reproduce. Do not read the green suite as pinning
 * it; a test that could would first have to defeat the token guard.
 *
 * ★★ CONCATENATION IS SAFE ONLY BECAUSE NO CHAT FRAGMENT DECLARES
 * `fkRemapField`. `compositeUndoRunner` picks ONE primary (the first flagged)
 * and every cascade fragment reads THAT one's id-remap box, so concatenating
 * two captures that each had a primary + cascade would make the second's
 * cascade follow the first's re-mint. All fourteen sites pass a single
 * `isPrimary: true` part and none passes `fkRemapField`
 *   grep -n "fkRemapField" src/app/use-chat-dispatcher.ts src/app/use-register-tools.ts
 * (no matches), so no fragment reads the box and the choice of primary is inert.
 * Re-check that grep before adding a cascade to any chat write.
 */
export function collapseCaptures(
  collected: readonly CaptureCompositeOpts[],
): CaptureCompositeOpts | null {
  // A capture whose parts are all null reversed nothing (`capturePart` returns
  // null for an empty image), so it must not contribute to the count either.
  const contributing = collected.filter((o) => o.parts.some((p) => p !== null));
  if (contributing.length === 0) return null;

  const parts: (CompositeFragment | null)[] = [];
  for (let i = contributing.length - 1; i >= 0; i -= 1) parts.push(...contributing[i].parts);

  const kinds = new Set(contributing.map((o) => o.kind));
  const keys = new Set(contributing.map((o) => o.entityKey));

  // ★★ A MIXED PLAN GETS THE GENERIC LABEL ON PURPOSE. `buildUndoLabel`
  // resolves the entity from `entityKey` first and the kind's prefix second, so
  // naming ONE entity for a plan that also moved another would print a
  // confidently wrong label ("Bulk edit of 2 tasks" over a task and a
  // milestone). `"bulk"` is not in `ENTITY_KEY_SET`, so a mixed plan falls
  // through to "Edited/Deleted N items" — vaguer, and true.
  //
  // ★★★ THIS LINE IS THE ONLY PRODUCER OF A `bulk.delete` UNDO KIND. No capture
  // site emits one (see the kinds grep above), so the all-delete branch
  // SYNTHESIZES it — because no single `entityKey` describes a plan whose
  // deletes span two entities, and emitting one entity's `*.deleted` instead
  // would print the confidently wrong label the paragraph above rejects.
  // `buildUndoLabel` and its toast can only label a synthesized kind through
  // the SHARED `isDeleteKind` (`activity-log.ts`); their own
  // `.endsWith(".deleted")` called it an edit and printed "Edited N items" over
  // a mass deletion. So this line and those two are ONE mechanism — dropping
  // the `"bulk.delete"` here, or re-inlining the naive test at either renderer,
  // re-opens that defect with every gate green.
  //   grep -rn '"bulk\.delete"' src/app --include=*.ts --include=*.tsx \
  //     | grep -v "\.test\." | grep -v "//"
  // → the union + its label map and this predicate (`activity-log.ts`),
  //   activity ANALYSIS (`completion-trend.ts`), activity LOGGING
  //   (`use-bulk-operations.ts` twice, `use-chat-dispatcher.ts` once) and the
  //   synthesis below. Nine lines, no capture site among them.
  // ★★ The `grep -v "//"` is load-bearing, not tidiness: without it this very
  // comment answers the grep, and so does the one at the `delete_all_tasks`
  // capture — a self-matching reproduce that inflates every time it is read.
  // ★ The `isDeleteKind` on the INPUTS below is the same predicate for one
  // spelling, not a claim that a capture site can hand us a `bulk.delete`.
  const kind: ActivityKind = kinds.size === 1
    ? contributing[0].kind
    : [...kinds].every(isDeleteKind) ? "bulk.delete" : "bulk.edit";
  const entityKey: UndoEntityKey | undefined =
    keys.size === 1 ? contributing[0].entityKey : undefined;

  // ★★ THE SUM OF WHAT IS ACTUALLY REVERSIBLE, never the number of calls
  // applied. A plan of {create, update, delete} is reversible in TWO rows; a
  // count of three would make the toast and the undo badge claim a row the
  // entry cannot put back.
  const primaryCount = contributing.reduce((n, o) => n + o.primaryCount, 0);

  // No `name`: a label names ONE entity, and a plan is not one entity. Letting a
  // single row's title stand for the whole plan is the same wrong-label failure
  // the entityKey note above rejects.
  return { kind, primaryCount, parts, entityKey };
}

/**
 * A stable capture surface plus the batch control that collapses it.
 *
 * ★ `undo` and `runBatched` are minted ONCE (`useMemo` with no deps) and read
 * everything through refs, so the object can be threaded to a memoized consumer
 * and, more to the point, a batch survives the re-renders each replayed write
 * triggers. A fresh wrapper per render would drop a batch opened before an
 * `await` and started collecting into an object nobody flushes.
 */
export function useUndoBatch(live: CaptureSurface): UndoBatch {
  const liveRef = useRef(live);
  useEffect(() => {
    liveRef.current = live;
  }, [live]);
  // Non-null exactly while a batch is open; the collected captures ARE the box.
  const collectedRef = useRef<CaptureCompositeOpts[] | null>(null);

  return useMemo<UndoBatch>(
    () => ({
      undo: {
        captureComposite: (opts) => {
          const collected = collectedRef.current;
          if (collected) {
            collected.push(opts);
            return;
          }
          liveRef.current.captureComposite(opts);
        },
      },
      runBatched: async <T>(fn: () => Promise<T>): Promise<T> => {
        // ★ Refused rather than nested: a nested batch would have to decide
        // whose entry the inner captures join, and every honest answer is
        // surprising. Nothing in the app opens two, so make the day one appears
        // a loud failure instead of a silently mis-attributed undo entry.
        if (collectedRef.current) throw new Error("an undo batch is already open");
        const collected: CaptureCompositeOpts[] = [];
        collectedRef.current = collected;
        try {
          return await fn();
        } finally {
          collectedRef.current = null;
          const one = collapseCaptures(collected);
          if (one) liveRef.current.captureComposite(one);
        }
      },
    }),
    [],
  );
}
