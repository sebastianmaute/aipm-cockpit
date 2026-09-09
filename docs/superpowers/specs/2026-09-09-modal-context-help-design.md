# Modal context help — design

**Goal:** every modal that has something to explain carries a question-mark icon opening its own
Help entry, rendered in place over the dialog, without switching the view behind it or costing the
user an unsaved edit.

**Status of the underlying entry:** this implements the prop-reachable half of
`docs/open-followups.md` §424, which stays OPEN and narrowed afterwards.

---

## 1. Why this is not a fresh idea

§424 ("No window or modal offers a help icon, though the deep-link channel already exists") was
filed 2026-09-06, deliberately deferred out of the Reports-arrangement slice. It already did the
survey work. A peer session (`feat/ai-cost-basis-task-list`) confirmed on 2026-09-09 that nothing is
specced, planned or in flight for modal help anywhere else, and that its own branch touches none of
the seven files this slice does.

### What already exists

The deep-link CHANNEL is built and in production: `requestHelpConcept` → `pendingHelpConcept` →
`HelpView`, which scrolls to `helpSectionId(id)` behind the sentinel-seeded remount-swallow guard
AGENTS.md mandates. `HELP_ENTRIES` holds 66 entries.

```bash
grep -rn "requestHelpConcept" src/app --include=*.ts --include=*.tsx | grep -v "\.test\."
```

→ 26 hits on 2026-09-06, every one feeding a `<ViewCallout onLearnMore={...}>`. None targets a
modal, because `VIEW_CALLOUTS` is keyed by `AppView`, which cannot name one.

### Blast radius, re-measured

§424 instructs the reader to re-measure its own numbers with a multiline scan rather than trust
them, because several call sites break the `<Modal` tag across lines. Re-measured 2026-09-09 against
`origin/main` at `6ad4d18b`; **all four numbers reproduce exactly**:

```bash
node -e '
const fs=require("fs"),path=require("path");const files=[];
(function walk(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);
 if(e.isDirectory())walk(p);else if(/\.tsx$/.test(e.name)&&!/\.test\.tsx$/.test(e.name))files.push(p);}})("src/app");
let mf=[],ms=0,hf=[],hs=0;
for(const f of files){const s=fs.readFileSync(f,"utf8");
 const m=s.match(/<Modal[\s>]/g)||[],h=s.match(/<ModalHeader[\s>]/g)||[];
 if(m.length){mf.push(f);ms+=m.length;} if(h.length){hf.push(f);hs+=h.length;}}
console.log("Modal files",mf.length,"sites",ms,"| ModalHeader files",hf.length,"sites",hs,
            "| without header",mf.filter(f=>!hf.includes(f)).length);'
```

→ `Modal files 34 sites 36 | ModalHeader files 20 sites 20 | without header 14`.

### One thing §424 does not record, and it changes the shape

`EditModalShell` (exported from `edit-modal-chrome.tsx`, **not** a component named
`EditModalChrome` — that name does not exist) has seven consumers:

```bash
grep -rln "EditModalShell" src/app --include=*.tsx | grep -v test
```

→ `absence-edit-modal` · `calendar-event-modal` · `change-edit-modal` · `milestone-edit-modal` ·
`raid-edit-modal` · `resource-edit-modal` · `stakeholder-edit-modal` (plus the declaring file).

Six of those render neither `<Modal` nor `<ModalHeader>` directly, so the scan above **cannot see
them at all**. The consequence runs both ways: there are more dialog surfaces than 36, and less
bespoke work than 14, because one passthrough on the shell carries all seven entity modals.

`headerExtra` is already occupied at five of the twenty sites:

```bash
grep -rn "headerExtra=" src/app --include=*.tsx | grep -v test
```

→ `budget-bucket-modal` · `edit-modal-chrome` · `project-edit-modal` · `project-empty-state` ·
`task-form-modal` (`ModalFieldControls` ×3, `ResetSizeButton` ×2). Every entity modal inherits the
occupied slot through the shell. So composing help into `headerExtra` per site is **unavailable
exactly where the tranche is densest** — a dedicated prop is forced, not merely preferred.

