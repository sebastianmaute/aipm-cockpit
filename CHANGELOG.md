# Changelog

All notable changes to **AI PM Cockpit** are recorded here.
The format is loosely based on [Keep a Changelog](https://keepachangelog.com/);
versioning follows [Semantic Versioning](https://semver.org/).

This file is the authoritative per-version history. The current version and
build date are exported by [`src/app/version.ts`](src/app/version.ts), which no
longer carries its own changelog comment.

## [0.226.0] - 2026-08-09 "Emshwiller"

Undo stopped being a one-step-at-a-time affair, every button that starts an AI
call can now stop it, and a budget bucket's role line opens to the people
behind it.

### Added

- **Multi-step undo history.** The caret beside Undo previewed a single entry;
  it now opens the whole stack as a list, newest first. Hovering or arrowing to
  an entry bands every entry back to it and the footer says how many will be
  reverted. Enter or a click reverts them all as one commit — one activity-log
  line and one toast. Putting them back works the same way in reverse: the Redo
  button takes one step at a time, and the redo history replays a run of them
  together.
- **A Stop affordance on the six AI trigger sites this release covers.** A
  shared `AiTriggerButton` flips the visible label and the accessible name to
  "Stop" while a call is in flight and routes the click to cancel it. The
  insight-recommendation call gained the `AbortController` it did not have.
  Six is the number of sites converted, not the number of AI calls the app can
  start: the background insight-recommendation runner still has no cancellation
  (open-followups §120), and the dashboard digest's "Generate now" and the
  steering meeting report's "Draft with AI" still only grey out while they run
  (open-followups §125).
- **Budget bucket people rows.** Each role line in a bucket expands to the
  people behind it with their booked and planned hours. Booked is read from the
  per-device Timelog cache, so it can disagree with the persisted per-role
  actuals shown on the role row above it, and the people figures are not
  expected to sum to that row — bookers whose role has no line stay in
  `unattributed`. Both gaps are filed as open-followups §122.
- **Insights and Timelog links are seeded for e2e**, so both panes are axe
  scanned with real rows for the first time rather than over an empty state.
  Two of the seeded insights deliberately share a type, which is what makes the
  Insights rows render the duplicate-control-name case the panel has always
  had; it is pinned by an e2e assertion and filed as open-followups §126,
  because no accessibility gate in this repo can detect it.

### Fixed

- **The settings rail no longer wraps into a tall stack on a narrow window**
  (open-followups §112, measured 116px → 36px at 760px and unchanged at
  1280px).
- **The undo footer read "Undo 1 actions"**, and a scroll-induced `mouseenter`
  silently overwrote the undo listbox's keyboard position.
- **The budget disclosure chip clipped role labels with no ellipsis**
  (open-followups §123).

## [0.225.0] - 2026-08-09 "Walton"

Word and PowerPoint exports keep the formatting you wrote. Until now every
document paragraph was flattened to plain text on its way into `.docx` and
`.pptx`, so bold, italic, strikethrough, highlight, inline code, superscript and
subscript all vanished, and quotes and code blocks arrived looking like ordinary
prose. Both renderers now read the same parsed representation, so they cannot
drift apart as more formatting is added.

Documents also got their own HTML allow-list rather than sharing one with
unrelated parts of the app, which is what lets them carry the wider set of
formatting without loosening anything else.

### Added

- Mark-aware `.docx` and `.pptx` paragraph runs, from one shared parse
  (`rich-text-runs.ts`) consumed by both renderers.
- `sanitizeDocumentHtml`, a documents-only allow-list adding `s`, `code`,
  `pre`, `blockquote`, `hr`, `mark`, `sub`, `sup` and `img`. Routed at all
  three boundaries: the render sink, the load path, and the AI write boundary.
- `Quote` and `CodeBlock` Word styles, and a bordered paragraph for `hr`.

### Fixed

- Ten OOXML style definitions emitted `w:rPr` and `w:pPr` children out of
  schema sequence, which is invalid per ECMA-376 and rejected by strict
  validators such as the Open XML SDK. Word itself renders them, so this was
  never visible in the app.
- The document-authoring model was still being told the narrow tag set, so the
  wider allow-list had nothing to carry.
- Several inaccurate claims in the developer documentation, including the
  duplication gate's metric, which had been described as per-format since
  before this release and compares one total instead.

### Known limitations

- A document paragraph whose stored value *begins* with one of the nine
  document-only tags is still escaped to literal text on read; the classifier
  that decides this predates the wider list and is split in a later slice.
- A legacy plain-text paragraph carrying newlines collapses to one line in all
  three renderers. The obvious fix shares a cause with the item above and was
  measured to destroy valid markup, so it waits for the same work.
- `<a href>` reaches `.docx` and `.pptx` as text without its target.

## [0.223.0] - 2026-08-08 "Okorafor"

Settings stopped being one long page, and the buttons that showed nothing on
hover now say what they do. Underneath, three text truncators stopped splitting
characters in half.

### Added

- **Operating guides, Views and Scheduled jobs are their own settings
  sections**, nested under AI Assistant in the rail rather than stacked inside
  one page. The rail shows a branch's children only while that branch is
  active, and a child stays visible with its siblings while it is open.
- **The view descriptions Claude reads are a plain list.** They were behind a
  disclosure that had to be opened one at a time; every view is now a card you
  can scan in order.
- **Hover labels on nineteen icon-only controls** that had an accessible name
  for screen readers but showed nothing to a mouse user.
- **Short explanations on thirteen more controls**, each saying what the
  control actually does — including when an action also navigates you to a
  different view, which is the part that was never obvious.
- **Property-based coverage for five pure engines** — the CSV/Markdown
  round-trip, id minting, rich-text projection, the Gantt date math and the
  entity sanitizers.

### Changed

- **"This project" is now "Overrides"** in the settings rail. It named the
  scope; it now names the thing.
- **Twenty-three hand-built buttons now use the shared primitives**, so size,
  spacing, focus ring and disabled state match the rest of the app instead of
  each site's own recipe.

### Fixed

- **Text caps no longer split a character in half.** Three truncators cut on
  UTF-16 code units, so a cap landing inside an emoji or a rarer CJK character
  kept half of it. That half is not a character: it was replaced by a
  replacement glyph on the CSV and Markdown backends while surviving intact on
  JSON and IndexedDB, so the same project read correctly or incorrectly
  depending only on where it was stored. All three now drop the character
  whole, and a negative cap can no longer return the text nearly unclipped.
- **Five findings from a cold review of that fix**, including one truncator
  whose cap was never exercised by any test and a parity claim that was false
  below zero.
- **dompurify, nanoid and js-yaml** moved past published advisories.

## [0.222.0] - 2026-08-07 "Charnas"

A project holding more documents than the app could open used to lose them.
Opening such a file kept the first batch and discarded the rest with no
indication anywhere, and the next automatic save wrote that shortened list back
over the source — permanently, on all six storage backends. The limit is now
five times higher, an over-limit file says so plainly, and saving pauses until
you decide.

### Fixed

- **An over-limit document load no longer destroys the excess.** The cap is
  raised from 200 to 1000, which removes the loss for any realistic project.
  It remains a single limit governing both opening a file and creating
  documents in the app: a higher opening limit would let a project load that
  could then never be edited.
- **A truncating load is disclosed however the project was opened.** JSON,
  IndexedDB, Turso (single and multi-tenant), CSV and Markdown all report what
  they could not open, and so does every route in — first load, switching
  project, opening a file, reloading. A test fails if a storage backend stops
  reporting. The precedent is the existing malformed-row warning, which reached
  only two of the four backends for its whole life, leaving Turso and IndexedDB
  silent: a warning that covers some backends is worse than none, because the
  ones it misses look safe.
- **Saving pauses after a truncating load**, so your saved project keeps
  everything that could not be opened — not only the automatic save, but the
  explicit ones too (picking a storage file, converting storage, switching
  project). A banner offers the only two routes out: repair the project outside
  the app, or accept the loss deliberately. The explicit escape is required
  rather than optional — the documents that would have to be deleted to get
  under the limit are precisely the ones that were never loaded, so without it
  the pause would be a permanent block on saving. Dismissing the banner leaves
  a "saving paused" indicator you can click to bring it back.
- **Cut-off document content is reported too**, in stored version history and
  in live documents alike. A document or version carrying more blocks than the
  app keeps was previously shortened with no indication at all.

### Changed

- Restoring a document into a full project still refuses, and the refusal now
  quotes the raised limit.

## [0.221.0] - 2026-08-07 "Kavan"

### Added

- **Gantt day axis shows the weekday.** Each day column now stacks the short
  weekday under the day-of-month number ("15" over "Mon"), via a new pure
  `fmtWeekdayShort` helper. The formatter reads the date in UTC to match the
  rest of the Gantt engine, which is UTC-built throughout — formatting in the
  host zone would shift the label by a day in any negative-offset zone and
  disagree with the bar placement. The day band grew from 22px to 30px to fit
  the second line, so the header total is now a sum of two differing row
  heights rather than a doubled constant.
- **Hand-rolled UI inventory** (`docs/handrolled-ui-inventory.md`) — a repo-wide
  audit of markup that reimplements a shared primitive, and of Unicode glyphs
  used where a heroicon exists. Audit only; the remainder is a ratchet, filed
  as open-followups 102.

### Changed

- **Milestone "achieved" is a toggle button**, in both the milestones table and
  the milestone editor, replacing a hand-rolled label-and-checkbox. The table
  control carries a row-unique accessible name, since N identical "Achieved"
  labels would be a WCAG 2.4.6 failure that the axe gate passes whenever the
  seed renders a single milestone.
- **Insights row actions use the bordered button variant.** Eleven buttons
  across the Insights pane, the shared recommendation controls and the
  dashboard insights card move from `ghost` to `secondary`, giving them the
  bordered-chip look of the Open Points "Hide finished" control. The dashboard
  card is included because its buttons are siblings of the shared controls in
  one flex row — converting only the shared component would have mixed two
  looks in a single row.
- **Budget bucket actions use the shared button primitive.** The three
  per-bucket actions and the FX refresh control become `Button`, replacing
  hand-rolled markup. **Remove bucket takes the `destructive` variant** rather
  than matching Edit and Close — it is the only irreversible action in that row
  and previously looked identical to the other two. It remains `confirm()`-gated;
  the variant is the affordance, not the safeguard. The FX refresh control
  consequently loses its dark-blue accent and now reads as neutral, matching the
  reset controls beside it, which already used the same bordered recipe. The
  bucket drag handle stays hand-rolled: it carries the drag lifecycle and
  arrow-key reordering, which the primitive does not forward.

## [0.220.0] - 2026-08-07 "Kuttner"

Every edit modal gets a row back. The Simple / Advanced / Full field switch had
its own bordered strip under each modal's title, costing a row of height in
every editor. It now rides in the modal's header as a single button labelled
with the view you are in, and the field checklist opens from it. Two keyboard
faults found while moving it are fixed in the shared controls, so they are fixed
everywhere those controls appear.

### Changed

- **The field-visibility control moved into the modal header.** One button,
  labelled with the active view — Simple, Advanced, Full or Custom — replaces the
  strip that used to sit between a modal's title and its first field. The tier
  switch and the per-field checklist now live together in the popover it opens.
  Every edit modal is affected: task, absence, calendar event, change,
  milestone, RAID, resource, stakeholder and budget bucket.

### Fixed

- **Arrow keys in a segmented control now move from the option you are on.**
  They previously stepped from the selected option instead of the focused one,
  so a single press could jump two positions and silently change the setting.
  Affects every segmented control in the app, including task priority and the
  RAID fields.
- **Opening a popover no longer focuses the wrong option.** Focus landed on the
  first choice rather than the active one, which meant a stray Enter or Space
  immediately switched the setting — and, for a hand-picked field selection,
  discarded it.

### Accessibility

- The tier switch is now a real radio group, so assistive technology announces
  which view is active and the arrow keys follow the published pattern. It
  replaces hand-rolled buttons that reported only a pressed state, along with a
  "Custom" chip that looked like a control but could not be operated.

## [0.219.0] - 2026-08-06 "Elgin"

Project documents. The written deliverables of a project — a status report, a
charter, a steering pack — now live with the project instead of beside it. This
release is the foundation: documents are stored with the project, previewed in a
new Documents view, and exported as a web page, a Word file, a PowerPoint deck or
a PDF. Writing them with Claude comes next, and the in-app editor after that — so
a newly created document still starts empty, and the sample project now seeds an
example status report to show the shape.

### Added

- **A Documents view.** It lists every document in the project with the date it
  last changed, and shows the selected one as it will print. Create, rename,
  duplicate and delete from the toolbar; sort and resize the columns as in any
  other table. In a pop-out window the view is read-only, matching every other
  pop-out.
- **Four export formats from one document.** Choose a web page, Word (.docx),
  PowerPoint (.pptx) or PDF, and the choice is remembered for next time. The PDF
  goes through your browser's own print dialog, so it needs no extra software and
  the document never leaves your machine.
- **Documents travel with the project.** Every storage backend saves them — JSON
  file, CSV, Markdown, Turso and in-browser storage — and two open tabs stay in
  step with each other.
- **A document can embed live project data.** An embedded section renders the
  same table the workspace exporter produces, so it cannot drift from the numbers
  shown everywhere else in the app.

## [0.218.0] - 2026-08-06 "Hopkinson"

Field captions stop activating the control beside them.

An HTML `<label>` with no `for` attaches itself to the first *labelable* thing
inside it — button, input, meter, output, progress, select, textarea. A caption
wrapping a group of controls therefore adopted whichever one came first, with
two consequences: hovering the caption painted that control's hover state, and
clicking the caption forwarded a synthetic click that pressed it.

### Fixed

- **Clicking "Dependencies" in the task editor deleted a dependency.** The chip
  list renders each dependency's remove button above the type select, so the
  caption adopted the first chip's ✕. Only reproducible once a task had at least
  one dependency — with an empty list the select wins and the field looks fine.
- **Clicking "Regulatory" or "Identity types" in the project form ticked the
  first checkbox.** Both also nested a `<label>` inside a `<label>`, which is
  invalid HTML.
- **Hovering a rich-text caption lit up the Bold button**, and clicking the
  caption toggled it — the originally reported symptom, in the register modals.
- Several captions that named a real input a button had got in front of are now
  bound to that input explicitly, so it has an accessible name again rather than
  losing it to the adopted button.

### Added

- `FieldGroup`, a shared primitive rendering `<div role="group" aria-label>` for
  captions that name a whole block rather than one field. It names the group for
  assistive technology without making the caption a click target.
- Three guards, each verified able to fail. A source scan
  (`label-binding.guard.test.ts`) covering button-first widgets and the
  nested-`<label>` shape, whose self-tests run the real scan over synthetic
  markup rather than restating its rules; a DOM assertion applied at nine render
  call sites, covering labels bound to buttons, dangling `htmlFor` and nested
  labels; and a Chromium probe for the hover behaviour itself.

Neither existing gate can see this class of defect: axe models no
label-to-control binding, and jsdom has no CSS engine, so hover forwarding is
invisible to unit tests. That is why the guards are the coverage.

## [0.217.0] - 2026-08-06 "Piercy"

Cancelled work stops reading as unfinished work. The 0.213.0 batch fixed the
headline tiles and stopped at the branch boundary; this finishes the surfaces it
left, and tells the AI what it had been guessing at.

### Fixed

- **The Red / Amber / Green split no longer counts cancelled work as Green.** A
  project of two cancelled tasks rendered "No active scope / All cancelled (2)"
  beside "R 0 · A 0 · G 2" inside one card. Cancelled work now leaves the tally
  and is counted separately next to it, and each Reports group card carries the
  same clause. A task whose health you set by hand keeps the colour you chose.
- **Portfolio health shows a dash, not "0%", for a project with no scope left.**
  That 0 read as "not started yet" on the one screen where projects are compared
  side by side. Such a project is also left out of the portfolio-wide average
  instead of dragging it down, and the average tile itself shows no figure when
  no project contributed one.
- **A `Done` task with no completion date announces itself as closed**, not
  completed — matching the cross already shown beside it rather than
  contradicting it.
- **The steering-committee draft and the AI snapshot** are told a project has no
  active scope, instead of being handed a bare 0 they could restate as
  "0% complete" in generated prose.

### Changed

- Reports group cards rank by in-scope size within a colour band, so a mostly
  cancelled workstream no longer outranks a smaller active one.

### Internal

- One shared `isTaskOutOfScope` predicate replaces five inlined copies of
  "closed but never delivered", so the completion denominator and the health
  tally cannot drift apart.
- A ratchet fails the suite on any NUL byte committed under `src/` or `docs/`;
  such a byte makes grep treat the file as binary and silently skip it.

## [0.216.0] - 2026-08-06 "Martine"

The assistant now knows which screen you are on, and says so when it cannot see
something rather than guessing. Help now covers every view in the app, and can
be read at the depth you want.

### Added

- **View-aware AI.** Claude is told which of the app's 34 views is active and
  what that view is for. On Open Points, Workload, Gantt and Budget it is also
  handed a short summary of what is currently on screen.
- **Three read tools**: knowledge-library links, resource-calendar meetings
  (the recurring series definition and its skip/move exceptions, never an
  expanded occurrence list), and budget-planner buckets.
- **Starter prompts on 26 views** instead of 14.
- **Settings -> AI -> "What Claude is told about each view"** lists, read-only,
  the exact description the assistant receives for every view.
- **Honest gaps.** Where no tool can answer -- time bookings, the activity log,
  cross-project portfolio data, RACI assignments, and calendar absences -- the
  assistant is told to say so instead of estimating.

### Fixed

- **The on-screen summary named rows you could not see.** On Open Points it was
  built one filtering layer above what the table renders, so hidden rows were
  reported as visible; and a search, priority filter or hide-externals left it
  claiming "no filters active". It now uses the same row set the table and
  select-all use, and names every active filter.
- **Board and swimlane modes were counted as if they were the table.** The
  hide-finished toggle is table-only, so a board was under-reported by every
  finished card and its cards were called "rows in the table".
- **Inline "Ask Claude" edits saw neighbouring rows.** An inline edit inherited
  the on-screen summary, handing a mutation planner a list of other tasks and
  their ids while instructing it to change only one.

### Changed

- Tool schemas now carry their own prompt-cache breakpoint, so switching views
  no longer re-sends roughly 6.5k tokens of schema definitions.
- **The assistant's starter chips are now complete briefs.** The chat strip
  offers a risk review, a weekly status update, a stakeholder update, and
  "prioritize all tasks" -- each a full instruction that sends on click rather
  than a few words dropped into the input for you to finish. "Process an
  attachment" is kept and now sends on click too; it trails the others because
  it is the only one that needs a file attached first.
- The header "Ask Claude" menu drops its **Status overview** and **Prioritize**
  entries, which duplicated the two fuller chips above. It keeps the short
  questions that suit a menu -- "Explain this" and "What's next?".

### Added -- Help

- **Reading levels.** Guided, Standard or Expert. Guided puts a plain-language
  primer above each of the twelve concept entries; Expert moves the reference
  sections ahead of the explanatory ones; Standard renders exactly as before.
  The control sits in the Help window itself, beside the search box, and in
  Settings -> Appearance -- one device-wide setting, so changing it in either
  place moves the other. A primer is searchable only at the level that renders
  it, so the same query can match a different number of entries at different
  levels.
- **Every view in the app is now covered.** Thirteen new entries: Projects,
  Portfolio health, Insights, Time bookings, Reports (covering all four report
  views), Help itself, and seven features that are not views at all -- saved
  views, installing the app, undo and redo, asking Claude to edit one record,
  the weekly digest, column widths, and printing.
- **A gate that DE prose is translated, not pasted English.** `tsc` proves a
  German key exists; nothing proved anyone translated it. It cannot go vacuous
  through the lazy-dictionary trap: without the dictionary load every pair
  becomes identical and the test fails loudly.

### Fixed -- Help and pop-outs

- **A Budget pop-out could edit cells** that every other pop-out treats as
  read-only. The edit never reached the workspace backend -- pop-outs do not
  save and do not broadcast -- but it left a divergent mirror and a phantom
  undo entry.
- **The stakeholder concept described the wrong view and the wrong axis.** It
  said stakeholders are tracked in the Stakeholders view on an "interest x
  power" matrix. The axis is Influence, and the 2x2 grid is the separate
  Influence / Interest view; the Stakeholders view is a table.
- **Sixteen further corrections to existing and new Help text**, each checked
  against the module it describes rather than against how it read -- among
  them: which project row carries Delete (the other rows, not the current one),
  that Portfolio health cannot be popped out at all, that the digest mails a
  copy to the signed-in Microsoft 365 account rather than distributing it, that
  the dashboard shows up to five insights, and how Timelog actually matches
  people and projects.

## [0.215.0] - 2026-08-04 "Friedman"

Trends stops recording an empty project. Three smaller fixes where a control
said one thing and did another.

### Fixed

- **Trends recorded the project before it had loaded.** Snapshot auto-capture
  raced the workspace load and won, writing a snapshot whose KPIs were all
  null. Because a cadence bucket is claimed by its first snapshot, that row
  permanently owned its week and no retry ever followed — the charts read
  "Not enough snapshots yet" beside a full snapshot table. Capture now waits
  until a workspace has actually been applied.
  **Snapshots already written this way are not repaired.** Delete the affected
  rows in the Snapshots table and use "Capture snapshot now"; there is no
  migration, because a null-KPI row cannot be told apart from a genuinely empty
  project after the fact.
- **One person could occupy two Kanban swimlanes.** Tasks that stored an
  assignee's name and tasks that stored a link to the same person in the
  directory were grouped separately, so the board showed two lanes with
  identical headers — and only the linked lane's cards had a populated
  assignee dropdown; the other read "Unassigned" beside a card printing that
  person's name. The lanes are now merged, and existing tasks are linked to
  the directory as they load, matching on email first and then on an
  unambiguous name. A name shared by two people, or belonging to an external,
  is deliberately left unlinked rather than guessed.
- **"Hide externals" forgot itself.** In Planning and Workload the toggle reset
  whenever the view was left and re-entered. It is now remembered per device,
  under its own setting — the directory's own hide-external toggle stays
  separate, because hiding someone from a list must not quietly drop their
  allocations out of plan totals.
- **"Budget hours follow plan" was a bare checkbox** in a toolbar of toggle
  buttons. It is now the same toggle control as its neighbours, carrying the
  same pressed state and non-colour pressed marker.

---

## [0.214.0] - 2026-08-04 "Lostetter"

A budget bucket adds up. Four smaller pieces of chrome stop getting in the way.

### Added

- **A fixed Total column and a total row in every budget bucket.** Each role or
  discipline row now carries its own budget and actual summed across all months,
  and a total row beneath the rows adds up each month's column and the bucket as
  a whole. The health dot, the role name and Total stay put while the months
  scroll sideways. Both totals come from the same figure the cells show, so the
  row totals, the column totals and the grand total cannot disagree.
- **The start-window logo is configurable.** Settings → Appearance takes a
  start-window logo alongside the sidebar logo and the favicon; unset, the
  window shows the shipped banner. It is a **separate field** from the sidebar
  logo and there is deliberately no migration — the two wanted different
  shapes, one a small mark and one a wide banner — so a deployment that had
  customised its sidebar logo sees the shipped banner on the start window until
  it uploads one there. Raster only (PNG, JPG, WebP, GIF), as for the other two.

### Changed

- **The resource calendar's "Include externals" checkbox is a "Hide externals"
  toggle**, sitting beside the Outlook controls the way Planning's equivalent
  already does. The stored preference is unchanged; only the label and the
  control changed, so an existing setting carries over as it was.
- **The customer filter in Time bookings is three times wider.** It was too
  narrow to read a customer name in.
- **The resource edit window fits its fields** instead of reserving a fixed
  height, so a short field set no longer opens with dead space beneath it. It
  stays resizable; dragging it pins a height as before.
- **A budget bucket's table is now sized to its own columns.** This is what lets
  the three leading columns stay pinned where they belong, and it has a visible
  cost: a plan with few months no longer stretches to fill the width of its
  card.

## [0.213.0] - 2026-08-03 "McKillip"

Cancelled work stops counting as work still to be done, the Gantt gains a set of
view controls, and a stale due date no longer blocks saving a task.

### Fixed

- **A stale due date no longer blocks editing an existing task.** The rule that
  refuses a due date in the past now applies when a task is CREATED, not when one
  is edited. It was reported as "changed the status to Done and could not save",
  but the scope was wider than that: every overdue task was unsavable, whatever
  you had changed on it, because the date that made it overdue failed validation
  on the way out.
- **Cancelled tasks no longer report as open work.** A cancelled task is closed —
  it is not overdue, does not count toward a resource's load, does not drag the
  schedule rating down, is not chased, and is filtered as completed on the Gantt.
  It is still not *delivered*: no completion date is invented for it, so the
  completion percentage, earned value and the on-time figures continue to count
  genuinely finished work only.
- **Cancelled scope no longer holds the completion percentage below 100%.**
  Cancelled tasks are dropped from the denominator as well, so a project whose
  remaining work is done reads as complete. The in-scope count behind the figure
  is shared, so the dashboard tile, the completion sparkline and the steering
  committee report all compute it from the same denominator. (They still *present*
  it differently — the committee draft states a percentage where the dashboard now
  reads "No active scope"; that gap is tracked as an open follow-up.)
- **A project whose every task was cancelled no longer reads "0% complete".**
  It says "No active scope — all cancelled (N)" instead, because 0% there is an
  empty denominator rather than work not done, and the two are worth telling
  apart. The state reaches every place on the screen that showed the figure: the
  Progress tile, the at-a-glance KPI card, the completion-trend sparkline (which
  hides rather than draw a flat zero line beneath a tile saying there is no
  scope), and the Trends completion-variance row, which had reported a project
  baselined at 40% as having gone *backwards* to 0. An empty project is
  deliberately left reading 0% — it has not abandoned anything.
- **A cancelled task no longer wears the same green check as a delivered one.**
  In Open Points it shows a muted ✕. The two states differ by the shape of the
  glyph rather than its colour, which matters because the column that spells out
  "Cancelled" in words can be hidden — with it off, this mark and the row's
  strikethrough are the whole signal.
- **The Reports headline tiles reconcile again.** `Total` gained a small line
  naming how many of them were cancelled, so the reader can see why Total no
  longer equals Open plus Completed. A project with nothing cancelled is
  unchanged.
- **Two dashboard descriptions caught up with the numbers they describe.** The
  Progress caption still said "tasks completed vs total" after the denominator
  became in-scope work, and claimed the red/amber/green split covered open work
  when it counts every task. The completion tooltip named the wrong numerator.
  Both corrected, in English and German.
- **Unticking every status in the Gantt filter now shows nothing, and says so.**
  It used to show everything, on the reading that an empty filter list means "no
  filter". An existing user's stored preferences are migrated rather than
  reinterpreted, so a saved filter does not silently change meaning or open an
  empty chart.
- **Milestones follow the Gantt status filter.** They were exempt from it, so
  filtering to overdue work still showed every milestone. They also gained their
  own show/hide toggle.
- **Gantt dependency arrows are legible.** The non-critical arrow was drawn thin
  and faint enough to measure about 1.96:1 against the chart surface, which reads
  as "the arrows are missing" rather than "the arrows are subtle". It is now about
  3.11:1. Nothing about the arrows was broken — they were being drawn all along.
- **A cancelled task's bar reads as cancelled.** It renders struck through rather
  than in the overdue colour, and can no longer be dragged to new dates — its
  dates are not going to be worked to.
- **Select-all and bulk edit only reach the rows on screen.** Both used to be able
  to reach rows the table was not rendering, so "select all" could select more
  than was visible and a bulk edit could change rows the user could not see. When
  a bulk edit does skip hidden rows, it now says so instead of silently applying
  to fewer rows than expected.
- **The bulk-edit panel scrolls.** With many fields ticked it grew past the bottom
  of the pane and its Apply and Cancel buttons went with it; the field list now
  scrolls and the actions stay in view.

### Changed

- **The Gantt's display toggles collect into a View popover.** All eight of them —
  dependencies, holidays, absences, the day grid, critical path, baseline,
  milestones and inline milestone placement — sit in one menu instead of competing
  for room in the toolbar. The menu sits after "reset filters" and before the
  trailing Print and reset controls.
- **New Gantt layers: holiday columns and an optional dotted day grid**, and the
  absence bands became toggleable. All three are decorative and cannot intercept a
  bar drag.
- **Reports carry a third Cancelled bucket.** A cancelled task is neither open nor
  completed there, and is never counted overdue.
- **"Clear all" in Open Points reads as destructive**, matching the clean-slate
  button in Settings → General. It still requires typing the confirmation phrase.
- **The task editor's reset-size button uses the same icon as the main windows.**
- **"I am this resource" moved from Settings → Appearance to Settings → General.**
  It says who you are, which is not an appearance preference.

## [0.212.0] - 2026-08-03 "Nayler"

Toolbar ordering in two panes, and a table-geometry fix that reclaims the wasted
space at both edges of Open Points.

### Fixed

- **Open Points no longer pads its narrow columns.** The table is laid out with
  `table-layout: fixed`, and when the table is wider than the sum of its declared
  columns the browser spreads the surplus across them, and the narrow columns
  picked up roughly as many pixels as the wide ones — which is invisible on a
  200px column and about a third again on a 36px one. That is the padding around
  the gutter, checkbox, health-dot and relations columns. The Task column is now
  the single flexible one and absorbs the whole surplus, so the utility columns
  render at the width they were given and task titles get the rest.
- **Dragging the Task column still works, and still wins.** Once dragged it holds
  the chosen width instead of flexing; "reset columns" restores the flexible
  layout. While it holds a fixed width no column is flexible, so the surplus is
  spread across the table again — "reset columns" is the way back.
- **Dragging a column no longer snaps it before it moves.** The drag started from
  the column's *declared* width rather than the width it was actually rendered
  at, so grabbing the Task column — which is now flexible and usually far wider
  than its declared 200px — jumped it narrow before it began following the
  pointer. The change reaches every resizable table, not just Open Points, and
  should remove the same jump wherever a column was rendering wider than its
  declared width — though only the Open Points case was actually observed.
- **Both halves of each Outlook calendar row are now toggle buttons.** "Add to
  Outlook" and "Keep in sync automatically" now sit one under the other in Settings →
  Integrations instead of a button above a checkbox. Auto-sync stays visible but
  inoperable until the row is switched on, and now says why.
- **The standard toggle buttons no longer signal "on" by colour alone.** A toggle
  pins its label to what switching it on does, so the label cannot say which state
  is currently active and the accent tint was the only visual channel left. These
  toggles now also show a check mark while on, and spell the state out in the
  tooltip. The mark keeps its slot when off, so a toggle is the same width in both
  states and switching one does not shift the controls beside it. This covers the
  toggles built on the shared control — the gantt view options, the Open Points
  view switches, the Outlook ones below and others. Fourteen other places
  elsewhere in the app are unchanged, and most of them — the rich-text editor's
  bold/italic buttons, the health chips, the template pickers — still show their
  on-state by colour only.
- **Turning on Outlook sync for a register can no longer start background syncing
  on its own.** A settings file that recorded "sync automatically" for a register
  whose sync was switched off could arm unattended two-way syncing the moment the
  register was switched back on. Such a setting is now cleared when settings load.
- **Planning's "Hide externals" sits beside the Outlook calendar controls.** It had
  been separated from them by the spacer that pushes that group to the right, while
  the Workload view already rendered the two together.
- **The RACI matrix leads its toolbar with "Suggest RACI"**, rather than tucking the
  pane's primary action in among Print and Reset.

### Changed

- Column widths are retuned to what each column actually holds: the health dot
  36→28px, relations 120→96px and the row-actions menu 36→32px. The checkbox column
  is unchanged at 36px.
- Saved column widths now record only the columns you actually dragged. Previously
  the whole width map was written the first time a table was displayed, which meant
  later changes to a default width could never reach anyone who had ever opened that
  table. Open Points discards its stored widths once as part of this change so the
  retuned defaults apply; other tables keep theirs.

## [0.211.2] - 2026-08-03 "Samatar"

A toolchain chore. No user-facing behaviour changes.

### Changed

- **CI now builds and tests on Node 24.** The default CI image moved from
  `node:20-bookworm-slim` to `node:24-bookworm-slim`: Node 20 reached end-of-life
  on 2026-04-30, stopped receiving security updates, and was dropped from the
  official Docker images. 24 is the current active LTS.
- **The documented Node floor is now 24**, in both the README prerequisites and
  the RUNBOOK's build and self-hosting notes (previously ≥ 20.9.0), matching what
  CI actually runs. `package.json` gained an advisory `engines: { "node": ">=24" }`
  to state the same floor where a package manager can see it.
- Dropped six dead variable initializers — locals assigned `0`, `-1`, `false` or a
  seed value that every path overwrote before the first read. They are bare typed
  declarations now, so the compiler enforces definite assignment instead of a
  placeholder silently standing in for a missed branch. No behaviour change.

### Added

- Two entries in [`docs/open-followups.md`](docs/open-followups.md): **§53** records
  why ESLint 10 is blocked upstream, and **§54** a pre-existing production-only CSP
  bug — the prod CSP refuses the `<style>` element the rich-text editor injects at
  runtime, so every rich-text editor renders without its base stylesheet in a
  production build. Dev is unaffected, which is why it had gone unseen. Recorded
  with a reproduction; not fixed here.

### Not shipped

- **ESLint 9 → 10 was attempted and abandoned.** `eslint@10` installs cleanly and
  then crashes before linting a single file: `eslint-config-next` bundles
  `eslint-plugin-react@7.37.5`, which calls `context.getFilename()`, removed in
  ESLint 10 — the run dies at rule-load with no output. No published version of
  that plugin supports v10, so the upgrade is blocked upstream and nothing of it
  is in this release. The branch was re-scoped to the changes above, which stand on
  their own. Details and the command to re-measure are in §53.

## [0.211.1] - 2026-07-31 "Samatar"

A small-correctness batch closing four entries from the open-followups register.

### Fixed

- **The RAID editor no longer destroys notes added while it is open.** The editor
  holds a snapshot of the whole item taken when it opened, while the notes window
  writes straight through to the project — so opening a RAID item, adding a note
  and saving silently discarded that note. The saved item now takes its note log
  from the stored row. Same defect the task editor had, fixed in 0.209.0; the RAID
  save replaces the row rather than merging it, so it needed the opposite fix.
- **Asking the assistant to change a RAID item no longer erases its notes.** The
  update ran through a validator that rebuilds the item from a fixed field list,
  and the note log is not one of those fields — so a request as small as moving a
  target date deleted every note on that item, with no undo. The stored notes are
  now preserved across an assistant edit.
- **`brace-expansion` advisory cleared without an eslint major.** `npm audit` now
  reports 0 vulnerabilities (was 1 high), via major-scoped `overrides` pinning the
  1.x and 5.x branches independently. Dev-only dependency; the blocking CI audit
  gate excludes dev deps and was green throughout.
- **The TimeLog actuals cache follows the project, not its editable code.** It was
  keyed on the project code, so renaming that code orphaned the cached bookings
  while the project-scope picker (keyed canonically) survived — leaving the picker
  restoring a selection for bookings that were no longer loaded. Both per-device
  stores now share the canonical key. ⚠️ A cache fetched before this release is not
  carried over: open Time bookings once and press Fetch.

### Changed

- **The four abort checks share one predicate.** They read the error's name
  directly instead of gating on `instanceof DOMException`, which is unreliable
  across the jsdom/Node boundary. This is hardening, not a bug fix: in a browser
  an aborted `fetch` rejects with a same-realm `DOMException`, so the previous
  gate did match and no user-facing failure was demonstrated at any of the four
  sites. (An earlier draft of this entry, and open-followups §11, both claimed a
  spurious error toast; a cold review disproved it.)
- **The three file pickers in Settings → Appearance share one control.** The two
  built as a styled `<label>` had no visible keyboard focus indicator at all — a
  `<label>` cannot receive focus, so the focus ring on it could never render, and
  focus instead landed on a visually-clipped input. They are real buttons now.
- Realigned button sizing where the shared control had changed a control's size
  relative to its neighbours. The scheme editor's Import button is restored
  exactly (`size="xs"` reproduces every visual class of the local string); the
  branding row's picker and its Remove twin both moved up to `size="sm"`
  together, so that row is internally consistent but slightly larger than before.
- **The task form no longer carries a dead note-log field.** The note log writes
  straight through to the workspace and the draft's copy was never saved; removing
  it means there is nothing for a future change to accidentally write back over a
  live log. The disabled notes button on an unsaved task now shows no count rather
  than a hardcoded zero.

## [0.211.0] - 2026-07-30 "Samatar"

A toolbar-polish batch: shared controls (Print, push/pull, hide/show toggles) now
route through the design-system primitives consistently across every pane instead
of a mix of hand-rolled markup, and the RACI matrix gains an AI-assisted
suggestion flow.

- **Suggest RACI (new).** A button on the RACI matrix asks Claude to propose
  Responsible/Accountable/Consulted/Informed assignments from stakeholder titles
  and milestones. Every proposed cell is re-grounded against the live workspace
  before it is shown, the review modal lists each cell's current value next to
  the proposed one, and only the cells you tick are applied — as one undo entry.
- **Shared controls.** Print is icon-only everywhere it appears (now a bordered
  `IconButton`, not a text/icon toggle). Every push/pull button gained an icon and
  a short "Push"/"Pull" label while keeping its full descriptive accessible name,
  with a fix so the accessible name still follows a busy/loading label change
  (WCAG 2.5.3). The Outlook sync enable checkbox gained an explanatory tooltip.
- **Toolbars.** The contacts directory's pull-contacts and hide-external controls
  gained icons; Workload and Planning's hide-external switched to a toggle
  button; the Calendar's Add-meeting control moved to the front of its toolbar
  and became the primary add action; Planning's Plan-with-AI moved to the front
  of its toolbar; the Knowledge toolbar moved out of the scrolling content area,
  right-aligned, and now renders even when the library is empty; the Timelog
  apply-confirm diff grows to fit its content and only scrolls past 25 rows.
- **Settings.** The theme gallery is now a two-up grid with no per-card Apply
  button and no "Active" label — applying a theme happens only through the
  Appearance scheme picker. Settings → General dropped its duplicate project
  editor (edit the project from the Projects view).
- **Open Points.** The select and health columns got tighter padding so they
  actually honour their 36px width. Edit moved into the row's ⋮ menu and the
  actions column narrowed accordingly. Hide-finished and hide-externals became
  toggle buttons. The toolbar's button order was restored to the app-wide
  Print · reset-columns · reset-pane-size convention. The task editor's
  create-RAID-item and new-linked-task controls now share one row.
- **Dictation.** `RichTextEditor` gained an imperative append so dictation can add
  text to an already-mounted editor; the note log's composer and its entry editor
  both gained a microphone button. The AI Assistant's attach and dictate buttons
  are now matched in size with centred icons.
- **Accessibility fixes found in review.** The Suggest RACI and Plan-with-AI
  buttons were hand-rolled with a dark-blue text colour that had no dark-mode
  companion, leaving them at roughly 1.1:1 against the dark surfaces — barely
  visible, and on toolbars no automated check reaches. Both now use the shared
  button primitive. Plan-with-AI's accessible name was "Plan resource
  allocations with AI" while it reads "Plan with AI", which does not satisfy
  WCAG 2.5.3; the visible label is now the name and the longer sentence is the
  description. The note log's two new microphones did not carry the per-surface
  label suffix, so with both note panels open they announced identically.
  Suggest RACI's review dialog now distinguishes two people (or two milestones)
  that share a name using the whole project, not just the proposed rows, and it
  says so when the project was too large for Claude to see all of it.
- **Under the hood.** Every button touched by this batch was routed through the
  shared design-system primitives instead of hand-rolled markup, and the tasks
  pane stopped duplicating the shared Outlook calendar-sync control — it now
  renders the same `CalendarSyncControls` every other entity pane uses.

## [0.210.0] - 2026-07-29 "Larbalestier"

Formatted descriptions now survive the trip out of the app: document exports keep
their paragraph breaks, and a task description exports as text rather than raw
markup. Two of the fixes below are data-integrity ones you may have been hit by
without noticing.

★ Scope: this is about the four DOCUMENT formats — PDF, Word, Excel and
PowerPoint. The CSV and Markdown exports are the app's own storage format and
deliberately still carry a description exactly as stored, markup included, so
that exporting and re-importing a project round-trips without loss.

- **Document exports keep paragraph breaks.** A three-paragraph description used to arrive
  as one run-on line in every document export format. It now lays out as real paragraphs:
  line breaks in PDF and HTML, Word line breaks in DOCX, separate paragraphs in
  PPTX, and wrapped multi-line cells in XLSX (which already handled it, and is now
  pinned so it stays that way).
- **Task descriptions export as text, not markup.** The Tasks section of a PDF,
  DOCX, XLSX or PPTX export still emitted the raw `<p>` tags of a formatted task
  description, where every other register already exported readable text.
  ★ One trade-off comes with it: a link inside a task description now exports as
  its visible text without the address behind it, the same as descriptions in the
  other registers have always exported. Previously the raw markup carried the
  address; now nothing in the export does.
- **Fixed: an inline AI edit flattened a description's formatting.** Confirming an
  "Ask Claude" edit wrote the plain-text *preview* over the field instead of the
  value the assistant proposed, silently discarding bold, lists and links from
  task, RAID, change and milestone descriptions. The preview still shows readable
  text; the value saved keeps its formatting. Fixing that exposed a second half
  in the same path — a task description in particular was then stored with its
  formatting tags escaped into visible text — so the write behind it now accepts
  formatted and plain text alike, the way the other three registers already did.
- **Fixed: an inline AI edit could not change a task description at all.** The
  editor's field list still named the description by its pre-0.196.0 name, so an
  "Ask Claude" edit that changed a task description produced no proposed change
  and applied nothing, usually reporting only a bare "No changes to apply."
  however clearly you asked.
- **Fixed: five places read a description with its paragraphs fused.** The tasks
  pane search, the Gantt search index, the task-row preview, the AI duplicate
  finder and the Jira push all joined the text either side of a paragraph break
  with no space — so the tasks pane matched "delayMitigation" where global search
  matched "delay Mitigation", and the fused form was what got pushed to Jira.
- **Fixed: saving a template from a project lost every task description.** A
  template captured with "include content" dropped every task description to empty
  — silently, since 0.196.0. Templates saved from now on keep them.
  ★ A description already lost from a template you saved earlier cannot be
  recovered: templates live in your settings, which are re-read and re-written on
  every app start, so the emptied value replaced the original at rest long ago.
- **Fixed: the AI assistant could store formatting it was never allowed to.** A
  description written by the assistant — in a task, RAID item, change or milestone
  — went to storage without the safety filter the editor's own saves go through.
- **Fixed: the AI merge preview showed markup instead of text.** The
  "Deduplicate & unify tasks" confirmation listed the unified description with its
  raw formatting tags visible — in the one screen you read before approving a
  merge that deletes tasks.
- **Fixed: pressing Enter saved a longer value than the app said it did.** In the
  RAID and change editors, submitting with Enter from a text field skipped the
  length cap that clicking Save applied, so an over-long title, owner or requester
  was written to your project in full while the notification announced it had been
  shortened. What happened next differed by register: a change request was
  shortened the next time the project was opened, but **a RAID item was not
  shortened by anything, ever** — it stayed over-length in the file. The editor is
  now the cap for both.
- **Fixed: character counts could disagree with the limit they enforce.** For a
  description still stored as plain text, the counter measured a different value
  than the cap did, so the remaining budget it showed could be wrong.
- **Special characters written as numeric codes now count as one character.** A
  description carrying a numeric character reference (what an Office paste
  produces for an em dash) was charged the length of the code rather than of the
  character, and a value near the limit could be cut mid-code. Because the count
  changed, a stored description holding such a code may be written back in a
  slightly different form the next time the project is saved — the character
  itself rather than its code — and one that was only over the limit because of
  the old count now keeps its formatting instead of losing it.
- **Fixed: printing a task table dropped truncated description text.** A description-preview
  cell is width-capped and truncated on screen with an ellipsis, which is right on screen and wrong
  on paper — the print stylesheet neutralises every other clipping box, but could not reach this one,
  so the printed table showed "Replace the hand-rolled session…" and silently lost the rest. Such
  cells now wrap when printed, so the full text appears. Column widths are unchanged.
- **New Help topic: "Formatted descriptions & notes."** Which seven fields take
  formatting, how the note log differs from a description, how notes are attributed,
  and exactly which export formats keep paragraphs and which keep the markup.
  In the Help view and the Help panel, English and German.
- **The demo and sample project now show formatted descriptions.** A few records in
  the sample workspace carry real paragraphs, lists and a link, alongside others
  deliberately left as plain text — so "Explore a demo project" shows both shapes,
  which is what a real project looks like after upgrading.

★ Housekeeping in this release, with no effect on your data: the version number in
`package.json` had been stuck six releases back (and its lockfile eleven), the README
badge and the architecture notes three, and several documented facts had outlived the
code they described — including a claim that two colour themes ship as files in the
app, when a theme has been something you load yourself for some time. Those are now
corrected, and the release checklist names every file that carries the version so the
drift does not restart.

## [0.209.0] - 2026-07-29 "Lafferty"

Six register descriptions became rich text, and a task's note log moved inside
the editor. Nothing you already wrote needs converting.

- **Rich text in six register fields.** The RAID description and mitigation, the
  change description, impact description and resolution notes, and the milestone
  description are now edited with the same lean editor the task description and
  note log use — bold, italics, bullet and numbered lists, and links. The
  toolbars, keyboard shortcuts and dictation button behave exactly as they do
  elsewhere.
- **Existing text is upgraded as it is read, and nothing needs converting.** A
  legacy plain-text value is turned into formatted text at the point it is read —
  by the editor that opens it, and by search, exports and the AI digests — so old
  items render correctly with no migration step and no conversion prompt.
  Depending on the backend and the record type, that upgrade may happen as the
  project *loads* rather than when you edit; where it does, your next save writes
  the upgraded form for every affected item, not only the one you touched. Either
  route is lossless — the upgrade escapes and wraps text that was already there,
  and a project may hold both shapes at once without any reader misreading them.
- **Markup never leaks where plain text is expected.** Global search and the two
  panel search boxes match on the readable text, so searching for a word inside a
  formatted description still finds it. Document exports (PDF, DOCX, XLSX, PPTX
  and the CSV export), the digests sent to the AI assistant, and the inline-AI
  confirmation diff all show the text, not the markup behind it.
- **Fixed: creating a task from a RAID mitigation showed raw markup.** The
  "Create mitigation task" action escaped an already-formatted mitigation a second
  time, so the new task's description displayed literal `<p><strong>` tags as
  visible text instead of formatting.
- **Fixed: a task description containing `&` could not be found by searching for
  it.** Task descriptions were indexed with their HTML entities still escaped, so
  the search index held `&amp;` where the description showed `&`.
- **Fixed (data loss): a RAID description containing angle-bracketed text could
  lose that text on load.** On the JSON and IndexedDB load paths a plain-text
  description was passed through the rich-text sanitizer while still plain; the
  sanitizer drops an element it does not allow *together with its content*, so
  text shaped like `<b>` — and everything the reader took to be inside it — was
  silently discarded on every load. The value is now escaped before it is
  sanitized.
- **The task note log opens inside the editor.** The dated note log now appears
  as a collapsible "Notes log (N)" section in the task editor, instead of only in
  the separate floating window — which remains, and is still what the row badges
  open. ★ Notes written there are saved immediately: the log is an append-only
  journal, so neither Cancel nor Save discards a note you just added, unlike
  every other field in that form, which is only written when you save.
- **Fixed (data loss): saving a task discarded a note added while the editor was
  open.** The editor took a copy of the note log when it opened, and saving wrote
  that copy back over the live one — so a note added, edited or deleted in the
  note log while the form was open was reverted the moment you pressed Save. The
  form no longer writes the note log at all; the log owns itself.
- **Clearing a rich field now stores nothing.** Emptying one of these
  descriptions stores it as absent rather than as an empty paragraph, so an
  emptied field reads as empty everywhere that checks it.

## [0.208.0] - 2026-07-28 "Yolen"

The open project is now editable without leaving Settings, themes are files you
load rather than a fixed pair, and every edit modal can finally be resized
vertically.

- **Project config in Settings → General.** A Project block shows the open
  project's name, code, dates and operating timezone, with an Edit button that
  opens the same editor the Projects panel uses. Read-only in pop-out windows.
- **Themes are files.** The theme gallery is now a library: load any portable
  theme `.json` from disk, then apply, customise or remove it. The AIPM and
  Dashboard themes no longer ship with the app — load them as files if you want
  them. Importing from the scheme editor no longer drops a theme's dark mode or
  its shadow/gradient settings.
- **Edit modals resize vertically.** The shared edit modals, the budget bucket
  modal, the shift modal and the committee status-report modal now open at a
  sensible height and grow their content when you drag the corner, instead of
  leaving empty space. The four narrower editors — absence, milestone, resource
  and meeting — open sized to their own content rather than to the shared
  default.
- **Contrast fix in the Meridian dark theme.** The selected option in a
  segmented control (Table/Board, density, and similar) drew its label below the
  AA contrast minimum. Found by the accessibility gate, which now scans Meridian
  and Umber in place of the removed AIPM and Dashboard themes.

## [0.207.0] - 2026-07-28 "Goss"

Budget buckets and tasks can now be linked from the task side, a bucket takes
its manual completion inline, and every budget edit is finally undoable.

- **Assign a task to a budget bucket from the task editor.** The editor gained
  a "Budget bucket" field. A task belongs to at most one bucket, so picking one
  removes it from any other — it is no longer possible for a single task to
  inflate two buckets’ derived completion. On a new task the choice is held
  until the task is saved and applied to the id it actually receives.
- **Assign many at once.** The Open Points bulk-edit bar carries the same field,
  including a "none" option that unlinks. Changing bucket alongside other task
  fields records a single undo entry, and a bucket-only change leaves the task
  rows completely untouched, so nothing a Jira sync owns is disturbed.
- **Manual % complete is editable on the bucket card.** No need to open the
  bucket editor. When no manual value is set the placeholder shows the
  percentage derived from the bucket’s linked tasks, so the override
  relationship is visible in place; clearing the box restores the derivation
  rather than pinning the bucket at zero.
- **Budget changes are recorded and reversible.** Creating, editing, reordering
  or deleting a bucket, and editing its hours, now appear in the activity log
  and can be undone — budget was the last register writing silently.
- **Hour cells commit when you leave them.** Typing into a budget or actual
  hours cell used to write on every keystroke; it now commits on blur or Enter,
  and Escape restores the previous value. Typing "40" is one change, not two.
## [0.206.0] - 2026-07-28 "Shawl"

The AI duplicate finder is now reachable from the Gantt chart, not only from
Open Points.

- **"Deduplicate & unify" in the Gantt toolbar.** The same plan-then-apply AI
  merge that Open Points offers now sits in the Gantt toolbar, between the add
  buttons and the search field. It proposes merge groups over the whole task
  list — never the chart's filtered subset — you review and confirm before
  anything changes, and the merge records a single undo entry, exactly as it
  does from the table. It appears only when the AI assistant is configured and
  enabled, never in a pop-out, and never below two tasks.
- **The two triggers announce themselves apart.** In the classic layout both
  surfaces are on screen at once, so the Gantt trigger is announced as
  "Deduplicate & unify tasks – Gantt" while Open Points keeps its original
  name. A source-scanning test enforces this for any future mount, because the
  accessibility gate can only detect a *missing* name, never a duplicate one.

## [0.205.0] - 2026-07-28 "Griffith"

Every search and filter field in the app now clears the same way, and linked-task
search understands a wildcard.

- **One click clears any search or filter field.** The clear ✕ that shipped for
  the report tables and the Time-bookings scope filters reaches 15 more fields:
  Open Points, changes, milestones, RAID, stakeholders, activity log,
  diagnostics, Gantt, global search, Help (both the window and the page), the
  Jira user search, Knowledge documents, RACI, the resource directory, the
  SharePoint picker, the linked-entity pickers and the Time-bookings people
  filter. Clearing now returns the cursor to the field it cleared, on every one
  of them — previously the button vanished under your own click and left the
  keyboard with nowhere to go.
- **Linked-task search accepts a `*` wildcard**, matching the Time-bookings
  scope filters: `api*docs` finds "Review the API docs". Applies to linked tasks
  in changes, RAID, Knowledge and budget buckets, and to RAID "caused by". A
  query without a `*` behaves exactly as before.
- **Fixed:** the Knowledge linked-tasks picker collapsed to a few characters
  wide in the add-link row, and its library cards packed three-up too early for
  their chips to be readable.
- **Accessibility:** the Jira user search and the SharePoint site search had no
  accessible name at all (a placeholder is not one), and the floating Help
  window's search shared its name with the Help page's — so a screen reader
  announced two different fields identically when both were open. All three now
  announce distinctly.

## [0.204.0] - 2026-07-28 "Benford"

Time bookings remembers what you picked, and both of its filters can now be
cleared the same way.

- **Both scope filters have one clear button, and you can reach it from the
  keyboard.** The customer filter previously relied on the browser's own — which
  Chrome and Safari draw, Firefox does not, and neither exposes to the keyboard.
  The projects filter had no clear at all.
- **Your customer and project selection survives a reload.** Previously it was
  only remembered when you pressed Fetch, so picking a scope and navigating away
  lost it. The selection is stored per device and per project; it is not written
  into the project file or the database, and it is not exported.
- **When the restored selection differs from the bookings on screen, it says
  so.** The remembered pick can legitimately be a different customer than the
  loaded bookings came from — the panel now tells you which is which instead of
  letting the picker imply the data changed with it.
- **The apply-to-budget confirmation list grows with its content.** It was
  capped at a fixed height, so a multi-bucket apply showed a handful of rows
  through a small scroller. It stays bounded, so Apply and Cancel remain
  reachable.

### Everywhere else

- **Filter clear buttons now say what they clear.** On views with more than one
  filter — Reports, Budget, RAID, Resources and Time bookings — every clear
  button announced simply "Clear", so a screen-reader user had no way to tell
  them apart. Each now names its own filter.

## [0.203.0] - 2026-07-27 "Czerneda"

Escape now closes exactly one thing, decided by what you opened last rather
than by which listener happened to register first.

- **Whatever you opened last is what Escape closes.** 0.202.3 and 0.202.4 fixed
  this case by case; the rule is now explicit and applies everywhere. A
  dropdown inside a dialog closes the dropdown. A menu inside a dialog closes
  the menu. The dialog — and whatever you had typed into it — stays.
- **The help panel, the RACI picker and the guided tour join in.** All three
  still took the dialog behind them down. The tour overlay had even been
  marking the key as handled, which achieved nothing, because the dialog had
  already closed by the time it did.
- **A floating panel only answers Escape when you are working in it.** The
  notes window already behaved this way; the help panel now does too. Opening
  help, then a task editor, then pressing Escape while typing no longer closes
  help and leaves the editor up.
- **Opening the notes window or the help panel now moves your cursor into it.**
  Previously focus stayed on the button you clicked. If that button was inside
  a dialog — as the "Notes" button in the task editor is — the panel treated
  the next Escape as not its own and the editor closed instead, taking your
  unsaved edits. Opening notes and pressing Escape now closes notes. Screen
  readers are also told the panel opened, which they were not before, and
  opening either panel from the keyboard shows a focus ring on it, so you can
  see where the next keypress will land. Opening by mouse does not.
- Fixes a case introduced by 0.202.4: a picker inside a menu lost both its
  dropdown and the menu to a single keypress.

Internally this replaces listener-phase ordering with an explicit stack of open
layers. Escape goes to the topmost layer that claims it; keyboard focus
containment in dialogs asks a separate question, so a menu floating above a
dialog can never let Tab escape it.

## [0.202.4] - 2026-07-27 "Beukes"

Finishes the Escape fix 0.202.3 started, for the menus and panels it left out.

- **Escape closes a menu or the notes window without closing the dialog behind
  it.** 0.202.3 fixed this for dropdowns; the field-visibility menu (the ⚙
  button in every edit dialog) and the notes window still took the dialog down
  with them, discarding unsaved changes. The notes window is the worse of the
  two, because it opens from inside the task and RAID editors — dismissing it
  threw away whatever was being edited underneath.
- The notes window now only responds to Escape when you are actually working in
  it. It floats above the app and stays open while you work elsewhere, so it
  previously answered Escape from anywhere: with notes open, pressing Escape to
  dismiss a task editor closed the notes window and left the editor up.
- A popover that is given no way to handle Escape no longer swallows the key. It
  could previously leave a dialog beneath it unclosable.

Still outstanding, and unchanged by this release: the help menu, the RACI chip
picker and the global search dropdown continue to close an enclosing dialog
along with themselves, and two nested popovers still resolve in the wrong order.
Both need a shared dismissal stack rather than another per-component fix.

## [0.202.3] - 2026-07-27 "Beukes"

An accessibility batch: the findings an a11y review of the 0.202.2 work turned
up, which were left out of that release as pre-existing or wider than the change.

- **Link pickers are proper comboboxes.** The chip-and-search field used for
  linked tasks, RAID causes, change links, budget-bucket tasks and knowledge
  links gave no indication that results had appeared, offered no way in from the
  keyboard except tabbing through every result, and no way out but deleting what
  you had typed. Arrow keys now move through the results, Enter adds the
  highlighted one, and Escape closes the list without disturbing the enclosing
  editor or what you typed.
- **Sortable table headers say which way they are sorted.** The direction was
  conveyed only by an arrow glyph read aloud as part of the button's name;
  screen readers are now told the column's sort state directly. This covers
  every table built on the shared sortable header — reports, budget, milestones,
  resources, Open Points and the meeting series list. The Changes, RAID and
  Stakeholders registers already announced their sort state; the Activity log
  still does not.
- **Calendar meetings can be rescheduled from the keyboard.** Dragging a meeting
  chip was previously the only way to move it. Alt+Left/Right now stages a
  day-by-day move, Enter confirms it as a single undoable change, and Escape
  cancels — matching how absences already work in the grid below.
- Focus no longer falls to the top of the page when the meeting you had selected
  moves or is edited; it stays in the meetings band, on whichever meeting now
  occupies that position.
- Two meetings with the same title at the same date and time are no longer
  announced identically.
- **Escape closes an open dropdown without closing the dialog behind it.**
  Dismissing a search or person-picker dropdown inside an edit dialog used to
  close the dialog too, discarding unsaved changes. A second Escape closes the
  dialog, as before. (Menus and the notes window still close the dialog with
  them — that is being addressed separately.)
- In pickers where the chip is not click-through, the remove button now names
  the item it will unlink, instead of only its reference number.
- **Purple text meets AA contrast on hover in every theme.** Two separate
  failures: the RAID "caused this" chips dipped below the minimum when their
  background darkened on hover, in the Meridian and Umber light themes; and the
  AI consent notice's policy link dropped below it because its hover faded the
  text itself. Purple contrast is now calculated against the background this
  text actually sits on, and the link's hover thickens its underline rather than
  fading it. A related fade on the Trends delete button was fixed with it.
- The highlighted row in the global search dropdown is legible in the dark
  themes. It was marked by tinting the text brand-navy, which on a dark
  background is all but invisible; the row is now marked by weight and an
  outline instead — the same cue the new link-picker dropdown uses.

## [0.202.2] - 2026-07-26 "Beukes"

A second batch of follow-ups from the 0.202.0 calendar overhaul.

- **The meetings band is now one keyboard stop instead of dozens.** Every
  meeting chip used to be its own tab stop, so a wide window with a daily series
  put around 65 of them ahead of the calendar grid. One chip is now in the tab
  order and the arrow keys move between the rest: left and right walk the chips
  in reading order, up and down cross to the nearest meeting at or after the
  same date in the neighbouring lane, and Home and End jump to the ends.
- **The all-series meeting list can be sorted** by title or by next occurrence.
  Clicking a header cycles ascending, descending, and back to the project's own
  order. Series with no next occurrence stay at the bottom in both directions
  rather than jumping to the top when the sort is reversed.
- The "caused by" picker in the RAID editor was rebuilt on the same component
  the task-link picker uses, which fixed two accessibility gaps in it: its
  search box had no name for screen readers, and every chip's remove button was
  announced identically, so they could not be told apart.
- Each lane of the meetings band is now named for screen readers, and meeting
  chips no longer swallow browser shortcuts such as Alt+Left for Back.
- Sorting the series list no longer recalculates every series' next occurrence
  on each click.
- Internal: the shared `EntityLinkPicker`, a pure `band-roving` keyboard model,
  and the first test coverage for the RAID caused-by field's wiring.

## [0.202.1] - 2026-07-26 "Beukes"

Follow-ups from the 0.202.0 calendar overhaul.

- **Meetings now appear in the activity log and support undo/redo.** Creating,
  editing and deleting a meeting series records an activity entry, and edits are
  undoable like every other register. Notably this makes de-recurring a series
  reversible: turning repeat off discards the series' skipped and moved
  occurrences, which previously could not be recovered.
- The meeting editor now says so up front, showing how many adjusted occurrences
  turning repeat off will discard.
- Escape during a keyboard absence *resize* announced "Move cancelled"; it now
  announces the resize.
- The meetings band's "truncated" banner no longer appears when the visible
  window was in fact complete, and its cell no longer claims to label its row.
- Internal: an empty timestamp cell no longer decodes to an empty string for
  absences and shifts, and Gantt stopped carrying its own copy of `addDays`.

## [0.202.0] - 2026-07-26 "Beukes"

### Added

- **Recurring meetings on the Resource Calendar.** A new calendar-event entity
  supports daily, weekly and monthly recurrence (including "2nd Tuesday of the
  month" style nth-weekday rules), with per-occurrence skip and move exceptions
  so a single instance of a series can be cancelled or rescheduled without
  touching the rest of it. Meetings render as a lane-packed band above the
  assignee rows, open in a dedicated editor, and have their own all-series
  list. Meetings persist across all six storage backends (JSON, CSV, Markdown,
  Turso single- and multi-project, and IndexedDB) and are a first-class export
  section, on by default.
- **Meetings do not sync to Outlook in this release.** The entity already
  stores `attendeeResourceIds`, `sendInvitations` and `outlookEventId` fields
  for a future release, but there is no UI yet to invite attendees or to push
  or pull meetings to/from Outlook — planned for 0.203.0.
- **Absences drag to reschedule, drag across rows to reassign, and edge-drag
  to resize** on the Resource Calendar, with a keyboard equivalent
  (`Alt+Arrow` to move, `Alt+Shift+Arrow` to resize, `Enter` commits,
  `Escape` cancels) and single-entry undo for both.
- Weekday labels and ISO week numbers on the resource-calendar header.

### Fixed

- Dragging an absence's start past its end date now pulls the end along with
  it instead of erroring.

## [0.201.0] - 2026-07-26 "Powers"

### Added

- **The AI assistant can read your project's live health.** A new `get_dashboard_snapshot`
  tool exposes the current RAG ratings (including whether each one was manually
  overridden), completion progress, earned-value figures and the budget rollup, so
  you can ask it things like "how are we tracking?" without opening the Dashboard.
  Money figures it can't honestly compute — because the cost basis isn't sound —
  come back as unknown with a stated reason, never as a silent zero.
- **Plan with AI (Resources → Planning).** Describe how you want work distributed
  across the team and one AI call proposes allocation cells for the planner grid.
  Every proposed cell is checked against your live workspace, converted into each
  resource's own storage unit against their real available capacity, and clamped
  to the same bounds the planner itself enforces — then shown to you as a
  current-value-to-proposed-value list for individual approval. Nothing is written
  until you approve it; only the cells you approve are applied, in a single pass,
  as one undo step.
- **`list_allocations`**, a read-only chat tool that reports the planner grid as
  it stands today: each cell's stored value, what that means in hours, and the
  capacity behind it.
- **`set_task_dependencies`**, letting the AI assistant wire up predecessor
  links (finish-to-start, start-to-start, finish-to-finish, start-to-finish)
  from chat. A link that would create a dependency cycle is refused and reported
  back rather than silently dropped.

## [0.200.0] - 2026-07-25 "Kadrey"

### Added

- **The burn-down follows the budget bucket chain.** A new pure
  `budget-bucket-chain.ts` resolves the buckets' `successorId` links into one
  chain, and the burn-down x-axis — on the Dashboard and in the Budget report —
  spans that chain's window instead of the whole resource-plan period.
- **A burn-down chain warning.** When the buckets were meant to form a chain but
  do not, a banner above the chart names the offending buckets and says the axis
  covers the whole plan period instead. Break reasons: more than one starting
  bucket, a loop, an unreachable bucket, a successor that no longer exists, a
  bucket with no start or end date, and a chain dated outside the plan. It stays
  silent when nobody chained anything — parallel buckets are the normal budget
  model, and a closed bucket's successor is the pre-existing spillover link, not
  a chain declaration.
- **A rich-text project status narrative.** The Dashboard status summary is now
  the shared lean rich-text editor (bold, italic, bullet and numbered lists,
  link) instead of a plain textarea. Stored HTML is re-sanitised where it is
  rendered, through a new shared `RichTextView` sink that the note log also
  uses. A legacy plain-text narrative is upgraded on read and only rewritten
  once you save, so an untouched project's stored bytes are unchanged.

### Changed

- **The "overloaded with overdue work" action opens that person's tasks.** Its
  Open button used to land on Resources → Workload; it now switches to Open
  Points filtered to that person with the health filter set to red. A new
  `open-tasks-for` CTA carries the person, and a new shared `action-cta-exec.ts`
  executes it for both the action row and the desktop-notification click. The
  person filter is matched case-insensitively against the live assignee options,
  and only the row-hiding filters are reset — your sort survives.
- The demo project's budget buckets are chained and staggered into a phased
  programme — discovery, then the platform build, the data migration, the capped
  SOW and the retainer — so the demo models a real chain. Its span still fills
  the whole plan window, so the axis is unchanged; what changes is the shape of
  the curve, which now reads as phased work rather than a flat glide.

### Fixed

- **The Markdown status codec no longer truncates a narrative at a newline.**
  Each status field is one list item, read back with a single-line regex, so an
  embedded newline silently cut away everything after it. Newlines now collapse
  to a space when the status is written.
- **Markdown shortcuts no longer discard what you type.** In the lean editor
  (status narrative, task and RAID notes) a leading `#`, `>`, a backtick, `~~`
  or `---` produced headings, quotes, code and strikethrough — nodes the lean
  sanitizer strips along with their text, so the formatting appeared on screen
  while the committed value was silently emptied, with no error. Those input
  rules are gone; the punctuation now stays literal text.
- **The narrative formatting toolbar applies formatting again.** Its buttons
  took focus from the editor on mousedown, so a commit-on-blur consumer
  re-rendered between mousedown and mouseup and the click never fired.
- **Clear empties the narrative editor.** It left the old text behind, so the
  next keystroke brought it back.

## [0.199.0] - 2026-07-25 "Budrys"

### Added

- **Created date column.** Tasks now record when they were created; the
  column is sortable and off by default (enable it in the column config).
  Existing tasks are backfilled from their last-update date.
- **Hide externals.** An Open Points toggle hides tasks owned by external
  resources and removes their values from the assignee, group and label
  filters.
- **Kanban person swimlanes.** A third Open Points view mode: status columns
  crossed with person rows. Drag a card into someone's lane to reassign it
  and set its status in one move; a per-card person select is the keyboard
  equivalent. Jira-synced tasks stay read-only. An add-lane picker pulls in a
  person who has no work yet.
- **The AI assistant can toggle hide-externals and switch to the swimlane
  view** through `update_settings`.

### Changed

- Task storage gained a `createdDate` column across CSV, Markdown and both
  Turso schemas; existing Turso databases self-heal on the next save.

## [0.198.0] - 2026-07-24 "Abraham"

### Added

- **Suggested chat prompts stay available all session.** The AI Assistant's
  prompt-suggestion chips were extracted into their own component and now
  render in a persistent strip below the output, instead of only appearing on
  an empty transcript.

### Changed

- **New Knowledge links default to the project library.** The add-link target
  now defaults to "Standalone" (the project's Knowledge library) instead of an
  empty placeholder, so an entry attaches to the project by default; linking to
  a task stays optional. The default also survives Cancel + reopen.
- **The no-project landing-page logo follows the active theme.** It now reads
  the active scheme's branding logo (with a slogan-aware alt text and width
  cap, mirroring the sidebar/header), instead of a hardcoded mark.
- **The time-booking apply-to-budget bar is a cleaner card** — an outline card
  with the shared button styling, replacing the filled block.

### Fixed

- **Time bookings now remember the last fetched customer and projects.**
  `Workspace.timelogLinks` was omitted from the autosave (both the save
  payloads and the autosave effect's dependencies), so the fetched scope was
  never persisted and the picker came back blank after a reload. It is now
  saved on every write path; a refresh reloads the last scope automatically.

## [0.197.0] - 2026-07-24 "Turtledove"

### Added

- **Link tasks to a budget bucket and set a manual percent-complete override.**
  The bucket editor gained a task-link picker (reusing the same chip picker as
  the RAID/Change linked-tasks fields) and an optional manual "% complete"
  field. The manual value, when set (including 0), always wins over the
  linked-task derivation — a PM's assessment beats a task count.
- **A pure earned-value engine.** `budget-earned-value.ts` derives a bucket's
  percent-complete (manual override first, else the share of linked tasks
  that are finished — Done or Cancelled; `null` when neither is available)
  and its earned value (budgeted cost × percent-complete, `null` when
  progress is unknown — never a guessed 0% or 100%).
- **A "Cost performance" (CPI) tile in the Budget panel**, alongside Margin,
  Burn and Consumption. Unlike the pre-existing burn-rate tile (now labelled
  "Cost burn"), this is the real EVM cost-performance index — earned value ÷
  actual cost. It renders "—" whenever earned value or cost isn't knowable
  (missing progress signal, unpriced rates) instead of showing a misleading
  index, matching the panel's established anti-approximation stance. At the
  project level the rollup is all-or-nothing: if any budgeted bucket's
  progress is unknown, the whole-project CPI shows "—" rather than summing a
  partial figure.

### Changed

- `BudgetBucket.taskIds` and `BudgetBucket.percentComplete` are now persisted
  across all six write paths (JSON, CSV, Markdown, Turso single-tenant,
  Turso multi-tenant, IndexedDB). Both are sparse-emitted, so a bucket that
  never sets them stays byte-identical on round-trip.
- **Sample workspace consolidated to JSON-only.** `sample-workspace-small.json`
  is now the sole hand-curated master; the `.md` and `.csv` sample artifacts
  and all `.sqlite3` sample databases were removed. The generator
  (`scripts/generate-sample-workspace.ts`) now reads the JSON master directly
  and emits only the `-big`/`-huge` scaled JSON tiers.

## [0.196.0] - 2026-07-24 "Emrys"

### Added

- **A dated rich-text note log on tasks and RAID items.** Both entity types now
  carry a running note log, managed through a shared draggable, non-modal Notes
  window that leaves the app interactive underneath. You can add, edit and delete
  notes; each note is authored as your configured self resource, and editing or
  deleting a note is limited to its own author. Notes with no author (e.g. seeded
  or imported) are claimed by you on first edit. Pressing Enter commits a note
  (Shift+Enter for a new line).

### Changed

- **The task "Notes" free-text field is promoted to a rich "Description".** The
  field now accepts formatted (sanitized) HTML instead of plain text, and the
  Open Points table shows a description preview alongside a note-count badge
  column linking to the note log.
- Task **Description ↔ Jira description round-trips as plain text.** Jira stores
  descriptions as ADF, so rich formatting entered in the app (or arriving from
  Jira) is flattened to plain text on sync — the text content is preserved, the
  formatting is not.

## [0.195.3] - 2026-07-23 "McGuire"

### Fixed

- **The dashboard "Budget burn" card showed the burn-down chart as "No budget
  configured" whenever budget hours followed the plan.** `computeBurndownSeries`
  read the raw stored per-period `budgetHours` map, but with *budget hours follow
  plan* enabled a staffed row's stored map is empty — its hours derive from live
  resource capacity. So the budget report showed real hours while the burn-down
  summed to zero and blanked. The burn-down now derives budget hours through the
  same `effectiveBudgetHours` rule the report uses (over each bucket's active
  periods), so its totals match the report. It needs the resource list, workday
  hours, holidays and absences, which both callers now pass. (T&M, no spillover:
  the burn-down still models neither fixed-price amounts nor predecessor
  spillover.)

- **AI Assistant replies rendered fenced code blocks and tables as raw text.**
  The chat markdown renderer dropped ```` ``` ```` fences and GFM pipe tables, so
  they surfaced with literal backticks and pipes. Both now render — code blocks
  verbatim in a monospace block, tables as real tables — still dependency-free
  and auto-escaped (a reply is never treated as HTML). A pipe inside an inline
  code span no longer over-splits a table row; protocol-relative link URLs
  (`//host`) are rejected as untrusted.

### Added

- **Resource directory: a "Hide external" toggle.** Filters external people out
  of the directory table; remembered per device.

### Changed

- The chat attach and dictation-microphone buttons use the shared Heroicons set
  (paper-clip, microphone) instead of emoji, matching the rest of the chrome.

## [0.195.2] - 2026-07-23 "McGuire"

### Fixed

- **A blended discipline with an unpriced grade was costed at a diluted rate
  and presented as sound.** In blended planning a discipline's rate is the mean
  of its grades' rates. `Role.internalRate` is a required number, so `0` is the
  only representation of "nobody has priced this grade" — and averaging that `0`
  in produced a rate nobody entered (a priced grade at 100 beside an unpriced one
  yielded 50). That figure passed every downstream guard, so a bucket staffed
  entirely by the unpriced grade reported a plausible but wrong cost with no
  warning. The internal blend is now *poisoned*: if any grade of the discipline
  is unpriced, its cost reads as unknown rather than diluted. A per-bucket
  internal-rate override still wins over the blend and clears the poison. (The
  external mean carries the same dilution and is deliberately left for its own
  slice — gating it cascades into revenue, consumption and T&M win/loss, which
  are ungated by design.)

### Changed

- **Every "cost, margin and burn cannot be shown" state now explains itself
  instead of showing a bare dash.** The two internal booleans that encoded this
  became one reason (`no allocations` · `no internal rates` · `hours at a zero
  rate` · `unpriced blended grades`), so each budget card and the project rollup
  render the message that actually applies: an empty bucket is told to add a
  role or discipline line, a partly-priced blend names the disciplines to price,
  and the old "set them on the rate card" text no longer appears on a bucket that
  has no roles at all. The knowability verdict and the message can no longer
  drift apart — they derive from the single reason.

## [0.195.1] - 2026-07-21 "McGuire"

### Fixed

- **An unstaffed fixed-price bucket reported a 100% margin and a full win.**
  A regression introduced by 0.195.0's own fix. Suppressing the "no internal
  rates" notice for a bucket with no allocations was correct — it has no roles
  to rate — but the same flag also licensed the cost FIGURES. A fixed-price
  bucket with a contract amount and no allocations then computed
  `revenue - 0` and rendered a green 100% margin and a full win, on work nobody
  had started; the project rollup inherited it. That is the exact failure
  0.195.0 set out to remove, reached through zero *rows* rather than zero
  *rates*, and every fixed-price bucket starts empty.

  Suppressing the notice and licensing the figure are two decisions, so they are
  now two flags: `costIsKnowable` (rows **and** a rate — gates margin, burn and
  fixed-price win/loss) and `ratesAreMissing` (rows but no rate — gates the
  notice). Three states, two questions.

  The gap was in the fixture, not the reasoning: the tests covering the empty
  bucket used a T&M fixture, where revenue is also 0, so `pct(0, 0)` returns
  null and the misleading figure never renders. Only fixed-price exposes it.

- **A project containing an unstaffed fixed-price bucket reported a margin too.**
  The same defect one layer up, and the more likely one to be seen: `revenue`
  and `cost` are summed across *every* bucket, so one uncostable bucket
  contaminates the total — and the project flag was a `.some()`, which declared
  that total knowable as soon as any *other* bucket happened to be rated. An
  unstarted €50k contract beside one active bucket rendered a green 98% project
  margin with no caveat. The project total is now knowable only when something
  costable contributes to it **and** nothing uncostable contaminates it;
  zero-revenue buckets are exempt so an empty scratch bucket cannot blank a good
  margin.

  Gating the bucket display was never enough on its own — the arithmetic
  feeding the aggregate needed the same treatment.

- **A partly-rated bucket reported a confidently wrong margin.** One rated row
  vouched for the whole bucket, so hours booked against an *unrated* role were
  costed at zero while every flag reported a sound figure: 40 real hours gave
  revenue 6,000, cost 0, margin 100%, no dash and no notice. Unlike the cases
  above this was not an unknown shown as an ideal but a wrong number shown as a
  genuine reading — reachable whenever a new grade reaches the rate card before
  its internal rate does. A row now makes its bucket uncostable when it books
  hours at no rate, which is exactly when it corrupts the total; an unrated row
  with no hours contributes nothing and no longer blanks a sound figure.

- **The Budget Report's detail table was ungated.** The summary tiles above it
  were fixed; the table beneath them was not. An unstaffed fixed-price bucket
  printed a 100% margin and a full-contract win there, and the phantom margin
  fed the column sort — putting the fabricated row at the top, where a PM
  scanning for the worst margin looks first.

- **The report's Win/Loss column sorted on the phantom figure too.** The margin
  sort key was gated when the detail table was fixed; the Win/Loss key beside it
  was not. An uncostable bucket's win/loss is revenue minus zero — the whole
  contract — so sorting descending put a row *displaying a dash* above every
  real win, which is where a PM scanning "who is winning the most" looks first.

- **`package.json` was left at 0.194.0** while `version.ts` moved to 0.195.0.
  Both are bumped together here.

## [0.195.0] - 2026-07-21 "McGuire"

### Fixed

- **A bucket whose plan exactly hit its budget was scored red.** `computeBudgetReport`
  accumulates `budgetHours` as a per-row subtotal and `plannedHours` as a flat
  running total. With *budget follows plan* on and every row resourced these are
  the **same sum**, but the differing association order makes them differ by a
  few ULP — real values, `225.91519999999999868` against `225.91520000000002710`.
  `ratioHealth`'s strict `>` then read that 6e-14 h as an overrun. The band
  comparisons now carry a relative tolerance (`RATIO_EPSILON`, 1e-9) — orders of
  magnitude above double noise and far below any real overrun.

- **An exact hit could never be green, and the badge often compared a number
  with itself.** `ratioHealth` models *consumption*, where reaching 100% means
  the budget is spent and must stay amber; plan-vs-budget asks the opposite
  question, where hitting 100% is the goal. Plan adherence moved to its own
  `planVsBudgetHealth` (at or under budget is green) applied to only the two
  plan-vs-budget sites — the other eleven `ratioHealth` call sites are
  consumption and are unchanged. When the budget genuinely *is* the plan the
  badge is suppressed entirely, since it can only ever restate equality.

- **A 100% contribution margin was reported when cost could not be computed at
  all.** Cost and budgeted cost both derive from `internalRate`; with no rate
  card `role?.internalRate ?? 0` yields 0, so margin became `revenue - 0` and
  scored a perfect green. The panel claimed ideal profitability *precisely
  because it knew nothing*. Margin, cost burn and fixed-price win/loss now read
  "—" with no RAG when cost is unknowable, and a notice points to the rate card.
  A T&M bucket's win/loss runs on external rates and stays a real figure.

- **The consumption tile printed a percentage of one quantity above the money
  value of its complement** — a consumed percent over the *remaining* amount.
  The amount is now the consumed value, matching its own percent; the remainder
  was already carried by win/loss.

- **A closed period that booked nothing scored green.** Correct for a period
  that has not happened yet, misleading for one that has ended. A new
  `cellHealth` scores an empty *closed* period amber; a future period, and a
  period ending today, stay green.

- **Derived plan hours rendered as raw floats.** A mirrored cell showed values
  such as `10.559999999999999`, which the narrow input truncated mid-number.
  Rounded for display only — stored and aggregated values are untouched, and
  editable cells are left alone so rounding cannot fight the user mid-type.

### Changed

- **"Cost performance (CPI)" is now "Cost burn".** The tile computes budgeted
  cost over cost to date, with no percent-complete term — early in a project it
  reads high purely because little has been spent, which is not what a Cost
  Performance Index means. The label and hint now say what it is, and the hint
  states plainly that it is not an EVM index. This also frees the name for a
  genuine earned-value index.

- **The per-period grid cell labels its own field "Budget", not "Plan".** The
  cell writes `budgetHours` and its tooltip already read "Budgeted hours for
  this period", while the bucket header's "Plan (h)" is a different quantity.
  One word, two meanings, one view.

## [0.194.0] - 2026-07-21 "Stapledon"

### Fixed

- **Timelog actuals are attributed per role line, not dumped on the first one.**
  Applying bookings to a budget previously folded a bucket's whole period total
  into `allocations[0]`, so `computeBucketReport` costed **every** person at the
  first role's rate. Actuals cells now carry an optional `byResource` breakdown
  and each person routes by their allocation's `resourceIds`, else their
  directory role (blended buckets: that role's discipline). Hours that match no
  line — an unlinked person, no directory role, a role absent from the bucket —
  are **withheld** and surfaced with both a bucket count and the net withheld
  hours, rather than costed at some other role's rate.

  Three rules make this safe, each pinned by a test that fails if it moves.
  Externals are capacity-only, so the directory check runs **before** the
  explicit `resourceIds` match — a hand-linked external must never be costed
  internally. A period is "owned" (and its other lines zeroed) only when a
  **non-zero** booking routed there, because a +4/−4 credit correction nets to
  zero and says nothing about the period. And a period whose hours were entirely
  unattributable is skipped rather than zeroed, so an upgraded user whose cached
  cells predate `byResource` does not lose every figure in one click.

  Because `actualHours` is hand-editable, applying can overwrite a number a
  person typed. The confirm step therefore **itemises every row** it will write
  (bucket · line · period · current → next) instead of showing a bare count, and
  refuses to apply at all if the budget changed while the preview was open.

- **A failed digest email no longer reports success.** The mail sender now
  resolves only when Graph actually accepted the message and throws on every
  other outcome, so "Digest email sent." can no longer appear with nothing in the
  mailbox. Its error text carries neither the recipient nor the token, because it
  reaches the diagnostics ring.

- **Emailing a digest no longer reschedules it.** `generate()` took one flag that
  conflated three things, so emailing had to advance the cadence just to get its
  AI narrative — clicking Email with the feature disabled pushed the next digest
  out a full week. The flags are now independent (`advance` · `notify` ·
  `narrative`), and a cached narrative-less digest is regenerated for the email
  when a narrative is actually possible.

- **Double-clicking Email sent twice.** The guard was the `busy` state, which
  `generate()`'s own `finally` cleared mid-flight; it is now a ref set
  synchronously before the first await.

- **The ResourcePicker ✕ clears the whole field.** It previously dropped only the
  foreign key, leaving the same name rendered — so the sole visible effect was
  the button vanishing, and the control read as dead. It now clears name, email
  and link together, renders whenever there is anything to clear, and marks a
  dangling link (resource deleted) with a warning glyph rather than colour alone.
  Picking a person in the stakeholder editor now adopts their email address,
  which was silently dropped.

- **Filtering Open Points by a value that then disappears no longer hides every
  row.** Editing the last task carrying a filtered-for assignee, group or label
  removed the option while the filter kept pointing at it: the table went empty
  while the control, left with no matching option, fell back to reading "All".
  An unmatched value now resolves to "All" for both the rows and the control from
  a single source, so the two cannot disagree — and the raw selection is kept, so
  undoing the edit restores the filter.

### Changed

- **Ten-item UI batch.** The Ask-Claude menu drops its attachment prompt (there
  is no attach control there; chat keeps it). Workload gains the Hide-external
  filter Planning already had. Toolbars across Workload, Gantt and Activity now
  share one order — destructive and integration actions first, then a contiguous
  Print · reset-columns · reset-size group — and the Gantt column reset stops
  wearing the reset-size icon. The floating Help window gains a reset-size
  control. Budget's Actual label no longer collides with its tooltip. Table
  filters show a single clear ✕ instead of two in Chrome/Safari and one in
  Firefox.

- **Removed a wrong Turso warning.** Settings claimed a region-qualified host
  (`<db>-<org>.aws-eu-west-1.turso.io`) would be rejected and told users to strip
  the region segment. That is a valid, officially-issued URL — it is what
  `turso db show` prints — so the advice was wrong and is gone.

## [0.193.0] - 2026-07-20 "Strugatsky"

### Added

- **Insights → action loop (SP4): the digest.** The Insights view now opens with a
  rolling seven-day summary card — how many insights fired, how many you acted on,
  how many are open right now, plus two lists: what **resolved after you acted**
  and what **got worse after you acted**. This closes the loop the first three
  slices opened, and fixes an SP3 gap: an acted→resolved win was immediately
  hidden behind the History toggle, so the one thing worth seeing was the one
  thing you could not see. Wins now surface where the work happens.

  Pure i18n-free `insights/digest.ts` owns `computeInsightDigest(insights, today,
  windowDays?)`. The window is inclusive at both ends (seven days = today plus the
  six prior), computed from a UTC-midnight parse with no clock in the module.
  Future-dated events are excluded so a skewed clock or an imported record cannot
  inflate the counts, and an unparseable date yields an empty digest rather than
  throwing. `openNow` is deliberately **not** windowed — it is a current state,
  not this week's news — so the card separates it visually from the two windowed
  counts. The digest adds **no persisted field and no backend write path**: it is
  pure derivation over timestamps SP1–SP3 already store.

### Changed

- **Background AI recommendations run on a cadence you set.** Previously a fixed
  15 minutes; now `settings.ai.insightRecommendationIntervalMinutes`, defaulting
  to **60**, adjustable in Settings → AI whenever background recommendations are
  enabled. Because each tick can make billed API calls, every path to the value
  goes through one clamp (`clampInsightRecInterval`, whole minutes in [15, 1440])
  — the sanitizer on load, the settings input on edit, and the runner on read —
  so a directly-typed or tampered value can never drive an unbounded call rate.
  The runner's mount tick and its interval now live in two separate effects, so
  changing the cadence re-arms the timer without spending an extra billed round.

### Fixed

- A resolved insight carrying a `worsened` outcome could be counted as both a win
  and a regression in the digest. Resolved means the condition cleared, so it is a
  win. Unreachable in-app, but `sanitizeInsights` re-derives direction from
  baseline/current and admits the shape from an imported or hand-edited blob.

## [0.192.0] - 2026-07-20 "Pullman"

### Added

- **Insights → action loop (SP3): outcome measurement.** Acting on an insight now
  records the one number that insight is about (`metricAtAction`), and a later
  reconcile measures the live number against that baseline — labelling the result
  **improved / unchanged / worsened** with the delta. This closes the loop the
  first two slices opened: SP1 surfaced problems, SP2 proposed fixes, SP3 answers
  whether the fix actually worked. Pure i18n-free `insights/outcome.ts` owns the
  per-type metric map (`milestoneSlip → daysOverdue`, `overdueTrend → current`,
  `stalledWork → count`, `budgetVariance → variancePct`,
  `raidAging → daysSinceUpdate`; every metric is lower-is-better) plus the
  extraction, snapshot and comparison helpers.
- **Baseline captured on ANY act.** Both the manual **Act** control and an applied
  AI recommendation route through one shared `metricAtActionPatch` helper, so
  outcomes cover all user action rather than only AI-driven fixes. The first act
  wins — a re-act never overwrites the original "before" value.
- **Auto-resolve is now labelled.** An acted insight whose condition clears was
  already auto-resolved; it now carries an `improved` outcome. That case is
  deliberately **direction-only, with no magnitude**: four of the five detectors
  are threshold-gated (stalled work stops firing below 3 items, budget variance
  below 10%, RAID aging below 7 days, overdue-trend once it stops growing), so
  "cleared" means *below threshold*, not zero — quoting a number there would
  overstate the win. The badge reads "Resolved since you acted".
- A re-firing insight drops **both** its stale outcome and its stale baseline: a
  recurrence is a new problem instance and gets a fresh "before" value, so a
  months-old baseline can never be used to measure today's recurrence.
- **Outcome badge** in the Insights view: a coloured dot carries the direction
  (non-text, so it stays AA-legible in every theme) beside muted wording that
  states the result on its own — never colour-only. EN + DE.

### Changed

- **Recommendation prompts now see the linked entity.** The AI recommendation
  context previously always read "(no linked entity)"; it now includes a bounded
  digest of the milestone or RAID row being fixed — including the existing
  **mitigation plan**, so the model stops re-proposing a fix that is already in
  place. The RAID owner resolves through the live-name helper rather than the
  cached string, so a renamed resource can't leak a stale name into the prompt.
- **A rejected recommendation is no longer a dead end** — the *Recommend fix* CTA
  returns on a dismissed suggestion so a different proposal can be generated,
  under the same AI/popout gating as the first one.

### Fixed

- Dropped a vestigial `| null` from `runInsightRecommendation`'s return type (every
  failure path throws) and the redundant null checks at its call sites.
- Removed an unused injected clock argument from the insight recommendation
  background runner.
- Removed an unreachable outcome-badge mount from the dashboard insights card: the
  card renders only `active`/`acknowledged` rows while outcomes exist only on
  `acted`/`resolved` ones, so the branch could never execute.

## [0.191.0] - 2026-07-20 "Le Guin"

### Added

- **Insights → action loop (SP2): proactive AI recommendations.** An insight can
  now carry an AI-proposed, *executable* recommendation. Claude proposes a
  concrete set of tool calls that resolve the insight; you review them as a
  plan-then-apply diff and apply them through the existing chat `runTool`
  dispatcher (every value re-sanitized per entity). Pure `insights/` engines:
  `recommend.ts` holds the forced-tool contract and re-grounds every entity id
  against the live workspace (a hallucinated id can never reach a tool),
  `recommend-context.ts` builds the per-insight digest, `recommend-call.ts`
  routes the single forced call through the shared never-log envelope, and
  `recommend-plan.ts` builds the diff preview by reusing the inline-ai-edit
  descriptor engine.
- **Two triggers, one generate path.** A per-insight **Recommend fix** button
  generates on demand; an opt-in `ai.insightRecommendations` background runner
  (default off, mirrors scheduled jobs) proposes recommendations for active
  insights while the app is open — serial, capped per tick, and never logging
  the key or response body. The recommendation and its applied/rejected outcome
  persist on the insight (riding the existing insights blob — no new backend
  path, byte-stable when empty) so the record survives a background proposal and
  seeds later outcome measurement.
- **Overdue-trend insights now fire.** The SP1 overdue-trend detector, inert
  pending a prior count, now reads the per-project landing-state overdue
  snapshot, so a rising overdue count surfaces an insight.

## [0.190.44] - 2026-07-20 "Pinsker"

### Added

- **Insights → action loop (SP1).** The app now surfaces deterministic,
  rule-based project insights and gives each a lifecycle you can act on. Pure
  `insights/` engines — `detectInsights` runs five detectors (milestone slip,
  stalled/no-progress work, budget aging, RAID aging, and an overdue-trend
  detector that is inert in SP1 pending a prior-overdue count to compare
  against) and `reconcileInsights` merges freshly-detected signals into the
  stored record, deduping by a stable key and preserving each insight's
  lifecycle state (active → acknowledged / acted / dismissed → resolved).
- **Persisted, exportable insight record.** Insights live in a
  `Workspace.insights` JSON blob written across all six storage backends
  (JSON / CSV / Markdown / Turso single + tenant / IndexedDB) and gated by a new
  default-off `insights` export section — an empty record stays byte-stable, so
  no golden fixtures change. A debounced detect→reconcile runner in
  `task-manager` refreshes the record (hydrated, non-popout only) via a
  functional `setInsights` updater whose content key excludes lifecycle fields,
  so acting on an insight can't re-trigger a detection loop.
- **Surfaces.** A Dashboard insights card and a dedicated **Insights** view (an
  Overview sub-child of the Dashboard; not Turso-gated) let you review, act on,
  dismiss, or resolve insights. The assistant is insights-aware — a volatile
  insights prompt block is appended to the chat context after the cache
  breakpoint so it reflects the live record without breaking prompt caching.

## [0.190.43] - 2026-07-19 "Pinsker"

### Added

- **Per-project Table/Board view mode.** The Open Points view mode joins the
  "This project" appearance overrides (alongside dashboard density and view-hint
  banners). The pane's own Table/Board toggle is now scope-aware: while a project
  has the appearance override on it writes the per-project store, otherwise the
  device default — so a per-project view no longer snaps back when toggled. With
  no override, behaviour is unchanged.

## [0.190.42] - 2026-07-19 "Pinsker"

### Added

**Per-project setting overrides.** A new **"This project"** section in Settings lets a project override settings that are otherwise per-device, each behind a "Use device default | Override for this project" toggle:

- **Policy overrides** — next-actions ranking weights, notification lead times / channels / RAID-review interval, and timezone (display + additional zones) — **travel with the project** (persisted in a new `Workspace.settingsOverrides` blob across all six storage backends; excluded from exports). They drive the Action-Center ranking, all reminders, and the day-boundary / timezone logic.
- **Appearance overrides** — dashboard density and per-view hint banners — are **per-device-per-project** (local, reactive via `useSyncExternalStore`).

A pure `resolveEffectiveSettings(device, policy, appearance)` merges override-else-device; with **no override every read is identical to before**. Theme/scheme and the Open Points table/board mode are intentionally not per-project (the latter keeps its own in-pane toggle).

## [0.190.41] - 2026-07-19 "Pinsker"

### Added

**Standalone Knowledge-library items.** The Knowledge view can now hold items
that live on their own — a document, a Confluence page, or any web URL — instead
of only aggregating links attached to tasks/RAID/changes/etc. Linking a
standalone item to a task is an optional second step, and an item can link to
**multiple** tasks.

- New persisted `Workspace.knowledgeItems` field (each item is a knowledge link
  plus an optional `taskIds[]`), round-tripped across all six storage paths
  (JSON · CSV · Markdown · Turso single · Turso multi-tenant · IndexedDB) and
  **included in exports** via a new `knowledgeItems` export section (default
  off). An items-less workspace stays byte-identical (no section emitted).
- The Knowledge panel gains a "Standalone item" add mode (type · name · URL +
  an optional multi-task picker) and a "Knowledge library" card grid with
  per-item remove and an inline multi-task link editor.

**AI `update_settings` tool.** The assistant can adjust a **safe subset** of app
settings on request: dashboard density, per-view hint banners, the Open Points
table/board mode, which feature modules are enabled, and next-actions ranking
weights. Every value is re-validated and clamped through the same coercers the
settings UI uses (`sanitizeFeatures`, `NEXT_ACTIONS_FIELD_COERCE`); API keys,
secrets, storage, and integration config are **never** reachable, and the tool
is refused in read-only pop-outs.

### Changed

**Internal identifier cleanup.** The last `lop`/`LOP` identifiers left after the
`aipm-cockpit` rename were renamed: the Turso write-lock (`aipm-turso-write:`),
the diagnostics devtools global (`window.__aipmDiag()`), and the Markdown tasks
heading (`# AIPM Tasks`). The Markdown decoder no longer accepts the legacy
`# LOP Tasks` heading.

### Removed

**Completed storage migration.** The one-time `lop-app`→`aipm-cockpit`
localStorage/IndexedDB rename migration (`storage-migration.ts` and its boot
duplicate) has served its purpose and is removed.

## [0.190.40] - 2026-07-19 "Pinsker"

### Changed

**Heroicons for UI chrome.** The app's ~69 hand-rolled inline `<svg>` chrome
icons are replaced with [`@heroicons/react`](https://heroicons.com) components
(`@heroicons/react/24/outline`) for a consistent, maintained icon set.

- **Scope:** nav sidebar (all 33 `AppView` glyphs), top bar, dropdown menus,
  panel toolbars, action buttons, and the Jira read-only/two-way badges.
- **Left hand-rolled:** data-visualisation graphics — the completion sparkline,
  Gantt bars/dependency arrows/milestone diamonds, trend + burndown charts, and
  the relations/info-flows node graphs (these are art, not icons).
- **Bespoke glyphs** with no clean heroicon (the ⋮ column-resize grip, the 6-dot
  drag handle, and the Gantt critical-path / baseline / inline-milestone toggles)
  are force-fit to their nearest heroicon.
- Every icon keeps `aria-hidden` and its original size/rotate/opacity/spin
  classes; icon-only buttons keep their accessible names. No behavioural,
  serialization, or palette change (heroicons render `currentColor` only).

## [0.190.39] - 2026-07-19 "Pinsker"

### Changed

**Consolidation sweep (Tier E)** — the last real duplication tail after the DS
and Tier A–D programs. All behavior-preserving; new shared modules, no feature
or serialization change.

- **`device-store.ts` JSON envelope.** `readDeviceJson`/`writeDeviceJson`/
  `removeDeviceKey` centralize the per-device localStorage SSR-guard + try/catch
  parse/stringify boilerplate that ~14 stores hand-rolled (saved/panel/reports
  views, landing-state, search-recents, view-hints, calendar-sync-baseline,
  timelog-actuals, digest-state, action-snooze, contacts, learning, and the
  read paths of scheduled-jobs/operating-guide). Each store keeps its own
  validation/cap/dedupe. `reminder-snooze` (raw number, not JSON) left as-is.
- **`capped-list-store.ts` factory.** `createCappedListStore` builds the
  validated-load / `max-id+1` add / remove / rename / cap-slice CRUD on top of
  the device-store envelope; `saved-views` and `reports-views` adopt it.
  `panel-views` (per-view cap) and `search-recents` (dedupe) stay bespoke.
- **`ai-forced-call.ts` — one audited Anthropic forced-tool envelope.** The
  duplicated never-log fetch+throw path (scheduled-job analysis, weight
  suggestion, task dedup, meeting report, digest narrative, project proposal)
  is now a single `runForcedToolCall`; each caller keeps its own parse/ground.
  A secret/body-leak fix now lives in one place instead of six. The multi-turn
  chat loop (`callClaude`) is deliberately not folded in.
- **`EditModalShell` adoption.** The absence / milestone / resource edit-modals
  stopped hand-rolling the resizable/draggable panel + header and now use the
  shared shell (change/raid/stakeholder already did). Shell gained defaulted
  `widthClassName`/`formClassName` props so existing adopters stay byte-identical.
- **Smaller extracts.** `guardTurso` preamble helper (`use-storage-turso-ops`),
  `useTaskPickerOptions` (change/raid edit-modals), `useDraftState` (absence/
  milestone/resource edit-modals), `EntityPaneCalendarHintsProps` interface
  mixin (change/raid/stakeholders panes), and jira `parseIssueFields`
  (create/update issue routes — SSRF guard untouched).

## [0.190.38] - 2026-07-19 "Pinsker"

### Changed

**Consolidation sweep (Tier D)** — the final consolidation follow-up. Internal;
one one-time reset noted below.

- **`useColumnManager` composes the shared hooks.** The Open Points table's
  column state hook stopped hand-rolling its column widths / debounced persist /
  drag-resize (now the shared `useColumnResize`, tableId `"open-points"`) and its
  column-config dropdown outside-click/Escape dismiss (now the shared
  `usePopoverDismiss`); it keeps only the hidden-columns set. ★ Because the width
  storage key is now tableId-scoped (`…:col-widths:open-points`), a previously
  saved Open Points column-width layout resets to defaults once (widths are
  re-draggable from there; other tables unaffected).
- **`IconButton` gains a `bordered` variant** that codifies the quiet
  bordered-box recipe the toolbar reset icons already used verbatim.
  `ResetSizeButton`, `ResetColWidthsButton`, and the Gantt name-column reset
  button now render through it instead of hand-rolling the class.

## [0.190.37] - 2026-07-19 "Pinsker"

### Changed

**Consolidation sweep (Tier C)** — the moderate cross-file dedup follow-up to
Tier A+B. Behavior-neutral; internal only.

- **Stakeholder / RACI chips → `Badge`:** the stakeholder table's category /
  influence / interest chips dropped their local hand-rolled `Chip` (a
  reimplementation of the `Badge` primitive) and use `Badge` directly. The RACI
  "Accountable missing/multiple" amber warning — duplicated verbatim in the RACI
  panel and the stakeholder report — is now one shared `RaciAccountableWarning`.
- **Action-Center popovers:** escalate / reschedule / rebaseline shared an
  identical trigger-button + `PopoverPanel` scaffold (with the ARIA +
  `stopPropagation` the row click-guard depends on); that wrapper is now one
  `ActionPopoverTrigger`, and their four identical confirm buttons share a
  `POPOVER_CONFIRM_BTN` class const.
- **Outlook import modals:** the contacts and calendar import modals shared a
  near-verbatim multi-select + modal chrome. The selection state is now the
  shared `useImportSelection` hook and the chrome is the shared
  `PickListImportModal` shell (per-row content stays per-modal). Their pick-list
  checkboxes also adopt the shared `Checkbox` primitive.

## [0.190.36] - 2026-07-19 "Pinsker"

### Changed

**Consolidation sweep (Tier A + B)** — primitive adoption and pure deduplication
uncovered by a post-DS-program consolidation audit. No behavior change beyond the
noted accessibility fixes; internal only.

- **Accessibility fixes (via primitive adoption):**
  - The RAID / Change / Milestones / Stakeholders / Resource-directory bulk-select
    checkboxes (select-all + per-row), plus the History compare and Version-diff
    restore checkboxes and the Time-bookings select checkboxes, now use the shared
    `Checkbox` primitive. This replaces a hand-rolled class that set the inert
    `text-ui-dark-blue` (which does nothing on a checkbox) with the real
    `accent-ui-dark-blue` + a visible focus ring. The History / Version-diff /
    Time-bookings checkboxes, previously native-styled, also gain the standard
    rounded-border box for visual consistency.
  - The task-row dependency editor popover now renders through the shared
    `PopoverPanel` portal, so it can no longer be clipped by the table's scroll
    container; its pencil trigger uses the `IconButton` primitive.
- **Primitive swaps:** task-row priority pill → `Badge`; Open Points / workspace
  reset buttons → `ResetSizeButton`; the Action-Center learning pill → `Badge`; the
  resource picker's outside-click → the shared `usePopoverDismiss`.
- **Pure deduplication (no behavior change):**
  - The Turso `txt` / `int` / `rowObjects` SQL helpers, copied across eight
    out-of-workspace schema modules, are now single-sourced from `turso-schema`.
  - `scheme-contrast` reuses the colour math (`hexToRgb` / `relLuminance`) from
    `scheme-tokens` instead of re-implementing it.
  - The RAID and Change registers share one `groupByLinkedTaskIds` index builder.
  - The edit-modal chip pickers share one `filterPickerOptions` helper.
  - The inline-AI edit popover reuses the shared `useFocusTrap` (extended with an
    optional initial-focus target) instead of a hand-rolled Tab trap.

## [0.190.35] - 2026-07-19 "Pinsker"

### Changed

**Modal accessibility follow-ups** — post-adoption fixes surfaced by the 0.190.34 review:

- **Shared `Modal` seeds focus on the first focusable child** instead of the dialog root. The root is `tabIndex=-1` and carries no focus ring, so a keyboard user could land focus on the un-ringed backdrop (WCAG 2.4.7); focus now starts on a real control (still overridable via `initialFocusRef`, still falls back to the root only for a panel with no focusable content).
- **Comm send-preview locks dismissal while sending.** The Graph send keeps running and still reports its outcome, so Escape/backdrop/Cancel no longer dismiss the modal mid-send, where they would have falsely implied the email was cancelled. Cancel is disabled while busy. To keep that lock from ever becoming a keyboard trap (WCAG 2.1.2) on a stalled network, every Graph mail POST is now bounded by a 30s abort timeout, so the send always settles and the lock releases.
- The **Send button now reports `aria-busy`** and swaps to a "Sending…" label while a send is in flight (was a silently-disabled button).
- The dialog is **named via its visible heading** (`aria-labelledby`) rather than a duplicate label string.

## [0.190.34] - 2026-07-19 "Pinsker"

### Changed

Design-system **`Modal` adoption** — migrated the last hand-rolled dialog panel, the communication send-preview modal, onto the shared `Modal` primitive. It now inherits the canonical dialog chrome instead of re-implementing a subset:

- **Backdrop unified** to the shared AIPM dark-blue scrim (`bg-ui-dark-blue/40`), matching every other modal in the app (was a bespoke light `bg-surface-muted/70` tint).
- **Gains focus-trap + focus-restore** — Tab/Shift+Tab now cycle within the dialog and focus returns to the trigger on close (previously only a one-shot `.focus()`, no trap, no restore).
- **Gains backdrop-click-to-close** (previously clicking outside did nothing) and participates in the topmost-only modal stack.
- Dropped ~30 lines of hand-rolled Escape listener + focus wiring; the panel is now pure content.

This completes the design-system Modal-adoption phase — the two other dialog candidates (steering-committee report modal, version-info) were already on the shared `Modal`.

## [0.190.33] - 2026-07-19 "Pinsker"

### Changed

Design-system **`PopoverPanel` adoption** — migrated 5 hand-rolled dropdown menus to the shared `PopoverPanel` portal component (one source for floating-panel positioning, `overflow`-clip escape, outside-click/Escape dismiss, and focus-on-open):

- export-menu, settings-menu, version-menu, template-menus (both Save + Apply popovers), and the modal-field-controls cog popover (which gains outside-click/Escape dismiss it previously lacked). Each drops its `usePopoverDismiss` call + inline `absolute z-40` panel in favour of the portal; radius normalizes `rounded-lg`→`rounded-md`.
- **Left as-is by design** (don't fit / would regress): ask-claude-menu + project-switcher (left-aligned; PopoverPanel is right-align-only), project-switcher's APG roving-menu machinery, help-menu (a draggable/resizable position-persisted *window*, not an anchor popover), tasks-section column-config (cross-file state + wrapper-ref dismiss the portal would break).

## [0.190.32] - 2026-07-19 "Pinsker"

### Changed

Design-system **`Card` adoption** — migrated 10 genuine hand-rolled content-card surfaces to the `<Card>` primitive:

- 3 identical `role="status"` loading boxes (actions-panel, step0-import, timelog-panel), the knowledge-link card, the reports group-health card, and 2 stakeholder-report summary tiles.
- `Card` gained a polymorphic **`as`** prop (default `div`), used to fold in the `<section>` landmark cards (recovery-panel ×2, settings-view) without losing their element semantics.
- Deliberately NOT migrated (they use card chrome but belong to other primitives — queued as separate efforts): the ~9 floating dropdown/popover menus (a `PopoverPanel`-adoption concern) and the ~6 modal/dialog panels (a `Modal`/`EditModalShell`-adoption concern); plus `bg-surface-muted` boxes and the `<details>` disclosure (marginal).

## [0.190.31] - 2026-07-19 "Pinsker"

### Changed

Design-system **form-field sweep (3b of 3 — COMPLETE)** — the remaining panel/editor/misc fields. Migrated hand-rolled `<input>`/`<select>`/`<textarea>` across ~30 files (timelog, resources, steering-committee, roles, color-scheme, dependencies, budget, task-row, bulk-edit, chat, step0-import, reports, history, gantt, diagnostics, raci, activity-log, saved-views, template-menus, meeting-report, dashboard-narrative/hero, create-project, display-tz-switcher, sharepoint/outlook modals, escalate/rebaseline/reschedule/secret-unlock popovers) to the `Input`/`Select`/`Textarea` primitives.

- activity-log search now wires `invalid`; dashboard-narrative textarea uses primitive `autoGrow`; resources plan-window dates kept at the taller `md` size.
- Left bespoke by design (reported): fields needing an external `ref` (chat composer, inline-ai NL input — primitives aren't forwardRef), `resize-y` textareas (task-row notes), non-standard shells (`bg-surface-muted`/`bg-background`/`rounded` micro `px-1 py-0.5` cells), color/file inputs, checkboxes/radios, SegmentedControl, PaneSearchInput, custom combobox/chip-input components (combo-input, labels-input, resource-picker, stakeholder-recipient, global-search), and `fieldClass()` string consumers.

This completes the form-field primitive adoption program (sweeps 1 task-cluster · 2 settings · 3a edit-modals+registers · 3b panels/editors/misc).

## [0.190.30] - 2026-07-18 "Pinsker"

### Changed

Design-system **form-field sweep (3a of 3)** — edit modals + register panels. Migrated hand-rolled fields to `Input`/`Select`/`Textarea` across 13 files:

- Edit modals: resource, change, stakeholder, raid, milestone, shift, absence. Field validation now flows through the primitive's `invalid` prop (change modal number fields); notes/description/mitigation textareas use the primitive's built-in `autoGrow` (external refs + `useAutogrow` calls removed).
- Register panels: change, milestones, raid-toolbar, raid-edit-fields, knowledge, resource-directory (filters + pickers).
- Left bespoke (reported): shift-modal's 7 `px-1 py-1` per-day hour inputs (no matching size axis), resource-directory's `bg-surface-muted` inline role select, checkboxes/radios/SegmentedControl/PaneSearchInput. A few previously drag-resizable textareas now carry the primitive's `resize-none` (DS-consistent).

Sweep 3b (resources/timelog/editors/misc) completes the program.

## [0.190.29] - 2026-07-18 "Pinsker"

### Changed

Design-system **form-field sweep (2 of 3)** — Settings surfaces. Migrated the hand-rolled `<input>`/`<select>`/`<textarea>` fields across 14 settings files to the shared `Input`/`Select`/`Textarea` primitives:

- settings-sections: ai, appearance, comm-templates, dictation, general, integrations, localization, mode, next-actions, scheduled-jobs, templates, timezone.
- top-level: storage-config, timelog-settings.
- Compact fields normalized to `size="xs"` (minor text-size tightening); width kept per-caller; error-state fields (SharePoint URL) now wire `invalid` for the pink semantic ring. Local `inputClass`/`INPUT_CLASS`/`field` consts + orphaned imports removed.
- Left as-is: `jira-settings`/`budget-bucket`/`bulk-edit`/`project-form-fields` (already single-sourced via `fieldClass()`), checkboxes/radios (Checkbox), SegmentedControl, PaneSearchInput.

Panels/modals (3/3) follows.

## [0.190.28] - 2026-07-18 "Pinsker"

### Changed

Design-system **form-field primitive sweep (1 of 3)** — adopting the `Input`/`Select`/`Textarea` primitives that shipped in P2a but were barely used (the field analog of the button program).

- **Primitive redesign** (`form-controls.tsx`): `w-full` dropped from the base — width is now the caller's layout (`w-full`/`flex-1`/fixed via `className`), so the ~160 non-full-width fields can adopt it without stretching. New `size` axis (`md` = px-3 py-2 text-sm default · `xs` = px-2 py-1 text-xs compact) on `Input`/`Select`/`Textarea`/`fieldClass`, so compact fields migrate reliably (no className-override-order trap). Native `size` attribute repurposed as the variant.
- **5 existing consumers rewired** for the base change (w-full restored): `ai-section` fields + the four `fieldClass()` callers (budget-bucket, bulk-edit, jira-settings, project-form-fields).
- **Task / Open Points cluster migrated** to the primitives (task-form-fields, tasks-section, task-editor-raid-mini, task-linked-task-modal); local `inputClass` consts + orphaned imports removed; `notes` textarea now uses the primitive's built-in `autoGrow`.

Settings (2/3) and panels/modals (3/3) follow in subsequent releases.

## [0.190.27] - 2026-07-18 "Pinsker"

### Changed

Design-system: **button-size normalization** — the final button-sprawl slice. The off-size CTA buttons that the `<Button>` pass skipped (paddings that matched no standard size) are normalized onto the shared `<Button>` `xs`/`sm` sizes, closing the button consolidation entirely.

- Size map: `px-3 py-2`/`px-3 py-1` → `sm`; `px-2 py-1`/`px-2 py-0.5`/`px-3 py-1.5 text-xs` → `xs`.
- Off-variant folds: `bg-ui-green` save-passphrase → primary; `border-ui-medium-grey` quick-picks/dismiss → secondary; a `text-ui-purple` delete → destructive.
- ~25 buttons across 15 files (settings integrations/localization/timezone/comm-templates, history, knowledge, roles, dashboard narrative, notifications, jira-conflicts, sharepoint paste, budget-bucket, raid-edit, rich-text, chat inline-stop).
- Left bespoke by design: full-width list-selection *rows* (SharePoint site/drive/result rows — not centered chips), dropdown menu items (snooze), and the filled `bg-ui-pink` composer Stop (no filled-pink Button variant).

## [0.190.26] - 2026-07-18 "Pinsker"

### Added

Two new design-system primitives for the CTA shapes the `<Button>` pass (0.190.25) intentionally left, closing the remaining button sprawl:

- **`IconButton`** — canonical icon-only control (✕/close/remove) with a REQUIRED `label` (accessible name), `ghost`/`danger` variants, and `sm`/`md` sizes. Migrated ~7 bespoke icon-only buttons (outlook import modals, roles editor, dependencies editor, knowledge cards, chat dismiss) to it, normalizing their divergent `p-0.5`/`p-1`/`px-1` + `rounded`/`rounded-md` + muted/foreground-hover shapes.
- **`TextButton`** — inline action-link button (hyperlink look, in-page action) with `default` (dark-blue) / `danger` (pink) tones; padding-less and text-size-agnostic so callers keep their own `text-xs`/`text-sm`. Migrated ~8 action links (compare-to-now, send-inquiry, revoke-consent, extra-project remove/reset, snapshot delete, notes show-more).

Prose/navigation links and colour outliers (green/foreground/muted) were left bespoke by design.

## [0.190.25] - 2026-07-18 "Pinsker"

### Changed

Design-system: **`Button` primitive adoption** — the follow-up carved out of 0.190.24. Migrated ~70 hand-rolled call-to-action buttons (modals, wizards, settings sections, panels, editors) to the shared `<Button>` primitive, giving one canonical source of truth for the primary/secondary/destructive/ghost look and unifying the two divergent primary-hover styles (`hover:bg-ui-dark-blue/90` → the canonical `hover:opacity-90`) plus the shared focus-ring / press feedback.

- `AddButton` (toolbar "+ Add X") now delegates to `<Button size="xs">` — one primary look everywhere.
- `Button` gained an `xs` size (toolbar padding) and `ref` forwarding (React 19 ref-as-prop).
- Intentionally left as-is: toggle/`aria-pressed` buttons, segmented controls, icon-only controls, chips/pills, buttons with a bespoke semantic focus ring, and buttons whose padding maps to no standard size.

## [0.190.24] - 2026-07-18 "Pinsker"

### Fixed

Design-system review follow-up — accessibility fixes and primitive-adoption cleanup surfaced by a holistic review of the DS sprawl program (MR 261–282):

- **`Banner`** now defaults its live-region role from severity (`error` → `role="alert"` so validation/config failures are announced; everything else → `role="status"`); an explicit `role` still overrides. Fixes ~15 error banners (AI/Turso/SharePoint/storage config) that rendered visibly but were never announced to screen readers.
- **Budget planning-mode toggle** pins its label to the enabling action so `aria-pressed` state reads coherently (WCAG 4.1.2 / 2.5.3), via the shared `ToggleButton`.
- **RAG figures** on the dashboard progress card, trends table and variance summary now carry a RAG **dot** instead of small `--rag-amber-text`, which failed AA contrast on the dark and mockup schemes.
- **Read-only pop-out banner** uses `--ui-purple-strong` for AA contrast.
- **Primitive adoption:** portfolio-health and diagnostics tables use the shared `DataTable` head; report/resource "no data" states use the `EmptyState` primitive; the delta strip uses the `Card` primitive; the `AddButton` primitive (widened to accept button attributes) replaces hand-rolled toolbar add buttons across milestones/tasks/knowledge/gantt/budget.
- **Focus & scheme consistency:** weak 1px focus rings normalized to the 2px app standard; the field-tier segmented control uses scheme tokens; bespoke sort-header hovers use `--table-head-accent` (scheme-safe on the mockup light header).

## [0.190.23] - 2026-07-18 "Pinsker"

Palette token rename (Release B): the internal palette token names lose the brand
word now that AIPM is just one pluggable theme.

### Changed
- **Palette tokens renamed `AIPM-*` → `ui-*`** across the whole codebase — Tailwind
  utility classes (`bg-AIPM-green` → `bg-ui-green`), CSS variables (`--AIPM-green` →
  `--ui-green`), the Tailwind `@theme` map, the scheme registries, the shipped theme
  JSON keys, and the palette guards. This is a pure rename with **no visual or
  behavioral change**. The AIPM theme identity (its display name, `themes/AIPM.json`,
  and logo) is unchanged; it remains importable from the Theme gallery.

## [0.190.22] - 2026-07-18 "Pinsker"

Theme decoupling (Release A): AIPM and Dashboard are no longer baked-in built-in
schemes.

### Changed
- **AIPM and Dashboard are now optional, importable themes.** They ship as
  self-contained files and are imported on demand from a new Theme gallery in
  Settings → Appearance. A fresh install shows Harbor, Meridian and Umber; AIPM and
  Dashboard appear once imported. **Harbor is now the default look** (base palette
  and no-JS fallback).
- The scheme editor's base + reset now start from Harbor, and its old
  "New from AIPM / New from Mockup" preset buttons collapse to one "New from current
  theme" that seeds from whatever scheme is active.
- Exported/imported theme files now carry their shadow/gradient (structural) tokens
  and pinned accessibility variants, so a shared theme keeps its exact look.
- Fixed the default header logo's alt text (was a stale brand name; now the app
  title).

## [0.190.21] - 2026-07-18 "Pinsker"

Design-system dedup (Phases 3i + 3j).

### Changed
- Static help text under settings and form fields now renders through one shared
  building block, so hints read identically everywhere. No visual change.
- All entity edit modals (Absence, Shift, Resource, Milestone, Change, Stakeholder,
  RAID) now share one footer with a consistent Delete / Cancel / Save layout; a
  duplicate footer implementation was removed.
- The RAID edit modal now uses the same shared modal frame as the other edit
  dialogs, so it gains proper focus-trapping and focus-restore on close. Its layout
  and controls are unchanged.
- Modal backdrops now come from one shared value, keeping the overlay tint uniform.

## [0.190.20] - 2026-07-18 "Pinsker"

Design-system dedup (Phases 3g + 3h).

### Changed
- View panes now share one header + toolbar building block (title/actions row, the
  search box, and the "+ Add" button), so every register and directory view reads and
  behaves identically. No visual change.
- Register and report tables now render through one shared table component, so the
  branded sticky header is applied consistently by construction. No visual change.

### Fixed
- The Budget view now prints in landscape (wide tables were being clipped in portrait).
- The Version-history view is now a resizable pane with a reset-size control, matching
  every other view.

## [0.190.19] - 2026-07-18 "Pinsker"

Design-system dedup (Phases 3e + 3f).

### Changed
- Validation errors, field notices and config warnings across the app now render through
  the shared error/notice components, so they look consistent everywhere — form-field errors
  as small inline messages, and modal / settings errors as the same tinted alert box.
- The little round notification-count badge (top bar, sidebar, classic header) is now one
  shared component, fixing a subtle text-colour inconsistency between the copies.
- Progress and usage bars (completion gauge, effort bar, AI-usage bar, report bars) now share
  one bar-track component. No visual change.

## [0.190.18] - 2026-07-18 "Pinsker"

Design-system dedup + keyboard accessibility (Phase 3d).

### Changed
- The Open Points Table / Board switch now uses the same segmented control as the other
  in-app switches (Priority, density, RAID fields), so it looks and behaves consistently.

### Accessibility
- The workspace tab strips and the Help view tabs now respond to arrow keys (and Home / End)
  to move between tabs, via one shared keyboard helper.
- Segmented controls are now fully arrow-key operable and keep a consistent focus outline.

## [0.190.17] - 2026-07-18 "Pinsker"

Design-system dedup (Phase 3c).

### Changed
- On/off toggle buttons (the Gantt critical-path / baseline / inline-milestones toggles, plus
  the bulk-edit and show-archived toggles) now share one component, so they look and behave
  consistently — a bordered chip that takes on an accent tint when switched on. The bulk-edit
  and show-archived toggles gain that visible on-state they previously lacked.

## [0.190.16] - 2026-07-18 "Pinsker"

Design-system dedup (Phase 3b).

### Changed
- The Changes, Stakeholders and RAID registers drew their scrollable table area with a
  slightly different card than the rest of the app (tighter corners, no surface fill). They
  now use the same shared table-card as the Open Points and Resources tables, so every
  register reads consistently — rounded corners and a surface background to match.

## [0.190.15] - 2026-07-17 "Pinsker"

Design-system dedup (Phase 3a).

### Changed
- The little coloured RAG status dot (before a health/severity/impact label) was hand-built
  in ~15 places, with three panels each keeping their own private copy of the red/amber/green
  colour map. It is now one shared dot component drawing from the single colour source, so a
  given status renders identically everywhere and reflows with the active colour scheme. No
  visible change.

## [0.190.14] - 2026-07-17 "Pinsker"

Design-system dedup.

### Changed
- The Open Points table used its own sort-header cell (the last one outside the shared
  component); it now composes the same sortable/resizable header as every other table.
- Data-table column headers now render in normal case instead of all-caps, applied once in
  the shared header style so every table matches.

## [0.190.13] - 2026-07-17 "Pinsker"

Design-system dedup (Phase 2c).

### Changed
- The duplicated data-table sort-header markup — the Reports, resource-planning,
  budget-report and budget role-column, and milestone tables each repeated their own
  `<th>` + sort-button + resize-handle trio, and the Reports view carried a private clone
  of the shared header cell — now all route through the one shared sortable/resizable
  header component. Header padding on those tables is normalized to the standard rhythm
  (the milestone and budget bucket tables were tightened before and are now the standard
  looser spacing).

### Fixed
- The milestone name/date column headers no longer keep a highlight/arrow after their sort
  is cycled off; the header now clears like every other sortable table.

### Changed
- The clickable dashed "add the first item" empty-state box — previously duplicated
  across the budget, Gantt, milestones, knowledge and Open Points panels (and the shared
  change / stakeholders / RAID table shell) — is now a single component. Each panel keeps
  its exact look; only the duplicated markup was removed.

## [0.190.11] - 2026-07-17 "Pinsker"

Design-system palette cleanup (Phase 2c).

### Changed
- Five floating surfaces (the toast, the SharePoint picker, and the column-config /
  project-row / RACI popovers) now use the standard elevation tokens instead of ad-hoc
  drop shadows, so their shadow follows the active colour scheme.

## [0.190.10] - 2026-07-17 "Pinsker"

Accessibility and palette defect sweep (from the design-system audit).

### Fixed
- Toggle controls now announce the correct state to screen readers: the "Show archived"
  projects toggle and the voice-command mic no longer flip their label under the pressed
  state (which could announce the opposite mode as active).
- Four modal validation messages (milestone, resource, absence, shift editors) and a
  create-project notice are announced again as alerts.
- Four edit modals dropped an off-brand dark backdrop in favour of the standard tint.

## [0.190.9] - 2026-07-17 "Pinsker"

Design-system consistency — Phase 2b (loading + menu primitives).

### Changed
- Added a canonical `<Spinner>` loading indicator, replacing three hand-rolled copies of the
  same rotating ring (AI analysis, file import, time-log fetch).
- The suggestion input's focus outline now matches every other field (the standard green ring).
- The toolbar filter and column-picker dropdowns now float above the page so they are no longer
  clipped by a scrolling table, and their tick-boxes use the shared brand checkbox (one that
  previously rendered a browser-default tick).

## [0.190.8] - 2026-07-17 "Pinsker"

Design-system consistency — Phase 2a (form-field primitives).

### Changed
- Added canonical `<Input>`/`<Select>`/`<Textarea>`/`<Checkbox>` components. Checkboxes now
  share ONE brand accent colour (they previously rendered a browser-default or inconsistent
  mix), and form fields share the standard green focus ring.

## [0.190.7] - 2026-07-17 "Pinsker"

Design-system consistency — Phase 1e (Banner primitive).

### Changed
- Added a canonical `<Banner severity>` component (info/warn/success/error) using
  sanctioned colour tokens.

### Fixed
- The shared notice banner no longer renders every message in the error colour:
  birthday reminders now read as info and token-expiry notices as warnings, instead
  of all looking like errors.

## [0.190.6] - 2026-07-17 "Pinsker"

Design-system consistency — Phase 1d (Badge + palette hygiene).

### Changed
- Added a canonical `<Badge>` chip primitive and migrated the generic pills onto it
  (consistent radius + size scale).

### Fixed
- Replaced off-palette raw colours with sanctioned tokens so they recolour under the
  Mockup/custom schemes: amber warning chips (`bg-amber-500` → `--rag-amber`) and two
  error-text strings (`text-ui-red` → `ui-pink-strong`).

## [0.190.5] - 2026-07-17 "Pinsker"

Design-system consistency — Phase 1c (Card/Tile/Section).

### Changed
- Added a canonical `<Card>` shell primitive and consolidated the three divergent `Tile`
  components and two `Section` components into one each (visual parity preserved via
  `size`/`danger`/`flat` props). Migrated the dashboard cockpit cards onto `<Card>`.

## [0.190.4] - 2026-07-17 "Pinsker"

Design-system consistency — Phase 1b (Button primitive).

### Changed
- Added a canonical `<Button>` component (`primary`/`secondary`/`ghost`/`destructive`
  variants, `sm`/`md` sizes) wrapping the shared interaction styles (hover/press/focus-ring).
- Migrated the duplicated CTA button class strings and the clearest hand-rolled CTAs onto it
  (visual parity). Several secondary/destructive buttons that previously had no keyboard focus
  ring now gain the canonical one.

## [0.190.3] - 2026-07-17 "Pinsker"

Design-system consistency — Phase 1a (RAG colors).

### Changed
- RAG "amber" now renders consistently as the canonical orange `--rag-amber` token
  everywhere. Previously RAID severity, Change impact, reports group dots, and tier
  dots showed amber as **purple** while task-health dots showed it as orange.
- All RAG-semantic dots/stripes now use the `--rag-red`/`--rag-amber`/`--rag-green`
  tokens, so they recolor correctly under the Mockup and custom colour schemes.
  (RAID/Change "red" dots shift from magenta-pink to true red to match — intended.)

## [0.190.2] - 2026-07-17 "Pinsker"

Design-system consistency — Phase 0 (accessibility).

### Fixed
- Added visible keyboard focus rings to ~15 buttons that had none (secondary/Cancel
  buttons across several modals + action chips + overflow menu items).
- Normalized bespoke primary-CTA focus rings (dark-blue + offset) to the canonical
  green `ring-2`, and widened weak `ring-1` rings to the `ring-2` standard.
- Per-row delete buttons in the roles editor now have row-unique accessible names (WCAG 2.4.6).

## [0.190.1] - 2026-07-17 "Pinsker"

### Changed
- Renamed the internal persisted embedded-links field `documentLinks` → `knowledgeLinks`
  at the wire level (CSV/Markdown/Turso columns) to match the Documents→Knowledge rename.
  No user-visible change.

### Migrations (backward-compatible — existing data is preserved)
- **Turso:** existing databases self-heal via `ALTER TABLE … RENAME COLUMN documentLinks TO knowledgeLinks`
  (guarded, idempotent, inside the write-lock transaction); the tenant `projects` table was added to
  the column-ensure pass so ProjectMeta links migrate too.
- **CSV/Markdown:** the decoders still accept the legacy `documentLinks` / `DocumentLinks` column headers.
- **JSON/IndexedDB:** a load-time migration maps the legacy `documentLinks` key → `knowledgeLinks` on
  every entity (task, milestone, change, RAID, stakeholder, project).

## [0.190.0] - 2026-07-17 "Pinsker"

A large user-experience batch. The application is now named **AI PM Cockpit**.

### Added

- **RAID: send an inquiry to the owner + filter by owner.** Send an inquiry to a
  risk or issue owner directly from the register (tracked per item), and filter
  the RAID list by owner to focus on a single person's items. The push-to-Outlook
  control was restyled to match the other calendar toolbars.
- **Open Points: RAG-health filter, bulk delete, and a ⋮ row menu.** Filter tasks
  by RAG health, select and delete several tasks at once, and reach the per-row
  actions through a single overflow menu; the first column width was tidied.
- **Open Points: AI "Deduplicate & unify tasks".** From the Open Points toolbar,
  the AI assistant proposes which tasks look like duplicates and how to merge each
  group into one; you review every proposed group (deselecting any you disagree
  with) and nothing changes until you confirm. Confirming folds the duplicates into
  the kept task, applies its unified fields, and records a single undo step.
  Available when the AI assistant is enabled, outside pop-outs, with at least two
  tasks.
- **Knowledge register (renamed from Documents) with Confluence and URL links.**
  The Documents view is now **Knowledge**. A link can be a SharePoint document, a
  Confluence page, or any general web URL, each shown with a kind-appropriate icon;
  every link is validated as a safe http(s) URL. Existing document links, bookmarks
  (`#documents/…`), and the stored data are unaffected — only the view and feature
  module were renamed.
- **Structured task note-log.** A task's notes are now a dated log of entries
  showing who wrote what and when (persisted across all six write paths and both
  codecs) instead of a single free-text field.
- **Gantt milestone placement toggle.** Choose whether milestones render inline on
  the task rows or on their own row below.
- **Contextual tips on the stakeholder map**, a global tips on/off control, and
  saved-views visibility toggles.
- **Steering committee: per-row push to Outlook** and status-report chrome.
- **Pull contacts from Outlook** with a dedicated button, plus manual push/pull
  error feedback for the Microsoft 365 calendar sync.
- **AI assistant reads HTML and subtitle (VTT) files** alongside the existing
  attachment formats.

### Changed

- **Task editor is now a floating dialog.** In the modern layout, opening a task
  shows a draggable, resizable dialog (reposition, resize from the corner, reset
  to default) instead of the full-page editor, which was retired. Classic and
  pop-out surfaces are unchanged. The editor and related dialogs gained textarea
  autogrow, drag/resize/reset chrome, and a reset-icon audit; the field-config
  control is hidden in this surface.
- **Undo/redo now say what they will change** and preview the next step, so you
  always know what you're reverting; an undo/redo toast confirms each step.
- **Steadier toasts.** Notifications stay on screen longer (about 7s), pause while
  hovered or focused, carry clearer success/error styling, and offer a reload
  toast where relevant.
- **Assorted polish:** the app rename to "AI PM Cockpit", clearer empty-state text,
  a wider search input, reschedule honouring the due date, the new note-log editing
  UI, and planner absence colouring.

### Fixed

- **AI assistant errors can be dismissed and show the real API detail** (including
  the response body on a 400), instead of a generic, sticky message.
- **Steering committee: pushing one row no longer disables every push button.**
  Each "Push to Outlook" control now tracks its own in-flight state, so only the
  button you clicked shows busy; overlapping pushes are still guarded so they can't
  double-write.
- **No empty band above modal fields.** When the field-config controls are hidden
  (Settings → "Show field configuration" off), edit modals no longer show a stray
  bordered strip where the controls would be.
- **Internal cleanup:** removed the unused `pendingFlash` deep-link channel and the
  never-routed reserved `edit` view left over from the retired full-page task editor
  (the immediate row-flash path already covers deep-links now that the editor is a
  floating dialog).

## [0.189.2] - 2026-07-15 "Bishop"

### Fixed

- **Action-Center / Dashboard deep-links open the task editor.** `requestOpen`
  wrote the deep-link hash with `location.hash = …`, which fired a `hashchange`
  that `useHashView` re-handled by re-invoking `requestOpen`; the re-entrant
  `setActiveTab` navigated away from the just-armed modern full-page task editor,
  leaving it stuck closed (the row only highlighted, and the editor surfaced on
  the next unrelated navigation). Now writes the hash via `history.replaceState`
  (no self-triggered `hashchange`), matching `useHashView`'s own view→hash write.
- **Resource-picker clear (✕) works in inline editors.** The clear/unlink button
  used a plain `onClick`, so clicking it blurred the input first; in the inline
  task-row assignee (which commits on blur and closes the editor) that swallowed
  the unlink, leaving the field linked. It now `preventDefault`s the mousedown so
  the input keeps focus and the unlink applies (mirrors the listbox rows).
- **Action pop-overs no longer clip the date picker.** The reschedule / escalate /
  assign-owner / ⋮-overflow / rebaseline pop-overs rendered `position:absolute`
  inside the Action-Center's `overflow-auto` scroller and were clipped at its edge.
  They now share a `PopoverPanel` that portals to `document.body` and positions
  `fixed` from the trigger (right-aligned, left-edge-clamped, flips above when
  there's no room below); it dismisses on outside-click/Escape/ancestor-scroll but
  keeps a nested scrollable picker open, and ignores a mobile-keyboard height resize.

### Added

- **"Process attachment" AI-assistant prompt.** A new one-tap prompt (chat
  empty-state + Ask-Claude general menu, EN + DE): attach a document and the
  assistant extracts tasks, risks, and other actionable items, states which
  records it would create or update, and waits for your confirmation before any
  create/update/delete. Pairs with the 0.189.0 Office-ingestion attachment support.

## [0.189.1] - 2026-07-14 "Bishop"

### Fixed

- **Microsoft 365 sign-in.** The integration was fully broken; four root causes fixed:
  - **Config never reached MSAL.** The Client ID / Tenant ID entered under
    Settings → Integrations were ignored (only build-time `NEXT_PUBLIC_MSAL_*`
    env vars worked), so sign-in threw `MSAL config not available`. The Settings
    values are now threaded into MSAL and the client rebuilds when they change.
  - **Pop-up never closed.** MSAL v5 completes a pop-up via a `BroadcastChannel`
    bridge, not by polling the pop-up URL. A dedicated light `/msal-redirect`
    route now runs `broadcastResponseToMainFrame`, so the pop-up hands its
    response back and closes instead of loading the full app and hanging.
  - **Stuck `interaction_in_progress`.** A timed-out/aborted sign-in left MSAL's
    interaction lock set, blocking every later attempt; it now self-heals on load.
  - **Stale session on tenant change.** Editing the tenant while signed in
    re-checks the session (dropping a stale "signed in" account) instead of
    silently failing on the next Graph call.
- **README.** Rewrote the Microsoft 365 setup (SPA platform, the exact
  `<origin>/msal-redirect` redirect URI, delegated scopes, no client secret) and
  added a "How sign-in works" section plus a troubleshooting table mapping the
  `msauth.*` diagnostics to their cause and fix.

## [0.189.0] - 2026-07-13 "Bishop"

### Added

- **Office document ingestion (docx / xlsx / xlsm / pptx).** The AI Assistant chat
  and the "create project from source" importer now accept Microsoft Office files
  alongside the existing PDF / image / text support. Office files are unzipped and
  text-extracted fully **client-side with zero new dependencies** (native
  `DecompressionStream` + a minimal ZIP reader), producing **structured Markdown**
  the assistant reads for actionable extraction:
  - **Word** → headings, paragraphs, and tables as Markdown tables.
  - **Excel** (incl. macro-enabled `.xlsm`) → one Markdown table per sheet, sheet
    names resolved via the workbook relationships (correct even when sheets were
    reordered), shared strings resolved, columns kept aligned.
  - **PowerPoint** → one section per slide with bullet paragraphs, in slide order.
  - Extraction is bounded (per-entry and aggregate decompression caps guard against
    zip bombs; a 200k-character output cap guards the token budget) and fails safe —
    a corrupt or unsupported file surfaces a read error and is skipped, never
    crashing the send. Nested Word tables are a documented limitation (extracted
    partially).

## [0.188.0] - 2026-07-13 "Blish"

### Added
- **Field-level edit undo.** Field edits are now undoable on the existing undo stack, at
  per-changed-field granularity, across all six edited registers (tasks, RAID, changes, milestones,
  stakeholders, resources). Inline cell edits, the task status dropdown, and modal / full-page saves
  each push an undo entry per changed field; a save that changed three fields undoes them one at a
  time. Correlated fields revert together — a task's status and its auto-managed completion date, the
  assignee/email/resource identity, and a change's status and decision date. Undo/redo, the Undo
  toast, and the Ctrl/Cmd+Z shortcut are shared with the existing delete-undo. Jira-synced tasks stay
  read-only (no undo entry), creates are unchanged, and bulk edit keeps its existing single whole-row
  undo (no duplicate entries). No-op edits (re-selecting the current value) push nothing.

### Also in this release
- **Open Points row cleanup.** Removed the redundant "Mark complete / Reopen" button (the status
  dropdown already covers Done) and added inline editing to Open Points rows — assignee via a picker
  combo, notes and blockers via in-cell textareas (double-click), and task relations via a popover.
- **Bulk status change.** The Open Points bulk-edit panel can now set Status across the selected rows,
  applied so the Done⟺completion-date invariant holds and skipped for Jira-synced rows.

## [0.187.0] - 2026-07-13 "Simak"

### Added
- **Multi-select Gantt filters.** The Gantt toolbar's Status, Priority, and Assignee filters are now
  checkbox dropdowns so several values can be active at once (matches any selected value within a
  filter; all filters still combine). Empty selection means "all". A stale assignee selection (e.g. a
  renamed/removed person) stays clearable instead of leaving a phantom count.
- **Explicit Hours/Days rate-unit switch (manage roles).** Each rate-card row has a Hours/Days
  segmented switch that flips which unit is editable — choosing Days makes the day rates editable and
  the hourly rates derived, and vice versa. Switching to Days pins the currently shown day rates so no
  figure jumps. English + German.
- **Refresh bookings (Time bookings).** Once bookings have been read for a project, a Refresh button
  re-fetches the same persisted customer + project scope from Timelog without re-picking. Surfaces a
  partial-fetch notice the same way the initial fetch does.
- **Cancel in the Documents add-link form.** The manual link-document form has a Cancel button beside
  "Add link" that clears the inputs and closes the form; it's reachable as soon as the add panel opens.

## [0.186.1] - 2026-07-13 "Sheckley"

### Fixed
- **Draggable dialogs can't open off-screen.** A modal's dragged position is remembered per dialog;
  a position saved on a large screen could strand the dialog off the viewport when the same dialog was
  later opened on a smaller screen (or a resized window), leaving no grabbable edge. Dialogs now
  re-clamp their restored offset against the live viewport on open (in memory only — the saved position
  is untouched, so returning to the original screen restores it).

## [0.186.0] - 2026-07-13 "Sheckley"

### Added
- **Per-function guidance in Settings.** Each feature-module toggle in Settings → Functions now
  carries a short description explaining what the function does and when to enable it (use case +
  scope), so choosing a mode no longer requires guessing. The 10 modules that lacked a description
  gained one (Documents and Timelog already had theirs); the checkbox's accessible name stays the
  module label and the description is linked via `aria-describedby`. English + German.

### Changed
- **Prospect-first README.** The README now opens with a positioning and pitch section — the
  AI-copilot wedge, the "plugs into your stack, not another silo" story, data ownership, and the
  quality proof — before the exhaustive capability reference, and the product is named **AIPM
  Cockpit**. No reference content was removed; it moved below the pitch.

### Fixed
- **Visible Gantt column-resize grip.** The task-name column resize handle in the Gantt view was an
  invisible transparent bar (hover-only). It now shows the same three-dot grip affordance as the
  Open Points table, tuned (muted) for the light Gantt header.
- **Stable generated operating guide.** `scripts/gen-operating-guide.mjs` now normalizes its output
  to LF, and `.gitattributes` pins the generated file to `eol=lf`, so the `prebuild` regeneration no
  longer reports phantom line-ending drift on Windows `core.autocrlf` checkouts.

## [0.185.0] - 2026-07-13 "Mandel"

### Changed
- **Uniform draggable + resizable dialogs.** Every editor and popup modal now has
  the same layout controls: drag it by its header, resize it from the corner, and
  reset it to the default size and position via the header button — with your
  preferred size and position persisted per dialog. This closes the gap where the
  absence, milestone, resource, shift, and budget-bucket editors were drag-only
  (not resizable) and the Jira-conflicts dialog had no reset control, bringing them
  in line with the task editor. Resizable panels are also height-capped to the
  viewport so a size restored from a larger screen can't overflow a smaller one.

## [0.184.0] - 2026-07-12 "North"

### Added
- **Database-backed color schemes (cross-device).** Custom color schemes now
  persist to the project database when Turso is connected, via a global
  `color_schemes` table (kept out of the workspace table set), so your themes
  follow you across devices. localStorage remains a synchronous cache/fallback,
  so the no-flash boot paint is unchanged and file-mode/offline editing still
  works. Writes are per-row (upsert / targeted delete) and a local-only scheme is
  merged additively into the DB on connect — one device never wipes another's
  schemes.
- **Per-scheme logo & favicon.** A color scheme can now own its logo and favicon
  (not just slogan/footer), so switching schemes rebrands the whole app. The
  global Branding inputs show for built-in schemes and the scheme editor owns them
  for a branded custom scheme.

### Security
- DB-sourced schemes are sanitized on read through the same gate as imported
  schemes (HEX/token allowlist on colors, raster-only logo/favicon with SVG
  excluded), so a row in the shared database cannot inject CSS or unsafe branding.

### Internal
- Shared `BrandingImageInput` (raster-only file input with unique per-field
  accessible names) reused by the scheme editor and the Appearance branding block.

## [0.183.0] - 2026-07-12 "Palmer"

### Changed
- **The look is now fully scheme-driven — nothing is hardcoded into the app.**
  The **AIPM** brand style and the **Dashboard** (Mockup) style are now read-only
  **built-in color schemes**, joining Harbor, Meridian, and Umber (five built-ins;
  Harbor stays the fresh-install default). Every style is selected the same way —
  from the unified scheme picker in **Settings → Appearance** — and the old
  `data-style` axis has collapsed to a single scheme-driven path. AIPM and the
  Dashboard style render byte-identical to before.
- **The scheme model now carries structural (non-color) tokens.** Card shadows,
  the KPI gradient, delta-chip padding, and chip fills travel with a scheme (not
  just its colors), so the Dashboard style's richer chrome is applied inline like
  its palette. Structural values are allowlist-validated before they are applied.

### Fixed
- Selecting AIPM or the Dashboard style from the Appearance picker now applies it
  correctly (previously routed through a legacy path).
- No first-paint flash for existing devices on upgrade: the pre-paint boot script
  reads the active scheme (and its structural tokens) and paints it before React
  mounts, with a built-in fallback for legacy devices.
- Branding: the global app-name/footer inputs and a color scheme's own branding
  no longer collide — exactly one set is shown per active scheme, and a color-only
  scheme save can no longer silently clear a globally-set app name.

### Internal
- `globals.css` drops the hardcoded AIPM-dark and Dashboard token blocks; `:root`
  remains as the no-JS fallback. Removed dead style/token registries. All five
  scheme × theme combinations pass the axe accessibility gate.

## [0.182.0] - 2026-07-12 "Older"

### Added
- **Scheme-driven color palettes with dark mode.** The app's look is now
  scheme-driven: three built-in, dark-capable color schemes ship out of the
  box — **Harbor** (the new default), **Meridian**, and **Umber** — each with
  full light **and** dark maps, all WCAG AA-verified. Pick a scheme from a
  unified selector in **Settings → Appearance** alongside the AIPM and Dashboard
  styles and your own custom schemes. Harbor is the fresh-install default and
  renders with no flash on first load (pre-paint boot script).
- The theme (light/dark) toggle now works for any dark-capable scheme; it stays
  pinned to light only for the Dashboard style and light-only user schemes.

### Changed
- The custom-scheme model carries `{ light, dark?, supportsDark }` per scheme
  (string ids). Built-in schemes are read-only in the editor — tweak and
  **Save as new** to customise. User-created custom schemes remain light-only
  this phase.
- `ColorScheme` AA text/strong variants are now derived against the card
  background (`--surface-muted`), so tinted text clears AA on cards as well as
  plain surfaces.

### Security
- The pre-paint boot key and the scheme-color reader hex-validate values and
  require CSS-token keys, so a tampered `localStorage` entry can't inject a
  non-hex CSS value.

## [0.181.3] - 2026-07-12 "Anderson"

### Dashboard health-rating explainer

- **What the RAGs mean:** the dashboard's Overall health band now has an info tooltip explaining how the
  four ratings are computed — Overall = worst active-task health; Schedule = task/milestone dates + the
  SPI index; Budget = spend + the CPI index (grey until a budget is set); Scope = pending changes. It also
  clarifies that the SPI/CPI indices only ever add amber (below 0.9) or red (below 0.8) — an index of 0.9
  or above never affects the colour — so **green is the clean default** whenever nothing is overdue, due
  soon, over budget, or behind on SPI/CPI.

## [0.181.2] - 2026-07-12 "Anderson"

### Steering report internals

- **Version retention:** the report version history (Turso) is now capped at 25 snapshots per meeting —
  the oldest is pruned automatically on each save, so the history can't grow without bound.
- **Performance:** the report version **diff** is now memoized, so it no longer recomputes on every
  keystroke while a comparison is open.

## [0.181.1] - 2026-07-12 "Anderson"

### Compare report versions

- **Diff view:** in a meeting's status-report editor, each version now has a **Compare** button that
  shows a line-by-line diff of the current report against that version's snapshot (added lines marked
  "Current", removed lines "This version"). Turso-only, alongside the existing restore.

## [0.181.0] - 2026-07-11 "Anderson"

### AI status reports for steering-committee meetings

- **Per-meeting status reports:** each meeting in the Steering Committee view now has a **Status
  report** button that opens a report editor. Write the report in a **rich-text editor**, or click
  **Draft with AI** to have Claude write a first draft from the current project status (RAG, progress,
  overdue/due-soon, open RAID, recent changes) woven together with the meeting's agenda.
- **Email to the committee:** send the report to the committee members with one click (via Microsoft
  365). Recipients are prefilled from the members' directory emails and are **editable** before you
  send.
- **Version history (Turso):** on a Turso backend, every save/draft/restore keeps a version of the
  report; you can **restore** an earlier version (restoring first snapshots the current one, so it's
  reversible). File/IndexedDB projects get draft, edit, and send without version history.
- Draft (AI) needs the AI assistant enabled; email needs Microsoft 365 configured; version history
  needs Turso. Each degrades independently. No change to stored project data or file formats — the
  report rides the existing steering-committee record.

## [0.180.0] - 2026-07-11 "Farmer"

### Live resource names everywhere (no more stale assignee/owner)

- **Fix:** when a task assignee, RAID owner, or absence is linked to a directory resource,
  every surface now shows/searches/filters/sorts/groups by that resource's **current** name —
  the stored name string is only a cache the editor already resolved live. Previously, after you
  renamed or re-linked a resource in the directory, the old cached name lingered in the **Open
  Points** table (and its assignee filter/search/sort), the **Kanban** board, the **Reports →
  by-assignee** grouping, the **RAID** owner column + text search + owner sort, the **RAID By-Owner
  report** (both the embedded and standalone views), the **Gantt** grouping/filter/search, and the
  **resource calendar** (which forked a duplicate row under the old name) — until you re-saved the
  item. All of these now resolve the live name automatically.
- **Email:** "send status inquiry" (single, bulk, and the AI chat tool) now addresses the linked
  resource's **current** email, not a cached address that may have changed.
- Unlinked/free-text people are unaffected (their typed name/email is used as before). Internal
  robustness only — no change to stored data, file formats, or any backend write path.

## [0.179.0] - 2026-07-11 "Priest"

### Session-scoped id integrity (no reused ids within a session)

- **Root fix for a rare undo data-loss class:** entity ids (tasks, RAID, changes, milestones,
  stakeholders, resources, roles, disciplines, grades, absences, shifts, budget buckets) are now
  minted from a **session-scoped monotonic** counter. An id freed by deleting the current
  highest-id row is **never handed to the next new row within the same session** — so a later undo
  of an edit can no longer clobber an unrelated row that had reused the freed id. (Ids still start
  fresh on reload, which is safe: the undo/redo history is in-memory only.)
- **Every create path is covered**, including the two that previously still used raw `max+1`:
  importing Outlook **calendar** events as absences and Outlook **contacts** as resources, plus the
  classic **"Open storage file"** flow, which now seeds the counter from the opened file so its ids
  can't be reused after a delete.
- **New projects start clean:** creating a project from a template or an AI seed resets the counter,
  so its ids start at #1 rather than continuing a previously open project's numbering.
- Internal robustness only — no change to stored data, file formats, or any backend write path.

## [0.178.0] - 2026-07-11 "Roanhorse"

### Redo for the local undo stack

- **Redo:** the local undo system (added in 0.173.0/0.174.0) now supports **redo** — reverse an
  undo with **Ctrl/⌘+Shift+Z** (or **Ctrl+Y**), or the new redo button beside Undo in the top bar
  (with a depth badge). Redo reinstates the last undone operation — single/bulk deletes, bulk edits,
  clear-all, and cascade (composite) deletes — on every storage backend (file / IndexedDB / Turso),
  and round-trips indefinitely (undo → redo → undo …). A fresh destructive op clears the redo stack.
- **Retention:** the undo/redo history depth was raised from 10 to **25** operations.
- **Engine:** new pure `applyUndoForward` / `buildForwardImages` + `applyUndoRestoreWithRemap`; redo
  removes a re-minted recovered row by its actual post-restore id (never the unrelated live row that
  reused the original id). Session-scoped/in-memory by design (a reload starts fresh).
- **Composite FK re-mint fix:** when undoing a cascade delete (role/discipline/grade, or a resource
  with its absences/shifts) whose freed id had been reused by a new row, the recovered row is re-minted
  under a fresh id and each cascade fragment's foreign key (`roleId`/`disciplineId`/`gradeId`/
  `resourceId`) now follows that re-mint — so the restored link points at the recovered row, never the
  unrelated live row that reused the id. The primary fragment flushes synchronously so its id-remap is
  available to the cascade fragments regardless of React batching order.

## [0.177.0] - 2026-07-11 "Harrow"

### UX batch (14 improvements)

- **AI usage limits:** a distinct, translated notice now appears when Claude's own
  weekly/rate limit is hit (HTTP 429 / `rate_limit_error` / `overloaded_error`) and when
  your own token cap is reached — across all AI surfaces (chat, inline edit, action
  analysis, scheduled jobs, weight suggestions, create wizard). Advisory only: nothing is
  blocked. In chat the notice is appended to the transcript and never clears history. No
  API key or response body is ever logged. Documented in the built-in app-feature guide.
- **AI settings:** configurable **max assistant turns per message** (default 12) and a
  configurable **token-counting multiplier** (default 5, applied to both session and
  weekly counting); clarified that the session/weekly caps are your own advisory limits.
- **Dashboard:** explanatory tooltips on the cockpit tiles (completion %, overdue, open
  RAID, R/A/G health, budget, hours, SPI, CPI) — what each shows and how to read it.
- **Gantt:** milestone hover labels now format the date (as task bars do) instead of the
  raw ISO string.
- **Rate card:** enter **day rates** (`internal/d`, `external/d`) — day is now the source
  of truth; the hourly rate is derived from your workday hours. Only the daily or the
  hourly field is editable at a time; clear the filled one to switch. Tooltips explain it.
- **Planning:** a **Capacity (h)** column and a **hide-external-resources** toggle.
- **RACI:** an additive type-to-filter for the people columns — add people to the filter,
  remove them, or clear it; empty filter shows everyone.
- **Version history:** "Compare with current" now scrolls to its output and gives clear
  feedback when the version is identical to the current workspace (distinct from a load
  error). New **Select all** / **Deselect all** and **Restore this state** controls.
- **Open Points:** the inline status dropdown gains a hover affordance.
- **Tooling:** `npm run stop` stops the dev server on the app port (port-scoped; leaves
  unrelated node processes alone).

## [0.176.0] - 2026-07-11 "Tesh"

### Planning / budget batch

- **Planning:** the utilization input now shows a mode-aware suffix — `%` in percent
  mode, `h` in hours mode (decorative; the cost line keeps the currency symbol).
- **Planning + budget:** period date-column headers are left-aligned (editable planning
  grid, the collapsible planning rollup, and the budget bucket tables); numeric cell
  values stay right-aligned.
- **Budget — "budget hours follow plan" (opt-in, per project, default off):** a toolbar
  toggle. When on, budget-hours cells for allocations with assigned resources mirror the
  planned capacity, read-only and live; lines with no assigned resource stay manually
  editable. All budget aggregates (row/bucket RAG, Budget-hours card, margin/CPI/
  consumption, win/loss, project rollup) follow planned under the toggle, so the cell and
  the totals never contradict. Persisted on the plan (`ResourcePlan.budgetFollowsPlan`);
  existing Turso databases self-heal the new column on first save.
- **Budget:** a bucket-name search box beside the existing role filter (the two compose);
  a "no matches" line when a search filters out every bucket.

## [0.175.0] - 2026-07-10 "Polk"

### Added

- **Resizable Gantt task-name column.** Drag the column's right border to widen or
  narrow the task-name column; a toolbar **reset** button restores the default. The
  width persists per device.
- **Draggable, resizable dialogs.** Modal windows can be moved by their header and
  resized; a **reset** button restores the default centred size. Each edit dialog
  remembers its position and size per device. (On small screens dialogs stay centred.)
- **Create RAID items from the task editor.** A "+ Create RAID" mini-form inside the
  task editor adds a risk/assumption/issue/dependency already linked to the task.
- **Create linked tasks from the task editor.** "+ New linked task" opens a nested
  editor to create another task and link it as a **predecessor or successor** without
  leaving the current task. For a brand-new task, the RAID items and links are staged
  and applied when the task is first saved (discarded on cancel).
- **Inline editing in Open Points.** Edit a task's name (double-click), start/due
  dates, assignee, and priority directly in the table — no need to open the full
  editor. Jira-synced tasks stay read-only.

### Changed

- **Ask-Claude icon moved to a leading, hover-revealed cell.** The inline "Ask Claude"
  edit trigger now sits at the start of each row and appears on hover or keyboard focus.

## [0.174.0] - 2026-07-10 "Gailey"

### Added

- **Composite undo for reference-data deletes.** Deleting a resource, role,
  discipline or grade is now undoable — and one undo reverses the delete **and
  its cascade** atomically. A role delete also cleared each affected resource's
  role link; a discipline/grade delete reset the roles that referenced it; a
  resource delete purged that person's absences and shifts. All of these are now
  captured together, so a single Undo (toast button, Ctrl/⌘+Z, or the top-bar
  control) restores every affected record across the involved lists. Discipline
  and grade deletes are also recorded in the activity log for the first time.
- **TimeLog customer-scoped booking fetch.** Time bookings now load by
  **customer → project**: pick a customer, multi-select its projects (with a
  wildcard/partial-match filter), and fetch loads only those projects'
  registrations instead of the whole org's per-user history. The People table
  shows only the people who actually booked on the selected projects, and the
  selection persists per project. External resources (capacity-only, excluded
  from cost) no longer appear as booking link targets.

### Fixed

- **TimeLog v2 registrations were mapped as empty.** The per-project
  `/v2/projects/{id}/time-registrations` endpoint returns a different field
  shape than v1 (`ActualHours`, inverted `NonBillable`, no `ProjectID`/`UserID`),
  so every row mapped to zero hours and bookings appeared empty. Added a
  dedicated v2 mapper that injects the project id and resolves the booker from
  employee initials.
- **Version history captured empty load-transient snapshots.** An auto-capture
  firing during a project switch/reload could snapshot a near-empty workspace,
  producing misleading "everything removed" compare summaries and a data-loss
  restore risk. Empty transient auto-captures are now skipped, and a failed or
  empty compare surfaces a diagnostic instead of a silent empty diff.
- **Steering committee and TimeLog links were not versioned or restorable.**
  They are now included in the version payload, diff, and restore.

### Changed

- **Delete individual version-history snapshots.** Each snapshot row gains a
  confirm-gated Delete button.

## [0.173.0] - 2026-07-10 "Jordan"

### Added

- **Local undo for destructive edits (audit #11).** A multi-level (~10), in-memory
  undo that reverses destructive edits — single/bulk deletes, clear-all, and bulk
  edits — across every entity (tasks, RAID, changes, stakeholders, milestones,
  absences, shifts, resources) and on **every storage backend**, closing the gap
  where file/IndexedDB projects had no recovery (version history is Turso-only).
  Three ways to undo: an **Undo** button on the action toast, global **Ctrl/⌘+Z**
  (ignored inside text fields so native undo still works), and a **top-bar control**.
- Item-level restore: only the rows an operation touched are affected, so an undo
  survives edits made to *other* rows in between, and it never overwrites a live
  row whose id was reused after a delete (the recovered row is re-minted instead).
- Undo actions are recorded in the activity log.

### Notes

- Undo is session-scoped and in-memory by design (a reload starts fresh; the
  destructive save has already committed). Redo and cross-reload undo are out of
  scope. Deleting a **resource / role / discipline / grade** is not yet undoable —
  those deletes cascade across entities (removing linked absences/shifts, clearing
  FK references), so a correct undo needs a follow-up composite-restore pass rather
  than a partial (potentially inconsistent) one.

## [0.172.0] - 2026-07-10 "Corey"

### Added

- **Weekly status digest (audit #7).** A new per-project digest card on the Dashboard summarizes the
  project — overall RAG (with the change since last time), overdue tasks, milestones due soon, and open
  RAID — on a per-device weekly cadence (configurable 7 / 14 / 30 days in Settings → Integrations,
  default off). Enable it and the card appears on your next Dashboard visit; it also renders on demand via
  a **Generate now** button. The digest can optionally be **emailed via Outlook** (Microsoft Graph),
  announced by a **desktop notification**, and prefixed with an **AI-written narrative** — each gated
  behind its respective integration/AI setting and fully fail-soft, so the deterministic digest always
  works on every backend. Per-project scope for this release; a portfolio-wide digest is a planned
  follow-up. Pure engine (`digest/digest-model`, `digest-state`, `digest-email`, `digest-narrative`,
  `digest-config`) + a render-scope hook (`use-digest`) + a self-hiding card; no new persisted Workspace
  field (the cadence state and config are per-device, swept by the app-reset config wipe).

## [0.171.0] - 2026-07-10 "Clark"

### Added

- **Gantt milestone baseline ghost bars.** Each milestone now shows a hollow
  "ghost" diamond at its committed baseline date — taken from the pinned Turso
  snapshot — with a dotted connector to its current date and a signed `+Nd` /
  `−Nd` slip label, so schedule drift is visible right where you plan. A default-on
  "Baseline" toggle in the Gantt toolbar shows/hides the overlay. Turso-gated
  (the overlay and toggle appear only on projects with a pinned baseline snapshot;
  tasks have no per-task baseline data, so this is milestone-only).

## [0.170.2] - 2026-07-10 "Doctorow"

### Fixed

- **Entity create no longer silently clobbers a concurrent row (data-loss race).**
  The Stakeholders, Changes, RAID, and Milestones "Add" modals mint the new
  row's id at modal-open; a concurrent writer (the AI create tool, a second
  browser tab, a bulk edit) could commit that id before you saved, and the save
  then overwrote that row instead of appending. Saves now decide create-vs-update
  by the modal's intent (not id-existence) and re-mint a create's id if it was
  taken, so both rows survive. (Resources was already safe; the fix is now the
  shared `resolveEntitySave` core across all five entities.)
- **Editing a row that was deleted elsewhere surfaces a toast** instead of
  silently dropping the edit — across Stakeholders, Changes, RAID, Resources,
  and Milestones.

## [0.170.1] - 2026-07-10 "Doctorow"

Two TimeLog follow-up fixes for the 0.170.0 customer-scoped booking fetch. No storage format change, no new fields.

### Fixed
- **Customer-scope picker resets correctly when you switch projects in place**: the render-time reconcile that seeds the Time-bookings customer picker (from a persisted scope, or auto-resolved from the project's customer name) is now gated so an in-place project switch doesn't seed the new project from the *old* project's stale flags/links before its own workspace has hydrated. A manual pick still always wins over both.
- **Large customer fetches no longer time out**: the `/api/timelog` proxy capped every upstream request at 10 s, but the v2 per-project time-registrations endpoint returns a project's entire (unpaged) history in one response, so a large or closed project legitimately took longer and the fetch dropped that project's data with a "TimeoutError". The v2 per-project call now gets a 30 s budget (matching the reference implementation) while all other calls keep the 10 s guard, and the proxy's failure log now names the failing endpoint and elapsed time (secret-free) so any future upstream stall is attributable.

## [0.170.0] - 2026-07-09 "Doctorow"

TimeLog integration: the booking fetch can now be scoped to the customer a project is created for. No storage format change (the scope rides the existing `timelogLinks` JSON blob — no new persisted Workspace field, no golden regen).

### Added
- **Customer-scoped booking fetch (ported from project-burndown-dashboard)**: previously "Fetch bookings" pulled every ticked user's entire timesheet history across all customers/projects. You can now pick a TimeLog customer in the Time bookings header (or let it auto-resolve from the project's customer name); "Fetch bookings" then loads only that customer's projects' registrations — resolving the customer's projects, then fetching each project's bookings via the TimeLog v2 per-project endpoint. This sharply cuts the data pulled. Selecting "All customers" keeps the existing per-user fetch. The chosen scope persists per project.
- The `/api/timelog` proxy now allows the `/v2/` API namespace (per-project time-registrations) alongside `/v1/`; host allowlist, private-IP block, and traversal/CRLF guards are unchanged.

### Fixed / hardened
- Persisting the customer scope uses a functional workspace update, so a link edit made during the (long, serial) per-project fetch is never reverted.
- Fetched registrations are clamped to the requested date window client-side (defensive — the v2 endpoint is passed the dates but isn't relied on to honour them), so a scoped fetch can never silently ingest a project's full history.
- A customer that resolves to zero visible projects no longer clobbers previously-fetched totals with an empty result; an info notice explains the empty customer / no-access case.

## [0.169.4] - 2026-07-08 "Onyebuchi"

Bugfix for the Budget bucket editor. No storage format change, no new fields.

### Fixed
- **You can now add roles and disciplines to budget buckets at the default view**: the detailed-planning allocation controls (the add-role and add-discipline pickers) were tagged as a "Full"-tier field, but the app's default field-visibility tier is "Advanced", so the controls were hidden unless you manually switched the Budget editor to Full via the ⚙ field controls. They now show at the default Advanced tier. This also makes the 0.169.3 "add a role line first" guidance actionable.
- **Empty rate card is no longer a dead end**: when a project has no roles or disciplines defined yet (e.g. a freshly AI- or TimeLog-created project), the allocation picker showed a misleading "All roles are already allocated" message. It now reads "No roles/disciplines defined" and shows a hint pointing to Resources → Manage roles, where reference data is defined.
- Note: if a project's Budget field visibility was manually customized before this release, the stored setting may still hide the controls — open the ⚙ field controls in the Budget editor and enable "Detailed budget planning" (or reset to default).

## [0.169.3] - 2026-07-08 "Onyebuchi"

Bugfix for the Time bookings (TimeLog) "Apply to budget" action. No storage format change, no new fields.

### Fixed
- **"Apply to budget" no longer silently does nothing for a bucket with no role line**: linking a TimeLog project to a budget bucket that had booked hours but no role/discipline allocation left the Apply button enabled and the confirm dialog showing a count, yet clicking Apply wrote nothing — actual hours are stored on a bucket's role line, and a bucket with zero allocations had nowhere to put them. `planApply` now skips buckets that `applyActualsToBuckets` cannot write, so the affordance no longer lies, and a notice explains that such buckets need a role added in the Budget view first. Blended-mode buckets now correctly apply into their `disciplineAllocations` (previously only detailed buckets' `allocations` were written, so blended buckets were a second silent no-op).

## [0.169.2] - 2026-07-08 "Onyebuchi"

Bugfix for AI project creation. No storage format change, no new fields.

### Fixed
- **AI-created projects now populate the Resources directory**: describing/importing a project with the AI assistant created the tasks (with the named people as free-text assignees) but left the Resources directory empty, and the Time-bookings People picker had no resources to link a TimeLog user to. `parseProposal` was silently dropping the model's `seed.resources` while narrowing the proposal, so nothing downstream ever received the seeded people. The narrowing now passes `resources` through, so the directory is seeded and task/RAID/stakeholder owners link to those entries by name (or email).

## [0.169.1] - 2026-07-08 "Onyebuchi"

Bugfix for the Time bookings (TimeLog) integration. No storage format change, no
new fields.

### Fixed
- **Synced hours now populate the budget**: a person or project that was *auto*-matched in the People/Projects tables (shown with an "Auto" badge) attributed no hours — every booking fell into "Unattributed" and Booked stayed 0h, because aggregation resolved only the explicitly-pinned (manual) links while the tables displayed the effective auto+manual matches. Aggregation now resolves the same effective links the matching UI shows, so auto-matched bookings reach the budget. (Project refs are also derived before aggregation, so project-by-name auto-matching works on the first fetch.)

## [0.169.0] - 2026-07-08 "Onyebuchi"

Resources & Time bookings follow-up — a batch of UX fixes and an AI-import gap
closed. No new persisted fields (the two new preferences are per-device
settings; the AI proposal's resource list is transient), so older files load
unchanged and no storage format changed.

### Added
- **Collapsible People in Time bookings**: the People matching list is now a disclosure (heading toggle) so a large org directory can be folded away, and the whole view scrolls — Projects and the Apply-to-budget bar are always reachable even when the people list is long. Collapse state persists per-device.
- **Include/exclude externals in the resource Calendar**: a per-device toggle in the calendar toolbar hides or shows rows backed by an external resource (rows for never-linked typed contractors always show).
- **AI project creation seeds the resource directory**: describing or importing a project that names team members now populates the Resources directory and links those people to the tasks/risks/stakeholders they own (by name or email), instead of leaving them as plain-string assignees with an empty directory.

### Changed
- **Deleting a resource clears its calendar entries**: removing a resource (single or bulk) now also removes that person's absences and shifts, so no stale "ghost" row lingers in the calendar. A same-named surviving resource's entries are never swept up. Both delete confirmations note the cascade.

### Fixed
- **Planning-grid inputs stay visible on hover**: the per-period utilization and absence-override inputs no longer dissolve into the row hover colour (they now carry an opaque fill in both light and dark modes).

## [0.168.0] - 2026-07-07 "Solomon"

Resources & rate-card enhancement — a batch of directory, rate-card, and
AI-assistant improvements. New persisted fields (`Resource.isExternal`,
`Resource.emails`, `Role.order`) ride the existing six write paths; no breaking
changes (older files load unchanged; existing Turso DBs self-heal).

### Added
- **Single role picker**: the resource directory now assigns a role with one dropdown listing the rate-card roles (labelled "Discipline Grade"), replacing the separate discipline + grade selects. New discipline×grade combinations are still authored in the rate-card editor.
- **Drag-to-reorder rate-card rows**: rows in the rate card carry a manual order (persisted) and can be dragged to reorder; dragging is disabled while a column sort is active.
- **External resources**: mark a resource external — it stays planned and capacity/absence-tracked but contributes zero to every cost and budget figure (budget report, resource report, and the planning-grid cost columns).
- **Additional email addresses**: a resource can hold extra emails beyond the primary; the directory shows them semicolon-separated and each is a button that copies the address to the clipboard.
- **Bulk edit + delete in the directory**: select rows to bulk-set role, external flag, active/archived status, and contact fields, or bulk-delete (confirm-gated).
- **AI can manage the resource directory**: new `get_resource`, `update_resource`, and `delete_resource` tools (resources previously had create + list only).
- **Clear stray workload rows**: an "unlinked" workload row (an assignee/owner string matching no resource) can be cleared — tasks and RAID items are unassigned (kept), and the name's absences/shifts are removed (they can't exist without a person).

### Changed
- The directory's discipline and grade columns are collapsed into one sortable Role column.

## [0.167.0] - 2026-07-06 "Rajaniemi"

Roll-up of the codebase-audit improvement campaign — a series of data-integrity,
performance, correctness, accessibility, and gap-closing batches that shipped
internally without a version bump — plus the workload-actionable feature. No
breaking changes.

### Added
- **Global search now covers budgets and resources** (previously only tasks, RAID, changes, milestones, and stakeholders): search a person by name/email/department or a budget by name/PO number and jump straight to it.
- **Per-field change diffs in the activity log**: an update event now records which fields changed (e.g. `status: Open → Closed`), rendered as a small list under the entry — turning coarse "X updated" lines into an audit trail. Per-device only (not exported).
- **The workload view is actionable**: a new "Util (now)" column edits a resource's near-term utilization inline (the same period the over-allocation alert flags), and the overdue-task count opens an inline triage popover to reassign (owner select) or reschedule (due date) a resource's overdue tasks without leaving the view. Jira-synced tasks are read-only there.
- **Keyboard navigation for the resource calendar grid**: arrow keys move between day cells (± day / ± assignee), Home/End/Ctrl+Home/End and PageUp/Down jump within the window; the grid is now a single tab stop (APG grid pattern).
- **Collapsed-sidebar sub-menu flyout**: when the sidebar is collapsed to the icon rail, a parent with children (e.g. Dashboard → Next actions/Trends) opens a popover so the nested views stay reachable.
- **Mobile off-canvas sidebar drawer**: on narrow screens the menu button opens the sidebar as a focus-trapped overlay with a backdrop, instead of only shrinking to an icon rail.
- **Branded confirmation dialogs** replace the browser's native `window.confirm` for destructive actions (clear-all, deletes, disconnects, chat-clear), with consistent styling and keyboard/ screen-reader behaviour.
- **Import drops a warning** when rows are rejected during a CSV/Markdown load, instead of silently discarding them.
- **Keyboard shortcuts documented** in the Help panel (⌘K/Ctrl-K to focus search, `/`, F4 push-to-talk).

### Changed
- **Accessibility hardening across the shell**: focus moves to the main content region on a view change (so keyboard/screen-reader users follow the swap); the project switcher menu has roving arrow-key navigation and returns focus to its trigger on Escape; the modern shell announces the active view to screen readers; long-running controls expose a busy state; toggle-button labels stay coherent with their state.
- **Performance**: the global-search index and the Gantt search haystack are precomputed once and reused per keystroke; task-row context churn on edits is bounded (volatile lookups split into their own context so an edit re-renders only the affected cell); calendar auto-sync pushes are staggered to avoid a save-time request herd.
- **Data-integrity / transparency**: a corrupt project file surfaces a load error instead of silently loading empty then overwriting; settings/secret write failures and swallowed calendar-push/status-check failures now surface a toast + diagnostic log entry.

### Fixed
- **Bulk edit / clear-all / voice clear-all** and several inline entity saves now use functional state updaters, so N edits in one tick compose instead of the last write clobbering the rest.
- **RAID/change/stakeholder inline edits** correctly accumulate multiple push segments (voice dictation) instead of overwriting.
- Removed a false "drag the handles to draw a dependency" claim from the Gantt help; corrected several stale help strings.
- A dead `rate === 0` currency branch and other small correctness nits from the audit.

## [0.166.0] - 2026-07-05 "Mohamed"

### Added
- **Inline "Ask Claude" per-item edit on RAID, changes, milestones, and stakeholders** (SP2): the ✨ hover popover that shipped for tasks now works on every register row. Describe a change in plain language; Claude proposes it in **one bounded call**, and the popover shows a **preview diff** — field changes plus any related items it would create — before anything is written. Confirm applies through the existing AI CRUD tools, so every write runs through its entity sanitizer. Built on one generic engine driven by a per-entity descriptor (tasks refactored onto it), so the preview never diverges from what Apply persists — including surfacing a sanitizer-induced RAID status reset when a category change invalidates the current status. Gated behind the AI master switch; disabled in pop-out windows.

### Changed
- **Inline-edit dialog is now focus-trapped** and restores focus to the ✨ trigger on close (applies to the task popover too).

### Fixed
- **A left-open inline edit auto-closes when its pane stops being the active view**, so it can't reappear (and steal focus) after navigating away via search, a deep-link, or browser back/forward.

## [0.165.0] - 2026-07-03 "Kritzer"

### Added
- **Inline "Ask Claude" per-item task edit**: a ✨ hover icon on a task's table row / Kanban card (also available from the row menu) opens a popover where you describe a change in plain language; Claude proposes the edit in **one bounded call** (no agentic loop), and the popover shows a **preview diff** — field changes plus any related items it would create (RAID / change / milestone / stakeholder) — before anything is written. Confirm applies the changes via the existing AI CRUD tools, so every write still runs through its entity sanitizer. Gated behind the AI master switch; disabled in pop-out windows and on Jira-synced tasks (Jira owns those fields); a stale response from an earlier request is discarded. No chat window needed for a quick one-off edit.
- **"Reload project" affordance**: a new control next to the project switcher (and in Settings → Storage) re-fetches the current project's data after a load error, without navigating away.
- **"Configure AI assistant" button** on the new-project screen, so you can set up the AI master switch and API key without leaving the create flow.

### Changed
- **AI model picker no longer pre-fills from the offline model registry.** The dropdown stays empty (aside from the currently-selected model) until a successful live `/v1/models` poll returns real models, with a hint to enter a valid API key when it can't reach Anthropic.
- **Portfolio-storage switch removed from the empty state** — it could only ever land you in a different, still-empty portfolio, so the control was dropped from that screen (it remains available in Settings → Integrations).
- **Tech-debt: duplication-reduction slice 6.** A generic `decodeMdTable` markdown-table decoder replaced several near-identical per-entity decoders, plus an intra-file tsx self-clone extraction; the duplication gate ratcheted from 2.7% to **2.4%**.

### Fixed
- **Turso portfolio-switch flash**: switching to Turso portfolio storage no longer flashes the current screen before bouncing to the new-project screen — a loading state now covers the project-list load so the transition is clean.

## [0.164.1] - 2026-07-03 "Cixin"

### Changed
- **Relicensed from Apache-2.0 to the European Union Public Licence v1.2 (EUPL-1.2).** The `LICENSE` file now carries the official English EUPL-1.2 text; the SPDX identifier in `package.json` and the in-app license link (Settings footer / Help panel) point to the [European Commission's EUPL-1.2 page](https://interoperable-europe.ec.europa.eu/collection/eupl/eupl-text-eupl-12). The `NOTICE` file was removed — the EUPL, unlike Apache-2.0, has no NOTICE mechanism. The bundled leadership operating-guide's embedded license notice was updated to match. No functional/code behaviour changes.

## [0.164.0] - 2026-07-02 "Cixin"

### Added
- **Opt-in background auto-pull + deletion-semantics (SP5)** — the final slice; **the two-way calendar sync roadmap is now complete**. Each entity's existing **auto-sync** toggle is now **bidirectional**: in addition to auto-pushing changes to Outlook, it runs a **background auto-pull every 15 minutes** (and on tab re-focus) that applies **Outlook date reschedules back into the app** for **tasks, RAID items, changes, and absences**. Safe moves (unchanged since the last agreed baseline) apply **silently**; a move you also changed locally is skipped and surfaced as a single, **de-duplicated** "N calendar conflicts — open Pull to resolve" toast (the summary modal still opens only on a **manual** Pull). Each silent auto-apply is recorded in the **activity log**. **Deletion-semantics**: when an event is **definitively gone** (removed or cancelled in Outlook) the app now **prunes the stale calendar link and its sync baseline** so it stops re-appearing on every pull — and this is **truncation-safe** (an event merely beyond the fetch page-cap is never mistaken for a deletion). Milestones keep manual pull only. Requires Microsoft 365; pop-out windows are read-only.

### Notes
- Auto-pull reuses the existing per-entity `.auto` flag (no new settings/UI), the generic pull hook (new `background` mode: non-interactive token, no modal, prune, deduped count toast), and the proven scheduled-job-runner pattern for the runner (`use-calendar-auto-pull.ts`, ref-stable, overlap-guarded). A cross-instance in-flight lock keeps a manual and a background pull for the same entity from stacking. **Known behaviour**: with auto-push also enabled, a pruned event whose entity is still pushable is re-created on the next push (matches the existing write-back self-heal); a permanent per-item opt-out is future work. No new persisted `Workspace` field or column, no golden fixtures.

## [0.163.0] - 2026-07-02 "Sapkowski"

### Added
- **Absence two-way Outlook calendar pull (SP4)**: the final entity of the two-way calendar sync. A manual **"Pull from Outlook"** button on the **Resources** view fetches the current dates of the absence calendar events and applies **reschedules made in Outlook back onto absences**. Absences are the only **multi-day** entity, so the pull is **faithful to the whole range** — it reads both the event's **start and end** and maps them back, reflecting an Outlook **move _or_ resize** (the inclusive end is derived from Graph's exclusive all-day end). Conflicts follow the same **app-wins** rule: an Outlook change is auto-applied **only when the absence is unchanged since the last agreed baseline** — otherwise it is surfaced as a **per-row conflict** you resolve (keep the app's dates or take Outlook's), never a silent overwrite. Events **removed or cancelled in Outlook** raise a **deletion notice**, and a **summary modal** lists what was applied, the conflicts, and the deletions. Absences only in this slice. Requires Microsoft 365; pop-out windows are read-only. **The pull roadmap (milestones · tasks · RAID · changes · absences) is now complete** — only auto-pull (SP5) remains.

### Notes
- The shared pull engine, read helper, generic hook, and summary modal gained an **optional event end date** so absences can carry a range; every new field is optional, so the four single-date entities (milestones/tasks/RAID/changes) stay **byte-identical** (baseline value unchanged, no extra plan-object keys, no changed rendering). The per-device sync baseline (`lop-app:calendar-sync-baseline`) stores a range as `"start|end"`. No new persisted `Workspace` field or column (`Absence.outlookEventId` already exists), no new golden fixtures. Like RAID/Change, absence is a thin callback-prop pane, so the pull hook + summary modal live in `task-manager.tsx` and thread through `workspace-section` to `resources-panel`.

## [0.162.0] - 2026-07-02 "Bennett"

### Added
- **RAID + Change two-way Outlook calendar pull (SP3)**: the two-way calendar sync — which gained pull directions for milestones in 0.160 and tasks in 0.161 — now extends to **RAID items and changes**. A manual **"Pull from Outlook"** button on the RAID and Change panes fetches the current dates of their calendar events and applies **date reschedules made in Outlook back onto RAID target dates and change decision dates**. Conflicts follow the same **app-wins** rule: an Outlook move is auto-applied **only when the item is unchanged since the last agreed baseline** — otherwise it is surfaced as a **per-row conflict** you resolve (keep the app's date or take Outlook's), never a silent overwrite. Events **removed or cancelled in Outlook** raise a **deletion notice**, and a **summary modal** lists what was applied, the conflicts, and the deletions. RAID + changes only in this slice. Requires Microsoft 365; pop-out windows are read-only.

### Notes
- Reuses the SP1/SP2 generic pull engine, hook, and per-device sync baseline (`lop-app:calendar-sync-baseline`), and summary modal. Unlike the fat Tasks pane, RAID and Change are thin callback-prop panes, so both pull hooks live in `task-manager.tsx` and thread through `workspace-section`. No new persisted `Workspace` field or column (`RaidItem.outlookEventId` / `ChangeItem.outlookEventId` already exist), no new golden fixtures. Absences (SP4) and auto-pull (SP5) follow.

## [0.161.0] - 2026-07-02 "Newitz"

### Added
- **Task two-way Outlook calendar pull (SP2)**: the two-way calendar sync — which gained its first pull direction for milestones in 0.160 — now extends to **tasks**. A manual **"Pull from Outlook"** button on the Tasks (**Open Points**) view fetches the current dates of the task calendar events and applies **due-date reschedules made in Outlook back onto the tasks**. Conflicts follow the same **app-wins** rule: an Outlook move is auto-applied **only when the task is unchanged since the last agreed baseline** — otherwise it is surfaced as a **per-row conflict** you resolve (keep the app's date or take Outlook's), never a silent overwrite. Events **removed or cancelled in Outlook** raise a **deletion notice**, and a **summary modal** lists what was applied, the conflicts, and the deletions. **Jira-synced tasks are excluded** (Jira owns their dates). Tasks only in this slice. Requires Microsoft 365; pop-out windows are read-only.

### Notes
- Reuses the SP1 pull engine, per-device sync baseline (`lop-app:calendar-sync-baseline`), and summary modal. No new persisted `Workspace` field or column (`Task.outlookEventId` already exists), no new golden fixtures. RAID + changes (SP3), absences (SP4), and auto-pull (SP5) follow.

## [0.160.0] - 2026-07-02 "Ellison"

### Added
- **Milestone two-way Outlook calendar pull (SP1)**: the calendar sync — until now write-only (app → Outlook) — gains its first **pull** direction. A manual **"Pull from Outlook"** button in the Milestones toolbar (next to "Push to Outlook") fetches the current dates of the milestone calendar events and applies **date reschedules made in Outlook back onto the milestones**. Conflicts follow an **app-wins** rule: an Outlook move is auto-applied **only when the milestone is unchanged since the last agreed baseline** — otherwise it is surfaced as a **per-row conflict** you resolve (keep the app's date or take Outlook's), never a silent overwrite. Events that were **removed or cancelled in Outlook** raise a **deletion notice**. A **summary modal** lists what was applied, the conflicts to resolve, and the deletions; a **per-device sync baseline** records each event's last-agreed date. Milestones only in this slice. Requires Microsoft 365; pop-out windows are read-only.

### Notes
- No new persisted `Workspace` field or column: the sync baseline is a per-device localStorage store (key `lop-app:calendar-sync-baseline`), excluded from exports and Turso and cleared on app reset. First of a multi-slice two-way calendar sync roadmap (tasks · RAID · changes · absences to follow).

## [0.159.1] - 2026-07-01 "Gladstone"

### Changed
- **Absence calendar-sync polish.** Pushed resource-absence Outlook events are richer: each now carries a **free/busy status** (`training` shows as **busy**, all other types as **out-of-office**), a **secondary Outlook category** matching the absence type (vacation / sick / training / other) so events can be filtered by type, and the event body **re-syncs automatically when the absence note changes** (previously a note-only edit needed a manual push). No settings or storage changes; the reconcile category is unchanged so existing synced events are unaffected.

## [0.159.0] - 2026-07-01 "Gladstone"

### Added
- **Resource-absence Outlook calendar write-back (SP4)**: the generic calendar write-back — already covering milestones, tasks, RAID items, and change decisions — now extends to **resource absences**, completing the roadmap. Each current or upcoming absence (`endDate` today or later) is pushed to the authenticated user's Outlook calendar as a single **multi-day all-day event** spanning its start→end range. **Sick leave is excluded** for privacy; vacation, training, and other absences sync. Toggled independently: an **"Add to Outlook calendar"** switch with a manual **"Push to Outlook"** button in the Resources view, plus the same switch (and optional **auto-sync**) centrally in Settings → Integrations → **Calendar write-back**. Events are tagged per project + entity type, so absence syncs never touch the milestone, task, RAID, or change calendar entries. Auto-sync runs quietly in the background (debounced, no consent pop-ups) when enabled. Requires Microsoft 365; pop-out windows are read-only.

### Notes
- Completes the generic calendar write-back engine (milestones · tasks · RAID · changes · absences). No new Turso table or export field; `Absence.outlookEventId` rides the existing six absence write paths.

## [0.158.0] - 2026-07-01 "Erikson"

### Added
- **Change decision-date Outlook calendar write-back**: the calendar write-back that already covered milestones, tasks, and RAID items now extends to **change-control items**. A decided change — one that carries a **decision date** — is pushed to the shared Outlook calendar as an **all-day event on its decision date**. Like the other entity types it is toggled independently: a per-pane **"Add to Outlook calendar"** switch with a manual **"Push to Outlook"** button in the Changes pane, and the same switch (plus an optional **auto-sync**) centrally in Settings → Integrations → **Calendar write-back**. Only changes with a decision date are pushed (clearing the date removes the event on the next sync); events are tagged per project + entity type so the change syncs never touch the milestone, task, or RAID calendar entries. Auto-sync runs quietly in the background (debounced, no consent pop-ups) when enabled. Requires Microsoft 365; pop-out windows are read-only.

### Notes
- `ChangeItem.outlookEventId` persists across all backends (JSON, CSV, Markdown, Turso single + multi-tenant, IndexedDB); existing databases self-heal the new column. The per-device calendar-sync toggle lives in `settings.outlookCalendar` and is excluded from exports and Turso.

## [0.157.0] - 2026-07-01 "Baxter"

### Added
- **Outlook calendar write-back for tasks and RAID**: the calendar write-back that already covered milestones and steering-committee meetings now extends to **tasks** (as all-day events on their due date) and **RAID items** (on their review/target date). Each entity type is toggled independently — a per-pane **"Add to Outlook calendar"** switch with a manual **"Push to Outlook"** button, and the same switches (plus an optional **auto-sync**) centrally in Settings → Integrations → **Calendar write-back**. Only active items with a date are pushed (finishing a task, closing a RAID item, or clearing its date removes the event on the next sync); events are tagged per project + entity type so the syncs never touch each other's calendar entries. Auto-sync runs quietly in the background (debounced, no consent pop-ups) when enabled. Requires Microsoft 365; pop-out windows are read-only.
- **Stakeholder map drag-and-drop**: on the Influence / Interest map you can now drag a stakeholder chip between the four quadrants to update its influence and interest levels directly — no need to open the edit modal. Dragging into the high-influence or high-interest side promotes that axis; dragging out of it steps a "High" down to "Medium" while preserving an existing Medium/Low. Read-only in pop-outs.

### Notes
- `Task.outlookEventId` and `RaidItem.outlookEventId` persist across all backends (JSON, CSV, Markdown, Turso single + multi-tenant, IndexedDB); existing databases self-heal the new column. The per-device calendar-sync toggles live in `settings.outlookCalendar` and are excluded from exports and Turso.

## [0.156.0] - 2026-07-01 "Kingfisher"

### Added
- **Multi-project Jira sync**: the Jira integration now syncs more than one project. A single **primary project** stays fully two-way and remains the target for creating new Jira issues and for the issue-type / assignee pickers, while Settings → Integrations → Jira → **"Also sync from other projects"** lets you add extra projects to sync — each with a per-project **read-only** toggle (default on). Read-only projects are pull-only: their issues sync into the app but your local edits never push back (Jira-managed fields revert on the next sync), whereas two-way extras behave like the primary. The sync JQL queries all selected projects at once; a single-project setup is unchanged. Configured extras remain manageable (read-only toggle + remove) even before a fresh connection test reloads the project list.
- **Read-only telegraph**: a task's Jira badge distinguishes a **watched / read-only** project (padlock) from a **two-way** one (sync arrows), and the task editor shows a read-only warning banner naming the project — so it is always clear which edits will stick.

### Notes
- The extra-projects list is per-device Jira settings (`settings.jira.extraProjects`), not workspace/project data: it is excluded from exports and never written to Turso, CSV, or Markdown. Existing single-project configurations load and sync unchanged.

## [0.155.0] - 2026-07-01 "Valente"

### Changed
- **Next actions redesign**: the Action Center now opens with a focus **"Do this first"** card for the single most-urgent action (with its full call-to-action set), above the kept Now / Soon / Monitor tiers. Compact rows are **action-first** — each leads with its real next step (assign owner, reschedule, clear blocker, re-baseline, draft, mark done, or open) with the rest folded into a "⋮" overflow; the source label moved into the reason line and the numeric score now shows only in expert mode. Tier urgency reads from a coloured dot + left stripe. The hero's primary button is prominent (filled) for every action type, including the popover actions (assign / escalate / re-baseline / reschedule).

### Fixed
- **Contrast**: the tier count and hero label no longer use the amber RAG *text* token, which fell below WCAG AA as small text on the Dark and Dashboard styles (3.5:1 / 4.4:1); tier colour now rides the non-text dot and stripe instead. The Next actions view was added to the automated accessibility gate, so this is verified on every build across the light, dark, and Dashboard styles.

## [0.154.0] - 2026-06-30 "Mitchell"

### Changed
- **Clearer resize anchors**: every data-table column-resize handle now shows an always-visible vertical "⋮" grip (instead of an invisible strip), dim at rest and brightening to the table-head accent on hover and throughout a drag. The native pane/window and resize-textarea corner grips are accent-tinted so they're easy to spot. Palette-safe (token-driven, no off-palette colour) and hidden in print.

## [0.153.0] - 2026-06-30 "Slatter"

### Added
- **Custom color schemes**: Settings → Appearance gained a third "Custom" visual style alongside Acme and Dashboard. A scheme is your own palette (brand primary, accent, background, surface, text and the RAG status colours, plus an Advanced disclosure for the remaining role tokens) bundled with the app name and footer slogan. Build, name, save, rename, delete, and import/export schemes as JSON; the AA-safe text variants are derived automatically and a live WCAG contrast panel warns (non-blocking) about low-contrast pairs. Custom is light-only (it pins light like the Dashboard style) and applies pre-paint with no flash on reload. Schemes are per-device (never exported with project data) and imported colours are validated to hex.

### Fixed
- **Scheme coherence**: selecting, saving, importing, or deleting a scheme now keeps the active scheme exactly in sync with what is rendered (previously these could diverge — e.g. selecting a saved scheme didn't recolour, or a deleted scheme's colours lingered). Applied edits persist to the active scheme so they survive a reload.
- **Branding ownership**: under Custom the scheme owns the app name and footer slogan (the duplicate global inputs are hidden), so switching schemes no longer leaves a previous scheme's slogan behind, and applying a colour-only scheme never wipes a globally-set logo.

## [0.152.0] - 2026-06-30 "Tidhar"

### Changed
- **Streamlined view chrome**: redundant page headings were removed and toolbars tidied across many views — the Dashboard (Print/Reset-size now stacked beside the greeting; Print shows an icon only), Reports (Add/Remove-report moved to the left), Activity (the header now reads "N entries logged"), Help (tabs, search and Print/Reset share one row with a full-width search box), Documents, Time bookings (the "enable Timelog" note moved into the button row), RACI, Calendar and Planning (action buttons moved into their filter/control rows), and the Resources overview (heading renamed to "Overview").

### Fixed
- **Printing**: long views now print across multiple pages instead of being clipped to a single page, and printed output no longer shows scrollbars or rounded container boxes. (Root cause: per-view inner scroll containers were never reset for print, and the print root was pinned to one page's height via `inset:0`.)

## [0.151.0] - 2026-06-30 "Swanwick"

### Added
- **Documents card grid**: the Documents view is now a responsive, filterable card grid. Each card shows the file's type (PDF/Word/Excel/image/folder/link), a host badge (SharePoint/Confluence/GitHub/…), and the date it was added; you can filter by source entity, search by name, and sort by name/added/source/type. New links capture an "added" date.
- **Documents tip banner**: a contextual "Learn more" callout atop the Documents view, backed by a new Documents Help concept.
- **Column show/hide saved in views**: RAID, Milestones, Changes, and Stakeholders panels gained a column-configuration popover to show/hide individual table columns; the choice is stored as part of a saved panel view.

### Changed
- **Dashboard**: removed the folded "Recent activity" disclosure from the landing cockpit.
- **Documents toolbar**: the Add button, source filter chips, search box, sort control, and Print/Reset-size buttons now share a single toolbar line.

### Fixed
- **/recovery hydration**: the recovery page and the safe-mode home banner are now rendered client-only, fixing a server/client hydration mismatch.
- **Version history**: automatic checkpoints no longer save a redundant version when nothing changed, and each version now shows how many records changed per entity (e.g. "RAID (3), Changes (1)") next to its timestamp.

## [0.150.0] - 2026-06-30 "Robson"

### Changed
- **"How it all connects" is now a 2D map**: the Help relations view renders concepts as boxed nodes on a grid with connector lines, matching the Information-flows diagram's look. Hovering or focusing a concept highlights its links and neighbours; clicking still jumps to the concept.
- **Shared diagram engine**: the relations map and the Information-flows diagram now share one reusable node-graph component, so the two diagrams look and behave consistently.
- **Information flows renders correctly in dark mode**: the diagram's node boxes now follow the colour theme instead of staying white.

## [0.149.0] - 2026-06-29 "Leiber"

### Changed
- **In-pane Help view is now tabbed**: the full Help view gained tabs in its header — **Help**, **Guided tours**, **How it connects**, and **Information flows** — beside the search box; clicking a tab swaps the body and only the active tab's body mounts. The search box appears only on the Help tab. This replaces the previous accordion region, and the contents list is resizable.
- **Floating Help panel reverted to content-only**: the pop-out Help panel returns to the shared content pane (no tabs); its introductory slogan line was removed.
- **Fix**: table-of-contents stacking in the Help content pane.

## [0.148.0] - 2026-06-29 "Kuang"

### Added
- **Help — guided tours, connections & data flows in one place**: the Help view's top area is now a single tabbed region with three panels — **Guided tours**, **How it all connects**, and **Information flows** — one open at a time (Tours by default). The information-flows diagram (previously only in Settings → Integrations) now also appears here.
- **Information flows — clearer, grouped diagram**: the diagram is reorganised into two colour-coded zones — *Your data* (local storage, **file storage**, Turso) and *Connected services* (Jira, Timelog, **SharePoint**, **Outlook**, Anthropic) — with Microsoft 365 split into separate SharePoint and Outlook nodes (9 nodes total). Shown in both Settings and Help.

### Changed
- **Redesigned Help content**: each topic now renders as a card with a clearer hierarchy, and the table of contents highlights the section you're reading as you scroll (scroll-spy). The floating Help panel is a little larger to suit the new layout.
- **Guided-tour cards**: each tour now shows an icon and its step count, and a completed tour offers "Replay tour".
- **Relations map**: the "How it all connects" concept map is now a vertical, easier-to-scan layout.

## [0.147.0] - 2026-06-29 "Rucker"

### Added
- **Full-width AI assistant + model switcher**: the AI assistant pane is now full-width (matching the other primary views) with a model-switch dropdown in a new top bar — live `/v1/models` with the curated registry as fallback — sitting just left of the reset-size button.
- **Analyze with AI — progress modal**: the Action Center "Analyze with AI" button is restyled like Ask Claude and moved beside the heading; while the call runs it shows a blocking progress modal with a Cancel that aborts the request.

### Changed
- **Unified Help layout**: the floating Help window and the in-pane Help view now share one grouped two-pane component (Concepts · Workflows · Features · What's automated) — a wider table of contents, clearer hierarchy, a smaller default floating-panel size, and a container-query responsive stack. The Acme AI-usage-policy link was removed from the Help footer.
- **View tips inside the card**: every view's contextual Help tip now renders inside its own rounded card (like Open Points) instead of floating above it; the shared above-card callout was removed.

## [0.146.0] - 2026-06-29 "Wecker"

### Added
- **AI model picker — live models + key validation**: the Settings → AI model dropdown lists live models fetched from your Anthropic account (`/v1/models`), with the curated registry as the offline fallback. The API key is validated for format on entry; a malformed key is discarded with a toast.
- **Action Center — signal grouping + caps**: all signals for one item (e.g. a task that is overdue *and* unassigned) collapse into a single row showing the strongest reason with a "+N more reasons" expander; the Now/Soon tiers cap at five rows with a show-more.
- **Action Center — layout**: each row has a colour-coded RAG urgency stripe, a compact "⋮" overflow menu for secondary actions, and expandable reasons.
- **Action Center — new signals**: a task-attention provider flags active tasks that are unassigned, stale (no update in 14 days), blocked, or dependency-blocked (an unfinished finish-to-start predecessor).
- **Action Center — inline resolutions**: resolve common signals in place — assign an owner, mark done, clear the blocker, or reschedule (date picker) — without leaving the Action Center.
- **Create project from multiple files**: the create-project wizard accepts multiple uploaded files in one go (invalid files are skipped with a notice) and shows a blocking progress modal with a Cancel that aborts the AI call.

### Changed
- `ChatModel` is now an open string (any live `claude-*` id), validated by pattern on load so a live-selected model survives a reload.

## [0.145.0] - 2026-06-28 "Arden"

### Added
- **Dashboard masonry cockpit**: the dashboard is now a single masonry of cards (CSS multicolumn) that packs tightly on wide screens instead of leaving large empty gaps under the short cards. Cards never split across a column; reading order is column-major, priority-first.
- **Trends widget click-through**: clicking the dashboard Trends card jumps to the Trends view. Trends is shown on the dashboard only when a Turso backend is active.
- **Dashboard sub-menu**: Next actions and Trends are now sub-menu entries under Dashboard in the sidebar (the Next-actions urgency badge bubbles up to Dashboard when the sub-menu is collapsed). The app opens on the Dashboard by default.
- **Resizable Portfolio health pane** with a reset-size button.
- **Add-first-item empty states**: budget, Gantt, milestones, changes, stakeholders, RAID, Open Points and Documents now show a click-to-add box when empty (text + "+ Add …"), with no solid outer box (matches the Gantt look); the data view keeps its border.

### Changed
- **Dashboard toggles removed**: the on-panel Compact (density) and Trends toggle buttons are gone. Density is set only in Settings → Appearance; Trends visibility follows the Turso backend.
- **Resource sub-views** show their own heading (Workload / Calendar / Planning) instead of a generic "Resources"; the Manage-roles heading was removed.
- **Flatter panels**: the solid outer box around empty states was removed; the Activity log and the Steering-committee form render flat.
- **Manage roles**: the rate-card table columns are no longer resizable (fixed default widths; the reset-column-widths button was removed).

### Fixed
- Milestones: a search/filter with no matches now shows a "no matches" message instead of the add-first-item box.
- The Trends sub-entry no longer appears in the classic sub-tab row on a file backend (it is Turso-only).

## [0.144.0] - 2026-06-28 "Nevala-Lee"

### Added
- **Timelog two-step fetch**: "Load people" now pulls the Timelog directory only (cheap); a filter box narrows it and you tick the people you want, then "Fetch bookings" pulls timesheets for the ticked employees only (org scope) — keeping request volume under the rate limit. Inactive/nameless directory rows are filtered out, rows can be removed individually (✕) or in bulk, the list is scrollable, and the fetched people + project matches persist per-device so they survive a view switch.
- **Load my projects**: load the projects where you are the Project Manager in Timelog, so a PM can match them to budgets before any bookings are fetched. An "Include closed projects" option also pulls finished projects, and a customer picker loads a single client's projects (server-side filter).
- **AI master switch**: a new "Enable AI assistant" toggle gates all AI features (chat, action suggestions, scheduled jobs, weight suggestions, describe-to-create). It is off by default, including for existing installs; the AI configuration stays collapsed until enabled.
- **One-time integration disclaimer**: the first time any integration or AI feature is enabled (AI, Jira, Microsoft 365, Turso or Timelog), a one-time security & responsibility note is shown and acknowledged once per device.

### Changed
- **Timelog reads now page through all results** (previously only the first ~10 rows of any list were ingested, badly undercounting booked hours) and retry transparently on rate-limit (429) responses with backoff; a Cancel button aborts an in-flight fetch and a Clear-all button resets the fetched data. A banner explains that a resource's hours count as booked only when its Timelog user is linked to a resource **and** the booking's project is linked to a budget bucket.
- **Settings → Integrations**: Jira configuration now lives inside the Integrations box (below Timelog); its fields appear only after "Enable Jira sync" is ticked. The stored-credential note now states secrets are encrypted at rest, and Timelog gained a help link to its personal-token page.

### Fixed
- Resource Directory: clicking a row's discipline/grade dropdown no longer also opens the edit modal.
- Timelog actuals aggregation now requires the plan granularity explicitly (removed a silent monthly default that could drop hours from earned-value), and non-project (absence) time no longer creates a blank project row.

## [0.143.0] - 2026-06-27 "Haldeman"

### Added
- **Portfolio health view** (Turso portfolios): a cross-project rollup that loads each project and runs the dashboard engine to show per-project RAG (overall/schedule/budget), completion %, open RAID and milestone health, plus aggregate KPIs across the portfolio. Turso-only (file-mode shows a "switch to Turso" hint); read-only and safe in pop-outs.

### Changed
- **Accessibility hardening**: the dashboard Trends toggle now keeps a stable "Trends" label with `aria-pressed` tracking the shown state (was announcing the opposite action); the AI-assistant and Kanban-board views are now covered by the accessibility gate.

### Fixed
- WCAG AA contrast on the AI-consent block (new darker purple) and on overdue due-dates on Kanban cards in dark mode.

## [0.142.0] - 2026-06-26 "Kloos"

### Added
- **Guided backend setup wizard**: a stepped wizard (Settings → Integrations, and the new-project window) walks through storage & connections (IndexedDB / file / Turso single / Turso multi-tenant + Microsoft 365), the AI assistant key, Jira, and Timelog, ending with a review summary. Integration steps are skippable; the existing flat Settings → Integrations panel remains as the advanced/edit surface. The wizard never appears in pop-out windows.
- **Information-flows diagram**: the Settings → Information flows diagram now includes the Timelog integration node (reached via the `/api/timelog` server-side proxy).

### Changed
- **Task editor Delete button**: moved to the footer's left edge and colorized (pink/destructive), separated from the other actions — matching the change-control edit modal. Applies to both the modern full-page task editor and the classic task modal.

### Fixed
- Delete button hover state now meets WCAG AA contrast in dark mode.
- Setup wizard: the review step reports Turso storage as configured only when a database URL **and** token are present (not merely the kind), and now includes Microsoft 365; the Timelog form is no longer duplicated across two steps; and the portfolio-mode "Save & switch" (which reloads the page) is hidden inside the wizard so it can't discard an in-progress create-project draft. Nested modals (the wizard opened from the create-project window) now handle Escape/Tab independently — closing the wizard no longer dismisses the create dialog underneath.

## [0.141.0] - 2026-06-26 "Asher"

### Added
- **Mockup-style polish**: the "Dashboard" visual style moves closer to its design reference — a completion-% gauge bar under the completion KPI (red→amber→green gradient; the Acme style shows a solid brand-green bar), trend deltas as tinted pill chips, a lighter active look for segmented controls (white pill + green text on a grey track), and a subtle hover-lift on clickable tiles. All differences flow through CSS role tokens, so the Acme style is unchanged. Chip tints are opaque pre-composited colors so the delta text stays WCAG AA even on tile hover.

## [0.140.0] - 2026-06-26 "MacLeod"

### Added
- **Dual-CI visual style switch**: a new "Dashboard" visual style (soft shadows, gradient-ready bars, conventional red/amber/green status, light table header) selectable in Settings - Appearance, alongside the flat Acme style. Orthogonal to light/dark (the Dashboard style is light-only and pins light while active). All styling is CSS-token-driven; the palette-sweep + axe gates now scan every shipped combo (AIPM-light, AIPM-dark, Dashboard-light).

### Fixed
- Dark-mode contrast (WCAG AA) for Acme-dark-blue text on dark surfaces in the RAID, Gantt, and Budget views (surfaced by the expanded axe matrix).

## [0.139.0] - 2026-06-24 "Bacigalupi"

### Added
- **Timelog integration**: connect a Timelog timekeeping account (Settings → Integrations) to pull actual time bookings via a server-side SSRF-guarded `/api/timelog` proxy. Match Timelog users→resources and projects→budget buckets (auto-match by email/name/PO, manual override always wins). New "Time bookings" view surfaces booked-vs-budget win/loss and time KPIs (booked hours, billable %, unattributed) with a non-destructive "Apply to budget" action. Per-device device-sealed token; per-project link mappings persist across all backends.

## [0.138.0] - 2026-06-23 "Ryman"

### Changed

- The Dashboard KPI strip and the budget project/bucket metric cards (contribution margin, CPI, consumption) and the per-bucket hours breakdown now stack to a single column on small screens instead of forcing three or four columns and overflowing. The Jira-settings issue-type checkbox list collapses the same way. Desktop layouts are unchanged — these are additive responsive breakpoints matching the grid pattern already used by the Reports tile grids.
- Aligned the Change report's two side-by-side table grids (`gap-6` → `gap-4`) with the RAID report and the app-wide two-column gap convention, so the report tabs share one spacing rhythm.

### Fixed

- The Documents panel's per-row remove buttons now carry a row-unique accessible name (e.g. "Remove – Spec.docx") instead of an identical "Remove" on every row, so screen-reader users can tell which document a button deletes (WCAG 2.4.6). The Documents view is outside the axe CI gate, so this was previously undetected.

## [0.137.0] - 2026-06-23 "Hand"

### Changed

- Dashboard compact density now also tightens the gap between the two-column section grids (Progress + Budget, Milestones + Changes). Previously these gaps stayed at the comfortable size, so compact mode compressed everything except them; the spacing is now uniform. Added a `sectionGap` class to `dashboard-density.ts` (comfortable is unchanged — a no-op for existing users).
- Aligned the Reports health-card tile grid spacing (`gap-2` → `gap-3`) to match the adjacent inquiry tile grid, so the two peer grids share one rhythm.

## [0.136.0] - 2026-06-23 "Moorcock"

### Added

- Multi-row bulk edit on the RAID, Milestones, Changes, and Stakeholders panels: select rows with the new checkbox column (or select-all), then apply field changes to the whole selection at once via an inline panel where each field has its own enable toggle.
  - RAID: severity, owner, target date. Milestones: target date, achieved date. Changes: status, type, impact, requested by. Stakeholders: category, influence, interest.
- Built on a reusable stack (`row-selection`, `use-row-selection`, `bulk-edit-bar`, `bulk-edit-panel`); edits ride the existing per-entity save + sanitize path, so no new stored data.

### Fixed

- Entity save handlers (RAID/Changes/Stakeholders) now use functional state updaters, so applying a bulk edit to several rows persists every row instead of only the last one.

## [0.135.0] - 2026-06-23 "Silverberg"

### Added

- Shared interaction-state atoms (`interaction-styles.ts`) — a canonical keyboard focus ring, a 150 ms colour transition, and a subtle button press — composed onto every interactive control for consistent hover/focus/press feedback across the app.
- `EmptyState` component for composed "nothing here" views, replacing bare no-data lines on roughly fifteen lists (Dashboard, Milestones, Reports, Settings, History, Trends, Documents, Projects, and more).
- `Skeleton` / `PanelSkeleton` loading placeholders shown while each of the twenty lazily-loaded view panels fetches its chunk, so a first visit shimmers into place instead of flashing blank.

### Changed

- Normalised every weak `focus:ring-1` to the 2 px standard ring; form fields gain a focus ring + transition, buttons additionally get a press; bespoke semantic focus colours (invalid-state, consent, critical-path) are left intact.
- Swept Dashboard, the four entity panels and their edit modals (RAID / Milestones / Changes / Stakeholders), Budget / Resources / Reports, all Settings sections, the top-bar menus and global search, and Tasks / Kanban / Gantt for interaction-state consistency.

## [0.134.0] - 2026-06-22 "Vance"

### Changed
- The Change report lays its summary tables out in two columns — By type beside By status, By impact beside By requestor — instead of one stacked column.
- The Milestones panel now uses the standard bordered inner-scroller shell (matching the Resource Directory).
- The global search box sits at the left edge of the top-bar action cluster instead of between the icons.
- The Steering Committee content now has padding inside its panel shell.

### Added
- Column resizing, with a Reset-columns button, on the Documents panel and on the Steering Committee meetings and information-schedule tables.

## [0.133.0] - 2026-06-22 "Link"

### Added
- Saved views now extend to the Reports panel. Each of the three report tables (By assignee, By group, By label) persists its sort and filter as named per-device presets, completing the saved-views roadmap (tasks 0.130.0, cross-view 0.132.0, Reports 0.133.0).

## [0.132.0] - 2026-06-22 "Disch"

### Added
- Saved views now extend beyond the tasks list to the RAID, Milestones, Changes, and Stakeholders panels. Each panel gains the same Save / apply / delete preset control, capturing its search, filters, and sort. Presets are per-device and scoped to their own panel; column widths and pane sizes continue to persist independently.

## [0.131.1] - 2026-06-22 "Fowler"

### Fixed
- Hiding the top-bar timezone switcher now also clears any active display-timezone override, so timestamps no longer stay stuck in a previously chosen zone with no visible control to reset it.

## [0.131.0] - 2026-06-22 "Fowler"

### Changed
- The app now opens on the Dashboard instead of the AI Assistant.
- Dashboard: the Compact-view and Trends toggles moved into the card's header toolbar (beside Print), and the report date now sits on the "Overall" line.
- Steering committee now uses the same resizable, bordered pane layout as the other content views.
- Task-editor actions (send inquiry, delete, cancel, update) now live only in the editor, not the top bar.

### Added
- "Configure AI assistant" on the Dashboard now jumps straight to Settings → AI.
- Optional setting to show a timezone switcher in the top bar (Settings → timezone; hidden by default).
- Jira-synced tasks show a read-only badge (lock icon + tooltip) on the board and table, indicating drag and manual status changes are disabled.

## [0.130.0] - 2026-06-22 "Ballard"

### Added
- Saved views for the tasks list: save the current filters, sort, and visible columns as a named preset and re-apply it from the toolbar (per device). Delete presets you no longer need.

## [0.129.0] - 2026-06-22 "Slonczewski"

### Changed
- Global search polish: press ⌘K / Ctrl-K (or "/") to jump to the search box; matched text is highlighted in results; recently opened items appear when you focus the empty search box.

## [0.128.0] - 2026-06-22 "Harrison"

### Added
- Global search in the top bar: query tasks, RAID items, changes, milestones, and stakeholders at once; selecting a result jumps to the item, opens its editor, and highlights its row. Type a number to jump to an item by id.

## [0.127.0] - 2026-06-22 "Sawyer"

### Changed
- In the default modern layout, a Dashboard or Action Center deep-link to a task now scrolls to and briefly highlights the task in the list/board when you close the full-page editor — previously the highlight was hidden behind the editor and never seen. Classic/popout and the other panels already highlighted on deep-link.

## [0.126.0] - 2026-06-22 "McIntyre"

### Added
- Deep-link scroll + highlight now also works in the tasks **Kanban board**: a Dashboard or Action Center deep-link to a task scrolls its board card into view and briefly outlines it (`outline-ui-green`), matching the table-row behaviour. Closes the board-mode gap left by 0.125.0. The remaining graceful no-ops are the tasks full-page editor (list unmounted) and any card hidden by an active filter/search.

## [0.125.0] - 2026-06-22 "Brunner"

### Added
- Dashboard and Action Center deep-links now scroll the target row into view and briefly highlight it (an `outline-ui-green` flash) in its list — across the RAID, milestones, changes, stakeholders, and tasks panels — in addition to opening the item's editor.

## 0.124.0 "Pratchett" — 2026-06-22

### Dashboard click-through parity
- Every Dashboard surface is now clickable: KPI tiles, Progress/Budget tiles and the completion sparkline jump to their view; Top Changes rows, RAID register rows and milestone horizon chips open the specific item; recent-activity rows jump to the relevant view by kind.
- Resolves the prior asymmetry where RAID/milestone/change navigation dropped the item id — now they deep-link via the shared `requestOpen` channel (the same one the Action Center uses).

## [0.123.0] - 2026-06-21 "Weir"

### Added
- **Dashboard density toggle.** A per-device Comfortable/Compact preference for
  the Dashboard. Compact tightens the cockpit's vertical rhythm, KPI gap, and
  card padding to fit more on screen — spacing only, no font or color change.
  Toggle it from the on-panel button beside the Trends toggle or from
  Settings → Appearance; the choice is remembered per device.

## [0.122.0] - 2026-06-21 "Cline"

### Added
- **Dashboard completion-trend sparkline.** A compact line under the at-a-glance
  KPI strip shows how % complete has moved over recent Turso snapshots, falling
  back to a reconstruction from the local activity log when snapshots aren't
  available. Self-hides until there are at least two data points.

## [0.121.0] - 2026-06-21 "Yoon"

### Added
- **Dashboard KPI trend arrows.** The "at a glance" headline numbers —
  completion %, overdue tasks, open RAID — now carry a trend arrow (↑/↓/→) and
  the signed change since your last visit, colored green when the project moved
  the right way and pink when it didn't. The comparison reuses the same
  per-visit snapshot as the "since you last looked" strip, so first-time and
  fresh visits show no arrow until there is a prior to compare against.

## [0.120.0] - 2026-06-21 "Chiang"

### Added
- **Dashboard get-started coaching.** A new project's Dashboard now shows a
  "Get started" card with one-tap setup CTAs — add your first task, configure
  the AI assistant, add a milestone, set up a budget — each jumping to the right
  view. The card self-hides once the project has any task, so it never nags an
  active project.

## [0.119.0] - 2026-06-21 "Bardugo"

### Changed
- **Dashboard milestone horizon.** The Dashboard's milestone list is now a
  "what's coming" horizon — Overdue, This week, Next 2 weeks, and Later —
  with at-risk milestones flagged, replacing the flat near-term list. Pure
  date-bucketing; works on every storage backend.

## [0.118.0] - 2026-06-21 "Harkaway"

### Added
- **Dashboard landing cockpit.** The Dashboard now opens with a greeting and a
  "Since you last looked" strip that surfaces what changed since your previous
  visit — new/updated tasks, RAID and milestone activity, newly-overdue items,
  and project RAG status flips — with clickable chips that jump to the relevant
  view. The ranked next-actions queue is promoted to the top so the most
  important work is visible first, and the RAG override controls are folded into
  an "Adjust health ratings" disclosure to reduce clutter. Per-device,
  per-project state is stored locally (never exported).

## [0.117.0] - 2026-06-21 "Addison"

### Security
- The Jira API token is now **encrypted at rest** (AES-256-GCM, device-wrapped in the browser) instead of being stored in plain text in `localStorage` — matching the existing handling of the Anthropic API key and the Turso auth token. The token is blanked from the persisted settings blob and held as ciphertext in `localStorage["lop-app:secrets"]`, wrapped by a non-extractable WebCrypto device key; an existing plaintext token migrates to the sealed store on next load. The Jira site URL and email remain stored unencrypted (identifying, not secret). Microsoft 365 needs no change — only the public client/tenant IDs are stored, and MSAL owns its own token cache.

## [0.116.0] - 2026-06-20 "Vonnegut"

### Added
- The AI assistant understands the app's features: a built-in, view-scoped feature guide (in the operating-guide library, on by default, individually toggleable) tells the assistant what each view does and whether it can act on it — so it can answer "how do I …?" and guide you to capabilities. Knowledge only; it adds no new automated actions.

## [0.115.0] - 2026-06-20 "Sturgeon"

### Added
- Calendar timezones: the Calendar view now shows a live "world clock" strip with the current time (and date) in your default timezone plus each additional zone configured in Settings — useful for coordinating across distributed teams. The strip appears only when you've added extra zones.

## [0.114.0] - 2026-06-20 "Wilson"

### Added
- Timezone display: timestamps in the activity log, version history, and trends now render in a display timezone you choose from a top-bar switcher (Default / UTC / your additional zones), with the zone shown next to each time. The choice applies for the session and resets on reload; the underlying data is unchanged.

## [0.113.0] - 2026-06-20 "Nix"

### Added
- Timezones (foundation): set a per-project operating timezone and a per-device default (plus a list of additional zones). The app's day-boundary logic - what counts as overdue, due today, or due soon - now follows the resolved timezone instead of UTC. (Display of timestamps and the calendar's multi-timezone view follow in later updates.)

## [0.112.0] - 2026-06-20 "Grossman"

### Added
- Guided tour + demo showcase: first-run users get a short walkthrough of the main areas in the modern layout, a one-click "Explore a demo project" that loads sample data, and a "Take the tour" entry in the Help menu to replay it anytime. Per-device; the tour does not run in the classic layout or popouts.

## [0.111.0] - 2026-06-20 "Wexler"

### Added
- Steering committee: a new view to record the committee name, its members (linked to your resources), the meeting schedule (date, title, agenda, location), and "information schedule" rules - how many working days before each meeting a pack should circulate. The resulting pack reminders appear in the Action Center, and the committee's meetings plus the reminder due-dates can be pushed to your Outlook calendar (re-pushing never duplicates).

## [0.110.0] - 2026-06-20 "Islington"

### Added
- Create a project from a source: in the new-project wizard you can now upload a file (PDF, image, or text), pick a SharePoint document, or paste a Confluence page URL - the AI reads the content and pre-fills the project details. Confluence is fetched through a same-origin proxy reusing your Atlassian (Jira) credentials; SharePoint via Microsoft Graph.

## [0.109.0] - 2026-06-20 "Barnes"

### Added
- AI-suggested next-actions weight adjustments: a "Suggest with AI" button in the next-actions settings proposes new values for the confidence weights (and, optionally, all firing thresholds) from your project, snapshot trends, and your act/snooze/dismiss history. Review the per-row rationale and Accept the ones you want; values are always clamped to safe bounds.

## [0.108.0] - 2026-06-19 "Wurts"

Kanban board (SP-B).

### Added
- **Kanban board view for tasks:** a Table/Board toggle shows tasks as columns by status; drag a card between columns or use the per-card status select. Compact cards show assignee, due date, priority, health, Jira key, and RAID/Change links.
- **Send inquiry / Push to Jira / Delete** buttons in the task editor.

### Changed
- Jira-synced tasks now derive their status from the Jira status category and are read-only in the board and the table status dropdown — change them in Jira and the next sync reflects it.

## [0.107.0] - 2026-06-19 "Lynch"

Task workflow status (SP-A).

### Added
- **Task workflow status** (To Do / In Progress / On Hold / In Review / Cancelled / Done): a status column with palette-tokened badges, an inline status dropdown in each task row, and a status picker in the task editor (both the modern full-page editor and the classic/popout modal).
- **"Hide finished" toggle** in the tasks view (hides Done + Cancelled tasks).

### Changed
- `status` is now the source of truth for task completion; `completedDate` is auto-managed (invariant: Done ⟺ `completedDate` set). Cancelled tasks are terminal but excluded from overdue flags, suggested next actions, and completion metrics.
- Legacy tasks migrate on load: a set `completedDate` maps to **Done**, otherwise **To Do**.

## [0.106.0] - 2026-06-19 "Sterling"

Installable PWA (SP5 Phase 6 — scoped to installability only).

### Added
- **Install as an app:** a web manifest + a minimal service worker let you install the tracker as a standalone desktop/mobile app (launch from the home screen / dock). The service worker does **no** caching — every request goes to the network, so installed copies never serve stale bundles. Registered from a client component (CSP-nonce-safe); CSP gains an explicit `worker-src 'self'`. Periodic Background Sync (running scheduled jobs while the app is closed) is intentionally **not** included — the SP5 baseline already runs due jobs when you next open the app.

## [0.105.0] - 2026-06-19 "Morgan"

AI-orchestration roadmap **SP5** — scheduled Claude jobs (baseline). Closes the roadmap.

### Added
- **Scheduled jobs:** define recurring "portfolio analysis" jobs (daily/weekly cadence) that run a Claude analysis on a schedule. The baseline scheduler runs due jobs while the app is open — on load, on tab re-focus, and on a light interval — and catches up jobs missed while closed on next open (no server cron; honest about the browser constraint). Results surface as a desktop notification and a per-job run history in the new Settings → "Scheduled jobs" section. Advisory only — jobs never write to the workspace; they reuse the SP4 read-only analysis call. Opt-in: gated on a configured Anthropic key + the new `ai.scheduledJobs` toggle (default **off**, since each run is a billed API call). Persisted in a global `scheduled_jobs` store (Turso, kept out of `TABLE_NAMES`, with a localStorage fallback). Never runs in popouts.

### Changed
- The Action Center "Analyze with AI" call and the scheduled-job runner now share one workspace-context builder (no behaviour change).

## [0.104.0] - 2026-06-19 "Hutchinson"

AI-orchestration roadmap **SP4** — AI suggestions in the Action Center.

### Added
- **Action Center AI suggestions:** a manual "Analyze with AI" button runs one Claude call that returns a triage summary of the existing action queue plus net-new, cross-cutting advisory actions. Each AI action opens its referenced entity (when grounded to a real id) or seeds the AI chat. Advisory only — the deterministic engine is unchanged. Gated on a configured Anthropic key + the new Settings → AI "Action Center AI suggestions" toggle (default on).

## [0.103.0] - 2026-06-19 "Watts"

AI-orchestration roadmap **SP3** — an "Use AI" fast-path for creating projects.

### Added
- **AI project-creation fast-path ("Use AI").** When an Anthropic API key is configured, the
  create-project wizard opens on a new "Describe" step: write a plain-language brief and Claude
  proposes the project setup (name, dates, products, feature modules) plus optional starter content
  (risks/issues, milestones, key stakeholders, opening tasks). The proposal pre-fills the normal
  3-step wizard for review and edit — nothing is written until you create. Choosing a stored template
  instead replaces the AI-generated starter content (shown inline). Skip the step any time to set up
  manually. One structured Claude call; every proposed record passes the same per-entity validators
  as manual entry.
- **Configure the AI assistant from the new-project window.** The first-run empty state now offers a
  "Configure AI assistant" button alongside Turso and M365 setup — add your Anthropic API key before
  any project exists, which unlocks the "Use AI" describe step in the create wizard.
- **Reset to clean slate (Settings → General).** A danger-zone "Reset to clean slate" button, gated by
  a type-to-confirm dialog (type "yes, reset everything"), detaches every project and erases all
  browser-local app data — settings, secrets (including the Anthropic API key) and layout — then
  reloads to a fresh empty state. Project files and databases are NOT deleted; they are only detached
  and can be re-opened later.

## [0.102.0] - 2026-06-18 "Tepper"

AI-orchestration roadmap **SP2** — the embedded Claude assistant gains write tools beyond tasks,
plus document ingestion.

### Added
- **AI write tools for the whole register** — Claude can now create, update, and delete RAID items
  (Risks/Assumptions/Issues/Dependencies), change-control items, milestones, and stakeholders, and
  list stakeholders — not just tasks. Each entity routes through its existing sanitizer (enum/date/
  cap validation, per-category RAID status defaulting) and the popout read-only guard refuses every
  write in mirror windows, same as task edits.
- **Document ingestion** — attach a PDF, image (PNG/JPEG/GIF/WebP), or text file (.txt/.md/.csv) to
  the AI Assistant. PDFs and images go to Claude as native multimodal blocks; text files are inlined.
  Claude reads the document and, on request, extracts tasks/risks/milestones/stakeholders and creates
  them with the matching write tool. 20 MB per-file cap; unsupported types are rejected with a clear
  message. No new parsing dependency — this uses Claude's native document/image support.

### Changed
- The AI system prompt now briefs Claude on the RAID/Change/Milestone/Stakeholder tools and on the
  attach-and-extract workflow, and the confirm-before-delete rule now covers every delete tool.

### Removed
- The **Duplicate** button on built-in templates (Settings → Templates). Built-ins remain display-only;
  user templates are still created via "Save current project".

## [0.101.0] - 2026-06-18 "Norton"

UI/UX + secrets-management batch.

### Added
- **Manual document links** — the Documents view's "Add document" button is now always available
  (previously hidden unless SharePoint was enabled) and offers a manual name + URL entry (validated)
  for linking any document; the SharePoint picker still appears when M365 + SharePoint is on.
- **Stored-secret removal & passphrase confirm** — the Claude API key and Turso token settings now
  have a confirm-passphrase field (Save is disabled until both match) and a "Remove stored secret"
  button that forgets the ciphertext entirely.

### Changed
- **Reliable passphrase unset** — un-ticking "Require a passphrase to unlock" now always works
  (previously the AI-key toggle silently snapped back when the value was locked): it re-seals the
  value device-wrapped if it is in memory, otherwise forgets the locked-and-unknown secret.
- **Project delete moved off the active row** — the current/non-archived project no longer shows a
  destructive Archive/Delete button; those actions now live on the *other* (non-current) project rows
  so you cannot destroy the project you are in.
- **Full-width Milestones & Documents** — both views now fill the pane (were centered half-width) and
  scroll their content. Their resize-size storage key was bumped so a stale half-width size can't
  override the new full-width default (the pane is still user-resizable from the new baseline).
- **History compare restore** — per-row "Restore this" now also appears in the two-version and
  side-by-side compares (reverts the record to the older version); "Restore selected" moved up beside
  the per-row restores in the compare-with-current view; all compare/restore buttons gained tooltips.
- **Task editor alignment** — the "Edit task" heading and the control bar now line up with the field
  sections (the extra inset was removed).

### Fixed
- **Next-action button hover** — row CTA buttons now hover to a brand-blue tint distinct from the
  row's own hover, so the button affordance stays visible while the pointer is over the row.
- **Comm-template discoverability** — the template-category heading has a tooltip explaining the rows
  are clickable, and the rows themselves gained a hover effect.
- **Scrollbar gap** — added the standard content↔scrollbar gap to the Projects list, the Resources
  roll-up table, and the (now scrollable) Milestones table.

## [0.100.0] - 2026-06-18 "Hobb"

UI/UX consistency batch across many views, plus deeper version-history controls.

### Added
- **Whole-version restore** — every row in Version history now has a "Restore this state" button
  that reverts the entire workspace to that version (it diffs against the current state and restores
  all changes), alongside the existing selective restore.
- **Per-record restore in a comparison** — when comparing a version with the current state, each
  changed record now carries a "Restore this" button to revert just that record.
- **Side-by-side compare** — a "Compare side by side" button (beside "Compare selected") shows the
  two selected versions in two columns instead of an inline before→after diff.
- **Gantt → Milestones "Add milestone"** — clicking Add milestone in the Gantt now switches to the
  Milestones view and opens the New milestone dialog directly (previously the dialog was swallowed
  on the freshly-mounted view).
- **Milestones column-width reset** — the Milestones table gained the same "reset column widths"
  button the other tables have.
- **Task editor** — the full-page task editor now shows an "Edit task" / "New task" heading top-left
  and a ✕ close button beside the field cog; Jira-synced tasks get a "Sync with Jira" button beside
  Cancel; and several fields (group, dependencies, blockers, health) gained explanatory tooltips.

### Changed
- **Rounded table headers** — every data-table header now has rounded top corners on both ends
  (previously the right corner stayed square), unified via the shared header style.
- **Consistent scrollbar gap** — Budget, Open Points, Stakeholders, RACI, RAID, Change log, Activity,
  Manage Roles, Gantt and Calendar now keep a gap between their content and the scrollbar, matching
  the Dashboard.
- **Next-actions priority dots** now use the same Red/Amber/Green status colours as Open Points.
- **Change report** moved under the Reports nav group, beside the Budget and RAID reports.
- Next-actions action buttons show a pointer cursor on hover; the Re-baseline and Snooze dialogs
  close on an outside click (as well as Escape).

### Fixed
- **"Learning is on/off" deep-link** — clicking the Action Center learning pill now actually opens
  Settings → Next-actions (the request was being swallowed on the freshly-mounted Settings view).
- **Resource workload over-extension** — the Workload table no longer stretches a mostly-empty table
  far below a short resource list; it sizes to its content and scrolls only when it overflows.

## [0.99.1] - 2026-06-17 "Brackett"

### Security
- **Encrypted local credentials** — the Anthropic API key and Turso auth token are no longer
  stored in plaintext. They are encrypted at rest with WebCrypto AES-256-GCM using a non-extractable
  device-bound key (default), and can optionally be locked behind a per-secret passphrase
  (PBKDF2-SHA-256). Existing plaintext credentials are migrated automatically on first load; a
  passphrase-locked Anthropic key prompts to unlock in the chat panel, and a passphrase-locked Turso
  token prompts at startup before the workspace loads. No recovery — a forgotten passphrase means
  re-entering the value. (Same-origin code can still read a decrypted secret at runtime; this protects
  against storage theft, profile sync, backups, and shared machines — not XSS.)

### Fixed
- **Turso empty state after archiving the last project** — when the portfolio is in Turso mode and the
  last active project is archived, the empty-state screen now offers a way forward instead of trapping
  the user. It lists archived projects with a one-click **Restore** **and a type-to-confirm Delete
  (permanent)**, and the **Load from file** button is shown (in Turso mode it switches the portfolio to
  file mode and reloads, keeping the `portfolioMode === "turso" ⇔ storageConfig.kind === "turso"`
  invariant intact). Previously "Load from file" was hidden in Turso mode and no restore/delete path
  existed on this screen.
- **Sample-workspace data polish** — populated the previously-empty project `status` (overall RAG +
  PM narrative) so the dashboard status summary demos real content; linked tasks #3/#9/#10 to their
  matching resources (Aria/Sample were half-linked); corrected the Alex Example contact email to her real
  Acme address (marked synced); and aligned the David Okoro stakeholder organization to the
  project customer (Northwind Retail Group). Regenerated the `-big`/`-huge` datasets, the Turso SQLite
  exports, and the golden serializer fixtures.

### Changed
- **"Ask Claude" placement** — the Ask-Claude pill now sits in the top bar's left cluster, directly
  beside the project switcher, in both the modern and classic layouts (its dropdown now opens to the
  right so it never clips). Previously it sat in the right-hand control cluster.
- **Influence/Interest map is interactive** — clicking a stakeholder chip on the map now opens that
  stakeholder's editor (deep-link), instead of being inert text.
- **Scaled demo datasets read as genuinely larger** — `scaleWorkspace` now gives replicated
  stakeholders distinct names (and drops the now-stale shared-resource link) and qualifies replicated
  work-item titles by workstream, instead of appending a "(2)"/"(3)" numeric suffix to identical rows.

## [0.99.0] - 2026-06-17 "Brackett"

### Added
- **Dashboard variance summary** — an embedded, Turso-gated summary on the dashboard shows headline KPI
  deltas against the baseline (no snapshots required).
- **Resizable panes with right-aligned reset buttons** across Dashboard (fixing a broken reset), the
  Action Center, and Documents; the Milestones reset-size button moved to the right of its header, and an
  Influence/Interest reset-size button was added.
- **Documents as a centered pane** — the Documents tab now renders as a centered, padded Milestones-style
  pane; the Add-document button is gated behind an active M365 + SharePoint connection.
- **Reports nav grouping** — the Budget and RAID reports are now grouped under the single Reports nav item.
- **Ask Claude pill** — the "Ask Claude" control now leads the top-bar controls as a clearly labeled pill.

### Changed
- Removed the resize corner-hint glyph and added a scrollbar gap to pane scroll regions for cleaner chrome.
- Restyled the Trends snapshot links to match the Open Points link style.
- Strengthened the Next-actions CTA hover affordance; the Action Center learning flag now has an explanatory
  tooltip that deep-links to the Next-actions settings.

### Fixed
- Influence/Interest dark-mode contrast.
- Dashboard status summary: the Clear button now resets the textarea to its default height, and the
  textarea auto-shrinks as content is removed.

## [0.98.0] - 2026-06-17 "Pohl"

### Added
- **Foundational one-tap prompts** — the AI Assistant now offers a row of one-tap prompts
  (What's next? / Status overview / Prioritize) that send to Claude on click, no typing required.
- **"Ask Claude" top-bar menu** — a shared, context-aware menu in the header surfaces view-specific
  suggested prompts for whatever you are looking at; picking one opens the chat seeded with that prompt
  and auto-sends it.
- **Chat-seed channel** — a new `requestChat` entry on the workspace tab context lets any surface open
  the AI Assistant pre-filled with a prompt (and optionally auto-send it).

## [0.97.0] - 2026-06-16 "Gaiman"

### Added
- **Operating-guide library** — a global store (localStorage + optional Turso, kept outside `TABLE_NAMES`
  so saves never wipe it) holds named operating guides. Each guide has a priority, an enable toggle, and
  optional scope tags (mode / module / view) that narrow when it is injected. A built-in leadership guide
  is seeded as an editable default on first use.
- **App-context awareness** — the AI system prompt now receives the current app mode (simple / modular /
  advanced), the list of enabled modules, and the active view. Claude uses this context to act as a senior
  project & program manager and tailor advice to what is visible on screen.
- **"Ground Claude in operating guides" master toggle** — a new AI settings control lets users enable or
  disable guide injection globally. An in-app guide editor (scope + priority + body) and a token-budget
  warning are shown alongside the toggle.
- **Prompt caching of guide text** — the stable portion of the system prompt (guides + role context) is
  marked for prompt caching to reduce latency and token cost on repeated turns.

## [0.96.0] - 2026-06-16 "VanderMeer"

### Added
- **Outlook calendar write-back** — a "Push to Outlook" button on the Milestones view reconciles the
  current project's milestones into your Outlook calendar as all-day events (create / update / remove),
  tagged so a re-push stays idempotent. One-way (the app owns milestone dates); opt-in under
  Settings → Integrations → Microsoft 365. Requires M365 sign-in + Calendars.ReadWrite consent.
- **Scalable sample datasets** — the bundled sample workspace is now `sample-workspace-small.*`, with
  generated `-big` (3×) and `-huge` (10×) variants (JSON + SQLite) for testing larger projects. A pure
  `scaleWorkspace` helper replicates every entity with id-offset + full FK remap (no dangling refs).

### Changed
- **Settings IA** — General now hosts the Appearance and Storage sections (divider-split sub-sections)
  instead of separate rail entries; Communication Templates moved directly below Templates and is
  Expert-mode only.
- **Action Center polish** — each action row shows a per-source icon with a tooltip carrying its
  calculated score; tiers sort by score (highest first); an Expert-mode "Learning is ON/OFF" status
  pill in the header links to the Next-actions settings.
- **Influence/Interest matrix** — readable text contrast (labels on solid chips, decoupled from the
  quadrant tint); stakeholders with a pending communication show a "needs communication" marker that
  jumps to the Action Center.
- **Dashboard** — the Trends show/hide toggle moved to the top toolbar; the status-summary buttons sit
  below an auto-growing textarea; the budget-burn section now shows CPI.
- **New-project wizard** — an informational note recommends the Turso backend (richer features, more
  complete data model, more automation than file storage).

## [0.95.0] - 2026-06-16 "McCaffrey"

### Added
- **Action Center learning layer** — the Action Center now learns from how you respond to suggested
  actions (act / snooze / dismiss) and applies a bounded, safety-capped bias to ranking so it surfaces
  fewer, higher-value next-best-actions. Opt-in (Settings → Next actions); a per-row hint explains any
  adjustment; a learning-insights view shows per-kind stats with manual Auto/Surface/Suppress/Off
  overrides. Learning data lives in this browser or, optionally, in Turso (shared across devices).
  Urgent items are never hidden.

## [0.94.0] - 2026-06-16 "Mieville"

### Added
- **Desktop notifications for urgent actions** — opt-in browser notifications raised when a new
  urgent ("now") Action Center signal appears while the app tab is in the background. One popup per
  new signal (deduped); a burst coalesces into a single "N new urgent actions" summary. Enable it in
  Settings -> Notifications (requests browser permission). Browser-only; the tab must be open.

## [0.93.0] - 2026-06-16 "Cadigan"

### Added
- **Re-baseline CTA (Action Center):** drifting rows now carry a one-click "Re-baseline" action. Slipping/overdue milestone rows open a confirm popover with the new target date prefilled to the linked-task forecast (editable) and move `milestone.date` on confirm — works on every backend. Schedule-slipping and budget-worsening rows capture the project's current state as a new Turso snapshot baseline (Turso-gated; the previous baseline is kept in history). Surface-only; the next-actions engine is unchanged. Execution-depth roadmap slice 5.

## [0.92.0] - 2026-06-16 "Asaro"

### Added
- **Escalate action** — at-risk RAID items in the Action Center now have an "Escalate" button. It raises the item's severity one level (Issue/Assumption/Dependency; Risks and already-Critical items are notify-only since Risk severity is matrix-derived) and opens a prefilled escalation email to a chosen recipient, in one confirm step.

## [0.91.0] - 2026-06-15 "Stross"

### Added / Changed
- **Communication templates HTML send (SP4)**: send templates as real HTML email
  via Microsoft 365 Graph — an Outlook-draft mode (creates a reviewable HTML draft)
  or an in-app preview-then-send mode, switchable in settings. The plain-text email
  app (mailto) remains the default and the fallback when M365 is unavailable. This
  completes the editable communication-templates roadmap.

## [0.90.0] - 2026-06-15 "Abercrombie"

### Added / Changed
- **Communication templates versions (SP3)**: save named versions of a template,
  compare any two as a rendered plain-text diff, and restore an earlier one — the
  current draft is auto-snapshotted before a restore so nothing is lost. Versions
  live in an append-only Turso table (out of the workspace save cycle). This
  completes the editable-templates roadmap ahead of the optional Graph HTML-send slice.

## [0.89.0] - 2026-06-15 "Rothfuss"

### Added / Changed
- **Communication templates rich-text editor (SP2)**: the Turso-only template
  Settings pane now edits bodies in a lazy-loaded Tiptap editor — bold, italic,
  underline, headings, bullet/numbered lists, and links — with the merge-field
  chips inline. Authored HTML is sanitized with DOMPurify on save. The body is
  still stored as HTML and flattened to plain text on send (rich HTML send
  arrives with the Graph slice). SP3 (named versions + compare/restore) is next.

## [0.88.0] - 2026-06-15 "Card"

### Added / Changed
- **Communication templates (SP1)**: author named, categorized email templates
  (status inquiry, stakeholder update) with `{{merge-field}}` placeholders in a new
  Turso-only Settings pane. Each category has a default template that the "draft
  email" send flows (status-chase + stakeholder message) use automatically, rendered
  to plain text for the `mailto:` body. Off-Turso, the existing i18n body templates
  remain the fallback. Templates are stored globally (shared across projects) in a
  dedicated `comm_templates` table, kept out of the workspace save/load cycle.
- Foundation for later slices: SP2 will add a rich-text (Outlook-like) editor, and
  SP3 named template versions with compare/restore.

## [0.87.0] - 2026-06-15 "Zahn"

### Added / Changed
- **Draft message from Action Center**: task-due and stakeholder-comms inbox rows
  now show an inline "Draft message" CTA that opens a prefilled `mailto:` in your
  mail client. Task-due reuses the existing status-inquiry flow; stakeholder-comms
  composes a new mailto addressed to the stakeholder (surface-only change; engine
  untouched).
- **Third execution-depth slice**: following assign-owner (0.86.0) and create-task
  (0.85.0), this slice continues resolving Action Center signals directly in the
  inbox, reducing modal navigation for common triage actions.

## [0.86.0] - 2026-06-15 "Verne"

### Added / Changed
- **Assign owner from Action Center**: RAID risks without an owner now show an
  inline "Assign owner" CTA in the Action Center inbox row. Clicking it opens a
  `ResourcePicker` popover that writes the owner field immediately — no editor
  round-trip required (surface-only change; engine untouched).
- **Second execution-depth slice**: following the create-task CTA (0.85.0), this
  slice continues the pattern of resolving Action Center signals directly in the
  inbox, reducing modal navigation for common triage actions.

## [0.85.0] - 2026-06-14 "Dick"

### Added / Changed
- **Tooltip clamp**: long tooltips across planning, RAID, and settings surfaces are
  now clamped to a max-width so they never overflow the viewport.
- **Manage Roles / Projects / Milestones resize controls**: each table panel gains
  explicit column-resize handles, consistent with the rest of the application.
- **Stakeholder matrix contrast**: row/column header cells meet WCAG AA contrast
  requirements; chip colours updated to pass the a11y gate.
- **Report drag-reorder**: reports in the composable-reports panel can be
  reordered by dragging, replacing the old up/down button approach.
- **Snapshot delete** (single + bulk): individual snapshots can be deleted from
  the Trends detail view; the bulk-delete action clears all snapshots for a
  project in one step.
- **Next-actions formula explainer**: the ranking-weight sliders in
  Settings → Next actions now include an inline formula preview so the combined
  score is transparent.
- **Dedicated Storage settings section**: Turso/IndexedDB/file storage options
  have been extracted from Integrations into their own Settings rail entry.
- **Dashboard layout**: the Changes and Top-actions columns are now independently
  resizable; column order has been rationalised.
- **Dashboard Trends toggle**: a new toggle on the Dashboard lets users
  show/hide the Trends mini-chart without leaving the view.
- **Calendar row height**: the calendar view respects a compact/comfortable
  density setting, matching the task-table density control.
- **Budget date/stepper alignment**: date pickers and numeric steppers in the
  budget editor are now vertically aligned with their labels.
- **Budget CPI/Consumption percent display**: CPI and budget-consumption values
  are shown as percentages with one decimal place throughout the budget report.
- **Budget-report tooltips (hidden in print)**: metric-explanation tooltips on
  the budget report are suppressed in print/PDF output to avoid clutter.
- **RAID-report aging layout**: the aging column in the RAID report has been
  tightened and aligns consistently with the status and priority columns.
- **A11y fixes**: several interactive elements across the wizard, settings panel,
  and report tables received missing `aria-label` / `role` corrections surfaced
  by the Playwright axe gate.

## [0.84.0] - 2026-06-14 "Wyndham"

### Added / Changed
- Action Center gains a **"Create task" CTA** on every signal card (except
  task-due, which already links to an existing task). Clicking it opens the
  task editor pre-seeded with a title derived from the signal and a "From"
  note explaining why the action fired — no blank-form hunting required.
- RAID-originated signals (no owner, overdue review) automatically populate
  **linkedTaskIds** on the new task, so the RAID item shows the follow-up
  task as linked once the editor is saved.
- The flow is **propose-then-confirm**: the editor opens pre-filled but fully
  editable; the task is only created when the user saves, preserving the
  normal task-creation guardrails and validation.

## [0.83.0] - 2026-06-14 "Aldiss"

### Added / Changed
- The Action Center now ranks suggested actions by **confidence** — how
  actionable a signal is — using a hybrid score. A clarity bonus and a
  static-signal penalty mean a clear, actionable item can now outrank a vague,
  static red, instead of ordering purely by raw severity.
- Snapshot-trend awareness for the **budget** and **schedule** signals: a metric
  that is actively worsening (compared to the previous snapshot) is ranked higher
  than one that is merely bad but stable.
- Root-cause **why-text** (magnitude + trend) is now attached to the budget,
  schedule, and RAID-no-owner actions, so each suggestion explains *why* it
  fired rather than just *that* it fired.
- New configurable **ranking weights** under **Settings → Next actions**, letting
  you tune how clarity, trend, and severity combine into the final ranking.
- The inbox now has a collapsible **"monitor"** group, separating
  keep-an-eye-on items from the ones that need action now.

## [0.82.0] - 2026-06-14 "Kurtz"

### Added / Changed
- The empty-state (no project yet) "Load from file" now accepts any supported
  file format — JSON, CSV, or Markdown — in a single picker and detects the
  format from the chosen file's extension, instead of only loading JSON. This
  also applies to the "Load from file" actions in the project switcher and the
  Projects panel.
- Moved the **History** navigation entry from the Overview group to the System
  group, directly below **Activity**.
- The Manage Roles pane is now manually resizable (drag the bottom-right corner)
  while still scaling to its content by default, with a reset-size button that
  returns it to the content-fit default.
- The Archive action in the Projects panel now has a tooltip explaining that an
  archived project can be permanently deleted from the archived list.
- The Settings rail is now sorted alphabetically, with **Information flows**
  pinned to the bottom under a divider.
- Manage Roles now has a reset-column-widths button, matching the other tables.
- Added an **Expert mode** toggle to Settings. The advanced sections (Mode,
  Templates, Notifications, Next actions, Export) and the toolbar's
  save-as-template / apply-template actions are hidden unless expert mode is on.
  The connectivity sections (AI assistant, Jira, Integrations) are now grouped
  together above Information flows, each under its own divider.
- New **Settings → Next actions** section to override the signal-firing
  thresholds of the suggested-next-actions engine: pending-changes count, the
  schedule SPI warn / critical levels, the workload over-allocation % (and its
  critical level), and the overload overdue-task count (and its urgent level).
  Each field shows its default and there is a reset-to-defaults button; invalid
  values fall back per-field. Day-based lead times stay under Notifications.
- Explanatory InfoTooltips on non-obvious table-column headers across the app
  (RAID Severity; Change Impact; Stakeholder Influence / Interest; Trends
  Baseline / Delta; Resources report Capacity / Internal / External / Margin /
  Avg util.; the Inquiries count; RAID report Age) — matching the Manage Roles
  rate-card headers. `SortHeaderButton` gained an optional `hint` prop.

### Fixed
- Settings changes now propagate across the whole page without a reload. The app
  has several independent `useSettings()` instances (the canonical shell, the
  standalone workspace/pop-out section, and read-only consumers); previously a
  change made through one — e.g. accepting the AI-usage policy, or toggling a
  setting in the Settings menu — did not reach the others until a reload. Each
  instance now broadcasts changes to the others. This also fixes the chat
  consent screen ("I understand") not opening the assistant.
- Snapshot auto-capture no longer throws `StorageNotReadyError` on mount when
  the storage kind is "turso" but the URL/token are unset or quarantined: the
  trends-active gate now requires a non-null Turso config, and `useSnapshots`
  defensively skips the load when no config is present.
- Version-history auto-capture no longer writes an empty version when a save
  only bumped bookkeeping timestamps (`localModifiedAt`): the auto trigger now
  checks the meaningful diff (which ignores volatile fields) instead of raw
  byte equality, so an interval with no real change produces no version.

## [0.81.0] - 2026-06-14 "Wolfe"

### Added / Changed
- Trends tables now have resizable columns and match the rounded table style.
- Suggested-action chips show a tooltip explaining why each is flagged and open
  the relevant item (task / RAID / change / milestone / stakeholder) when clicked.
- The RACI picker is now compact: it shows the selected role and expands to all
  roles (plus clear) on click, collapsing on outside-click.
- New **Documents** tab: every linked file across tasks, RAID, changes,
  milestones, stakeholders, and the project in one place — open a link, jump to
  its source, remove it, or attach a new one to any item.

### Fixed
- Manage Roles header tooltips read in normal case and are no longer clipped by
  the table border; the Manage Roles pane fits its content without exceeding the
  viewport.
- The Manage Roles rate fields now show the project's currency symbol (from the
  budget plan's currency) instead of a hard-coded €.

## [0.80.2] - 2026-06-14

### Fixed
- Accessibility: error / validation / RAG-red text used the bright brand pink
  (~3.76:1 on white, below WCAG AA). Added a darker `pink-strong` shade (mirroring
  the existing `green-strong`) and applied it to those text uses; the bright pink
  is unchanged for fills, borders, and text on dark surfaces.
- Toast notifications now use a colour-tinted background (pink for errors, blue
  otherwise) with accent text — matching the in-app error boxes — instead of the
  plain bordered surface, while staying AA-readable in both light and dark themes.

## [0.80.1] - 2026-06-14

### Fixed
- Accessibility: toast notifications now use a coloured left-accent border on a
  readable surface background instead of white-on-colour fills — the error
  toast's white-on-pink combination failed WCAG AA contrast.

## [0.80.0] - 2026-06-14 "Kress"

### Added
- **Two new suggested-action signals.** A **schedule** warning surfaces when the
  project trends behind plan (EVM schedule performance index below 1.0), and
  **workload** alerts flag people who are over-allocated (>100% planned) or
  carrying several overdue items. Both appear in the Action Center and as inline
  chips, clickable straight to the dashboard / workload view.

## [0.79.2] - 2026-06-14

### Fixed
- Accessibility (WCAG AA contrast): info-bearing green text on light backgrounds
  now uses the darker `green-strong` shade; the RACI chips are readable in both
  selected and unselected states; and the Milestones table got the standard dark
  header (it was the only table still using a light one, which made its green
  sort label fail contrast). The automated accessibility gate now also covers the
  Stakeholders, Changes, Milestones, Reports, and Activity views.

## [0.79.1] - 2026-06-14

### Fixed
- Components added since the 0.16.0 palette sweep had reintroduced legacy grey
  chrome utilities; re-swept them to semantic surface tokens. No change in light
  mode; dark mode now renders these surfaces correctly, and a stray off-palette
  border was removed. A new guard test prevents the chrome greys from drifting
  back.

## [0.79.0] - 2026-06-14 "McDevitt"

### Added
- **Inline action chips:** the most urgent next action(s) for a view now appear
  as compact chips at the top of that view (RAID, Open Points, Budget, …) and on
  each Reports section. Click a chip to jump straight to the item; `+N more` opens
  the Action Center. Completes the "suggested next actions" feature.

## [0.78.0] - 2026-06-13 "Bova"

### Changed
- The due-dates, RAID-review, and stakeholder-comms **reminder banners and
  modals are gone** — those nudges now live in the **Action Center** as ranked
  actions. The header bell opens the Action Center. Snooze any action for 1 hour
  or 1 day; it returns when the timer lapses. (Birthday, Jira-token, storage, and
  safe-mode banners are unchanged.)

## [0.77.0] - 2026-06-13 "Effinger"

### Added
- **Action Center.** A new "Next actions" view turns the project's signals
  (overdue tasks, open Critical/High RAID + reviews due, pending changes,
  overdue/at-risk milestones, budget overruns, stakeholder-comms due) into a
  ranked queue grouped Now / Soon / Monitor — click a row to jump straight to
  the item. Plus a "Top actions" card on the Dashboard and a nav badge counting
  the urgent ("now") items. (Consumes the next-actions engine.)

## [0.76.0] - 2026-06-13 "Delany"

### Added
- Color-coded RACI chip picker (replaces the dropdown) with an aligned legend.
- Field tooltips across the Manage Roles, Edit Resource, New Absence, Budget,
  Edit RAID, Edit Change, and Edit Stakeholder editors.
- RAID-style clickable rows on Stakeholders, Directory, Workload, and Planning —
  click a row to open its editor (inline inputs unaffected).
- Currency (€) symbol next to the Manage Roles rate fields.

### Changed
- Resource Calendar now uses the full resizable pane (was a smaller centered
  pane), matching Workload's size.
- Planning's absence-override input matches the utilization input's size.
- Removed the New-task button from the modern top bar.

### Fixed
- Edit Change / Edit Stakeholder / Edit Task modals now show correct headings
  ("Edit change" / "Edit stakeholder" / "Edit task") instead of the view names.

## [0.75.0] - 2026-06-13 "Nagata"

### Added
- **Emergency recovery / safe mode.** Boot the app into a clean configuration
  without losing data:
  - `?safe=1` (also `?safe` / `#safe`) boots on the browser/file backend at the
    empty state, ignoring stored config in memory — nothing is read or written.
  - A standalone `/recovery` page (isolated from the main app tree) to download
    the current config, reset to a clean slate, or restore the last config.
  - Reset is **non-destructive**: the three config keys (`settings`,
    `portfolio-mode`, `turso-current-project`) are moved to timestamped backup
    keys, never deleted. Project data, the registry, IndexedDB, and any Turso
    cloud database are untouched.
  - A top-level error boundary replaces white-screen crashes with a recovery
    fallback.

### Fixed
- Turso portfolio: "Move to Turso" and the Integrations portfolio switch now
  persist `storageConfig.kind="turso"`, so the workspace backend follows the
  portfolio instead of staying on the local file (which broke snapshot capture).

## [0.74.0] - 2026-06-13 "Lem"

Create-project wizard & empty-state overhaul — a wider, resizable modal, a
focused required-field form with the rest tucked behind an optional section, a
mandatory Contacts field, a unified storage selector with Turso configuration at
creation time, and a first-run backend-setup surface.

### Added
- **Storage selector with Turso.** The create form's "File format" selector is
  now "Storage" and offers Turso alongside JSON/CSV/Markdown. Picking Turso opens
  a backend-config modal (Turso database URL/token, M365 sign-in, portfolio
  storage mode) so you can set it up without leaving the wizard; the new project
  is then created on the Turso backend.
- **First-run backend setup.** On a fresh install (no projects yet) the
  empty-state offers "Configure the Turso backend" and "Configure M365
  integration" buttons — the only way to reach those settings before a project
  exists. The dead, non-functional ✕ on that non-dismissable modal is gone.
- **"Link to Jira"** project field (joins Salesforce / SharePoint / Confluence),
  persisted across JSON/CSV/Turso.
- Field tooltips across the project form, including a Contacts tooltip explaining
  the "Add manually" picker, the email field, and the Add button.
- A stepped identity-count datalist (50 … 1,000,000,000) suggesting common scales.

### Changed
- **Mandatory Contacts, optional stakeholders.** At least one contact person
  (linked from your resources / address book, or typed in) is now required;
  internal and external key stakeholders became optional and moved into the
  optional section. Existing projects saved without contacts still load.
- **End date is optional** (it was required, and was the cause of the Next button
  staying disabled on an otherwise-complete form).
- The new-project modal is wider (960px) and **resizable** (drag the corner; a
  reset-size button restores the default). Non-mandatory fields are collapsed by
  default under an **"Optional details"** disclosure. Regulatory requirements
  render in two columns.

### Notes
- The sample workspace (`sample-workspace.json` / `.sqlite3`) was regenerated to
  include the project's Jira link and a second contact.

## [0.73.0] - 2026-06-12 "Bester"

Template suggestion — the creation wizard recommends and preselects the best-fit
template from the project's parameters.

### Added
- Deterministic template suggestion at project creation: the wizard's Template
  step scores the project's parameters (team size, regulated flag, deployment,
  duration, identity scale) and preselects + badges the recommended template,
  with a reason line explaining why it fits. You can still pick any other
  template or start from Blank.

### Notes
- Completes the 4-part templates feature: field visibility (0.70.0), project
  templates (0.71.0), per-project functions + creation wizard (0.72.0), and
  template suggestion (0.73.0).

## [0.72.0] - 2026-06-12 "Zelazny"

Per-project functions — each project keeps its own enabled modules (reactive, no
reload) plus a 3-step creation wizard.

### Added
- Enabled functions (modules) are now stored on each project rather than globally.
  Switching projects applies that project's functions reactively — the navigation
  and automation update without a page reload.
- A 3-step project-creation wizard (Details → Template → Functions) that applies
  a template's field visibility, optionally appends its starter content, and sets
  the chosen functions, all at creation time.

### Changed
- The Settings → Mode section now configures the current project's functions
  (it no longer toggles a global setting or triggers a reload).
- Resolves the "coming soon" note from 0.71.0: a template's feature mode is now
  applied when you create a project from it (via the wizard).

### Fixed
- Per-project field visibility (introduced in 0.70.0) and the new per-project
  functions are now persisted in multi-project Turso mode and in the default
  IndexedDB backend; previously these were dropped on reload in those modes.

## [0.71.0] - 2026-06-12 "Bear"

Project templates — reusable project setups (mode + field visibility + optional starter content).

### Added
- A cross-project library of reusable project templates: three built-in starters
  (minimal, standard, and full delivery skeletons) plus a "Save current project
  as a template" action that snapshots the current setup.
- A Templates section in Settings to manage your saved templates — list, rename,
  duplicate, and delete (built-in templates are read-only).
- An "Apply template" entry in the actions menu sets the project's field
  visibility and optionally appends the template's starter content with re-id'd
  entities. Applying is non-destructive — your existing items are kept.
- User templates are persisted in settings (localStorage).

### Changed
- Applying a template never overwrites existing data; starter content is appended
  with fresh ids and internal references rewired.
- Upcoming: applying the feature mode at project creation and template
  suggestions are planned for a future release.

## [0.70.0] - 2026-06-12 "Anthony"

Per-modal field visibility — Simple / Advanced / Full views with a configurable cog.

### Added
- Every entity editor (task, RAID, change, milestone, stakeholder, resource,
  absence, and budget) now has a Simple / Advanced / Full field-visibility
  switch, plus a cog to show or hide individual fields. The default view is
  Advanced.
- The chosen view and per-field overrides are persisted per project across all
  storage backends (File, CSV, Markdown, and Turso).

### Changed
- Required fields are always shown regardless of the selected view, and hiding a
  field only changes what you see — it never deletes the underlying data.

## [0.69.0] - 2026-06-11 "Simmons"

Version history — retention, module toggle & polish (Turso only; final slice).

### Added
- A configurable retention setting (Settings → "Version history: keep N
  versions"; minimum 50, in steps of 10, up to 1000) controls how many automatic
  versions are kept per project; named checkpoints are always kept.
- Version history is now a toggleable feature-module — turn the History view on
  or off like the other modules. While off, no versions are captured (it still
  requires the Turso backend either way).

### Changed
- Restoring now records an immediate version checkpoint of the restored state
  (no waiting for the next autosave).
- Naming a manual checkpoint uses an inline themed input instead of a browser
  prompt.

## [0.68.0] - 2026-06-11 "Brin"

Version history — selective restore (Turso only; third slice).

### Added
- From a "Compared with current" view you can now restore selectively: tick whole
  records or individual fields and click "Restore selected". Restoring reverts a
  changed field to the version's value, brings back a record deleted since the
  version, or removes a record added since — only for what you tick. Restore is
  non-destructive: it applies to your current data (saved as a new version) and
  is recorded in the activity log.

## [0.67.0] - 2026-06-11 "Niven"

Version history — compare (Turso only; second slice).

### Added
- The History view can now compare versions: click "Compared with current" on a
  version to see what changed versus the current data, or tick two versions and
  "Compare selected" to compare them with each other (ordered oldest→newest).
  Changes are grouped by type (tasks, RAID, milestones, resources, budget, …) and
  each record expands to show field-level before→after.
- The timeline now captions each version with a short summary of what changed
  (e.g. "3 Tasks, 1 RAID").

## [0.66.0] - 2026-06-11 "Egan"

Data version history — capture & timeline (Turso only; first slice).

### Added
- On the Turso backend, the app now keeps a per-project version history. Edits
  are captured automatically a few minutes after they settle (rapid changes
  coalesce into one version), and you can save a named checkpoint at any time
  via "Save version now". A new **History** view (shown only on Turso) lists the
  timeline. Comparing versions and restoring are coming in the next releases.
- Automatic versions are pruned to the most recent 50 per project; named
  checkpoints are kept. (A configurable retention setting arrives in a later
  slice.)

### Notes
- Backward compatible: version history is a separate append-only table; existing
  workspaces, exports, and the relational data are unaffected — no schema change
  to existing tables and no migration. The feature is hidden and inert on the
  file/IndexedDB backends.

## [0.65.0] - 2026-06-11 "Eddings"

Resource-linked project contacts — the final slice of the person-identity
normalization (SP4).

### Added
- A project's contact persons can now link to a Resource. The add control is a
  resource-aware picker (registry people suggested first, the address book as a
  fallback): picking a registry person links the contact via a new
  `resourceId`, while a free-typed name (with an optional email) stays an
  external contact. Linked contacts show a small indicator in the list. This
  completes the resource-normalization of every person surface — tasks, RAID
  owners, shifts, stakeholders, and now project contacts.

### Notes
- Backward compatible: unlinked contacts serialize exactly as before (the
  resource link is stored only when set), so existing workspaces, exports, and
  Turso databases are unaffected — no schema change and no migration.

## [0.64.0] - 2026-06-11 "Hamilton"

Per-resource RAID ownership rollup (identity normalization SP3).

### Added
- The workload/people view now shows an "Open RAID" count per resource — how many non-terminal RAID items each person owns, resolved by the owner link set in 0.63.0 (falling back to the owner name into the unlinked bucket). The first view to consume the resource-ownership links.

## [0.63.0] - 2026-06-11 "Feist"

Resource-aware people pickers across RAID, shifts, and stakeholders (identity normalization SP2).

### Added
- The RAID owner and shift assignee fields are now resource-aware autocompletes (registry-first, contacts fallback, "+ Add as resource"), linking to a Resource via `ownerResourceId` / `resourceId`.
- The stakeholder name field is a resource-aware typeahead that links to a Resource or leaves the stakeholder external — replacing the separate link-to-resource dropdown. External stakeholders (no link) remain a first-class state.

### Changed
- `ResourcePicker` gains an optional `onCreateResource`; omitting it yields the link-only variant used by stakeholders.
- Removed the now-dead shift assignee datalist (`shiftKnownAssignees`) — superseded by the picker.

## [0.62.0] - 2026-06-11 "Williams"

Resource-aware people picker (identity normalization SP1).

### Added
- The task assignee is now a resource-aware autocomplete: registry people are suggested first (picking one links the task to that Resource via `resourceId`), remembered contacts remain as a fallback, and "+ Add as resource" creates and links a new resource inline. A linked assignee shows the resource's current name/email — edit the person once on the resource and it updates everywhere — and a broken link can be cleared. The Resources → Workload view already resolves people by this link.

### Changed
- `ContactInput` is replaced by the new shared `ResourcePicker` component.

## [0.61.0] - 2026-06-11 "Kay"

Resource-identity normalization for RAID owners and shift assignees.

### Added
- `RaidItem.ownerResourceId` and `Shift.resourceId` — stable foreign keys linking a RAID item's owner and a shift's assignee to the Resource registry, mirroring the existing `Task.resourceId` / `Absence.resourceId`. Both are optional and additive; the denormalized name/email strings are kept as a display cache.
- A schema migration (workspace v11) that back-fills these two new keys and the previously-unused `Absence.resourceId` by matching each record's email against `Resource.email` (case-folded, email-only — no name guessing). Idempotent: already-set links are never overwritten.

### Changed
- Schema versions bumped: workspace 10 → 11, Turso single-tenant 10 → 11, Turso multi-project 11 → 12.

### Known limitation
- **Existing Turso databases need their `raid` and `shifts` tables recreated.** The new columns are not auto-added to an already-deployed Turso schema (the relational tables use `CREATE TABLE IF NOT EXISTS`), so the first save after upgrading would reference a missing column and fail. To migrate a live single-tenant or multi-project Turso database, clear and re-save the workspace (or re-import it) so the tables are recreated with the new columns. The default browser (IndexedDB) and file-based backends migrate automatically with no action needed.

## [0.60.5] - 2026-06-11 "Stephenson"

Security documentation (refactor Batch E — final batch of the v0.60.x refactor plan).

### Changed
- The AI consent screen now states explicitly that the API key is stored unencrypted in the browser's localStorage and sent directly to api.anthropic.com, and recommends a dedicated spend-limited key.
- All three credential fields (Anthropic API key, Jira API token, Turso auth token) show a storage note: unencrypted localStorage — don't use production credentials on shared machines.
- README gained a "Security Model" section documenting the local-first BYO-key architecture: what is stored where, what leaves the browser, and credential recommendations.
- Verified (audit item S2): credentials never appear in workspace exports, the activity log, or console output.

## [0.60.4] - 2026-06-11 "Stephenson"

Performance + reliability (refactor Batch D).

### Performance
- Turso autosaves are now proportional to what changed: only tables whose data actually changed are rewritten (a status-only edit drops from ~535 statements / ~590 KB to ~20 statements / ~4 KB on a 500-task workspace), and a save with zero changes skips the network round-trip entirely.
- The three hottest React context providers (workspace, task form, filters) memoize their value objects — unrelated panels no longer re-render on every keystroke.
- Gantt dependency arrows use a precomputed row-index map instead of per-edge linear scans (O(n²) → O(n) per frame).
- Browser (IndexedDB) saves and loads run their independent store operations in parallel (~17 sequential awaits → one `Promise.all`), with all-or-nothing baseline semantics pinned by tests.

### Reliability
- A failed project-registry write (localStorage quota/disabled) now shows a toast instead of silently risking the project list.
- A pending debounced save is flushed immediately when the tab is hidden or closed (`visibilitychange`/`pagehide`) — edits made in the last 500 ms before closing are no longer lost.
- Multi-tab Turso writes are serialized via the Web Locks API (per DB + project, 20 s bounded wait). Simultaneous editing in two tabs remains last-write-wins per table and is documented as unsupported in the README.
- Turso project operations (create, update, archive, restore, delete, repoint) now surface failures as toasts instead of failing silently; the logic moved from `task-manager.tsx` into a tested `use-turso-projects.ts` hook, and the feature-mode redirect logic is now a tested exported function in `feature-modules.ts`.

## [0.60.3] - 2026-06-11 "Stephenson"

Structural refactor (Batch C — zero behavior change; on-disk format byte-stability proven by the golden fixtures at every step).

### Changed
- `storage.ts` split from a 3,466-line god module into a 126-line facade over seven focused modules: `workspace.ts` (Workspace type, migrations, JSON codec), `idb.ts`, `fs-access.ts`, `csv-codecs.ts`, `markdown-codecs.ts`, `browser-backend.ts`, `local-file-backend.ts`. All existing imports keep working via re-exports.
- The two Turso backends merged into one `TursoBackend(config, projectId?)` — single-tenant and multi-project modes share one class; `turso-tenant-backend.ts` removed.
- `RaidEditModal` extracted from `raid-panel.tsx` (1,493 → 703 lines) into `raid-edit-modal.tsx`, matching the other entity modals; shared labels moved to `raid-labels.ts`.
- Pure Gantt logic (preferences, date helpers, bar derivation, critical-path algorithm) extracted from `gantt.tsx` (1,967 → 1,493 lines) into React-free `gantt-engine.ts`.
- `settings-menu.tsx` no longer re-exports settings types; 29 files import `settings-types.ts` directly.

### Fixed
- Four module-import cycles dissolved (`storage ↔ settings-types`, `storage ↔ sharepoint/turso backends`, `settings-menu ↔ jira-settings`, `settings-menu → jira-settings → jira-api`); the storage layer is now a strict DAG (workspace/idb leaves → codecs → backends → facade).

## [0.60.2] - 2026-06-10 "Stephenson"

Cleanup release (refactor Batch B — zero behavior change, net −491 lines).

### Added
- Golden-file fixtures (`src/app/__fixtures__/golden-workspace.{csv,md}`) plus a guard test pinning the byte-exact storage serializer output (no-config CSV/Markdown path). Any refactor that changes a single emitted byte of the on-disk format now fails loudly. Fixtures are `-text` in `.gitattributes` so git never converts their line endings (CSV is CRLF per RFC 4180; Markdown is LF).

### Removed
- `version.ts`'s 770-line changelog comment (this file is the authoritative history; coverage was verified before deletion).
- Dead code: unused `HealthPill` component, unused `siteByPathUrl` Graph URL builder (+ its tests), 23 unused i18n keys (EN + DE), unused `TopTab` type, and the single-use `AppShell` wrapper (ternary inlined at its one call site).
- Three inline `nextId()` duplicates replaced by the shared helper from `resource-foundation.ts` (verified semantically identical).

## [0.60.1] - 2026-06-10 "Stephenson"

Reliability + security hardening (refactor Batch A — no new features).

### Fixed
- Turso pipeline requests now time out (15 s default, 10 s for loads) instead of hanging forever on an unresponsive endpoint; a timeout surfaces through the existing storage-unreachable banner, so unsaved changes are no longer silently at risk behind a hung autosave.
- A transactional Turso batch that fails mid-pipeline now sends a best-effort `ROLLBACK`, so a concurrent reader can no longer observe a half-written workspace while the server-side transaction lingers.
- Jira proxy (10 s) and ECB exchange-rate (8 s) upstream fetches time out instead of holding the server route for the platform limit; timeouts surface as the existing network-error handling.

### Security
- SharePoint Graph IDs are percent-encoded in all URL builders, and `@odata.nextLink` pagination links are origin-checked (shared `isSafeGraphLink` predicate) — a spoofed Graph response can no longer pivot authenticated requests off the Graph origin.
- `/api/ecb` joins the shared per-IP rate limiter (60/min, now scope-keyed per route with stale-bucket eviction).
- `Strict-Transport-Security` header added (1 year, includeSubDomains); `Permissions-Policy` now restricts the microphone to same-origin (`microphone=(self)`) — the voice feature is unaffected.

## [0.60.0] - 2026-06-10 "Stephenson"

### Added
- SharePoint browse/picker (custom Microsoft Graph browser): search sites, navigate libraries/folders, select a file or folder.
- Document links on all six workspace entities (Task, RAID, Change, Stakeholder, Milestone, Project): link SharePoint files/folders, open in a new tab, persisted losslessly across JSON/CSV/Markdown/Turso.
- "Browse…" button in the SharePoint storage-backend config (replaces blind URL paste).
- Graceful picker fallback for tenants without a `Sites.Read.All` grant: when site search is forbidden (403), paste a site URL to browse its default document library using only `Files.ReadWrite.All` (no admin consent required).
- Per-link activity logging (`doc.linkAdded` / `doc.linkRemoved`) via an `ActivityLog` context, so adding/removing a document link in any editor is recorded in the Activity log.

### Changed
- SharePoint storage backend scope consolidated to `Files.ReadWrite.All` (picker adds `Sites.Read.All` for site search, with a `Files.ReadWrite.All`-only fallback). Schema versions bumped (workspace 10, Turso single-tenant 10, Turso multi-tenant 11).

## [0.59.0] — 2026-06-10 "Gibson"

### Added
- **Turso multi-tenancy (multi-project Phase 2):** a single shared Turso database now holds every project. Every entity table gains a `project_id` column, and a new `projects` table is the authoritative registry (the database — not `localStorage` — is the source of truth for the Turso project list).
- **Global portfolio-mode switch** (Settings → Integrations) selects between a **file-based** portfolio (Phase 1) and a **Turso-backed** portfolio. Exactly one mode is active at a time; changing it reloads the app.
- **Archive / restore** projects (soft-delete by default) and **permanent hard-delete** behind a type-the-exact-name confirm dialog.
- Snapshot capture is **scoped per project**, so baseline/variance trend history never bleeds across projects.

### Changed
- Saves are **last-write-wins per project**, so concurrent tabs stay safe.
- The sample SQLite database (`sample-workspace.sqlite3`) is regenerated as a **multi-tenant** database (schema v10).

### Notes
- File-based projects (Phase 1) are unchanged and continue to work as before.
- New modules: `portfolio-mode.ts`, `turso-tenant-schema.ts`, `turso-tenant-backend.ts`, `turso-portfolio.ts`, and a reusable `type-to-confirm-dialog.tsx`. The single-tenant `TursoBackend` is left intact.
- **Accepted limitation (per the no-migration decision):** a pre-existing single-tenant Turso database that already had snapshot tables (Turso-only since v0.49) will not auto-gain `project_id`; its Trends view degrades gracefully (banner, no data loss) until those tables are recreated.

## [0.58.0] — 2026-06-10 "Vinge"

### Added
- **Multi-project / portfolio management (Phase 1, file-based):** each project is a self-contained workspace stored as a separate file.
- A **project metadata header** (name, code, description, lead, start/end dates, client, NACE sector, deployment model, identity types, regulatory requirements, internal/external key stakeholders) sits at the top of every workspace.
- A **portfolio registry** lets users create, switch, rename, and archive projects from a dedicated Projects management view, with a create/edit form and empty-state onboarding.
- A **top-bar project switcher** shows and changes the current project.

### Changed
- Every existing export surface (CSV, Markdown, JSON, DOCX, XLSX, PDF, PPTX) scopes to the active project.

### Notes
- File-based projects only in this phase; Turso multi-project support follows in 0.59.0.
- The storage round-trip stays byte-identical for a workspace without a project header (project emission is gated and appended last).

## [0.57.0] — 2026-06-09 "Cook"

### Added
- **Configurable document export:** choose which sections to include in XLSX / DOCX / PDF / PPTX / Markdown exports (default Tasks + RAID). The PDF export renders all enabled sections.
- **AI Assistant** (renamed from "Claude chat") gains suggested prompts (including "Give me an update"), a **token-usage panel** (session and weekly bars with an 80% alert), a **Stop** button, and a top-bar button that opens it as a **pop-out** (read-only mirror).
- A new **"Information flows"** diagram in Settings.

### Changed
- **Reminders** gain toast-first defaults, global-or-individual lead times, and a separate Jira-token-error banner toggle.
- **Views:** the Trends view matches the Dashboard layout (print-safe, resizable); the Gantt gains a Print button; the Calendar and Milestones views are sized like the assistant; the activity-log print hides controls.
- The **activity log** now records change, stakeholder, resource, and role changes plus a coarse settings event, and adds a "general" activity group.

## [0.56.0] — 2026-06-09 "Beagle"

### Added
- **Input sanitization feedback** so silent input transformations are now visible:
  - **Character counters** appear on capped text fields as they approach the limit (hidden below ~80%, turning warning-colored at the cap) across the task, RAID, change, budget, stakeholder, and resource editors.
  - **On-blur clamp notices** on numeric fields (shift hours, change schedule-days/cost, budget fixed amount + rate/FX overrides) show when a value was adjusted to its min/max.
  - **Label strip notice** when separator characters are removed from a label.
  - **Save-time toast** summarizing how many fields were adjusted to fit limits.
- New modules: pure `sanitize-report.ts` (describes text-cap / clamp / label-strip adjustments), `field-feedback.tsx` (`CharCounter`, `FieldNotice`, `useAdjustmentTracker`), and `toast-context.tsx` (shared toast access for editors).
- The repo now ships a **complete sample workspace** as `sample-workspace.json` (new) and a Turso-importable `sample-workspace.sqlite3` (schema v9), featuring example RAID↔stakeholder links and change-log entries — generated from the curated `sample-workspace.md` via `scripts/generate-sample-workspace.ts` (import with `turso db create lop-demo --from-file sample-workspace.sqlite3`).

### Changed
- Capped text inputs no longer hard-stop at the limit via the browser `maxLength`; instead the counter shows the overflow and the value is trimmed on blur (storage-layer sanitizers remain the final guard).
- `BUDGET_NAME_MAX`, `PO_NUMBER_MAX`, `AMOUNT_MAX` are now exported from `sanitize.ts`.
- The hand-curated `sample-workspace.md` is the sample's source of truth; the generator derives the complete `.json` + `.sqlite3` exports from it (it does not re-emit the `.md`/`.csv`, since `workspaceToMarkdown` does not escape the pipe-delimited blended-budget cell).

## [0.55.0] — 2026-06-08 "Crowley"

### Added
- **Stakeholder communication reminders:** a new pure `stakeholder-comms.ts` engine derives "reach out" nudges from a quadrant engagement policy — manage-closely (High influence / High interest) stakeholders are flagged ahead of due-soon milestones, open RAID items, and pending changes they are linked to.
- Reminders surface as a **banner**, a **review modal**, and a **once-per-load toast**, with a **Notifications settings toggle** (default on) and persisted **snooze** (mirrors the RAID-review reminder infra).
- **`stakeholderIds`** optional link field on `RaidItem` and `ChangeItem`, with a mode-gated stakeholder **multi-select** in both the RAID and Change editors (round-trips through every serializer; schema bump).
- **Milestones panel upgrade:** resizable columns, name + status filters, a Gantt-style left **add** button, and Resources-Workload row hover (new pure `filterMilestones` helper + status classification in `milestones.ts`).
- **Sidebar mode pill** showing the current Simple / Modular / Advanced mode next to the version line.
- **i18n encoding guard test** (`i18n-encoding.test.ts`): asserts the DE bundle uses literal UTF-8 umlauts (no mojibake, no `\uXXXX` escapes, no ASCII-substituted umlauts).

### Changed
- **Rebrand** "List of Open Points" → **"Project Management Tracker"** (EN + DE).
- Dashboard **Save / Clear** buttons move beside the status text in the chat-input button layout.
- Stakeholder register gains a **dark-mode color scheme**; the influence/interest matrix is sized like the chat pane; the RACI legend is restyled.
- DE i18n bundle **umlaut audit** — literal UTF-8 throughout.

### Notes
- Every comms source is **silent** when its module (stakeholders / milestones / RAID / changes) is disabled, per the Simple/Modular/Advanced mode contract.

## [0.54.0] — 2026-06-04 "Herbert"

### Added
- **Simple / Modular / Advanced mode** via Settings → Mode: per-module checkboxes, Simple and Advanced presets, and a derived mode badge showing the current state.
- Explicit **Save & reload** triggers a full page reload so navigation and automation settle on the new feature set.
- **Disabled modules retain data** but pause automation: RAID-review alerts and Turso snapshot capture are suppressed while the relevant module is off.
- Dashboard hides its top-band **Budget and Scope pills** and module-specific sections when the corresponding module is disabled.
- Gantt hides **milestone overlays** when the Milestones module is off.
- Change editor hides the **Change → RAID link** control when the RAID module is off.
- **Reports picker and report cards** respect the enabled module set (disabled-module reports are excluded).
- Navigation gated in both the **modern sidebar** and the **classic tab strip**.
- Default mode is **Advanced** (all modules on); legacy settings migrate automatically to all-on.
- New pure module `feature-modules.ts` (module registry + helpers) and `settings-sections/mode-section.tsx` (Mode settings UI).

## [0.53.0] — 2026-06-04 "Peake"

### Added
- Addable **Stakeholder report** in the Reports view (summary tiles, influence/interest quadrant grid, RACI coverage with missing/multiple-Accountable warnings, register table).
- Influence/Interest **3×3 click-matrix** in the stakeholder editor (replaces the two dropdowns; one click sets both axes).
- **Clear** button on the dashboard status summary (clears and persists an empty narrative).
- Sample workspace now seeds milestones, stakeholders, and RACI data.

### Changed
- RACI matrix and influence/interest map are now resizable panes.
- "+" prefix on the Change Log add button; "+ Add stakeholder" label on the register add button.

## [0.52.0] — 2026-06-04 "Scalzi"

### Added
- **Stakeholder register:** a new workspace entity (`Stakeholder`) with name,
  role, organisation, contact details, engagement level, influence/interest
  scores, and optional link to a Resource. Sortable/filterable panel,
  draggable edit modal, and a Stakeholders nav entry (Registers group). Rounds
  trips through every backend (schema v8 additive migration).
- **RACI matrix:** milestone-scoped responsibility matrix (Responsible /
  Accountable / Consulted / Informed) per stakeholder, rendered as a
  scrollable grid with soft warnings when a milestone has zero or more than
  one Accountable assignment.
- **Influence / Interest (power/interest) grid:** 2-D scatter plot placing each
  stakeholder by influence and interest score with colour-coded quadrants
  (Manage Closely / Keep Satisfied / Keep Informed / Monitor).
- **True RAID deep-linking:** the URL hash grammar is extended to
  `#<view>/<id>` — navigating to `#raid/<id>` opens the RAID register and
  immediately scrolls to / highlights the specified item. The RAID-review
  reminder modal now opens the exact overdue item rather than just navigating
  to the register.

## [0.51.0] — 2026-06-04 "Pratchett"

### Added
- RAID review reminders: a banner / modal / once-per-load toast nudge for active
  RAID items past their target date or not reviewed within a configurable
  interval (new Notifications setting, default on, 14-day interval).
- Budget Report: a burn-down caption plus RAG bubbles on the Plan(h), Actual(h),
  and Revenue figures.
- Help: full-text search with section filtering, match highlighting, and
  jump-to-first-match.

### Changed
- Dashboard RAG polish: colorized R/A/G counts, RAG bubbles on the budget-burn
  tiles, boxed Progress + Budget-burn sections, and an explicit Save button +
  last-updated label on the status summary.
- Reports: an added report can now be removed via a dropdown (alongside the
  × button).
- Chat: the reset-size button moves left (centered) and the input height matches
  the Send / Clear button stack.

## [0.50.0] — 2026-06-03 "Sanderson"

Change-control Log: a RAID-sibling register of change requests with a type,
6-state approval workflow, impact rating (+ optional schedule/cost), requestor/
approver, and links to tasks and RAID items. Sortable/filterable panel, draggable
edit modal, printable Change Report, and a Changes nav entry. New Workspace.changes
entity round-trips through every backend (schema v7). The dashboard gains its first
computed Scope RAG (from the pending-change backlog) plus a Changes subsection.

## [0.49.1] — 2026-06-03 "Dunsany"

Trends polish: the trend-chart gap-count caption is now localized (EN/DE), and
the Turso integration settings warn when snapshot recording is enabled but no
Turso database URL is configured.

## [0.49.0] — 2026-06-03 "Dunsany"

Baseline + variance / burn-down trends. Turso-only periodic KPI snapshots
captured into append-only tables (separate from the workspace save cycle) power a
new Trends view: baseline-vs-current variance, KPI trend charts, and a snapshot
list. Auto-capture once per cadence bucket (weekly default; daily/monthly) plus a
manual capture button; re-baselineable. Switching away from Turso warns that
recording stops (data retained, resumes on return); recording gaps are
highlighted.

## [0.48.0] — 2026-06-03 "Weeks"

### Added
- Burn-down charts: currency symbol and axis tick labels (hours / EUR scale).
- Dashboard print enhancements: print-safe RAG colors, colorized Overall health
  text, Progress and Budget section captions, and a RAG thresholds legend on
  every print card.
- Margin RAG in the Planning view and the Resource Report.
- Resource Calendar: custom Today highlight color.
- Planning table: filter and sort toolbar.
- Budget panel: role and discipline filter/sort controls.
- Budget Report: Actual(h) RAG column.

### Changed
- RAID and Budget reports are now present by default in the Reports view
  (no "+ Add report" step required).
- Both task editors (full-page and modal) gain Cancel + Add/Save buttons in
  the top action bar.
- Gantt Add-milestone button opens the milestone create form directly.

## [0.47.0] — 2026-06-03 "Reynolds"

### Added
- RAG status across the budget panel (bucket metrics + per-cell and per-role
  status in the allocation grid), the Budget Report (CCI tiles + status column),
  and the dashboard pills — a shared lettered RAG badge.
- Twin burn-down charts (hours + €) on the dashboard and in the Budget Report,
  rendered as dependency-free SVG.

### Changed
- Dashboard prints the status overrides as a static value + RAG badge instead of
  dropdowns; budget-burn tiles show the currency symbol; the Top RAID / Upcoming
  & Overdue / Milestones / Recent activity sections are boxed; clickable links
  use the resources-directory hover affordance.

## [0.46.0] — 2026-06-02 "Sullivan"

### Changed
- **EVM folded into the dashboard RAGs:** the Schedule RAG now folds in SPI and the Budget RAG folds in CPI, worst-of with the existing task / milestone / budget signals. An index below 0.8 is Red, below 0.9 Amber; a manual override still wins. CPI can surface a Budget RAG even when no budget buckets are configured. (Completes the EVM follow-up deferred in 0.45.0.)
- **Help window opens at double its previous size** (still draggable and resizable; on-screen caps unchanged).

### Added
- **Clickable version history:** the sidebar version line is now a button that opens a version-history modal (the same panel as the Version popover).
- **Settings footer:** the full-page Settings view shows a version-history link and an **Apache-2.0** license link (→ opensource.org); the license link is also added to the Help footer.

## [0.45.0] — 2026-06-02 "Robinson"

### Added
- **Earned Value (EVM):** task-effort SPI/CPI plus PV/EV/AC and schedule/cost variances, derived from task estimates, completion, and time spent. PV = estimate of tasks due by today, EV = estimate of completed tasks, AC = time spent; shown in hours with an optional EUR overlay (mean role internal rate). SPI/CPI tiles on the dashboard budget-burn band; the full table in the Budget Report. Informational only; no new persisted state.

## [0.44.0] — 2026-06-02 "Lawrence"

### Added
- **Milestones:** zero-duration key dates distinct from tasks — name, date, optional description, manual achieved sign-off, and linked tasks. Diamond rows on the Gantt with linked-task connector edges and an at-risk ring; a dedicated Milestones view; a dashboard Milestones subsection that folds overdue/at-risk/due-soon into the computed Schedule RAG. Round-trips through JSON/CSV/Markdown/Turso.

## [0.43.0] — 2026-06-02 "Lewis"

### Added
- **Project-Health Dashboard:** a consolidated view — first in the Overview nav — that works as both a live cockpit and a printable status report. Shows overall RAG plus Schedule / Budget / Scope sub-status (computed, with inline manual override), a PM status narrative, % complete + R/A/G task-health counts, budget burn, top open RAID items, upcoming/overdue dates, and recent activity, all inside the shared report/print card. RAID rows link to the RAID register; task rows open the editor.
- **Persisted project status:** a new `Workspace.status` (`ProjectStatus`: RAG overrides for overall/schedule/budget/scope + a PM narrative) that round-trips through every storage backend (JSON, CSV, Markdown, Turso).

## [0.42.2] — 2026-06-02

### Fixed
- Budget cost/revenue were zeroed for buckets loaded from the CSV/Markdown/Turso backends when their per-bucket rate-override cells were empty (an empty cell was parsed as a literal `0/h` override). Empty override cells are now treated as absent; an explicit `0` remains a valid non-billable override.

### Added
- The sample workspace now ships five budget buckets demonstrating detailed and blended planning, per-bucket rate overrides, fixed-price, and closed-with-successor spillover.

## [0.42.1] — 2026-06-02

### Fixed
- Print orientation is now per-view: reports print A4 landscape, while the Activity Log (and other non-report views) print portrait again. (0.42.0 had made all in-app printing landscape.)

## [0.42.0] — 2026-06-02 "Le Guin"

### Added
- **Composable Reports:** the Reports view has an "+ Add report" control that appends the RAID Report, Budget Report, and/or Resource Report below the task analytics. Each is removable, the selection persists, and the whole view prints as one document.

### Changed
- In-app printing now defaults to A4 landscape (matching the PDF export).

## [0.41.1] — 2026-06-01

### Fixed
- Budget panel: the empty-state "+ Add bucket…" prompt (shown when no buckets exist) is now a real button — clicking it creates a bucket and opens the editor modal. Previously it was inert text.

## [0.41.0] — 2026-06-01 "Tolkien"

### Added
- **Budget Report:** a dedicated, read-only report under Budget -> Budget Report. Shows the project-level CCI rollup (contribution margin, cost performance, consumption) and a sortable per-bucket detail table (mode, type, status, currency/FX, budget/plan/actual hours, budget/consumed EUR, margin, win/loss) across all buckets. Printable via the report card.

### Changed
- Budget reporting moved out of the task Reports view (added in 0.40.0) into the dedicated Budget Report.

## [0.40.0] — 2026-06-01 "Barker"

### Added
- **Budget planning modes:** each bucket has a "Detailed budget planning" toggle. On = plan per role (discipline x grade); off = plan per discipline using the blended average rate of that discipline's grades.
- **Per-bucket rate overrides:** optional internal/external rates that override the role/blended rate for every line in the bucket.
- **Reports → Budget section:** filter by bucket and by minimum total budget, with total / used / free / hours rollups and a per-bucket table.

### Changed
- Budget entry fields now show a unit suffix (h) and explanatory tooltips. Switching a bucket off detailed planning warns before discarding the per-role hours.

## [0.39.0] — 2026-06-01 "Tchaikovsky"

### Added
- **Resource Calendar date range:** the calendar now has **Month / Week / Custom** views with **◀ / Today / ▶** navigation and **From / To** date pickers (Custom mode). It renders an arbitrary date window — showing **past as well as future dates** — and, like the Gantt, **scroll-centers today** when it opens (re-anchoring to today on every open). Month mode opens on the current month; Prev/Next step by month or week.

## [0.38.7] — 2026-06-01

### Fixed
- **Gantt & RAID top spacing:** the filter dropdowns no longer make those toolbars taller than other views, so the Gantt chart and RAID table start at the same offset from the top as every other window.
- **Sidebar alignment:** the navigation sidebar now ends level with the bottom of the content window instead of extending below it.

## [0.38.6] — 2026-06-01

### Changed
- **Milestone codename shown in the UI:** the version now reads `0.38.6 "Chambers"` in the sidebar footer and the Version popover. Patch releases inherit their minor version's codename (the whole 0.38.x line is "Chambers").
- **Version highlights refreshed:** added a highlight summarizing the 0.38.3–0.38.5 UI-consistency work (uniform header spacing, control sizing, and dialog buttons/headers).
- **Docs:** README version line and the CODEMAPS stamps refreshed to 0.38.6.

## [0.38.5] — 2026-06-01

### Changed
- **Modal/dialog buttons unified:** the Bulk Edit, Jira Conflicts, and RAID edit dialogs now use the same compact footer buttons (size + bordered Save with the standard hover) as the task/resource/shift/absence/budget/Outlook dialogs — and as primary buttons elsewhere in the app.
- **Dialog headers unified:** the two Outlook import dialogs and the Due-Dates dialog now match the shared modal header (sticky, correct layering and background) used by the other dialogs.

## [0.38.4] — 2026-06-01

### Changed
- **Header spacing unified across the remaining views** (follow-up to 0.38.3, after a full audit): Open Points, Reports / RAID Report / Resource Report, Activity, and Manage Roles now use the same header-to-content gap as every other view.
- **RAID toolbar** now matches the Gantt toolbar exactly — same control height (search field and filter dropdowns) and the same spacing below the toolbar.
- **Activity** search field adopts the standard control height.
- **Open Points** "Jira sync" button matches the size of Budget's "Refresh ECB rates" button.
- **Planning** control row (date pickers + granularity/mode toggles) uses the standard control spacing.

## [0.38.3] — 2026-06-01

### Changed
- **Consistent header spacing across primary views:** every primary pane now uses the same top rhythm — a ~30px header row followed by an 8px gap before its content.
- **Resources (Workload / Calendar / Planning):** the header is vertically centred (was baseline-aligned), so the "Resources" title and the reset buttons line up; the reset-button cluster uses the same 8px spacing as the Directory toolbar.
- **Budget:** the header gained the missing bottom margin so the cards no longer butt against it, and the "Refresh ECB rates" button matches the size of the adjacent "Add bucket" button.
- **Gantt:** the toolbar's search field and filter dropdowns adopt the standard control height (matching the rest of the app), so the chart starts at the same offset as other views.

## [0.38.2] — 2026-06-01

### Changed
- **Resources → Workload:** the Reset-column-widths and Reset-size buttons now sit on one header line instead of stacking vertically.
- **Resources → Planning:** the From/To date pickers match the height of the granularity/mode controls.
- **Resources → Manage Roles:** the rate-card table is styled like the Directory/Workload tables; the panel is centred and half-size like Chat.
- **RAID Report, Reports, Resource Report:** each card shows a left-aligned heading on the same line as its toolbar buttons.

## [0.38.1] — 2026-06-01

### Changed
- **Classic layout:** the primary tab strip now exposes a secondary sub-tab row (Resources sub-views: Directory, Workload, Calendar, Planning, Manage Roles; and RAID Report), matching modern sidebar navigation.

## [0.38.0] — 2026-06-01 "Kiernan"

### Added
- **Resizable panes:** every primary view (Open Points, Chat, Gantt, RAID, Resources views, Budget, Activity, Reports, and the RAID/Resource reports) is now drag-resizable — views fill the available height by default, a corner handle lets you drag to any size, and a Reset-size button restores the default. Backed by a shared `VIEW_PANE_RESIZABLE_CLASS` + `useResizable` hook. Chat is presented as a centred half-size card.
- **Budget pane:** a bucket-count heading row with right-aligned action buttons.

### Changed
- **Gantt + RAID toolbars:** the add-button now appears before the search field.
- **RAID panel:** the in-panel "open report" button has been removed; the RAID Report is reachable via the sidebar.
- **Resources navigation restructured:** the Resources sidebar item now navigates directly to the Resource Report. Its sub-menu holds: Directory (formerly Address Book), Workload, Calendar, Planning, and Manage Roles (now a full page, not a modal). The standalone Resource Report sub-menu entry was removed.
- **RAID Report + Resource Report** adopt the Reports pane layout with sortable, filterable, column-resizable tables via a shared report-table kit.

## [0.37.2] — 2026-05-31

### Testing
- Added **property-based testing** with [fast-check](https://github.com/dubzzz/fast-check) (new dev dependency; no runtime impact).
- Eight co-located `*.property.test.ts` suites assert invariants over generated inputs for the pure-logic layer: `duration` (parse/format round-trip), `fx` (conversion round-trip, rate positivity, monotonicity), `resource-capacity` (period ordering, workday bounds, non-negative capacity), `due-dates` (working-day math, alert sorting), `sanitize` (length caps, idempotence, encode/decode round-trips, label dedup), `raid` (comparator antisymmetry & total order, monotonic severity, counts), `resource-cost` (cost identities, no-throw formatting), and `date-format` (locale mapping, verbatim fallback).
- Documented one boundary finding: `sanitizeNonNegInt` / `sanitizeOptionalMinutes` throw on `Symbol`s and null-prototype objects, which the JSON/CSV input path cannot produce — the property is scoped to the realistic JSON-value domain rather than hardening the function out of scope.

_No runtime/behavior changes._

## [0.37.1] — 2026-05-31

### Documentation
- README updated to the modern-layout era (version line; new **Layout & theme** and **Printing** rows in the feature table).
- Regenerated the five `docs/CODEMAPS/*` architecture maps for 0.29.0–0.37.1 (modern sidebar shell, full-page edit/Settings views, shared style constants, scoped printing).
- In-app **Help** gains a “Layout & theme” section (modern sidebar vs Classic mode, theme, URL-hash deep-linking) — EN + DE.

_No runtime/behavior changes._

## [0.37.0] — 2026-05-31 "Kowal"

### Fixed
- The Gantt **export** dropdown is no longer painted over by the sticky date row — it now stacks above the frozen header (`z-40`).

### Changed
- **Open Points (modern):** the task table now fills the available height instead of sitting in a fixed-height, manually resizable box.
- **Classic layout:** the page is now a viewport-height column — only the content area scrolls and the footer stays visible at the bottom (no more scrolling the whole document to reach it).
- **Pane consistency:** Reports, RAID, Budget, and Chat now share the same bordered surface card as the Open Points pane, and the Resources sub-tables match the main table styling. Gantt stays full-bleed by design.
- **Printing:** printing a report (Reports, RAID Report, Resources Report) or the Activity log now prints just that view — the sidebar, top bar, banners, and other panes are hidden. The Activity pane also gains a **Print** button.
- **Settings (modern):** the Jira section is always expanded in the full-page Settings view (the redundant collapse toggle is gone).
- **Address book:** the Outlook contacts import button is renamed **“Sync with Outlook”** (EN) / **„Mit Outlook synchronisieren“** (DE).
- The sidebar version line now reads **“Version x.y.z”**.

## [0.36.0] — 2026-05-31 "Hurley"

### Changed
- The task form (both the modern full-page edit view and the classic modal dialog) now presents its fields in 5 stacked, numbered sections — Details, Scheduling, Effort & Classification, Relationships, Status & Notes — instead of one long list. Same fields, same validation; just grouped for easier scanning.

## [0.35.0] — 2026-05-31 "Muir"

### Changed
- All remaining data-table headers (Reports ×3, Roles modal, Budget panel, Jira-conflicts modal, Resource calendar) now use the shared Dark-Blue `TABLE_HEAD_CLASS`, completing the Phase 3/4 header sweep. In-header sort buttons use the green accent hover; the resource-calendar frozen corner and default day cells paint dark blue with white text (today/holiday tints preserved).

### Internal
- Generalized the `table-head-sweep` guard to a `FORBIDDEN_HEADS` list and added the five swept files, so these headers cannot drift back to bespoke styling.

## [0.34.0] — 2026-05-30 "Novik"

### Added
- The modern layout now shows the Due, Birthday, and Jira-token reminder banners at the top of the content area (previously only the Classic layout showed them).

### Internal
- Extracted the shared header action cluster (Voice, Export, Help, Version) into a single `ActionMenus` component used by both the Classic header and the modern top bar, with a sweep test that guards against the two drifting apart. In the Classic header the Voice button now sits alongside Export/Help/Version (a minor reorder); behavior is unchanged.

## [0.33.0] — 2026-05-30 "McKinley"

### Added
- Full-page Settings view in the modern layout, with a left section rail (Appearance, Language & Holidays, General, Notifications, AI Assistant, Jira, Storage, Integrations).

### Changed
- Modern-layout Settings is now reached via the sidebar "Settings" item, which opens the full-page view; the gear-icon Settings popover has been removed from the modern top bar. The Classic layout is unchanged and keeps its gear popover.
- Settings sections are now shared components under `settings-sections/`, consumed by both the classic popover and the new full-page view (single source of truth).

### Internal
- Extracted `Settings` types/defaults into `settings-types.ts` (re-exported from `settings-menu.tsx`).
- Added an import-parity guard test ensuring the popover sources every section from `settings-sections/`.

## [0.32.1] — 2026-05-30

### Fixed
- The responsive sidebar no longer flashes its expanded state for a frame on narrow viewports before collapsing — the media-query hook now reads the match during render (via `useSyncExternalStore`) instead of correcting it in an effect after the first paint.

### Changed
- All Microsoft 365 sign-in consumers (Settings, the sidebar footer, storage configuration, and the storage backend) now share a single session store, so signing in or out anywhere updates everywhere immediately and MSAL initializes only once. No change to the sign-in flow itself.

### Internal
- The shell palette guard now also rejects off-palette gradient color-stop utilities (`from-`/`to-`/`via-[#hex]`), and gained self-tests for its detection patterns.

## [0.32.0] — 2026-05-30 "Pierce"

### Added
- Responsive sidebar: a collapsible **icon rail** that auto-collapses on narrow screens, a top-bar menu button, and a persisted collapse preference.
- Sidebar footer with the theme toggle, storage status, and M365 account / sign-out.
- Accessibility: a skip-to-content link and a labelled `#main-content` landmark in the modern shell.

### Fixed
- The sidebar collapse button is no longer a no-op — it is now wired through the modern shell.

## [0.31.0] — 2026-05-30 "Collins"

### Changed
- **Table restyle (Dark-Blue headers).** Every primary data table — Open Points, RAID and the RAID Report, the Activity log, the Resource Directory / Workload / Planning / Rollup grids, and the Resources Report — now has a Dark-Blue header row with white, uppercase labels, sourced from one shared style so the look stays consistent. Header sort buttons highlight in green on hover.
- **Zebra striping on the Open Points list.** The LOP table now alternates a Light-Grey tint on every other row for easier scanning. Selected, in-edit, and completed rows keep their existing emphasis. This is Phase 3 of the sidebar-layout redesign.

## [0.30.0] — 2026-05-29 "Liu"

### Added
- **Full-page task editor (modern layout).** Opening a task — or clicking **New task** — now opens a full-viewport edit view instead of the overlay dialog: a Dark-Blue section heading, a two-column field grid in the AIPM palette, and **Save** (green) / **Cancel** in the top bar. The editor reuses the same fields, state, and validation as before, and returns you to the view you came from on save or cancel. **Classic mode** and all pop-out windows keep the dialog. This is Phase 2 of the sidebar-layout redesign (a table restyle follows).

## [0.29.0] — 2026-05-29 "Wilhelm"

### Added
- **Modern left-sidebar layout — now the default.** A new app shell with a Dark-Blue left sidebar carrying grouped, nested navigation (Open Points, Chat, Gantt, Resources + Address Book/Resource Report, Budget, RAID + RAID Report, Reports, Activity, Settings), a top bar showing the active view title and actions, and a full-viewport content area that shows one view at a time. URL-hash deep-linking (`#gantt`, `#raid`, …) and browser back/forward navigation are supported. This is Phase 1 of the redesign (chrome only; a full-page edit view and table restyle follow).
- **Layout toggle in Settings → Layout.** Switch between the new sidebar layout ("Modern") and the prior layout ("Classic") at any time; the choice is persisted per device.

## [0.28.1] — 2026-05-29

### Security
- **Jira proxy SSRF hardening.** The server-side Jira proxy (`/api/jira/*`) now accepts HTTPS site URLs only — plaintext `http://` is rejected (Atlassian Cloud is always HTTPS, and this guarantees Basic credentials are never sent in the clear) — and the private-host filter now also blocks IPv6 unique-local (`fc00::/7`), IPv6 link-local (`fe80::/10`), and IPv4-mapped (`::ffff:`) addresses.

### Changed
- **Internal code-quality pass — no user-facing behavior change.** De-duplicated the eight `/api/jira/*` route handlers behind a shared `parseJiraRequest` entry point; extracted shared UI (`combobox-shared.tsx` for the combo/labels inputs, `modal-edit-fields.tsx` for the absence/shift/resource editors, plus a `ReportTableShell` wrapper and a `useSortableFilter` hook for the report tables); removed dead code and unnecessary exports; fixed lint warnings; and added test coverage for the RAID report panel.

## [0.28.0] — 2026-05-29 "Chambers"

### Added
- Link to turso.tech in the Turso storage configuration section.
- Mouseover help tooltips on every field in the Settings menu (storage, integrations, Jira, AI, notifications, and more).

### Changed
- Switching to a Turso backend when the server is down or the database is unreachable now shows a clear "storage unreachable — is the server running?" message instead of a raw network error. The switch is aborted and your current data is preserved (no switch, no data loss). A reachable but empty database is still initialized automatically.

## [0.27.0] — 2026-05-29 "Wells"

### Changed
- **Switching the storage format now converts and writes your workspace.** Instead of loading whatever was already in the target backend, the app serialises your current workspace and writes it to the newly-chosen format (JSON, CSV, Markdown, SharePoint, or Turso) after a confirmation dialog — overwriting the target. Startup load and the explicit "open file" action are unchanged; all formats remain fully two-way. No new dependencies.

## [0.26.0] — 2026-05-29 "Leckie"

### Changed
- **Turso storage is now relational.** The Turso backend stores your workspace across per-entity tables (tasks, raid, absences, shifts, resources, roles, disciplines, grades, budget_buckets, plan, fx_rates) — scalar fields as columns, nested fields (task dependencies/labels, resource utilization, budget allocations, fx rates) as encoded TEXT columns — instead of a single JSON blob, so it's queryable in SQL. Existing single-blob Turso databases (0.25.x) are imported automatically on first load. Works with Turso Cloud and a local/self-hosted `tursodb`.

## [0.25.1] — 2026-05-29

### Changed
- **Turso backend now works with a local / self-hosted `tursodb`, not just Turso Cloud.** The config resolver accepts a plaintext `http://` URL for loopback hosts (`localhost` / `127.0.0.1`) and treats the auth token as optional there; the backend omits the trailing pipeline `close` frame (newer libSQL engines reject it) and only sends the `Authorization` header when a token is configured. Remote endpoints still require `https` + a token — a Bearer token is never sent over plaintext to a non-loopback host. Run e.g. `tursodb mydb.db --sync-server 127.0.0.1:8080`, then set the Turso URL to `http://127.0.0.1:8080` (token blank) in Settings → Integrations.

## [0.25.0] — 2026-05-29 "Okorafor"

### Added
- **Turso storage backend (T1).** A new **Turso database** option in Storage Configuration stores your entire workspace as a single JSON row in a Turso (libSQL) database via the HTTP pipeline API. Enable Turso in Settings → Integrations and add your database URL + auth token (or set `NEXT_PUBLIC_TURSO_DATABASE_URL` / `NEXT_PUBLIC_TURSO_AUTH_TOKEN`). The token is stored in the browser — use a scoped token.

### Changed
- The **Turso** sub-toggle in Settings → Integrations is now interactive — **the original Microsoft 365 + Turso request is now complete** (M365 auth, SharePoint storage, Outlook contacts, Outlook calendar, Turso storage).

## [0.24.0] — 2026-05-29 "Hopkinson"

### Added
- **Outlook calendar import (M4).** With Microsoft 365 enabled and signed in, an **Import from Outlook** button on Resources › Calendar fetches your time-away events (all-day and Out-of-Office) from your Outlook calendar (Microsoft Graph `/me/calendarView`, `Calendars.Read`). A preview dialog lets you pick events and set each one's absence type (vacation / sick / training / other); selected events become absences on the resource calendar, attributed to your account. Events already present (matched by date range) are skipped.

### Changed
- The **Outlook calendar** sub-toggle in Settings → Integrations is now interactive — **all Microsoft 365 integrations (auth, SharePoint storage, Outlook contacts, Outlook calendar) are now live.**

## [0.23.1] — 2026-05-29

### Fixed
- **Microsoft 365 incremental consent.** Acquiring a Graph token for a scope you haven't consented to yet (e.g. `Contacts.Read` on first Outlook import, or `Files.ReadWrite` on first SharePoint save) previously failed silently. `useMsAuth.acquireToken` now accepts an opt-in `{ interactive: true }` and falls back to an interactive consent popup when the silent attempt fails. The Outlook contacts import and SharePoint load/save opt in; background readiness probes stay silent, so they never trigger an unexpected popup.

## [0.23.0] — 2026-05-29 "Bujold"

### Added
- **Outlook contacts import (M3).** With Microsoft 365 enabled and signed in, an **Import from Outlook** button in Resources › Directory fetches your personal Outlook contacts (Microsoft Graph `/me/contacts`, `Contacts.Read`). A preview dialog lets you pick which to import; selected contacts populate the rich resource directory (name, email, title, department, phone, company, location, birthday) and seed the assignee address book.
- Contacts already in the directory are matched by email, pre-checked, and **updated** from the latest Outlook values (uncheck to leave them alone).

### Changed
- The **Outlook contacts** sub-toggle in Settings → Integrations is now interactive (was gated "Available in 0.22.0+"). Outlook calendar remains gated for a future release.

## [0.22.0] — 2026-05-28 "Willis"

### Added
- SharePoint storage backend: store your workspace as a single JSON or CSV file in a SharePoint Sites library via Microsoft Graph. Enable SharePoint in Settings → Integrations (the sub-toggle is now interactive), then in Storage Configuration pick "SharePoint JSON" or "SharePoint CSV" and paste the SharePoint file URL. First save creates the file; concurrent edits use last-write-wins (no ETag tracking). Reuses M1's MSAL foundation; sign-in is gated behind the M365 master toggle and triggers an incremental-consent popup for `Files.ReadWrite` on first SharePoint access.
- New version highlight: "SharePoint storage" (`versionHighlightSharepointStorage`) in both EN and DE.

### Changed
- `StorageConfig` for `sp-json` / `sp-csv` no longer carries per-config `clientId` / `tenantId` — MSAL config is centralized at the M1 foundation. New shape: `{ kind, hostname, sitePath, itemPath }`. Existing settings without sp-* StorageConfig are unaffected.

## [0.21.0] — 2026-05-28 "Cherryh"

### Added
- Microsoft 365 integration foundation: a new Integrations section in Settings with a "Sign in with Microsoft" button gated behind a master toggle (defaults OFF). When the toggle is OFF, the `@azure/msal-browser` bundle is not loaded — zero cold-start cost. Configuration resolves from `NEXT_PUBLIC_MSAL_CLIENT_ID` / `NEXT_PUBLIC_MSAL_TENANT_ID` env vars first, then falls back to Client ID / Tenant inputs in the panel. Sub-toggles for SharePoint storage, Outlook contacts, and Outlook calendar render disabled with "Available in 0.22.0+" — they will be wired in subsequent minor releases.
- A Turso storage-backend toggle is present in the Integrations panel (disabled, "Available in 0.22.0+") — the Turso backend itself is the T1 sub-project, tracked separately.
- New version highlight: "Microsoft 365 auth foundation" (`versionHighlightM365Auth`) in both EN and DE.

## [0.20.0] — 2026-05-28 "Tiptree"

### Added
- Print button on Reports, RAID Report, and Resources Report popouts. Click to open the browser's print dialog with the report body laid out for DIN A4. Toolbars, toggles, filter inputs, and the print button itself are hidden via @media print; surface-token backgrounds strip to white for ink efficiency; semantic accent colors (overdue=pink, completed=green, tile values=dark-blue) survive the strip.
- New version highlight: "Print on reports" (`versionHighlightPrintReports`) in both EN and DE.

## [0.19.0] — 2026-05-28 "Russ"

### Added
- Reports popout: the By Assignee, By Group, and By Label tables are now sortable and filterable. Click any column header to cycle through ascending / descending / off. Type in the search input above each table to narrow rows (case-insensitive match on the name column); click × to clear. Default sort is by Total descending.
- New version highlight: "Reports sort + filter" (`versionHighlightReportsSortFilter`) in both EN and DE.

## [0.18.1] — 2026-05-28

### Changed
- Report popouts (Resources Report, Reports, RAID Report) no longer show the read-only-mirror banner — these views are read-only by their nature and the banner was redundant. Editing popouts still show it as before. Confirmed that due-task / birthday / Jira-token reminder banners remain hidden in every popout.

## [0.18.0] — 2026-05-28 "Shelley"

### Added
- RAID Report: a steering-committee popout opened from the RAID panel's "Open RAID Report" button. Shows four headline tiles (open counts per RAID category) and six summary tables (By Severity, By Status, By Owner, Top 10 Open, By Category, By Aging). A Summary / Full Detail toggle at the top of the report drills down to a full read-only sortable item table.
- New version highlight: "RAID Report" (`versionHighlightRaidReport`) in both EN and DE.

## [0.17.1] — 2026-05-28

### Fixed
- Gantt now opens with today centered in the viewport — scroll left for past tasks, right for future. Previously the chart opened at the leftmost data column regardless of where today fell, often hiding the most relevant bars off-screen.

## [0.17.0] — 2026-05-28 "Jemisin"

### Added
- Column-width resize on every table — Directory, Workload, Planning + Rollup, RAID, Activity Log, Reports, Budget, Resources Report sub-tables, and the jira-conflicts + roles modal tables. Drag the right edge of any header to widen or narrow a column; widths persist per table in localStorage. Tall tables (Directory, Workload, Planning, RAID, Activity Log, Reports, Budget) gain a "Reset column widths" button in their toolbar.
- New version highlight: "Column widths now resizable" (`versionHighlightTableResize`) in both EN and DE.

### Changed
- Task form modal default height bumped to 900 px (clamped to 95 vh) with a 480 px floor — twice the previous content-driven height, still user-resizable via the modal's native resize handle.

## [0.16.2] — 2026-05-28

### Fixed
- Main app shell width: the layout cap moved from `max-w-6xl` (1152px) to 1536px so the app uses more of the viewport on large displays (≥1440px wide). One-line className change in `task-manager.tsx`.

## [0.16.1] — 2026-05-28

### Changed
- Resources panel: Directory / Planning / Report tables now share the Workload tab's table chrome — sticky uppercase header, consistent padding and density. Closes sub-project B from the 2026-05-27 batch (the AIPM design system + table consistency are now both complete across the app).

## [0.16.0] — 2026-05-28 "Butler"

### Changed
- Completed the AIPM design-system rollout (sub-project E): the final 16 menus + chrome + misc components — settings/jira/storage/export/help/version menus, notifications, chat panel, activity log, workspace section, voice button, read-only-mirror banner, page/error/markdown wrappers, effort-progress-bar — now use the surface-token foundation, the green accent on focus, dark-blue fills, and no shadows or gradients. The AIPM palette now covers the entire app.

### Added
- New version highlight: "Full AIPM palette rollout" (`versionHighlightPalette`) in both EN and DE.

## [0.15.7] — 2026-05-28

### Changed
- Continued the AIPM design-system rollout: the Gantt now uses the AIPM palette and surface tokens — consistent light/dark surfaces, no drop shadows; the High-severity bar icon switched from amber to purple (completing the priority ramp); absence column tints recoloured to the palette (vacation=blue, sick=pink, training=purple); overdue ring and the destructive button now in pink.

## [0.15.6] — 2026-05-28

### Changed
- Continued the AIPM design-system rollout: the RAID panel now uses the AIPM palette and surface tokens — consistent light/dark surfaces, no drop shadows, R/A/I/D category chips remapped (Risk=pink, Action=blue, Issue=purple, Decision=green), severity ramp recoloured cold-to-hot (Low=green, Medium=blue, High=purple, Critical=pink), RAG health dots in pink/purple/green, stale/aging indicators in purple, error box in pink.

## [0.15.5] — 2026-05-28

### Changed
- Continued the AIPM design-system rollout: the tasks table (including the task row, sticky headers and toolbar), the task-form input controls (combo, contact, labels, dependencies), the reports panel and the shared task-manager UI helpers now use the AIPM palette and surface tokens — consistent light/dark surfaces, no drop shadows, task-row priority chips remapped to the palette (Medium=blue, High=purple, Urgent=pink), and the reports RAG chart in pink/purple/green.

## [0.15.4] — 2026-05-28

### Changed
- Continued the AIPM design-system rollout: all editor modals (resource, shift, absence, roles, budget bucket, task, Jira conflicts, bulk edit) now use the AIPM palette and surface tokens — consistent light/dark surfaces, no drop shadows, destructive (Delete/Discard) actions in pink, and the task RAG status indicator mapped to pink (Risk) / purple (Amber) / green (Green).

## [0.15.3] — 2026-05-27

### Changed
- Continued the AIPM design-system rollout: the resource calendar now uses the AIPM palette — absence types in blue (vacation), pink (sick), purple (training) and grey (other), today highlighted in green, holidays in purple, weekends muted. Fixes a long-standing bug where the "today" highlight used an undefined color and rendered invisibly.

## [0.15.2] — 2026-05-27

### Changed
- Continued the AIPM design-system rollout: the Resources tabs (directory, workload, report, planning) and the Budget panel now use the AIPM palette and surface tokens — consistent light/dark surfaces, no drop shadows, and status colors mapped to the palette (overdue → pink, positive margins → green, absence overrides → purple).

## [0.15.1] — 2026-05-27

### Changed
- Began the AIPM design-system rollout: introduced semantic surface tokens (light & dark) and migrated the shared controls — segmented controls, modal headers, and the app header — to the AIPM palette (green accent, dark-blue fills, no drop shadows). A new `docs/DESIGN-TOKENS.md` documents the tokens and color rules. The remaining screens follow in later updates.

## [0.15.0] — 2026-05-27

### Added
- **Light / Dark / System theme.** A new theme control in Settings lets you pick light, dark, or follow your operating-system setting. Your choice is remembered on this device and applied instantly on load (no flash). Dark mode is now class-based and switchable, replacing the previous OS-only behavior.

## [0.14.3] — 2026-05-27

Assignee names in the resources calendar and planning grids are now clickable.

### Added

- **Clickable assignee names in Calendar and Planning.** Clicking an assignee
  name in the resources **calendar** or **planning** grid opens the resource
  edit modal directly (same hover style as the Directory and Workload tabs). In
  the **calendar**, clicking a name that does not yet match a resource opens
  **Add Resource** prefilled with that name (via `splitName`).

## [0.14.2] — 2026-05-27

RAID table columns are now sortable by clicking the header.

### Added

- **RAID header sorting.** Clicking a RAID column header cycles through
  ascending → descending → off. The "off" state restores the default order,
  which always keeps closed/terminal items at the bottom. Severity sorts by
  rank (Low → Medium → High → Critical); missing target dates sort last.
  Implemented in `raid-panel.tsx`; sort comparator lives in `compareRaid`
  (`raid.ts`).

## [0.14.1] — 2026-05-27

Global percent/hours utilization toggle in the resources planning header.

### Added

- **Global utilization-mode toggle.** A percent/hours segmented toggle in the
  resource-planning panel header (alongside the existing month/week granularity
  toggle) switches all resources between percent and hours mode in one click.
  Entered values are converted between units per-period using working hours
  (`convertUtilization` in `resource-capacity.ts`).

### Changed

- **Per-resource `onSetUtilizationMode` chain removed.** The never-used
  per-resource mode handler (prop-drilled from ResourcesPanel through the
  planning grid down to individual rows) has been deleted; the global header
  toggle supersedes it.

## [0.14.0] "Atwood" — 2026-05-27

Editable budget buckets: a draggable edit-bucket modal with a role picker,
wired to "Add bucket" and a new per-card Edit button.

### Added

- **Edit-bucket modal (`BudgetBucketModal`).** Draggable modal for editing a
  bucket's name, PO number, type (T&M / Fixed), currency, fixed-price amount,
  start/end dates, spillover successor, and manual FX-rate override — with
  full field validation.
- **Role picker inside the modal.** Add and remove role allocation lines; assign
  resources (capacity) per role directly within the editor.
- **Edit button on bucket cards.** Each existing bucket card now exposes an
  Edit button that opens `BudgetBucketModal` pre-populated for that bucket.
- **"Add bucket" opens the editor.** Creating a new bucket immediately opens
  `BudgetBucketModal` on the fresh shell instead of leaving an uneditable
  placeholder. Per-period hours are still edited in the panel grid.
- **Gantt task-name → open editor.** Clicking a task's name label in the
  Gantt chart opens the task editor modal for that task, consistent with
  the task-list row hover behaviour.

## [0.13.1] — 2026-05-27

Effort progress bar and task-form/UI polish within the Bradbury milestone.

### Added

- **Effort progress bar.** `EffortProgressBar` (`effort-progress-bar.tsx`) renders
  in the task editor (and wherever effort fields are visible). The bar fills
  left→right proportionally to time-spent vs original estimate; turns red and
  displays the percentage when time spent exceeds the estimate; shows greyed
  when no estimate is set. Ratio derived from the new `effortProgress` helper
  in `duration.ts`.

### Changed

- **Task form reflow.** Group field now sits beside the Last update date field.
  Original estimate and Time spent share a single row; the effort progress bar
  spans the full width beneath them.
- **Task list hover.** The row highlight-hover now applies to the ID cell and
  Task-name cell; the assignee column shows as plain text (no hover highlight).
- **Budget UI.** "Add bucket" button style now matches the "Add task" button.
  "Close" and "Remove" bucket buttons use the same highlight-hover style as
  resource-assignee controls.

## [0.13.0] "Chakraborty" — 2026-05-27

UI polish batch: draggable modals with in-modal voice, task effort tracking,
removable/reorderable budget buckets, resource-planning fixes, sortable roles
columns, and a suite of small UX improvements across the app.

### Added

- **Draggable modal windows.** A shared `ModalHeader` component (`modal-header.tsx`)
  provides a drag handle on every modal. Drag logic lives in `use-draggable.ts`.
- **In-modal voice commands.** `VoiceCommandContext` (`voice-command-context.tsx`)
  makes the voice dispatcher available inside modals, so every modal now
  supports the same voice commands as the main view.
- **Task effort fields.** Optional "Original estimate" and "Time spent" fields
  on the task form, using `w/d/h/m` notation (Jira basis: 1w = 5d, 1d = 8h).
  New `duration.ts` helper parses and formats duration strings and round-trips
  with Jira minute values. "Est." and "Spent" columns in the tasks table are
  hideable and sortable.
- **Budget bucket removal.** Each bucket can now be deleted; any CCI/win-loss
  calculations based on a removed bucket reset to 0.
- **Budget bucket reorder.** Buckets support drag-to-reorder; the chosen order
  is persisted via a new `order` field on `BudgetBucket`.

### Changed

- **Tab order.** Budget now sits between Resources and Activity.
- **Assignee hover styling** unified across Directory, Workload, and Task views.
- **Resource planning — week view from month entry.** The "weeks" view now
  derives week capacity from the month-level entry (read-only when granularity
  is set to month), fixing the previously empty weeks display.
- **Resource planning — tooltips.** Explanatory tooltips added to rollup totals
  and the utilization input.
- **Roles & rates.** Discipline, Grade, Internal, and External columns are now
  sortable. A visual divider separates the rate card from the add-combo row.
  Discipline and Grade selects show a "—" placeholder. Manage-roles and Report
  buttons gained leading icons.
- **ECB "refresh rates" button** restyled to match the Jira-sync button, with a
  spinner while the fetch is in progress.

## [0.12.0] "Huxley" — 2026-05-26

Adds a project budget planner: named PO-line budget buckets (T&M or fixed-price)
that span roles, draw planned hours from the resource engine, track entered
actuals, and report a three-value CCI plus win/loss — with multi-currency
display backed by ECB rates and remaining-budget spillover on close.

### Added

- **Budget tab + planner.** Create budget buckets (name, PO number, type
  T&M/fixed-price, currency EUR/USD/GBP, start/end dates, successor). Each
  bucket holds per-role allocations (role + feeding resources + per-period
  budget/actual hours). `budget-panel.tsx`.
- **CCI panel (×3).** Contribution margin, cost performance, and consumption —
  each as amount + percent, at bucket and project level. Win/loss in hours and
  currency. Pure engine in `budget-report.ts`.
- **Planned-from-resources, actuals entered.** Planned hours derive from the
  existing resource capacity/utilization engine for the resources listed on each
  allocation; actuals are entered per bucket/role/period.
- **Spillover.** Closing a bucket rolls its remaining budget (hours + amount)
  into a named successor (computed, reversible on reopen).
- **Multi-currency via ECB.** New `/api/ecb` route fetches ECB daily reference
  rates (cached in the workspace); per-bucket manual rate override wins while
  present, else the cached rate, else EUR. `fx.ts`, `ecb.ts`, `use-fx-rates.ts`.
- **Bucket end-date reminders** via the existing reminder lead-time, surfaced as
  a toast (`getBucketReminders`).

### Changed

- **Workspace schema v6.** Additive `budgets` + `fxRates`, with an idempotent
  v5→v6 migration; full round-trip across IndexedDB, JSON, CSV, and Markdown,
  and inclusion in manual CSV/MD exports. `budgets`/`fxRates` are optional on
  the `Workspace` type for backward compatibility.

## [0.11.0] "Orwell" — 2026-05-26

Pop-out windows become read-only mirrors (closing a data-loss path), every
search/filter control gets a proper tooltip, and Jira gains token-expiry
reminders with clearer sync messages.

### Added

- **Jira token-expiry reminders.** Record your API token's expiry date in
  Settings → Jira ("Token expires on"). A banner warns when it is within your
  reminder lead time and once it has expired (`getJiraTokenAlert` in
  `jira-token-status.ts`, reusing the snooze/banner infrastructure;
  `ReminderKind` gains `"jiraToken"`). A 401/403 from a sync or Test-connection
  also raises the banner until a successful sync/test clears it.
- **Descriptive control tooltips.** Every search, filter, and sort control —
  and every field of the RAID edit modal — now has its own descriptive tooltip
  across Gantt, RAID, Resources, Activity, and Tasks (~40 new EN + DE strings).
  `SegmentedControl` gained an optional `title` passthrough.
- **Read-only mirror banner** in pop-out windows, plus `makeEditGuard`
  (`read-only-guard.ts`) and `ReadOnlyMirrorBanner` (`read-only-mirror-banner.tsx`).

### Changed

- **Pop-out windows are read-only mirrors.** They receive live state over
  `BroadcastChannel` but never broadcast and never persist. `useBroadcastSync`
  gained a `canSend` flag (the receive listener always registers; only the send
  effect is gated), and `use-storage-backend.ts` passes `canSend={!isPopout}` to
  all nine calls. Edit affordances are locked in pop-outs: commit handlers no-op
  with a toast, the chat dispatcher refuses mutating tools, and the Gantt "Add
  Task" button is hidden.
- **Clearer Jira sync messages.** `classifyJiraError` maps failures to
  actionable info messages — a recorded-past expiry blocks the sync ("paused"),
  401/403 → "token rejected", network/unreachable → "couldn't reach Jira" —
  while other HTTP errors keep the generic message. `JiraApiError` is now
  exported.
- **Tasks column headers** match the Resources directory header hover and gain a
  "Sort by …" tooltip (`SortableTh` gained a `lang` prop).
- **README** version badge → 0.11.0.

### Fixed

- **Data loss when closing a pop-out.** A pop-out's load no longer broadcasts its
  state to the main window (which then persisted it); combined with `writeHandle`
  now aborting the swap-temp on a blocked `write`/`close`, a Chrome
  security-policy-blocked write can no longer delete the local workspace file.
- **Leaking resize tooltip.** The "drag the bottom-right corner to resize this
  workspace pane" hint no longer appears on the Gantt/RAID/Resources/Activity
  search & filter controls (or the RAID modal fields): it was a `title` on the
  wrapping `<section>`, which HTML shows on any title-less descendant. Replaced
  with an inert corner glyph.

## [0.10.0] "Nabokov" — 2026-05-25

Everything built on top of the Resource Utilization release: a Resource
Address Book, a unified working-day-shifted reminder lead, and persisted
reminder snooze — plus two data-integrity fixes and a project-wide lint pass.

### Added

- **Resource Address Book.** `Resource` splits the single `name` into
  `firstName` / `lastName` and gains contact fields: title, business phone,
  location, department, email, company, birthday (month-day only), and
  free-text notes (`splitName` / `resourceDisplayName` in
  `resource-foundation.ts`).
- **Four-tab Resources pane** — Directory | Workload | Calendar | Planning.
  The new **Directory** tab (`resource-directory.tsx`) is an address-book
  table (one row per resource); clicking a name opens the resource edit modal
  (`resource-edit-modal.tsx`) with all address-book fields, and "+ Add
  resource" creates a new entry. The **Workload** tab is rekeyed to managed
  resources with a separate "Unlinked" group for assignees that have no
  resource (`resource-workload-rows.ts`, `buildResourceWorkload`).
- **Address-book pop-out window** — an "Open address book" button launches the
  Directory in its own window (`?popout=address-book`), live-synced via the
  existing `BroadcastChannel` plumbing.
- **Birthday reminders** — `getUpcomingBirthdays` (year-wrap aware) drives a
  banner plus a once-per-load toast.
- **Create a contact from the task form** — a "+" beside the Assignee opens the
  address-book add-entry modal seeded with the typed name/email; saving creates
  the resource and fills the task's assignee.
- **Persisted reminder snooze** — both reminder banners (due-date + birthday)
  gain a Snooze control (In 1 hour / In 1 day), stored per-kind in
  `localStorage` (`reminder-snooze.ts`, `useReminderSnooze`) and re-shown
  automatically when it elapses. While snoozed, the banner is hidden and the
  load toast is suppressed.

### Changed

- **Unified reminder lead with working-day shift.** A single "days ahead"
  control (`reminderLeadDays`) replaces the separate birthday lead-days and
  due-date work-day threshold. A reminder whose trigger would fall on a
  weekend, holiday, or absence day is shifted earlier onto the prior working
  day so it fires during the work week (`shiftToWorkingDay` / `absenceDayMap`
  in `due-dates.ts`; settings migrated in `use-settings.ts`).
- **Shared `localeFor` / `shortDateRange`** extracted into `date-format.ts`.
- **README** version badge → 0.10.0; Resources / Notifications feature rows
  updated.

### Fixed

- **Pop-out data loss** — a pop-out window broadcast its initial (empty) state
  on mount, which the main window then persisted, truncating the synced file.
  Windows no longer broadcast their first value (`broadcast-sync.ts`).
- **Soft-archive round-trip** — `active="false"` on a serialized resource is
  now honored on load instead of coercing back to `true`.
- **File-picker stickiness** — each local format (JSON / CSV / Markdown)
  carries its own picker `id`, so switching formats no longer reopens the
  previous format's picker.
- **Workload tab double render** — empty-state and empty-table no longer both
  render.
- **Toast freshness** — the once-per-load due/birthday alert reads the holiday
  set + absences via refs so the toast matches the (reactive) banner.

### Quality

- **ESLint: 75 → 0 problems, no config weakened.**
  `react-hooks/set-state-in-effect` prop-sync effects rewritten with the
  set-during-render previous-value pattern; genuine SSR-hydration effects kept
  with documented disables; render-time `useRef` writes moved into effects
  (`filters-context.tsx`, `task-manager.tsx`); test mocks typed properly and
  hook-calling test helpers renamed `probe → useProbe`; unused vars + stale
  `eslint-disable` directives removed; Gantt bar resize handles
  `role="slider"` → `role="button"`.

### Tests

- New test files for birthdays (`birthdays.test.ts`), the address-book workload
  rekey (`resource-workload-rows.test.ts`), the `date-format` helpers, and
  reminder snooze (`reminder-snooze.test.ts`, `use-reminder-snooze.test.tsx`).
  Full suite green: 389 tests across 54 files.

## [0.9.0] "Mann" — 2026-05-24

Resource Utilization feature — turns the Resources tab from a derived
read-only view into a first-class capacity & cost planner. Built spec-first
across five phases (foundation → roles & rates → capacity engine →
cost layer → report pop-out) plus a polish round.

### Added

- **First-class `Resource` entities** with two-dimensional `Role`
  (discipline × grade) carrying internal/external hourly rates. Seeded
  presets — disciplines: Developer / Business Analyst / Consultant /
  Project Manager; grades: Junior / Associate / Consultant / Senior /
  Lead / Principal. Both lists are editable (add custom, rename) and
  `Role` combos are created on demand when a resource is assigned.
- **Roles & rates manager modal** (`roles-modal.tsx`) — discipline × grade
  rate card with editable internal/external rates and on-demand role
  creation; opened from the Resources tab header.
- **Per-resource role assignment** in the Resources roster (controlled
  discipline + grade selects per resource).
- **Editable per-period Planning grid** (third view in the Resources tab):
  - Per-resource utilization input per period (week or month).
  - Percent mode (0–100) or hours mode (per resource).
  - Per-row capacity totals (days).
  - Per-cell absence override (auto-derived hours as placeholder; clearing
    reverts to auto).
  - Planning-window date controls (From / To) and week/month granularity
    switch.
- **Capacity engine** (`resource-capacity.ts`, pure) — period generation
  (calendar months + ISO weeks Mon–Sun), workdays minus weekends and
  holidays, absence accounting (auto from the `Absence` entity or manual
  override), and the capacity formula:
  - percent mode: `(util / 100) × max(0, possibleHours − absenceHours)`
  - hours mode: `max(0, util − absenceHours)`
- **Cost layer** (`resource-cost.ts`, pure) — `internalCost = hours × rate`,
  `externalCost = hours × rate`, `margin = external − internal`. Internal /
  external / margin columns + footer totals in the Planning grid;
  formatted via `Intl.NumberFormat(locale, { currency })` from
  `plan.currency`.
- **Read-only week ↔ month rollup table** in the Planning view — toggles
  the non-canonical granularity as a read-only re-bucketing, leaving the
  canonical editable grid untouched.
- **Resources report pop-out** (`resources-report.tsx`) — read-only report
  launched via a "Report" button in the Resources header. Summary tiles
  (total capacity, internal cost, external cost, margin), per-period
  table, per-discipline / per-grade / per-role-combo breakdowns, and a
  per-resource table (role, avg utilization, capacity, costs).
  Unassigned-role resources are flagged and excluded from the breakdowns
  (still counted in capacity totals). Opens as a separate window via
  `?popout=resource-report`; live cross-window data sync via the existing
  `BroadcastChannel` plumbing.
- **`workdayHours` setting** (default `8`) under Settings → Resources.

### Changed

- **Storage schema → v5.** `Workspace` now also carries `resources`,
  `roles`, `disciplines`, `grades`, and a `plan` singleton
  (`ResourcePlan { startDate, endDate, granularity, currency }`). Four
  new IndexedDB stores (`resources`, `roles`, `disciplines`, `grades`)
  plus a `resource-plan` entry in the existing `kv` store. CSV /
  Markdown / JSON file backends gain matching sections; the dynamic
  `utilization` / `absenceOverride` maps serialize as a single encoded
  cell via the new period-map codec.
- **Additive `resourceId?` on `Task` and `Absence`** — the free-text
  `assignee` is preserved as the display value, the Jira-sync field, the
  search/filter key, and a fallback join. `resourceId` is authoritative
  when present (Approach A — non-destructive).
- **Idempotent v5 migration** (`migrateWorkspaceV5`) — seeds preset
  disciplines/grades and a default plan, and on first load backfills one
  `Resource` per distinct case-folded `assignee` across tasks + absences,
  stamping `resourceId` onto those records. Re-running over a populated
  workspace is a no-op (reference equality).
- **`Resource Planner` Features row in the README** updated to reflect
  the new roles, planning grid, capacity/cost, rollup, and report.
- **Storage Backends row** updated to schema v5 + new stores.
- **`src/app/version.ts`** — `APP_VERSION` `"0.9.0"`, `APP_BUILD_DATE`
  `2026-05-24`, prepended highlight comment.
- **CODEMAPS** (`architecture.md`, `frontend.md`, `data.md`) refreshed for
  the new entities, schema v5 layout, new modules, and the
  resource-report popout target. `backend.md` / `dependencies.md`
  freshness-only (no API routes or runtime/dev deps added).

### Fixed

- Two long-standing pre-existing `tsc` errors in test fixtures
  (`settings-menu.test.tsx`: self-referential `makeProps` type;
  `use-due-alerts.test.ts`: stale `StorageConfig` shape). Project now
  type-checks fully clean (`npx tsc --noEmit` → 0 errors).

### Tests

- **`resource-capacity.test.ts`** — 13 tests including the Excel golden
  fixture from `docs/patterns/Book1.xlsx`: Andre Weiß, Feb 2026 (20
  workdays), 95 % utilization, 5.5-day absence override (44 h) →
  `110.2 h` / `13.775 days` — matches the spreadsheet's `D4 = 13.775`.
- **`resource-cost.test.ts`** — 5 tests (percent/hours costs, unassigned,
  currency formatter incl. invalid-code fallback).
- **`resource-foundation.test.ts`** — 7 tests (preset seeding, default
  plan window, assignee backfill, `findRoleByCombo`, `roleLabel`,
  `nextId`).
- **`resource-report.test.ts`** — 2 tests (totals + breakdowns for an
  assigned resource; unassigned excluded from breakdowns but counted in
  totals + per-resource).
- **`storage-serialization.test.ts`** — 4 tests (v5 migration idempotency
  + assignee backfill; CSV and Markdown round-trip preserve all new
  entities including encoded period maps).
- **`sanitize.test.ts`** — extended for period-map codec, `sanitizeResource`
  (object + encoded-string map forms, percent / hours clamping), `Role`,
  `Discipline`, `Grade`, and `sanitizePlan`.
- **`resources-panel.test.tsx`** — 10 tests covering the planning view's
  edit flow, "Manage roles" + "Report" buttons, per-resource role
  assignment, planning-window control, absence-override editing, and the
  read-only rollup toggle.
- **`roles-modal.test.tsx`** — 3 tests for the rate card.
- **`resources-report.test.tsx`** — render test for tiles, breakdowns,
  and the per-resource table.
- **`use-resource-planner.test.tsx`** — extended to 32 tests (added: role
  CRUD + on-demand creation, discipline/grade add/rename, utilization
  set, mode switch, absence override set/clear, plan window/granularity
  setters).

Full suite: 296 tests across 43 files, all green.

## [0.8.4] "Lorca" — 2026-05-22

### Refactored
- Extract `AppModals` from `task-manager.tsx`: renders `DueBanner`, `TaskFormModal`, `DueDatesModal`, `JiraConflictsModal`, `AbsenceEditModal`, `ShiftEditModal`, `<footer>`, and toast
- `TasksSection` builds `rowContextValue` internally: calls `useSettings()` + `useHolidaySet()`; receives 8 row-handler callbacks + `jiraSiteUrl` as explicit props instead of a single opaque `RowContextValue` prop
- `task-manager.tsx`: −~140 lines

## [0.8.3] "Kafka" — 2026-05-22

### Refactored
- Extract `WorkspaceTabContext` (`TopTab` type + `WorkspaceTabProvider` + `useWorkspaceTab` hook) from `task-manager.tsx`
- Extract `AppHeader` component (app `<header>` block, ~90 lines) from `task-manager.tsx`
- Extract `WorkspaceSection` component (workspace `<section>` block, ~250 lines) from `task-manager.tsx`
- `useTaskRowHandlers` now reads `setActiveTab` from `WorkspaceTabContext` instead of receiving it as a prop
- `task-manager.tsx`: −377 lines (1,038 → 661)

## [0.8.2] "Joyce" — 2026-05-21

Extract `TabButton`, `Th`, `SortableTh`, `ResetSizeIcon`, `ResetColWidthsIcon`,
`EraserIcon` to `task-manager-ui.tsx` and the entire tasks `<section>` JSX to
`tasks-section.tsx`. `TasksSection` reads `useFilters()`, `useWorkspace()`, and
`useTaskForm()` from providers internally; receives 31 explicit props for state
that originates outside those contexts (column manager, resizable table, row
state, Jira, task actions, bulk operations). 3 smoke tests. `task-manager.tsx`
−520 lines; now ~1,049 lines. Slice 14 of the decomposition.

## [0.8.1] "Ibsen" — 2026-05-21

### Refactored
- Extracted `useTaskSubmit`: error state, `handleSubmit` (validation + create/update + Jira push), `handleCancelEdit`, `openEditModal`
- Extracted `useGanttHandlers`: `handleGanttBarUpdate` (drag-edit with start ≤ due clamping)
- Circular dep resolved via `onPushToJiraRef` forwarding-ref pattern (mirrors `handleCancelEditRef` in slice 12)
- Dropped dead sanitize imports and `upsertContact` from `task-manager.tsx`
- `task-manager.tsx` −165 lines; 8 new unit tests

## [0.8.0] "Hemingway" — 2026-05-21

### Refactored
- Extracted `useHolidaySet`: async holiday load with cancellation flag
- Extracted `useTaskRowHandlers`: 9 row callbacks + `expandedNotes`/`pushingIds` state
- Eliminated `handleEdit` duplicate; `useBulkOperations` consumes `onEdit` from hook
- Removed dead `settingsRef`/`todayRef` (leftover from Slice 11)
- Exported `TopTab` from `task-manager.tsx` for hook type sharing
- `task-manager.tsx` −120 lines; 9 new unit tests

## [0.7.9] "García" — 2026-05-21

### Refactored
- Extracted `useToast` hook: toast state, `showToast` factory, auto-dismiss timer
- Extracted `useDueAlerts` hook: banner/modal state, session-once due-date alert effect
- `task-manager.tsx` net −48 lines

## [0.7.8] "Faulkner" — 2026-05-21

### Refactored
- Extracted `useColumnManager` hook (~110 lines): column widths, hidden columns, column-config dropdown, resize-drag interaction; localStorage load/persist (debounced 250 ms for widths)
- Extracted `useContacts` hook (~45 lines): contacts address-book lifecycle, seed-from-tasks on first load, localStorage load/persist
- Extracted `useWorkspaceCollapsed` hook (~25 lines): workspace-panel collapsed boolean, localStorage load/persist
- `task-manager.tsx` ~−175 lines; now ~2,010 lines

### Tests
- `use-column-manager.test.ts`: 7 tests — initial state, localStorage hydration, resetColWidths, debounced persistence
- `use-contacts.test.ts`: 4 tests — initial state, hydration gate, localStorage load, handleRemoveContact
- `use-workspace-collapsed.test.ts`: 4 tests — initial state, localStorage load, persist true/false

## [0.7.7] "Elias" — 2026-05-20

### Refactored
- Extracted `useSettings` hook (~100 lines): settings state, localStorage load/persist, `hydrated` + `i18nReady` gates, i18n loading
- Extracted `useActivityLog` hook (~50 lines): activity log state, localStorage load/persist, `logActivity`, `handleClearActivityLog`
- `task-manager.tsx` ~−150 lines; now ~2,145 lines

### Tests
- `use-settings.test.ts`: 6 tests — initial state, hydration gates, localStorage load/persist
- `use-activity-log.test.ts`: 6 tests — state-init, logActivity append, handleClearActivityLog confirm variants

## [0.7.6] "Duras" — 2026-05-20

### Refactored
- Extracted `useResourcePlanner` hook (~350 lines): RAID CRUD, absence CRUD (with modal state), shift CRUD (with modal state), `handleCreateMitigationTaskFromRaid`
- Extracted `useBulkOperations` hook (~270 lines): `selectedIds` state, bulk edit, `handleCommand` (voice dispatcher), `handleClearAll`, `handleBulkSendInquiry`
- `task-manager.tsx` −518 net lines; now ~2,295 lines

### Tests
- `use-resource-planner.test.tsx`: 13 tests — modal state, RAID/absence/shift CRUD, auto-issue on Risk→Realized, mitigation-task creation
- `use-bulk-operations.test.tsx`: 13 tests — selection toggle, bulk edit validation, clearAll confirm, handleCommand dispatch, bulk inquiry mailto

## [0.7.5] "Calvino" — 2026-05-20

Internal refactor. Slice 7 of the task-manager.tsx decomposition extracts
the storage backend logic into a dedicated useStorageBackend hook, and
widens WorkspaceContext (Phase A) to own raid, absences, and shifts state.
Net: task-manager.tsx −164 lines.

### Refactored

- **useStorageBackend hook** (`src/app/use-storage-backend.ts`): ~167 lines
  moved from task-manager.tsx. Owns all storage, broadcast-sync, and
  file-handler logic.
- **WorkspaceContext** widened (Phase A) to own `raid`, `absences`, and
  `shifts` state so downstream consumers can read these without prop-drilling.
- **task-manager.tsx** −164 net lines; all storage, broadcast-sync, and
  file-handler logic now lives in the hook.

### Tests

- `use-storage-backend.test.tsx`: 14 tests covering state-init, load effect,
  save effect, and file handlers.
- `workspace-context.test.tsx`: assertions for new raid/absences/shifts
  defaults.
  Suite total: 110+ tests.

## [0.7.4] "Bradbury" -- 2026-05-20

Internal refactor. Slice 6 of the task-manager.tsx decomposition extracts
the Jira sync logic into a dedicated useJiraSync hook, reducing
task-manager.tsx by ~315 lines.

### Changed (internal)

- **useJiraSync hook** (src/app/use-jira-sync.ts): owns jiraSyncing +
  jiraConflicts state, handleJiraSync, and handleResolveConflicts. Reactive
  values (tasks, settings, lang, today) routed through refs so useCallback
  deps stay [showToast, logActivity] only.
- **loadJiraApi** lazy-load cache moved from task-manager.tsx to
  use-jira-sync.ts and re-exported for onPushToJira.
- **task-manager.tsx** calls useJiraSync({ settings, today, lang, showToast,
  logActivity }) and destructures the five return values.
  Net: -303 lines (3289 -> 2986).

### Tests

- 12 new unit tests in src/app/use-jira-sync.test.tsx covering state-init,
  no-credentials guard, jiraSyncing flip, pull, push, conflict detection,
  create-issue, error toast, and conflict resolution paths.
  Suite total: 96 tests across 13 files.

## [0.7.3] "Adams" — 2026-05-20

Internal refactor + a visible performance win. Slice 5 of the
`task-manager.tsx` decomposition extracts the Claude chat-tool dispatcher
into its own custom hook with a stable identity, which lets us memoize
`ChatPanel`. The chat panel no longer re-renders on every task-form
keystroke.

### Changed (internal — single user-visible side effect)

- **`useChatDispatcher` hook** (`src/app/use-chat-dispatcher.ts`): consumes
  `useWorkspace` / `useTaskForm` / `useFilters` directly. Four internal
  refs (`tasksRef`, `settingsRef`, `todayRef`, `editingIdRef`) absorb every
  reactive value the dispatcher reads, so the `useMemo<ToolDispatcher>`
  has empty deps and its identity never changes after first render. The
  dispatcher synchronously updates `tasksRef.current` before calling
  `setTasks` so back-to-back chat tool calls in one turn see each other's
  writes.
- **`task-manager.tsx`** now calls `useChatDispatcher({ settings, today,
  setSelectedIds, setSettings })` instead of inlining ~240 lines of refs,
  helpers, and the dispatcher `useMemo`. Net: −228 lines (3517 → 3289).
- **`ChatPanel` wrapped in `React.memo`** (`src/app/chat-panel.tsx`).
  Combined with a `useCallback` for `onAcceptConsent` and the now-stable
  dispatcher, all four `ChatPanel` props are reference-stable for any
  parent re-render that doesn't change `lang` or `settings.ai` — so the
  Chat tab skips re-renders during, e.g., task-form input. **This is the
  visible performance win.**

### Added

- **`src/app/test-providers.tsx`** — small test helper composing
  `FiltersProvider` → `WorkspaceProvider` → `TaskFormProvider`, with a
  one-shot `Seeder` child for initial tasks. Used by the new hook tests.
- **15 unit tests for `useChatDispatcher`** covering each of the 10
  dispatcher methods plus two identity-stability tests that pin the
  empty-deps invariant the slice is designed around. Test count: 69 → 84.

### Moved (small refactor opportunities exposed by extraction)

- `isValidEmail` moved from a private function in `task-manager.tsx` to
  an exported member of `src/app/sanitize.ts`. Behaviour identical at all
  10 existing call sites.
- `greetingName` moved from a private function in `task-manager.tsx` to
  an exported member of `src/app/contacts.ts` (also pulled in
  `isValidEmail` from `./sanitize`). Behaviour identical at all 3
  existing call sites.

### Fixed

- The "ChatPanel memoization (gated on dispatcher useMemo deps audit)"
  open item in `.reports/codemap-diff.txt` is now closed. The dispatcher's
  `editingId` dep — the last reactive value preventing identity
  stability — is routed through `editingIdRef.current`.

## [0.7.2] "Banks" — 2026-05-19

Activity-log confirm dialog, three Rules-of-Hooks / hydration bug fixes,
and a large internal refactor that cut `task-manager.tsx` by ~700 lines
without changing any user-visible behaviour.

### Added

- **Activity log — confirm before clear**: "Clear log" now shows a native
  `window.confirm` dialog with the entry count before wiping. Consistent
  with the existing confirm-before-delete pattern on "Delete all tasks"
  (`handleClearAll`) and single-task delete (`handleDelete`). Help text
  updated in EN and DE.
- **Next.js 16 error boundaries** (`src/app/error.tsx`,
  `src/app/global-error.tsx`): React 19 render-error boundaries.

### Fixed

- **Rules of Hooks — `TaskManagerInner`**: `rowContextValue useMemo` was
  declared after the `!i18nReady` early return; moved before the gate so
  the hook count is stable across renders.
- **Rules of Hooks — `ReportsPanel`**: `groupHealth useMemo` was declared
  after the `stats.total === 0` early return; same fix.
- **Hydration mismatch on `<html>`**: added `suppressHydrationWarning` to
  `layout.tsx` to silence false mismatches when browser extensions (e.g.
  LanguageTool) inject attributes before React hydrates.

### Changed (internal — no user-visible behaviour change)

- **Slice 4 — modal extraction**: `TaskFormModal` (~491 lines) and
  `BulkEditModal` (~354 lines) extracted from `task-manager.tsx` into
  standalone files with component-level tests. Net −707 lines from the
  god-component.
- **Slices 1–3 — context extraction**: `FiltersProvider`,
  `WorkspaceProvider`, and `TaskFormProvider` pulled out of
  `task-manager.tsx` into dedicated context files, each with full test
  coverage.
- **Slice 2b — `TaskRow` extraction**: the per-row `<tr>` and its
  sub-components (`TaskActions`, `NotesCell`, `DependencyChips`,
  `RaidBadge`) extracted into `src/app/task-row.tsx` with `React.memo`
  isolation.
- **Shared `<Modal>` shell** extracted from duplicated modal JSX into
  `src/app/modal.tsx`.
- **`useDebounce` hook** extracted into `src/app/use-debounce.ts`.

## [0.7.1] "Kennedy" — 2026-05-17

Developer test scaffolding. Dev-only change — no user-visible behavior
difference vs 0.7.0.

### Added

- **Vitest** unit/component test runner. Config: `vitest.config.ts` (jsdom env, `@` path alias, `@vitejs/plugin-react`); setup: `vitest.setup.ts` (registers `@testing-library/jest-dom` matchers, RTL cleanup). Tests live alongside their sources as `src/**/*.test.{ts,tsx}`. v8 coverage threshold at 80% for lines / functions / branches / statements.
- **Sample unit tests**: `src/app/sanitize.test.ts` (14 cases), `src/app/due-dates.test.ts` (6 cases), `src/app/segmented-control.test.tsx` (3 cases).
- **Playwright** E2E runner. Config: `playwright.config.ts` (Chromium-only by default; Firefox / WebKit commented in). Auto-starts `npm run dev` on port 3000; reuses an existing local dev server. Traces, screenshots, and video retained on failure. Tests live in `e2e/**/*.spec.ts`.
- **Sample E2E test**: `e2e/smoke.spec.ts` — root page loads, title matches, `<main>` visible.
- **Scripts**: `npm run test`, `test:run`, `test:coverage`, `e2e`, `e2e:ui`, `e2e:install`.
- **`.gitignore`**: `/test-results`, `/playwright-report`, `/playwright/.cache`, `/blob-report`.
- **8 new devDependencies**: `vitest`, `@vitest/coverage-v8`, `@vitejs/plugin-react`, `jsdom`, `@testing-library/react`, `@testing-library/jest-dom`, `@testing-library/user-event`, `@playwright/test`. No runtime deps added.

### Changed

- `README.md` and `CONTRIBUTING.md` scripts tables extended with the six new commands.
- `CONTRIBUTING.md` "Testing" section rewritten from "there is currently no test suite" to describe the new Vitest + Playwright setup.
- `src/app/version.ts` comment block prepended with a 0.7.1 entry; `APP_BUILD_DATE` unchanged (already today).

### Not changed (intentional)

- In-app `HelpMenu` and `APP_HIGHLIGHT_KEYS`. Test infrastructure is developer-facing; end-user help and version popover stay focused on user features.

## [0.7.0] "Heinlein" — 2026-05-17

Resource Planner + Activity Log release. Adds per-assignee absences and
shift patterns, a chronological CRUD audit log, a persisted contacts
address book, and a per-request CSP nonce middleware. Also lands
SharePoint storage backend stubs (UI present, MSAL not yet wired).

### Added

- **Resource planner** (Phases 1–4): per-assignee absences (vacation / sick / training / other), weekly shift patterns, and a 30-day calendar view. New `Absence` and `Shift` types in `src/app/types.ts`; new IndexedDB stores `absences` (v3) and `shifts` (v4).
- **Activity log**: chronological CRUD record for tasks, RAID, absences, and shifts. 21 `ActivityKind` values; capped at 500 entries; persisted to `localStorage` key `lop-app:activity-log` and explicitly excluded from any file export.
- **Contacts address book**: persisted to `localStorage` key `lop-app:contacts`; capped at 500 entries; survives task deletion and Jira sync churn.
- **Per-request Content-Security-Policy nonce** via Next.js 16 middleware (`src/proxy.ts`). `script-src` and `style-src-elem` are nonce-strict in production; `style-src-attr 'unsafe-inline'` is retained for React inline `style={{...}}` props. `connect-src` whitelists `https://api.anthropic.com`.
- **SharePoint storage backend stubs** (`sp-json`, `sp-csv`). Surfaced as "Coming soon" in Settings; factory returns a stub that throws `StorageNotImplementedError("sharepoint-coming-soon")`. No MSAL/Graph SDK pulled in yet.

### Changed

- ADF (Atlassian Document Format) ↔ plain-text conversion extracted from the Jira proxy helpers into `src/app/adf.ts` so the client-side import/export paths can share it without dragging server-only code into the browser bundle.
- Hand-rolled STORE-method ZIP writer extracted from `export-ooxml.ts` into `src/app/zip.ts`.
- Version metadata (`APP_VERSION`, `APP_BUILD_DATE`, `APP_HIGHLIGHT_KEYS`) extracted from `version-menu.tsx` into a dedicated `src/app/version.ts`.
- `src/app/page.tsx` now `await connection()` so the CSP nonce attached at SSR matches the runtime middleware header.
- `next.config.ts` now only emits the static security headers (`X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`); the CSP moved out to `src/proxy.ts` because per-request nonces aren't supported in static `headers()`.
- All six workspace panels (Chat, Reports, Gantt, RAID, Resources, Activity) now load via `next/dynamic({ ssr: false })`; modals (`JiraConflictsModal`, `AbsenceEditModal`, `ShiftEditModal`) also dynamic-imported.

## [0.6.0] "Asimov" — 2026-05-15

May 2026 performance refactor. (Quoted from `src/app/version.ts`:
"0.6.0 captures the May 2026 performance refactor".)

### Changed

- **Lazy-loaded heavy modules**: OOXML export, German i18n dictionary, `date-holidays` (+ moment / moment-tz).
- **IndexedDB record-level storage** for tasks and RAID — saves diff per record against an in-memory baseline using reference equality; only changed records are written. One-time migration from legacy `localStorage` keys (`lop-app:tasks`, `lop-app:raid`).
- **Debounced search** (150 ms) with a precomputed lowercase task index; **column-width writes debounced 250 ms**.
- **Memoized RAID panel** (`React.memo` + stable `useCallback` handlers).
- **Conditional mount of Gantt and Reports tabs** instead of always-mounted.

## [0.5.0] "Clarke"

Prior feature-accretion milestone. (Quoted from `src/app/version.ts`:
"0.5.0 was the prior feature-accretion milestone".)

### Added

- Claude chat panel with tool calls for task CRUD.
- Voice commands via Web Speech API (English + German).
- Due-date notifications: banner, toast, and popup alerts.
- Reports tab.
- Labels and groups on tasks; bulk edit.
- Bidirectional Jira sync (pull + push) with conflict resolution.
- ADF (Atlassian Document Format) ↔ notes round-tripping.
- Resizable + collapsible workspace, resizable tasks table, header "+" task modal.

## [Unreleased]

_No unreleased changes._

[0.10.0]: # (no tag)
[0.9.0]: # (no tag)
[0.8.4]: # (no tag)
[0.8.3]: # (no tag)
[0.8.2]: # (no tag)
[0.8.1]: # (no tag)
[0.8.0]: # (no tag)
[0.7.9]: # (no tag)
[0.7.8]: # (no tag)
[0.7.7]: # (no tag)
[0.7.6]: # (no tag)
[0.7.5]: # (no tag)
[0.7.4]: # (no tag)
[0.7.3]: # (no tag)
[0.7.2]: # (no tag)
[0.7.1]: # (no tag)
[0.7.0]: # (no tag)
[0.6.0]: # (no tag)
[0.5.0]: # (no tag)
[Unreleased]: # (no tag)