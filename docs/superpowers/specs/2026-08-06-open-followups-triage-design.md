# Triage of `docs/open-followups.md` — ranked plan across future slices

**Date:** 2026-08-06 · **Against:** `main` `aa681711`, app 0.215.0 "Friedman"
**Register state at triage:** 77 numbered entries — **57 open**, 20 closed.

## What this document is

A ranking of every open entry in `docs/open-followups.md`, ordered by **user-visible harm**, with
entries grouped into shippable slices where they share a subsystem and a test surface.

**This is triage only.** No code changes, no register edits. The register stays the source of truth
for each entry's detail; this document orders them and says why.

★ This spec lives under `docs/superpowers/`, which is gitignored — the same invisibility §44 records
for the UX-roadmap slices. Enough detail is reproduced inline that the ranking survives without the
register open, but the register is authoritative on every fact cited here.

## Method

### Ranking axis

**User-visible harm first**, in this order:

| Tier | Test | Why this rank |
|---|---|---|
| **T1** | Corrupts or destroys stored data, silently and persistently | User loses work or carries poisoned data forever; no reload fixes it |
| **T2** | Shows a PM a wrong number or wrong state | Decisions are made on it; the data is fine, the readout lies |
| **T3** | Blocks or degrades actual use — invisible text, dead keyboard path, prod-only broken rendering | User can see something is wrong and cannot proceed cleanly |
| **V** | Verification debt — the passes and gates that would have *caught* T1–T3 | Ranked by the harm it lets through, not by its own |
| **T4** | Invisible to users — internals, perf, dead code, unbounded-but-unreached | Costs contributors, not users |

**V outranks T4 and interleaves with T3.** This is not a euphemism for "low". §59 makes the argument
itself: three consecutive releases owe eye verification (§21 · 0.209.0, §41 · 0.211.0, §59 · 0.212.0)
and none has been discharged. §40's forty invisible-in-dark sites are exactly what an eye pass catches
and no automated gate does — axe reported 85/85 green while `text-ui-dark-blue` sat at 1.10:1.

### Grouping rule

Harm decides **order**; sliceability decides **batch**. An entry is merged into a slice with its
neighbours when they share a subsystem, a predicate, or a test surface — shipping §66 alone would be a
one-tile MR that leaves its own twin (§64) open.

### Not ranked — parked by a decision already in the register

Re-ranking these relitigates a call the register has already made. Listed so the register-wide picture
stays complete.

| Entry | Why it is out |
|---|---|
| §70 budget Total follows the role filter | "Recorded, deliberately NOT changed" — a total of what you are looking at is the defensible reading |
| §79 lane engine resolves by name, backfill prefers email | Self-healing on reload; the asymmetry is deliberate |
| §83 email beats name in the FK backfill | Documented precedence, very low frequency |
| §53 ESLint 10 | Blocked upstream by `eslint-plugin-react`; **re-measure** (`npm view eslint-plugin-react peerDependencies`) before acting — the entry is a dated measurement, not a property |
| §4 two-tab last-writer clobber (file/IDB) | Parked, needs its own design — locking model *and* conflict UX are both real decisions |
| §5 no list virtualization | Parked, own batch — collides with print, deep-link row flash, column resize and the axe scan |
| §3 `optimize_wbs` · §44 S6 + S7 | Feature work owed, not defects |

---

## Tier 1 — corrupts or destroys stored data

Six entries, five slices, ordered by frequency × permanence.

### T1.1 — Snapshot baseline poisoning (§78 + §77) · Turso-gated

§78 fires on **every new Turso project**. `createTursoProject` (`use-storage-turso-ops.ts`) calls
`applyWorkspace(ws)` with a fresh empty workspace and `setTursoProjectId(id)` in the same batch.
`workspaceReady` is legitimately `true` — a workspace *was* applied, there is just nothing in it — so
the capture effect re-fires on the changed `projectId`, finds `history.length === 0`, and takes the
`isFirstEver` branch in `use-snapshots.ts`: a row with null `remainingHours` / `remainingCost` / `spi`
/ `cpi` and **`isBaseline: true`**. `hasCurrent` then claims that cadence bucket permanently. Create a
project Monday, populate it Tuesday, and the week is stuck at the empty capture — and because the
empty row is the *baseline*, every later variance row compares against nulls forever.

