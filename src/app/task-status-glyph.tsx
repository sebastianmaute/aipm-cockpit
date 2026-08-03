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
 * already tracks fourteen instances of. (§56 is a NEIGHBOURING but different
 * SC — 1.4.11 contrast — so do not read this as "the §56 problem".)
 *
 * ★ `label` is the caller's already-derived accessible name and is IDENTICAL
 * in every branch: it already says "cancelled" vs "Completed on {date}", so AT
 * distinguishes them. This adds the VISUAL channel only — do not fork `label`.
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
