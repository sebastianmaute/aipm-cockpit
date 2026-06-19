# AI orchestration SP3 — AI project-creation fast-path ("Use AI")

**Date:** 2026-06-19
**Target release:** v0.103.0 "Watts" (Peter Watts)
**Part of:** the "AI orchestration" roadmap (6 sub-projects). This is **SP3**; it builds on
**SP0** (context-aware Claude core, v0.97.0), **SP1** (one-tap prompts + Ask-Claude menu, v0.98.0),
and **SP2** (AI write tools + doc ingestion, v0.102.0).

## Roadmap context

| # | Sub-project | Status |
|---|---|---|
| SP0 | Context-aware Claude core | done (v0.97.0) |
| SP1 | One-tap prompts / Ask-Claude menu | done (v0.98.0) |
| SP2 | AI write tools + doc ingestion | done (v0.102.0) |
| **SP3** | **AI project-creation wizard ("Use AI")** | **this spec** |
| SP4 | Action Center AI suggestions | depends on SP0 |
| SP5 | Scheduled Claude jobs | depends on SP0 |

SP4–SP5 are **out of scope** here.

## Goal

Let a user create a new project by describing it in plain language. Claude turns the description
into a single structured **proposal** (project metadata + feature modules + optional starter
content), which **pre-fills the existing 3-step `CreateProjectWizard`** for review/edit before the
project is created. The AI path is a fast-path; the manual wizard remains unchanged and fully usable.

## Decisions locked in brainstorming

1. **Output:** fields **+ starter content**, with a user **opt-out** of starter content (reuses the
   existing `includeSeed` toggle).
2. **Mechanism:** **one structured-output Anthropic call** (forced single tool), not an agentic loop
   and not a conversational clarification flow.
3. **Entry/flow:** an optional **Step 0 "Describe"** at the top of the existing `CreateProjectWizard`;
   the proposal pre-fills the existing Details / Template / Features steps; user walks the same steps
   to review/edit/create. Reuses all wizard review + create plumbing.
4. **Templates:** the **AI proposal is the bespoke template** — template defaults to **Blank**, Claude
   proposes feature modules + seed directly. Choosing a *stored* template in Step 2 **replaces** the
   AI seed, and this MUST be made transparent to the user with an inline notice.

## Architecture

### Data flow

```
description (free text)
  ─► useProjectProposal()            // 1 forced-tool Anthropic call, no loop
  ─► ProjectProposal (validated)     // tool_use.input, narrowed/sanitized
  ─► wizard state { meta, features, aiSeed, includeSeed=true }   // template stays Blank
  ─► user reviews/edits Steps 1–3
  ─► handleCreate
  ─► NewProjectOpts { template: undefined(Blank), features, includeSeed, aiSeed }
  ─► buildNewProjectWorkspace
  ─► emptyWorkspace + appendSeed(remapSeed(aiSeed))   // when Blank + includeSeed + aiSeed
  ─► persisted via the existing backend (no new write path)
```

**No new persisted `Workspace` field.** The seed produces ordinary entities through the existing
`remapSeed` append path, so there is **no schema change and no six-write-path work**.

### New units

#### `ai-project-proposal.ts` (pure, i18n-free)

The contract + transforms. No React, no `fetch`, no i18n.

- `ProjectProposal` type:
  ```ts
  interface ProposalSeed {
    raid?: RawSeedRaid[];          // risks/assumptions/issues/dependencies
    changes?: RawSeedChange[];
    milestones?: RawSeedMilestone[];
    stakeholders?: RawSeedStakeholder[];
    tasks?: RawSeedTask[];         // opening tasks
  }
  interface ProjectProposal {
    meta: { name: string; startDate?: string; endDate?: string; products?: string; jiraUrl?: string };
    features: FeatureModuleId[];
    seed?: ProposalSeed;
  }
  ```
  The `RawSeed*` shapes are the *unvalidated* fields Claude returns (no ids, no FKs) — deliberately
  loose; validation happens in `proposalToNewProjectOpts`.

- `PROPOSAL_TOOL` — the Anthropic tool definition (`name: "propose_project"`, `input_schema`
  describing the proposal shape). Invoked with forced `tool_choice: { type: "tool", name:
  "propose_project" }` so the model is guaranteed to emit one structured `tool_use` block — no
  JSON-from-free-text parsing.

- `parseProposal(toolInput: unknown): ProjectProposal | null` — narrow the raw `tool_use.input`
  into a `ProjectProposal`. Drops unknown feature ids (must be in `ALL_MODULE_IDS`); requires a
  non-empty `meta.name`; returns `null` when the input is unusable.