§77 is the same latch from the other side. `use-storage-backend.ts` publishes `workspaceLoaded`, set
`true` at the end of `applyWorkspace` and **never set back to `false`**. `backend` is memoized on
`settings.storageConfig` and the load effect keys on `[backend, hydrated]`, so pointing Settings at a
different backend mid-session re-runs the load with `workspaceLoaded` still `true`. If the switch also
makes `tursoConfig` non-null, `trendsActive` flips, the capture effect re-fires, and it captures the
**old** project's tasks and budgets into the **new** project's bucket.

**Why first in T1:** highest frequency of anything in the tier (every new Turso project), permanent,
and invisible until someone reads a Trends chart. One slice — both live in the same capture gate.

### T1.2 — `HTML_START` classifies plain text as HTML, and the text is then deleted (§32)

`narrative-html.ts:60` — `/^\s*<(p|br|strong|em|ul|ol|li|a)\b[^>]*>/i`. `\b` matches on a following
**space**, so a plain sentence merely opening with one of those eight words in angle brackets is
classified as HTML and passed through verbatim; the `TAG` pass then deletes the pseudo-tag along with
its words.

| stored | renders / exports as |
|---|---|
| `<a note about pricing> is attached` | `is attached` |
| `<em dash> means something` | `means something` |

Total, silent destruction of what the user typed. Pre-existing; 0.210.0 extended reach to the AI write
boundaries, so a model-supplied value hits it too. Small fix, no design pass needed — a candidate to
ride along with a larger slice.

### T1.3 — Undo of a bulk edit reverts write-through fields (§50)

`undo-stack.ts:89` restores an edit-image with `out[findIndex(...)] = item` — a **whole-row replace**
against the before-image captured at bulk-apply time. Select 3 RAID rows → bulk-set severity → open the
notes window on one → add a note → Ctrl+Z. The note is gone.

**Below T1.1 because redo brings it back** — the forward image is not a snapshot taken at capture time,
it is built from the live array at undo time (`use-undo-stack.ts:199`, `undo-stack.ts:185`). The entry
corrected itself on exactly this point. Shared engine, so tasks are likely affected too; AGENTS.md
flags that as unverified.

### T1.4 — Codec load paths never DOMPurify a rich field (§28) · design pass

`9e284c68` closed the two whole-object cast load paths — `jsonToWorkspace` (file JSON, SharePoint,
local file) and the IndexedDB read. The **codec** paths were not closed and **cannot be by the same
mechanism**: CSV, Markdown and Turso decoders run under bare node in the sample generator and fixture
flow, and DOMPurify binds `window` at module-eval. A new boundary is needed, not a patched one.

Severity is threat-model-conditional — it needs attacker-influenced text (an AI proposal off an
uploaded PDF or Confluence page, a Jira import) round-tripped through a non-JSON backend. Ranked here
for the class; size it as a design pass, not a patch.

### T1.5 — Storage caps family (§37 + §31 + §22)

- **§37** — `RaidItem` is capped on **no save or load path, ever**. `sanitizeRaidItem` looks like the
  storage boundary and is on neither; its only non-AI caller is `applyRaidFromTask`.
- **§31** — `sanitizeRichText` caps **visible text** (`htmlTextLength`), and `descriptionHtml` passes
  HTML-shaped input through verbatim, so markup bytes are unbounded on all four rich entities.
- **§22** — `clipText` (`sanitize-core.ts:52-55`) slices UTF-16 **code units**, so an over-cap value
  ending on an astral character keeps a lone surrogate — which survives JSON/IDB and becomes `U+FFFD`
  on CSV/MD. A backend-dependent corruption, at ~49 plain-text call sites.

No corruption in flight today; one paste of a large blob and there is.

