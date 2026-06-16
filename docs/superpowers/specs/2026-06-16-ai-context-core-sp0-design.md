# SP0 — Context-aware Claude Core — Design Spec

**Date:** 2026-06-16
**Status:** Approved (brainstorming complete)
**Part of:** the "AI orchestration" roadmap (6 sub-projects). This is **SP0**, the foundation every later slice depends on.

## Roadmap context

The user wants Claude fully able to understand and orchestrate the app, grounded in a directive
operating guide, mode-aware (simple/advanced + enabled modules), acting as a senior project &
program manager. That vision decomposes into 6 sub-projects:

| # | Sub-project | Depends on |
|---|---|---|
| **SP0** | **Context-aware Claude core** (this spec) | — |
| SP1 | Foundational prompts + per-window "Ask Claude" buttons | SP0 |
| SP2 | Write-tool expansion (RAID/Changes/Milestones/Stakeholders) + document ingestion → CRUD | SP0 |
| SP3 | AI project-creation wizard ("Use AI") | SP2 |
| SP4 | Action Center AI suggestions (alongside untouched rule engine) | SP0 |
| SP5 | Scheduled Claude jobs | SP0 |

SP1–SP5 are **out of scope** here; this spec builds only SP0.

## Goal

Ground the existing AI Assistant in user-managed **operating guides** and make every Claude call
**context-aware** of the app's mode, enabled modules, and current view — so Claude adapts its
behavior and advises as a senior project/program manager.

## What already exists (do not rebuild)

- `chat-panel.tsx` + `use-chat-dispatcher.ts` — working AI Assistant chat, tool-use loop, Anthropic call.
- `chat-tools.ts` — 13 tools incl. full **task** CRUD + read-only `list_raid`/`list_changes`/`list_milestones` + `get_app_state`.
- `settings-sections/ai-section.tsx` — API key, model, consent, usage caps.
- `ai-usage.ts` — usage tracking/caps.
- `lib/project-leadership-operating-guide.md` — 391-line directive guide, **currently unused** (zero code refs).
- Mode/module data in Settings: `AppMode = "simple" | "modular" | "advanced"`, `expertMode`,
  `features: FeatureModuleId[]`; `FEATURE_MODULES` (with `views`), `ALL_MODULE_IDS`, `CORE_VIEWS`.
- The system prompt is assembled in `buildSystemPrompt(lang, snapshot)` (chat-panel.tsx:55) — a
  joined string array. **This is the extension seam.**

## Locked decisions (from brainstorming)

1. **Delivery model: in-app managed docs (option C)** with **scope tags** and **per-file toggle**.
   The shipped `/lib` guide remains the *source of the seeded default*; users' own guides live in
   the in-app store. `/lib` is kept as the literal default location.
2. **Storage: global / cross-project** — localStorage always; optional global Turso table
   `operating_guides` kept **OUT of `TABLE_NAMES`**; Turso-gated on `tursoConfig !== null`. Mirrors
   the `comm_templates` / `action_learning` precedent. **No new `Workspace` field** (avoids the
   six-write-path burden).
3. **Weighting = priority order + explicit conflict rule** (LLM precedence is soft) + scope tags.
   Scope tags are the preferred form of weighting (conditional injection > stacking globals).
4. **Markdown editor: plain `<textarea>`** (autogrow), not Tiptap — guides are plain MD.
5. **Master toggle** `ai.groundInGuides` (default ON) gates the whole guide block; per-file toggles
   gate individual docs.

## Section 1 — Data model & storage

New pure module `operating-guide.ts` (i18n-free):

```ts
interface OperatingGuide {
  id: string;
  name: string;
  content: string;          // markdown
  enabled: boolean;         // per-file read/don't-read toggle
  priority: number;         // weighting: lower = higher precedence, injected first
  scope: GuideScope;        // gate when it's injected
  builtIn: boolean;         // seeded default — editable + toggleable, NOT deletable
}
interface GuideScope {       // every dimension optional; all-empty = always-on
  modes?: AppMode[];         // "simple" | "modular" | "advanced"
  modules?: FeatureModuleId[];
  views?: AppView[];         // future-proofs SP1's Ask-Claude buttons
}
```

Pure functions (no React, no i18n):
- `selectActiveGuides(guides, ctx: { mode, modules, view }): OperatingGuide[]`
  — keep `enabled` AND scope-matching guides; sort ascending by `priority` (then stable by id).
  Scope match: a dimension matches if its array is absent/empty (wildcard) OR includes the current value.
- `assembleGuideBlock(active): string` — precedence header + `=== GUIDE n (priority p) — "name" ===`
  delimited concatenation. Returns `""` when `active` is empty.
- `guidesCharCount(active): number` — for the soft budget warning.

Storage:
- `useOperatingGuides()` hook — Turso-gated (`tursoConfig !== null`), localStorage fallback,
  mirroring `useCommTemplates`. CRUD: list / create / update / delete (delete refused for `builtIn`).
