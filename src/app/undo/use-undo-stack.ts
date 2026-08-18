// src/app/undo/use-undo-stack.ts
"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { flushSync } from "react-dom";
import { t, type Lang } from "../i18n";
import type { ActivityKind } from "../activity-log";
import type { ToastAction } from "../use-toast";
import {
  applyUndoRestoreWithRemap,
  applyUndoForward,
  buildBeforeImages,
  buildForwardImages,
  remapImageField,
  pushUndo,
  pushUndoMany,
  popUndo,
  takeThrough,
  dropEntry,
  reversedKindCounts,
  type BeforeImage,
  type UndoMeta,
} from "./undo-stack";

// Retention: how many destructive ops stay undoable/redoable at once.
const UNDO_CAP = 25;

/**
 * Fields written to a live row by something OTHER than the op that captured it.
 * A whole-row undo lets the LIVE value win on these, or it reverts a write the
 * user's undo was never about (open-followups §50).
 *
 * ★★ MEMBERSHIP RULE, not a list of "important" fields: a field belongs here iff
 * some writer OTHER than an entity's own save handler can change it on a row that
 * is not being edited. Today that is the notes window (`noteLog`, on Task, RaidItem
 * and ChangeItem) and the background calendar push/pull (`outlookEventId`, on every
 * calendar-capable entity).
 *
 * ★★ THIS LIST IS THE BACKSTOP, NOT THE PRIMARY FIX. The bulk-edit sites capture
 * FIELD PATCHES and are immune by construction; what this protects is the paths
 * that genuinely replace whole rows — reference-data cascades, the resource
 * directory, task dedup, the alloc plan, and dependency stripping on delete. A new
 * write-through field silently escapes it, which is why the patch capture is
 * preferred wherever the op is a field edit.
 */
const WRITE_THROUGH_FIELDS: readonly string[] = ["noteLog", "outlookEventId"];

/** The entities an undo label can name. `bulk.edit` is entity-AMBIGUOUS (one
 *  shared kind across tasks/raid/change/…), so its capture site passes an explicit
 *  `entityKey`; every other kind derives the entity from its `entity.op` prefix. */
export type UndoEntityKey =
  | "task" | "milestone" | "raid" | "change" | "stakeholder"
  | "resource" | "absence" | "shift" | "role" | "discipline" | "grade"
  | "calendarEvent" | "budget";

type I18nKey = Parameters<typeof t>[1];

const ENTITY_SINGULAR: Record<UndoEntityKey, I18nKey> = {
  task: "undoEntityTask",
  milestone: "undoEntityMilestone",
  raid: "undoEntityRaid",
  change: "undoEntityChange",
  stakeholder: "undoEntityStakeholder",
  resource: "undoEntityResource",
  absence: "undoEntityAbsence",
  shift: "undoEntityShift",
  role: "undoEntityRole",
  discipline: "undoEntityDiscipline",
  grade: "undoEntityGrade",
  calendarEvent: "undoEntityCalendarEvent",
  budget: "undoEntityBudget",
};
// Plurals only for entities that appear with a count (bulk/multi-delete); the
// rest fall back to the singular (they're only ever named, count 1).
const ENTITY_PLURAL: Partial<Record<UndoEntityKey, I18nKey>> = {
  task: "undoEntityTasks",
  milestone: "undoEntityMilestones",
  raid: "undoEntityRaids",
  change: "undoEntityChanges",
  stakeholder: "undoEntityStakeholders",
  resource: "undoEntityResources",
  budget: "undoEntityBudgets",
};

// ★ Must stay in lockstep with the entity prefixes in ACTIVITY_KIND_TO_KEY: a
// kind whose prefix is missing here resolves to `null`, and buildUndoLabel then
// returns its generic "Edited/Deleted N item(s)" fallback BEFORE it ever reads
// `opts.name` — so the entity's name is silently dropped from every undo label
// while restore itself still works. That failure is invisible to a functional
// test (calendarEvent shipped that way and eight reviews missed it).
const ENTITY_KEY_SET: ReadonlySet<string> = new Set<UndoEntityKey>([
  "task", "milestone", "raid", "change", "stakeholder",
  "resource", "absence", "shift", "role", "discipline", "grade",
  "calendarEvent", "budget",
]);