---

## 2. Decisions taken

Both were settled with the user before this document was written. Neither is reopened by the plan.

**D1 — the popover opens in place, over the modal.** `requestHelpConcept` sets
`activeTab = "help"`; fired from a modal that switches the view *behind* the still-open dialog.
§424 says settle this before writing any icon. Settled: an in-modal popover, so no `activeTab`
change, no top-bar chrome surgery, and the edit survives. The three rejected alternatives were
floating the `HelpMenu` above the dialog (requires hoisting its open state and query out of a
top-bar window — chrome the user has asked to confirm before altering), closing the modal first
(destroys unsaved edits on ~20 edit dialogs), and an inline intro line (does not answer §424's ask,
which is specifically an icon opening its own entry).

**D2 — tranche is the prop-reachable set.** The 20 `ModalHeader` sites and the 7 `EditModalShell`
consumers. The 14 bespoke placements and the two hand-rolled floating windows (`help-menu`,
`notes-window`, both via `useDraggableWindow`) are out of scope and stay on §424.

---

## 3. Architecture

Five units, each independently testable.

### 3.1 `HelpEntryId` — a compile-time id union

Today `HelpEntry.id` is `string` and `HelpContentPane` resolves it with a `.find(...)` returning
null on a miss, so a typo is silent at build time AND at runtime (§424 gap 3). Change the
declaration in `help-content.ts`:

```ts
export const HELP_ENTRIES = [ /* …66 entries, unchanged… */ ] as const satisfies readonly HelpEntry[];

export type HelpEntryId = (typeof HELP_ENTRIES)[number]["id"];
```

**This was probed before being specced, not assumed.** A throwaway `src/app/probe-help-id.ts`
declared a two-entry array in exactly this shape — including `primerKey`, `relatedViews` and
`relatedConcepts`, the nested readonly arrays that were the structural risk — derived the union,
assigned a good id and put `@ts-expect-error` on a mistyped one. Result: `npx tsc --noEmit` exit 0,
**0 `src/` errors**, and no TS2578, i.e. the expect-error was consumed, i.e. the union really does
reject `"feature-taskz"`. The probe file was deleted; `git status --porcelain` is empty.

The union benefits the 26 existing `requestHelpConcept` callers too, once their parameter is
retyped from `string`.

★ **Its limit, stated because a green typecheck will otherwise be read as more than it is:** the
union catches a MISTYPED id. It cannot catch a WELL-SPELLED WRONG one — pointing the Budget modal
at `concept-resource` typechecks perfectly. The map below is a human judgement call and must be
reviewed as content, not trusted because it compiles.

### 3.2 `HelpBodyText` — extracted segment renderer

`parseHelpBody` (`help-body-markup.ts`) is already pure and exported. Its RENDERING is not: it is
inline in `help-content-pane.tsx` at two sites — the primer and the body — coupled to the search
`query` through a local `Highlighted` component. The popover has no query. Locate both with
`grep -n "parseHelpBody" src/app/help-content-pane.tsx` rather than a line number, which the next
insertion invalidates.

Extract a small `HelpBodyText({ body, query? })` that maps `parseHelpBody(body)` over segments,
bolding `seg.isLabel`, highlighting only when a query is passed. `help-content-pane.tsx` consumes it
with the query; the popover without. One renderer, so the popover's body cannot drift from the Help
view's — which is the whole reason for extracting rather than re-mapping the segments locally.

### 3.3 `ModalHeader` — the icon and the popover

Two new optional props:

```ts
helpConceptId?: HelpEntryId;
helpTitle?: string;   // the modal's own title, for the accessible name
```

When `helpConceptId` is set, render a `QuestionMarkCircleIcon` button immediately BEFORE the voice
mic (so the trailing `headerExtra` → mic → reset-layout → ✕ order is otherwise untouched), toggling
a popover anchored to it.

