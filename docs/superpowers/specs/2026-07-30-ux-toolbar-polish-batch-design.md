# UX toolbar-polish batch — design

Date: 2026-07-30
Status: approved, ready for planning

A batch of 18 UI corrections across toolbars, settings, the Open Points table
and the task editor, plus one new AI feature (Suggest RACI). One item from the
original
request — rich text on `Task.blockers` — is deliberately **deferred to its own
slice**; see "Deferred" at the end.

Target release: the next minor after 0.210.x. Pick the codename at release
time and grep `CHANGELOG.md` first — codenames are unique.

---

## Scope

Nineteen items in six groups. Groups A–D are corrections to existing surfaces;
E is dictation; F is the only new feature.

| Group | Items |
|---|---|
| A · Shared primitives | print button, calendar sync controls, tooltips |
| B · Toolbars | directory, workload, planning, calendar, knowledge, timelog |
| C · Settings | theme gallery, general |
| D · Open Points and its editor | column widths, actions column, filter toggles, toolbar order, editor extras |
| E · Dictation | note log, AI assistant button geometry |
| F · Suggest RACI | new AI feature |

---

## A · Shared primitives

These ripple across many panes, so they land first.

### A1 — Print button is icon-only everywhere

`PrintButton` (`task-manager-ui.tsx`) drops its `iconOnly` prop and always
renders the printer glyph alone. `aria-label` and `title` keep `printHint`, so
the accessible name does not change and existing `getByRole("button", { name:
printHint })` assertions still resolve — the visible "Print" text was never the
accessible name.

Two call sites currently pass `iconOnly` (`tasks-section.tsx`,
`dashboard-panel.tsx`); both lose the prop. The other seven call sites are
unchanged.

The `print` i18n key stays — it is used elsewhere.

### A2 — Push / Pull get icons and short labels

In `calendar-sync-controls.tsx`:

- The enable checkbox gains `title={t(lang, "calendarSyncEnableHint")}` — a new
  EN/DE key explaining what enabling does.
- Push keeps `ArrowUpTrayIcon`. Pull gains `ArrowDownTrayIcon`.
- Visible labels become new keys `calendarPushShort` ("Push" / "Push") and
  `calendarPullShort` ("Pull" / "Abrufen"). `aria-label` and `title` keep the
  existing descriptive `calendarPush` / `calendarPull` ("Push to Outlook" /
  "Pull from Outlook").

WCAG 2.5.3 holds: the accessible name contains the visible label.

**Pre-existing bug fixed while here.** While busy, the visible label is
"Pushing…" but the accessible name stays "Push to Outlook" — the name does not
contain the visible label, a real 2.5.3 break in today's code. The `aria-label`
and `title` switch to the busy string whenever `calendarPushBusy` /
`calendarPullBusy` is set.

### A3 — The same treatment at the sites that bypass the shared control

`CalendarSyncControls` is the only shared render site, but two panes hand-roll
their own push/pull pair:

- `tasks-section.tsx` — task push/pull, plus its own enable checkbox which also
  gains the tooltip.
- `milestones-panel.tsx` — manual-only push/pull, no enable checkbox, so no
  tooltip there.

Tooltip also goes on the remaining enable checkbox in
`settings-sections/integrations-section.tsx`.

Four tooltip sites in total: `calendar-sync-controls.tsx`,
`tasks-section.tsx`, `integrations-section.tsx`, and the per-entity rows in
`integrations-section.tsx`'s `CalendarSyncEntityRow` helper.

---

## B · Toolbars

### B1 — Directory

"Pull contacts" (`outlookImportButton`) gains `ArrowDownTrayIcon`, matching the
Pull verb elsewhere. The hide-external `ToggleButton` gains `EyeSlashIcon` via
the primitive's existing `icon` prop.

### B2 — Workload and Planning share one hide-external control

