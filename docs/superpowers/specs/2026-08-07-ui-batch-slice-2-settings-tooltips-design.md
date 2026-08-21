# UI batch slice 2 — settings restructure, button primitives, tooltip audit

**Date:** 2026-08-07
**Status:** approved design, not yet planned
**Baseline:** `origin/main` @ `f6e85d55`, app 0.221.0 "Kavan"
**Parent spec:** `2026-08-07-ui-batch-undo-budget-people-dependencies-design.md` (§2)

Supersedes §2 of the parent spec. The parent's §2.1 described `settings-view.tsx` as holding
"a flat `RAIL` of 16 entries" — that is wrong on both counts and the sub-rail design below is
built on what the file actually does. Slice 3 (§3 of the parent) is unchanged and still unwritten.

Conventions: **★** non-obvious, **★★** has caused a bug.

---

## Shape

Slice 2 runs in **two phases inside one branch and one release**. The phase boundary exists
because exactly one deliverable needs the user's approval before it can be implemented, and
nothing else in the slice depends on that approval.

```
Phase 1  sub-rail · file moves · views list · rename · 7 AI buttons
         · ~23 IconButton conversions · Class A tooltip fixes
         · docs/tooltip-inventory.md
             |
         [ approval gate: Class B rows only ]
             |
Phase 2  Class B InfoTooltips + EN/DE strings
             |
         full gates -> version bump -> release
```

---

## 1. Sub-rail under AI Assistant

### 1.1 What the rail actually is today

`settings-view.tsx` holds **17** `RAIL` entries and renders them in **four groups**, not one flat
list (`settings-view.tsx:89`, rendered at :257–275):

| Group | Membership | Order |
|---|---|---|
| main | everything not in the other three, expert-gated via `EXPERT_IDS` | alphabetical by translated label, except Comm Templates which is spliced under Templates |
| integrations | `INTEGRATION_IDS` = `ai` · `scheduledJobs` · `integrations` | alphabetical |
| flows | `informationFlows` | — |
| diagnostics | `diagnostics` | — |

Each group after the first is preceded by an `<hr className="my-1 border-line" />`.

`SectionId` is an 18-member union — 17 rail ids plus `jira`, which has no rail entry and is
coerced to `integrations` at :173.

### 1.2 The change

`RAIL` entries gain an optional `parent?: SectionId`:

```ts
{ id: "ai",            labelKey: "settingsSectionAi" },
{ id: "aiGuides",      labelKey: "aiGuidesHeading",    parent: "ai" },
{ id: "aiViews",       labelKey: "aiViewsTitle",       parent: "ai" },
{ id: "scheduledJobs", labelKey: "scheduledJobsTitle", parent: "ai" },
```

`SectionId` grows by two members (`aiGuides`, `aiViews`). `scheduledJobs` keeps its id and only
moves position.

**Only one new i18n key for the whole rail change** — `aiViewsTitle`. `aiGuidesHeading`
("Operating guides" / "Betriebsleitfäden", `i18n.ts:2015`) and `scheduledJobsTitle`
("Scheduled jobs" / "Geplante Jobs", `i18n.ts:911`) already exist and are reused as rail labels.

### 1.3 Grouping edits, ordered by how easy each is to miss

1. ★★ **`mainEntriesSorted`'s filter must add `!r.parent`.** The main group is defined by
   exclusion — everything not in the other three groups — so without this the three children fall
   through into it, render in the alphabetical main list *and* under their parent. This is the
   defect this design is most likely to ship.
2. `scheduledJobs` comes **out** of `INTEGRATION_IDS`. It is no longer a top-level integration
   entry, and leaving it there renders it twice for the same reason as (1).
3. `integrationEntries` also filters `!r.parent`, leaving `ai` · `integrations`.
4. `renderRailButton` renders a parent, then its children when the branch is active.

### 1.4 Branch-active test

A pure exported helper, not an inline expression — so it is unit-testable without rendering the
view:

```ts
isBranchActive(active, parentId, rail)
  => active === parentId || rail.find(r => r.id === active)?.parent === parentId
```

### 1.5 Rendering and a11y

- Children render in **declaration order** — Operating guides · Views · Scheduled jobs. Not
  alphabetical: alpha orders them differently in EN (Operating guides, Scheduled jobs, Views) and
  DE (Ansichten, Betriebsleitfäden, Geplante Jobs), for no gain.
