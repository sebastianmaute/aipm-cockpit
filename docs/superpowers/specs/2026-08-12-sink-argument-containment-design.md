# Sink-argument containment — closing §143 before the attribute boundary

> ★★★ **SUPERSEDED, NOT ABANDONED — do not implement this as written.**
>
> §143 was HALF CLOSED on `origin/main` (0.235.0 "Lackey") by a different, weaker
> mechanism — four branded `as const` constants applied at 8 of 33 call sites — while this
> was being written. Every measurement below was taken against `99ea20e4`, which was 21
> commits stale at the time.
>
> **What survives and has been re-verified against 0.235.0:** §2a's detectability matrix and
> §2b's construction proof that `document` ↔ `projection` admits no distinguishing input.
> Those are now recorded durably in `docs/open-followups.md` §143, which is the version to
> read. This file is kept only for §0's sequencing and §3's containment sketch, which remains
> the stronger fix if §143 is ever finished properly.
>
> **What is stale:** every call-site count in §2c and §5 (25 raw + 8 branded now, not 33 raw),
> and the framing throughout that treats §143 as untouched.

> Slice 1 of the Option-1 sequencing agreed 2026-08-12. Closes `docs/open-followups.md` §143.
> Refactor + test hardening: **no behaviour change, no version bump, no CHANGELOG entry.**

---

## 0. Where this sits

The documents roadmap and the rich-text work are one dependency graph, not two tracks. The
agreed order:

| # | Slice | Owns |
|---|---|---|
| **1** | **§143 — sink-argument containment** | **this document** |
| 2 | §144 — toolbar gate reach + roving tabindex | axe reaches the 12 editor mounts; `role="toolbar"` with the full APG keyboard contract |
| 3 | §140 — the attribute boundary | task list · text alignment · attribute VALUE allow-list · `ALLOW_DATA_ATTR: false` (closes §115) · security review |
| 4 | §28 — CSV/MD/Turso load boundary | the post-decode hook the codecs never got, plus its golden-stability answer |
| 5 | §141 — export fidelity + repair | heading level and list numbering in DOCX/PPTX, entity fields onto `htmlToRichLines`, the escaped-value residue; §31/§38 as riders |
| 6 | S3b — the documents editor | inherits alignment from §140 |
| 7 | S3c — documents images | Turso-gated; OOXML media machinery is the roadmap's largest unknown |

§129 (static Tiptap imports) is an unmeasured bundle decision, droppable anywhere; its
execution is late.

★★★ **A correction to the argument that produced this order.** The first statement of it said
§140 widens the `rich`/`document` classifier divergence, so §143 had to precede it. **That is
probably false.** The classifier is **tag**-based; §140 adds **attributes** (`data-type`,
`data-checked`, `text-align`), and task list reuses `ul`/`li`, which are already on both lists.
§143 still goes first — on its own HIGH severity, on its cost being small, and on not building
a security slice over an unpinned guard — but not on a widening that is not coming. Recorded
because a sequencing argument that survives on a false premise gets re-quoted as fact.

---

## 1. The problem

`isHtmlStart(value, sink)` answers "is this stored value already HTML?" per sink. The
**map** from sink to regex is derived from each sink's own allow-list and is pinned
exhaustively by `html-start.test.ts`. The **argument** at each call site is not pinned by
anything.

§143 measured that: swapping `narrativeToHtml`'s `"rich"` to `"document"` left 34/34 green,
and swapping all six `sanitize-records.ts` entity sites left 151/151 green.
`doc-render-html.ts`'s `"render"` → `"document"` is the positive control at 3 red.

Passing the wrong sink is a data-integrity bug in both directions. Too narrow escapes the
whole value permanently and visibly (§107 / §114). Too wide used to let a `KEEP_CONTENT:false`
sink delete text (§137), and although no sanitizer deletes text any more, over-recognition
still carries the projection sink's cost (§32).

---

## 2. Measurements this design rests on

All run 2026-08-12 against the tree at `99ea20e4` (0.234.0 "Anders").

### 2a. The detectability matrix

Probe at `.demo-tmp/probe-sink-detect.ts`, run with
`npx vite-node .demo-tmp/probe-sink-detect.ts`. For every ordered pair of sinks it asks how
many candidate inputs produce different answers. Candidates: a leading-tag probe for every
member of the widest list, an `<img>`-leading value, mid-string tags, unlisted-tag-leading
values, and the known non-markup shapes (`<li 3 items`, `</p> means close`, `cost < 5k`).

Summarised from the run (the probe prints a count and the first few labels per pair; the
tag-list lines below are verbatim):