---

## Tier 2 — shows a PM a wrong number or wrong state

Five entries, three slices.

### T2.1 — Cancelled-work leftovers (§64 + §66 + §65) · the largest readout defect open

The 0.213.0 batch fixed the Reports headline tiles, the Dashboard completion tile, the at-a-glance KPI
card, the completion-trend sparkline and the Open Points status glyph — then stopped at the branch
boundary.

**§64** carries the surfaces left out. ★ It **deliberately states no count** — the count was wrong in
three of the four revisions it survived, so this slice starts by re-deriving the list from the code
rather than trusting a number in the heading.

**§66** is the sharpest single instance: `computeGroupHealth` (`health.ts`) tallies `computeTaskHealth`
per task, which returns `"G"` for anything `isTaskFinished` — Cancelled included. So one Dashboard
Progress card renders "No active scope / All cancelled (2)" beside "R 0 · A 0 · G 2". The batch's own
premise, violated one tile from where it was applied; the only disclosure is a `text-xs` caption.

**§65** is a glyph/tooltip split. The muted ✕ is the **correct** half and is pinned by a test — a
`"Done"` task with no `completedDate` is closed but not delivered. The stale half is the tooltip:
`computeTaskHealth` derives drivers from `status` (`health.ts:62-66`), so the accessible name still
reads "completed".

**One slice:** same predicate split (`isTaskClosed` vs `isTaskDelivered`), same 11-module blast
radius, same test surface.

### T2.2 — "Suggest RACI" reports the wrong reason (§43)

(a) An Accountable **handover** inside one proposal is silently refused. Demote the current A to R and
promote someone else on the same milestone, and `groundRaciCells` (`raci-suggest/raci-suggest.ts`)
still holds the old id in `accountableHolder` when it examines the second cell, so the promotion is
skipped as `duplicate-accountable`. Conservative and safe — it can never mint a second Accountable —
but it discards a natural proposal and reports it as a conflict, which is the wrong explanation. Fix
means processing a milestone's cells as a **set** rather than a stream.

(b) The no-op count never reaches the modal, so the user is not told what was already in place.

Both are **incomplete rather than wrong**, which is why they sit below T2.1.

### T2.3 — `list_allocations` answers narrow questions partially (§12)

The tool takes no arguments at all — `input_schema: { type: "object", properties: {} }`
(`chat-tool-defs.ts:368-372`) — and returns the whole planning grid. `MAX_ALLOC_CELLS = 200`
(`alloc-plan/alloc-plan.ts:40`) truncates it, and each resource carries a `truncated` flag whose whole
purpose is to tell the model "treat this resource's load as UNKNOWN, not zero". On a real portfolio
(`ALLOC_CONTEXT_MAX_RESOURCES` is 120, a 104-week window is normal) a narrow question gets a partial
answer plus a disclaimer.

Lowest in T2 because the degradation is **honest** — the tool says it is partial. Fix is a scoped
query: `resourceIds?`, `periodFrom?` / `periodTo?`, possibly `minPercent?`.

---

## Tier 3 — blocks or degrades actual use

Fourteen entries, seven slices.

### T3.1 — Prod-only CSP blocks ProseMirror's base CSS (§54)

Every rich-text editor in a **production build** renders without ProseMirror's base stylesheet: the
prod CSP refuses the `<style>` element Tiptap injects at runtime. Dev is unaffected, which is why it
has gone unseen. Pre-existing and user-visible.

★ Measured on `main` (`13b518db`) in an isolated worktree on 2026-08-03. Same dated-measurement rule as
§53 — **re-measure before acting**. Two fix options are recorded in the entry; neither was chosen.

Top of T3: every user, every rich field, in the shipped artifact only.

### T3.2 — `text-ui-dark-blue` with no mode-appropriate companion, 40 sites (§40)

`--ui-dark-blue` is a near-black navy in all three dark scheme maps, so as text on `--surface` it
measures roughly **1.10:1 (harbor) / 1.17:1 (meridian) / 1.31:1 (umber)** — not "low contrast",
effectively invisible. On `--surface-muted`: **1.01 / 1.04 / 1.17**.

