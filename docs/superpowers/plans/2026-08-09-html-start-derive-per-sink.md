# `HTML_START` derive-per-sink Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make each "is this stored value already HTML?" classifier derive from its own sink's allow-list, so a model-written `<h1>`, `<u>` or `<blockquote>` in a leading position is no longer escaped into permanent literal markup.

**Architecture:** One new DOM-free module `src/app/html-start.ts` owns a `htmlStartRe(tags)` factory and a four-member `RichTextSink` union (`note` 8 · `template` 11 · `document` 20 · `projection` widest). `sanitize-html.ts` exports its three tag arrays; the classifier regexes are built from them, so a widened allow-list widens its classifier automatically. `descriptionHtml` and `sanitizeRichText` take a **required** sink argument — no default, so `tsc` enumerates all 30 call sites.

**Tech Stack:** TypeScript, Next.js 16, vitest 4.1.8, DOMPurify, Tiptap/ProseMirror.

**Spec:** `docs/superpowers/specs/2026-08-09-html-start-derive-per-sink-design.md`

**Closes:** `docs/open-followups.md` §107 · §114 · §118.

---

## Read before starting

- `AGENTS.md` → "Rich-text register descriptions (0.209.0 'Lafferty')" — the DOM-free contract and the three `rich-text-*` modules.
- `docs/open-followups.md` §107 (mechanism + why the naive fix was retracted), §114 (documents), §118 (the reverted composition).
- ★★★ **Never read a gate's exit code through a pipe.** `npm run test:run | tail -8` reports `tail`'s status. Redirect, check unpiped, then read the file.
- ★★ `npm run lint` is bare `eslint` with no `--max-warnings` and exits 0 on warnings. The real gate is `npx eslint --max-warnings=0 src/app`.

---

## File Structure

**Create**
- `src/app/html-start.ts` — the classifier factory, the `RichTextSink` union, and the per-sink regexes. DOM-free: imports tag arrays, calls no DOMPurify.
- `src/app/html-start.test.ts` — factory unit tests + the superset invariant.

**Modify**
- `src/app/sanitize-html.ts` — export the three tag arrays; rename `ALLOWED_TAGS` → `TEMPLATE_ALLOWED_TAGS`; retarget the stale mirror comment.
- `src/app/narrative-html.ts` — delete `HTML_START`, call `isHtmlStart(s, "note")`.
- `src/app/rich-text-plain.ts` — `descriptionHtml(stored, sink)` and `sanitizeRichText(raw, max, sink)`.
- `src/app/rich-text-projection.ts` — pass `"projection"` at both sites.
- 18 fixed-sink call sites (table in Task 4).
- `src/app/doc-render-docx.ts` · `doc-render-pptx.ts` · `doc-render-html.ts` — the §118 composition.
- Docs + release files (Tasks 8–10).

---

## Task 0: Branch

**Files:** none.

- [ ] **Step 1: Confirm the base**

```bash
git status --short; echo "EXIT=$?"
git log --oneline -1
```

Expected: clean tree, `a20894b1 docs: stamp the codemap headers at e368c938, and correct four stale counts`.

★ That commit is one docs-only commit ahead of `origin/main` and is unpushed. Branching from it carries it along, which is intended — it is not a merge conflict risk.

- [ ] **Step 2: Create the branch**

```bash
git checkout -b feat/html-start-derive-per-sink
```

---

## Task 1: Export the three tag arrays from `sanitize-html.ts`

**Files:**
- Modify: `src/app/sanitize-html.ts`

No behaviour change. This is the seam the classifier derives from.

- [ ] **Step 1: Rename and export the template list**

In `src/app/sanitize-html.ts`, replace:

```ts
const ALLOWED_TAGS = ["p", "br", "strong", "em", "u", "h1", "h2", "ul", "ol", "li", "a"];
```

with:

```ts
/** The seven rich entity fields' storage allow-list (`Task.description` plus the
 *  six in `AI_RICH_FIELDS`), plus comm templates and meeting reports.
 *  ★ EXPORTED so html-start.ts can derive this sink's classifier from it. Adding a
 *  tag here widens that classifier in the same edit — which is the whole point:
 *  a classifier narrower than its sink escapes a value the sink would have kept
 *  (open-followups §107). */
export const TEMPLATE_ALLOWED_TAGS = ["p", "br", "strong", "em", "u", "h1", "h2", "ul", "ol", "li", "a"];
```

- [ ] **Step 2: Update the two internal uses of the old name**

In `sanitizeTemplateHtml`, replace `ALLOWED_TAGS,` with `ALLOWED_TAGS: TEMPLATE_ALLOWED_TAGS,`.

In the `DOCUMENT_ALLOWED_TAGS` declaration, replace `...ALLOWED_TAGS,` with `...TEMPLATE_ALLOWED_TAGS,` and add `export`:

```ts
export const DOCUMENT_ALLOWED_TAGS = [
  ...TEMPLATE_ALLOWED_TAGS,
  "s",
  "code",
  "pre",
  "blockquote",
  "hr",
  "mark",
  "sub",
  "sup",
  "img",
];
```

★ Leave `ALLOWED_ATTR` alone — it is a different constant and nothing derives from it.

- [ ] **Step 3: Export the note list and retarget its comment**

Replace:

```ts
// ★ narrative-html.ts's HTML_START mirrors this list (minus "#text"): it decides
// whether a stored narrative is already HTML, and recognising a tag THIS list
// omits means the sink below deletes the element and its text. Edit both together.
const NOTE_ALLOWED_TAGS = ["p", "br", "strong", "em", "ul", "ol", "li", "a", "#text"];
```

with:

```ts
// ★★ html-start.ts DERIVES the "note" classifier from this list (its factory drops
// "#text", which is not a tag name). It is no longer a mirror a human maintains —
// editing this array moves the classifier in the same edit. The hazard it used to
// warn about is still real and is now structurally prevented: recognising a tag
// THIS list omits means the sink below deletes the element AND its text
// (KEEP_CONTENT: false), which is why the note sink must never be classified with
// a wider list. See open-followups §107.
export const NOTE_ALLOWED_TAGS = ["p", "br", "strong", "em", "ul", "ol", "li", "a", "#text"];
```

- [ ] **Step 4: Typecheck**

```bash
npx tsc --noEmit; echo "EXIT=$?"
```

Expected: `EXIT=0`.

- [ ] **Step 5: Run the sanitizer suite**

```bash
npx vitest run src/app/sanitize-html.test.ts --reporter=dot > /tmp/s1.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/s1.log
```

Expected: `EXIT=0`, all pass. ★ `--reporter=basic` does not exist in vitest 4.1.8; use `dot`.

- [ ] **Step 6: Commit**

```bash
git add src/app/sanitize-html.ts
git commit -m "refactor: export the three sanitizer tag lists so classifiers can derive from them"
```

---

## Task 2: The `html-start.ts` factory (TDD)

**Files:**
- Create: `src/app/html-start.test.ts`
- Create: `src/app/html-start.ts`

- [ ] **Step 1: Write the failing test**

Create `src/app/html-start.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  DOCUMENT_ALLOWED_TAGS,
  NOTE_ALLOWED_TAGS,
  TEMPLATE_ALLOWED_TAGS,
} from "./sanitize-html";
import { htmlStartRe, isHtmlStart, SINK_TAGS } from "./html-start";

describe("htmlStartRe", () => {
  it("drops non-tag entries so #text cannot enter the alternation", () => {
    const re = htmlStartRe(["p", "#text"]);
    expect(re.source).not.toContain("#text");
    expect(re.test("<p>x</p>")).toBe(true);
  });

  it("never matches a leading CLOSING tag", () => {
    // A stored value cannot legitimately begin with one, and passing it through
    // makes the sink delete the literal characters the user typed.
    expect(htmlStartRe(["p"]).test("</p> means close")).toBe(false);
  });

  it("does not let a short tag swallow a longer one that shares its prefix", () => {
    const re = htmlStartRe(["strong", "s", "sub", "sup"]);
    expect(re.test("<strong>a</strong>")).toBe(true);
    expect(re.test("<s>a</s>")).toBe(true);
    expect(re.test("<sub>a</sub>")).toBe(true);
    expect(re.test("<sup>a</sup>")).toBe(true);
  });

  it("matches void spellings and attribute-bearing tags", () => {
    const re = htmlStartRe(["hr", "img", "a"]);
    expect(re.test("<hr/>")).toBe(true);
    expect(re.test("<hr />")).toBe(true);
    expect(re.test('<img data-asset-id="7" alt="x">')).toBe(true);
    expect(re.test('<a href="https://x.test">y</a>')).toBe(true);
  });

  it("is case-insensitive and tolerates leading whitespace", () => {
    expect(htmlStartRe(["p"]).test("  \n<P>x</P>")).toBe(true);
  });

  it("matches nothing when no valid tag name survives the filter", () => {
    // Guard against an empty alternation, which would compile to a regex that
    // matches "<>" and any stray angle bracket.
    const re = htmlStartRe(["#text"]);
    expect(re.test("<p>x</p>")).toBe(false);
    expect(re.test("<>")).toBe(false);
  });
});

describe("the sink map", () => {
  it("classifies a document-only tag for document and projection, not for note or template", () => {
    expect(isHtmlStart("<blockquote>q</blockquote>", "document")).toBe(true);
    expect(isHtmlStart("<blockquote>q</blockquote>", "projection")).toBe(true);
    expect(isHtmlStart("<blockquote>q</blockquote>", "template")).toBe(false);
    expect(isHtmlStart("<blockquote>q</blockquote>", "note")).toBe(false);
  });

  it("classifies a template-only tag for template but never for note", () => {
    // The note sink is KEEP_CONTENT: false — recognising a tag it strips deletes
    // the text with it (open-followups §107).
    for (const html of ["<h1>T</h1>", "<h2>T</h2>", "<u>T</u>"]) {
      expect(isHtmlStart(html, "template")).toBe(true);
      expect(isHtmlStart(html, "note")).toBe(false);
    }
  });

  it("keeps projection a superset of every real sink", () => {
    // Projection has no sink — htmlToText strips everything — so recognising more
    // costs nothing and recognising less is the entire defect. If the document
    // list ever narrows, this is what catches it.
    const projection = new Set(SINK_TAGS.projection);
    for (const tags of [NOTE_ALLOWED_TAGS, TEMPLATE_ALLOWED_TAGS, DOCUMENT_ALLOWED_TAGS]) {
      for (const tag of tags) {
        if (tag === "#text") continue;
        expect(projection.has(tag)).toBe(true);
      }
    }
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run src/app/html-start.test.ts --reporter=dot > /tmp/t2.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t2.log
```

Expected: non-zero exit, failure resolving `./html-start`.

- [ ] **Step 3: Write the module**

Create `src/app/html-start.ts`:

```ts
// src/app/html-start.ts
//
// "Is this stored value already HTML?" — one classifier per SINK.
//
// ★★★ THE RULE: never recognise more than your own sink KEEPS. A classifier
// narrower than its sink escapes a value the sink would have kept, and the escape
// covers the WHOLE value, permanently (open-followups §107 / §114). A classifier
// WIDER than its sink is worse where the sink deletes: sanitizeNoteHtml sets
// KEEP_CONTENT: false, so recognising a tag it strips removes the element AND its
// text — a bug already shipped and fixed once, where "<h1>Q3</h1><p>ok</p>"
// rendered as just "ok" and "<div>Status</div>" rendered as nothing.
//
// One shared constant cannot express that rule for four sinks, which is why the
// regexes are DERIVED from each sink's own allow-list rather than hand-mirrored.
//
// ★★ DOM-FREE. This module runs inside the entity sanitizers, which execute under
// bare node in scripts/generate-sample-workspace.ts. It imports tag arrays from
// sanitize-html.ts and calls nothing there — importing is safe, only a DOMPurify
// CALL needs a DOM.
import {
  DOCUMENT_ALLOWED_TAGS,
  NOTE_ALLOWED_TAGS,
  TEMPLATE_ALLOWED_TAGS,
} from "./sanitize-html";

/** A real HTML tag name. Used to drop "#text", which is a DOMPurify allow-list
 *  member but not a tag, and would otherwise enter the alternation as literal
 *  "#text". */
const TAG_NAME = /^[a-z][a-z0-9]*$/;

/** Never matches anything. Returned when no valid tag name survives the filter —
 *  an empty alternation would compile to `<()\b[^>]*>`, which matches a bare
 *  "<>" and turns every stray angle bracket into "this is HTML". */
const NEVER = /(?!)/;

/** Build the "already HTML?" test for one allow-list.
 *
 *  ★ A leading CLOSING tag is deliberately NOT matched (no `\/?`): a stored value
 *  cannot legitimately begin with one — the editors cannot emit it and no
 *  well-formed HTML starts that way — so "</p> means close" is by construction
 *  plain text somebody typed. Passing it through makes the sink delete those
 *  literal characters.
 *
 *  ★ `\b[^>]*>` so void spellings (`<hr/>`, `<img src=…>`) and attribute-bearing
 *  tags match. The `\b` is also what stops a short name swallowing a longer one
 *  that shares its prefix: against "<strong>", the `s` alternative fails because
 *  `s` is followed by a word character, and the engine backtracks to `strong`. */
export function htmlStartRe(tags: readonly string[]): RegExp {
  const names = tags.filter((t) => TAG_NAME.test(t));
  if (names.length === 0) return NEVER;
  return new RegExp(`^\\s*<(${names.join("|")})\\b[^>]*>`, "i");
}

/** Which sink the classified value is on its way to.
 *
 *  ★ "projection" is NOT a sink — descriptionText/descriptionTextWithBreaks strip
 *  every tag. It takes the WIDEST list because the rule above does not bind on a
 *  strip-everything pass: over-recognising costs nothing there, while
 *  under-recognising emits literal "<h1>Title</h1>" as visible text into search,
 *  the AI digests and every export. It is a distinct member from "document" even
 *  though the lists are equal today, so a reader sees WHY it is widest. */
export type RichTextSink = "note" | "template" | "document" | "projection";

export const SINK_TAGS: Record<RichTextSink, readonly string[]> = {
  note: NOTE_ALLOWED_TAGS,
  template: TEMPLATE_ALLOWED_TAGS,
  document: DOCUMENT_ALLOWED_TAGS,
  projection: DOCUMENT_ALLOWED_TAGS,
};

const SINK_RE: Record<RichTextSink, RegExp> = {
  note: htmlStartRe(SINK_TAGS.note),
  template: htmlStartRe(SINK_TAGS.template),
  document: htmlStartRe(SINK_TAGS.document),
  projection: htmlStartRe(SINK_TAGS.projection),
};

/** True when `value` opens with a tag `sink` will keep. */
export function isHtmlStart(value: string, sink: RichTextSink): boolean {
  return SINK_RE[sink].test(value);
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run src/app/html-start.test.ts --reporter=dot > /tmp/t2.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t2.log
```

Expected: `EXIT=0`, 9 tests passing.

- [ ] **Step 5: Prove the guards are load-bearing (mutation check)**

★★ A surviving mutant is a QUESTION, not a pass. Run each mutation, confirm a test goes RED, then revert it.

1. Delete `if (names.length === 0) return NEVER;` → the empty-alternation test must fail.
2. Change `\\b[^>]*>` to `[^>]*>` → the prefix-swallow test must fail (`<strong>` matches the `s` alternative).
3. Change `^\\s*<(` to `^\\s*<\\/?(` → the closing-tag test must fail.
4. Remove the `.filter(...)` → the `#text` test must fail.

If any mutant survives, the test is missing an input — find one; do not record it as redundant.

- [ ] **Step 6: Commit**

```bash
git add src/app/html-start.ts src/app/html-start.test.ts
git commit -m "feat: derive the already-HTML classifier from each sink's own allow-list"
```

---

## Task 3: Rewire `narrative-html.ts` — behaviour must not move

**Files:**
- Modify: `src/app/narrative-html.ts`
- Check: `src/app/narrative-html.test.ts`

The narrative's 8 tags are exactly `NOTE_ALLOWED_TAGS` minus `#text`, so this is a pure refactor: the same regex, now built rather than typed.

- [ ] **Step 1: Record the baseline**

```bash
npx vitest run src/app/narrative-html.test.ts --reporter=dot > /tmp/t3-before.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t3-before.log
```

Expected: `EXIT=0`. Note the test count — it must be identical at Step 5.

- [ ] **Step 2: Replace the constant with a call**

In `src/app/narrative-html.ts`, delete the `export const HTML_START = /^\s*<(p|br|strong|em|ul|ol|li|a)\b[^>]*>/i;` line **and move its doc comment's still-live rules into `html-start.ts`** — the closing-tag rule and the inline-members rule are already stated there; anything the old comment says that `html-start.ts` does not, copy across before deleting.

