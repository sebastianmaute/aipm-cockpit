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
}

export function executeActionCta(cta: ActionCta, deps: ActionCtaExecDeps): void {
  if (cta.kind === "open") {
    deps.requestOpen(cta.view, Number(cta.id));
    return;
  }
  if (cta.kind === "open-tasks-for") {
    // Reset FIRST: a stale search/group/label filter would otherwise intersect
    // the new one to zero rows and the deep-link would look broken.
    deps.resetFilters();
    deps.setAssigneeFilter(cta.resourceName);
    // "red" is the existing needs-attention filter (overdue OR blocked OR a
    // manual R override) - the closest standing filter to "their overdue work".
    deps.setHealthFilter("red");
    // No requestOpen / hash write: there is no entity id to deep-link, and
    // requestOpen would push #open-points/<id>. Mirrors requestChat.
    deps.setActiveTab("open-points");
  }
}