★ The entry's own history is the argument for slicing it whole rather than patching what review
surfaces. It opened listing three sites and implied that was the remainder; a sweep found 26 in the
token class plus 13 in the widened class, and a later audit added a 27th the sweep had missed — 40. The
four groups (A base text · B `hover:` with no `dark:hover:` · C icons · D widened `text-ui-purple`)
have different fixes.

### T3.3 — Pressed state invisible in dark (§56 + §55)

**§56** — `ToggleButton`'s own pressed-vs-unpressed border, computed from `builtin-schemes.ts`:
8.97 / 7.71 / 9.30:1 on the three light schemes, **1.22 / 1.16 / 1.03:1** on the three dark ones. The
primitive that carries the non-colour marker still fails the colour channel in dark.

**§55** — fourteen hand-rolled `aria-pressed` toggles never adopted the primitive. ★ **Two of the
fourteen are not colour-only**, and an earlier revision of that entry said flatly that all were:
`voice-button.tsx:113` adds `animate-pulse` plus a flipping `title`; `dictation-mic.tsx:73` is
colour-only in the button, but the hook returns a `status` node rendering visible "Listening…/
Transcribing…" text, so the 13 callers that render it are covered and the two that destructure without
it (`note-log-panel.tsx:68,181`) are not. **Check the caller, not the grep hit.**

