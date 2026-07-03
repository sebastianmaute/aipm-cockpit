# `useAiOrchestration` — advisory AI orchestration

**Source:** `src/app/use-ai-orchestration.ts` · **Extracted from** `task-manager.tsx` (Phase 3, move-only).

## Purpose
Holds the ABOVE-the-view AI advisory wiring so its in-memory results survive view
remounts: Analyze-with-AI (`use-action-analysis`), the weight-suggestion context
builder, and the opt-in scheduled-job runner (`use-scheduled-job-runner`). All are
advisory only — they never write workspace data and add no AI tools (the
deterministic `next-actions/` engine is untouched).

## Interface
`useAiOrchestration(deps: AiOrchestrationDeps)` — a **deps-object hook** (called
unconditionally, non-memoized returns). `deps` carries the live workspace refs +
setters, `settings`, `isPopout`, `logActivity`, and the learning/trends inputs the
analysis + weight-suggestion calls consume. Returns `{ aiAnalysisBundle,
buildWeightSuggestionContext }`. The chat dispatcher and action-notifications are
deliberately NOT moved here (they live elsewhere in task-manager).

## Invariants
- **Mounted in task-manager, above the view** — results must survive view remounts;
  do NOT move this into a view component.
- Every returned bundle is `deps.isPopout ? undefined : …` — **never runs in popouts**.
- Gated on a configured Anthropic key via `isAiEnabled(settings.ai)` at the call
  sites; the scheduled-job runner is additionally opt-in (`ai.scheduledJobs === true`).
- `MAX_LEARNING_SUMMARY_ENTRIES = 20` lives in this file.

## Coverage
Render-scope UI-glue hook — **excluded from the coverage gate**. The pure contracts
it calls (`action-ai.ts`, `next-actions-tuning.ts`, `scheduled-jobs/`, `weight-suggestion-ai.ts`)
stay gated and hold the validated behavior. See AGENTS.md "AI Assistant" section.
