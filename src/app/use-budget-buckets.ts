// src/app/use-budget-buckets.ts
// The SINGLE commit boundary for budget buckets. Every write funnels through
// `commitBuckets`, which diffs prev→next, captures an undo entry, logs the
// activity, and only then calls setBudgets.
//
// ★ Handlers are deliberately NOT memoized: they read the live `budgets` from
// the deps object on every render (the deps-object hook convention).
"use client";
import type { Dispatch, SetStateAction } from "react";
import type { ActivityKind } from "./activity-log";
import type { BudgetBucket } from "./types";
import { capturePart, type CompositeFragment, type UndoStackApi } from "./undo/use-undo-stack";
import { recordBudgetChange, type BudgetHistoryEntry, type ProjectBac } from "./budget-history";

export interface BucketCommitMeta {
  /** Overrides the kind derived from the diff. */
  kind?: ActivityKind;
  /** Bucket name for the undo label + the activity message. Omitted, a
   *  single-row commit falls back to that row's own name. */
  name?: string;
  /** When present the commit becomes one COMPOSITE undo entry spanning both
   *  arrays — used by the tasks bulk edit, which edits tasks and re-links
   *  buckets in a single apply. The caller still owns its own setTasks. */
  tasksPart?: CompositeFragment | null;
  /** User-facing row count for a composite entry's toast. */
  primaryCount?: number;
  /** The caller already writes its own activity row for this commit (the tasks
   *  bulk edit logs one `bulk.edit` for the rows it touched). Without this the
   *  same apply produces TWO rows, the second counting BUCKETS while claiming
   *  the task kind. */
  callerLogs?: boolean;
}

interface Deps {
  budgets: readonly BudgetBucket[];
  setBudgets: Dispatch<SetStateAction<readonly BudgetBucket[]>>;
  /** Arms the one-shot save-guard bypass. `budgets` is a COUNTED slice, so a
   *  deliberate bucket deletion can trip the save-time data-loss guard and be
   *  refused. ★ Armed ONLY when a row was genuinely removed — the bypass is
   *  one-shot, so arming on an edit-only or no-op commit LEAKS it and some
   *  later accidental mass deletion spends it. */
  allowDestructiveSave?: () => void;
  capture: UndoStackApi["capture"];
  captureComposite: UndoStackApi["captureComposite"];
  logActivity: (kind: ActivityKind, ...args: (string | number)[]) => void;
  /** Project own-basis BAC (hours/EUR) for a bucket set. Absent for callers
   *  that predate budget history (e.g. bulk-edit test doubles) — recording is
   *  skipped entirely rather than defaulting, so no history entry is ever
   *  minted from a synthetic zero BAC. */
  projectBac?: (buckets: readonly BudgetBucket[]) => ProjectBac;
  setBudgetHistory?: Dispatch<SetStateAction<readonly BudgetHistoryEntry[]>>;
  today?: string;
}

export interface BudgetBucketsApi {
  commitBuckets: (next: readonly BudgetBucket[], meta?: BucketCommitMeta) => void;
}

