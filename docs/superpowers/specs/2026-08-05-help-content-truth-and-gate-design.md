# Help content: truth pass + structural gate (slice 1)

**Status:** design approved, not yet planned
**Date:** 2026-08-05
**Slice:** 1 of 3

## Goal

Verify all 51 existing Help entries against the code they describe, correct the
false ones in EN and DE, and land a gate that blocks the two classes of rot a
machine can actually detect.

## Scope

**In:** audit + correction of the existing 51 entries; the `[[label]]` marker
convention and its parser; the structural-coverage ratchet; the marker
resolution gate.

**Out — these are slices 2 and 3, specced separately:**

- **Slice 2 — surface split + reading level.** The floating panel currently
  renders features-only (31 of 51 entries); concepts, workflows and "what's
  automated" are invisible unless the user finds the in-pane Help view. Plus a
  reading-level `SegmentedControl` in Settings → Appearance driving concept
  primers (approach "B + C": additive primers on the 12 concept entries, and
  `HELP_GROUP_ORDER` varying by depth). Approved in principle; a **separate
  settings field**, not an overload of `showViewHints`.
- **Slice 3 — coverage.** ~18 new entries for features that have none today.

No release, version bump, push or MR is part of this slice. Those need their
own explicit go-ahead.

## Why

Two entries are actively false today, found in a five-minute look:

- **`helpSecTourBody`** — *"click 'Take the tour' at the bottom of this Help
  menu."* That button was removed; the floating panel's footer is a license
  link now, and tours live in the in-pane **Guided tours** tab. The same body
  calls it "a short guided walkthrough" when there are six themed tours.
- **`helpSecAiBody`** — *"The key is stored in this browser's localStorage."*
  The Anthropic key is AES-256-GCM encrypted in IndexedDB under a
  non-extractable device key, and `writeSettings` blanks it from localStorage.
  Wrong, and it understates the protection on a claim a user may act on.

Two found without looking systematically implies more. Entry bodies are plain
prose in `i18n.ts` / `i18n.de.ts` — the same ungated-prose decay this repo has
been bitten by repeatedly.

Measured coverage gaps. The denominator is **`allNavViews()`** (`nav-config.ts`)
— every sidebar view including nested `children` — which is **33**. Of those,
19 are covered and **14 are not**:

`projects` · `portfolio-health` · `insights` · `directory` · `calendar` ·
`manage-roles` · `stakeholder-map` · `timelog` · `reports` · `raid-report` ·
`change-report` · `activity` · `history` · `help`

Entry counts by group: concepts 12, workflows 6, features 31, automated 2.

★★ An earlier revision of this spec said "7 of 20". That was wrong in both
numerator and denominator: the walk read `item.view` and skipped
`item.children`, so half the sidebar was invisible to it. `nav-config.ts:137`
already flattens correctly via `allNavViews()` — use it, never a hand-rolled
walk. The wrong figure would have seeded the ratchet baseline at half its
true size, silently blessing seven real gaps.

★ `AppView` has **34** members; the 34th is `learning-insights`, which is not
in the sidebar at all. The gate's denominator is nav views, so it is out of
scope by construction — recorded here so a later reader does not "fix" the
off-by-one by adding it.

## Design

### 1. Audit method

51 entries is past reliable eyeballing, and this repo's history is that
correction rounds introduce fresh falsehoods.

- Partition entries by `HelpGroup` and dispatch **read-only** reviewers in
  parallel. Each verifies every control, setting, path and behaviour a body
  names against `src`, and returns a per-entry verdict with evidence.
- The controller applies every edit **serially**. Both i18n files are single
  files; parallel writes collide.
- One reviewer runs **cold** — no prior-findings list. Primed reviewers have
  repeatedly missed what a cold read catches at once.
- `i18n.de.ts` is edited via a node UTF-8 write, never the Edit tool, and
  verified afterwards at codepoint level (real umlauts, CRLF intact, no ASCII
  substitutions). Same for any EN edit that shares a line.

### 2. The `[[label]]` marker convention

A body that names a UI control writes it as `[[Take the tour]]` rather than in
bare quotes. The marker content must match an existing i18n **value** in the
same language — so DE bodies carry `[[Tour starten]]`, not the EN string.

★ Markers are for **UI labels only** — text the user can read off a control.
Ordinary quoted prose stays in quotes: `helpSecAiBody`'s “what I am looking
at” is a phrase, not a button, and marking it would fail the gate for being
true. The audit decides this per quote; when it is genuinely unclear whether a
quoted string is a label, leave it quoted, because a false marker turns a
correct sentence into a build failure.

Rationale: a marker turns a human reading into a machine-checkable assertion,
and the truth pass is already reading every body. Outside this slice the
authoring cost would be hard to justify; inside it, it is close to free.