function entityKeyFromKind(kind: ActivityKind): UndoEntityKey | null {
  const prefix = kind.split(".")[0];
  return ENTITY_KEY_SET.has(prefix) ? (prefix as UndoEntityKey) : null;
}

/** Longest entity name to inline in a label before eliding (keeps toasts short). */
const UNDO_LABEL_NAME_MAX = 40;
function truncateName(name: string): string {
  const n = name.trim();
  return n.length > UNDO_LABEL_NAME_MAX ? `${n.slice(0, UNDO_LABEL_NAME_MAX - 1)}…` : n;
}

/**
 * Compose the already-translated human label for one undoable op from its
 * operation + entity + name/count. Built at capture time (in the user's current
 * language). Falls back to a generic "Edited/Deleted N item(s)" when the entity
 * can't be resolved (unknown kind, no entityKey). Pure aside from i18n lookups.
 */
export function buildUndoLabel(
  lang: Lang,
  kind: ActivityKind,
  count: number,
  opts?: { name?: string; entityKey?: UndoEntityKey },
): string {
  const key = opts?.entityKey ?? entityKeyFromKind(kind);
  const isDelete = kind.endsWith(".deleted");
  const isBulk = kind === "bulk.edit";
  const name = opts?.name && opts.name.trim() ? truncateName(opts.name) : "";
  if (!key) return t(lang, isDelete ? "undoToastDelete" : "undoToastEdit", count);
  const singular = t(lang, ENTITY_SINGULAR[key]);
  const plural = t(lang, ENTITY_PLURAL[key] ?? ENTITY_SINGULAR[key]);
  if (isBulk) return t(lang, "undoLabelBulkEdit", count, plural);
  if (isDelete) {
    if (name && count <= 1) return t(lang, "undoLabelDeleteNamed", singular, name);
    return t(lang, "undoLabelDeleteCount", count, count === 1 ? singular : plural);
  }
  if (name) return t(lang, "undoLabelEditNamed", singular, name);
  return t(lang, "undoToastEdit", count);
}

export interface CaptureOpts<T extends { id: number }> {
  setter: Dispatch<SetStateAction<readonly T[]>>;
  kind: ActivityKind;
  /** Rows REMOVED by the op (delete / clear-all). Restored by re-insertion;
   *  re-minted if their id was reused by a live row since (no clobber). */
  removed?: readonly T[];
  /** Rows EDITED in place (bulk-edit, or a delete's dependency-stripped
   *  dependents). Restored by reverting the same id in place. */
  edited?: readonly T[];
  /** The array as it was BEFORE the op — used to resolve each row's index. */
  fromArray: readonly T[];
  /** Entity name/title for the undo label (e.g. the deleted task's title). */
  name?: string;
  /** Explicit entity for the label when the kind is entity-ambiguous (bulk.edit). */
  entityKey?: UndoEntityKey;
}

/** A single-field-group edit: revert by MERGING `before`/`after` onto the live
 *  row by id (not a whole-row replace), so independent per-field entries compose
 *  and undo in any LIFO order. `stampField` is re-stamped on undo AND redo. */
export interface CaptureFieldEditOpts<T extends { id: number }> {
  setter: Dispatch<SetStateAction<readonly T[]>>;
  kind: ActivityKind;
  id: number;
  before: Partial<T>;
  after: Partial<T>;
  stampField?: keyof T & string;
  /** Entity name/title for the undo label (e.g. the edited task's title). */
  name?: string;
}

/** One array's contribution to a composite (multi-array) undo — the same shape
 *  as `CaptureOpts` minus the entry-level `kind` (a composite op has one kind). */
