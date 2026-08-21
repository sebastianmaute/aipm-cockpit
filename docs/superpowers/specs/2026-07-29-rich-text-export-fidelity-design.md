# 0.210.0 "Larbalestier" — rich-text export fidelity + projection correctness

_Design, 2026-07-29. Closes nine of the twelve items in `docs/open-followups.md` §16–27._

## Scope

**In:** §17, §18, §19, §20, §23, §24, §25, §26, §27.

**Forked out, staying open in the register:**

| item | why it is not here |
|---|---|
| §16 dictation flattens rich formatting | needs per-utterance segment tracking — its own design, not a fix |
| §21 eye verification owed | manual/visual, no code change; stays owed |
| §22 `clipText` splits a surrogate pair | moves golden fixtures; the register explicitly warns against burying a fixture change under an unrelated commit |

**Also excluded, deliberately:** retiring `form.noteLog` dead state (the ★ under §27). It touches
`emptyForm()` and every fixture constructing a `TaskFormDraft`; the register calls it its own change
and that is right.

**Version bump required.** §17 and §18 change user-visible export output, so `src/app/version.ts`
(`APP_VERSION` + `APP_MILESTONE`), a `CHANGELOG.md` entry, and an `APP_HIGHLIGHT_KEYS` entry with
EN/DE strings.

---

## Group A — export fidelity (§17 + §18)

