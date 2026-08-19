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
  capture: UndoStackApi["capture"];
  captureComposite: UndoStackApi["captureComposite"];
  logActivity: (kind: ActivityKind, ...args: (string | number)[]) => void;
}

export interface BudgetBucketsApi {
  commitBuckets: (next: readonly BudgetBucket[], meta?: BucketCommitMeta) => void;
}

export function useBudgetBuckets(deps: Deps): BudgetBucketsApi {
  const { budgets, setBudgets, capture, captureComposite, logActivity } = deps;

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
    setBudgets(next);
  }

  return { commitBuckets };
}