- `proposalToNewProjectOpts(proposal, { includeSeed }): { meta: ProjectMeta; features:
  FeatureModuleId[]; aiSeed?: TemplateSeed }`:
  - Build `ProjectMeta` from `proposal.meta` (trim/validate dates via the same date guards the
    manual form uses).
  - For each seed list: assign sequential temp ids (1, 2, …), run every record through its
    **`sanitizeX` validator** (`sanitizeRaidItem` / `sanitizeChangeItem` / `sanitizeMilestone` /
    `sanitizeStakeholder` / task sanitizers), **drop records that fail**, and **cap each list**
    (constant `SEED_CAP_PER_ENTITY = 8`). Person FKs/owner fields are left null/undefined — they get
    cleared by `remapSeed` anyway (no resources are seeded).
  - Wrap the validated records into a `TemplateSeed` returned as `aiSeed`. When `includeSeed` is
    false, omit `aiSeed`.

This module is unit-testable in isolation (caps, sanitize-drop, blank-name rejection, unknown-feature
drop, `PROPOSAL_TOOL` schema shape).

#### `use-project-proposal.ts` (hook)

The one-shot Anthropic call. Mirrors `chat-panel.tsx`'s `callClaude` but:
- single request, **no tool loop**;
- `tools: [PROPOSAL_TOOL]`, `tool_choice: { type: "tool", name: "propose_project" }`;
- a focused system prompt from `buildProposalSystemPrompt()` (see below);
- the user message is the raw description text.

Returns `{ generate(description): Promise<void>, proposal, busy, error, reset() }`. On success it
`parseProposal(toolUse.input)` and exposes the result; on HTTP/parse failure it sets `error`.
Reuses the **live in-memory `apiKey`** (secrets-at-rest; never logged) and the
`anthropic-dangerous-direct-browser-access` header. CSP already allows `api.anthropic.com`.

`buildProposalSystemPrompt()` lives here (or in the pure module if i18n-free): a "senior PM"
instruction that lists the available feature modules (`ALL_MODULE_IDS` + human labels), the RAID
categories/statuses/severities, and the per-entity seed caps, instructing Claude to call
`propose_project` exactly once. It does **not** use SP0 operating-guide grounding (no active
mode/module/view exists at creation time — see Out of scope).

#### `appendSeed` refactor in `template-apply.ts`

Extract the seed-append block from `applyTemplate` into a reusable pure helper:

```ts
export function appendSeed(ws: Workspace, seed: TemplateSeed): Workspace { /* the [...ws.x, ...seed.x] block */ }
```

`applyTemplate` calls `appendSeed(base, remapSeed(ws, tpl.seed))`. This is a targeted improvement so
the AI-seed path reuses identical append/remap logic instead of duplicating it.

### Wiring changes

- **`new-project-workspace.ts`** — `NewProjectOpts` gains `aiSeed?: TemplateSeed`.
  `buildNewProjectWorkspace`: after the existing template branch, if **no template** is chosen and
  `opts.includeSeed && opts.aiSeed`, apply `appendSeed(ws, remapSeed(ws, opts.aiSeed))`.
  When a stored template *is* chosen, the template branch runs and `aiSeed` is ignored — this
  enforces the "stored template replaces AI seed" rule structurally.

- **`create-project-wizard.tsx`** — new optional **Step 0 "Describe"**:
  - A labelled `<textarea>` ("Describe your project in plain language") + a **"Generate with AI"**
    button + a **"Skip — set up manually"** link.
  - On generate success: set `meta`, `features`, `includeSeed = true`, keep `selectedTemplate =
    null` (Blank), store the validated seed in new `aiSeed` wizard state, and advance to Step 1
    (Details), pre-filled and editable.
  - **Gating:** Step 0 renders only when an Anthropic API key is configured. With no key, the wizard
    opens at Step 1 exactly as today (optionally a small "add an API key in Settings to use AI"
    hint). The "Generate" button is disabled while the description is empty or a call is in flight.
  - **Transparency (Step 2):** when `aiSeed` is present and the user selects a *stored* template, show
    an inline notice — "Choosing a template replaces the AI-generated starter content." Returning to
    Blank restores the AI seed (it stays in state; selection just gates which seed the create path
    uses).
  - **Step 3:** the `includeSeed` checkbox, when Blank + `aiSeed` present, is relabelled to govern
    the AI starter content ("Include AI-generated starter content"). When a stored template is
    selected it governs the template seed as today.
  - `handleCreate` passes `aiSeed` into `NewProjectOpts` (only meaningful when template is Blank).