Change the import to:

```ts
import { plainToHtml } from "./sanitize-html";
import { isHtmlStart } from "./html-start";
```

and `narrativeToHtml` to:

```ts
/** Stored narrative -> HTML. A legacy plain-text value is escaped and wrapped.
 *
 *  ★★ The "note" sink is not a stylistic choice: sanitizeNoteHtml sets
 *  KEEP_CONTENT: false, so a classifier wider than that list would make the sink
 *  delete a heading together with its text. That exact bug shipped once —
 *  "<h1>Q3</h1><p>ok</p>" rendered as "ok". Deriving from NOTE_ALLOWED_TAGS makes
 *  the alignment structural instead of a comment somebody has to honour. */
export function narrativeToHtml(stored: string | undefined): string {
  const s = (stored ?? "").trim();
  if (!s) return "";
  return isHtmlStart(s, "note") ? s : plainToHtml(s);
}
```

- [ ] **Step 3: Fix the test file if it imports the deleted symbol**

```bash
grep -n "HTML_START" src/app/narrative-html.test.ts
```

If it appears, replace each `HTML_START.test(x)` with `isHtmlStart(x, "note")` and update the import. **Do not delete a case** — every existing assertion must survive, since they are the proof this refactor moved nothing.

- [ ] **Step 4: Confirm no other importer remains**

```bash
grep -rn "HTML_START" src/app --include="*.ts" --include="*.tsx"
```

Expected after this task: only `rich-text-plain.ts:20` (fixed in Task 4) and comment mentions.

- [ ] **Step 5: Run the suite and compare to the baseline**

```bash
npx vitest run src/app/narrative-html.test.ts --reporter=dot > /tmp/t3-after.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t3-after.log
```

Expected: `EXIT=0`, and the same test count as Step 1.

- [ ] **Step 6: Commit**

```bash
git add src/app/narrative-html.ts src/app/narrative-html.test.ts
git commit -m "refactor: narrative classifies against its own sink's list, structurally"
```

---

## Task 4: Thread the sink through `descriptionHtml` and `sanitizeRichText`

**Files:**
- Modify: `src/app/rich-text-plain.ts`
- Modify: 18 call sites (table below)

★ The argument is **required**, with no default. A default is the exact trap this slice removes: the wrong sink would then be silent. `tsc` is the enumeration tool here.

- [ ] **Step 1: Change the two signatures**

In `src/app/rich-text-plain.ts`, add to the imports:

```ts
import { isHtmlStart, type RichTextSink } from "./html-start";
```

and remove `import { HTML_START } from "./narrative-html";`.

Replace `descriptionHtml`:

```ts
/** A stored value -> HTML. Already-HTML passes through; legacy plain text is
 *  escaped and wrapped. Idempotent — this runs on every load.
 *
 *  ★★★ `sink` is REQUIRED and names where the result is going, because the answer
 *  to "is this already HTML?" is different per sink. Passing the wrong one is a
 *  data-integrity bug in both directions: too narrow escapes the whole value
 *  permanently (§107 / §114), too wide lets a KEEP_CONTENT:false sink delete the
 *  text. There is deliberately no default. */
export function descriptionHtml(stored: string | undefined, sink: RichTextSink): string {
  const s = (stored ?? "").trim();
  if (!s) return "";
  return isHtmlStart(s, sink) ? s : plainToHtml(s);
}
```

Replace `sanitizeRichText`'s signature and body line (keep its existing doc comment, append the `sink` note):

```ts
export function sanitizeRichText(raw: unknown, max: number, sink: RichTextSink): string {
  const s =
    typeof raw === "string" ? raw.replace(WS_CONTROL, " ").replace(CONTROL_CHARS, "") : "";
  const html = capHtmlText(descriptionHtml(s, sink), max);
  return htmlTextLength(html) === 0 ? "" : html;
}
```

- [ ] **Step 2: Run tsc to enumerate every broken call site**

```bash
npx tsc --noEmit > /tmp/t4.log 2>&1; echo "EXIT=$?"; grep -c "error TS" /tmp/t4.log; grep "error TS2554" /tmp/t4.log | head -40
```

Expected: non-zero exit, ~30 "Expected 2 arguments, but got 1" / "Expected 3, but got 2" errors, plus test files.

- [ ] **Step 3: Apply the sink at every fixed site**

Each edit is mechanical — add the sink as the last argument.

`descriptionHtml` (18 fixed sites):

| Sink | File | Sites |
|---|---|---|
| `"note"` | `src/app/note-log.ts` | `:157` — inside `sanitizeNoteHtml(descriptionHtml(value))` |
| `"template"` | `src/app/change-edit-modal.tsx` | `:215 :375 :391 :463 :469 :592 :598` |
| `"template"` | `src/app/raid-edit-modal.tsx` | `:236 :455 :468 :625 :631` |
| `"template"` | `src/app/milestone-edit-modal.tsx` | `:110 :209` |
| `"template"` | `src/app/use-resource-planner.ts` | `:427` |
| `"projection"` | `src/app/rich-text-projection.ts` | `:39 :61` |

`sanitizeRichText` (11 sites):

| Sink | File | Sites |
|---|---|---|
| `"template"` | `src/app/sanitize-records.ts` | `:88 :122 :131 :137 :194 :196` |
| `"template"` | `src/app/templates.ts` | `:146` |
| `"template"` | `src/app/ai-rich-text.ts` | `:59 :65` (inside `sanitizeAiRichText`) |
| `"document"` | `src/app/ai-rich-text.ts` | `:137 :140` (inside `sanitizeAiDocumentRichText`) |

