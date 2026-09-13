// src/app/next-actions/providers/project-meta.ts
import { keyFactCompleteness, type KeyFactId } from "../../project-key-facts";
import { bandTier, scoreAction } from "../score";
import type { TranslationKey } from "../../i18n";
import type { ActionInput, ActionProvider, SuggestedAction } from "../types";

type NudgedFact = Exclude<KeyFactId, "name">;

/** Per-fact weight (spec §5.2). There is no date math, so these exist only to
 *  make the group's primary deterministic: identity facts lead, then the start
 *  date, then the rest.
 *  ★★ Every weight must stay below TIER_NOW - BIAS_CAP (60 - 20 = 40): a blank
 *  profit centre must never outrank an overdue milestone, even at maximum
 *  learned bias. A test pins that through the engine. */
export const PROJECT_META_WEIGHT: Readonly<Record<NudgedFact, number>> = Object.freeze({
  code: 36,
  projectManager: 35,
  customer: 34,
  startDate: 31,
  products: 20,
  profitCenter: 19,
  naceSection: 18,
  deployment: 17,
  contactPersons: 16,
  regulatory: 15,
});

const WHY_KEY: Readonly<Record<NudgedFact, TranslationKey>> = {
  code: "actionProjectMetaWhyCode",
  projectManager: "actionProjectMetaWhyProjectManager",
  customer: "actionProjectMetaWhyCustomer",
  startDate: "actionProjectMetaWhyStartDate",
  products: "actionProjectMetaWhyProducts",
  profitCenter: "actionProjectMetaWhyProfitCenter",
  naceSection: "actionProjectMetaWhyNaceSection",
  deployment: "actionProjectMetaWhyDeployment",
  contactPersons: "actionProjectMetaWhyContactPersons",
  regulatory: "actionProjectMetaWhyRegulatory",
};

/** Core (always-on) provider: one action per missing key fact on the CURRENT
 *  project. They share a CTA target, so groupNextActions collapses them into one
 *  row whose "+N more reasons" lists the rest (spec §3.2).
 *  ★ `name` is never nudged: a blank name cannot be persisted (sanitizeProjectMeta
 *  rejects the record), so the only blank name is a transient in-memory one.
 *  ★ The CTA id is the project id STRING; action-cta-exec navigates without a
 *  deep-link for string ids, and `onPoints` stays false because the view is
 *  `projects`, so it carries no TASK-SPECIFIC verb (mark-done, clear-blocker,
 *  reschedule, draft — all gated on `onPoints`/`task-due`/`stakeholder-comms`
 *  in `action-cta.ts`). `canCreateTask` gates only on `a.source !== "task-due"`,
 *  which a project-meta action always satisfies, so Create task REMAINS
 *  available in the overflow when the caller has the `onCreateTask` capability
 *  — filling in a missing fact is a legitimate task. */
export const projectMetaProvider: ActionProvider = {
  provide(input: ActionInput): SuggestedAction[] {
    const { projectId, projectMeta } = input;
    if (!projectId || !projectMeta) return [];
    const out: SuggestedAction[] = [];
    for (const fact of keyFactCompleteness(projectMeta).missing) {
      if (fact === "name") continue;
      const score = scoreAction({ impact: PROJECT_META_WEIGHT[fact] });
      out.push({
        id: `project-meta:${projectId}:${fact}`,
        source: "project-meta",
        title: { key: "actionProjectMetaTitle", params: [projectMeta.name] },
        why: { key: WHY_KEY[fact] },
        score,
        tier: bandTier(score),
        cta: { kind: "open", view: "projects", id: projectId },
      });
    }
    return out;
  },
};