`resources-panel.tsx` builds `hideExternalToggle` once and mounts it in both
the Planning toolbar and the Workload header. It becomes a `ToggleButton` with
`EyeSlashIcon`, matching Directory. Both surfaces change together — that is
intended, not a side effect.

Label stays `planningHideExternal`. It already names what pressed=true
*enables*, so `aria-pressed` remains coherent under WCAG 4.1.2.

### B3 — Calendar: Add meeting moves left

"+ Add meeting" currently sits inside `headerActions`, which renders right.
It moves out of `headerActions` and renders to the **left** of
`CalendarToolbar`'s controls, restyled as the shared `AddButton` — the same
primary control Open Points uses for "+ Add task".

`headerActions` keeps Print and the resets, and the add button's
`view === "calendar" && !isPopout && onAddCalendarEvent` gate is preserved
verbatim.

### B4 — Planning: Plan with AI moves left

In `resources-panel-toolbar.tsx`, `aiPlanButton` moves from after
`hideExternalToggle` to the **first** position in the control row, ahead of the
plan-window date fields.

### B5 — Knowledge toolbar

Three problems, one fix:

1. The toolbar row lives *inside* the `overflow-auto` scroller, so it scrolls
   away. Hoist it out, above the scroller.
2. Print and Reset-size sit at the end of a plain flex row rather than being
   pushed right. The trailing group gets `ml-auto`.
3. The toolbar renders only in the non-empty branch, so an empty Knowledge view
   has no Print or Reset-size at all. Render the toolbar in both branches; the
   `AddFirstItemButton` dashed box stays as the empty body beneath it.

The Add control is already the shared `AddButton` — same primitive as Open
Points — so no restyle is needed, only placement.

### B6 — Timelog apply-confirm list grows to fit

`timelog-apply-confirm.tsx` caps the diff list at `max-h-[50vh]`, so a
three-row diff still renders a scroller. Replace with a row-count cap:

- Introduce `MAX_VISIBLE_ROWS = 25`.
- The `<ul>` grows to content when `rows.length <= MAX_VISIBLE_ROWS`.
- Past that it caps at a 25-row height and scrolls.

The list is `text-xs` (1rem line height), so 25 rows is roughly `25rem` —
tighter than the old 50vh on most screens. That preserves the reason the cap
exists: this card gates a financial write into `actualHours`, and Apply/Cancel
must never be pushed out of reach by a long diff. Keep that comment.

---

## C · Settings

### C1 — Theme gallery: two-up cards, no Apply

`theme-gallery.tsx`:

- The `<ul>` becomes `grid grid-cols-1 gap-2 sm:grid-cols-2` — two themes per
  row, each half width.
- Each card renders the scheme name plus Remove. The Apply button and the
  "Active" label are removed.

Applying a theme is the AppearanceSection scheme `<select>`, which already
routes every id through `selectScheme`. Apply on the card was a second path to
the same action.

Consequences to carry through in the same commit:

- `onApply` and `activeId` become unused props → remove from
  `ThemeGalleryProps` **and** from the AppearanceSection call site. Lint runs
  `--max-warnings=0`, so an unused import or param is fatal.
- `themeGalleryApply` and `themeGalleryActive` become orphaned i18n keys →
  delete from `i18n.ts` **and** `i18n.de.ts`. Key parity is tsc-enforced, so
  deleting from one alone fails the typecheck.
- `i18n.de.ts` is CRLF and umlaut-fragile: patch it with a node utf8 write, not
  the Edit tool, and grep-verify afterwards.

### C2 — General: remove the Project block

`settings-sections/general-section.tsx` loses the entire Project block: the
heading, the `<dl>` of project metadata, the edit button, the `projectOpen`
state and the `ProjectEditModal` mount.

Project metadata stays editable in the Projects panel, which opens the same
modal — this removes a duplicate entry point, not a capability.

Consequences:

- `project`, `stakeholderNames`, `addressBook`, `resources` and
  `onUpdateProject` become unused → strip from `GeneralSectionProps` and from
  the `settings-view.tsx` call site, along with the now-dead
  `ProjectEditModal` import.