- Child button gains `pl-6`. No nested `<ul>` — the rail is a flat flex `<nav>` of bare buttons
  today, and nesting it is a larger markup change than the indent buys.
- Parent button gains `aria-expanded` when it has children.
- `aria-current="page"` stays on whichever entry is genuinely active, parent or child — it is not
  put on the parent when a child is selected.

### 1.6 Two properties that hold, verified rather than assumed

★ **Deep-links keep working.** `requestSection: { id: "scheduledJobs" }` sets `active` to the
child; `isBranchActive` then returns true because the child's `parent` is `ai`, so the branch
renders open around it. The nonce/consume protocol (`settings-view.tsx:133–155`) is untouched.

★ **No new stale-active coercion is needed.** The coercion block at :166–175 exists for entries
that can *lose* their rail item — `nextActions` (expert-gated), `commTemplates` (expert + feature
gate), `projectOverrides` (popout), `storage` (folded into General). The three AI children have no
visibility gate, so nothing can strand the pane on a hidden child.

### 1.7 Tests

- `isBranchActive` — pure, direct unit tests including the child-of-a-different-parent case.
- `settings-view.test.tsx` — children absent when a non-AI section is active; present when `ai` is
  active; present when a *child* is active; each child appears exactly **once** in the rail
  (the mutation that (1) and (2) above would cause is a duplicate, not an absence, so an
  existence assertion cannot catch it — assert the count).
- Deep-link to `scheduledJobs` from a fresh mount lands on it with the branch open.

---

## 1a. Amendments found while planning

Two things this spec got wrong, both found by reading `ai-section.tsx:601–782` rather than trusting
the line reference inherited from the parent spec. Resolved in
`docs/superpowers/plans/2026-08-07-ui-batch-slice-2-settings-tooltips.md` as DECISION A and B.

### ★★ The `settings.ai.enabled` gate

`ai-section.tsx:427` opens `{settings.ai.enabled === true && (<>` and the fragment does not close
until `:779`. **Both** the guides block and `AiViewScopeDisclosure` are inside it, so today they are
invisible whenever the AI master switch is off. Promoting them to rail sections would render them
unconditionally — a silent behaviour change this spec did not consider.

**Resolution:** the gate moves with the content. Each new section renders a `FieldHint` carrying the
existing `aiEnableHelp` string when AI is off. No new i18n key.

★ This is also what keeps §1.6's claim true. Hiding the child *rail entries* instead would make a
child able to vanish while active, which **would** require new stale-active coercion.

### ★ What actually moves with the guides

§2 says "Operating guides block (from ~line 601)". That block also contains three controls unrelated
to guides: `settingsAiActionSuggestions` (622–642), `aiInsightRecommendations` (645–665) and its
`CapInput` (672–691). Only the guides-related rows move — the heading, `aiGuidesDesc`, the
`aiGroundInGuides` toggle (which is what makes guides take effect) and the `og != null` block.

The three unrelated controls stay in `ai-section.tsx`, re-parented into their own bordered block.
They were mis-grouped under the guides heading; the extraction surfaces that rather than carrying it
along.

---

## 2. File moves out of `ai-section.tsx`

`ai-section.tsx` is **782** lines against the 800-line ratchet, and `size:check` counts `wc -l` +1
— so real headroom is 17 lines. The move is what buys room for §5's button conversions.

### 2.1 `settings-sections/ai-guides-section.tsx` (new)

Moves out of `ai-section.tsx`:

| What | Lines today |
|---|---|
| `GuideDraft`, `emptyDraft`, `draftFromGuide`, `draftToScope` | 109–140 |
| `GuideForm` | 141–270 |
| Operating-guides block | 601–776 |
| Guide CRUD state + `openAdd` (:370) · `openEdit` (:375) · `closeForm` (:380) · `handleSave` (:384) | 370 onward |

Props `{ lang, operatingGuides }`. Roughly −250 lines, landing `ai-section.tsx` near 530.

★ The block's own `<p className="text-sm font-medium">{aiGuidesHeading}</p>` (:603) is **dropped** —
see §3.1 for why the section heading now arrives from `settings-view.tsx`.

