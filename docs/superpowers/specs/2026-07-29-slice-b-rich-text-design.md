# Slice B — rich-text descriptions + inline note log

_Opened 2026-07-29 against 0.208.0 "Yolen". Final slice of the UX batch roadmap
(`2026-07-27-ux-batch-roadmap-design.md`), taken out of order at the user's request: the locked
order is C → D → F → A → E → S6 → S7 → **B**, and S6's spec + plan are written but unstarted, so
S6/S7 now follow B._

★ This file is gitignored (`.gitignore:76:/docs/superpowers/`) — local-only by standing decision.
The cumulative close-out archive is the only backup.

---

## What slice B is

Three items from the original 18-item request:

1. RAID + milestone description → rich text.
2. "Description audit" — undefined in the roadmap; resolved with the user as **the consumer sweep
   plus converting Change as well**, then widened again to Change's two sibling fields and RAID's
   mitigation.
3. Task modal: render the note log inline.

**Final field scope — six fields:**

| Entity | Fields | Today |
|---|---|---|
| RAID | `description`, `mitigation` | `sanitizeMultiline(…, TEXTAREA_MAX)`, plain `Textarea` |
| Change | `description`, `impactDescription`, `resolutionNotes` | `sanitizeText(…, TEXTAREA_MAX)`, plain `Textarea` (`description` is required-`string`) |
| Milestone | `description` | `sanitizeText(…, TEXTAREA_MAX)`, plain `Textarea` |

★ Field ownership was misattributed during brainstorming and is corrected here: `mitigation` is
**RAID** (`types.ts:206`); `impactDescription` (`:320`) and `resolutionNotes` (`:327`) are
**ChangeItem**.

**Not in scope:** `ProjectMeta.description`, every `notes`/`note` field, `Task.description` (already
rich since 0.196.0 "Emrys").

**Zero** new persisted fields, **zero** new backend write paths, **no** `ENTITY_SPECS` or type-shape
changes. This is a content-shape change inside existing columns.

---

## Decisions taken (with the evidence that moved them)

| Fork | Decision |
|---|---|
| Audit scope | Consumer sweep **and** convert Change; later widened to all six fields |
| Migration of stored plain text | Upgrade **in the per-entity sanitizers** (option 1a), not on read |
| Length cap | Cap the **text**, keep the visible counter |
| Inline note log | Extract a shared panel, **full CRUD inline**, writing **through** to the workspace (4a) |
| Structure | One shared presentation module (approach A), not per-call-site helpers, not a persisted plain mirror |

### Why a shared module rather than inline helpers

The heuristic that decides "is this stored value already HTML" would otherwise be copy-pasted into
three sanitizers (`dup:check` is blocking) and every future consumer would have to remember the
projection. A persisted plain mirror field was rejected outright: six write paths, golden regen, and
two sources of truth that drift.

### Why 1a, and what it costs

1a normalises the in-memory value at the load boundary, so consumers may assume HTML and — usefully
— an AI tool call that writes plain text into `mitigation` is upgraded for free by the same
sanitizer, needing no change in `chat-tools.ts`.

Accepted costs, both certain:

- **Golden fixtures regenerate.** The sample workspace's raid/milestone/change values become
  `<p>…</p>` in five columns across CSV + Markdown. The diff must contain **only** those columns.
- **A one-time rewrite of live data.** Every description in an open project is rewritten in the
  stored bytes on the next autosave.

The alternative (1b, upgrade-on-read, the shipped `narrative-html.ts` pattern) leaves storage and
goldens untouched but requires every consumer to call the upgrade. It was presented with this
evidence and declined.

---

## Architecture

### Reuse, do not re-derive

R3 already solved this migration for the dashboard status narrative. `narrative-html.ts` holds:

- **`HTML_START = /^\s*<(p|br|strong|em|ul|ol|li|a)\b/i`** — the "already HTML" predicate. Its tag
  list is **exactly** `sanitize-html.ts`'s `NOTE_ALLOWED_TAGS` minus `#text`, and the file documents
  at length why `h1`-`h6`/`blockquote`/`div` were **removed**: `sanitizeNoteHtml` runs
  `KEEP_CONTENT: false`, so recognising a tag the sink strips deletes the element *and its text*.
  The `^\s*` anchor and `\b` terminator are what keep `"5 < 10 items"` and `"<3 open"` as plain text.
- **`narrativeToHtml(stored)`** — `HTML_START.test(s) ? s : plainToHtml(s)`.
- **`isNarrativeEmpty(html)`** — a **regex** tag-strip plus `&nbsp;` handling in all four spellings.