export interface CapturePart<T extends { id: number }> {
  setter: Dispatch<SetStateAction<readonly T[]>>;
  removed?: readonly T[];
  edited?: readonly T[];
  fromArray: readonly T[];
  /** The field on THIS fragment's rows that references the PRIMARY-deleted entity
   *  (the composite's FIRST fragment). When set, on undo each of this fragment's
   *  before-images has `item[fkRemapField]` remapped through the primary delete's
   *  id-remap BEFORE restore — so a cascade FK follows the primary's re-mint
   *  instead of pointing at the stale original id (now a live unrelated row).
   *  Applies to edit-images (a re-set FK) AND delete-images (a re-inserted row
   *  carrying the FK). Omit on the primary fragment (it has no self-FK). */
  fkRemapField?: keyof T & string;
  /** Marks THIS fragment as the composite's PRIMARY delete — the one whose
   *  id-remap the cascades' `fkRemapField` follow. Exactly one part sets it; if
   *  none does, the first fragment is assumed primary (back-compat). Making it
   *  explicit removes the fragile positional "fragments[0] = primary" convention. */
  isPrimary?: boolean;
}

/**
 * A directional runner: applying it mutates state (undo OR redo) via its
 * captured setter(s) and RETURNS the inverse runner (redo after undo, undo after
 * redo). Alternating between the two thunks gives multi-level undo↔redo, and it
 * is fully reusable so a redone op can be undone again (and vice-versa). The
 * top-level entry stores one runner; a composite entry stores a composed runner.
 */
export type Runner = () => Runner;

/**
 * Build a REUSABLE undo↔redo runner for ONE array. The stable `before`-images
 * drive undo (restore); the redo re-applies FORWARD images captured at undo time
 * from the live post-op array.
 *
 * ★ The forward-images are computed INSIDE the setter updater from `prev` (the
 * current/post-op state) and stashed to a closure var. This is idempotent —
 * React strict-mode double-invokes the updater with the SAME `prev`, yielding
 * the same forward-images — so it does NOT violate the "no side-effects in an
 * updater" rule the way a toast/log would. `prev` is read lazily, so the
 * returned redo thunk sees the populated `forward` only when the user later
 * invokes it (after the updater has committed).
 */
function fragmentUndoRunner<T extends { id: number }>(
  setter: Dispatch<SetStateAction<readonly T[]>>,
  before: readonly BeforeImage<T>[],
): Runner {
  const runUndo: Runner = () => {
    let forward: BeforeImage<T>[] = [];
    setter((prev) => {
      const { result, remap } = applyUndoRestoreWithRemap(prev, before, WRITE_THROUGH_FIELDS);
      // Build the redo images from the SAME prev + the remap, so a re-minted
      // delete removes the recovered row on redo, not the live reused-id row.
      forward = buildForwardImages(before, prev, remap);
      return result;
    });
    const runRedo: Runner = () => {
      setter((prev) => applyUndoForward(prev, forward, WRITE_THROUGH_FIELDS));
      return runUndo;
    };
    return runRedo;
  };
  return runUndo;
}

/** A shared, empty primary-remap so the box starts with no re-mint until the
 *  primary fragment's updater publishes one. */
const EMPTY_REMAP: ReadonlyMap<number, number> = new Map();

/**
 * A type-erased composite fragment (one affected array). `restore` reverts THIS
 * array and returns its redo thunk. The shared `primaryRemap` box carries the
 * PRIMARY delete's id-remap: the PRIMARY fragment (`isPrimary`) publishes its own
 * remap into it inside its updater; a fragment with an `fkRemapField` reads it to
 * follow the primary's re-mint. Heterogeneous arrays compose because the generic
 * `T` is captured inside `capturePart`'s closure and erased at this boundary.
 */
export interface CompositeFragment {
  /** Whether this fragment is the PRIMARY delete (its id-remap drives cascades). */
  isPrimary: boolean;
  restore: (primaryRemap: { current: ReadonlyMap<number, number> }, isPrimary: boolean) => () => void;
}

/**
 * Build a REUSABLE undo↔redo runner for a composite (multi-array) op, threading
 * the PRIMARY delete's id-remap to every cascade fragment so a re-minted primary
 * row's FK references follow it (see `remapImageField`). The FIRST fragment is
 * the primary delete (holds at every call site); it publishes its remap into a
 * fresh per-invocation box, then the cascades restore reading it.
 *
 * REDO needs no cross-fragment remap: each fragment's redo re-applies its own op
 * from FORWARD images captured at undo time (the primary redo already removes the
 * re-minted row by its correct id via `buildForwardImages`). Re-undo re-runs
 * `runUndo`, re-orchestrating from the fixed before-images — fully reusable.
 */