★★ Line numbers are as of `a20894b1` and **shift as you edit**. Use them to identify the site, then re-locate by symbol — do not trust the number after your first edit in a file.

★ Both `sanitizeRichText` calls inside each `ai-rich-text` function (the layer-1 upgrade and the trailing re-run) take the **same** sink.

★ At `note-log.ts:157` the sink is `"note"`, not `"template"`, because the very next call is `sanitizeNoteHtml`. Getting this one wrong deletes note text.

- [ ] **Step 4: Fix the test files tsc names**

Test files call both functions too. Add the sink that matches what each test is asserting about — a test exercising a note-log behaviour gets `"note"`, an AI-write test gets `"template"` or `"document"`. **Do not blanket-apply `"template"`.**

- [ ] **Step 5: Typecheck clean**

```bash
npx tsc --noEmit; echo "EXIT=$?"
```

Expected: `EXIT=0`.

- [ ] **Step 6: Full unit suite**

```bash
npm run test:run > /tmp/t4-suite.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t4-suite.log
```

Expected: `EXIT=0`. If anything fails, read the failure body — a red test here is real signal about a mis-assigned sink.

- [ ] **Step 7: Lint (the real gate)**

```bash
npx eslint --max-warnings=0 src/app; echo "EXIT=$?"
```

Expected: `EXIT=0`. ★ No pipe — grep would report its own status.

- [ ] **Step 8: Commit**

```bash
git add -A src/app
git commit -m "feat: every classifier call names its sink; no default"
```

---

## Task 5: Regression tests for §107 and §114

**Files:**
- Modify: `src/app/ai-rich-text.test.ts` (create the file if absent)

- [ ] **Step 1: Write the failing tests**

Add to `src/app/ai-rich-text.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { sanitizeAiDocumentRichText, sanitizeAiRichText } from "./ai-rich-text";

describe("open-followups §107 — a leading template tag is no longer escaped", () => {
  it("keeps a leading h1 as markup", () => {
    expect(sanitizeAiRichText("<h1>Title</h1><p>body</p>")).toBe("<h1>Title</h1><p>body</p>");
  });

  it("keeps a leading u as markup", () => {
    expect(sanitizeAiRichText("<u>Title</u><p>body</p>")).toBe("<u>Title</u><p>body</p>");
  });

  it("still leaves a mid-value heading alone (this case was never broken)", () => {
    expect(sanitizeAiRichText("<p>Title</p><h1>Section</h1>")).toBe("<p>Title</p><h1>Section</h1>");
  });

  it("still escapes genuine plain text", () => {
    expect(sanitizeAiRichText("cost < 5k and rising")).toBe("<p>cost &lt; 5k and rising</p>");
  });
});

describe("open-followups §114 — the nine document-only tags, one leading tag at a time", () => {
  // Measured individually on purpose: the register got the count wrong the first
  // time by reasoning about the group instead of testing each member.
  const cases: Array<[string, string]> = [
    ["s", "<s>a</s><p>b</p>"],
    ["code", "<code>a</code><p>b</p>"],
    ["pre", "<pre>a</pre><p>b</p>"],
    ["blockquote", "<blockquote>a</blockquote><p>b</p>"],
    ["hr", "<hr><p>b</p>"],
    ["mark", "<mark>a</mark><p>b</p>"],
    ["sub", "<sub>a</sub><p>b</p>"],
    ["sup", "<sup>a</sup><p>b</p>"],
    ["img", '<img data-asset-id="7" alt="a"><p>b</p>'],
  ];

  for (const [tag, html] of cases) {
    it(`does not escape a leading <${tag}>`, () => {
      expect(sanitizeAiDocumentRichText(html)).not.toContain("&lt;");
    });
  }

  it("does not widen the entity path: a document-only tag is still not markup there", () => {
    // sanitizeAiRichText's sink is sanitizeTemplateHtml, which has no blockquote.
    // Classifying it as HTML would hand the sink a tag it unwraps, so the value
    // must still take the escape path.
    expect(sanitizeAiRichText("<blockquote>q</blockquote>")).toContain("&lt;blockquote&gt;");
  });
});
```

- [ ] **Step 2: Run and watch the §107 cases fail on `main`'s behaviour**

```bash
git stash && npx vitest run src/app/ai-rich-text.test.ts --reporter=dot > /tmp/t5-base.log 2>&1; echo "EXIT=$?"; git stash pop
```

★ If the tests do not exist on the stashed tree this step is informational only — the point is to confirm the assertions describe a change, not the status quo. If every assertion passes before the fix, the test is vacuous: fix the test, not the code.

- [ ] **Step 3: Run against the implemented change**

```bash
npx vitest run src/app/ai-rich-text.test.ts --reporter=dot > /tmp/t5.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t5.log
```

Expected: `EXIT=0`, 14 tests (4 + 9 + 1).

- [ ] **Step 4: Typecheck (vitest never typechecks)**

```bash
npx tsc --noEmit; echo "EXIT=$?"
```

Expected: `EXIT=0`.

- [ ] **Step 5: Commit**

```bash
git add src/app/ai-rich-text.test.ts
git commit -m "test: pin open-followups 107 and 114 at the AI write boundary"
```

---

## Task 6: The projection defect — literal markup in search and every export

**Files:**
- Modify: `src/app/rich-text-projection.test.ts`

`descriptionText` and `descriptionTextWithBreaks` now classify at `"projection"` (done in Task 4). This task pins the user-visible consequence, which neither §107 nor §114 records.

- [ ] **Step 1: Write the test**

Add to `src/app/rich-text-projection.test.ts`:

```ts
describe("projection classifies at the widest list", () => {
  it("does not emit literal markup for a value leading with a heading", () => {
    // Before the split this projected to the visible text "<h1>Title</h1><p>body</p>"
    // — into search results, the AI digests, and every DOCX/PPTX/XLSX/PDF export.
    expect(descriptionText("<h1>Title</h1><p>body</p>")).toBe("Title body");
  });

  it("does not emit literal markup for a document-only leading tag", () => {
    expect(descriptionText("<blockquote>quoted</blockquote>")).toBe("quoted");
  });

  it("keeps the export projection's block boundary as a newline", () => {
    expect(descriptionTextWithBreaks("<h1>Title</h1><p>body</p>")).toBe("Title\nbody");
  });

  it("still escapes and projects genuine plain text unchanged", () => {
    expect(descriptionText("cost < 5k")).toBe("cost < 5k");
  });
});
```

★ Import `descriptionText` and `descriptionTextWithBreaks` if the file does not already.

- [ ] **Step 2: Run**

```bash
npx vitest run src/app/rich-text-projection.test.ts --reporter=dot > /tmp/t6.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t6.log
```

Expected: `EXIT=0`.

★ If `"Title body"` fails on spacing, read the actual value before adjusting the expectation — `separateBlockBoundaries` inserts a space per block boundary and `htmlPlainProjection` collapses runs. Match the measured output; do not loosen the assertion to a `toContain`.

- [ ] **Step 3: Byte-stability of the default projection path**

```bash
npx vitest run src/app/rich-text-plain.test.ts src/app/rich-text-plain.property.test.ts --reporter=dot > /tmp/t6b.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t6b.log
```

Expected: `EXIT=0`. ★★ `htmlPlainProjection` feeds `capHtmlText` → `sanitizeRichText` → all six backends, and its hardcoded byte-stability suite lives here. A failure means stored bytes moved — investigate, never re-baseline.

- [ ] **Step 4: Commit**

```bash
git add src/app/rich-text-projection.test.ts
git commit -m "test: projection no longer leaks literal markup into search and exports"
```

---

## Task 7: §118 — the three renderer sites

**Files:**
- Modify: `src/app/doc-render-docx.ts` (around `:237`)
- Modify: `src/app/doc-render-pptx.ts` (around `:208`)
- Modify: `src/app/doc-render-html.ts` (around `:105`)
- Modify: their test files

This is the composition implemented and **reverted on 2026-08-08** because the 8-tag gate escaped a paragraph already stored as valid `<blockquote>` — observed paragraph styles went from `['Title','Quote','CodeBlock','CodeBlock']` to `['Title']`.

- [ ] **Step 0: Learn each suite's own helper and fixture names**

```bash
grep -nE "^import|^const |^function |describe\(" src/app/doc-render-docx.test.ts | head -25
grep -nE "^export function" src/app/doc-render-docx.ts src/app/doc-render-pptx.ts src/app/doc-render-html.ts
```

Use the names these print. The test below is written against a `renderDocx(doc)` /
`emptyDoc` shape; if the file spells them differently, **match the file** — do not add a
parallel helper.

- [ ] **Step 1: Write the failing test — the legacy fused paragraph**

Add to `src/app/doc-render-docx.test.ts`:

```ts
it("upgrades a legacy plain-text paragraph instead of fusing its lines", () => {
  // Reachable by import only: the AI write boundary upgrades before storing, but
  // hand-edited or externally-produced workspace JSON reaches the renderer raw.
  // Measured through the composed load pipeline, {"type":"paragraph","html":"a\nb"}
  // survives byte-for-byte — neither sanitizeProjectDocuments nor
  // sanitizeDocumentRichFields upgrades it (open-followups §118).
  const xml = renderDocx({ ...emptyDoc, blocks: [{ type: "paragraph", html: "a\nb" }] });
  expect(xml).toContain("<w:br/>");
});
```

★ Use the file's own existing render helper and fixture shape — read the top of the test file and match it rather than inventing `emptyDoc`/`renderDocx` names.

★★ `htmlToRichLines` treats `<br>` as a line break, so `"<p>a<br>b</p>"` yields **two** `RichLine`s and therefore two `<w:p>` paragraphs — not one paragraph containing a break. Assert what the renderer actually emits; §118 records that an earlier reading of this got it wrong.

- [ ] **Step 2: Run and watch it fail**

```bash
npx vitest run src/app/doc-render-docx.test.ts --reporter=dot > /tmp/t7.log 2>&1; echo "EXIT=$?"; tail -30 /tmp/t7.log
```

Expected: non-zero exit — the two lines arrive fused.

- [ ] **Step 3: Compose the upgrade at all three renderers**

`doc-render-docx.ts` — add `import { descriptionHtml } from "./rich-text-plain";` and change the `htmlToRichLines(html)` call to:

```ts
  return htmlToRichLines(descriptionHtml(html, "document"))
```

`doc-render-pptx.ts` — same import, and:

```ts
      return [...htmlToRichLines(descriptionHtml(block.html, "document"))];
```

`doc-render-html.ts` — same import, and:

```ts
    case "paragraph":
      return sanitizeDocumentHtml(descriptionHtml(block.html, "document"));
```

★★★ Do **not** move this to the load boundary. Composing it into `sanitizeDocumentRichFields` would fix all three from one place and would be a mutation on load that the next save persists: it rewrites stored bytes on all six write paths for documents nobody edited, makes `documentVersions` before-images record a diff no user made, and moves byte-stable goldens for an input that did not legitimately change.

- [ ] **Step 4: Run the three renderer suites**

```bash
npx vitest run src/app/doc-render-docx.test.ts src/app/doc-render-pptx.test.ts src/app/doc-render-html.test.ts --reporter=dot > /tmp/t7b.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t7b.log
```

Expected: `EXIT=0`.

- [ ] **Step 5: Verify the falsification check**

