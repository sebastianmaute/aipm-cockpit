# AI Orchestration SP4 — Action Center AI suggestions

**Date:** 2026-06-19
**Status:** Approved (brainstorming complete)
**Part of:** the "AI orchestration" roadmap (6 sub-projects). This is **SP4**; it builds on **SP0** (context-aware Claude core, v0.97.0 "Gaiman") and reuses the forced-tool one-shot pattern from **SP3** (v0.103.0 "Watts") and the chat-seed channel from **SP1** (v0.98.0 "Pohl").

## Roadmap context

| # | Sub-project | Status |
|---|---|---|
| SP0 | Context-aware Claude core | ✅ merged (0.97.0) |
| SP1 | Foundational prompts + per-window "Ask Claude" buttons | ✅ merged (0.98.0) |
| SP2 | Write-tool expansion + document ingestion | ✅ merged (0.102.0) |
| SP3 | AI project-creation wizard ("Use AI") | ✅ merged (0.103.0) |
| **SP4** | **Action Center AI suggestions** (this spec) | — |
| SP5 | Scheduled Claude jobs | depends on SP0 |

SP5 is **out of scope** here.

## Goal

Add Claude into the Action Center as an **advisory** layer. On an explicit click, Claude analyzes the
current workspace and returns (a) a short triage **summary** over the existing rule-based action queue
and (b) a few **net-new cross-cutting suggested actions** the deterministic providers cannot surface
(root-cause links, sequencing, risks spanning entities). Each AI action is actionable: it opens the
referenced entity when the model grounds it to a real id, otherwise it seeds the AI chat. The
deterministic engine is untouched; AI is purely additive in the surface.

## Locked decisions (from brainstorming)

1. **AI role = Both** — net-new advisory actions **and** a triage summary over the combined queue.
2. **Trigger = manual button** ("Analyze with AI" in the Action Center header). One click = one billed
   Anthropic call. No auto-trigger.
3. **AI action CTA = open-entity-else-chat.** If the model cites an entity id present in the workspace
   (validated in the surface), the CTA deep-links via the existing `requestOpen(view, id)`. Otherwise it
   falls back to **Discuss in chat** via the SP1 `requestChat(prompt, true)` seam.
4. **Result lifetime = in-memory until reload.** Held in a hook mounted **above** the Action Center view
   (in `task-manager.tsx`) so it survives tab-switches (the modern shell remounts each view fresh);
   cleared on page reload. No persistence, nothing at rest.

## What already exists (do not rebuild)

- `next-actions/` — pure i18n-free engine: providers → `SuggestedAction[]` ranked into `now`/`soon`/
  `monitor` tiers (`next-actions/types.ts`, `engine.ts`, `score.ts`). **Untouched by SP4.**
- `actions-panel.tsx` — renders the three tiers as `ActionRow`s; lives in `workspace-section.tsx`,
  receives handler bundles threaded from `task-manager.tsx`. Header already hosts a learning pill +
  `ResetSizeButton`. **AI button + AI section mount here.**
- `action-row.tsx` — the deterministic row (multiple CTA bundles). **Not modified**; AI rows get a
  separate component.
- `workspace-tab-context.tsx` — `requestOpen(view, id)` / `pendingOpen` deep-link trio **and** the SP1
  chat-seed trio `pendingChatSeed` / `requestChat(prompt, autoSend)` / `clearChatSeed`. SP4 reuses both.
- `use-project-proposal.ts` — SP3 one-shot forced-tool Anthropic call (`tool_choice:{type:"tool",…}`,
  no agentic loop; status-only error; reuses live in-memory `apiKey`). **Template for the SP4 hook.**
- `ai-project-proposal.ts` — SP3 pure contract (`PROPOSAL_TOOL`, `parseProposal`,
  `buildProposalSystemPrompt`, `isSafeHttpUrl` gate). **Template for the SP4 pure module.**
- `chat-panel.tsx` `buildSystemPrompt(lang, dispatcher.getSnapshot(), guides, groundInGuides)` →
  `SystemBlock[]`; `dispatcher.getSnapshot()` exposes project/today/mode/modules/view/taskCount/etc.