Slice B reuses `HTML_START` and this shape rather than minting a second heuristic. Whether the new
helpers live in a new `rich-text-plain.ts` or extend `narrative-html.ts` is a plan-time call; if a
new file, `HTML_START` is exported from one place and imported, never duplicated.

### ★★★ The DOM constraint that shapes the whole module

`narrative-html.ts` carries the rule in its header: **no DOMPurify in this layer.** DOMPurify needs
a DOM; under bare node — where the codecs run in `scripts/generate-sample-workspace.ts` and the
fixture regeneration — `DOMPurify.sanitize` returns `""`. Since 1a puts the upgrade **inside the
sanitizers**, which those scripts execute, two rules follow:

1. The upgrade is `HTML_START.test(s) ? s : plainToHtml(s)`. **No `sanitizeNoteHtml` call.**
   `plainToHtml` is deliberately DOM-free (it escapes `&<>` and adds only `<p>`/`<br>`, both in the
   allow-list, making a DOMPurify pass a provable no-op). Sanitisation is a **sink** concern —
   `RichTextView` re-sanitises on render.
2. The text-length cap must be **regex-based**, mirroring `isNarrativeEmpty`. Calling `htmlToText`
   (DOMPurify) from a sanitizer would measure `0` under node and truncate every value to nothing.

`htmlToText` remains the right tool for the browser-only consumers (search, export, AI digests).

### The module surface

| Export | Layer | Notes |
|---|---|---|
| `descriptionHtml(stored)` | **DOM-free** | The upgrade. Idempotent. Safe in sanitizers and node scripts. |
| `htmlTextLength(html)` | **DOM-free** | Regex tag-strip + entity decode (`&amp;`/`&lt;`/`&gt;`/`&nbsp;`), trimmed, `.length`. Drives the cap and the counter. |
| `capHtmlText(html, max)` | **DOM-free** | Over cap → project to text **with the same regex strip `htmlTextLength` uses** (never `htmlToText`), truncate, re-wrap via `plainToHtml`. Deterministic and always well-formed; formatting is lost only on overflow, which the editor-side counter prevents reaching in normal use. |
| `descriptionText(stored)` | **browser only** | `htmlToText(descriptionHtml(stored))` for search / export / AI digests / AI-plan previews. Never call from a codec or sanitizer. |
| `appendDictationToHtml(html, txt)` | **browser only** | `plainToHtml(appendDictation(htmlToText(html), txt))` — the task modal's existing expression, extracted so six fields share one implementation. |

### Sanitizer changes

`sanitizeRaidItem`, `sanitizeChangeItem`, `sanitizeMilestone` stop applying
`sanitizeText`/`sanitizeMultiline` to the six fields and instead apply
`capHtmlText(descriptionHtml(raw), TEXTAREA_MAX)`. `TEXTAREA_MAX` stays 5000, now measured in text
characters. Optional-vs-required typing is unchanged (empty → the field is omitted, exactly as
today; `Change.description` keeps its `""` default).

---

## Editors

Each of the six fields adopts the task modal's shape:

```tsx
<div onFocus={reg.onFocus} onBlur={reg.onBlur}>   {/* focus bubbles from the contenteditable */}
  <RichTextEditor variant="lean" value={draft.field ?? ""}
                  onChange={(html) => …} label={t(lang, "<fieldLabel>")} lang={lang} />
</div>
```

RAID gains 2 editors, Change 3, milestone 1.

- **Dictation** routes through the shared `appendDictationToHtml`; the task modal adopts it too, so
  there is one implementation rather than four (`dup:check`).
- **Counters** stay. `CharCounter` is fed the text length; the `describeTextCap` calls that drive
  `adj.track` in the RAID and Change modals switch to the HTML-aware cap.
- **Unchanged:** `isVisible(...)` / `MODAL_FIELDS` entries, modal layout, the modal heights pinned in
  slice E, `TEXTAREA_MAX`.

### ★ Known wart, carried forward deliberately

`appendDictationToHtml` round-trips through plain text, so **dictating into a field flattens any
bold/italic/list formatting already in it**. This is shipped behaviour on `Task.description` since
0.196.0. Fixing it needs per-utterance segment tracking (Web Speech fires `onFinal` repeatedly per
hold, and the append must join mid-utterance segments). Out of scope; record as a follow-up.

---

## Consumer audit

### Bugs the conversion introduces if missed