```
rich       vs document   :  <img>-leading, and nothing else
rich       vs projection :  <img>-leading, and nothing else
rich       vs render     :  <img>-leading, mid-string tag, unlisted-tag-leading
document   vs projection :  0 distinguishing   <-- INDISTINGUISHABLE
document   vs render     :  mid-string tag, unlisted-tag-leading
projection vs render     :  mid-string tag, unlisted-tag-leading

rich \ document  : []
document \ rich  : [ 'img' ]
projection===document (same array ref): true
```

### 2b. `document` ↔ `projection` is indistinguishable BY CONSTRUCTION, not by sampling

`SINK_TAGS.projection` and `SINK_TAGS.document` are the **same array reference**
(`DOCUMENT_ALLOWED_TAGS`). `SINK_RE` derives each sink's regex as `htmlStartRe(SINK_TAGS[sink])`,
and `htmlStartRe` is a pure function of the array's contents. Two calls on one array therefore
produce regexes with identical `source` and identical flags.

★★ This matters more than the probe's `0`. A sampled zero says "we looked and found nothing".
The construction says **no distinguishing input can exist**, for all inputs, forever — as long
as the two sinks keep deriving from one list. That is a premise, and §4 below turns it into a
test rather than leaving it as a comment.

### 2c. The live combination surface

33 production call sites (a 34th grep hit is a docstring in `ai-rich-text.ts`). By sink and
by function:

| sink | via `descriptionHtml` | via `sanitizeRichText` | via `isHtmlStart` direct |
|---|---|---|---|
| `rich` | 16 | 9 | 1 (`narrativeToHtml`, §2d) |
| `render` | 3 | — | — |
| `projection` | 2 | — | — |
| `document` | — | 2 | — |

**Only 5 of the 8 possible sink × function combinations are live.** The lone direct
`isHtmlStart` caller is the duplicate of §2d and folds into `richDescriptionHtml`, so it adds no
sixth combination.

Reproduce (run it, do not trust this table — it was correct at `99ea20e4` and nothing gates it):

```bash
grep -rn 'descriptionHtml(\|sanitizeRichText(\|isHtmlStart(' src/app --include=*.ts --include=*.tsx \
  | grep -v '\.test\.' | grep -E '"(rich|document|projection|render)"' \
  | grep -vE ':[0-9]+: *\*' | grep -c .          # 33
```

★ All three greps were run, and the differences are the point. Dropping `isHtmlStart` returns
**32** — it misses `narrativeToHtml` entirely, which is the one site this slice deletes rather
than migrates. Keeping `isHtmlStart` but not filtering comment lines returns **34** — it counts
a docstring in `ai-rich-text.ts` as a call site. A count quoted from either of the two shorter
commands is wrong in a different direction.

### 2d. `narrativeToHtml` is a duplicate of `descriptionHtml`

`narrative-html.ts`'s `narrativeToHtml` reimplements `descriptionHtml`'s body line for line
(`isHtmlStart(s, "rich") ? s : plainToHtml(s)`), rather than calling it. Its own docstring
already says "open-followups §143 owns the general case." The collapse deletes the duplicate.

### 2e. What is NOT measured

* Whether any of the 33 literals is **wrong today**. This slice preserves every one exactly;
  it makes finding out possible, it does not find out. Re-deciding a literal here would hide
  a behaviour change inside a mechanical sweep.
* Bundle or runtime impact. Five one-line wrappers; not worth measuring.

---

## 3. The design

### 3a. Five boundaries, two private generics

In `rich-text-plain.ts` (which stays **DOM-free** — the new functions add no imports):

```ts
// module-private: the ONLY two places a sink is a variable
function descriptionHtmlFor(stored: string | undefined, sink: RichTextSink): string
function sanitizeRichTextFor(raw: unknown, max: number, sink: RichTextSink): string

// exported: the ONLY five places a sink is a literal
export function richDescriptionHtml(stored?: string): string             // "rich"
export function renderDescriptionHtml(stored?: string): string           // "render"
export function projectionDescriptionHtml(stored?: string): string       // "projection"
export function sanitizeRichFieldText(raw: unknown, max: number): string // "rich"
export function sanitizeDocumentBlockText(raw: unknown, max: number): string // "document"
```

`isHtmlStart` keeps its `sink` parameter and stays exported. The classifier was never the
problem; its callers were. After this slice its only production caller is
`descriptionHtmlFor`.

**Naming, settled.** Prefix names the sink, root keeps the existing verb, so
`grep DescriptionHtml` and `grep sanitize.*Text` still find every member.
`sanitizeDocumentBlockText` deliberately avoids `sanitizeDocumentHtml`'s shape — that name is
already taken by the DOMPurify boundary in `sanitize-html.ts`, and two functions one letter
apart on the same subject is how the wrong one gets called.

