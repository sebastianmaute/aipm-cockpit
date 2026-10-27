// Every place app code asks "may the AI act?", by predicate. `ai-activation-sites.test.ts` scans
// `src` and fails when this table and the code disagree, so a new call site cannot slip in
// unreviewed: adding one means adding its row here, which is where a reviewer sees it.
//
// ★ Literal CALLS only. A component that receives the answer as a prop (the chat panel's `ai`
//   gate, `aiEnabled`, `aiConfigured`) is not listed; the file that computes it is.
// ★ `isAiBackgroundEnabled` is the stricter predicate (interactive AND background consent). A runner
//   that fires without a click must be on it, never on `isAiEnabled` alone.

export type AiActivationPredicate = "aiKeyIfEnabled" | "isAiBackgroundEnabled" | "isAiEnabled";

export const AI_ACTIVATION_SITES: Readonly<Record<string, readonly AiActivationPredicate[]>> = {
  "app/create-project-wizard.tsx": ["aiKeyIfEnabled"],
  "app/digest/digest-card-connected.tsx": ["aiKeyIfEnabled", "isAiBackgroundEnabled"],
  "app/note-log-panel.tsx": ["isAiEnabled"],
  "app/settings-sections/next-actions-section.tsx": ["aiKeyIfEnabled", "isAiEnabled"],
  "app/settings-sections/scheduled-jobs-section.tsx": ["isAiBackgroundEnabled", "isAiEnabled"],
  "app/settings-types.ts": ["isAiEnabled"],
  "app/shell-chrome.tsx": ["isAiEnabled"],
  "app/task-manager.tsx": ["aiKeyIfEnabled", "isAiEnabled"],
  "app/use-ai-orchestration.ts": ["aiKeyIfEnabled", "isAiBackgroundEnabled", "isAiEnabled"],
  "app/use-alloc-plan.tsx": ["aiKeyIfEnabled", "isAiEnabled"],
  "app/use-entity-inline-ai-edit.tsx": ["aiKeyIfEnabled"],
  "app/use-forecast-import.ts": ["aiKeyIfEnabled", "isAiEnabled"],
  "app/use-inline-entity-edit.ts": ["isAiEnabled"],
  "app/use-insight-recommendations.ts": ["aiKeyIfEnabled", "isAiBackgroundEnabled"],
  "app/use-meeting-report-actions.ts": ["isAiEnabled"],
  "app/use-raci-suggest.tsx": ["aiKeyIfEnabled", "isAiEnabled"],
  "app/use-tasks-dedup.tsx": ["aiKeyIfEnabled", "isAiEnabled"],
  "app/use-tasks-inline-ai-edit.tsx": ["aiKeyIfEnabled"],
  "app/use-wbs-plan.tsx": ["aiKeyIfEnabled", "isAiEnabled"],
  "app/workspace-section.tsx": ["isAiEnabled"],
};

/** The three runners that fire without a click; each must stay on the background predicate. */
export const AI_BACKGROUND_SITES: readonly string[] = [
  "app/digest/digest-card-connected.tsx",
  "app/use-ai-orchestration.ts",
  "app/use-insight-recommendations.ts",
];
