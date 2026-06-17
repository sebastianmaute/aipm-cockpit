# SP1 — Foundational prompts + per-window "Ask Claude" — Design Spec

**Date:** 2026-06-17
**Status:** Approved (brainstorming complete)
**Part of:** the "AI orchestration" roadmap (6 sub-projects). This is **SP1**; it builds on **SP0** (context-aware Claude core, merged in v0.97.0 "Gaiman").

## Roadmap context

| # | Sub-project | Status |
|---|---|---|
| SP0 | Context-aware Claude core | ✅ merged (0.97.0) |
| **SP1** | **Foundational prompts + per-window "Ask Claude" buttons** (this spec) | — |
| SP2 | Write-tool expansion + document ingestion → CRUD | depends on SP0 |
| SP3 | AI project-creation wizard ("Use AI") | depends on SP2 |
| SP4 | Action Center AI suggestions | depends on SP0 |
| SP5 | Scheduled Claude jobs | depends on SP0 |

SP2–SP5 are **out of scope** here.

## Goal

Give the user one-tap **foundational prompts** in the AI Assistant, plus a shared, context-aware
**"Ask Claude"** button in the top bar that offers **view-specific suggested prompts** and runs the
selected one in the chat — so Claude can be invoked about whatever window the user is on, then
continue on the user's instruction.

## Locked decisions (from brainstorming)

1. **"Ask Claude" interaction = prompt menu (option C).** The button opens a popover of 3–4
   context-specific suggestions for the current view; picking one opens the chat **seeded and
   auto-sent**. Free-typing in the chat remains available.
2. **Placement = one shared top-bar button** that reads the current view (`activeTab`), not a button
   embedded into every view. DRY; covers every window via a single component.
3. **Foundational prompts = add the 3 universal prompts AND make foundational chips one-tap
   auto-send.** The existing 4 chips (Update/Overdue/At-Risk/Status) stay **fill-only**.

## What already exists (do not rebuild)

- `chat-panel.tsx` — AI Assistant chat. `buildSystemPrompt(lang, snapshot, guides, groundInGuides)`
  (SP0). Empty-state chip row driven by `PROMPT_CHIPS: { labelKey, bodyKey }[]` — chips call
  `setInput(t(lang, chip.bodyKey))` (fill only, no send). `sendMessage()` reads `input` state.
- `workspace-section.tsx` — renders `ChatPanel` (panel id `panel-chat`, `hidden={activeTab!=="chat"}`),
  threads `guides` + `guidesReady`. Reads `useWorkspaceTab()` for `activeTab`.
- `workspace-tab-context.tsx` — `useWorkspaceTab()` exposes `activeTab`, `setActiveTab`, `isPopout`,
  and the deep-link trio `pendingOpen` / `requestOpen(view, id)` / `clearPendingOpen()`. **This is
  the seam** SP1 extends with a parallel chat-seed trio.
- `app-header.tsx` — top bar. Already renders an `onOpenAiAssistant` icon button (opens the AI
  Assistant popout). Receives `settings`, `lang`. **New "Ask Claude" menu mounts here.**
- `nav-config.ts` — `AppView` union; `allNavViews()`; `navLabelKey(view)`.
- `task-manager.tsx` — holds `useWorkspaceTab()` (`activeTab`, `requestOpen`, …) at line ~161;
  builds `workspaceProps` and renders `AppHeader`.
- `i18n.ts` (EN) + `i18n.de.ts` (DE) — `TranslationKey`, `t(lang, key, …)`. CRLF DE file; edit via
  node UTF-8 write (Edit tool corrupts umlauts).

## Section 1 — Pure prompt catalog

New pure module `ask-claude-prompts.ts` (i18n-free — keys only, no `t()`, no React):

```ts
import type { TranslationKey } from "./i18n";
import type { AppView } from "./nav-config";

export interface PromptDef {
  labelKey: TranslationKey;   // short chip/menu label
  bodyKey: TranslationKey;    // full prompt text sent to Claude
}

/** The 3 universal foundational prompts. Always offered (chat chips + menu "General"). */
export const FOUNDATIONAL_PROMPTS: PromptDef[] = [
  { labelKey: "aiPromptWhatsNextLabel",   bodyKey: "aiPromptWhatsNextBody" },
  { labelKey: "aiPromptStatusLabel",      bodyKey: "aiPromptStatusBody" },
  { labelKey: "aiPromptPrioritizeLabel",  bodyKey: "aiPromptPrioritizeBody" },
];

/** View-specific suggestions. A view absent from the map has no "on this page" set
 *  (the menu still shows the foundational prompts). Keys only; surface translates. */
export const ASK_CLAUDE_PROMPTS: Partial<Record<AppView, PromptDef[]>> = {
  /* dashboard, "open-points", raid, changes, milestones, stakeholders, budget,
     gantt, resources, documents, reports, actions, trends — 2–4 each */
};

/** What the menu/UI shows for a view: on-page suggestions + the always-on general set. */
export function promptsForView(view: AppView): { onPage: PromptDef[]; general: PromptDef[] } {
  return { onPage: ASK_CLAUDE_PROMPTS[view] ?? [], general: FOUNDATIONAL_PROMPTS };
}
```