- Global Turso table `operating_guides` — **OUT of `TABLE_NAMES`** (guard test enforces it).
  `SqlArg.value` is string-only even for ints (`String(priority)`); `scope` serialized as JSON in a cell.

## Section 2 — System-prompt assembly

Extend `buildSystemPrompt` with two injected sections. The dispatcher snapshot gains
`mode`, `enabledModules: string[]`, `currentView: AppView`.

**2a. App-context block (always injected, mechanical):**
```
APP CONTEXT — adapt your behavior to this.
Mode: <mode>. Enabled modules: <comma list>.
Current view: <view>.
In simple mode keep actions minimal and never reference disabled modules.
You are acting as a senior project & program manager.
```

**2b. Operating-guide block (only when `ai.groundInGuides` ON):**
- `selectActiveGuides(guides, ctx)` → `assembleGuideBlock(...)`.
- Omitted entirely when the master toggle is OFF or no guide is enabled/in-scope.
- Precedence header (verbatim intent):
  ```
  You have N operating guides, in priority order. On conflict the earlier one wins;
  later guides refine but don't override unless they say so explicitly.
  ```
- **Prompt caching:** put the (large, stable) guide block in the `system` array with
  `cache_control: { type: "ephemeral" }` so it is near-free after the first call. The volatile
  app-context block stays uncached. (Requires switching `system` from a bare string to the
  content-block array form in `callClaude`.)
- **Soft char-budget guard:** if `guidesCharCount(active)` exceeds a named cap constant
  (`GUIDE_CHAR_BUDGET`, default `40_000` chars ≈ ~10k tokens; the seeded guide alone is ~18k chars),
  surface a Settings warning. Never truncate silently.

## Section 3 — Settings UI (AI section)

Append to `settings-sections/ai-section.tsx`, below caps:
- **Descriptive text** (explicit ask): short paragraph explaining guides steer Claude's behavior,
  can be scoped, ordered by priority, and are read when grounding is on.
- **Master toggle** "Ground Claude in operating guides" (`ai.groundInGuides`, default ON).
- **Guide list** — per row: name, enabled switch (per-file toggle), priority (number / reorder),
  scope summary chips, Edit / Delete (Delete hidden when `builtIn`). Add-guide button.
- **Guide editor** — name input, markdown `<textarea>` (autogrow), scope editor (mode/module/view
  multi-selects; empty = always-on), priority. Plain MD, no Tiptap.
- **Char-budget warning** — inline notice when enabled in-scope guides exceed the cap.
- **a11y:** every switch/select needs `aria-label`/`<label>` (a `<span>` label does NOT satisfy axe).
  Verify with `npx playwright test e2e/a11y.spec.ts --project=chromium -g "Settings"` before push.
- **i18n:** new EN+DE keys, identical key sets (tsc-enforced), real umlauts via node UTF-8 CRLF write.

## Section 4 — Seeding & migration

- A small **prebuild step** reads `lib/project-leadership-operating-guide.md` into a generated TS
  constant (matches the repo's existing "prebuild checks script-docs in sync" convention).
- On first load, seed it as the `builtIn` guide: `priority: 1`, `enabled: true`, `scope: {}`
  (always-on), `builtIn: true`. The built-in id is reserved.
- **Idempotent seed:** if a guide with the built-in id already exists, do not duplicate — user
  edits/toggles to the built-in persist.
- Turso: `operating_guides` created on demand (Turso-gated). No `turso-migrate.ts` change (new
  table, not a new column on an existing entity).

## Section 5 — Error handling & testing

**Error handling:**
- Malformed / oversized guide must never break chat — pure functions are defensive; a bad guide is
  skipped, not fatal.
- Store unreachable (Turso down) → fall back to localStorage → fall back to "no guides" (chat still
  works, ungrounded). Surface store errors via the existing storage-error channel, not a chat crash.

**Tests (TDD, vitest unless noted):**
- `operating-guide.test.ts` — scope matching (each dimension + empty = always-on), priority order,
  enabled filtering, conflict-header assembly, `guidesCharCount`.
- `buildSystemPrompt` — app-context block reflects mode/modules/view; guide block present only when
  toggle ON + guides in scope; absent when OFF.
- hook test — Turso-gated vs localStorage fallback (mirror `useCommTemplates` test).
- settings-section test — master toggle, add/edit/delete, `builtIn` not deletable, a11y labels.
- **e2e a11y** — AI settings view; run the Settings axe grep locally before push (unit suite never
  runs Playwright).

**Release:** bump `src/app/version.ts` (APP_VERSION + milestone), `CHANGELOG.md` entry, new
`versionHighlight*` key appended to `APP_HIGHLIGHT_KEYS` + EN/DE strings.

## Out of scope (SP0)

- Per-window "Ask Claude" buttons and foundational prompt chips (SP1).
- Write tools for RAID/Changes/Milestones/Stakeholders; document ingestion (SP2).
- AI project-creation wizard (SP3); Action Center AI suggestions (SP4); scheduled jobs (SP5).
- Per-project guides; rich-text guide editing; multi-user guide sharing.
