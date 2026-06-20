# AI App-Feature Guide - Design

**Date:** 2026-06-20
**Status:** Approved (design)
**Target release:** v0.116.0

> Gives the in-app AI assistant a concise, view-scoped map of the app's features so it can answer
> "how do I ...?" and guide users to capabilities, complementing the guided tour. Rides the existing
> operating-guide library (scope.views + per-guide toggle + built-in seeding + prompt-cache prefix).

## Goal

Add built-in, view-scoped "feature guides" to the operating-guide library: a short always-on overview
plus one terse guide per major view, telling the assistant what each area does, the key user actions,
and crucially whether the AI can act on it via tools. The assistant then explains/navigates features
it previously had to guess about (timezones, steering committee, Kanban, tour, Outlook push, etc.).

## Non-goals

- No new AI TOOLS / no new automation. This is knowledge only — the assistant still can only DO what
  its existing tools allow (the guides explicitly say what's not AI-actionable).
- Not derived from the in-app Help i18n strings (those are prose, i18n-keyed, and lack the
  "AI-actionable" framing) — a dedicated, terse, English-only source is clearer. (The existing
  leadership guide is already English-only; guide content is not i18n'd.)
- No change to `selectActiveGuides` scoping, the guide schema, or the guide-library UI — they already
  support `scope.views`, multiple guides, per-guide toggle, and built-in/undeletable.

## Decisions (locked during brainstorming)

1. **View-scoped** (not one always-on blob): an always-on overview guide + per-view guides scoped via
   `scope.views`, so only the current view's detail loads into the prompt.
2. **Single curated source md** parsed into multiple guides (not one file per view).
3. **Default ON** via the existing `ai.groundInGuides` master; each feature guide is individually
   toggleable in the guide library (built-in, undeletable, like the leadership guide).

## Architecture

### A. Source: `lib/app-feature-guide.md`
A structured markdown, English, terse:
- A leading `## Overview` section (no scope marker -> always-on): 1 line per app area naming what
  exists + that the assistant can elaborate per view.
- One `## <Title>` section per major view, each immediately preceded/followed by a scope marker
  comment: `<!-- views: open-points -->` (comma-separated AppView ids). Each section = 3-6 bullets:
  what the view/feature is - key user actions - **AI: <what the assistant can/can't do via tools>**.
- Covered views (map to real `AppView` ids; only include views worth guiding): open-points (tasks +
  Table/Board Kanban + status), actions (Action Center incl. AI analysis), chat, dashboard, trends,
  reports, raid, changes, milestones/gantt, stakeholders, steering-committee, calendar (timezone
  strip), settings (timezone/AI config/scheduled jobs). The Overview also notes guided tour + project
  create/import + comm templates briefly.

### B. Generator (extend `scripts/gen-operating-guide.mjs`)
- Keep emitting the leadership constants (`BUILTIN_GUIDE_ID/NAME/CONTENT`) unchanged.
- ALSO read `lib/app-feature-guide.md`, parse it into an ordered array of guide seeds:
  - `{ id: "builtin-app-overview", name: "App overview", content: <Overview section>, scope: {} }`
  - per view section: `{ id: "builtin-feature-<firstView>", name: "Feature: <Title>", content: <section>, scope: { views: [<ids from the marker>] } }`
- Emit `export const BUILTIN_FEATURE_GUIDES: { id: string; name: string; content: string; scope: { views?: string[] } }[] = [...]` into the SAME generated file (`operating-guide-builtin.generated.ts`). The parse is deterministic (stable id/order) so the committed output is reproducible.
- The prebuild already runs `gen-operating-guide.mjs`; no package.json change needed.

### C. Seeding (`use-operating-guides.ts`)
- The seed step currently upserts the single leadership guide. Extend it to ALSO upsert every entry in
  `BUILTIN_FEATURE_GUIDES` (same upsert path; `enabled:true`, a sensible `priority` below the
  leadership guide, `scope` from the seed, `builtIn:true`). All built-ins remain undeletable (the
  existing `id === BUILTIN_GUIDE_ID` guard generalises to "any built-in id" — guard on `builtIn` or an
  id set so the feature guides are also undeletable; they stay toggleable).
- `selectActiveGuides` already returns the overview (scope {}) + the current view's guide; no change.

### D. Prompt cache
Feature guides are stable text in the cached prefix. Switching views swaps the active per-view guide,
re-caching that slice; the overview + leadership guide stay constant, so most of the prefix stays
cached. Acceptable (view changes are infrequent). The volatile per-call state stays after the
breakpoint as today.

## Error handling
- Generator: if a section lacks a valid scope marker -> treat as always-on overview-tier OR fail the
  build with a clear message (prefer FAIL so a malformed source is caught at prebuild). Unknown view
  ids in a marker -> fail the build (catch typos against the AppView list).
- Seeding: idempotent upsert (re-seed on each load overwrites built-in content with the shipped
  version — same as the leadership guide today, so edits to the source propagate on next load).

## Testing (TDD)
- Generator parse: a fixture md -> expected guide array (ids, names, scopes, content boundaries);
  a malformed source (bad/missing view id) -> generator throws.
- Sync-guard (extend `operating-guide-builtin.test.ts`): regenerate in-memory and assert the committed
  `operating-guide-builtin.generated.ts` matches (wired via prebuild) — now also covers
  `BUILTIN_FEATURE_GUIDES`.
- `selectActiveGuides`: with a feature guide scoped to view X, it's included for view X and excluded
  for view Y; the overview is always included.
- Seeding: all built-in feature guides upserted + undeletable + toggleable; count matches
  `BUILTIN_FEATURE_GUIDES.length + 1` (leadership).
- A system-prompt assembly check: for a given snapshot view, the assembled guide block contains the
  overview + that view's feature text (optional, light).
- `npx tsc --noEmit`; `npm run lint`; `npm run build` (prebuild gen + sync-guard).

## i18n / release
- Guide content is English-only (no EN/DE keys — matches the leadership guide). No i18n parity work.
- Bump `version.ts` (0.116.0 + codename), add `versionHighlightAiFeatureGuide` (EN+DE) +
  `APP_HIGHLIGHT_KEYS`, `CHANGELOG.md` entry. (versionHighlight strings ARE i18n'd — EN+DE + em-dash
  separators per the harmonized corpus.)

## File map
- `lib/app-feature-guide.md` (NEW source).
- `scripts/gen-operating-guide.mjs` (extend: parse the feature md -> `BUILTIN_FEATURE_GUIDES`).
- `src/app/operating-guide-builtin.generated.ts` (regenerated: + the feature-guide array).
- `src/app/use-operating-guides.ts` (seed loop over the feature guides; generalise the undeletable guard).
- `src/app/operating-guide-builtin.test.ts` (+ new generator/parse/select/seed tests).
- `i18n.ts` / `i18n.de.ts`, `version.ts`, `CHANGELOG.md`.
