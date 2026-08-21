# Help Expansion SP1 — Content Backbone + Help-view Concept Content

**Date:** 2026-06-28
**Part of:** the 4-part "expand Help for PM novices" roadmap (SP1 backbone+Help-view · SP2 contextual per-view callouts · SP3 interactive relations map · SP4 themed guided tours). SP1 is the shared foundation SP2/SP3 read.

## Goal

Teach project-management *concepts* (what/why), *workflows* (end-to-end), and *what the app does automatically* — layered with the existing feature reference — inside the Help view, for users new to PM. EN + DE.

## Audience / success

Two layers, cross-linked: a **concept layer** (plain-language "what is a milestone / RAID / EVM / stakeholder, and why it matters") and a **mechanics layer** (the existing feature reference: where/how in this app). Success: a PM-novice can open Help, learn what an entity is + why it matters + how it connects, without external PM training.

## Architecture

### Content backbone — `help-content.ts`

A typed, structured module (replaces/extends `help-sections.ts`):

```ts
import type { TranslationKey } from "./i18n";
import type { AppView } from "./nav-config";

export type HelpGroup = "concepts" | "workflows" | "features" | "automated";

export interface HelpEntry {
  id: string;                        // stable, unique (e.g. "concept-milestone")
  group: HelpGroup;
  titleKey: TranslationKey;
  bodyKey: TranslationKey;
  relatedViews?: readonly AppView[]; // views this concept maps to
  relatedConcepts?: readonly string[]; // other HelpEntry ids
}

export const HELP_ENTRIES: readonly HelpEntry[] = [ /* all entries, grouped */ ];

// Order in which groups render (TOC + content):
export const HELP_GROUP_ORDER: readonly HelpGroup[] = ["concepts", "workflows", "features", "automated"];

// Group display-label i18n keys:
export const HELP_GROUP_LABEL: Record<HelpGroup, TranslationKey> = { ... };

// Back-compat: the existing feature list, derived for the floating panel.
export const HELP_SECTIONS = HELP_ENTRIES.filter((e) => e.group === "features");
```

- The existing 28 feature sections become `group: "features"` entries (each gains a stable `id`).
- `relatedViews`/`relatedConcepts` are populated now (rendered in SP1; the visual map in SP3 consumes them).
- `relatedConcepts` ids MUST resolve to a real `HELP_ENTRIES` id; `relatedViews` MUST be valid `AppView`s — guarded by a unit test.

### Surfaces

- **Help view (`help-view.tsx`)** — renders ALL groups. The left TOC gains group headers (`HELP_GROUP_LABEL` per `HELP_GROUP_ORDER`) with that group's entries beneath; content is rendered grouped the same way. The existing search (`matchesQuery`) spans all entries; a group with zero matches is hidden (header + list). Each entry keeps its `id` as the scroll anchor (`help-sec-<id>`).
  - Each **concept** entry renders a "Related:" line after its body: `relatedConcepts` as in-page links (scroll to that entry via the existing `scrollToSection`) + `relatedViews` as plain view-name text (`t(lang, navLabelKey(v))`). (No cross-view navigation in SP1 — keeps the Help view self-contained; SP3/links can add it later.)
- **Floating top-bar Help panel (`help-menu.tsx`)** — UNCHANGED behaviour: it imports `HELP_SECTIONS` (now the features-group slice). Adding fields to entries is non-breaking (it reads `titleKey`/`bodyKey`).

### i18n

- New keys per entry: `helpConcept<Name>Title`/`Body`, `helpWorkflow<Name>Title`/`Body`, `helpAutomated<Name>Title`/`Body`, plus 4 `helpGroup<Group>` labels. EN in `i18n.ts` (Edit), DE in `i18n.de.ts` (node utf8 write, CRLF, `\u` umlauts) — tsc enforces EN/DE parity.
- Bodies are multi-sentence plain-language; concept bodies follow a "**What:** … **Why it matters:** … **In this app:** …" shape (rendered as `whitespace-pre-line`).

### Initial content scope

- **Concepts (~10):** milestone · RAID (risk/assumption/issue/dependency) · change control · stakeholder + RACI · budget & earned value (SPI/CPI) · resource & capacity · steering committee · task status · baseline & trends · dependency.
- **Workflows (~6):** track a project end-to-end · plan with milestones & Gantt · manage risk with RAID · control scope with changes · track budget & earned value · engage stakeholders.
- **What's automated (1–2):** overdue/due-soon detection · ranked next actions · RAG + EVM computation · `completedDate` auto-management · reminders · snapshot trends.

## Testing

- `help-content.test.ts`: unique ids; every `relatedConcepts` id resolves to a real entry; every `relatedViews` is a valid `AppView`; every entry's `titleKey`/`bodyKey` exist in the EN dict; `HELP_SECTIONS` derivation = features group.
- `help-view.test.tsx`: group headers render under each non-empty group; a search term hides non-matching groups; a concept's "Related:" links render and resolve.
- tsc enforces EN/DE parity (and `TranslationKey` validity of every key).

## Out of scope (later SPs)

- Contextual per-view callouts (SP2), the interactive relations map (SP3), themed guided tours (SP4). SP1 only populates the `relatedViews`/`relatedConcepts` data they will read.
- Cross-view navigation from Help (kept self-contained in SP1).
- Translating the existing English-only `tips.ts` / `app-feature-guide.md`.