Search the three suites for an assertion on paragraph styles including `'Quote'` and `'CodeBlock'`. If one exists, it is the 2026-08-08 expectation and it must now be **green**. If none exists, add it:

```ts
it("keeps block styles for a paragraph stored as a document-only tag", () => {
  const xml = renderDocx({
    ...emptyDoc,
    blocks: [{ type: "paragraph", html: "<blockquote>quoted</blockquote>" }],
  });
  expect(xml).toContain("Quote");
});
```

★★ This is the whole slice's falsification test — a check written **before** this design existed, of whether the split actually works. If it fails, the sink is wrong; do not adjust the expectation.

- [ ] **Step 6: Commit**

```bash
git add src/app/doc-render-docx.ts src/app/doc-render-pptx.ts src/app/doc-render-html.ts src/app/doc-render-docx.test.ts src/app/doc-render-pptx.test.ts src/app/doc-render-html.test.ts
git commit -m "fix: a legacy plain-text paragraph no longer fuses in any renderer"
```

---

## Task 8: Measure the `Task.description` asymmetry

**Files:**
- Create (temporary): `src/app/task-description-editor-probe.test.tsx` — deleted at the end of this task.

The spec records this as **must verify before writing the register entry**: `Task.description`'s human save sink is `sanitizeNoteHtml` (`use-task-submit.ts:162`) — the 8-tag list **with `KEEP_CONTENT: false`, which deletes text** — while its AI write path is `sanitizeTemplateHtml` (11, keeps words). One field, two write sinks.

- [ ] **Step 1: State the question**

After this slice, `sanitizeAiRichText` can store a real `<h1>` in a task description. When a human then opens the task modal and saves, does anything outside the 8 tags reach `sanitizeNoteHtml`?

The expectation is no — the lean Tiptap editor should normalise the value to its own schema on parse, so `onChange` emits only the lean set. **`should` is not a measurement.**

- [ ] **Step 2: Measure it**

Write a temporary test that mounts the lean `RichTextEditor` with `value="<h1>Title</h1><p>body</p>"` and captures what `onChange` emits after a trivial edit. Follow the mocking pattern already in `src/app/task-form-modal.test.tsx` — that file documents that ProseMirror touches layout APIs jsdom lacks.

```bash
npx vitest run src/app/task-description-editor-probe.test.tsx --reporter=dot > /tmp/t8.log 2>&1; echo "EXIT=$?"; cat /tmp/t8.log
```

★ If jsdom cannot drive the editor faithfully, do **not** guess. Measure it in a real browser with a throwaway Playwright spec against `e2e/seed.ts` and record that instead.

- [ ] **Step 3: Record the measured result**

Write down: the exact input, the exact `onChange` output, and whether any text was lost. This sentence goes into the new register entry in Task 9 — **as a measurement, with the reproduce command beside it**, not as a prediction.

- [ ] **Step 4: Delete the temporary test**

It has served its purpose; a mounted-editor test is expensive and this one asserts nothing durable.

```bash
git status --short
```

Expected: no leftover temp file.

---

## Task 9: Documentation

**Files:**
- Modify: `docs/open-followups.md`
- Modify: `AGENTS.md`
- Modify: `src/app/ai-rich-text.ts` (comment blocks near `:53 :56 :116 :117 :125`)
- Modify: `src/app/chat-tool-defs-documents.ts` (comment block near `:43-47`)
- Modify: `src/app/use-document-tools.ts` (comment near `:257`)

- [ ] **Step 1: Close §107, §114, §118**

Retitle each to `— CLOSED 2026-08-09` following the file's existing closed-entry convention. **Keep the measurements.** A closed entry's ★★ notes are what a future reader needs; deleting them destroys the only record of why the naive fix was retracted.

- [ ] **Step 2: Add the new entry**

Append a new numbered entry (next free number — check the tail of the file, do not assume 132):

> **The seven rich entity fields' editor cannot represent three tags their storage permits — open, step 0 of the unify-rich-text program**

Content: the three-layer table (classifier / storage 11 / lean editor); that `u`/`h1`/`h2` are write-only today because no `dangerouslySetInnerHTML` sink renders these fields; the `Task.description` asymmetry with the **measured** result from Task 8 and its reproduce command; and that the closure is one future slice, not per-field patches.

- [ ] **Step 3: Retarget the stale code comments**

Each of these describes the old shared-constant world:

- `ai-rich-text.ts` — the `HTML_START` caveat blocks and the "deliberately NOT fixed here: widening `HTML_START` is the naive repair" note. The naive repair is no longer the available move; say what happened instead.
- `chat-tool-defs-documents.ts:43-47` — the instruction-as-mitigation block ("tell the model to wrap paragraphs in `<p>`"). ★ Keep the instruction itself; it is still good prompting. Remove only the claim that it is the mitigation.
- `use-document-tools.ts:257` — its `HTML_START` comment.

- [ ] **Step 4: Update AGENTS.md's rich-text bullet**

The `HTML_START` sub-bullet currently states the 8-tag classification and that documents inherit it safely. Replace with the derive-per-sink rule and the four sinks. ★★ A correction is a NEW claim and inherits none of the verification of the thing it corrects — run a command against the **replacement** text.

- [ ] **Step 5: Run the doc gates**

```bash
npm run docs:symbols:check > /tmp/t9a.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/t9a.log
npm run docs:claims:check > /tmp/t9b.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/t9b.log
```

Expected: `EXIT=0` for both.

★★ `docs:claims:check` is a **ratchet** — it fails on a NEW `path:LINE` citation. Cite symbols and greps in the new prose, not line numbers. ★ It only proves a cited line *could* exist, never that it is right.