function compositeUndoRunner(fragments: readonly CompositeFragment[]): Runner {
  // The PRIMARY (remap source) is the explicitly-flagged fragment; fall back to
  // index 0 for back-compat. Explicit beats the fragile positional convention.
  const primaryIdx = Math.max(0, fragments.findIndex((f) => f.isPrimary));
  const runUndo: Runner = () => {
    // Fresh box each undo so a re-undo (after redo) re-derives the remap from
    // live state rather than a stale one.
    const primaryRemap = { current: EMPTY_REMAP };
    const redos: (() => void)[] = new Array(fragments.length);
    const runPrimary = () => { redos[primaryIdx] = fragments[primaryIdx].restore(primaryRemap, true); };
    // ★★ Flush the PRIMARY synchronously so its published remap is populated
    // BEFORE the cascade updaters run — `undo()` fires from an event handler, so
    // under React-18 auto-batching the separate setters would otherwise flush in
    // fiber (hook-declaration) order, not call order, and a cascade could read the
    // still-empty box. Only when there ARE cascades: a lone fragment needs no
    // cross-fragment sync, so flushSync would just force a needless extra commit.
    if (fragments.length > 1) flushSync(runPrimary); else runPrimary();
    fragments.forEach((f, i) => { if (i !== primaryIdx) redos[i] = f.restore(primaryRemap, false); });
    const runRedo: Runner = () => {
      for (const redo of redos) redo();
      return runUndo;
    };
    return runRedo;
  };
  return runUndo;
}

/**
 * Build one composite fragment for ONE array. Computes the before-images eagerly
 * from the PRE-op snapshots (so it's safe to build after the mutating setter —
 * `fromArray`/`removed`/`edited` are pre-mutation values) and closes over the
 * setter. Returns `null` when the array contributed nothing so `captureComposite`
 * can skip a no-op fragment. Generic per-call so each array's `T` stays precise;
 * the returned fragment is type-erased, letting a composite mix heterogeneous
 * arrays (e.g. roles + resources).
 *
 * ★ The forward-images AND (for the primary) the published remap are stashed out
 * of the setter updater — idempotent under strict-mode double-invoke (same `prev`
 * ⇒ same result), exactly like the single-array `fragmentUndoRunner`.
 */
export function capturePart<T extends { id: number }>(part: CapturePart<T>): CompositeFragment | null {
  const { setter, removed = [], edited = [], fromArray, fkRemapField, isPrimary } = part;
  const images = buildBeforeImages(removed, edited, fromArray);
  if (images.length === 0) return null;
  const restore = (
    primaryRemap: { current: ReadonlyMap<number, number> },
    isPrimary: boolean,
  ): (() => void) => {
    let forward: BeforeImage<T>[] = [];
    setter((prev) => {
      // Follow the primary re-mint for this fragment's FK (no-op when the box is
      // still empty or the field is unset). The primary itself has no self-FK.
      const restoreImages = fkRemapField
        ? remapImageField(images, fkRemapField, primaryRemap.current)
        : images;
      const { result, remap } = applyUndoRestoreWithRemap(prev, restoreImages, WRITE_THROUGH_FIELDS);
      if (isPrimary) primaryRemap.current = remap; // publish for cascades (idempotent)
      // Redo images from the SAME prev + this fragment's own remap, so a re-minted
      // delete removes the recovered row on redo, not a live reused-id row.
      forward = buildForwardImages(restoreImages, prev, remap);
      return result;
    });
    return () => { setter((prev) => applyUndoForward(prev, forward, WRITE_THROUGH_FIELDS)); };
  };
  return { isPrimary: isPrimary === true, restore };
}

/** One FIELD-LEVEL contribution to a composite undo: N rows in ONE array, each
 *  reverted by MERGING a field patch onto the live row rather than replacing it.
 *  ★★★ This is the difference from `CapturePart`, and it is why it exists.
 *  `capturePart` builds WHOLE-ROW before-images, so undoing restores every field
 *  as it stood at capture time and silently discards anything a concurrent
 *  writer changed on those rows meanwhile (open-followups §50 — the shape that
 *  reverts a RAID item's note log; §50 says the same sequence "very likely"
 *  loses TASK notes too but marks that half UNVERIFIED, so do not cite this as
 *  a known task defect). A patch merge touches only the fields the op
 *  actually wrote. Use this whenever the op edited FIELDS; use `capturePart`
 *  when it removed or replaced whole rows. */