**Syntax check before adopting:** Tailwind v4 scans every repo file for class
candidates, and this repo has already broken `globals.css` once via an
arbitrary-value bracket in a tracked file. `[[Some Label]]` contains spaces and
is not a utility candidate, but the plan must include a `npm run build` +
`globals.css` compile check after the first markers land, and must not
introduce a space-free marker that could read as an arbitrary variant.

### 3. Parser

New pure, i18n-free module `help-body-markup.ts` (no `.tsx` sibling exists —
checked, per the `.ts`-shadows-`.tsx` resolution trap):

- `parseHelpBody(body: string): ReadonlyArray<{ text: string; isLabel: boolean }>`
- `stripHelpMarkers(body: string): string`
- `helpBodyLabels(body: string): readonly string[]` — used by the gate.

Unmatched or nested brackets degrade to literal text rather than throwing; a
malformed marker must never blank a help body.

### 4. Render + search integration

Bodies currently render as `<Highlighted text={t(lang, e.bodyKey)} query={query} />`
inside a `whitespace-pre-line` `<p>`, and search matches the raw body via
`matchesQuery`. Markers therefore need handling in **two** places — miss the
search one and users get hits on markup they cannot see.

- `help-content-pane.tsx` renders `parseHelpBody(...)` segments, running
  `Highlighted` per segment. Label segments get `font-medium text-foreground`
  against the body's `text-muted-foreground` — palette-safe, no new token, no
  shadow, no off-palette colour.
- `matchesQuery` receives `stripHelpMarkers(body)`.

**Known limitation, accepted:** a search query spanning a label boundary will
not highlight across the segment break. The match itself still succeeds
because search runs on the stripped body.

### 5. Gate

One vitest file, `help-content-gate.test.ts`. Not a new npm script: the unit
job is already blocking, and a new CI stage would mean a CI-line edit in
AGENTS.md for no added enforcement.

**(a) Structural coverage ratchet.** Coverage is defined over **views only**: a
view is covered when some entry lists it in `relatedViews`. A feature module is
covered transitively, when at least one of its `views` is covered — the gate
does not assert against modules directly, because entries carry no module
reference and inventing one would be a second source of truth to keep in step.

Seven views are uncovered today and closing them is slice 3's job, so the gate
ships with an explicit `KNOWN_UNCOVERED` baseline listing those ids.

The assertion is **set equality**, not subset:

- a new gap fails immediately — the point of the ratchet;
- a *closed* gap also fails, until its id is removed from the baseline.

Equality is what makes it self-draining. A subset assertion would let the
baseline outlive the gaps and quietly become a permanent exemption — a
defeated gate that reports success. The baseline is a list of ids, never a
count, so one gap cannot be silently swapped for another.

**(b) Marker resolution.** For every entry, in EN and in DE independently,
every `[[label]]` must exactly match (after trim) some value in that
language's dictionary. This is the check that would have caught
`helpSecTourBody`.

### 6. Testing

- `help-body-markup.test.ts` — parse/strip/labels, including malformed input.
- `help-content-gate.test.ts` — both gate halves; each mutation-proved by
  temporarily breaking a marker and by adding a fake uncovered view.
- `help-content-pane.test.tsx` — labels render as styled text and **not** as
  raw `[[brackets]]`; a query matching label text still finds the entry.
- EN/DE key parity is already enforced by `tsc` via `TranslationKey`.

Every new test is mutation-proved: delete or invert the line it guards and
confirm it fails by name. A test that passes against the broken code is
recorded as vacuous and rewritten.

## Honest limits

**The gate does not verify that a claim is true.** It proves an entry exists
for each view and module, and that a marked label resolves. `helpSecAiBody`'s
"stored in this browser's localStorage" passes both halves — it names nothing
removed and marks no label; it is simply false.

Truthfulness stays human-verified, exactly like `docs:symbols:check`, which
proves a backticked name is real and never that a claim about it holds. This
must be stated in the gate file's own header so a later reader does not mistake
a green run for trustworthy help content.

## Success criteria

1. Every one of the 51 entries has been checked against current code by a
   reviewer, with the two known-false entries corrected in EN and DE.
2. `[[label]]` markers replace bare-quoted UI labels throughout, resolving in
   both languages.
3. `help-content-gate.test.ts` passes, and fails when a marker is broken or a
   new uncovered view is introduced.
4. Labels render styled, never as raw brackets; search still matches them.
5. Full gate set green: `tsc`, `eslint --max-warnings=0`, `test:run`,
   `test:coverage`, `dup:check`, `size:check`, `docs:symbols:check`, and the
   axe run for any touched scanned surface. Gates run **serially** — running
   `test:coverage` beside `dup:check` has produced a spurious exit 1 with all
   tests passing.
