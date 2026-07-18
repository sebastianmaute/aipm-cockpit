"use client";

// Shared <PaneHeader> (design-system Phase 3g). The title + right-aligned action
// cluster that sits OUTSIDE a view pane's bordered scroller was repeated
// verbatim across ~10 panels (portfolio-health, steering, milestones, budget,
// raid, resource-directory, activity-log, …). One row: an `<h2>` title (the
// caller may pass a trailing count `<span>` inside `title`) and an optional
// right-side action cluster (Print / Reset-columns / Reset-size buttons) that is
// `print:hidden`. Emits the exact prior markup.

import type { ReactNode } from "react";

export interface PaneHeaderProps {
  /** The pane title. Pass a fragment (title + a muted count `<span>`) when the
   *  header shows a count suffix. */
  title: ReactNode;
  /** Right-aligned controls (Print / Reset buttons). Wrapped in a
   *  `print:hidden` flex cluster; omit for a title-only header. */
  actions?: ReactNode;
  /** Bottom margin utility (default `mb-2`; a few panels used `mb-3`). */
  className?: string;
}

export function PaneHeader({ title, actions, className = "mb-2" }: PaneHeaderProps) {
  return (
    <div className={`${className} flex shrink-0 items-center justify-between gap-2`}>
      <h2 className="text-lg font-medium text-foreground">{title}</h2>
      {actions ? <div className="flex items-center gap-2 print:hidden">{actions}</div> : null}
    </div>
  );
}
