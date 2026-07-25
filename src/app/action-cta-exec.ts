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
  /** Clears the row-HIDING filters ONLY, never the sort — see the open-tasks-for
   *  arm below for why the distinction matters. */
  resetFilterValues: () => void;
  setAssigneeFilter: (value: string) => void;
  setHealthFilter: (value: HealthFilter) => void;
  setActiveTab: (view: AppView) => void;
  /** Live assignee filter options. The CTA carries the resource's display name,
   *  but an unlinked task keeps its raw `assignee` string and the filter matches
   *  EXACTLY — while the workload engine that raised the action joins by
   *  case-folded name. Without this the filter value can match no option, silently
   *  resolve to "All", and show every red task in the project.
   *
   *  ★ OPTIONAL, and undefined is NOT the same as empty: it means the caller did
   *  not tell us what the filter offers, so we cannot know a value is orphaned
   *  and fall back to the CTA's name as before. Only a PROVIDED list that misses
   *  the person is proof of an orphan. */
  assigneeOptions?: readonly string[];
  /** Called instead of filtering when `assigneeOptions` is provided and contains
   *  no match — see the open-tasks-for arm. Kept as a bare callback so this module
   *  stays free of i18n/diagnostics; the caller decides how to tell the user. */
  onUnresolvedAssignee?: (resourceName: string) => void;
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
    case "open-tasks-for": {
      // Match the STORED option, not the CTA's display name: the filter compares
      // assignee exactly, so "Bo Smith" against a task assigned "bo smith" hides
      // every row — and an unmatched value resolves to "All", which shows every
      // red task in the project as if it were one person's overdue work.
      const target = deps.assigneeOptions
        ? deps.assigneeOptions.find((o) => o.toLowerCase() === cta.resourceName.toLowerCase())
        : cta.resourceName;
      // ★★ A provided list with NO match means this person cannot be selected in
      // the filter at all — most often because `hideExternalTasks` keeps their
      // tasks out of the options while buildWorkloadAlerts still raised the
      // overload action from the unfiltered workload. Setting the name anyway is
      // the exact failure the block above describes: resolveEffectiveFilters
      // turns the orphan into FILTER_ALL, and the user is shown the whole
      // project's red backlog under one person's name. So DON'T filter — say so
      // instead. We bail BEFORE resetFilterValues() too: wiping the filters the
      // user had set, for a navigation that is not going to happen, would be a
      // second silent loss on top of the first.
      if (target === undefined) {
        deps.onUnresolvedAssignee?.(cta.resourceName);
        return;
      }
      // Reset FIRST: a stale search/group/label filter would otherwise intersect
      // the new one to zero rows and the deep-link would look broken.
      // ★ Filter VALUES only — the sort is deliberately left alone. That
      // argument is about rows being HIDDEN, and a sort order cannot hide a row;
      // resetting it would silently throw away an ordering the user chose.
      deps.resetFilterValues();
      deps.setAssigneeFilter(target);
      // "red" is the existing needs-attention filter (overdue OR blocked OR a
      // manual R override) - the closest standing filter to "their overdue work".
      deps.setHealthFilter("red");
      // No requestOpen / hash write: there is no entity id to deep-link, and
      // requestOpen would push #open-points/<id>. Mirrors requestChat.
      deps.setActiveTab("open-points");
      return;
    }
    case "snooze":
      // The row's snooze control owns this one; nothing to navigate to.
      return;
    default: {
      const exhaustive: never = cta;
      return exhaustive;
    }
  }
}