**Result: exactly six lines in the whole app name a sink**, all in one module — five literals
and one variable. The three unused combinations become *unrepresentable* rather than merely
unused, because no caller can reach the private generics.

### 3b. Why containment, and not fixtures at each call site

Fixtures cannot close this. §2b proves no fixture can ever distinguish `document` from
`projection`, so a fixture-only approach leaves that pair permanently unguarded while looking
complete. Containment closes it structurally: `projection`'s literal is reachable from one
function, `document`'s from another, and confusing them requires editing `rich-text-plain.ts`
rather than typing a different string at any of 33 sites.

The fixtures in §4 are not the guard. They are what stops the containment from being silently
wrong.

### 3c. The tsc-enumeration property survives

`descriptionHtml`'s docstring insists `sink` is REQUIRED with no default, so tsc enumerates
every call site — that was §107's closure and it is load-bearing. It survives: a new call site
still cannot avoid deciding, because there is no generic to fall back to. The decision moves
from a bare string literal to a named symbol, and the symbol carries a docstring the literal
never could.

---

## 4. Testing

### 4a. Boundary fixtures — one per distinguishing shape, not one per call site

| input | boundary | expected |
|---|---|---|
| `<img src="x.png">` | `richDescriptionHtml` | ESCAPED (`img` is not on `RICH_ALLOWED_TAGS`) |
| `<img src="x.png">` | `projectionDescriptionHtml` | passes through |
| `Intro <strong>b</strong> tail` | `renderDescriptionHtml` | passes through (`render` is unanchored) |
| `Intro <strong>b</strong> tail` | `richDescriptionHtml` | ESCAPED (derived sinks are anchored) |
| `<img src="x.png">` | `sanitizeDocumentBlockText` | survives the classifier |
| `<img src="x.png">` | `sanitizeRichFieldText` | escaped |

### 4b. Mutation proof, with ONE stated expected survivor

Flip each boundary's literal to each other sink. Every mutant must go red **except**
`document` ↔ `projection`, which must survive.

★★ A surviving mutant is normally a question a harness cannot answer — "equivalent mutant" and
"missing test" look identical from the outside. This one is answerable, and §2b answers it, so
the design states the expected survivor up front. An unstated survivor here would read as a
coverage gap and invite somebody to close it with a fixture that cannot exist.

Record the mutation COUNT in the implementing commit, not the word "mutation-proved".

### 4c. The construction test that replaces the impossible fixture

```ts
it("document and projection derive from one list, so no input distinguishes them", () => {
  expect(SINK_TAGS.projection).toBe(SINK_TAGS.document);
  expect(htmlStartRe(SINK_TAGS.document).source)
    .toBe(htmlStartRe(SINK_TAGS.projection).source);
});
```

This is the load-bearing test in the slice. It asserts no behaviour — it asserts the **premise**
under which an untestable pair is safe. If anything later makes `projection` diverge from
`document`, it goes red and says so, and a fixture becomes possible at that moment. The pair
goes from *untested* to *tested-as-untestable*.

### 4d. Containment guard

TypeScript enforces the private generics. The one hole left is a future re-export, so:
`import * as M from "./rich-text-plain"` and assert `descriptionHtmlFor` and
`sanitizeRichTextFor` are absent from the export surface.

**No source scan.** TS does this job better, and a redundant scan is a guard nobody maintains.

### 4e. Existing tests

* `rich-text-plain.test.ts` calls `sanitizeRichText(…, "rich")` directly → migrate to boundaries.
* `inline-ai-edit/descriptor-drift.test.ts` imports `descriptionHtml` → migrate.
* `html-start.test.ts` is untouched — it tests `isHtmlStart`, which keeps its parameter.
* ★★ **Re-point the vacuity anchor** in `rich-text-plain.test.ts`'s DOM-free guard. It asserts
  `code` matches `/export function descriptionHtml/` to prove the comment-strip did not eat the
  file. Un-exporting that function makes the anchor stale, and a stale anchor means the whole
  DOM-free guard passes on an unexamined file. Point it at a boundary that is still exported.

### 4f. Gates