- `settings` `ai` block — `ai.groundInGuides` (SP0) is the pattern for a new `ai.actionSuggestions`
  toggle. `api.anthropic.com` already in the CSP `connect-src` allowlist (`src/proxy.ts`).

## Section 1 — Pure module `action-ai.ts` (i18n-free, no React)

```ts
import type { AppView } from "./nav-config";

export type AiActionSeverity = "now" | "soon" | "monitor";

export interface AiAction {
  title: string;                 // model text, short
  why: string;                   // model text, short
  severity: AiActionSeverity;    // maps to existing tiers
  entity?: { view: AppView; id: string }; // optional; grounded to a real id in the surface
}

export interface ActionAnalysis {
  summary: string;               // triage paragraph over the existing queue
  actions: AiAction[];           // net-new cross-cutting suggestions
}

// Anthropic tool definition (forced via tool_choice in the hook). input_schema:
// object { summary: string; actions: array of { title, why, severity enum, entity? {view,id} } }.
export const ANALYZE_TOOL: { name: "report_analysis"; description: string; input_schema: object };

// Validate + clamp the model's tool input. Returns null on garbage.
export function parseAnalysis(input: unknown): ActionAnalysis | null;

// Compact, token-bounded workspace digest + the current deterministic queue.
export function buildAnalysisContext(input: AnalysisContextInput): string;

// Stable cacheable system prompt (senior-PM framing, SP0-consistent).
export function buildAnalysisSystemPrompt(): string;

// Re-validate a model entity ref against the live workspace; null if unknown.
export function groundEntity(
  entity: { view: AppView; id: string } | undefined,
  index: GroundingIndex,
): { view: AppView; id: string } | null;
```

- `parseAnalysis`: require `summary: string` + `actions: array`; per action require non-empty
  `title`/`why`; clamp `severity` to the three tiers (default `soon` on anything else); cap the actions
  array (e.g. ≤ 8); drop malformed entries rather than failing the whole parse; `entity` kept only when
  shaped `{view, id}` (grounding happens later, in the surface).
- `buildAnalysisContext`: emit project name, today, mode, enabled modules, task count, then capped lists
  (≤ 30 each) of open Tasks / active RAID / upcoming Milestones / pending Changes **with real ids +
  view**, then the current `SuggestedAction[]` (title/why/tier). State the per-category cap so the model
  knows the list is truncated.
- `buildAnalysisSystemPrompt`: instruct Claude to (a) triage the existing queue in `summary`, (b) surface
  only net-new, non-duplicate cross-cutting actions, (c) set `entity` only to an id present in the
  context, (d) keep text short. Stable prefix first (prompt-cache rule); the volatile digest is the user
  message, not the system block.
- `groundEntity`: pure lookup against a `GroundingIndex` (sets of valid ids per view) the surface builds
  from the live workspace. Unknown id/view → null → surface renders Discuss-in-chat instead of Open.

## Section 2 — Hook `use-action-analysis.ts`

Mirrors `use-project-proposal.ts`:

```ts
export function useActionAnalysis(ai: { apiKey: string; model: string }) {
  // analyze(context: string): Promise<ActionAnalysis | null>
  // busy, error (status-only string | null), result (ActionAnalysis | null), clear()
}
```

- Single forced-tool call: `tool_choice: { type: "tool", name: "report_analysis" }`, no loop,
  `max_tokens` ~2048, system = `buildAnalysisSystemPrompt()`, user message = the digest from
  `buildAnalysisContext`.
- `apiKey` empty → `error="no-key"`, returns null (button is hidden in that case anyway).
- HTTP non-OK → `throw new Error(String(res.status))`; caught → `error` set to status only. **Never echo
  the key or response body.** Malformed tool output → `parseAnalysis` null → `error="parse"`.
- On success sets `result` (held here so it survives view remounts) and also returns it. `clear()` resets
  `result` + `error`.

## Section 3 — Surface integration

