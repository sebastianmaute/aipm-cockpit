# Rich text — note logs, register descriptions, sanitizers, export fidelity

Owns everything about the app's rich-HTML fields: the three note-log registers, the seven
rich entity fields, the DOM-free/browser-only module split, every write boundary a model
can reach, the per-sink `isHtmlStart` classifier, and how a rich column reaches each
exporter.

Does NOT own the documents feature (`docs/AGENTS/documents.md` + `AGENTS.md`'s "Documents"
bullet) or the AI wire layer (`docs/AGENTS/ai-assistant.md`). One fact, one doc.

★★★ **THE LANDMINES BELOW ARE NOT UNIFORM ACROSS THE THREE REGISTERS.** The same defect is
closed by a DIFFERENT mechanism in each — omit-the-field in tasks, carry-from-stored-row in
RAID, a dedicated `withStoredNoteLog` helper at three boundaries in changes — so copying one
register's fix to another is how two of them broke. Read the note that names your register.

- **Rich-text note log — THREE registers (Tasks + RAID 0.196.0 "Emrys"; Changes 0.245.0 "Buckell"):**
  dated note LOG on `Task.noteLog?` + `RaidItem.noteLog?` + `ChangeItem.noteLog?`
  (`NoteLogEntry[]` = `{id;authorResourceId?;authorName?;timestamp;editedAt?;html;text}`),
  surfaced by ONE shared draggable NON-modal floating CRUD window `notes-window.tsx` (+ `🗒 N` badge
  `notes-badge-button.tsx` on Open Points + RAID + Changes rows, "Notes (N)" button in all three
  editors). ★★ **THE LANDMINES BELOW ARE NOT UNIFORM ACROSS THE THREE** — each carries its own note
  saying which register it is about, and two of them (the save path, and the sanitizer that drops the
  field) are fixed by DIFFERENT mechanisms per register. Re-derive the population rather than trusting
  this line: `grep -cF 'noteLog?: NoteLogEntry[]' src/app/types.ts` → **3**, and
  `grep -rn "<NotesBadgeButton" src/app --include=*.tsx | grep -v "\.test\."` → three rows
  (`change-panel.tsx` · `raid-panel-rows.tsx` · `task-row.tsx`). The window is owned ABOVE every panel
  by `useNotesWindow`, which returns one opener per register
  (`grep -n "openTaskNotes\|openRaidNotes\|openChangeNotes" src/app/use-notes-window.ts`). Author =
  per-device `settings.selfResourceId` (honor-system, NO dropdown/auth); `canEditNote` gates edit/delete
  (`authorResourceId == null || === self`; edit CLAIMS an authorless note). Pure model in `note-log.ts`
  (`addNote`/`editNote`/`deleteNote` immutable; `sanitizeNoteLog`; `encodeNoteLog`/`decodeNoteLog`
  JSON-in-cell for CSV/MD/Turso — mirrors `document-link.ts`). Composer = the shared `RichTextEditor`
  (★ it took `variant="lean"` until the unify-rich-text slice; that prop is GONE along with `labels` —
  one editor, one toolbar, one schema everywhere)
  (`commitOnEnter`; note-editor.tsx folded in). Drag via shared `use-draggable-window.ts` (help-menu shares it).
  ★★ **`RichTextEditorHandle.appendText`** (`rich-text-editor.tsx`): Tiptap binds its `content` ONCE at mount,
  so a changed `value` prop cannot reach an already-mounted editor — dictation therefore appends imperatively
  via an `editorRef` (`useImperativeHandle`), not by pushing a new `value`.
  ★★★ **`appendText` SPLITS POSITION FROM FOCUS, and this line described the pre-split call from
  0.211.0 until 0.251.0.** It used to read `editor.chain().focus().insertContent(...)`, which inserts at the SELECTION —
  the doc START on an editor nobody has clicked into — so a dictated line PREPENDED on the live route while
  the lazy wrapper's replay (`{focus:false}` → `appendPos`) APPENDED, and which one a user got was decided by
  whether Tiptap's chunk had arrived. Today POSITION follows an `everFocused` ref (the caret once the user
  has been in this editor, otherwise `appendPos`, the end of the last textblock) and FOCUS follows
  `opts.focus`; the two are independent, and a REPLAY can only ever run at attach, where `everFocused` is
  still false — so both routes agree. `docs/open-followups.md` §192.
  ★★ THE REASON IS THE REPLAY'S TIMING, NOT THE LINE'S ORIGIN, and an earlier revision of this line got
  that wrong: it said a queued line "is by definition dictated before the editor existed", which is FALSE
  for the second way a line reaches the queue — a LIVE handle whose `appendText` returned false
  (`if (!handle || !handle.appendText(text, opts))` in `rich-text-editor-lazy.tsx`), by which point the
  user may well have focused. What holds instead is that `flushPending` has exactly ONE call site, inside
  `attach` — so a replay cannot happen at any other moment
  (`grep -rn "flushPending(" src --include=*.ts --include=*.tsx | grep -v "\.test\."` → the declaration
  and that one call, and nothing else).
  ★★ Either way `insertContent` MUST take a TEXT NODE object, never a bare string: a bare string is parsed
  as HTML, so dictated text containing `<`/`&` would be interpreted as markup instead of inserted literally.
  ★★★ **DO NOT WIRE `onAppendFinal` STRAIGHT TO `editorRef.current?.appendText(txt)`** — this line
  described exactly that as the pattern to copy from 0.211.0 until 0.250.0, and it is SILENT DATA LOSS. The mic is a
  SIBLING of the editor, so it paints and is operable while the editor is still loading; `appendText` is a
  no-op until Tiptap is live, and the `?.` swallows the miss with no throw and no toast. Render the editor
  from `rich-text-editor-lazy.tsx` (every consumer does) and append through ITS handle, which owns a queue
  and replays on arrival — see the `RichTextEditor` docstring there.
  ★★ **THAT QUEUE IS UNBOUNDED ON PURPOSE, AND REPORTS RATHER THAN DROPS.** A cap could only be enforced
  by discarding a transcript, which is the exact loss the queue exists to close — so the answer to "what
  if the chunk never arrives?" is a diagnostic, not a limit: one `warn` under the code
  `richText.appendQueueStalled` after `QUEUE_STALL_MS`, ONCE per mounted editor (re-arming would evict the
  rest of the capped ring), and NOT AT ALL when the editor unmounts first — a Cancel discards the queue
  deliberately, and reporting it would name the user's own decision as a defect. `rich-text-editor-lazy.stall.test.tsx`
  mocks the chunk to never resolve, which is the only place the LOSING side of that race is reachable;
  every other suite in the family wins it by a microtask.
  ★ The replay is the module-scope `flushPending(handle, queued, sink)` rather than a closure, so its THROW
  path is reachable with a fake handle instead of a rigged ProseMirror transaction. A throw re-queues the
  thrower AND everything behind it: the caller swaps the queue out of `pending` before calling (re-pushing
  into the array being iterated is an infinite loop, not a retry), so whatever the loop does not reach is
  unreachable by every later attach — one bad append used to discard every LATER one, silently.
  ★★ "Is the ref populated?" is the WRONG guard: `useImperativeHandle` has deps `[editor]` and `editor` is
  null on the first render, so React attaches a DEAD handle first — a populated ref whose appends vanish.
  The raw handle in `rich-text-editor.tsx` returns a boolean for that reason, and it has exactly ONE reader
  in the app: the wrapper. A consumer never sees it.
  ★★ `Task.notes` was RENAMED to `Task.description` (rich HTML) — NO back-compat decoder / NO runtime
  migration; Turso `COLUMN_RENAMES` `{from:"notes",to:"description"}` self-heals; historical notes folded into
  `noteLog` ONLY in the sample generator (Description starts empty); CSV task column renamed + goldens regen.
  RaidItem's `description?` is PRE-EXISTING (unrelated); other entities' `notes?` fields are untouched.
  ★★★ STORED-XSS defense-in-depth — noteLog `html` is `dangerouslySetInnerHTML`, guarded at THREE layers:
  (1) SINK re-sanitize `sanitizeRichHtml(html)` in `RichTextView` (idempotent; mirrors comm-send-preview/
  meeting-report); (2) `sanitizeNoteFields(entity)` (note-log.ts) at the WHOLE-OBJECT load boundaries that
  cast verbatim — `jsonToWorkspace` (file/sharepoint/local-file JSON) + IDB load (`browser-backend.ts`);
  CSV/MD/Turso route `noteLog` through `decodeNoteLog` — ★★ that covers `noteLog` ONLY, and reads as
  if it covered `description` too. It does not: NOTHING sanitizes the six rich DESCRIPTION fields on
  those three backends (see the rich-text bullet below; `docs/open-followups.md` §28). A NEW
  whole-object load path MUST call the `sanitize*RichFields` matching its entity, not just this one.
  ★★ The form must never write `noteLog` back: the log is WRITE-THROUGH and owns itself, so a draft
  that snapshots it at modal-open and spreads it over the live row on save silently destroys any note
  added while the editor was open (real data loss, fixed 0.209.0 — `use-task-submit.ts` deliberately
  omits `noteLog` from its payload). ★ 0.211.1 went further and removed the field from the DRAFT too:
  `emptyForm` carries no `noteLog`, so `TaskFormDraft` (a `ReturnType<typeof emptyForm>`) has no such
  key and there is nothing for a future writer to put back into `payload`. The unsaved-task fallback
  button shows NO count at all — a hardcoded `0` would be true only by WIRING (task-manager gates
  `taskNotePanel` on `editingId !== null`), not by construction. Re-adding the field is a typecheck
  error before it is a data-loss bug — keep it that way.
  ★★★ RAID HAD THE SAME DEFECT AND IT IS FIXED DIFFERENTLY — do not copy the task approach there.
  `raid-panel.tsx` seeds `useState<RaidItem | null>` with a full-row SNAPSHOT at edit-open, the notes
  window is owned ABOVE the panel (`task-manager.tsx` `openRaidNotes`) and commits write-through to the
  workspace `raid` array the snapshot never sees, and the save is a full row REPLACE — so open RAID
  editor → Notes → add a note → Save destroyed it (fixed 0.211.1, `docs/open-followups.md` §48).
  ★★ The task fix (OMIT the field from the payload) would be WORSE here: because the RAID save
  REPLACES the row, a payload without `noteLog` erases the log outright. `use-resource-planner.ts`
  instead builds `withStamp` with `noteLog` taken from the STORED row (`previous`), never the payload.
  ★★ It must land on `withStamp` and not only inside `setRaid` — `RAID_UNDO_GROUPS` is `[]`, so
  `changedFieldGroups` emits ONE capture PER changed key and a stale `noteLog` becomes undoable/
  redoable state. `NEVER_CAPTURE` is only `{id, localModifiedAt}`, so nothing else suppresses it.
  ★ The modal's `draft.noteLog?.length ?? 0` count still reads the stale snapshot, so it can
  under-report while the notes window is open. Cosmetic (the log itself is safe now) — left open.
  ★★ **CHANGES COPIED RAID'S SAVE FIX, NOT THE TASK ONE, AND THAT IS THE CORRECT CHOICE.** The change
  editor has the same shape as the RAID one — a full-row draft snapshotted at edit-open, a notes window
  owned above the panel (`openChangeNotes`), and a save that REPLACES the row — so omitting the field
  from the payload (the task fix) would ERASE the log rather than preserve it. `useChangeLog`
  (`use-change-log.ts`) therefore builds `withStamp` with `noteLog` taken from the STORED `previous`
  row, and only on an UPDATE: `grep -n "const withStamp" -A 6 src/app/use-change-log.ts` shows the
  `...(create ? {} : { noteLog: previous?.noteLog })` spread. ★ Unlike RAID, `CHANGE_UNDO_GROUPS` is
  NON-empty (`["status","decisionDate"]`), but the reason the carry must land on `withStamp` rather
  than inside `setChanges` is unchanged — `changedFieldGroups` still emits a capture per changed key
  outside that one group, so a stale `noteLog` would become undoable state.
  ★ The change modal's `draft.noteLog?.length ?? 0` count reads the edit-open snapshot and can
  under-report exactly as RAID's does; its own comment says so, and it is left open for the same reason.
  ★★★ **`sanitizeRaidItem` DROPS `noteLog` and CANNOT be taught to keep it.** It builds from an
  explicit field list, and `sanitizeNoteLog` → `sanitizeRichHtml` → DOMPurify is DOM-BOUND while the
  entity sanitizers must stay DOM-free (they run under bare node in the sample generator — same
  constraint as §36(a)). So ANY caller that sanitizes an EXISTING RAID row silently erases its log.
  `use-chat-dispatcher.ts` `updateRaid` did exactly that until 0.211.1 and every AI edit to a RAID item
  wiped its notes unrecoverably (no undo on AI writes) — it now re-applies the stored log after
  sanitizing (`docs/open-followups.md` §49). The other THREE callers are CREATES and safe. ★ A NEW
  `sanitizeRaidItem` call site must ask whether it holds a stored row; nothing gates this. ★★ Sweep on
  the BARE name — `ai-project-proposal.ts` passes the sanitizer by REFERENCE into `buildList`, so
  `grep 'sanitizeRaidItem('` misses it (that trap produced a wrong count here first time round, and it
  applies to any sanitizer used as a `.map`/`buildList` callback).
  ★★★ **`sanitizeChangeItem` HAS THE IDENTICAL HAZARD AND IS CLOSED BY A DIFFERENT MECHANISM — do NOT
  "complete the pattern" by copying RAID's.** It is DOM-free and built from an explicit field list too,
  so it drops the log the same way (`grep -c "noteLog" src/app/sanitize-records.ts` → **0**). But
  changes DO call their sanitizer at the decode and JSON boundaries where RAID does not, so the carry
  could not live in one save handler: it is the dedicated helper **`withStoredNoteLog`**
  (`change-log.ts`), applied at three sites — `buildChangeFromObj` (CSV + Markdown + both Turso
  layouts), `jsonToWorkspace`, and the AI dispatcher's `updateChange`. Sweep it with
  `grep -rn "withStoredNoteLog" src/app --include=*.ts --include=*.tsx | grep -v "\.test\."`.
  ★★ RAID's fix (take the log from the stored `previous` row inside the save handler) would not reach
  a decoder, and this helper would be wrong for RAID, which has no sanitizer call on those paths.
  ★★ SAME SWEEP TRAP, WORSE: `sanitizeChangeItem` is called at SIX sites and **TWO pass it BY
  REFERENCE** — `buildList` in `ai-project-proposal.ts` and `sanitizeArr` in `templates.ts` — so a
  call-shaped `sanitizeChangeItem(` grep sees FOUR of the six and reports its list as complete. Sweep
  the BARE name: `grep -rn sanitizeChangeItem src/app --include=*.ts --include=*.tsx | grep -v "\.test\."`
  (which also returns the imports, the declaration, and every source COMMENT naming it — including the
  copy of this same grep inside `withStoredNoteLog`'s docblock, i.e. the grep matching itself. It is
  scoped to `src/app`, so it does NOT return this file). ★ The three that do NOT carry a log are CREATES with
  nothing stored to lose; the full split, and why template import deliberately drops a captured log,
  live in `withStoredNoteLog`'s own docblock — read it rather than restating it here.
  ★★★ §50 IS CLOSED (0.247.0) AND THE FIX IS **TWO** MECHANISMS — do not "simplify" either away.
  A whole-row `capture()` undo used to restore a stale row, so undoing a BULK edit reverted the note
  log. Now: (1) the ENGINE BACKSTOP — `applyUndoRestoreWithRemap`, `applyUndoForward` and the
  `applyUndoRestore` wrapper each take a REQUIRED `preserve` list, fed `WRITE_THROUGH_FIELDS`
  (`noteLog`, `outlookEventId`), which copies those keys off the LIVE row and DELETES them when
  absent — an explicit `undefined` defeats `rowsEqual`'s redo identity guard; and (2) five PANEL
  bulk-edit sites moved from whole-row `capturePart` to `captureFieldPart`/`captureFieldRows`, so an
  undo reverts only the fields the apply actually wrote.
  ★★★ BOTH GUARD THE SAME FIELD, WHICH MAKES THE OBVIOUS TEST VACUOUS: delete the per-register
  mechanism and the engine backstop still preserves `noteLog`, so a per-register test passes over the
  defect it names. Mutate the per-register path specifically, and check the mutant actually landed.
  ★★ CHANGES INHERIT the same shape, and that is NEW with `ChangeItem.noteLog`: `useChangeLog`'s
  `captureBulkUndo` snapshots whole rows (`changes.filter((c) => ids.includes(c.id))`) into the same
  shared `capture()`, so the RAID sequence reproduces one register over —
  `grep -n "captureBulkUndo" -A 4 src/app/use-change-log.ts`.
  ★★ SSR landmine: `plainToHtml` must NOT run DOMPurify at module-eval (no DOM under Next SSR → 500) — it
  escapes `&<>` + wraps `<p>`/`<br>`, a provable no-op vs the sanitizer. ★ Enter-commit IME guard:
  `!event.isComposing && keyCode !== 229`. `use-notes-window.ts` = deps-object glue hook (coverage-excluded).