**★★★ `use-resource-planner.ts:889` — "create mitigation task".**

```ts
description: plainToHtml(item.mitigation ?? item.description ?? "")
```

Once `mitigation` is HTML, `plainToHtml` escapes it a second time and the generated task renders
literal `<p><strong>…` on screen. Must become `descriptionHtml(...)`, which passes HTML through and
wraps only legacy plain text. Silent, user-visible, and invisible to every existing test.

**★★ `inline-ai-edit/entity-descriptor.ts:109,121,132`** — `diffFields` for RAID, Change and
milestone contain all six fields. They drive the inline-AI **plan preview**, the before → after the
user approves, so a proposal would render raw markup in the confirm dialog. Project to text at the
descriptor/preview layer.

★ Observed while reading that file, **not** slice B scope: the **task** descriptor's `diffFields`
still lists `"notes"` (`:94`), the field renamed to `description` in 0.196.0. `descriptor-drift.test`
passes because `chat-tools.ts:288` still accepts `notes` as a write alias. Worth a follow-up — the
task preview is labelling a field by its dead name.

### The sweep

| Site | Change |
|---|---|
| `global-search.ts:121,130,136-137` | raid/change/milestone `description` → `descriptionText`, matching task at `:112` |
| `global-search.ts:122` | raid `mitigation` → `descriptionText` |
| `raid-panel.tsx:218-219` | search haystack (`description`, `mitigation`) → text |
| `change-panel.tsx:208` | search haystack → text |
| `task-manager.tsx:1702` | milestone digest: text **then** `.slice(ENTITY_DIGEST_TEXT_CAP)` |
| `task-manager.tsx:1723` | RAID mitigation digest: same |
| `export-sections.ts:76-97` | raid/milestone/change rows map the five description-family columns through `descriptionText` |
| `list_raid` (chat dispatcher) | verify the payload's description/mitigation shape; text form for the model |
| CSV / MD / Turso / JSON / IDB codecs | **untouched** — HTML round-trips verbatim |
| `chat-tools.ts` RAID/Change patches | **no change** — plain text from the model is upgraded by the sanitizer |
| `templates-builtin.ts:237` | plain seed string, upgraded on load. No edit |
| `modal-fields.ts`, `markdown-columns.ts` | labels and visibility only |

★★ The export transform belongs in the **export section builders**, never in `*FieldToString` — that
function is shared with CSV *storage*, where the HTML must survive byte-for-byte. CSV *export* and
CSV *storage* are different callers of the same codec.

### Rendering

No panel or report displays these six fields outside the edit modals today, so the slice adds **no
new `dangerouslySetInnerHTML` sink**. Any future display uses `RichTextView` (which re-sanitises at
the sink), never raw HTML.

★ `htmlToText` collapses all whitespace (`\s+ → " "`), so a multi-paragraph description exports as a
single line. Already true for tasks. Accepted; a break-preserving variant is a follow-up.

---

## Inline note log

Extract the `NotesWindow` body into a presentational **`NoteLogPanel`** — entry list, composer,
inline-edit row — taking data and handlers as props and owning no state beyond the composer draft.
Two mounts:

- `notes-window.tsx` keeps its drag / resize / position / close chrome and renders the panel inside
  it. The **row badge** path (tasks table, Kanban card, RAID rows) is behaviourally unchanged.
- `TaskFormModal` renders the panel in a `<details>` section, collapsed by default, with its own
  scroller. The existing "Notes (N)" button becomes that disclosure's summary rather than a launcher.

**Writes go straight through to the workspace (4a)** — the same `setTasks(prev => …)` +
`localModifiedAt` + per-note activity kinds the floating window already uses. A note added from the
modal therefore survives Cancel, which is correct for an append-only journal and keeps one write
path and one activity trail. The section is **disabled for an unsaved new task** (no id to write
to), matching what the button does today. 4b (notes into the modal draft) was presented and
declined; it would have bought pre-save notes at the price of a second write path plus a note-diff
on save.

★ Both surfaces can be open for one task simultaneously; they share state, so they stay in sync. The
two get **distinguishable accessible names** — axe cannot see duplicate names, which is exactly how
slice C shipped two "Clear" buttons on one scanned view.

★ The task modal is `h-[900px]`; a collapsed `<details>` adds one row, so no height retune. Expanded,
the panel scrolls inside its own box.

---

## Testing