- `general-section.test.tsx` loses its project-block assertions.
- `settingsProjectHeading` becomes orphaned unless another surface uses it —
  grep before deleting, and delete from both dicts if it is dead.

Settings → General is axe-scanned, so re-run the a11y gate for that view.

---

## D · Open Points and its editor

### D1 — `sel` and `status` columns get narrower

The two leading columns are nominally 36px in `DEFAULT_COL_WIDTHS`, and the
table is `table-layout: fixed` with a `<colgroup>`, so those widths *are*
honoured. What actually fills them is `Th`'s `px-4` — **32px of padding around
a 16px checkbox and a 10px dot.**

So the fix is a tight-padding cell variant, not a width number: `Th` and `Td`
gain a padding option (e.g. `padding="tight"` → `px-1`), used by the `sel` and
`status` columns only.

This is why the item still produces a visible result despite D-wide decision to
leave stored widths alone: **padding is not persisted**, so every user sees it
immediately, including everyone who has ever dragged a column.

Only `sel` and `status` change. `id` keeps its 80px.

### D2 — Actions column: Edit moves into the ⋮ menu

`task-row.tsx` renders an inline Edit button beside the ⋮ trigger. Remove it
and add Edit as the **first** entry in the ⋮ menu, above Send inquiry / Push to
Jira / Delete.

`DEFAULT_COL_WIDTHS.actions` drops 60 → 36, enough for the ⋮ trigger alone.

Clicking the task name or the `#id` already opens the editor and is unchanged;
the menu entry keeps an explicitly-labelled Edit affordance for keyboard and
screen-reader users, which dropping the button outright would have removed.

### D3 — Hide finished and Hide externals become buttons

`tasks-section.tsx` renders both as bare checkboxes. Both become `ToggleButton`s
with icons, matching Directory and Workload.

No new state and no new setting: they keep writing `settings.hideFinishedTasks`
and `settings.hideExternalTasks` through `setSettings`. Both existing labels
already name what pressed=true enables, so `aria-pressed` is coherent as-is.

Open Points is axe-scanned — the toggles carry accessible names via their
visible labels.

### D4 — Toolbar order

The Open Points toolbar has drifted from the convention (destructive first,
then Print · reset-columns · reset-size). It currently renders Print ·
reset-**size** · reset-**columns** · Clear-all.

Reorder to: Clear-all · Print · reset-columns · reset-size.

### D5 — Editor extras share one line

The task editor mounts `editorExtrasEl` (`task-manager.tsx`) as a bare fragment
holding `TaskEditorRaidMini` and the "+ New linked task" button, and
`task-form-modal.tsx` wraps `editorExtras` in `space-y-3`. So the two controls
stack vertically even though both are collapsed single buttons.

Wrap the two in `flex flex-wrap items-start gap-2` inside `editorExtrasEl`.
Collapsed, "+ Create RAID" and "+ New linked task" then sit side by side.

`TaskEditorRaidMini` expands in place into a category select + title input, so
it becomes wide. `flex-wrap` handles that without any state plumbing: the
expanded form takes the row and the linked-task button drops to the next line.
Do **not** reach into the mini's `open` state to size it — the wrap is enough,
and the parent has no business knowing.

The `space-y-3` wrapper in `task-form-modal.tsx` stays as-is; it is a no-op for
a single flex child and still spaces any future extra.

### Stored column widths

Column widths persist per-device via `useColumnResize("open-points", …)`. The
storage key is **not** bumped: D2's new `actions` default reaches fresh installs
only, and existing users pick it up via "Reset column widths". D1 is unaffected
by this because it is a padding change.

---

## E · Dictation

### E1 — Note log gets a mic

Both `RichTextEditor` mounts in `note-log-panel.tsx` — the new-note composer
and the entry editor — gain a `useDictationMic` button, matching the task
description field.