★ `docs:symbols:check` skips every `SCREAMING_CASE` name, so `HTML_START` / `NOTE_ALLOWED_TAGS` / `SINK_TAGS` are ungated in docs. A green run says nothing about them — check by grep that every backticked constant you wrote still exists.

- [ ] **Step 6: Commit**

```bash
git add docs/open-followups.md AGENTS.md src/app/ai-rich-text.ts src/app/chat-tool-defs-documents.ts src/app/use-document-tools.ts
git commit -m "docs: close 107, 114 and 118; record the editor-vs-storage gap"
```

---

## Task 10: Release

**Files:**
- Modify: `src/app/version.ts` · `CHANGELOG.md` · `package.json` · `package-lock.json` · `README.md` · `docs/CODEMAPS/*.md` (5 files)

- [ ] **Step 1: Pick a codename and prove it is unused**

Milestone codenames are sci-fi/fantasy author surnames and must be unique.

```bash
grep -inE "^## \[?0\.[0-9]+" CHANGELOG.md | head -40
grep -in "nagata" CHANGELOG.md; echo "EXIT=$?"
```

Expected for the second: no match. If it matches, pick another and re-check.

- [ ] **Step 2: Bump `src/app/version.ts`**

Set `APP_VERSION = "0.228.0"`, `APP_BUILD_DATE = "2026-08-09"` with the milestone comment, and the milestone codename constant.

- [ ] **Step 3: `CHANGELOG.md`**

User-facing summary: a model-written heading, underline or quoted block at the start of a description or document paragraph is stored as real formatting instead of visible literal markup; the same text no longer leaks into search or exports; an imported plain-text document paragraph keeps its line breaks in Word, PowerPoint, HTML and PDF.

★ No `[session link removed]...` URL in the changelog.

- [ ] **Step 4: The five ungated version sites**

★★ No gate checks any of these and they have drifted for eleven releases before.

```bash
grep -n '"version"' package.json
grep -n '"version": "0\.' package-lock.json | head -3
grep -n "img.shields.io" README.md
grep -rn "Generated:" docs/CODEMAPS/*.md
```

Update: `package.json` `version`; `package-lock.json` **both** occurrences (root `version` and `packages[""]`); the README shields badge **version and codename**; and the `<!-- Generated: … | App <version> "<codename>" … -->` header on all five codemaps.

- [ ] **Step 5: Verify every site agrees**

```bash
grep -rn "0\.228\.0" package.json package-lock.json README.md src/app/version.ts docs/CODEMAPS/*.md CHANGELOG.md | wc -l
```

Expected: at least 10 lines (1 version.ts + 1 changelog + 1 package.json + 2 lock + 1 README + 5 codemaps).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: release 0.228.0"
```

---

## Task 11: Full gate run

**Files:** none.

★★ Run these **serially**. Two vitest processes on one runner is the machine-saturation condition behind the load-sensitive flakes.

- [ ] **Step 1: Typecheck and lint**

```bash
npx tsc --noEmit; echo "TSC=$?"
npx eslint --max-warnings=0 src/app; echo "ESLINT=$?"
```

Expected: both `0`.

- [ ] **Step 2: Unit suite**

```bash
npm run test:run > /tmp/g1.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/g1.log
```

Expected: `EXIT=0`.

- [ ] **Step 3: Shuffled suite (the only local reproduction of that gate)**

```bash
npm run test:shuffle > /tmp/g2.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/g2.log
```

Expected: `EXIT=0`.

- [ ] **Step 4: Coverage floors**

```bash
npm run test:coverage > /tmp/g3.log 2>&1; echo "EXIT=$?"; grep -E "ERROR|threshold|All files" /tmp/g3.log | head -20
```

Expected: `EXIT=0`. ★ `html-start.ts` is a new coverage-gated `.ts` file. It is pure logic, not UI glue, so it stays **out** of `coverage.exclude` and carries its own tests — which Task 2 provides.

- [ ] **Step 5: The ratchets**

```bash
npm run size:check > /tmp/g4.log 2>&1; echo "SIZE=$?"; tail -3 /tmp/g4.log
npm run dup:check > /tmp/g5.log 2>&1; echo "DUP=$?"; tail -3 /tmp/g5.log
```

Expected: both `0`. ★ `size:check` counts `wc -l` **+ 1**; read a real number with
`node -e "console.log(require('fs').readFileSync('<file>','utf8').split('\n').length)"`.

- [ ] **Step 6: Goldens must not have moved**

```bash
git status --short src/app/__fixtures__; echo "EXIT=$?"
```

Expected: **empty output**.

★★★ This slice repairs nothing already stored, so a moved golden means the sample workspace holds a value whose classification just changed. That is a **finding to investigate, never a regeneration.** If a golden moved, stop and diff it before doing anything else.

- [ ] **Step 7: Build**

```bash
npm run build > /tmp/g6.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/g6.log
```

Expected: `EXIT=0`.

- [ ] **Step 8: Report**

Summarise every gate's exit code. ★ A "green" claim is worth exactly what the unpiped exit code behind it is — quote the numbers.

---

## Not in this slice

- Repairing already-escaped stored values — decision 1 of the spec.
- Widening or narrowing any allow-list, and any editor change — decision 3.
- §32, the same classifier failing the opposite way (plain prose taken for markup, words **deleted**). Different mechanism, different remediation. ★ Do not merge them into one "the classifier is unreliable" note.
- S4 and S3b.
- The *unify rich text* program — its own roadmap spec, after this ships.

★ This slice does not close the whole class: a model can still lead with `<h3>`, `<div>` or `<table>`, outside every allow-list, and those still escape. Deriving from the sink closes the cases a sink **advertises**, which is the boundary that can be argued for.
