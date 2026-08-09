"use client";

import { isTaskClosed, isTaskDelivered } from "./task-closed";
import { RagDot } from "./rag-dot";
import type { TaskHealth } from "./health";
import type { Task } from "./types";

/**
 * The Open Points status cell — the `status` column, whose header reads
 * "Health". Three states.
 *
 * ★ It lives in its own file for a MECHANICAL reason, not a design one: the
 * cancelled branch pushed `task-row.tsx` past its file-size ratchet baseline,
 * and extracting the cell put it back under. Inlining it again is a size
 * question, not a layering violation.
 *
 * ★★ The two CLOSED states differ by GLYPH SHAPE, not colour. `isTaskClosed`
 * covers Done AND Cancelled but only Done is DELIVERED, and the `taskStatus`
 * column that spells out "Cancelled" is hideable via column config — with it
 * off, this glyph and the row's strikethrough are the entire signal. A muted ✓
 * was the smaller change and was rejected: it would distinguish the two by
 * colour alone, which is the WCAG 1.4.1 pattern `docs/open-followups.md` §55
 * tracks. ★ Deliberately NO number here. §55's HEADLINE count over-counts for
 * this purpose — its own body retracts two of the toggles as carrying a
 * non-colour cue — and that count has already moved once (fourteen → thirteen,
 * when the field-visibility tier switch adopted `role="radio"`) while this
 * comment went on asserting the old one. Read §55 and run its reproduce
 * command rather than copying a figure from here. (§56 is a NEIGHBOURING but
 * different SC — 1.4.11 contrast — so do not read this as "the §56 problem".)
 *
 * ★ `label` is the caller's already-derived accessible name and is passed
 * through IDENTICALLY in every branch. For the pair this change is about it
 * already distinguishes them — "Completed on {date}" for a delivered task,
 * "…: cancelled" for a cancelled one — so this adds the VISUAL channel only.
 * Do not fork `label`.
 *
 * ★★ The THIRD case — status "Done" with no `completedDate` — is closed but not
 * delivered, so it takes the ✕ branch. It used to announce "completed" here,
 * because `formatHealthTooltip` derived its drivers from `status` alone; that
 * was `docs/open-followups.md` §65, whose tooltip half is now closed. `computeTaskHealth`'s driver is
 * three-way (`cancelled` / `completed` / `closed`) and this pair yields
 * `closed`, so the glyph and the announcement agree. The fix was in the health
 * engine, not here — this component is unchanged by it.
 */
export function TaskStatusGlyph({ task, health, label }: {
  task: Task;
  health: TaskHealth;
  label: string;
}) {
  if (!isTaskClosed(task) || task.healthOverride) {
    return <RagDot level={health.color} size="md" label={label} />;
  }
  return isTaskDelivered(task) ? (
    <span role="img" title={label} aria-label={label} className="text-ui-green-strong">✓</span>
  ) : (
    <span role="img" title={label} aria-label={label} className="text-muted-foreground">✕</span>
  );
}