**The editor needs a new append API.** Tiptap's `useEditor` binds content once
at mount; the composer only resets by remounting via `key={composerNonce}`.
Feeding an appended `value` back therefore cannot work, and bumping the nonce
per dictation segment would remount mid-sentence and lose the caret — Web
Speech fires `onFinal` repeatedly per hold, so that would happen several times
in one utterance.

Instead `RichTextEditor` exposes an imperative handle:

```ts
export interface RichTextEditorHandle {
  appendText(text: string): void;
}
```

backed by `editor.chain().focus().insertContent({ type: "text", text }).run()`.

Inserting a **text node**, not a string, is load-bearing: `insertContent` parses
a bare string as HTML, so dictated text containing `<` or `&` would be
interpreted as markup. The text-node form cannot be.

### E2 — AI Assistant attach and mic geometry

In the chat composer the attach control is a `<Button>` (`px-4 py-2`) while the
mic is a raw `<button>` (`px-2 py-1`), so the two differ in size, and neither
centres its icon — `Button`'s `BASE_CLASS` carries no
`inline-flex items-center justify-center`.

Fix **locally at the two chat sites**, not in `BASE_CLASS`: that class backs
every button in the app, and switching it to `inline-flex` would change layout
app-wide for a two-button problem. The mic adopts the same secondary-button
shell and size as attach, and both get centring classes.

Chat is not in `A11Y_VIEWS`, so verify by eye.

---

## F · Suggest RACI

The one new feature. Structurally a clone of `useAllocPlan` ("Plan with AI"):
plan-then-apply, one forced tool call, nothing mutates until the user confirms.

### Modules

| File | Role |
|---|---|
| `raci-suggest/raci-suggest.ts` | pure, i18n-free: context digest, tool schema, parse, ground |
| `raci-suggest-call.ts` | the single forced call, via the shared `runForcedToolCall` |
| `use-raci-suggest.tsx` | glue hook returning `{ button, modal }`; coverage-excluded like `use-alloc-plan.tsx` |
| `raci-suggest-modal.tsx` | per-cell review with checkboxes |

### Context

The model sees, per stakeholder: `id`, `name`, `title`, `organization`,
`category`, `influence`, `interest`. Per milestone: `id`, `name`, `date`,
`description`. Both lists capped, with a `truncated` flag reported to the user —
a silent cap reads as "covered everything".

### Grounding

`groundRaciCells(proposal, stakeholders, milestones)` treats model output as
untrusted and:

- drops cells whose `stakeholderId` or `milestoneId` is not in the live
  workspace;
- rejects any letter outside `RACI_ROLES`;
- dedupes cells on `(stakeholderId, milestoneId)`;
- refuses a cell that would create a **second Accountable** for a milestone,
  reusing the existing `accountableCountByMilestone` — the panel already warns
  on that state and the AI must not manufacture it;
- returns `skipped[]` alongside the accepted cells so refusals are disclosed
  rather than silently dropped.

### Apply

The modal shows current → proposed per cell with per-cell checkboxes. Confirm
applies the ticked cells via the existing pure `setRaciRole` and the panel's
`onSave`, records **one** undo `capture`, and logs a new activity kind.

★★ **`RaciPanel.onSave` takes a single stakeholder, so a multi-cell confirm
calls it N times in one tick.** That is exactly the functional-setter landmine
that dropped all-but-one row in RAID / Changes / Stakeholders in 0.136.
`useStakeholders` is documented as fixed, but verify it against the code rather
than the doc, and add a regression test that applies a proposal touching
several stakeholders in one tick and asserts every one of them persisted.

### Gating

`isAiEnabled(settings.ai) && !isPopout && stakeholders.length > 0 &&
milestones.length > 0`. The trigger sits in the RACI panel toolbar.

RACI is not in `A11Y_VIEWS`, so eye-verify the modal and unit-test that the
per-cell controls carry row-unique accessible names — N identical "Include"
labels would be a WCAG 2.4.6 failure the axe gate cannot see.

---

## Testing