- The prompts are **clean questions** (e.g. "Summarize the top risks and flag which need
  escalation."). No runtime interpolation of counts — the SP0 system prompt already injects mode /
  current view / task count, and Claude has read tools. This keeps the catalog pure (translation
  keys only) and matches the existing `PROMPT_CHIPS` shape.
- Curated `onPage` sets (illustrative, finalize during implementation; 2–4 per view):
  - `dashboard`: overall health summary; biggest risks to the timeline.
  - `open-points`: what's overdue and who's blocking; what should I chase today.
  - `raid`: summarize top risks + escalation; any issues without owners.
  - `changes`: pending changes needing a decision; impact of open changes.
  - `milestones`: milestones at risk of slipping; what's due in the next 2 weeks.
  - `stakeholders`: who needs an update; map engagement gaps.
  - `budget`: are we on track vs. budget (CPI); where is spend trending over.
  - `gantt`: critical-path risks; tasks with no slack.
  - `resources`: who is overloaded; upcoming capacity gaps.
  - `documents`: what's missing or stale; summarize the document set.
  - `reports`: draft a status report; what stands out this period.
  - `actions`: explain the top suggested actions; what should I do first.
  - `trends`: what's the schedule/budget trend telling me.

## Section 2 — Chat-seed channel (extend `WorkspaceTabContext`)

Add a parallel trio to the existing `pendingOpen` mechanism:

```ts
interface WorkspaceTabContextValue {
  // …existing…
  pendingChatSeed: { prompt: string; autoSend: boolean } | null;
  requestChat: (prompt: string, autoSend: boolean) => void;
  clearChatSeed: () => void;
}
```

- `requestChat(prompt, autoSend)` → `setActiveTab("chat")` + `setPendingChatSeed({ prompt, autoSend })`.
  (Does **not** touch the URL hash — chat carries no item id; mirrors that `requestOpen` writes a
  hash but chat has no `/id`.) No-op guard not needed; a fresh object each call is fine because the
  consumer clears it after applying.
- `clearChatSeed()` → `setPendingChatSeed(null)`.
- Provider initializes `pendingChatSeed` to `null`.

## Section 3 — Chat panel: consume seed + auto-send + foundational chips

`workspace-section.tsx`:
- Read `pendingChatSeed`, `clearChatSeed` from `useWorkspaceTab()`; thread to `ChatPanel` as
  `chatSeed` + `onChatSeedConsumed`.

`chat-panel.tsx`:
- Refactor `sendMessage()` to `submitPrompt(textArg?: string)`: uses `textArg ?? input` as the
  source text; everything else unchanged. `sendMessage` becomes `() => submitPrompt()`.
- **Seed effect:** when `chatSeed` is non-null, set `input` to `chatSeed.prompt`; if
  `chatSeed.autoSend` **and** not blocked (`!guidesPending && !apiKeyMissing && !busy`), call
  `submitPrompt(chatSeed.prompt)`; then call `onChatSeedConsumed()`. If blocked, seed the input only
  (no send) and still consume — the user sends when ready. Effect deps: `[chatSeed]` (route the
  blocked flags through a ref to satisfy `exhaustive-deps` without re-firing).
- **Foundational auto-send chips:** the empty-state chip row gains the foundational prompts as
  chips that **auto-send**. Model chips as `{ def: PromptDef; autoSend: boolean }`; render the
  existing 4 (`autoSend:false` → `setInput`) and the 3 foundational (`autoSend:true` →
  `submitPrompt(t(lang, def.bodyKey))`). Each chip keeps a row-unique accessible name (label text).
- Auto-send must respect the SP0 send-gate (`guidesPending`) and the api-key gate exactly as
  `sendMessage` already does (the `submitPrompt` early-returns cover this).

`chat-panel.tsx` is rendered memoized; `chatSeed`/`onChatSeedConsumed` must be reference-stable
enough not to thrash — `onChatSeedConsumed` is a `useCallback` from context (`clearChatSeed` is
already stable), and `chatSeed` only changes when a seed is set/cleared.

## Section 4 — "Ask Claude" menu button (top bar)

New component `ask-claude-menu.tsx`:
- Props: `{ lang: Lang; currentView: AppView; onAsk: (promptBody: string) => void }`.
- Trigger button: labelled (`aria-label`/`title` = `t(lang,"aiAskClaude")`), `aria-haspopup="menu"`,
  `aria-expanded`. AIPM-palette styling consistent with the neighboring header icon buttons.
- On open: popover (`role="menu"`) with two labelled sections — **"On this page"**
  (`promptsForView(view).onPage`, omitted when empty) and **"General"** (`.general`). Each item is a
  `role="menuitem"` button showing `t(lang, def.labelKey)`; click → `onAsk(t(lang, def.bodyKey))`
  then close.
- a11y/interaction (established popover pattern, cf. action-assign-owner): focus first item on open;
  Escape closes and returns focus to trigger; click-outside closes via a document `keydown` +
  `pointerdown`/`mousedown` listener; menu items keyboard-operable. Each menu item's accessible name
  is the (unique) prompt label.

`app-header.tsx`:
- Add optional props `currentView?: AppView` and `onAskClaude?: (promptBody: string) => void`.
- Render `<AskClaudeMenu lang currentView onAsk={onAskClaude} />` beside the existing
  `onOpenAiAssistant` button, only when both props are supplied (keeps the popout/classic header,
  which may not wire them, unaffected).

`task-manager.tsx`:
- It already holds `useWorkspaceTab()`. Pass `currentView={activeTab}` and
  `onAskClaude={(body) => requestChat(body, true)}` into `<AppHeader …>`. (Add `requestChat` to the
  destructure from `useWorkspaceTab()`.)

## Section 5 — i18n

New EN + DE keys (identical key sets — tsc-enforced; DE via node UTF-8 CRLF write, real umlauts):
- `aiAskClaude` (button label), `aiAskClaudeOnPage` (menu section), `aiAskClaudeGeneral` (menu section).
- Foundational: `aiPromptWhatsNextLabel`/`Body`, `aiPromptStatusLabel`/`Body`,
  `aiPromptPrioritizeLabel`/`Body`.
- View-specific label/body pairs for each curated entry in `ASK_CLAUDE_PROMPTS` (~26 keys).
- `versionHighlightAiAskClaude` (release highlight) — EN + DE.

Interpolation uses 0-based positional placeholders if any prompt needs them (none planned —
prompts are static).

## Section 6 — Error handling & testing

**Error handling:**
- A seed for a view with no `onPage` entry still yields a usable menu (foundational only).
- Auto-send while the api key is missing or guides are still loading must **not** throw or send —
  it seeds the input and waits (covered by `submitPrompt` early-returns + the seed-effect gate).
- An unknown/edge `AppView` (e.g. `edit`) → `promptsForView` returns `{ onPage: [], general: FOUNDATIONAL }`.

**Tests (TDD, vitest unless noted):**
- `ask-claude-prompts.test.ts` — `promptsForView` returns view-specific + foundational; unknown
  view falls back to foundational only; every `labelKey`/`bodyKey` in the catalog exists in EN and
  DE (guard against missing keys — `loadI18n("de")` in `beforeAll` for the DE side).
- `workspace-tab-context.test` — `requestChat` sets `activeTab="chat"` and the seed; `clearChatSeed`
  nulls it; `requestChat` does not write the hash.
- `chat-panel.test` — seed effect sets input; `autoSend:true` triggers a send (mock fetch);
  `autoSend:true` while api-key missing seeds input but does **not** send; `onChatSeedConsumed`
  called after applying; foundational chip auto-sends, existing chip fills only.
- `ask-claude-menu.test` — opens on click; shows on-page + general sections; picking an item calls
  `onAsk` with the translated body and closes; Escape closes; menu items have unique accessible
  names; trigger has `aria-haspopup`/`aria-expanded`.
- `app-header.test` — renders the Ask-Claude menu when `currentView`+`onAskClaude` supplied; omits
  it otherwise.
- **e2e a11y** — run `npx playwright test e2e/a11y.spec.ts --project=chromium -g "Settings"` and the
  Overview/header-bearing view locally before push (unit suite never runs Playwright). The new menu
  is an interactive control in scanned chrome — verify no axe-critical.

**Release:** bump `src/app/version.ts` (APP_VERSION → 0.98.0 + new milestone), `CHANGELOG.md` entry,
append `versionHighlightAiAskClaude` to `APP_HIGHLIGHT_KEYS` + EN/DE strings.

## Out of scope (SP1)

- Write tools for RAID/Changes/Milestones/Stakeholders; document ingestion (SP2).
- AI project-creation wizard (SP3); Action Center AI suggestions (SP4); scheduled jobs (SP5).
- Per-view embedded buttons (decided against — single shared top-bar button).
- Runtime-interpolated prompt bodies; popout-window seeding (main window only).
```