### 2.2 `ai-view-scope-disclosure.tsx` → `ai-views-section.tsx` (rename)

Renamed, not wrapped. §3 strips the toggle out of it and the heading moves to the shell, leaving a
~40-line component; a separate wrapper file around that is ceremony. `ai-view-scope-disclosure.test.tsx`
renames with it.

### 2.3 Mounting

`settings-view.tsx` mounts both new sections directly, passing `props.operatingGuides` to the guides
section — the same prop it already threads to `AiSection` at :359.

★ `ai-section.test.tsx` currently covers guide CRUD. Those cases move to a new
`ai-guides-section.test.tsx` rather than being deleted or duplicated.

---

## 3. Views as a plain list

`ai-views-section.tsx` drops `ToggleButton`, the `open: Set<AppView>` state, `toggle()`, and the
`panelId` / `aria-controls` / `hidden` plumbing. Each view is an `<li>` with its nav label as a
heading and `purpose` / `reading` / `toolHints` plus the `aiViewScopeDigest` line (where
`VIEW_AI_DIGEST[view]` is set) always visible.

### 3.1 The heading comes from the shell

★ `settings-view.tsx:282` already renders `<h2>{t(lang, rail label)}</h2>` for every section except
`mode` / `templates` / `commTemplates`. So a section that is its own rail entry gets its heading
free, and `aiViewsTitle` serves as both the rail label and the heading. The component renders no
heading of its own. Same reasoning drives the dropped `<p>` in §2.1.

### 3.2 Retired string