export function useBudgetBuckets(deps: Deps): BudgetBucketsApi {
  const { budgets, setBudgets, allowDestructiveSave, capture, captureComposite, logActivity, projectBac, setBudgetHistory, today } = deps;

  function commitBuckets(next: readonly BudgetBucket[], meta?: BucketCommitMeta): void {
    const prev = budgets;
    const prevById = new Map(prev.map((b) => [b.id, b]));
    const nextIds = new Set(next.map((b) => b.id));
    const created = next.filter((b) => !prevById.has(b.id));
    const deleted = prev.filter((b) => !nextIds.has(b.id));
    // Edited = same id, different OBJECT. Every producer preserves the identity
    // of untouched buckets, so reference inequality is both cheap and exact —
    // and it avoids a JSON key-order false positive.
    const editedBefore = next
      .filter((b) => { const p = prevById.get(b.id); return p !== undefined && p !== b; })
      .map((b) => prevById.get(b.id)!);

    const touched = created.length + deleted.length + editedBefore.length;
    if (touched === 0) return;

    const kind: ActivityKind = meta?.kind
      ?? (deleted.length > 0
        ? "budget.deleted"
        : created.length > 0
          ? "budget.created"
          : "budget.updated");

    // The activity templates take ONE placeholder (the bucket name), so a
    // single-row commit that named nothing falls back to the row it touched —
    // a bare count there would render "Budget bucket deleted: 1". The same name
    // rides the undo label: an entity key with no name silently degrades to the
    // generic "Deleted N item(s)" fallback.
    const soleRow = deleted[0] ?? editedBefore[0] ?? created[0];
    const name = meta?.name ?? (touched === 1 ? soleRow.name : undefined);

    // ★ `edited` carries the PREVIOUS images (they are the restore payload), and
    // created rows are excluded entirely — there is no before-image for a row
    // that did not exist, and no entity in the app captures a create.
    // `isPrimary: true` — a composite's `tasksPart` (when present) is now a
    // FIELD part (`captureFieldPart`), which publishes no id-remap and would
    // otherwise become the nominal primary by position, silently leaving any
    // `fkRemapField` cascade pointed at stale ids. Flagging this one keeps the
    // real primary here regardless of which slot `tasksPart` occupies.
    const budgetsPart = capturePart<BudgetBucket>({
      setter: setBudgets,
      removed: deleted,
      edited: editedBefore,
      fromArray: prev,
      isPrimary: true,
    });

    if (meta?.tasksPart !== undefined && meta.tasksPart !== null) {
      captureComposite({
        kind,
        primaryCount: meta.primaryCount ?? (deleted.length + editedBefore.length),
        parts: [meta.tasksPart, budgetsPart],
        name,
        // ★★ "task", NOT "budget" — and this literal is safe only under BOTH
        // halves of a coupling that nothing here enforces. `buildUndoLabel`
        // resolves the noun as `entityKey ?? entityKeyFromKind(kind)`, so the
        // literal OVERRIDES whatever entity the caller's `kind` carries, while
        // the branch is selected on `tasksPart` ALONE and never reads `kind`
        // or `primaryCount`. It is correct only for a caller whose count AND
        // kind both describe the TASKS side. Exactly one reaches it today
        // (`use-bulk-operations.ts`) and satisfies both:
        //   COUNT half — it passes its TASK count as `primaryCount`. Naming the
        //   entity "budget" would label a task count with the wrong noun
        //   ("Bulk edit 3 budget buckets" for 3 edited tasks). The bucket-count
        //   fallback beside it applies only to a future caller supplying a
        //   tasksPart WITHOUT a primaryCount.
        //   KIND half — it passes `kind: "bulk.edit"`, which is entity-AMBIGUOUS
        //   by construction (`entityKeyFromKind` yields null for it, so this
        //   literal supplies the only entity there is). A future caller
        //   supplying a tasksPart with an entity-FLAVOURED kind gets that kind's
        //   own entity silently overridden instead: `kind: "budget.deleted"`
        //   renders "Deleted N tasks" — wrong noun, wrong operation, no error
        //   anywhere, and no gate that can see it.
        // EITHER half failing is the trigger to make the entity a parameter.
        // Do NOT add one before then: a parameter defaulting to "task"
        // reinstates the identical silent mislabel for any caller that forgets
        // it, minus this warning.
        entityKey: "task",
      });
    } else if (budgetsPart !== null) {
      capture<BudgetBucket>({
        setter: setBudgets,
        kind,
        removed: deleted,
        edited: editedBefore,
        fromArray: prev,
        name,
        entityKey: "budget",
      });
    }

    if (meta?.callerLogs !== true) logActivity(kind, name ?? touched);
    // ★ `deleted.length > 0`, never `touched > 0`: an edit- or create-only
    // commit removes no record, so arming there would leak the one-shot bypass
    // into whatever save follows. Computed from the prev→next diff above, not
    // inside a setState updater (React may run an updater more than once).
    if (deleted.length > 0) allowDestructiveSave?.();

    // Budget-at-completion history (spec §4.3, R1). Skipped entirely for
    // callers that don't pass all three deps (old callers / test doubles) —
    // see the `projectBac` doc comment. `historyKind` is derived from the
    // diff, never from `meta?.kind`, because an overriding activity kind (for
    // example a task-link commit) is not a budget kind.
    if (projectBac && setBudgetHistory && today) {
      const before = projectBac(prev);
      const after = projectBac(next);
      // One commit touching several buckets records ONE entry: the first bucket
      // OF THE KIND THAT ENTRY CLAIMS, and the whole BAC delta.
      // ★ `historyRow` is selected by the SAME three-way test as `historyKind`,
      // never by the `soleRow` order above (`deleted ?? edited ?? created`). A
      // commit that both creates and edits — no caller produces one today, but
      // nothing here prevents it — would otherwise record kind "created" while
      // `bucketId`/`bucketName` named the EDITED bucket, and the chart marker
      // and change-table row would name the wrong one. `soleRow` keeps its own
      // order because it only ever feeds the `touched === 1` name fallback,
      // where exactly one list holds a row, so both selectors pick that row.
      const historyKind = deleted.length > 0 ? "deleted" : created.length > 0 ? "created" : "updated";
      const historyRow = historyKind === "deleted" ? deleted[0] : historyKind === "created" ? created[0] : editedBefore[0];
      // An edit's `historyRow` is the PRE-edit bucket; name the entry after the saved one.
      const bucketName = historyKind === "deleted"
        ? historyRow.name
        : next.find((b) => b.id === historyRow.id)?.name ?? historyRow.name;
      const at = new Date().toISOString();
      setBudgetHistory((h) => recordBudgetChange(h, {
        kind: historyKind, bucketId: historyRow.id, bucketName,
        before, after, at, date: today, newId: () => crypto.randomUUID(),
      }));
    }

    setBudgets(next);
  }

  return { commitBuckets };
}