export interface CaptureFieldPart<T extends { id: number }> {
  setter: Dispatch<SetStateAction<readonly T[]>>;
  /** One entry per affected row. `before`/`after` hold ONLY the written fields. */
  edits: readonly { id: number; before: Partial<T>; after: Partial<T> }[];
  stampField?: keyof T & string;
}

/**
 * Build a composite fragment that merges a field patch onto N rows at once.
 *
 * ★★ ONE setter pass for all N rows, not N passes — the whole point is that the
 * user's single act becomes a single undo entry with a single toast, so it must
 * also be a single state update.
 * ★ Returns null for an empty edit list, matching `capturePart`. That makes it
 * safe to pass straight into `captureComposite`'s `parts` (nulls are filtered,
 * and an all-null `parts` pushes no entry) — but a caller that ALSO needs a
 * label, a count or anything else derived from the edits still has to check the
 * list itself first, which is why the successor call site guards on
 * `targets.length > 0` rather than relying on this.
 * ★★★ NEVER pass this as the FIRST fragment of a composite that also contains a
 * `capturePart` cascade. It removes nothing, so it publishes no id-remap — and
 * `compositeUndoRunner` falls back to fragment 0 when no fragment sets
 * `isPrimary`, so a field part sitting first would become the nominal primary,
 * leave `primaryRemap` empty, and silently point every `fkRemapField` cascade at
 * stale ids with no error.
 * ★★ "Every existing caller flags its primary" is FALSE. Of the SEVEN
 * `captureComposite` call sites, FIVE flag one — the three in
 * `use-reference-data.ts` and the two in `use-resource-directory.ts`. The other
 * two, `use-budget-buckets.ts` and `use-task-submit.ts`, flag NOTHING and ride
 * the positional fallback this paragraph calls fragile. Neither is a live defect:
 * no fragment in either declares `fkRemapField`, so the empty remap is never read.
 * ★★★ ENUMERATE WITH ALL THREE CALL SHAPES OR YOU WILL MISS ONE. An earlier
 * revision of this paragraph said SIX and named only the budget caller, because
 * its grep matched `captureComposite({` and `captureCompositeRef.current?.({`
 * but not the OPTIONAL-call form `captureComposite?.({` — which is how
 * `use-task-submit.ts` invokes it, i.e. it missed the very caller that motivated
 * this function. Reproduce with all three:
 * `grep -rn "captureComposite?\.({\|captureComposite({\|captureCompositeRef.current?.({" src/app |
 * grep -v "\.test\." | grep -v use-undo-stack.ts` → 7. Both filters matter, and
 * BOTH are what make that 7 stable: the unfiltered grep also sweeps the engine's
 * own tests AND this comment, so it over-counts by however many times the
 * patterns appear here — a number that changes every time this block is edited,
 * which is why one is not quoted.
 * ★★★ SO THE SHAPE WARNED ABOUT ABOVE ALREADY EXISTS — it is not hypothetical.
 * `use-task-submit.ts` passes a lone `captureFieldPart` as `parts[0]` of an
 * unflagged composite, and this function hardcodes `isPrimary: false`. It is
 * benign ONLY because that composite has no cascade to remap. Adding a
 * `capturePart` cascade to an existing single-fragment field composite is
 * therefore a live hazard, not a future one: flag the cascade `isPrimary: true`
 * in the same edit.
 * ★★ Same trap waiting in `use-budget-buckets.ts`: its `parts[0]` is
 * `use-bulk-operations`' whole-row `tasksPart`, an open-followups §50 candidate,
 * and the obvious §50 fix swaps it for a `captureFieldPart` — reproducing this
 * shape beside a real `capturePart`. Flag the remaining part in that same edit.
 */
