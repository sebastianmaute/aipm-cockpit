# Slice D — field affordances (clear ✕ audit · linked-task wildcard · Knowledge sizing)

_Opened 2026-07-28 against 0.204.0 "Benford". Slice D of
`2026-07-27-ux-batch-roadmap-design.md` (order **C → D → F → A → E → S6 → S7 → B**)._

★ This file is gitignored (`/docs/superpowers/`), local-only by standing decision. At the close of
this slice, re-archive the tree **cumulatively** — merge the prior zip's unique entries in and assert
`set(old.namelist()) - set(new.namelist()) == set()` before trusting the result. A walk-the-tree zip
alone is a strict SUBSET (36 files in the tree vs 334 in the archive) and destroys ~298 documents.

**Release:** 0.205.0 "Griffith" — verified absent from `CHANGELOG.md` (26 other candidates checked
were all taken).

---

## Goal

Three field-level affordance gaps, all user-reported:

1. Every search/filter field in the app can be cleared with one visible control — the shared
   `ClearableSearchInput` shipped in slice C reaches 13 more fields.
2. Linked-task pickers accept a `*` wildcard, matching the timelog scope filters.
3. The Knowledge linked-tasks picker is no longer collapsed to content width.

Non-goals: merging the two combobox implementations (`global-search-box` vs `EntityLinkPicker`) —
their dismissal semantics differ (`onFocus` reopen + recents vs `onClick` reopen + options) and that
is its own slice. No new persisted state, no backend write path, no golden fixtures.

## Grounding — verified against 0.204.0

- `ClearableSearchInput` (`clearable-search-input.tsx`) already serves **19** sites: `TableFilter`
  (`report-table.tsx`, 17 call sites) + `timelog-customer-scope` + `timelog-project-scope`.