**Mount point:** `task-manager.tsx` instantiates `useActionAnalysis(ai)` alongside the other workspace
AI hooks, builds the `GroundingIndex` from the live workspace + the `buildAnalysisContext` input, and
threads an `aiAnalysis` bundle down through `workspace-section.tsx` to `ActionsPanel`:

```ts
interface AiAnalysisBundle {
  enabled: boolean;             // settings.ai?.apiKey present && settings.ai?.actionSuggestions !== false
  busy: boolean;
  error: string | null;
  result: ActionAnalysis | null;
  onAnalyze: () => void;        // builds context, calls analyze()
  onClear: () => void;
  onOpenAiAction: (a: AiAction) => void;  // groundEntity → requestOpen | requestChat
}
```

- `onAnalyze` lives in `task-manager.tsx` (has workspace + dispatcher snapshot); builds the context
  string then calls `analyze`.
- `onOpenAiAction`: `groundEntity(a.entity, index)` → valid → `requestOpen(view, id)` + switch to that
  view; else → `requestChat(\`${a.title}\n\n${a.why}\`, true)` + switch to chat.

**`ActionsPanel` (header):** add the **"Analyze with AI"** button beside the learning pill, rendered
only when `aiAnalysis.enabled`. States: idle → label; `busy` → spinner + disabled; after a result →
re-run replaces it. Inline `error` message shows status only.

**`ActionsPanel` (body):** when `result` is present, render a distinct **AI section above the tier
sections**:
- An icon + heading ("AI suggestions") + a one-line disclaimer that rows are model-generated.
- `result.summary` as a short triage paragraph.
- One `AiActionRow` per `result.actions` entry, tagged by severity, with the open/chat CTA. New
  component `ai-action-row.tsx` — **not** folded into `ActionRow` (different CTA set + data shape).
- A **Dismiss/Clear** control (`onClear`) removing the AI section until the next analysis.

## Section 4 — Gating, errors, a11y, i18n, release

- **Gating:** button + section render only when an Anthropic key is configured **and** master toggle
  `ai.actionSuggestions !== false`. Add the toggle to **Settings → AI section** (mirrors
  `ai.groundInGuides`); default **ON**. `ai` settings type gains the optional field — no new persisted
  `Workspace` field, no new write path.
- **Errors:** all paths surface a status-only / generic message inline; nothing throws into render.
- **a11y:** the button and each AI row need accessible names + keyboard operability; per-row names must
  be **action-unique** (qualify by title — WCAG 2.4.6; the single-seeded-row axe trap). The Action
  Center is **not** in the axe 12-view list — verify by eye.
- **i18n:** new EN + DE keys — button label, busy label, AI-section heading, disclaimer, summary label,
  discuss-in-chat CTA, open CTA (reuse existing if present), dismiss, error messages, settings toggle
  label + help. DE via **node UTF-8 write** (real umlauts; file is CRLF; Edit corrupts umlauts).
- **Release:** bump `src/app/version.ts` (APP_VERSION → `0.104.0`, new milestone codename), add a
  `CHANGELOG.md` entry, append `versionHighlightAiActionSuggestions` to `APP_HIGHLIGHT_KEYS` + EN/DE
  strings.

## Testing

- `action-ai.test.ts` (pure): `parseAnalysis` valid/missing/garbage/severity-clamp/array-cap/per-entry
  drop; `buildAnalysisContext` caps each category + emits real ids + truncation note;
  `buildAnalysisSystemPrompt` stable prefix; `groundEntity` valid → ref, unknown id/view → null.
- `use-action-analysis.test.tsx`: success parses + sets result; HTTP error → status-only error (assert
  key/body absent); malformed → `parse` error; busy toggles; `clear` resets.
- `actions-panel.test.tsx` (extend): button hidden without key / shown with key; click → `onAnalyze`;
  result → summary + rows render; Open vs Discuss-in-chat CTA wiring; dismiss → section gone;
  action-unique accessible names.

## Out of scope

- Persistence across reloads; auto-trigger; change-signature refresh.
- AI mutating the workspace (advisory only — CTAs reuse existing open/chat seams; no write tools).
- SP5 scheduled Claude jobs.
- Touching the deterministic `next-actions/` engine.