export function captureFieldPart<T extends { id: number }>(
  part: CaptureFieldPart<T>,
): CompositeFragment | null {
  const { setter, edits, stampField } = part;
  if (edits.length === 0) return null;
  const byId = new Map(edits.map((e) => [e.id, e]));
  const apply = (pick: (e: (typeof edits)[number]) => Partial<T>) => {
    setter((prev) =>
      prev.map((row) => {
        const edit = byId.get(row.id);
        if (!edit) return row;
        const merged = { ...row, ...pick(edit) } as T;
        return stampField
          ? ({ ...merged, [stampField]: new Date().toISOString() } as T)
          : merged;
      }),
    );
  };
  const restore = (): (() => void) => {
    apply((e) => e.before);
    return () => apply((e) => e.after);
  };
  return { isPrimary: false, restore };
}

/** A composite undo: one entry whose restore reverts a primary removal AND
 *  every cascade edit across N arrays (e.g. deleting a role also cleared
 *  resources' roleId → both are reverted by a single undo, and re-applied by a
 *  single redo).
 *  ★ Fragments DO coordinate re-mint across arrays: if a removed primary row's id
 *  was reused by a new row before undo, the primary fragment re-mints the
 *  recovered row under a fresh id and publishes that remap; each cascade fragment
 *  declaring an `fkRemapField` follows it so its FK points at the recovered row,
 *  never the unrelated live reused-id row. */
export interface CaptureCompositeOpts {
  kind: ActivityKind;
  /** User-facing count for the toast/badge — the PRIMARY rows the user acted
   *  on, never the incidental cascade dependents. */
  primaryCount: number;
  /** One fragment per affected array — `capturePart` for whole-row removals or
   *  replacements, `captureFieldPart` for field-patch edits; nulls (arrays that
   *  contributed nothing) are ignored. The fragment flagged `isPrimary` is the
   *  PRIMARY delete — its id-remap drives every cascade's `fkRemapField` — and
   *  when none is flagged the FIRST non-null fragment is assumed primary, which
   *  a `captureFieldPart` must never be (see its doc).
   *  ★ "Multi-array" is the common case, not a requirement: a single-array
   *  composite is legitimate and is how a fan-out of field edits becomes ONE
   *  undo entry instead of N. */
  parts: readonly (CompositeFragment | null)[];
  /** Entity name/title for the undo label (e.g. the deleted resource's name). */
  name?: string;
}

export interface UndoStackApi {
  capture: <T extends { id: number }>(opts: CaptureOpts<T>) => void;
  captureFieldEdit: <T extends { id: number }>(opts: CaptureFieldEditOpts<T>) => void;
  captureComposite: (opts: CaptureCompositeOpts) => void;
  undo: () => void;
  undoById: (id: number) => void;
  /** Undo every entry from `id` up to the top, newest-first, as ONE commit. */
  undoThrough: (id: number) => void;
  /** Redo every entry from `id` up to the top of the redo stack, as ONE commit. */
  redoThrough: (id: number) => void;
  redo: () => void;
  stack: readonly UndoMeta[];
  redoStack: readonly UndoMeta[];
  canUndo: boolean;
  canRedo: boolean;
}

export interface UseUndoStackDeps {
  lang: Lang;
  logActivity: (kind: ActivityKind, ...args: (string | number)[]) => void;
  showToast: (kind: "info" | "error", text: string) => void;
  showToastAction: (kind: "info" | "error", text: string, action: ToastAction) => void;
}

/** One entry on either stack: display meta + the impure directional runner. */
interface StackEntry {
  meta: UndoMeta;
  run: Runner;
}