### Error handling

- **No API key:** Step 0 hidden/disabled with a notice; manual wizard unaffected.
- **Call fails** (network / quota / invalid key / CSP): inline error shown in Step 0; user can retry
  or skip to manual. The error message must not echo the API key.
- **Malformed proposal:** `parseProposal` returns `null` → inline "couldn't generate a proposal,
  try rephrasing or set up manually" error; no partial state is applied.
- **Missing `meta.name`:** treated as malformed (rejected) — name is required by the manual form too.
- **Seed records failing `sanitizeX`:** silently dropped; never block creation. A proposal with zero
  valid seed records still creates the project (fields only).
- **Empty description:** Generate disabled.

### Security

- Reuses the live in-memory decrypted `apiKey`; the key is never written to logs, errors, or the
  proposal. No new secret, no new persisted field, no export/Turso/recovery surface touched.
- No new host → no CSP edit (`api.anthropic.com` already allowlisted in `src/proxy.ts`).
- The proposal is untrusted model output: every seed record passes through the single per-entity
  `sanitizeX` validator (enums/dates/caps), and `remapSeed` clears all person FKs. Unknown feature
  ids are dropped against `ALL_MODULE_IDS`. Free-text fields are stored as ordinary entity fields
  (already sanitized) and rendered through the app's existing escaping — no new injection surface.

## Testing

- **`ai-project-proposal.ts`** (pure, TDD): per-entity caps; sanitize-drop of invalid records;
  blank-name rejection; unknown-feature-id drop; `includeSeed=false` omits `aiSeed`; `PROPOSAL_TOOL`
  schema shape (required `name`, feature enum).
- **`use-project-proposal.ts`**: mocked `fetch` — forced-tool happy path parses the `tool_use.input`;
  HTTP error sets `error`; missing-key guard; abort/reset.
- **`create-project-wizard.test.tsx`**: Step 0 visible only with a key; Generate populates Details +
  Features and advances; Skip goes straight to manual; selecting a stored template shows the
  replace-seed notice; create with Blank+aiSeed appends seed, create with a template ignores aiSeed.
- **`new-project-workspace.test.ts`**: `aiSeed` appended only when Blank + includeSeed; ignored when a
  template is present; ids remapped (no collision with base).
- **`template-apply.test.ts`**: `appendSeed` refactor leaves `applyTemplate` behavior byte-identical.
- **a11y:** verify the new textarea + buttons have accessible names by eye (the create wizard is not a
  guaranteed axe `A11Y_VIEWS` surface). Add `aria-label`/`<label>` as needed; per-control unique names.
- **Gates:** `tsc --noEmit` (i18n EN/DE parity), `eslint --max-warnings=0`, `next build`, `vitest`.

## Release checklist

- Bump `src/app/version.ts` → `APP_VERSION = "0.103.0"`, `APP_MILESTONE = "Watts"`, `APP_BUILD_DATE`.
- Append `versionHighlightAiCreateWizard` to `APP_HIGHLIGHT_KEYS` + EN/DE strings.
- New i18n keys (EN + DE): step title, describe label/placeholder, generate button, skip link, busy,
  error, needs-key hint, template-replaces-seed notice, AI include-seed label. DE via **node utf8
  write** (real umlauts; CRLF; `t()` 0-based `{0}` placeholders).
- `CHANGELOG.md` → new `## [0.103.0] - <date> "Watts"` entry.

## Out of scope (YAGNI)

- **Conversational clarification** (Claude asks follow-ups before proposing) — chosen against; the
  one-shot proposal lands in the editable wizard, which absorbs wrong guesses. Possible SP3.1.
- **Agentic tool loop for creation** — breaks the review-then-create gate and the starter-content
  opt-out; the SP2 loop stays for the chat surface.
- **Operating-guide grounding in the proposal prompt** — guides are scoped by mode/module/view, none
  of which exist at creation time; low payoff for a one-shot call. The focused PM prompt carries the
  module catalog + RAID enums it needs.
- **Regenerate-with-feedback** ("make it more X") — substitute: edit the description and Generate
  again (re-runs the one call, replaces wizard state).
- **Per-record seed editing before create** — the proposed records are ordinary entities, editable
  with the existing per-entity editors after creation; the opt-out toggle covers "none at all".
- **Token-cap accounting** — wire the proposal call into the existing usage metering *only if* it's a
  couple of lines; otherwise defer (a single create-time call is low-volume vs ongoing chat).