Dismissal is the shared primitive, never hand-rolled:

```ts
usePopoverDismiss(open, wrapperRef, () => setOpen(false));
```

which pushes `kind: "layer"` into the shared `dismissal-stack.ts`. Only the layer owning the key
handles Escape (`claimsEscape`), so **Escape closes the popover and leaves the modal open**, and a
second Escape closes the modal. This is the exact case the stack was rebuilt for (§318, CLOSED
2026-09-01) — no new dismissal code, and adding any would be the hand-rolled-control violation.

The popover renders the entry's title (`t(lang, entry.titleKey)`) and `<HelpBodyText body={t(lang,
entry.bodyKey)} />`. No relations map, no search, no primer — those belong to the full Help
surfaces.

### 3.4 `EditModalShell` — passthrough

`EditModalShell` gains the same two props and forwards them to its `ModalHeader`. This is what
carries the seven entity modals; without it they are unreachable, since their `headerExtra` is
occupied by `ModalFieldControls`.

### 3.5 `MODAL_HELP` — the declarations

Sites pass the id at the call site, typed `HelpEntryId`. A modal that declares nothing renders no
icon, which is how confirmations and gates stay clean without an exclusion list:
`confirm-dialog`, `type-to-confirm-dialog`, `secret-unlock-gate`, `project-empty-state` and
`sharepoint-picker-modal` (no matching entry exists) declare nothing.

| Modal | Entry |
|---|---|
| `raid-edit-modal` | `concept-raid` |
| `change-edit-modal` | `concept-change` |
| `milestone-edit-modal` | `concept-milestone` |
| `stakeholder-edit-modal` | `concept-stakeholder` |
| `resource-edit-modal` | `concept-resource` |
| `absence-edit-modal` | `feature-resources` |
| `calendar-event-modal` | `feature-resources` |
| `task-form-modal` | `feature-tasks` |
| `task-linked-task-modal` | `concept-dependency` |
| `task-time-tracking-modal` | `feature-timelog` |
| `budget-bucket-modal` | `concept-budget` |
| `documents-history-modal` | `feature-document-history` |
| `documents-rename-modal` | `feature-documents` |
| `asset-library-modal` | `feature-documents` |
| `asset-preview-modal` | `feature-documents` |
| `jira-conflicts-modal` | `feature-jira` |
| `backend-config-modal` | `feature-storage` |
| `backend-setup-wizard` | `feature-setup-wizard` |
| `turso-project-picker` | `feature-projects` |
| `project-edit-modal` | `feature-projects` |

Twenty declarations. Every id above must be confirmed present in `HELP_ENTRIES` as the plan's first
verification step — the union makes a typo fatal at `tsc`, which is the detector, but the mapping
JUDGEMENT is reviewed by eye per the limit in §3.1.

---

## 4. Accessible naming

The icon's name is built from the modal's own title through one interpolated key:

```
modalHelpAbout: "Help – {0}"     → "Help – Edit risk"
```

(EN dash U+2013, matching the row-token convention.) This gives every instance a distinct name
without a per-modal key, so two stacked modals cannot collide unless their titles do — the same
guarantee `closeLabel` and `hideVoiceCommand` already buy `ModalHeader` for exactly this reason.

★ **The axe gate cannot catch a regression here, in any view, at any seed size.** Of axe-core
4.12.1's rules carrying the four tags `e2e/a11y.spec.ts` requests, none flags two controls sharing
an accessible name. A unit test rendering two stacked modals and asserting distinct names is the
only possible detector, in either layer.

WCAG 2.5.3 (label-in-name) does not apply: the control has no visible text label, only an icon.

DE strings are added to `i18n.de.ts` by a node utf8 write with `\r\n` anchors and real umlauts —
never the Edit tool, which corrupts umlauts and curls double quotes in that file.

---

## 5. Testing

Every guard below is mutation-proved: the mutant is placed, the suite is recorded as
`N failed / M passed` with the sum equal to the file's runtime test count, and reverted by an
anchored inverse Edit with uniqueness asserted in both directions, ending on an empty
`git diff --stat`.

| # | Assertion | Mutant that must turn it red |
|---|---|---|
| 1 | Icon renders when `helpConceptId` is declared | Drop the prop at the call site |
| 2 | Icon is ABSENT when it is not | Render the button unconditionally |
| 3 | Popover shows the entry's own body | Point the render at a different entry's `bodyKey` |
| 4 | Escape closes the popover, modal stays open | Change `usePopoverDismiss`'s kind away from `"layer"` |
| 5 | Two stacked modals get distinct icon names | Replace the interpolated name with a bare `"Help"` |
| 6 | DE renders German, asserted after `loadI18n("de")` | Point the DE key at the EN string |

**Anti-vacuity.** Assertion 2 is a negative and needs a positive observable beside it, or it passes
when the modal never rendered: the same test asserts the header's ✕ IS present. Assertion 5 needs a
collision seed — two modals whose titles genuinely differ, since a fixture with one modal satisfies
a distinctness check trivially.

---

## 6. Constraints

- `src/app/**.ts(x)` and `src/test/**.ts` are CRLF: **Edit tool only, never `sed -i`**, which
  re-lines the whole file to LF invisibly to `git diff`. `docs/**` is LF-only.
- Never read a gate's exit code through a pipe. Redirect, `echo "EXIT=$?"` unpiped, then grep the log.
- Never run two vitest processes at once.
- `size:check` LIMIT is 1600 and counts `split("\n").length`, i.e. `wc -l` PLUS ONE. Current counts
  by that measure: `modal-header.tsx` 130, `edit-modal-chrome.tsx` 276, `help-content.ts` 215,
  `help-body-markup.ts` 56 — ample headroom in all four. Budget from the node one-liner, not `wc -l`.
- Never stage `sample-workspace-huge.json` or `not-in-use.env.local.bak`. Never `git add -A` / `git add .`.
- `src/app/i18n.ts` and `i18n.de.ts` are shared with a peer session — coordinate before editing.
- Gates owed before any MR: `npx tsc --noEmit`, `npx eslint src`, `npm run test:run`,
  `npm run test:shuffle` (this slice adds tests), and axe on the affected views at `--workers=1`.

## 7. What this deliberately does not do

- The 14 bespoke `Modal` sites without `ModalHeader`.
- The two hand-rolled floating windows (`help-menu`, `notes-window`).
- §424 gap 4: `HelpMenu` still takes `{ lang }` and gains no deep-link input, so "open Help at entry
  X" remains possible only via the in-pane Help VIEW.

§424 is therefore updated with a Status line recording what landed and what remains, and stays
**OPEN**. No new follow-up number is minted unless the implementation surfaces a defect.

## 8. Release

Feature slice, so it takes a version bump, a `CHANGELOG.md` entry and `npm run version:sync`
per the release checklist. Nothing is pushed, no MR is opened and nothing is merged without an
explicit instruction from the user.

---

## 9. Amendments

★ **APPEND-ONLY.** Everything above is a dated design record and is NOT edited to match the tree —
rewriting a signed record destroys the only thing it is good for. Deviations are listed here, each
with one line of reason and the date it was recorded.

### 2026-09-09 — deviations from §3.5's table

Three shipped differently before this section existed:

| Spec row | Shipped | Reason |
|---|---|---|
| `resource-edit-modal` → `concept-resource` | `resourceEdit: "feature-resources"` | the concept primer explains what a resource IS; the modal edits one, so the feature entry describing the Resources view is the apter body. |
| `task-form-modal` → `feature-tasks` | `taskForm: "feature-add"` | `feature-add` is the entry that describes adding and editing a task; `feature-tasks` describes the Open Points LIST. |
| `task-time-tracking-modal` → `feature-timelog` | ROW REMOVED (`db5ac5ed`) | `feature-timelog` describes the external Timelog INTEGRATION, implying those figures sync somewhere they do not. No entry mentions estimates at all. A wrong entry is worse than no icon. |

Two more on 2026-09-09:

| Spec row | Shipped | Reason |
|---|---|---|
| `calendar-event-modal` → `feature-resources` | ROW REMOVED | that entry enumerates the Calendar sub-tab as "tasks, absences, and holidays"; the modal edits recurring MEETING SERIES, so the entry named three things that are not what is being edited. Measured over all 66 entries' titles + bodies: `/series/i` matches zero. Same criterion as `taskTimeTracking`. |
| — (not in the table) | `aiSettings: "feature-ai"` ADDED | `BackendConfigModal`'s `children` prop lets the empty state replace its whole body with `AiSection`. That instance had been suppressing the icon with a `hideHelp` flag on the stated grounds that no entry described the AI settings — false: `/anthropic\|api key/i` matches `feature-ai` and `feature-ai-advanced`, and `feature-ai`'s body opens "Add an Anthropic API key in Settings → AI, …". Repointed, and the flag deleted. |

Net: **19** `MODAL_HELP` rows, **20** call sites, **19** distinct keys wired. The table above still
reads as twenty declarations; it is the 2026-09-09 record, not a census.

★★ The two body-scoped counts above (`/series/i` → 0, `/anthropic\|api key/i` → 2) came from a node
probe that parsed every `bodyKey` out of `help-content.ts`, resolved each against `i18n.ts`, and
**asserted 66/66 resolved before reading a single term**. That assertion is the guard, and
`docs/open-followups.md` §453 records why: the obvious line-anchored shell form resolves only 35 of
66 bodies and undercounts every term. Rebuild the probe rather than reaching for a one-liner.

### 2026-09-09 — §3.5's "one call site per key" no longer holds

`backend-config-modal` now takes a REQUIRED `helpConceptId` rather than hardcoding
`MODAL_HELP.backendConfig`, so its three consumers each pass a literal — two `backendConfig`, one
`aiSettings`. The wiring test in `help-content.test.ts` was rewritten accordingly: set equality both
directions, plus a `MULTI_SITE_KEYS` allowlist that must itself be justified AND is asserted to
contain only keys that genuinely have more than one site.

### 2026-09-09 — §3.3's dismissal paragraph is superseded

§3.3 specified `usePopoverDismiss(open, wrapperRef, …)` and an inline anchored panel. That panel was
`absolute right-0 top-full z-20` inside a `relative` wrapper, and **every** declaring modal's panel
is `overflow-hidden` (`edit-modal-chrome.tsx` serves seven, `documents-rename-modal.tsx` and
`task-linked-task-modal.tsx` one each) — z-index cannot escape overflow, so it clipped at the panel
edge. It now renders through the shared `PopoverPanel`, which portals to `document.body`; that is
still "the shared primitive, never hand-rolled", just a different one.

★★ §3.3's Escape claim survives the swap and its `kind` claim does not, which matters because they
read as one sentence there. `escapeOwner()` is kind-AGNOSTIC, so Escape still closes the popover and
leaves the modal open. But `PopoverPanel` pushes `kind: "modal"` — which MEANS "traps Tab" — so
`modal.tsx` stands its own Tab trap down, and the primitive's cycle returns WITHOUT trapping when
the panel holds no focusables. Measured with a probe over a text-only panel: focus reached
`document.body` on the 4th Tab and a button rendered outside the modal on the 5th (WCAG 2.4.3). The
popover therefore gained its own close button, which is load-bearing for containment as well as
being a second dismissal affordance; `modal-header.test.tsx` pins it.

### 2026-09-09 — still owed

Eye-verification in a browser that the popover no longer clips, on
`documents-rename-modal` (w-420) and `task-linked-task-modal` (w-440), the two shortest panels.
jsdom has no layout and axe does not evaluate clipping, so no test in this repo can see it.