The largest piece. §17 as written in the register ("add a break-preserving variant, use it in the
export builders") is **incomplete**: a raw `\n` is whitespace to every one of the four renderers, so
the projection change alone is invisible. Both halves ship together or neither does.

### A1. Break-preserving projection

`rich-text-plain.ts` gains an **opt-in** break mode. Default behaviour stays byte-identical, because
this module feeds `capHtmlText` → `sanitizeRichText` → storage.

```
separateBlockBoundaries(html, sep = " ")
htmlPlainProjection(html, opts?: { preserveBreaks?: boolean })
```

In break mode:

- block boundaries become `\n` instead of `" "`,
- a whitespace run **containing** a newline collapses to a single `\n`,
- a purely horizontal whitespace run still collapses to a single `" "`.

So `<p>a</p><p>b</p>` → `"a\nb"` — **one** break, not two, because the collapse absorbs the
close-tag and open-tag boundaries into one. The paragraph-vs-`<br>` distinction is **not**
preserved; this is a plain-text projection, not a format. That is a deliberate limit, recorded so
nobody later reads a single `\n` as a bug.

★ The parameter lives here rather than in a second module because `rich-text-plain.ts` owns
`BLOCK_TAG` and its own comment says a second copy would drift.

★★ **Byte-stability is the acceptance criterion, not a hope.** A test must assert that
`htmlPlainProjection(x)` with no options is character-identical to today for a fixture set covering
every branch (block tags, inline tags, nbsp spellings, all five entity decodes, control characters).
`capHtmlText` and `sanitizeRichText` must not change at all.

`rich-text-projection.ts` exports the browser-side wrapper:

```
descriptionTextWithBreaks(stored) =
  htmlPlainProjection(htmlToText(separateBlockBoundaries(descriptionHtml(stored), "\n")), { preserveBreaks: true })
```

★ `htmlToText` runs DOMPurify with `ALLOWED_TAGS: []`, which deletes tags leaving nothing behind — so
`separateBlockBoundaries` must run **first** here exactly as it does in `descriptionText`. The
newline has to be in the string before DOMPurify sees it.

### A2. Export sections

`export-sections.ts`:

- `richCell` switches from `descriptionText` to `descriptionTextWithBreaks`.
- New `TASK_RICH_COLUMNS: ReadonlySet<string> = new Set(["description"])`, and `tasksSection` routes
  its cells through `richCell`. **This is the whole of §18** — the tasks section is the one section
  that still emits `Task.description` verbatim, so a PDF or DOCX export shows `<p>` markup.

★ `export-sections.test.ts` already pins each rich-column set as a subset of its `*_CSV_COLUMNS`
list. The new task set must join that assertion, or a misspelled column silently never matches and
the fix is absent with nothing noticing.

### A3. Renderers

Each of the four turns the newline into its own break.

| file | change |
|---|---|
| `export.ts` `renderSectionHtml` | `xmlEscape`/HTML-escape **first**, then substitute `\n` → `<br>` |
| `export-docx.ts` `buildDocxTable` | split the cell on `\n`; join with `<w:br/>` between `<w:t xml:space="preserve">` runs |
| `export-xlsx.ts` | keep the `\n` in the shared string; add `wrapText` to the cell style so Excel renders it |
| `export-pptx.ts` | split the cell into multiple `<a:p>` paragraphs |

★★ **Escape-then-substitute is load-bearing in `renderSectionHtml`.** Substituting first means the
`<br>` we inserted gets escaped into visible text; escaping a value that already contains a raw `<br>`
from user content is the whole point of escaping. Order it wrong in either direction and the result
is either a visible `&lt;br&gt;` or an injection hole.

★ `export-xlsx.ts` currently has no per-cell style plumbing for this; if adding `wrapText` requires a
new style entry in `styles.xml`, that is part of this task, not a reason to skip the format.

### A4. Open verification, must be answered in the plan

Confirm **nothing writes an `ExportSection` cell into a CSV**. `export-sections.ts:80` states that
CSV *storage* and CSV *export* are different callers of the same field-to-string helper and that the
projection belongs in export-sections — which implies the storage codec is unaffected. If an
export-side CSV writer exists, a raw `\n` in a cell must be quoted, and that is a fifth renderer
change.

---

## Group B — projection correctness (§23 + §24)

### B1. §23 — five consumers still fuse block boundaries

Swap `htmlToText(x)` for `descriptionText(x)`, one import per site. All five verified 2026-07-29:

| site | current call |
|---|---|
| `workspace-context.tsx:235` | `htmlToText(t.description)` — tasks-pane search index |
| `gantt.tsx:251` | `htmlToText(task.description ?? "")` — gantt search |
| `task-row.tsx:581` | `htmlToText(task.description)` — row preview |
| `task-dedup/dedup.ts:62` | `htmlToText(tk.description)` — AI dedup digest |
| `jira-api.ts:263` | `textToAdf(htmlToText(task.description ?? ""))` — Jira **push** |

Two outcomes worth naming in the changelog: the tasks pane stops disagreeing with global search on a
two-paragraph description (pane matched `"delayMitigation"`, global matched `"delay Mitigation"`), and
`jira-api.ts` is a **write** — fused text currently lands in a system where the app is no longer the
system of record.

★ Confirm each site is DOM-safe before touching it. `descriptionText` calls DOMPurify, so it must
never be reachable from a codec, an entity sanitizer, or `scripts/`. All five are believed
browser-side; check rather than assume — that constraint is the entire reason `rich-text-plain.ts`
exists.

★ **Do not touch these four** — they are correct: `note-log-panel.tsx:152`, `note-log-panel.tsx:168`
and `note-log.ts:74` operate on note HTML, not descriptions; `rich-text-projection.ts:31` is the
wrapped call itself.

★ This does **not** fix §17 for these sites. They gain the boundary space and keep the flattening,
exactly like every other consumer.

### B2. §24 — numeric entity references

`htmlPlainProjection` decodes a deliberately small named set. Everything else stays literal, so the
counter and cap **over-charge** a value carrying `&mdash;`/`&hellip;`, and truncation can land
**mid-entity** — the broken-entity hazard `capHtmlText` is otherwise immune to.

Add a generic numeric decode — `&#x([0-9a-f]+);` and `&#(\d+);` — after the tag work and before the
named decodes.

★★ **Ordering hazard the register does not name.** `&#38;` *is* `&`. A naive numeric-first pass turns
`&#38;lt;` into `&lt;`, which the named pass then decodes to `<` — reintroducing exactly the
double-decode that `&amp;`-last exists to prevent, and re-introducing a tag opener after the tag work
has already run. **The numeric decode must refuse to emit `&`, `<` or `>`**, leaving those references
as literal text. Assert all three with a test.

★★ **Storage reach.** This moves `htmlTextLength`, therefore `capHtmlText`'s cut point, therefore
stored bytes for an entity-carrying over-cap value. The six rich fields are empty in the sample
workspace, so goldens are expected not to move — **prove it by running `golden-workspace.test`, do
not assume it.** If they do move, that is a signal to fork §24 out alongside §22, not to regenerate.

★ Only the DOM-free path is affected. `descriptionText` runs DOMPurify first, which normalises
references to characters before the projection sees them. This closes a divergence between the two
projections, in which the DOM-free half is the approximate one.

★ Not reachable from the lean editor (Tiptap emits characters). Reachable by paste from Word/Outlook,
an imported workspace, or an AI tool writing HTML. Named references beyond the current set are a
longer tail and stay out of scope; the numeric forms are what Office paste actually produces.

---

## Group C — seams, guards, small (§19, §20, §25, §26, §27)

### C1. §20 — make `applied` observable

In `inline-ai-edit/plan.ts`, `applied` is a function-local `Record<string, string>` (line 98) feeding
incremental enum validation (line 115) and `effective` (line 124). The **preview** value is projected
to text; the **applied** value must stay RAW, or confirming an inline-AI edit writes projected text
over the user's formatting. Correct today, load-bearing, and unobservable — mutation-verified:
projecting `applied` alongside the preview fails nothing in the suite.

Return the raw value alongside each planned update so a test can reach it.

★★ **The test asserts the RAW value survives.** A test that re-asserts the preview is projected is
what passes with the bug present. Prove the new test fails when `applied` is projected.

### C2. §25 — guard the import surface, not the symbol names

`rich-text-plain.test.ts` currently strips comments and scans that file's own code for `dompurify`,
`htmlToText`, `sanitizeNoteHtml`, `sanitizeTemplateHtml`. Good guard, two holes: `plainToHtml`
growing a `DOMPurify.sanitize` call passes it, and a future
`import { descriptionText } from "./rich-text-projection"` passes every assertion while pulling
DOMPurify in.

Replace with an import-surface pin: assert the file's `from "…"` specifiers are exactly
`["./sanitize-html", "./narrative-html"]`. A new import then has to be added to the guard
deliberately, which is the point of having one.

★ Add the reverse sweep too, which nothing covers today: no file matching `sanitize*.ts`,
`*-codecs*.ts`, or under `scripts/` may import `rich-text-projection`. The tree is clean now —
`export-sections.ts` is the only new importer and it is reached only from `export.ts` — so the sweep
lands green and stays as a ratchet.

★ Keep the existing companion assertion that proves the comment-strip itself works, so the bans
cannot pass vacuously on an empty string.

### C3. §26 — Enter-submit counts a truncation it does not apply

Five plain-text fields kept the pre-`47e139bf` shape: an `onBlur` handler that caps, plus an
`adj.track(describeTextCap(...))` in `handleSubmit` that only counts. Clicking Save is fine —
mousedown blurs first. **Enter inside a text input submits without firing blur**, so the value is
uncapped, `adj.track` counts a truncation, the toast announces it, and the uncapped value is saved.

Affected: `raid-edit-modal.tsx` (`title`, `owner`) and `change-edit-modal.tsx` (`title`,
`requestedBy`, `decisionBy`).

Route them through the same `saved` object the rich fields use, so the counted adjustment is the
applied one.

★★ **The test must submit via Enter**, not via a click on Save — a click passes with the bug present.

★ Bounded severity: `sanitizeText` caps on the next load, so nothing beyond the cap persists
long-term. This is a correctness/honesty fix, not a data-loss fix.

★ Update the comment `47e139bf` added. It currently blesses the arrangement as safe ("count-only and
the value is deliberately discarded") without naming the Enter gap.

### C4. §19 — descriptor names a dead field

`inline-ai-edit/entity-descriptor.ts:94` lists `"notes"` in `INLINE_DESCRIPTORS.task.diffFields`.
That field was renamed to `description` in 0.196.0. Rename the entry.

**Decision, closing the register's open question: KEEP the `chat-tools.ts:288` alias.** It accepts
`notes` as a write alias for `description`. Persisted insight `recommendation.proposedCalls` can
carry a `notes` key from a proposal generated before this change, and those are replayed verbatim
through `runTool` at apply time — retiring the alias would break replay of a stored recommendation.
Record that reason at the alias, so it is not read as dead code and removed later.

### C5. §27 — three claims that are not quite true

Two are comment corrections. One is **actually a code change**, despite the register filing §27 as
doc-only:

1. **`capHtmlText`'s doc comment** promises formatting is "lost only on overflow, which the
   editor-side counter warns about first". `milestone-edit-modal.tsx` has no `CharCounter`, no
   `describeTextCap` and no `useAdjustmentTracker` — a >5000-character milestone description loses
   all markup silently. The trade-off is accepted at that call site; the **shared** comment must stop
   promising a counter only two of the three modals have.

2. **`separateBlockBoundaries`' safety rationale** is right for the wrong reason. It argues safety
   from "only removes p/div/br/li/… — never a script/style tag". What actually makes it safe is that
   its sole consumer is `htmlToText`, which strips **all** tags. Deleting a `<p>` mid-token can
   re-splice surrounding markup (`<a hre<p>f="…">` → `<a hre f="…">`), harmless only because no tag
   survives. Restate as: **safe only in front of a strip-everything pass.** This matters more after
   Group A, which adds a second caller of the same function.

3. **Code change:** `CharCounter` is fed `htmlPlainProjection(draft.field ?? "")` (raw) while
   `capRich` measures `htmlPlainProjection(descriptionHtml(draft.field))` (upgraded). Identical for
   every value reachable today; they diverge wherever `descriptionHtml` is not the identity — a
   legacy plain value containing literal `<b>` text counts 4 by the counter and 11 by the cap. Pass
   `descriptionHtml(...)` to the counter too, making the drift structurally impossible.

---

## Testing

Each item names its own anti-vacuity condition above. Beyond those:

- **Byte-stability suite** for the default `htmlPlainProjection` path (A1) — the acceptance gate for
  the whole of Group A.
- **`golden-workspace.test` must pass unchanged** after §24. Movement is a stop signal, not a
  regeneration trigger.
- Every new test must be **proved to fail** against the unfixed code before it counts. Three items
  here (§20, §24, §26) have a documented shape where the obvious test passes with the bug present.

## Gates

`npx tsc --noEmit` · `npm run lint` (`--max-warnings=0`) · `npm run test:run` ·
`npm run test:coverage` (floors are blocking) · `npm run dup:check` · `npm run size:check` ·
`golden-workspace.test` · axe on **RAID** and **Changes** (both in `A11Y_VIEWS`; §26 and §27's
counter change touch their edit modals).

★ Run `npx tsc --noEmit` after editing any test — `next build` does not typecheck `*.test.tsx` and
vitest never typechecks.

## Release

`src/app/version.ts` → `APP_VERSION = "0.210.0"`, `APP_MILESTONE = "Larbalestier"` (verified unused
in `CHANGELOG.md`). CHANGELOG entry. New `versionHighlight*` key appended to `APP_HIGHLIGHT_KEYS`
with EN + DE strings.

★ `i18n.de.ts` is CRLF and the Edit tool corrupts umlauts and curls double quotes there — patch via a
node utf8 write and re-verify.

## Register updates on completion

`docs/open-followups.md`: remove §17, §18, §19, §20, §23, §24, §25, §26, §27 and their summary-table
rows; renumber or leave gaps per the file's own convention. §16, §21 and §22 stay open, with §22's
entry noting that §24 shipped separately and its golden assertion held.