export function useUndoStack(deps: UseUndoStackDeps): UndoStackApi {
  const [stack, setStack] = useState<readonly StackEntry[]>([]);
  const stackRef = useRef(stack);
  useEffect(() => { stackRef.current = stack; }, [stack]);
  const [redoStack, setRedoStack] = useState<readonly StackEntry[]>([]);
  const redoStackRef = useRef(redoStack);
  useEffect(() => { redoStackRef.current = redoStack; }, [redoStack]);
  const depsRef = useRef(deps);
  useEffect(() => { depsRef.current = deps; }, [deps]);
  const idRef = useRef(0);

  // Run an entry's undo + side effects OUTSIDE any setState updater (strict mode
  // double-invokes updaters → double restore). `entry.run()` applies the undo
  // and returns the redo runner. `pushRedo` is false for an out-of-order undo of
  // a non-top entry, whose redo can't stay coherent → clear the redo stack.
  const commitUndo = useCallback((entry: StackEntry, nextStack: readonly StackEntry[], pushRedo: boolean) => {
    const redoRun = entry.run();
    const { lang, logActivity, showToast } = depsRef.current;
    // ★★ Everything after the count is `(kind, count)` pairs naming what this
    //    reverses, and the completion trend needs them (§166): a `task.deleted`
    //    undo puts N rows back, so a walk that subtracted them on the way down
    //    has to add them again. Without them the row is a bare total and the
    //    walk cannot tell a restored delete from a reverted edit — so every
    //    reconstructed day's DENOMINATOR sat N above the truth, which (since
    //    `percent` is `done/total`) pushed the CURVE down. Say denominator, not
    //    "the truth": an earlier wording here said the latter and §166 spends a
    //    paragraph on that exact conflation.
    logActivity("undo", entry.meta.count, ...reversedKindCounts([entry.meta]));
    showToast("info", t(lang, "undoneX", entry.meta.label));
    setStack(nextStack);
    if (pushRedo) {
      setRedoStack((rs) => pushUndo(rs, { meta: entry.meta, run: redoRun }, UNDO_CAP));
    } else {
      setRedoStack([]);
    }
  }, []);

  const undoById = useCallback((id: number) => {
    const s = stackRef.current;
    const entry = s.find((e) => e.meta.id === id);
    if (!entry) return;
    const isTop = s.length > 0 && s[s.length - 1].meta.id === id;
    commitUndo(entry, dropEntry(s, id), isTop);
  }, [commitUndo]);

  const undo = useCallback(() => {
    const popped = popUndo(stackRef.current);
    if (!popped) return;
    commitUndo(popped.entry, popped.rest, true);
  }, [commitUndo]);

  // ★★ NOT a loop over undo(): `stackRef` is refreshed by an effect, so N calls
  //    in one tick all read the same stale stack and undo the top entry N times.
  //    Read the ref ONCE and thread the list locally.
  // ★★ The runners execute OUTSIDE every setState updater — StrictMode
  //    double-invokes updaters, which would apply all N restores twice (same
  //    reason commitUndo runs entry.run() before its setStates).
  const undoThrough = useCallback((id: number) => {
    const taken = takeThrough(stackRef.current, id);
    if (!taken) return;
    const inverses = taken.entries.map((e) => ({ meta: e.meta, run: e.run() }));
    const summed = taken.entries.reduce((n, e) => n + e.meta.count, 0);
    const { lang, logActivity, showToast } = depsRef.current;
    logActivity("undo", summed, ...reversedKindCounts(taken.entries.map((e) => e.meta)));
    // ★ A through-undo of ONE entry is the same user-visible act as a plain
    //   undo(), so it says the same thing — "Undone: Edit task X", not the
    //   count-shaped "Undid 1 action(s)". Both keys already exist.
    showToast("info", inverses.length === 1
      ? t(lang, "undoneX", inverses[0].meta.label)
      : t(lang, "undoneNActions", inverses.length));
    setStack(taken.rest);
    setRedoStack((rs) => pushUndoMany(rs, inverses, UNDO_CAP));
  }, []);

  // Mirror of undoThrough against the redo stack. Deliberately NOT folded in
  // with redo() — that function has its own body and shares nothing with
  // commitUndo, so unifying them would be a refactor of working code.
  const redoThrough = useCallback((id: number) => {
    const taken = takeThrough(redoStackRef.current, id);
    if (!taken) return;
    const inverses = taken.entries.map((e) => ({ meta: e.meta, run: e.run() }));
    const summed = taken.entries.reduce((n, e) => n + e.meta.count, 0);
    const { lang, logActivity, showToast } = depsRef.current;
    logActivity("redo", summed, ...reversedKindCounts(taken.entries.map((e) => e.meta)));
    // Mirror of undoThrough's single-entry fallback above.
    showToast("info", inverses.length === 1
      ? t(lang, "redoneX", inverses[0].meta.label)
      : t(lang, "redoneNActions", inverses.length));
    setRedoStack(taken.rest);
    setStack((s) => pushUndoMany(s, inverses, UNDO_CAP));
  }, []);

  // Redo the last undone op: apply its forward runner (which returns a fresh undo
  // runner so redo→undo round-trips), and push the re-undoable entry back on top.
  const redo = useCallback(() => {
    const popped = popUndo(redoStackRef.current);
    if (!popped) return;
    const undoRun = popped.entry.run();
    const { lang, logActivity, showToast } = depsRef.current;
    logActivity("redo", popped.entry.meta.count, ...reversedKindCounts([popped.entry.meta]));
    showToast("info", t(lang, "redoneX", popped.entry.meta.label));
    setRedoStack(popped.rest);
    setStack((s) => pushUndo(s, { meta: popped.entry.meta, run: undoRun }, UNDO_CAP));
  }, []);

  // Shared tail: push one undo entry, invalidate any pending redo (a fresh
  // destructive op breaks redo coherence), and fire its action toast. `run` is
  // the entry's directional runner (single- or multi-array).
  const pushEntry = useCallback((
    kind: ActivityKind,
    primaryCount: number,
    run: Runner,
    labelOpts?: { name?: string; entityKey?: UndoEntityKey },
  ) => {
    const id = (idRef.current += 1);
    const label = buildUndoLabel(depsRef.current.lang, kind, primaryCount, labelOpts);
    const meta: UndoMeta = { id, kind, count: primaryCount, timestamp: new Date().toISOString(), label };
    setStack((s) => pushUndo(s, { meta, run }, UNDO_CAP));
    setRedoStack([]);
    const { lang, showToastAction } = depsRef.current;
    const isDelete = kind.endsWith(".deleted");
    const text = t(lang, isDelete ? "undoToastDelete" : "undoToastEdit", primaryCount);
    showToastAction("info", text, { labelKey: "undo", run: () => undoById(id) });
  }, [undoById]);

  const capture = useCallback(<T extends { id: number }>(opts: CaptureOpts<T>) => {
    const { setter, kind, removed = [], edited = [], fromArray, name, entityKey } = opts;
    const images = buildBeforeImages(removed, edited, fromArray);
    if (images.length === 0) return;
    // Toast/count reflect the PRIMARY op (the rows the user acted on), not the
    // incidental dependents an edit-cascade also captured.
    const primaryCount = removed.length > 0 ? removed.length : edited.length;
    pushEntry(kind, primaryCount, fragmentUndoRunner(setter, images), { name, entityKey });
  }, [pushEntry]);

  const captureFieldEdit = useCallback(<T extends { id: number }>(opts: CaptureFieldEditOpts<T>) => {
    const { setter, kind, id, before, after, stampField, name } = opts;
    const stamp = (row: T): T =>
      stampField ? ({ ...row, [stampField]: new Date().toISOString() } as T) : row;
    const merge = (patch: Partial<T>) =>
      setter((prev) => prev.map((r) => (r.id === id ? stamp({ ...r, ...patch }) : r)));
    // Mutually-recursive, reusable undo↔redo runners (function decls hoist).
    function runUndo(): Runner { merge(before); return runRedo; }
    function runRedo(): Runner { merge(after); return runUndo; }
    pushEntry(kind, 1, runUndo, { name });
  }, [pushEntry]);

  const captureComposite = useCallback((opts: CaptureCompositeOpts) => {
    const fragments = opts.parts.filter((f): f is CompositeFragment => f !== null);
    if (fragments.length === 0) return;
    pushEntry(opts.kind, opts.primaryCount, compositeUndoRunner(fragments), { name: opts.name });
  }, [pushEntry]);

  const metas = useMemo(() => stack.map((e) => e.meta), [stack]);
  const redoMetas = useMemo(() => redoStack.map((e) => e.meta), [redoStack]);

  return {
    capture,
    captureFieldEdit,
    captureComposite,
    undo,
    undoById,
    undoThrough,
    redoThrough,
    redo,
    stack: metas,
    redoStack: redoMetas,
    canUndo: stack.length > 0,
    canRedo: redoStack.length > 0,
  };
}
