// src/app/action-cta-exec.ts
//
// Executes a SuggestedAction's primary CTA against the live surface. Lives
// OUTSIDE next-actions/ on purpose: the engine stays pure and serializable, and
// this is the one place that turns a CTA into navigation + filter state.
import type { ActionCta } from "./next-actions/types";
import type { AppView } from "./nav-config";
import type { HealthFilter } from "./health";

export interface ActionCtaExecDeps {
  requestOpen: (view: AppView, id: number) => void;
  resetFilters: () => void;
  setAssigneeFilter: (value: string) => void;
  setHealthFilter: (value: HealthFilter) => void;
  setActiveTab: (view: AppView) => void;
  /** Live assignee filter options. The CTA carries the resource's display name,
   *  but an unlinked task keeps its raw `assignee` string and the filter matches
   *  EXACTLY — while the workload engine that raised the action joins by
   *  case-folded name. Without this the filter value can match no option, silently
   *  resolve to "All", and show every red task in the project. */
  assigneeOptions?: readonly string[];
}

/** ★★ An exhaustive switch, NOT a chain of `if (cta.kind === …)` guards. Every
 *  OTHER consumer of a CTA in this app is an if-guard, which is exactly why a new
 *  arm can be added and silently do nothing everywhere — the compiler never
 *  objects. This is the one dispatch point that must fail loudly instead, so the
 *  `never` default turns a future arm into a tsc error here. */
export function executeActionCta(cta: ActionCta, deps: ActionCtaExecDeps): void {
  switch (cta.kind) {
    case "open":
      deps.requestOpen(cta.view, Number(cta.id));
      return;
    case "open-tasks-for":
      // Reset FIRST: a stale search/group/label filter would otherwise intersect
      // the new one to zero rows and the deep-link would look broken.
      deps.resetFilters();
      // Match the STORED option, not the CTA's display name: the filter compares
      // assignee exactly, so "Bo Smith" against a task assigned "bo smith" hides
      // every row — and an unmatched value resolves to "All", which shows every
      // red task in the project as if it were one person's overdue work.
      deps.setAssigneeFilter(
        deps.assigneeOptions?.find((o) => o.toLowerCase() === cta.resourceName.toLowerCase())
          ?? cta.resourceName,
      );
      // "red" is the existing needs-attention filter (overdue OR blocked OR a
      // manual R override) - the closest standing filter to "their overdue work".
      deps.setHealthFilter("red");
      // No requestOpen / hash write: there is no entity id to deep-link, and
      // requestOpen would push #open-points/<id>. Mirrors requestChat.
      deps.setActiveTab("open-points");
      return;
    case "snooze":
      // The row's snooze control owns this one; nothing to navigate to.
      return;
    default: {
      const exhaustive: never = cta;
      return exhaustive;
    }
  }
}
