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

/** Files that read the stored AI key directly (`ai.apiKey`), not through `aiKeyIfEnabled`. Each is the key's
 *  own plumbing (Settings → AI, the settings store, the key check), a call builder handed a key its caller gated,
 *  or a caller that gates the read itself. A new reader fails `ai-activation-sites.test.ts` until it is listed here.
 *  The hooks and call builders here read `ai.apiKey` from an `ai` object their caller filled with `aiKeyIfEnabled`. */
export const AI_RAW_KEY_READERS: readonly string[] = [
  "app/alloc-plan-call.ts",
  "app/backend-setup-steps.ts",
  "app/backend-setup-wizard.tsx",
  "app/chat-panel.tsx",
  "app/forecast-import-call.ts",
  "app/portfolio-mode-switch.ts",
  "app/raci-suggest-call.ts",
  "app/scheduled-job-analysis.ts",
  "app/settings-sections/ai-section.tsx",
  "app/settings-types.ts",
  "app/task-dedup-call.ts",
  "app/use-action-analysis.ts",
  "app/use-ai-key-check.ts",
  "app/use-insight-recommend.ts",
  "app/use-project-proposal.ts",
  "app/use-scheduled-job-runner.ts",
  "app/use-settings.ts",
  "app/use-weight-suggestions.ts",
  "app/wbs-plan-call.ts",
  "app/weight-suggestion-call.ts",
];

/** Where the ungated key lookup `liveAiKey` may be called: where the predicates themselves are defined. */
export const LIVE_AI_KEY_CALLERS: readonly string[] = ["app/settings-types.ts"];