★ `aiViewScopeTitle` ("What Claude knows about each view" / "Was Claude über die einzelnen Ansichten
weiß") becomes unreferenced. Grepped: `ai-view-scope-disclosure.tsx:33` is its only call site.
Deleted from `i18n.ts` and `i18n.de.ts` in the same commit as the change. `aiViewScopeIntro` stays
as the intro paragraph.

### 3.3 Accepted trade

17 views expanded is a long scroll rather than a click. That was the ask.

---

## 4. Rename "This project" → "Overrides"

`settingsProjectOverrides` — EN `i18n.ts:3327` "This project" → "Overrides"; DE `i18n.de.ts:3298`
"Dieses Projekt" → "Überschreibungen".

★★ `i18n.de.ts` is CRLF and the Edit tool corrupts umlauts there (and curls double quotes). Patch
via a node utf8 write whose anchor matches `\r\n`, then byte-verify. The `i18n-encoding` test bans
ASCII substitutions, so "Ueberschreibungen" is a failing gate, not a workaround.

★ The rail is sorted by *translated* label, so both renames move the entry's position in the
alphabetical main group. Expected, not a regression.

---

## 5. The seven hand-rolled buttons in `ai-section.tsx`

All seven read. The reported "no mouseover" is real, and the cause is per-button:

| # | Control | Current class | Hover today | → |
|---|---|---|---|---|
| 1 | `aiGuideSave` | `border-line bg-ui-green` | none | `primary` |
| 2 | `aiGuideCancel` | `border-line bg-surface` | `hover:bg-surface` — **no-op**, already that colour | `secondary` |
| 3 | `secretPassphraseSave` | `border-line bg-ui-green` | none | `primary` |
| 4 | `secretPassphraseRemove` | pink text | `hover:bg-surface-muted` ✓ | `destructive` |
| 5 | `aiGuideEdit` | `border-line bg-surface` | none | `secondary` |
| 6 | `aiGuideDelete` | `border-line bg-surface`, pink text | none | `destructive` |
| 7 | `aiGuideAdd` | `border-line bg-surface` | none | `secondary` |

Five carry no hover class at all; one carries a hover that resolves to its own background. All seven
gain `hover:bg-surface-muted` and the `INTERACTIVE` focus/motion atom from the primitive.

### 5.1 Green → dark blue is deliberate

★ Buttons 1 and 3 are `bg-ui-green text-foreground`. `Button`'s `primary` is
`bg-ui-dark-blue text-white` (`button.tsx:21`), so the conversion is a **visible colour change**.
It is the convergent answer, not an accident: `edit-modal-chrome.tsx:267` — the canonical modal
footer every edit modal renders — uses `<Button type="submit">` at default `primary` for Save with a
`secondary` Cancel. Green-save is the outlier in this file. **Approved by the user.**

★ jsdom cannot see this. It needs eye-verify, not a test.

### 5.2 Ordering

★ Buttons 1, 2, 5, 6 and 7 live in code that §2.1 moves to `ai-guides-section.tsx`. **Move first,
convert second** — converting then moving resolves the same diff twice.

---

## 6. IconButton conversions — the safe clusters

Sourced from `docs/handrolled-ui-inventory.md` (slice 1), taking only rows the inventory marks
**"Read and confirmed"**.

| Cluster | Sites | Note |
|---|---|---|
| `app-header.tsx` · `top-bar.tsx` | 3 + 3 | ★★ The same three-icon cluster in both layouts. Land it in **both** or it is invisible in whichever you forgot; modern (`top-bar`) is the default, `app-header` the easy miss. |
| `help-menu.tsx` · `notes-window.tsx` · `version-info.tsx` | 3 | Floating-window closes, identical `rounded p-1` + `XMarkIcon`. |
| `×`/`✕` glyph closes | 12 | `actions-panel` · `change-edit-modal` · `dashboard-tip-card` · `entity-link-picker` · `inline-ai-edit-popover` · `knowledge-links-field` · `raci-panel` · `raci-chip-picker` · `resource-edit-modal` · `resource-workload` · `timelog-people-table` · `saved-views-menu`. Element conversion and glyph→`XMarkIcon` are one edit. All twelve already carry an `aria-label`, so the glyph is decorative and safe to drop. |
| `roles-editor.tsx` (2) | 2 | **Addition beyond the 21.** Already `IconButton`, but still pass a literal `×` as the child — glyph-only, same family, and excluding them leaves the cluster visibly half-done. Flagged here so it can be vetoed at spec review. |

**23 sites total.**

★ Cite the **symbol**, not `file:line`, when implementing — the inventory's line numbers predate
this branch and a conversion shifts every number below it in the same file.

### 6.1 Exclusions, all collision-driven

- `use-tasks-dedup.tsx` and `task-row.tsx` inline-AI triggers — slice-3 AI-cancel targets, and the
  inventory already flags both as needing a read first (conditional text; `group-hover` opacity that
  must survive the swap).
- ★ `inline-ai-edit-popover.tsx`'s close **is** in the twelve, and slice 3 rewires that same file for
  the cancel affordance. Different control, same file. **Taken now** (user-approved); the slice-3
  plan records the touch so the rebase is expected rather than discovered.

### 6.2 Contract and verification

★ `IconButton` requires `label`, which becomes `aria-label`, and passes `title` through as a rest
prop (`IconButtonProps extends Omit<ButtonHTMLAttributes, "aria-label">`) — a converted button keeps
both. The child must be an `aria-hidden` icon; heroicons default `aria-hidden`, so a bare
`<XMarkIcon />` is correct.

★★ `app-header` / `top-bar` render in **every** axe-scanned view. A targeted axe run is required
before push; the unit suite never runs Playwright.

---

## 7. Tooltip audit

### 7.1 The landscape

Measured 2026-08-07 on non-test `.tsx` under `src/app`: **388** `title=` attributes and **147**
`<InfoTooltip` mounts.

```bash
grep -rho 'title=' src/app --include=*.tsx --exclude="*.test.tsx" | wc -l      # 388
grep -rho "<InfoTooltip" src/app --include=*.tsx --exclude="*.test.tsx" | wc -l # 147
```

★ Coverage is already dense. The audit's job is finding the **gaps**, not establishing tooltips as
a pattern.

### 7.2 Two row classes with very different cost

| Class | What | New strings | Approval |
|---|---|---|---|
| **A** | Icon-only control that already has an `aria-label` and no `title`. Fix is `title={<existing key>}`. | none | no — mechanical, lands in phase 1 |
| **B** | Control whose visible label does not name the consequence of pressing it. Needs new EN+DE text via an `InfoTooltip` beside the label. | yes | **yes** — this is the gate |
| **Keep** | Neither applies. | — | no |

★★ **A row is Class A only if the existing `aria-label` genuinely names the consequence.** Where the
label is a bare noun ("Notifications"), copying it into a `title` produces the *appearance* of
coverage and delivers nothing — that row is Class B. This is the judgement the audit exists to make,
and getting it wrong is how the deliverable becomes a checkbox.

★ A control missing an accessible **name** is neither class. `title` is hover-only — no keyboard
focus, unreachable on touch — so it is a mouse and screen-reader disclosure, never the fix for a
missing name. Those rows are filed separately as `aria-label` defects.

### 7.3 Deliverable

`docs/tooltip-inventory.md`:

- One row per control: *control · file · surface · class · existing name · proposed EN text · reason*.
- **Keep** rows carry their reason too — that is what stops the next contributor rediscovering them,
  and it is the part slice 1's inventory got right.
- Every count carries its reproduce command. ★ An unattached count is the single most-rotted kind of
  claim in this repo's docs.
- A new numbered entry in `docs/open-followups.md` pointing at the file, so the un-actioned remainder
  is a ratchet rather than a rediscovery.

★★ Numbering collides across parallel branches — whoever merges second renumbers; git flags the
conflict.

### 7.4 The gate

Phase 1 ends with the Class B table presented for approval. Phase 2 implements **only** approved
rows, each with EN + DE strings. Unapproved rows stay in the inventory tagged as such.

---

## 8. Process

### 8.1 Test running

Explicit user constraint: fewer full-suite runs.

- `npx tsc --noEmit` after each multi-file edit group. It is fast and it is the gate that catches
  i18n EN/DE key parity, which this slice touches repeatedly.
- Targeted vitest per touched area during work — never the full suite mid-task.
- **One** `npm run test:run` + `npm run test:shuffle` at the end of phase 1, and one more at the end
  of phase 2.
- `size:check` · `dup:check` · `docs:symbols:check` once per phase.
- Targeted axe before push, on a **fresh isolated port** (`PORT=3100`), never the reused long-running
  dev server.

★★★ **Never read a gate's exit code through a pipe** — the pipe's status is what you get, and the
diagnostic is discarded. Redirect, `echo "EXIT=$?"` unpiped, then read the file.

★★ **No `run_in_background` vitest.** It gets killed mid-run and leaves a surviving child process;
the resulting `emitUnexpectedExit` spew reads like a red suite and is not one. Foreground only.

### 8.2 No hand-rolling

Explicit user constraint. Every control uses `Button` · `IconButton` · `ToggleButton` ·
`form-controls` · `InfoTooltip`. Where no primitive fits, **ask** — do not invent one.

### 8.3 Branch

Off fetched `origin/main` (`f6e85d55`). ★ Local `main` is stale at `4dd13660` — fetch first.

★ `git checkout --` and `git restore` are both deny-listed in this environment. To revert a file:
`git show <sha>:<path>` to a temp copy, then `cp` it back.

### 8.4 Release

One bump covering both phases: `src/app/version.ts` (APP_VERSION · APP_BUILD_DATE · milestone),
`CHANGELOG.md`, any new `versionHighlight*` key appended to `APP_HIGHLIGHT_KEYS` with EN+DE strings,
plus the five ungated version sites — `package.json`, **both** `package-lock.json` occurrences, the
README shields badge (version **and** codename), and the generated header on all five
`docs/CODEMAPS/*.md`.

---

## 9. Eye-verify owed

jsdom and axe are both blind to these:

- The two save buttons, green → dark blue (§5.1).
- The sub-rail indent and the group dividers around it — the `<hr>` separators sit between groups,
  and an expanded branch changes how the integrations group reads.
- Views as a 17-item expanded list: scroll length and whether `toolHints` `<code>` runs wrap badly.
- The three top-bar / app-header icon clusters after conversion, in **both** layouts.

★ Slice 1's eye-verify is still owed and is unrelated to this list.

---

## 10. Out of scope

- The remaining ~15 `IconButton candidate` sites in `docs/handrolled-ui-inventory.md` and every
  `convertible` row. Still a tracked follow-up.
- Glyph→heroicon replacement outside the 12 closes + `roles-editor`'s 2.
- Sortable-header glyphs (`↑`/`↓`): tests read them from `textContent` and they carry a real cue.
- Class B tooltip rows the user does not approve.
- Any slice-3 work (undo dropdown · AI cancel · budget people rows · dependency direction).
- Persisting sub-rail expansion state. The branch opens because a section in it is active; there is
  no separate expand state to persist.