- **Rich-text register descriptions (0.209.0 "Lafferty"):** SIX more fields joined `Task.description`
  as rich HTML — RAID `description` + `mitigation`, Change `description` + `impactDescription` +
  `resolutionNotes`, Milestone `description`. Same `RichTextEditor`, same `sanitizeRichHtml`
  allow-list. ★★ This bullet said "same LEAN `RichTextEditor`, same `sanitizeNoteHtml`" until the
  unify-rich-text slice, and BOTH halves are now RETIRED symbols: there is no lean variant and no full
  one. `RichTextEditor` lost its `variant`/`labels` props and there is ONE editor, ONE toolbar
  (`rich-text-toolbar.tsx`) and one schema at every call site; `sanitizeRichHtml` is the one commit
  sanitizer. Do not reintroduce a per-surface variant — a surface needing less markup should RENDER
  less, not sanitize differently (that asymmetry WAS §137). ★ No version quoted deliberately: the
  change is committed but UNRELEASED, and naming the release it sits ON sends a reader chasing a
  changelog entry that describes something else.
  ★★ **THE TOOLBAR IS A NAMED `role="toolbar"`, AND THE NAME IS THE EDITOR'S OWN `label`.**
  `RichTextToolbar` renders TWENTY controls whose names repeat verbatim in every editor — eight marks
  (`MARKS`), five blocks (`BLOCKS`, task list joined it in §140), four alignments (`ALIGN`, also §140),
  Link, Unlink, and the heading menu trigger (an icon-triggered
  `PopoverPanel`, not a `<select>`, since the icon-only redesign) — and several surfaces
  mount editors as SIBLINGS in one form: `change-edit-modal.tsx` has three, `raid-edit-modal.tsx` two,
  `note-log-panel.tsx` two (composer + entry editor). An open change modal therefore carried three
  buttons named "Bold" and three more buttons named "Text style", with nothing tying one to the field it
  acts on (WCAG 2.4.6). The row wraps in a NAMED container — `role="toolbar"` + `aria-label` fed from
  that `label` — so the repeats are told apart by their container. ★ The ROLE was `group` until 0.236.0
  and is `toolbar` now; see the ★★★ note below for why the flip had to wait for the keyboard contract.
  ★★ NEITHER ROLE IS A LANDMARK and the containment argument does NOT rest on WCAG technique ARIA17,
  though an earlier revision of this line said both. `toolbar` and `group` are both ARIA `structure`
  roles, so neither appears in a landmarks rotor
  (`node -e 'const a=require("axe-core");console.log(a.commons.aria.getRoleType("toolbar"),
  a.commons.aria.getRoleType("group"))'` → `structure structure`), and ARIA17's Tests Procedure names
  only `group` and `radiogroup` — so the citation was valid in the `group` era and did NOT survive the
  flip. The disambiguation stands on its own: a named container is what AT announces around the
  repeats. ★ Both errors were introduced BY a correction that reached for a more general word to avoid
  naming the retired role — the sentence it replaced was accurate.
  ★★ NAMED OR ABSENT, never generic — a blank or missing `label` renders the bare div with NO role.
  An unnamed group announces a boundary carrying no information, and three sibling groups all called
  "Formatting" disambiguate nothing while making the code look fixed. Both branches are pinned.
  ★★★ `toolbar` NOW, AND `group` UNTIL 0.236.0 — the flip is the point, not the endpoint. The APG
  toolbar pattern is a KEYBOARD CONTRACT (one tab stop for the row, roving `tabindex`, Left/Right
  moving focus between controls), and until §144(a) this row honoured none of it, so it correctly
  declared `group`: a role whose interaction the widget does not implement tells an AT user to press
  arrow keys that do nothing, which is worse than declaring no role at all. **The refusal was right
  for as long as it stood, and it was not free** — it cost 15 tab stops per editor. §144(a) built the
  contract in `toolbar-roving.ts` plus the `tabIndex` wiring in `rich-text-toolbar.tsx`, so the role
  followed it. ★★ `rich-text-toolbar.test.tsx` used to pin `queryByRole("toolbar")` as NULL; it now
  pins the OPPOSITE, and a reader who remembers only the old rule will try to revert this. ★★★ The two
  must move together in BOTH directions: if the roving handler or the `tabIndex={-1}` wiring is ever
  removed, the role goes back to `group` in the SAME commit.
  ★★ THERE ARE TWO WAYS TO ADD A CONTROL AND ONLY ONE IS AUTOMATIC. A new `CONTROLS` entry needs
  nothing: `LINK_INDEX`/`UNLINK_INDEX` derive from `CONTROLS.length` DIRECTLY, and
  `TOOLBAR_CONTROL_COUNT` derives from `UNLINK_INDEX` — the count follows the indices, never the
  reverse — all pinned against the real DOM by a unit test that also pins the ORDER of the heading
  trigger and the two link controls. A HAND-WRITTEN JSX button (there are THREE — the heading trigger,
  Link and Unlink; the fourth `<ToolbarButton` site is the `CONTROLS.map`, so verify with
  `grep -n "<ToolbarButton" src/app/rich-text-toolbar.tsx` rather than trusting this count)
  joins the ARROW order automatically, since the handler re-queries `:scope > button` live, but NOT
  the `tabIndex` wiring, which is a per-control `activeIndex === <CONST> ? 0 : -1` you must add by
  hand. Miss it and the button stays natively tabbable — a SECOND tab stop, i.e. the exact defect
  §144(a) closed, reopened one control at a time. The control-count test catches it.
  ★ A control that renders `disabled` joins NEITHER order, since the engine has no skip-disabled
  logic (nothing in this row is ever disabled today, and a test pins that so adding one forces the
  decision).
  ★★ NO GATE CAN SEE THE COLLISION THIS FIXES, at any seed size — the a11y hard-constraint bullet above
  carries the measurement (axe 4.12.1: 105 rules, 69 under the four tags `e2e/a11y.spec.ts` requests,
  not one flagging two controls that share an accessible name; the only adjacent rule,
  `identical-links-same-purpose`, is links-only and `wcag2aaa`, which the spec never asks for). The
  MULTI-editor unit test is the only possible detector OF THE COLLISION — two controls sharing a name
  is not a property one editor has, so no single-editor fixture can express it at any assertion count.
  ★★ STATE THAT AS THE COLLISION, NOT AS "a single-editor fixture passes with the role deleted" — two
  successive revisions of this line said the latter and BOTH were false, the second measurably so.
  Deleting `role` + `aria-label` from the wrapper turns **5** tests red, THREE of them single-editor
  (`npx vitest run src/app/rich-text-toolbar.test.tsx --reporter=dot` after removing both attributes).
  That is a different mutation from the one the sentence is about: other tests pin the role ITSELF, so
  they fire on a single editor — including one made single-editor-sensitive by the very commit that
  wrote the false claim. A detector for "is the role there" is not a detector for "do two names
  collide", and conflating them is what made the sentence checkable and wrong.
  ★ WCAG 2.5.3 does NOT apply to any control in this row — every one is icon-only (`ariaLabel` carries
  the accessible name, `title` mirrors it as a hover tooltip; `ToolbarButton` also appends the on/off
  state to `title`, the DESCRIPTION), and 2.5.3 only constrains a control that HAS a visible label. This
  reverses an earlier version of this bullet, which said the opposite: that 2.5.3 held BY CONSTRUCTION
  because the visible text WAS the accessible name. That was true of the pre-icon-only toolbar and of
  the native `<select>` it has since replaced — the select itself already sat OUTSIDE 2.5.3 the same way
  these buttons now do, since it too carried an `aria-label` with no visible text to contain. The one
  place 2.5.3 still applies is the heading menu's ITEMS (`role="dialog"`, not the trigger) — those keep
  visible text ("Heading 2" etc.) as their accessible name, holding by construction the same way the old
  flat toolbar text used to. Worth stating because the gate cannot see a 2.5.3 violation either (same
  bullet above).
  ★★ EVERY BUTTON IN THE ROW SUPPRESSES THE MOUSEDOWN DEFAULT: a control that takes focus on mousedown
  blurs the contenteditable and destroys the selection the command applies to. `ToggleButton` carries an
  OPT-IN `preventFocusSteal` prop for its own 25 call sites; the rich-text toolbar's separate
  `ToolbarButton` (`rich-text-toolbar-button.tsx`) carries the identical opt-in prop for all twelve
  toggles PLUS Link/Unlink now — one mechanism, not the two hand-rolled ones (`ToggleButton` prop vs a
  plain `Button`'s manual `onMouseDown`+`preventDefault`) this used to describe.
  ★★ OPT-IN IS LOAD-BEARING: 25 other `<ToggleButton` call sites across 14 files rely on native
  focus-on-click, so an unconditional guard would change every toggle in the app. Both branches are
  pinned in `toggle-button.test.tsx`. Re-derive the population, don't trust the number:
  `grep -rn "<ToggleButton" src/app --include="*.tsx" | grep -v "\.test\." | grep -v rich-text-toolbar | wc -l`
  ★ The heading menu TRIGGER also gets no mousedown guard, but for a different reason than the
  `<select>` it replaced: opening a `PopoverPanel` is a normal click, not a native form-control picker,
  so there is no analogous "preventing default breaks the picker" failure mode to guard against. Neither
  the trigger nor the menu items call `.chain().focus()` — `setLevel` dropped that call in an earlier,
  unrelated commit (`2d99c125`) — since ProseMirror keeps its selection in editor state across a blur
  regardless of where DOM focus sits.
  THREE `rich-text-*` modules, split by ONE axis — whether the code may touch a DOM.
  (★ `ai-rich-text.ts` is a FOURTH rich-text module obeying the same axis, which is why
  [`docs/CODEMAPS/data.md`](docs/CODEMAPS/data.md) tabulates four; it is a model-write BOUNDARY
  rather than a projection, and is covered further down this bullet.)
  ★★ `html-start.ts` obeys the SAME axis and is **DOM-FREE** for the same reason — it is imported by
  `rich-text-plain.ts`, so it reaches the entity sanitizers and runs under bare node in the sample
  generator. It is not a `rich-text-*` module and is deliberately not counted above; it may IMPORT the
  tag arrays from `sanitize-html.ts` but must never CALL DOMPurify. Its own header carries the rule.
  • `rich-text-plain.ts` — **DOM-FREE**. `descriptionHtml` (upgrade), `htmlPlainProjection`,
  `htmlTextLength`, `capHtmlText`, `sanitizeRichText` (the entity sanitizers' entry point).
  • `rich-text-projection.ts` — **browser-only**. `descriptionText` (= projection ∘ `htmlToText` ∘
  upgrade) for every NON-DOM consumer, `descriptionTextWithBreaks` (the EXPORT projection), and
  `appendDictationToHtml`.
  • `rich-text-runs.ts` — **browser-only** (DOMParser). `htmlToRichLines`: HTML → styled runs, shared
  by `doc-render-docx.ts` + `doc-render-pptx.ts` so the two OOXML renderers cannot drift. ★ It serves
  DOCUMENTS, not the register fields this bullet is named for; it sits here because the DOM axis
  governs it, and moving it out would put a second copy of that axis in another file.
  ★★ **TWO projections, and the FLAT export paths use the SECOND one.** `descriptionText` COLLAPSES
  a block boundary to a space — right for search, AI digests and the inline-AI preview, wrong for an
  export a human reads, where a three-paragraph description arrived as one run-on line.
  `descriptionTextWithBreaks` keeps the boundary as `"\n"`; each flat renderer then maps that
  newline to its own primitive — one `<a:p>` per line (PPTX), and XLSX preserves it via
  `xml:space="preserve"` + `wrapText`. A new RENDERER that consumes the flat text must map the
  newline or it silently ships fused text.
  ★★★ **A RICH COLUMN IS NO LONGER FLATTENED IN `export-sections.ts` — it carries BOTH
  forms, and each renderer picks.** `richCell` emits `RichCell = { html; text }` (`ExportCell =
  string | number | RichCell`, guard `isRichCell`, flattener `cellText`) for the columns named by
  `TASK_RICH_COLUMNS` · `RAID_RICH_COLUMNS` · `MILESTONE_RICH_COLUMNS` · `CHANGE_RICH_COLUMNS`. The
  two structural consumers reach the html by DIFFERENT routes and conflating them sends you to the
  wrong file: DOCX parses it into styled runs (`ooxml-docx-primitives.ts` → `htmlToRichLines`),
  while the HTML/PDF path emits markup directly (`download.ts` `exportCellHtml` →
  `sanitizeRichHtml(descriptionHtml(…))`, no runs parse at all). XLSX (`export-xlsx.ts`) and BOTH
  PPTX paths (`export-pptx.ts`, `doc-render-pptx.ts`) read `.text` and are byte-identical to
  before. `RichLine`
  (`rich-text-runs.ts`) carries the structure that makes this renderable: `kind: "heading"` with
  `level` (h5/h6 CLAMPED to 4 — nothing declares a `Heading5`, and Word SILENTLY IGNORES a
  `w:pStyle` it cannot resolve), `kind: "li"` with `ordered`/`depth`/`index`/`task`, and `align` on
  every kind but `hr`. A new export column joins a `*_RICH_COLUMNS` set; a new RENDERER must decide
  which half it reads.
  ★★★ **A WRAPPED LIST ITEM IS SEVERAL `li` LINES, AND ONLY ONE OF THEM CARRIES A MARKER.** Anything
  after an item's first line — the text after a `<br>` (Shift+Enter, which StarterKit leaves on), a
  second `<p>` (Tiptap's `listItem` spec is `paragraph block*`, so it is schema-legal) — is an `li`
  line carrying the item's OWN `ordered`/`depth`/`index`/`task` plus `continuation: true`. A renderer
  keeps the indent (it derives from `depth`) and SUPPRESSES the marker. Before that field existed
  those lines restarted as bare `p` at zero indent — an unmarked, unindented orphan BETWEEN two
  bullets in a client-facing DOCX.
  ★★★ **"ONLY THE FIRST" IS THE WRONG SPELLING AND IT COST A SECOND DEFECT.** The marked line is the
  first `li` line the item PUT INTO THE OUTPUT, not the first one it opened. An item whose own line
  starts empty and is closed before any text arrives — Shift+Enter as the FIRST keystroke
  (`<ol><li><p><br>x</p></li>…`), a leading `<hr>`, a leading `<h2>` — has that line dropped by
  `flush` for holding no text, and the text then re-opens as a CONTINUATION, which BOTH `RichLine`
  renderers leave unmarked. (Not "every renderer", as this line said — the HTML/PDF export never
  builds a `RichLine` at all and lets the browser mark the list natively, which the ★ note near the
  end of this block records. Only two files suppress on the field:
  `grep -rn "!line.continuation" src/app --include=*.ts | grep -v "\.test\."` → `doc-render-pptx.ts`
  and `ooxml-docx-primitives.ts`.) The ordinal was spent regardless, so the list's first visible number was "2." with
  an unmarked line above it. `promoteItemHead` (`rich-text-runs.ts`) fixes it by scanning the span
  the LI arm already snapshots and promoting that first line back to a head — so a `continuation:
  true` seen MID-WALK is provisional, and a reader tracing the walk alone will conclude the marker is
  lost.
  ★★ **AND EVEN NOW IT IS NOT "one bullet per ITEM".** An item with no `li` line AT ITS OWN DEPTH has
  none to promote, so it renders NO marker while still spending its ordinal —
  `docs/open-followups.md` §157, which is §156 seen from the numbering side and has the same cause.
  Say "per item that put an `li` line AT ITS OWN DEPTH into the output".
  ★★★ **"EMITS ONLY LINES OF ANOTHER KIND" IS THE WRONG PREDICATE, AND THIS LINE SAID IT.** It is
  true of `<li><h2>h</h2></li>`, whose only output is a heading — and FALSE of `<li><ul>…</ul></li>`,
  whose output IS `li` lines. Those are the SUB-LIST's items, heads of their own one depth DEEPER,
  and what skips them is `promoteItemHead`'s `line.depth !== depth` filter, not any kind test. The
  branch's own test proves it — `<ol><li><ul><li>n</li></ul></li><li>b</li></ol>` yields `[1, 0]`
  then `[0, 1]` as `[depth, index]`, and the mapper that produced them emits an array only for a
  line of kind `"li"`, so BOTH are `li` lines. Reproduce:
  `grep -n "only content is a nested list" -A 9 src/app/rich-text-runs.test.ts`. Cover both shapes
  when you restate this: only-another-kind AND only-a-sub-list. A reader handed the kind spelling
  goes looking for a kind bug that is not there.
  ★★ **`bulletMarker` HAS FOUR PRODUCTION CALL SITES, NOT TWO**, and this line said two. The two in
  `doc-render-docx.ts` and `doc-render-pptx.ts` that read `block.items` take a `bullets`
  **`DocBlock`**, which has no `continuation` to guard on — no defect, but an under-counted call-site enumeration is the failure
  mode this file records elsewhere in the `sanitizeRaidItem` sweep, where passing the sanitizer by
  REFERENCE into `buildList` hid a call site from a bare-name grep and under-counted it. The sweep it used to attach
  (`grep -rn "continuation"` over the two files that already carry the guard) was scoped so it could
  only ever CONFIRM the sentence; a sweep that cannot fail is not a sweep. Use:
  `grep -rn "bulletMarker(" src/app --include=*.ts --include=*.tsx | grep -v "\.test\."`
  — **five** lines, the fifth being the `export function bulletMarker(` declaration itself.
  ★ `<blockquote>`, `<pre>` and `<hN>` inside an item deliberately KEEP
  their own kind rather than becoming continuations — a `<pre>` would trade its verbatim whitespace
  for an indent — so they lose the item's indent (`docs/open-followups.md` §156). ★★ A nested
  `<ul>`/`<ol>` clears `item` too, and it belongs in a different list: its items are produced by the
  LI arm at their OWN deeper depth, so nothing is lost. This is pinned — the test named "does not
  let a nested list inherit the outer item's continuation state" asserts depth 0 then depth 1, with
  the nested items NOT continuations
  (`grep -n "nested list inherit the outer item" -A 14 src/app/rich-text-runs.test.ts`).
  ★★ FOUR TAGS, THREE ARMS — this line said "a FOURTH arm" and there is no fourth. `<blockquote>`
  and `<pre>` share ONE arm through `NESTED_KIND_BY_TAG`, so the arms clearing `item` are, in source
  order, that shared one, then UL/OL, then the heading arm. The parenthetical it carried was right
  about the code comment (`rich-text-runs.ts`'s docblock does name all four TAGS) and wrong about
  the count of arms, and the nested list is the SECOND of the three, not the fourth of four.
  Reproduce: `grep -n "walk(el, marks, .*null" src/app/rich-text-runs.ts` returns three lines.
  ★★ The bespoke fixture string this line used to call "measured" —
  a nested `<ul>` inside an `<li><p>` — appears NOWHERE in the suite (`grep -c` on it returns 0), so
  nothing reproduced the word. The property is real and is pinned by the differently-shaped test
  cited above; quote THAT, not a string you typed into a doc.
  ★★ **AND THE ORDINAL IS SPENT WHEN THE ITEM RENDERED, NOT WHEN ITS OWN LINE SURVIVED.** An item
  whose only child renders under some OTHER line — an `<h2>` keeping its own kind, a nested list
  emitting its items one depth deeper — emits lines while its empty `li`
  line is dropped; the counter therefore watches whether the item put ANYTHING into the output, so
  `<ol><li><h2>H</h2></li><li><p>z</p></li></ol>` numbers `z` as **2**. It used to number it 1.
  ★★ **DO NOT JUSTIFY THAT WITH "a browser numbers it too" — the rule DISAGREES with a browser in
  the other direction and the justification proves too much.** An EMPTY `<li>` also occupies a
  numbered slot in every browser, and this counter deliberately does NOT count one:
  `<ol><li></li><li>a</li></ol>` numbers `a` as **1** where a browser says 2. Both halves are
  pinned (`grep -n "spent only on an item that reaches" -A 28 src/app/rich-text-runs.test.ts` — the
  window was `-A 20`, which stopped SHORT of the ordinal-spent assertion it was offered as proof of,
  so it showed the describe and two of the three tests and none of the claim). The
  real warrant is narrower — an item that put nothing in the output has no line for a reader to count
  from, so numbering past it would strand the number.
  ★ Consequence worth knowing before reporting a numbering bug: **the HTML/PDF export never touches
  `RichLine` at all.** `download.ts` `exportCellHtml` emits the markup and lets the browser number
  the list natively, so an empty `<li>` numbers DIFFERENTLY in the .docx and in the printed PDF of
  one document. Reproduce: `grep -n "htmlToRichLines" src/app/download.ts src/app/doc-render-html.ts`
  returns nothing.
  ★★★ **THE SPLIT IS "CARRY vs PARSE", and it is easy to break by "helpfully" parsing one level
  up.** `export-sections.ts` CARRIES the html as an opaque string and never parses it — every parse
  lives in the DOM-bound renderers, which is what lets one section model feed both the structural and
  the flat consumers. Keep the PARSE out of it and put it in the renderer instead.
  ★★★ THAT IS A RULE ABOUT PARSING, NOT A DOM-FREE RULE ABOUT THE MODULE, and this line used to say
  "Keep a `DOMParser`/DOMPurify call out of it" — false in the permissive direction, because a reader
  takes it as a constraint on what may be ADDED there. The module already reaches DOMPurify: `richCell`
  derives its flat half through `descriptionTextWithBreaks`, and that module's own header states it is
  browser-only for exactly that reason. Reproduce:
  `grep -n "rich-text-projection" src/app/export-sections.ts`.
  ★ Deliberately NOT justified here by "it would throw under bare node in the sample generator" —
  that rationale is measured FALSE about the generator (which installs a JSDOM before importing
  `src/app`) and is tracked as `docs/open-followups.md` §151, which counts the places still asserting
  it. The carry/parse split stands on the section model being shared, not on that mechanism.
  ★★ **CSV AND MARKDOWN ARE OUTSIDE ALL OF THE ABOVE, AND NOT FOR THE REASON THE FLAT/RICH SPLIT
  SUGGESTS.** `exportWorkspace` routes csv/md to `workspaceToCsv`/`workspaceToMarkdown` — the
  STORAGE serializers — and calls `buildExportSections` only for docx/xlsx/pptx/pdf. So CSV export
  never consumed the flat projection at ALL; it emits the STORED HTML, which is exactly what
  `golden-workspace.test.ts` pins. Reproduce:
  `grep -n 'workspaceToCsv\|buildExportSections' src/app/export.ts`.
  ★ PPTX being flat is a STATED gap with a layout cause, not an oversight — `buildPptxRowSlide`
  renders one slide per ROW and caps the meta lines, so three of the seven rich fields (including
  `Task.description`) never reach a slide at any markup fidelity. `docs/open-followups.md` §153.
  ★★★ The break mode is OPT-IN at THREE points and all three are required:
  `separateBlockBoundaries(html, "\n")`, `htmlToText(html, {preserveBreaks:true})` and
  `htmlPlainProjection(html, {preserveBreaks:true})`. The middle one is the easy miss —
  `htmlToText`'s default collapse is `\s+` → `" "`, which flattens the very newline
  `separateBlockBoundaries` just inserted, silently producing the collapsed form. Every default path
  is BYTE-IDENTICAL and pinned by hardcoded byte-stability suites, because `htmlPlainProjection`
  feeds `capHtmlText` → `sanitizeRichText` → all six backends. `separateBlockBoundaries`' `sep` is
  typed `" " | "\n"`, not `string`: it lands in a `String.replace` REPLACEMENT position where `` $` ``
  and `$&` are special.
  ★★★ `rich-text-plain.ts` MUST NEVER CALL DOMPurify. It runs inside the entity sanitizers, which
  execute under bare node in `scripts/generate-sample-workspace.ts` and the fixture flow; DOMPurify
  binds `window` at module-eval, so with no DOM `sanitize` is undefined, the call throws, and
  `jsonToWorkspace`'s catch-all swallows it into an EMPTY workspace that then "successfully" writes
  near-empty sample files. A comment-stripping source scan in its test enforces it — comments may
  name the library, code may not. IMPORTING `plainToHtml` is fine (only a CALL needs the DOM).
  ★★★ **EVERY WRITE BOUNDARY FOR A RICH FIELD MUST BE UPGRADE-AWARE — `sanitizeRichText`, never
  `plainToHtml`.** `plainToHtml` ESCAPES `& < >`, so an HTML value passed through it is stored as
  `<p>&lt;p&gt;&lt;strong&gt;…` — literal tags visible in the field, in every export and in the search
  index, permanently. RAID/change/milestone were always safe **from that CORRUPTION** — they route through
  their entity sanitizer → `sanitizeRichText` → `descriptionHtml`, which passes HTML through and upgrades
  plain text. ★★★ They were NEVER allow-listed, and reading this sentence as "those three need nothing" is
  plausibly WHY the model-write gap below took three review rounds to find. Two different properties:
  upgrade-vs-escape (corruption) and allow-list (what a model may store). Never let a claim about one read
  as a claim about the other.
  `Task.description` had FOUR plain-text-in boundaries, all fixed in 0.210.0 — `use-chat-dispatcher.ts`
  create + `update_task`, `ai-project-proposal.ts` (the model's `propose_project`, fed from an uploaded
  PDF / SharePoint file / Confluence page — the most attacker-influenceable input in the app), and
  `templates.ts` `sanitizeSeedTask`. ★ `grep -rn "plainToHtml(" src/app` is the sweep; the remaining hits
  (`action-task-seed.ts`, `jira-api.ts` via `adfToText`, `templates-builtin.ts`) are provably plain by
  construction. ★★ `sanitizeSeedTask` ALSO read the pre-0.196.0 `raw.notes` only, which was silent DATA
  LOSS: `templateFromWorkspace` captures real `Task` objects, so every captured description imported as
  `""`. It now reads `raw.description || raw.notes` — `||` not `??`, because a template carrying
  `description: ""` beside a legacy `notes` must fall back, and `??` only catches null/undefined. ★ `ai-project-proposal` keeps `raw.notes` on
  purpose — `PROPOSAL_TOOL`'s task schema advertises that key, so it is what the model is asked for.
  0.210.0 made the inline-AI route reachable by renaming the descriptor's dead
  `notes` to `description` (a task-description diff became possible) while the confirm path applies the
  model's VERBATIM `diff.raw` — which is HTML, because `scopeBlock` hands the model the stored HTML to
  read. ★ Precisely: the plain CHAT route was already reachable at base (the model reads a stored
  description through a read tool and echoes HTML back), so 0.210.0 added a second route and made a hit
  far likelier — it did not create reachability from nothing. THREE of the four boundaries go through
  **`sanitizeAiRichText`** (`ai-rich-text.ts`); chat and persisted insight-recommendation replay share two.
  ★★★ The FOURTH — `templates.ts` `sanitizeSeedTask` — deliberately does NOT, and CANNOT: that file is in
  `scripts/generate-sample-workspace.ts`'s import graph, so a DOMPurify call there throws under bare node
  and `jsonToWorkspace`'s catch-all writes near-empty sample files. Template import gets the upgrade but no
  allow-list — the same DOM-free CAUSE as the codec load paths (§28), recorded as its own item in
  `docs/open-followups.md` **§36(a)**, since §28 is scoped to the codecs and does not cover this boundary.
  Do not "complete the sweep" by importing the helper there; the guard bans it precisely so you cannot.
  ★★★ AND SO DO THE OTHER THREE ENTITIES, via `withAiRichFields(input, AI_RICH_FIELDS.<entity>)` at the
  six raid/change/milestone create+update sites. Their entity sanitizers (`sanitize-records.ts`) are
  DOM-FREE and therefore CANNOT run an allow-list — verified: `sanitizeRaidItem` stored
  `<script>alert(1)</script>` verbatim — so the model's value is cleaned BEFORE it reaches them. Fixing
  only `Task.description` (as 0.210.0 first did) left six model-writable rich fields unguarded while this
  very bullet claimed "EVERY write boundary". ★★ Apply it to the model's INPUT/PATCH, never to the merged
  entity: an update spreads the STORED value, and re-sanitizing that rewrites bytes the call never asked
  to touch. ★★ A field the model did not supply must be SKIPPED, not blanked — otherwise renaming a RAID
  item erases its stored description and mitigation. ★ A new rich field on an AI-writable entity goes in
  `AI_RICH_FIELDS` (a test pins each list, so adding one forces the decision).
  ★★★ That helper is TWO layers and both are load-bearing: `sanitizeRichText` (upgrade-aware, DOM-free,
  caps + drops-empty) THEN `sanitizeRichHtml` (the actual DOMPurify allow-list). Layer 1 alone CANNOT
  sanitize — it is DOM-free by contract and `descriptionHtml` passes HTML-shaped input through verbatim,
  so a model's `<script>` reached all six backends.
  ★★★ THIS PARAGRAPH USED TO DRAW A DISTINCTION THAT NO LONGER EXISTS, and the retraction is the
  point rather than the rename. It read "It is `sanitizeTemplateHtml`, **NOT** `sanitizeNoteHtml`, and
  the difference is DATA LOSS" — a choice between two sanitizers of different widths, turning on
  `KEEP_CONTENT:false`. **Both functions are DELETED and that policy is gone from the app.** There is
  ONE rich sanitizer, `sanitizeRichHtml`, at DOMPurify's DEFAULT `KEEP_CONTENT` — an unlisted tag
  UNWRAPS and keeps its words. So a model emitting `<div>`/`<table>` no longer loses the text inside
  them on any surface, and there is no second rich sanitizer to pick wrongly. ★★ Do not read the
  retraction as "the hazard is gone": what protected the words was the WIDTH-AND-POLICY PAIR, and the
  live rule is now `KEEP_CONTENT` itself — flipping it to `false` at ANY width re-creates §137. Losing
  formatting beats losing words; `sanitize-html.ts` carries that as a "do not flip this" note.
  ★ The helper lives in its OWN module because it calls DOMPurify — putting it in `rich-text-plain.ts`
  would break the DOM-free guarantee that module's guard exists to protect.
  ★★ THERE IS STILL A SECOND ALLOW-LIST, BUT THE DELTA IS **ONE TAG**, NOT NINE. Model-authored
  DOCUMENT paragraph HTML goes through `sanitizeAiDocumentRichText` → `sanitizeDocumentHtml`, and
  `DOCUMENT_ALLOWED_TAGS` is now literally `[...RICH_ALLOWED_TAGS, "img"]` — it SPREADS the rich list,
  so the two can no longer disagree about a heading level or `blockquote`. ★★★ The old measurement
  here is FALSIFIED, not merely restated: it cited `"<p>a</p><hr><p>b</p>"` → `"<p>a</p><p>b</p>"` as
  proof the narrow list ate `hr`. Re-measured 2026-08-11 on dompurify 3.4.13 against the two live
  arrays, that input is now **byte-identical through both** (`hr` is in `RICH_ALLOWED_TAGS`). The only
  input that still differs is an `img`, which is VOID and so vanishes outright rather than unwrapping:
  `'<p>a</p><img src="x.png"><p>b</p>'` → rich `"<p>a</p><p>b</p>"` · document keeps the element.
  ★★★ THE TAG DELTA IS ONE; THE BEHAVIOUR DELTA WAS THREE AND §140 CLOSED THE ONE THAT WIDENED. This line
  used to say "drops IMAGES and nothing else", then enumerated three differences with exactly one
  widening — that widening one no longer exists. It was: wiring a document boundary to
  `sanitizeAiRichText` newly ADMITTED arbitrary `data-*`, because `sanitizeRichHtml` kept DOMPurify's
  default `ALLOW_DATA_ATTR: true` while `sanitizeDocumentHtml` already set it `false`. §140 (2026-08-13)
  turned that default off on `sanitizeRichHtml` too, under the same `ATTR_VALUES` value allow-list
  `sanitizeDocumentHtml` already used. Measured on the current code: `sanitizeRichHtml('<p
  data-foo="1">a</p>')` → `<p>a</p>`, matching `sanitizeDocumentHtml(...)` → `<p>a</p>` — the row did not
  narrow, it is GONE.
  ★★★ TWO DIFFERENCES SURVIVE AND NEITHER WIDENS. Wiring a document boundary to `sanitizeAiRichText`
  (1) drops `<img>` — **NARROWS**; and (2) cuts the cap from `MAX_HTML_TEXT_CHARS` (20 000) to
  `TEXTAREA_MAX` (5 000) — **NARROWS, DESTRUCTIVELY**, because `capHtmlText`'s truncation branch returns
  `plainToHtml(text.slice(...))`, so exceeding it FLATTENS every mark to escaped plain text rather than
  merely shortening. Measured 2026-08-11 on dompurify 3.4.13 against the two live boundaries (unchanged
  by §140, re-verified on the current tree): `rich('<p>a</p><img src="x.png"><p>b</p>')` →
  `"<p>a</p><p>b</p>"` while doc keeps the element (the narrowing); and on a paragraph of 6 001 visible
  characters carrying a `<mark>`, rich returns a 5 007-character result with the `<mark>` GONE while doc
  returns a 6 021-character one with it intact (the destructive narrowing). ★ Those two BYTE counts are
  fixture-bound — they encode a `<mark>` of exactly two visible characters at the head of the paragraph,
  so a different mark length moves both. The DIRECTIONS are what the rule rests on, not the numbers.
  `ai-rich-text.ts`'s own header states both — it never enumerated the data-* row in the first place, so
  it needed no correction. ★ A third, NARROWER data-* difference remains and is not a revival of the
  closed row: `sanitizeDocumentHtml` additionally admits `data-asset-id` (§117b, a future images slice)
  under its own charset/length predicate, and `sanitizeRichHtml` does not carry that name at all —
  measured, `sanitizeRichHtml('<p data-asset-id="a1-B2">x</p>')` → `<p>x</p>`,
  `sanitizeDocumentHtml(...)` → keeps it. One bounded, value-guarded name is not the unconstrained
  pass-through the closed row described.
  ★ An earlier revision of this sentence said the pre-§140 claim was "false in the DANGEROUS direction,
  because two of the three differences WIDEN" — wrong in BOTH directions at once, and self-refuting,
  since it enumerated its own counter-examples in the next clause: cutting a cap is not a widening in any
  reading, and neither is dropping a tag. ★ The "nothing else" claim lived in exactly TWO
  places — this line and the `ai-rich-text.ts` row of [`docs/CODEMAPS/data.md`](docs/CODEMAPS/data.md) —
  and `811c952c` rewrote both in one change set. Reproduce:
  `git show f83f860f:docs/CODEMAPS/data.md | grep -c "drops IMAGES and nothing else"` → **1**, and the
  same grep over `git show f83f860f:AGENTS.md` → **1**.
  ★ `RICH_ALLOWED_TAGS` still guards the SEVEN rich entity fields (`Task.description` plus the six in
  `AI_RICH_FIELDS`) — but "keep it narrow" is no longer the reason to leave it alone. Widening it now
  widens DOCUMENTS in the same edit, retroactively, including how already-stored HTML renders. Details
  in [`docs/AGENTS/ai-assistant.md`](docs/AGENTS/ai-assistant.md).
  ★★ A model may send EITHER shape — never assume plain text just because the tool schema says "text".
  ★★ TEST AT THE WRITE, NOT THE TOOL CALL: the inline-AI tests spy on `runTool` and assert what reaches
  it, which is one hop short of this defect, and `descriptor-drift.test.ts` covers only the four
  sanitizer-backed entities — it says so — leaving the one entity without a `sanitizeRichText` boundary
  as the uncovered one. Three primed review rounds missed this; a COLD read found it.
  ★★ **MIGRATION IS READ-TIME, NOT WRITE-TIME.** Storage is not normalised by the decoders — they
  hand-build entities and never call the entity sanitizer (`buildRaidItemFromObj`,
  `buildMilestoneFromObj`). EVERY reader upgrades instead: `descriptionHtml` at a DOM boundary,
  `descriptionText` for search / AI digests / the inline-AI preview (the FLAT export paths use
  `descriptionTextWithBreaks`; the structural ones upgrade the html instead — see above). A project therefore
  holds BOTH shapes at once, and that is fine — but a new consumer that reads one of the six fields
  raw ships escaped markup or fused text. Grep the six names before adding a reader.
  ★★ The projection is REGEX, and both of its obvious spellings are wrong: `<[^>]*>` deletes a tag
  with nothing in its place (so `<p>a</p><p>b</p>` fused to `"ab"`, and every upgraded multi-line
  legacy value read as one word), and it is not the HTML tokenizer (a `<` NOT followed by an ASCII
  letter or `/` is literal text — `<p>cost < 5k</p>` projected to `"cost"`, and a value projecting to
  empty is DROPPED by `sanitizeRichText`'s empty rule). Block tags are replaced by a SPACE first;
  `&amp;` decodes LAST so `&amp;lt;` cannot double-decode. All three cost a data-integrity bug.
  ★★★ **"IS THIS STORED VALUE ALREADY HTML?" IS ANSWERED PER SINK** — `isHtmlStart(value, sink)` in
  `html-start.ts`, whose test each sink DERIVES from its own allow-list. THE RULE: never recognise
  LESS than your sink KEEPS (a narrower classifier escapes the WHOLE value, permanently). ★★ The old
  second half — "a WIDER one is worse where the sink DELETES, since `sanitizeNoteHtml` sets
  `KEEP_CONTENT: false`" — names a RETIRED sanitizer and has no referent: nothing in the app deletes
  content now, so
  the rule's only live direction is the one above. Keep the deletion clause in mind as the reason
  never to ADD a `KEEP_CONTENT:false` sanitizer, not as a description of one that exists.
  ★★★ **THREE derived sinks plus `render`, not five** — `SINK_TAGS` is `{rich, document, projection}`
  and `render` carries NO list because its consumers keep every tag's text. `rich` IS
  `RICH_ALLOWED_TAGS`; `document` and `projection` are `DOCUMENT_ALLOWED_TAGS`. The retired `note` and
  `template` sinks MERGED into `rich` — every entity call site now passes `"rich"`.
  `descriptionHtml` and `sanitizeRichText` REQUIRE the sink argument.
  One shared 8-tag constant served the FOUR DERIVED sinks of the time and structurally could not
  express the rule — §107 and §114 are the two defects that cost, both CLOSED 2026-08-10.
  ★★★ §137 IS NOW CLOSED TOO, and its trap is worth carrying because this file set it: the old text
  here warned "do not 'finish' it by widening the `note` sink", and mid-slice exactly that happened
  one file away — a 21-tag classifier was wired to an 8-tag `KEEP_CONTENT:false` sanitizer and the
  whole-object load path DELETED words on all seven rich fields, with the whole suite green. Widening
  a CLASSIFIER before its SINK converts an escape into a deletion. The durable guard is now the
  property test in `html-start.test.ts` (`kept(sanitizer) ⊆ recognised(sink)`, derived empirically on
  both sides), not this sentence — see §137. ★★ That shared constant did NOT serve
  EVERY sink, and an earlier revision here said it did: the render boundary had **no classifier at
  all** before the §107 branch, because the three document renderers did not call `descriptionHtml` —
  that composition was ADDED by `94b7fd21`, which is §118, and the sink it passes was narrowed to
  `render` afterwards. So the render sink is not a constant that drifted, it is a boundary that was
  missing. Reproduce against the PRE-§107 tree, where the now-RETIRED shared constant
  still existed — `git grep -n "HTML_START\." 528dd5fe -- src` returns exactly two
  call sites, `narrative-html.ts` and `rich-text-plain.ts` `descriptionHtml`, and neither is a
  renderer. ★ Both of those now pass `"rich"`; the per-sink names that revision used to gloss them
  (`note`/`template`) are retired, so the gloss is dropped rather than translated.
  ★★ The tag must actually CLOSE and be an OPENING tag. Accepting `"<li 3 items"` as HTML stored a
  value the counter measured at 11 while every reader rendered nothing. `html-start.ts` carries that
  reasoning, the `\b` guard against a short tag swallowing a longer one, and the residue it
  deliberately does not chase — read it before touching the regex, and do not restate it here.
  ★ Counters/caps measure VISIBLE TEXT (`htmlTextLength`), never `html.length`; `capHtmlText` backs a
  truncation off one code unit rather than splitting a surrogate pair (a lone surrogate is `U+FFFD`
  on CSV/MD but survives on JSON/IDB — a backend-dependent corruption). `clipText` in
  `sanitize-core.ts` carried that bug across ~49 plain-text call sites until 0.222.x, and now backs
  the cut off the same way — open-followups §22 is CLOSED. ★ It clamps a NEGATIVE `max` to `""` too,
  which is a distinct case from `0`: `slice(0, -1)` counts from the END and returns nearly the whole
  string, over cap and able to end on a lone surrogate itself.
  ★ Whole-object load boundaries (JSON + IDB) route the rich fields through `sanitizeNoteFields` /
  `sanitizeRaidRichFields` / `sanitizeChangeRichFields` / `sanitizeMilestoneRichFields` — escape
  BEFORE sanitize, or `KEEP_CONTENT:false` deletes tag-shaped plain text along with its content.
  ★ They are four ONE-ARGUMENT functions on purpose: every call site is `.map(fn)`, which passes the
  INDEX as the second argument, so a `(entity, fields)` signature would be fed `0, 1, 2…`, normalise
  nothing, and leave every `.map`-based test green.
