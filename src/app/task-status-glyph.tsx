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
 * tracks. ★ §55's HEADLINE count is fourteen and its body retracts it — two of
 * the fourteen toggles carry a non-colour cue, so twelve are instances of this
 * pattern. Do not copy the headline number. (§56 is a NEIGHBOURING but
 * different SC — 1.4.11 contrast — so do not read this as "the §56 problem".)
 *
 * ★ `label` is the caller's already-derived accessible name and is passed
 * through IDENTICALLY in every branch. For the pair this change is about it
 * already distinguishes them — "Completed on {date}" for a delivered task,
 * "…: cancelled" for a cancelled one — so this adds the VISUAL channel only.
 * Do not fork `label`.
 *
 * ★★ It does NOT distinguish the THIRD case. A task with status "Done" and no
 * `completedDate` is closed but not delivered, so it takes the ✕ branch while
 * `formatHealthTooltip` still derives its drivers from `status` and announces
 * "completed" — the same thing the ✓ announces. That is the open defect
 * `docs/open-followups.md` §65 records, and its fix belongs in the health
 * engine, not here. Do not read the bullet above as "AT is covered in every
 * branch"; it is covered in two of three.
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