`npx tsc --noEmit` is the real proof of the sweep — every migrated call site is a type error
until it is converted. Then `npm run test:run`, `npm run test:shuffle`, `npx eslint
--max-warnings=0 src/app`, `npm run test:coverage` (five new exported functions land in
`rich-text-plain.ts`'s denominator; the §4a fixtures cover them), and `npm run dup:check` —
five near-identical one-line wrappers against a total-duplicated-lines threshold with headroom,
but run it rather than assume.

★★★ Read every exit code UNPIPED. `npm run test:run | tail -8` reports `tail`'s status.

---

## 5. Implementation shape

**Two commits, and the split is a review device, not tidiness.**

1. **Add the boundaries and their tests.** Move no call site. Reviewable on its own.
2. **The call-site sweep.** 33 sites, 13 files, purely mechanical. Because commit 1 changed
   nothing, a behaviour change hiding in commit 2 has nothing to blend into.

**Completion proof, not an eyeball.** After the sweep, a grep for the four sink literals over
`src/app` must return exactly the five boundary lines plus comments:

```bash
grep -rn '"rich"\|"document"\|"projection"\|"render"' src/app --include=*.ts --include=*.tsx \
  | grep -v '\.test\.'
```

★ Run it AFTER the edit. This file's standing rule is that a quoted number is worthless unless
the command behind it was run against the text it is attached to.

### The 13 files

| file | sites | boundary |
|---|---|---|
| `change-edit-modal.tsx` | 7 | `richDescriptionHtml` |
| `sanitize-records.ts` | 6 | `sanitizeRichFieldText` |
| `raid-edit-modal.tsx` | 5 | `richDescriptionHtml` |
| `ai-rich-text.ts` | 2 + 2 | `sanitizeRichFieldText` · `sanitizeDocumentBlockText` |
| `milestone-edit-modal.tsx` | 2 | `richDescriptionHtml` |
| `rich-text-projection.ts` | 2 | `projectionDescriptionHtml` |
| `doc-render-docx.ts` · `doc-render-html.ts` · `doc-render-pptx.ts` | 1 each | `renderDescriptionHtml` |
| `note-log.ts` | 1 | `richDescriptionHtml` |
| `templates.ts` | 1 | `sanitizeRichFieldText` |
| `use-resource-planner.ts` | 1 | `richDescriptionHtml` |
| `narrative-html.ts` | 1 | body becomes `return richDescriptionHtml(stored)` |

`narrativeToHtml` keeps its name and its domain docstring — it is a domain concept, not a
wrapper — but its sink paragraph collapses to a pointer at the boundary.

---

## 6. Docs owed in the implementing commit

* `AGENTS.md` — the rich-text bullet names both functions and asserts they "REQUIRE the sink".
* `docs/AGENTS/ai-assistant.md`, `docs/CODEMAPS/data.md`.
* `html-start.ts` header; `narrative-html.ts` docstring.
* `docs/open-followups.md` §143 → CLOSED, carrying the §2b finding, which is **new information
  §143 does not have**: it frames the risk as "bounded today, unbounded in shape", and the
  `document`/`projection` pair is neither — it is unbounded in shape and *undetectable in
  principle*.

★★ **`docs:symbols:check` is silent on this entire change.** It fails only when a backticked
name exists nowhere in `src`, and `descriptionHtml` will still exist as a module-private
function — so every stale doc claim about its signature passes green. The doc sweep is manual
and unguarded. Grep each claim before trusting it.

---

## 7. Risks

| risk | mitigation |
|---|---|
| A 33-site mechanical sweep quietly changes one site | two commits (§5) + `tsc` forcing every site + the completion grep |
| Re-deciding a literal while moving it | explicit non-goal (§2e); every literal preserved exactly |
| Stale vacuity anchor silently disarms the DOM-free guard | §4e — called out as its own task, not a rider |
| Five wrappers trip `dup:check` | run it; headroom is large but the gate compares total duplicated LINES, so check the exit code |
| Doc claims rot unnoticed | §6 — the gate cannot see this class |

**Non-goals.** Branded types on the rich fields (compile-time safety, but touches `types.ts`,
seven fields, six write paths and the codecs — far too big for a guard slice). Collapsing
`projection` into `document` (they are deliberately distinct so a reader sees why `render` is
widest). Anything from §140.

---

## 8. Definition of done

1. Five boundaries exported; both generics module-private; `isHtmlStart` unchanged.
2. All 33 call sites migrated; the completion grep returns only the five boundary lines.
3. `narrativeToHtml` delegates; the duplicate body is gone.
4. §4a fixtures pass; §4b mutation count recorded; §4c construction test present; §4d export-surface
   test present; §4e anchor re-pointed.
5. `tsc --noEmit`, `test:run`, `test:shuffle`, `eslint --max-warnings=0 src/app`,
   `test:coverage`, `dup:check` all green, each read unpiped.
6. Docs of §6 updated in the same commit; §143 closed with the §2b finding.
7. No version bump, no CHANGELOG entry.