- 13 search/filter fields still have **no** clear affordance:

  | # | File:line | Field |
  |---|---|---|
  | 1 | `activity-log-panel.tsx:204` | activity search (`type="search"`) |
  | 2 | `diagnostics-panel.tsx:115` | diagnostics code filter |
  | 3 | `gantt-chrome.tsx:105` | gantt task search (`type="search"`) |
  | 4 | `global-search-box.tsx:232` | global search (combobox) |
  | 5 | `help-menu.tsx:146` | help search, floating panel (`type="search"`) |
  | 6 | `help-view.tsx:131` | help search, in-pane (`type="search"`) |
  | 7 | `jira-settings.tsx:575` | Jira user search |
  | 8 | `knowledge-panel.tsx:370` | documents search (`type="search"`) |
  | 9 | `raci-panel.tsx:165` | RACI filter/add field |
  | 10 | `resource-directory.tsx:254` | directory search |
  | 11 | `sharepoint-picker-modal.tsx:167` | SharePoint picker search |
  | 12 | `task-link-picker.tsx:67` → `entity-link-picker.tsx` | chip-picker query box (one edit covers task links in change / RAID / Knowledge / budget-bucket **and** RAID caused-by) |
  | 13 | `timelog-panel.tsx:599` | people filter |
  | 14 | `pane-toolbar.tsx:49` (`PaneSearchInput`) | the SHARED toolbar search atom — **one edit covers `change-panel` · `milestones-panel` · `raid-panel-toolbar` · `stakeholders-panel`**, two of them axe-scanned |
  | 15 | `tasks-section.tsx:630` | Open Points search |

  ★★ Sites 14 and 15 were missed by the first pass of this audit and found during planning. The grep
  keyed on `placeholder=`, and `PaneSearchInput`'s four callers pass `ariaLabel=` instead — so a
  placeholder-shaped search misses the one file that would have fixed four panels at once. Any future
  "app-wide control audit" must grep the shared ATOMS, not the call sites.

  ★★ **`tasks-section.tsx` is baselined at 1073 lines**, and the ratchet fails on *any* growth of an
  already-oversized file. Wrapping in place is therefore not available. Resolution (decided
  2026-07-28): **migrate its bespoke `<Input type="search">` to `PaneSearchInput`**, which gains the
  clear in this same slice — net ≈ −3 lines, and the Open Points toolbar stops being the one register
  toolbar that does not use the shared atom. Accepted cost: a small visual delta (`Input size="xs"`
  padding vs the atom's `px-2.5 py-1.5`) on an axe-scanned view, so it needs an eye check. Rejected:
  raising the baseline (loosens a blocking ratchet for a cosmetic feature) and offsetting with an
  unplanned extraction (slice C's ninth task, again).

- `ResourcePicker`'s ✕ is deliberately NOT this primitive — it clears a whole linked field with
  documented dangling-link semantics. Out of scope, do not touch.
- Linked-task filtering runs through `filterPickerOptions` (`picker-filter.ts:20`), whose text arm is
  `getText(item).toLowerCase().includes(q)` — no wildcard.
- `customerMatcher` (`use-timelog-picker-scope.ts:32`) is the shipped `*` precedent.
- `TaskLinkPicker` mounts twice in Knowledge: the add-link row (`knowledge-panel.tsx:293`) and each
  library card (`:431`).

Headroom, all files this slice touches (cap 800): `timelog-panel` 721 · `jira-settings` 642 ·
`knowledge-panel` 515 · `gantt-chrome` 478 · `resource-directory` 425 · `activity-log-panel` 342 ·
`global-search-box` 331 · `entity-link-picker` 314 · `sharepoint-picker-modal` 293 ·
`raci-panel` 258 · `help-view` 176 · `help-menu` 168 · `diagnostics-panel` 151. Each site grows ~4
lines. No ratchet risk — unlike slice C, checked at plan time.

## Approach — chosen

Wrap each site in the existing primitive; caller keeps its own field. Rejected: a new `SearchField`
composite (the 13 fields genuinely differ — raw `<input>` vs `Input size="xs"` vs combobox — and
migrating them re-baselines markup on five axe-scanned views for no dedup gain the primitive does not
already provide, since the button is the only duplicated part).

---

## D1 — Primitive change: focus returns to the field

`clearable-search-input.tsx` gains two things on the clear button:

- `onMouseDown={(e) => e.preventDefault()}` — keeps focus in the field for a mouse click (no
  flicker), and protects any commit-on-blur caller (the `ResourcePicker` precedent).
- After `onClear()`, focus the field: the primitive holds a ref on its wrapper `<div>` and calls
  `ref.current?.querySelector<HTMLElement>("input, textarea")?.focus()`.

**Why the querySelector and not a `fieldRef` prop:** `children` is contractually THE field (the
primitive's own doc comment says so), and a prop would churn all 19 shipped sites for no behavioural
difference.

**Why focus at all — this is a bug fix, not a nicety.** The button renders only while `value` is
non-empty, so activating it unmounts it. On keyboard activation focus therefore lands on `<body>`: a
dead end mid-form. Mouse users hit the same thing when the preventDefault is absent.

Order matters: clear first, then focus (focusing a field that still holds text is harmless but the
reverse reads as a race to anyone editing this later).

Applies to all ~32 sites at once. Behaviour change on the 19 shipped ones is intended.

**Tests** (`clearable-search-input.test.tsx`):
- `userEvent.click(clearButton)` → `document.activeElement` is the input.
- `userEvent.tab()` to the button, `{Enter}` → same. (`.focus()` in a test proves nothing —
  programmatic focus succeeds on `tabIndex={-1}`; tab is what proves reachability.)
- Mutation gate: delete the focus call → both must go red, and the failure must be the focus
  assertion, not a neighbour.

## D2 — The 13 call sites

**Label rule:** `clearLabel = ${t(lang, "clear")} – <the field's own accessible name>`, where the
accessible name is the `aria-label`/label key the field already carries. Matches the shipped pattern
(`report-table.tsx:109`, `timelog-customer-scope.tsx:49`).

Applying the rule surfaced three prerequisites the audit has to fix first — each is a real WCAG gap
the ✕ merely exposes, and each is why "reuse the field's own name" is not free:

1. **Two fields have NO accessible name at all** — `jira-settings.tsx:575` and
   `sharepoint-picker-modal.tsx:167` are placeholder-only, and a placeholder is not an accessible
   name (axe-critical wherever it is scanned; neither surface is in `A11Y_VIEWS`, which is why it
   survived). Add `aria-label={t(lang, "jiraUserSearch")}` / `…"spPickerSearchPlaceholder"` — the
   keys already exist.
2. **`help-menu` and `help-view` share the name `helpSearchPlaceholder` ("Search help")**, and the
   floating Help window can be open ON TOP of the Help view — two identically-named fields and two
   identically-named clears in one accessibility tree. This is a **pre-existing** duplicate that axe
   cannot see. Resolve with **one new i18n key pair**, `helpSearchPanelLabel`
   ("Search help (window)" / DE), used as the floating panel input's `aria-label` and as the base of
   its clear label. The in-pane Help view keeps `helpSearchPlaceholder`.
3. `gantt-chrome` and `tasks-section` both use `searchPlaceholder`, but they are different views and
   never co-render — no collision. Checked, not assumed.

So: **one new i18n key pair** (`helpSearchPanelLabel`) plus the D3 placeholder edit. Everything else
reuses existing keys.

**Mechanical per site:** wrap the field in `<ClearableSearchInput value onClear clearLabel>`, add
`pr-8` to the field's className, and for the five `type="search"` fields (activity-log, gantt-chrome,
help-menu, help-view, knowledge-panel) also add
`[&::-webkit-search-cancel-button]:appearance-none` — Chrome/Safari draw a native ✕ that would read
as two clears while Firefox draws none.

**Special cases:**

- **`global-search-box.tsx`** — wrap ONLY the `<input>`. The outer `relative` root anchors the
  listbox and must stay. Its padding is `showingRecents ? "pr-14" : "pr-3"`; becomes
  `showingRecents ? "pr-14" : "pr-8"`. Safe: the decorative ⌘K hint occupies the right slot only
  while the query is empty, and the ✕ renders only while it is non-empty — mutually exclusive.
  Refocusing after clear re-fires `onFocus` → recents open on an empty query, which is the correct
  state.
- **`entity-link-picker.tsx`** — wrap the query `Input` inside the existing `relative` div (the same
  div the listbox is positioned against, so the ✕ lands over the input, not the list). `clearLabel`
  derives from the existing `searchLabel` prop, which callers already make row-unique (Knowledge
  passes `${knowledgeLinkedTasks} – ${it.name} (${idx+1})`). Distinct from the chips' unlink `×`,
  whose names are `${removeLabel} ${code}[ ${label}]`.
- **`raci-panel.tsx:165`** — resolved, not deferred: it is an **Enter-commits add field backed by a
  `<datalist>`**, whose `onChange` auto-adds when the typed value exactly matches a stakeholder
  label. Two consequences. The mousedown-preventDefault is load-bearing here (a blur-then-click would
  otherwise race the commit), and **clearing must not add** — the clear sets the draft to `""`,
  which no `labelFor(s)` can equal, so the existing exact-match guard already covers it. Assert that
  in a test; it is one character away from being wrong.
- **`jira-settings.tsx` / `sharepoint-picker-modal.tsx`** — see prerequisite 1 above; they need an
  `aria-label` before they can have a labelled clear. Both sit inside modals; the ✕ is an ordinary
  button and does not join the dismissal stack, so Escape behaviour is untouched.

## D3 — `*` wildcard for the chip pickers

New pure i18n-free module `src/app/wildcard-match.ts`:

```ts
/** `*` is a wildcard, everything else literal. Case-insensitive substring semantics. */
export function wildcardMatcher(query: string): (text: string) => boolean;
```

Body lifted verbatim from `customerMatcher`: trim + lowercase, split on `*`, regex-escape each part
(`/[.*+?^${}()|[\]\\]/g`), join with `.*`, `new RegExp(escaped, "i")`, return `re.test`. Empty query
→ `() => true`.

**Behaviour preservation:** with no `*` in the query this is an unanchored, case-insensitive
substring test — identical to today's `includes`. Only a query containing `*` changes anything.

Wiring:
- `use-timelog-picker-scope.customerMatcher` delegates to it (keep the export — its tests and two
  callers reference it). This is what keeps `dup:check` quiet: the escape logic exists once.
- `filterPickerOptions` (`picker-filter.ts`) builds the matcher **once per call**, before the
  `.filter()` chain, and uses it in place of the `includes`. The `String(getId(item)) === q`
  short-circuit stays ahead of it unchanged.

Reach: every chip picker — linked tasks in change / RAID / Knowledge / budget-bucket, and RAID
caused-by (which passes its own `extraFilter`; unaffected).

i18n: `taskLinkSearchPlaceholder` EN + DE gain the `(* wildcard)` suffix, mirroring
`timelogCustomerFilter` / `timelogProjectFilter`. DE via a node utf8 write (the Edit tool corrupts
umlauts in the CRLF `i18n.de.ts`), then grep-verify.

**Tests:** `wildcard-match.test.ts` (new pure module ⇒ coverage-gated, must be tested not excluded):
empty → all; no-`*` → substring, case-insensitive; `a*b` spans; leading/trailing `*`; a regex
metachar in the query is literal (`c++` must not throw or over-match); `*` alone matches everything.
Plus a `picker-filter` test proving a `*` query reaches options a plain substring would not, and a
no-`*` query returns exactly what it returned before.

## D4 — Knowledge linked-tasks sizing

Both mounts are undersized:

- **Add-link row** (`knowledge-panel.tsx:290`): the linked-tasks `<label>` sits in a
  `flex flex-wrap items-end gap-2` row where every sibling declares a basis (the URL field is
  `flex-1 … min-w-[12rem]`), so it collapses to content width. Fix: `flex-1 min-w-[16rem]`.
- **Library card** (`:429`): cards sit in `grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3`. Two
  changes — grid `lg:grid-cols-3` → `xl:grid-cols-3` so cards are full-width-ish at lg, and the chip
  label `max-w-[220px]` → `max-w-full` in `entity-link-picker.tsx` (220px overflows a 3-col card).

★ The chip max-width lives in the SHARED picker, so RAID and change modals inherit it. `truncate`
stays, so a long label still renders on one line — it now truncates at the container instead of at a
fixed 220px. Accepted deliberately; the alternative (a `chipMaxWidthClass` prop) adds API surface for
a difference with no reason behind it.

Knowledge is NOT in `A11Y_VIEWS` and jsdom reports every rect as zero, so **eye-verify** at 375px,
1280px and 1920px. Unit tests here assert structure (classes present), not pixels.

## D5 — Tests and gates

- **Per site:** assert the clear button by its **exact qualified name**, never `/clear/i` — that
  regex matches the unqualified string too and passes against reverted code (slice C shipped exactly
  that mistake).
- **Duplicate-name guard:** for each axe-scanned view that now carries ≥2 clear buttons, assert every
  `^Clear` accessible name is distinct. The axe gate cannot see duplicate names, only missing ones.
- **Write/behaviour direction:** the primitive's focus test above is the load-bearing one; run the
  mutation and read WHICH assertion failed, not just that the test went red.
- Gates: `npm run lint` (0 warnings) · `npx tsc --noEmit` · `npm run test:run` ·
  `npm run test:coverage` · `npm run dup:check` (1.16% / 1.47% today, cap 1.75 — the 13 wraps are
  <50 tokens each so below `min-tokens`, but re-check) · `npm run size:check` ·
  `npx playwright test e2e/a11y.spec.ts --project=chromium` for Gantt, Open Points, Reports,
  Resources, Settings, Time bookings.

## D6 — Release chain

Bump `src/app/version.ts` (`APP_VERSION` 0.205.0 + milestone codename, unique — grep CHANGELOG) ·
`CHANGELOG.md` entry · **no** new `APP_HIGHLIGHT_KEYS` (it is a cumulative list of feature areas, not
per-release entries) · cumulative archive with the superset assert · push/MR/merge only on an
explicit "release".

## Files

**New:** `src/app/wildcard-match.ts` · `src/app/wildcard-match.test.ts`

**Modified:** `clearable-search-input.tsx` (+ test) · the 13 files in the D2 table ·
`entity-link-picker.tsx` (query clear + chip max-width) · `picker-filter.ts` (+ test) ·
`use-timelog-picker-scope.ts` (delegate) · `knowledge-panel.tsx` (sizing) · `i18n.ts` + `i18n.de.ts`
(edit `taskLinkSearchPlaceholder`, add `helpSearchPanelLabel`) · `version.ts` · `CHANGELOG.md`

Both i18n files must stay key-identical (tsc enforces). `i18n.de.ts` is CRLF and the Edit tool
corrupts umlauts there — patch via a node utf8 write matching `\r\n`, then grep-verify.
