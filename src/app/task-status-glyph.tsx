"use client";

import { isTaskClosed, isTaskDelivered } from "./task-closed";
import { RagDot } from "./rag-dot";
import type { TaskHealth } from "./health";
import type { Task } from "./types";

/**
 * The Open Points status cell. Three states, and the middle one is the reason
 * this is its own component: `isTaskClosed` covers Done AND Cancelled, but only
 * Done is DELIVERED, so the two closed states must differ by GLYPH SHAPE — not
 * colour. The Status column is hideable, and a colour-only distinction is the
 * WCAG 1.4.1 pattern this repo already tracks two open follow-ups about.
 *
 * `label` is the caller's already-derived accessible name and is IDENTICAL in
 * every branch: it already says "cancelled" vs "Completed on {date}", so AT
 * distinguishes them. This adds the visual channel only.
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