One slice: same cue, same primitive, same axe blind spot (axe 4.12.1's only `wcag141` rule is
`link-in-text-block` — nothing evaluates whether a control's state is colour-only).

### T3.4 — Export fidelity (§30 + §24 + §33)

- **§30** — `sanitizeNoteHtml` allows `<a href>`, but the export projection ends in `htmlToText`, which
  is `DOMPurify.sanitize(html, {ALLOWED_TAGS: [], ALLOWED_ATTR: []})` — the anchor's text survives, the
  `href` is dropped. `Spec: the spec` in PDF, DOCX, XLSX and PPTX, address unrecoverable from the file.
  A regression for Tasks specifically (0.210.0 routed `Task.description` through the projection);
  pre-existing for RAID / change / milestone. Fix touches four renderers.
- **§24** — the named-entity tail. `htmlPlainProjection` decodes a deliberately small named set;
  everything outside it stays literal and is mis-measured, so `<p>a&mdash;b</p>` capped at 4 yields
  `a&md`.
- **§33** — `pptxTextBox`'s `cyEmu` is fixed and `export-pptx.ts:213` sets `<a:bodyPr wrap="square">`
  with no `normAutofit`/`spAutoFit`, so a four-paragraph description pushes later fields past the bottom
  of the box. Cosmetic and the cheapest of the three; the adjacent "cap at 6 extra fields so the text
  fits" comment is now false.

### T3.5 — Announcement and keyboard gaps (§8 + §42 + §9)

- **§8** — `tour-overlay.tsx` sets `role="dialog"` + `aria-modal="true"` (`:96-97`) and imports
  `useDismissable` and nothing else; there is no `useFocusTrap` import and never has been. Shift+Tab
  from the first button walks into the app behind the dimmed backdrop. A **standing gap, not a
  regression** — 0.203.0 tagged it `kind: "layer"` deliberately, because `kind` means "traps Tab" and
  tagging a trap-less surface `modal` had been stealing `isTopmostOfKind(…, "modal")` from real modals.
- **§42** — `CalendarSyncControls`' enable checkbox is qualified per entity; the Push and Pull buttons
  beside it are the bare `calendarPush` / `calendarPull`. In the classic layout `TasksSection` and
  `WorkspaceSection` mount simultaneously, so two identically-named "Push to Outlook" buttons can be on
  screen at once — WCAG 2.4.6. Verified pre-existing on `origin/main`.
- **§9** — the four raw-`<th>` tables disagree two ways: `change-panel.tsx`, `raid-panel-rows.tsx` and
  `stakeholders-panel.tsx` set `aria-sort` **and** keep a ▲/▼ inside the button's accessible name
  (double announcement); `activity-log-panel.tsx` has the glyph with no `aria-sort` at all.

### T3.6 — File-input pattern (§46 + §47)

**§46** — a `focus:ring-2` on a `<label>` compiles to `&:focus` and can never match, because a label is
not a form control and carried no `tabindex`. The element that actually took focus was the `sr-only`
`<input type="file">` inside — genuinely tabbable, nothing gave it `tabIndex={-1}` — and `sr-only`
clips it to a 1×1px `inset(50%)` box, which clips the UA's own default focus ring with it. The keyboard
user sees **nothing**.

**§47** — `chat-panel.tsx` gives its attachment input `className="hidden"` (`display:none`) and opens it
via `fileInputRef.current?.click()` — exactly what §15 warns against, since both theme pickers used
`sr-only` *precisely because* a `display:none` input cannot be clicked in every browser.

Both fold onto `FilePickerButton`; the chat case needs a `multiple` prop, and its multi-file
classification and size caps (`chat-attachments.ts`) make it the larger read.

### T3.7 — Missing feedback (§10 + §16)

**§10** — Alt+Left/Right arms a move and accumulates a day delta; Enter commits it as one
`onMoveOccurrence` (one undo entry per intent); Escape cancels. Nothing renders the pending state —
`pendingMove`'s last reference is line 399 and the JSX begins at 431 — and `onMoveModeChange` emits only
`"armed" | "cancelled" | null`, so the live region says a constant string and three Alt+Rights announce
identically to one. Both `resource-calendar-band.tsx` and `resource-calendar.tsx`.

**§16** — `appendDictationToHtml` round-trips the field through plain text because Web Speech fires
`onFinal` **multiple times per hold** and each segment must join the previous one. That round-trip is
what makes append work *and* what discards bold, italics, lists and links. Needs per-utterance segment
tracking — keep the appended run as its own tracked node. ★ Do **not** "fix" it by dropping the
round-trip.

---

## Tier V — verification debt

### V.1 — Eye verification owed on three consecutive releases (§59 + §41 + §21)

0.209.0 (§21), 0.211.0 (§41), 0.212.0 (§59). §59 states the finding plainly: the eye-verify step is
**not happening**, and filing a fourth entry after the next release would confirm that rather than fix
it.

Top of V because it is the pass that catches T3.2's entire class. Surfaces outside `A11Y_VIEWS`
altogether have never been scanned by anything — the RACI matrix and the Suggest-RACI modal (`raci` is
a child view of `stakeholders` and appears nowhere in the spec), the Resources → Calendar sub-tab,
Projects and Knowledge.

Discharge it as one pass over the accumulated list, not as three.

### V.2 — Two flakes that leave `main` red (§39 + §51)

**§39** — eight CI failures, always the same assertion, always with the rest of the suite green and the
full suite passing locally. ★★★ **The worker-starvation diagnosis is disproved.** It justified raising
that assertion's budget from the global 5 s to an explicit 15 s (!335), and the failure recurred with
that mitigation in place — three failures have now consumed the full budget (15,093 / 15,098 /
15,117 ms). Mechanism is a **candidate**: precondition proved, causation unreproduced; the fix landed.

**§51** — `use-tasks-dedup` "on confirm". Narrower: the recorded symptom cannot recur after the matcher
fix (`findByRole(/merge selected/i)`), the mechanism is unestablished. The same tree passed on pipeline
#5417 minutes before #5418 failed, so it is environment-sensitive, not a code regression.

Grouped because they failed in the same `unit-tests` job on the same pipeline (#5418), and because the
cost is shared: a red `main` after merge.

### V.3 — Security audit is scope-stale (§13)

`docs/security/findings-2026-07.md` is dated 2026-07-02, scope "v0.164 Cixin". The conclusions still
hold for what it looked at — 0 CRITICAL, 0 HIGH, every proxy and secrets check PASS — but it has never
looked at anything shipped since.

★ The gap that matters: **`/api/stt` was never audited and is the app's weakest proxy by design.** Every
other proxy pins a vendor apex (`*.atlassian.net`, `*.timelog.com`); this one cannot, because the base
URL is user-supplied BYO (`_helpers.ts:56-57` says so in a comment). It compensates with `isPrivateHost`
(`:71`), https-only (`:68`), `redirect: "manual"` (`:95`) and a 25 MB cap — a sound design, and "sound
by reading" is exactly what an audit exists to replace.

### V.4 — Guards nothing exercises (§57 + §60)

**§57** — `tasks-section.tsx` and the three writers in `use-calendar-integrations.ts` each read the raw
stored `auto` when switching a row on. Every fixture stubs `auto: false`, so deleting the
`enabled ? … : false` wrapper at any of the four sites leaves the whole suite green. Since 0.212.0
`sanitizeOutlookCalendar` masks `auto` by `enabled` at load — that is the real defence and it **is**
tested — so these are belt-and-braces, which is precisely why nobody would notice removing them.
Removing both layers would arm unattended two-way Outlook sync from one click on an imported settings
blob.

**§60** — `scripts/check-file-sizes.mjs` opens its comparison loop with `if (n <= LIMIT) continue;` and
`LIMIT` is 800, so a baseline entry is never consulted for a file at or under 800 lines. The ratchet
only caps how far an already-oversized file may grow. Consequence: with any entry ≤ 800 or with none,
the first size the gate rejects is 801 — it could fire **243 lines late** on the file §2 just split.

---

## Tier 4 — invisible to users

Ranked but not sliced. **Fold opportunistically** into whichever slice already touches the file; none
justifies its own MR.

| Entry | One line | Fold into |
|---|---|---|
| §67 | A committed NUL byte at offset 2940 makes `use-portfolio-health.ts` read as **binary** to grep — it already cost a reviewer during the §64 work, on a file holding `completionPercent`. One byte; pick the replacement deliberately | **T2.1** |
| §69 | `BrandingConfig`'s "is this blob empty?" is answered in two independent field lists (`sanitizeBranding` + `AppearanceSection`'s `cleaned`); it already bit on the first addition (`branding.startLogo`) | any branding work |
| §68 | The budget allocation rows' `border-t` sits on the `<tr>`, ignored under `border-collapse: separate` (`globals.css:125`), so it has never painted | any budget-panel work |
| §71 | `cellBudget` — the panel's most expensive call — is evaluated **3×** per (row, period); two of the three pre-date the Total-column work | any budget-panel work |
| §1 | Two dead `memo()`s in the Resources subtree — `makeEditGuard` is called unmemoized during render, so ~25 of 47 props are fresh identities. **Fork open**: stabilise every handler (measure first) or delete the memo | own decision |
| §62 | `handleAssignResourceRole` / `handleClearResourceRole` are reachable only from tests; pre-existing, carried across verbatim by the move-only split | §61 |
| §61 | Three residuals from the `use-resource-planner` split — a warning naming the wrong hook, a doc comment naming one of two consumers, plus a pointer | with §62 |
| §52 | `useColumnResize` v1→v2 pins defaults for existing users; ★ the premise that made the conservative choice look cheap is false — the pre-v2 persist effect had no first-run guard, so a v1 blob is a defaults snapshot, not a record of drags | own decision |
| §82 | The task-FK backfill runs from `applyWorkspace`, outside the numbered migration chain — correct for reach, but it is a permanent re-normalisation, so "this task names a person who is deliberately not that directory row" is inexpressible | with §79/§83 if ever taken |
| §7 | Four surviving dedup seams of nine from the 2026-06 review; source doc deleted but recoverable via `git show` | opportunistic |
| §6 | Undo residuals — (a) project delete has no undo and needs its own soft-delete design, (c) no cross-reload undo by design, (d) retention is `UNDO_CAP` | (a) own design |
| §38 | `ALLOWED_URI_REGEXP`, not the attribute lists, strips `target` and `rel` from every stored link — isolated on dompurify 3.4.12 | T3.4 |
| §35 | `sanitizeAiRichText`'s double pass double-escapes one exotic shape; **reachability is a suspicion**, needs a hyphenated element whose name starts with p/br/strong/em/ul/ol/li/a plus an entity in the body | T1.5 |
| §36 | Template import upgrades but never allow-lists — and **cannot**, the file is in the sample generator's import graph. Low risk because **no template import channel exists** | T1.4 |

---

## Recommended execution order

Harm order, adjusted so that cheap fixes ride along with the slice that already opens their files, and
so that verification lands before the work it validates.

| # | Slice | Entries | Note |
|---|---|---|---|
| 1 | Snapshot baseline poisoning | §78 · §77 | Permanent, fires on every new Turso project |
| 2 | Cancelled-work leftovers | §64 · §66 · §65 (+ §67) | Re-derive §64's list; do not trust a count |
| 3 | `HTML_START` misclassification | §32 | Small; can ride slice 2 or stand alone |
| 4 | Prod-only CSP / ProseMirror | §54 | **Re-measure first**; choose between the two recorded options |
| 5 | Eye verification, all three releases | §59 · §41 · §21 | One pass, not three — and it validates 6 and 7 |
| 6 | Dark-blue contrast sweep | §40 | Scope all four groups before touching one |
| 7 | Pressed-state cue | §56 · §55 | Check the caller, not the grep hit |
| 8 | Bulk-undo write-through | §50 | Verify the tasks case AGENTS.md flags as unknown |
| 9 | CI red-main flakes | §39 · §51 | Mechanism work, not more budget |
| 10 | Codec sanitize boundary | §28 (+ §36) | Design pass — the DOM-free constraint is the whole problem |
| 11 | Storage caps family | §37 · §31 · §22 (+ §35) | |
| 12 | Export fidelity | §30 · §24 · §33 (+ §38) | Four renderers |
| 13 | Announcement + keyboard gaps | §8 · §42 · §9 | |
| 14 | File-input pattern | §46 · §47 | `FilePickerButton` needs `multiple` |
| 15 | Security audit refresh | §13 | `/api/stt` is the reason |
| 16 | RACI reporting | §43 | |
| 17 | Scoped `list_allocations` | §12 | |
| 18 | Move preview + dictation | §10 · §16 | |
| 19 | Untested guards | §57 · §60 | |
| 20 | T4 | — | Opportunistic only |

Slices 1–5 are the ones worth committing to now. Everything from 6 down should be re-read against the
code before it is planned — the register's own rule is that a claim decays, and several of these
entries carry dated measurements rather than properties.

---

## Execution constraints for any slice taken from this plan

**Test-run budget — the full suite is slow, so run it rarely and deliberately.**

- Iterate with **targeted files**: `npx vitest run src/app/<file>.test.tsx`. Not the full suite.
- Run the full `npm run test:run` **once**, before push.
- Run `npm run test:shuffle` **once**, and only if the slice added or reordered tests — it is the only
  local reproduction of the blocking `unit-tests-shuffled` gate.
- **Never two vitest processes at once.** Machine saturation is the load condition behind §39/§51; a
  second concurrent run manufactures the exact flake class this plan is trying to diagnose.
- Targeted axe only: `npx playwright test e2e/a11y.spec.ts --project=chromium -g "<View>"` (~16 s), not
  the 85-scan matrix. After any `globals.css` `@theme` edit, use a **fresh isolated server**
  (`PORT=3100 npm run dev`) — `reuseExistingServer` will attach to a stale `:3000`.
- **Never read a gate's exit code through a pipe.** Redirect, `echo "EXIT=$?"`, then grep the file.

**Register discipline.** Any slice that closes an entry updates `docs/open-followups.md` in the same
commit — strike the heading, move it to the provenance table, and correct anything it disproves. The
register's standing rule applies to this document too: before relying on a specific claim cited here —
a path, a count, a call site, "X is guarded" — **grep it**.