| Claim | Test | Falsified by |
|---|---|---|
| Legacy plain upgrades losslessly | `"cost < 5k & rising"` → `<p>cost &lt; 5k &amp; rising</p>` | dropping the escape |
| A stray `<` stays plain | `"5 < 10 items"`, `"<3 open"` unchanged in meaning | loosening `HTML_START` |
| Inline-led HTML is recognised | `"<strong>lead</strong> rest"` passes through | anchoring on block tags only |
| Upgrade is idempotent | `upgrade(upgrade(x)) === upgrade(x)` | it runs on every load |
| Cap counts text, not markup | a list at 4990 text chars is accepted whole | measuring the HTML string |
| Cap output is well-formed | over-cap value has no severed tag | naive `.slice()` on HTML |
| **The module is DOM-free** | guard: no DOMPurify import in the DOM-free half; **and** `npx vite-node scripts/generate-sample-workspace.ts` regenerates with descriptions intact | a sanitize call in the upgrade |
| Search indexes text | seed HTML; `"p"` finds nothing, the words find it | indexing raw |
| Export cells are text | no `<` in raid/milestone/change section rows | transforming the codec instead |
| **Mitigation→task doesn't double-escape** | seed HTML `mitigation`, create the task, assert `description` equals it | restoring `plainToHtml` (mutation-check) |
| AI digests carry text | milestone + RAID digest lines have no markup | slicing HTML |
| Inline-AI preview shows text | diff rows for the six fields carry no markup | |
| **The note panel writes** | add a note from the modal section → the workspace changed | removing the write (slice C's lesson: the write direction is what nobody tests) |
| The modal section is reachable | `userEvent.tab()` — never `.focus()`, which succeeds on `tabIndex={-1}` | |

★★ Per slice C: **assert the headline claim first** and **read which assertion failed**. A mutation
test that goes red on a weaker preceding assertion proves nothing about the claim the test is named
for.

---

## Gates and release

- **`dup:check`** — extract `NoteLogPanel` and `appendDictationToHtml` *before* the second consumer;
  six near-identical editor blocks and two note surfaces are exactly what trips it.
- **Coverage** — the new pure `.ts` is coverage-gated. It gets real tests, not a `coverage.exclude`
  entry (that is only legitimate for UI glue hooks).
- **Goldens** — regenerate; the diff must be confined to the five description-family columns.
- **Axe** — RAID, Milestones and Open Points are scanned, but every modal is shut at scan time, so
  the editors and the note section are unit + eye verified. `A11Y_VIEWS` is unchanged.
- **i18n** — any new EN string needs its DE twin; patch `i18n.de.ts` with a node utf8 write (CRLF
  file, the Edit tool corrupts umlauts), then grep-verify.
- **Release chain** — bump `version.ts` (APP_VERSION + milestone), add the `CHANGELOG.md` entry,
  append the `versionHighlight*` key to `APP_HIGHLIGHT_KEYS` with EN + DE. Grep the codename against
  `CHANGELOG.md` **with quotes** — ~230 are taken and slice E nearly shipped a misspelled collision.
- **Close-out archive** — merge **all** prior `_archive-*.zip` newest-first into
  `_archive-slice-docs-2026-07-29.zip` and assert the superset property before trusting it.
  `sorted(glob)[-1]` picks the wrong file (`-` = 0x2D sorts before `.` = 0x2E).

**Known CI flake:** a red `timelog-panel.test.tsx` at ~5 s is the third occurrence of a
load-dependent `asyncUtilTimeout`, not a regression. Confirm which test failed and that the rest of
the suite is green, then retry the job.

---

## Risks

| Risk | Mitigation |
|---|---|
| A sanitize call sneaks into the DOM-free path and wipes fixtures under node | Import guard test + the real regeneration run |
| The one-time rewrite of live data lands unnoticed | Expected and accepted under 1a; goldens make the shape visible in review |
| A consumer is missed and ships raw markup | The sweep table above is the checklist; grep `\.description\b`, `mitigation`, `impactDescription`, `resolutionNotes` at review time |
| `HTML_START` drifts from `NOTE_ALLOWED_TAGS` | Single exported constant; the alignment rule is documented in `narrative-html.ts` and must not be re-derived |
| The RAID/Change modals grow past the ratchet | Both are already split (`raid-edit-fields.tsx`); check `size:check` after the editor swaps |

## Out of scope

`ProjectMeta.description`; all `notes`/`note` fields; the dictation-flattening wart; a
break-preserving `htmlToText`; the stale `"notes"` entry in the task inline-AI descriptor; S6/S7,
which follow this slice.