- **Unit** — the pure `raci-suggest` engine (context caps, parse of malformed
  model output, every grounding rejection path) is the bulk of the new
  coverage. `MAX_VISIBLE_ROWS` behaviour in the timelog confirm. The
  `RichTextEditorHandle.appendText` text-node path, asserting that `<` in
  dictated text lands as literal text and not as markup.
- **Regression** — the N-saves-in-one-tick test for RACI apply. Seed the
  multi-stakeholder case explicitly; a single-stakeholder fixture passes
  whichever way the handler is written.
- **Component** — the two new Open Points toggles write the right settings
  flags; Edit is reachable from the ⋮ menu; the Knowledge toolbar renders in the
  empty branch; both editor extras render in one row while collapsed, and the
  linked-task button stays reachable once the RAID mini expands.
- **Deletions** — `general-section.test.tsx` and the theme-gallery tests lose
  assertions for removed controls. Check each removal is genuinely dead UI, not
  a test being weakened to pass.
- **a11y gate** — re-run for Settings (C2), Resources (B1/B2), Open Points
  (D1–D4) and Milestones (A3). Run against a fresh isolated server on a
  non-default port, not a reused long-running dev server.
- **Typecheck** — `npx tsc --noEmit` after every test edit; `next build` does
  not typecheck test files and vitest never typechecks.

## Risks

1. **i18n churn.** Four new keys, at least two deletions, EN+DE each. `i18n.de.ts`
   corrupts under the Edit tool. Serialize all i18n work into one step rather
   than spreading it across parallel edits.
2. **Unused-symbol fallout.** C1 and C2 both delete UI whose props, imports and
   i18n keys then go dead. `--max-warnings=0` makes each leftover fatal, and
   they surface only at lint, not at build.
3. **Shared-node blast radius.** B2's toggle and A1's print button each have
   multiple mounts. Grep every call site before changing a signature.
4. **RACI apply.** The functional-setter landmine above is the single highest-risk
   item in the batch, because it fails silently and only under multi-row load.

## Deferred

**Rich text on `Task.blockers`** ships as its own slice. The machinery exists
(`sanitizeRichText`, `descriptionText`, `descriptionTextWithBreaks`,
`sanitizeAiRichText`, `withAiRichFields`), so it is wiring, not new
infrastructure — but it is roughly a third of this batch's weight on its own,
and three of its touch points are silent behaviour changes rather than
cosmetics.

Recorded here so the next slice does not have to re-derive it:

- **Six write boundaries** → `sanitizeRichText`; the two AI ones also need
  `withAiRichFields`: `use-task-submit.ts`, `task-inline-patch.ts`,
  `bulk-operations-helpers.ts`, `use-chat-dispatcher.ts` (create), the same file
  (update), `templates.ts`.
- ★ `templates.ts` sits in the sample-generator import graph, so it gets the
  upgrade but **cannot** get the DOMPurify allow-list — the same carve-out as
  `sanitizeSeedTask`, tracked as open-followups §36(a).
- **Seven readers.** Three are silent behaviour bugs, because an "empty" rich
  value is `<p></p>`, which is truthy after `.trim()`: `health.ts` (task flags
  as blocked forever), `insights/detect.ts` (stalled-work detector fires on
  every task), `next-actions/providers/task-attention.ts` (blocked signal fires,
  and it renders the raw `<p>` into the why-line). Four are cosmetic:
  `global-search.ts`, `gantt.tsx`, `workspace-context.tsx` (tags pollute the
  search index) and `task-row.tsx` (inline cell shows markup).
- **Also**: `blockers` into `TASK_RICH_COLUMNS`, into the task rich-field
  sanitize at the JSON and IndexedDB load boundaries, into `AI_RICH_FIELDS.task`,
  and the `chat-tool-defs.ts` schema description.
- **No golden regen and no new column** — `blockers` already persists on all six
  paths and migration is read-time, so stored plain values stay byte-identical.

The mic on Blockers travels with that slice rather than shipping alone here.
