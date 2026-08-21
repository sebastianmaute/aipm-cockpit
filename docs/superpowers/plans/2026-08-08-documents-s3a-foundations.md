# Documents S3a — Foundations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give project documents their own HTML allow-list with eight new tags, and make the `.docx` and `.pptx` renderers carry text marks instead of flattening them — so formatting the model already writes stops vanishing on export.

**Architecture:** A documents-only sanitizer (`sanitizeDocumentHtml`) sits beside the existing shared one, which is deliberately left untouched. A new pure module (`rich-text-runs.ts`) parses sanitized HTML into a list of styled runs; the DOCX and PPTX renderers each emit their own OOXML from that one structure, replacing today's flat-text projection.

**Tech Stack:** TypeScript, DOMPurify, vitest, WordprocessingML / DrawingML (hand-built XML, no OOXML library).

---

## Context an engineer needs before starting

**Baseline:** `origin/main` at or after `02c66259` (0.223.0 "Okorafor" plus the §107 correction).

**This slice ships no UI.** No component changes, no i18n keys, no a11y surface.

**Two items were deliberately removed from S3a and must NOT be attempted here:**

1. **§54 (prod CSP blocks ProseMirror's CSS)** — its fix is undecided and needs a spike first.
2. **The `HTML_START` classifier split** — the naive version re-breaks the narrative path. See `docs/open-followups.md` §107's correction block.

**The single most important constraint:** `sanitizeTemplateHtml` is shared by comm templates, meeting reports and the six rich entity fields. **Do not widen it.** Task 1 adds a *new* function; Task 7 pins that the old one did not move.

### Gate rules that bite in this repo

- **Never read a gate's exit code through a pipe.** `npm run test:run | tail -5` reports `tail`'s status. Do this instead:
  ```bash
  npm run test:run > /tmp/suite.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/suite.log
  ```
- `npm run lint` is bare `eslint` and **exits 0 even with warnings**. The real CI gate is `npx eslint --max-warnings=0 src/app` — an unused import is fatal.
- `npx tsc --noEmit` after editing **any** test. `next build` does not typecheck `*.test.ts` and vitest never typechecks.
- The regex `/s` (dotAll) flag **fails tsc** here (target < es2018). Use `[\s\S]` instead.
- New `.ts` files are coverage-gated (`vitest.config.ts` floors: lines 92 / funcs 91 / branch 80 / stmts 89). Both new modules in this plan are pure and fully tested, so they clear it — do not add them to `coverage.exclude`.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/app/sanitize-html.ts` *(modify)* | Add `DOCUMENT_ALLOWED_TAGS` + `sanitizeDocumentHtml`. Existing exports untouched. |
| `src/app/sanitize-html.test.ts` *(modify)* | Cover the new function, and pin that the shared one did not widen. |
| `src/app/ai-document-blocks.ts` *(modify)* | Route the AI document write boundary to the documents sanitizer. |
| `src/app/ai-rich-text.ts` *(modify)* | Add `sanitizeAiDocumentRichText` beside `sanitizeAiRichText`; the shared one is unchanged. |
| `src/app/doc-render-html.ts` *(modify, line 98)* | The render sink switches to `sanitizeDocumentHtml`. |
| `src/app/rich-text-runs.ts` *(create)* | HTML → `RichLine[]` of styled `TextRun`s. Browser-only (uses `DOMParser`). One responsibility: parsing. Emits no XML. |
| `src/app/rich-text-runs.test.ts` *(create)* | Unit tests for the parser. |
| `src/app/doc-render-docx.ts` *(modify)* | Emit `<w:r><w:rPr>…` per run for `paragraph` blocks. |
| `src/app/doc-render-pptx.ts` *(modify)* | Emit `<a:r><a:rPr>…` per run for `paragraph` blocks. |

`rich-text-runs.ts` is deliberately separate from both renderers: the parse is one decision, and two renderers consume it. Putting the walk inside either renderer guarantees they drift.

---

### Task 1: `sanitizeDocumentHtml` — the documents-only allow-list

**Files:**
- Modify: `src/app/sanitize-html.ts`
- Test: `src/app/sanitize-html.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/app/sanitize-html.test.ts`:

```ts
describe("sanitizeDocumentHtml", () => {
  it("keeps the eight tags documents add beyond the template list", () => {
    const html =
      "<p><s>a</s><code>b</code><mark>c</mark><sub>d</sub><sup>e</sup></p>" +
      "<pre>f</pre><blockquote>g</blockquote><hr>";
    const out = sanitizeDocumentHtml(html);
    for (const tag of ["s", "code", "mark", "sub", "sup", "pre", "blockquote", "hr"]) {
      expect(out).toContain(`<${tag}`);
    }
  });

  it("keeps an image reference by id and drops any src", () => {
    const out = sanitizeDocumentHtml('<p><img data-asset-id="7" src="https://x/y.png" alt="a"></p>');
    expect(out).toContain('data-asset-id="7"');
    expect(out).not.toContain("src=");
  });

  it("strips a script but KEEPS the words of an unknown tag", () => {
    // KEEP_CONTENT stays at DOMPurify's default: unwrap, do not delete text.
    expect(sanitizeDocumentHtml("<p><script>alert(1)</script>hi</p>")).not.toContain("<script");
    expect(sanitizeDocumentHtml("<div>kept</div>")).toContain("kept");
  });

  it("does not widen the SHARED template sanitizer", () => {
    // The guard that matters: documents gained tags, everyone else did not.
    expect(sanitizeTemplateHtml("<p><mark>x</mark></p>")).not.toContain("<mark");
    expect(sanitizeTemplateHtml("<blockquote>y</blockquote>")).not.toContain("<blockquote");
  });
});
```

Add `sanitizeDocumentHtml` to the existing import at the top of that test file.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run src/app/sanitize-html.test.ts > /tmp/t1.log 2>&1; echo "EXIT=$?"; grep -E "Tests |sanitizeDocumentHtml" /tmp/t1.log
```

Expected: FAIL — `sanitizeDocumentHtml is not exported` / `is not a function`.

- [ ] **Step 3: Implement**

In `src/app/sanitize-html.ts`, after the existing `sanitizeTemplateHtml`, add:

```ts
/** Documents-only allow-list. WIDER than ALLOWED_TAGS on purpose, and separate
 *  from it on purpose: sanitizeTemplateHtml also serves comm templates, meeting
 *  reports and the six rich entity fields, so widening THAT list would change
 *  what a model may store everywhere — retroactively, including how already
 *  stored HTML renders. rich-text-editor.tsx:64 records that hazard as the
 *  reason an earlier slice disabled input rules rather than widen a list.
 *
 *  ★★ KEEP_CONTENT stays at DOMPurify's DEFAULT (unwrap, keep the words), NOT
 *  sanitizeNoteHtml's `false`. A document is prose a person will read; losing a
 *  paragraph's text because it was wrapped in an unlisted tag is worse than
 *  losing its formatting.
 *
 *  ★★ `img` carries `data-asset-id` and NO src. Images are referenced by id so
 *  that no URI ever enters stored block HTML — ALLOWED_URI_REGEXP would have to
 *  admit `data:` otherwise, and `data:text/html` is an XSS vector. Inert until
 *  S3c ships the asset store; allow-listed here so stored markup written by a
 *  later slice is never retroactively stripped by this one. */
const DOCUMENT_ALLOWED_TAGS = [
  ...ALLOWED_TAGS,
  "s", "code", "pre", "blockquote", "hr", "mark", "sub", "sup", "img",
];
const DOCUMENT_ALLOWED_ATTR = [...ALLOWED_ATTR, "data-asset-id", "alt"];

export function sanitizeDocumentHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: DOCUMENT_ALLOWED_TAGS,
    ALLOWED_ATTR: DOCUMENT_ALLOWED_ATTR,
    ALLOWED_URI_REGEXP: /^(?:https?|mailto):[^<>"]*$/i,
  });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run src/app/sanitize-html.test.ts > /tmp/t1.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/t1.log
```

Expected: PASS, exit 0.

- [ ] **Step 5: Typecheck and lint**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app; echo "EXIT=$?"
```

Both exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/app/sanitize-html.ts src/app/sanitize-html.test.ts
git commit -m "feat: add sanitizeDocumentHtml, a documents-only allow-list"
```

---

### Task 2: Route the render sink to the documents sanitizer

**Files:**
- Modify: `src/app/doc-render-html.ts:98`
- Test: `src/app/doc-render-html.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/app/doc-render-html.test.ts`:

The file already has a `preview(blocks)` helper at `doc-render-html.test.ts:22` — use it, do not build a document by hand:

```ts
it("renders a document paragraph's new marks instead of stripping them", () => {
  const out = preview([{ type: "paragraph", html: "<p><mark>hi</mark> <s>gone</s></p>" }]);
  expect(out).toContain("<mark");
  expect(out).toContain("<s");
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run src/app/doc-render-html.test.ts > /tmp/t2.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/t2.log
```

Expected: FAIL — `<mark>` is stripped by the template sanitizer.

- [ ] **Step 3: Implement**

In `src/app/doc-render-html.ts`, change the import to `sanitizeDocumentHtml` and the `paragraph` case:

```ts
    // The ONE unescaped path: already-sanitized HTML, re-sanitized here.
    case "paragraph":
      return sanitizeDocumentHtml(block.html);
```

Update the file's header comment block that names `sanitizeTemplateHtml` so it names `sanitizeDocumentHtml` and keeps its existing reasoning about why it is not `sanitizeNoteHtml` (`KEEP_CONTENT: false` would delete words).

- [ ] **Step 4: Run it to verify it passes**

```bash
npx vitest run src/app/doc-render-html.test.ts > /tmp/t2.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/t2.log
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/doc-render-html.ts src/app/doc-render-html.test.ts
git commit -m "feat: route the document render sink to sanitizeDocumentHtml"
```

---

### Task 3: Route the AI document write boundary

**Files:**
- Modify: `src/app/ai-rich-text.ts`
- Modify: `src/app/ai-document-blocks.ts:45`
- Test: `src/app/ai-document-blocks.test.ts`

★★ `sanitizeAiRichText` is SHARED with the six rich entity fields. Add a sibling; do not change it.

- [ ] **Step 1: Write the failing test**

Append to `src/app/ai-document-blocks.test.ts`:

```ts
it("lets a model store the document marks but still strips a script", () => {
  const blocks = sanitizeAiDocBlocks([
    { type: "paragraph", html: "<p><mark>keep</mark></p>" },
    { type: "paragraph", html: "<p><script>alert(1)</script>text</p>" },
  ]);
  expect(blocks[0]).toMatchObject({ type: "paragraph" });
  expect((blocks[0] as { html: string }).html).toContain("<mark");
  expect((blocks[1] as { html: string }).html).not.toContain("<script");
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run src/app/ai-document-blocks.test.ts > /tmp/t3.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/t3.log
```

Expected: FAIL — `<mark>` stripped.

- [ ] **Step 3: Implement**

In `src/app/ai-rich-text.ts`, beside the existing export, add:

```ts
/** The documents variant. Same two layers as sanitizeAiRichText — the DOM-free
 *  upgrade first, the DOMPurify allow-list second — but the second layer is the
 *  WIDER documents list. Kept as a separate function rather than a parameter so
 *  that a call site cannot accidentally hand entity-field HTML the wider list. */
export function sanitizeAiDocumentRichText(value: string): string {
  return sanitizeDocumentHtml(sanitizeRichText(value) ?? "");
}
```

Import `sanitizeDocumentHtml` from `./sanitize-html`. Match the existing function's handling of an empty result exactly — read it first and mirror it.

In `src/app/ai-document-blocks.ts:45`, swap the call:

```ts
    return { ...(block as Record<string, unknown>), html: sanitizeAiDocumentRichText(html) };
```

and update the import.

- [ ] **Step 4: Run it to verify it passes**

```bash
npx vitest run src/app/ai-document-blocks.test.ts src/app/ai-rich-text.test.ts > /tmp/t3.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/t3.log
```

Expected: PASS, and `ai-rich-text.test.ts` still green (the shared function is unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/app/ai-rich-text.ts src/app/ai-document-blocks.ts src/app/ai-document-blocks.test.ts
git commit -m "feat: route the AI document write boundary to the documents allow-list"
```

---

### Task 4: `rich-text-runs.ts` — HTML into styled runs

**Files:**
- Create: `src/app/rich-text-runs.ts`
- Test: `src/app/rich-text-runs.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/app/rich-text-runs.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { htmlToRichLines } from "./rich-text-runs";

describe("htmlToRichLines", () => {
  it("splits block boundaries into lines and carries no marks on plain text", () => {
    expect(htmlToRichLines("<p>one</p><p>two</p>")).toEqual([
      { kind: "p", runs: [{ text: "one", marks: [] }] },
      { kind: "p", runs: [{ text: "two", marks: [] }] },
    ]);
  });

  it("carries each mark on the run it wraps", () => {
    const [line] = htmlToRichLines("<p>a<strong>b</strong><em>c</em></p>");
    expect(line.runs).toEqual([
      { text: "a", marks: [] },
      { text: "b", marks: ["bold"] },
      { text: "c", marks: ["italic"] },
    ]);
  });

  it("accumulates nested marks onto one run", () => {
    const [line] = htmlToRichLines("<p><strong><em>x</em></strong></p>");
    expect(line.runs).toEqual([{ text: "x", marks: ["bold", "italic"] }]);
  });

  it("maps every document tag to its mark or line kind", () => {
    expect(htmlToRichLines("<p><s>a</s></p>")[0].runs[0].marks).toEqual(["strike"]);
    expect(htmlToRichLines("<p><u>a</u></p>")[0].runs[0].marks).toEqual(["underline"]);
    expect(htmlToRichLines("<p><mark>a</mark></p>")[0].runs[0].marks).toEqual(["highlight"]);
    expect(htmlToRichLines("<p><code>a</code></p>")[0].runs[0].marks).toEqual(["code"]);
    expect(htmlToRichLines("<p><sub>a</sub></p>")[0].runs[0].marks).toEqual(["sub"]);
    expect(htmlToRichLines("<p><sup>a</sup></p>")[0].runs[0].marks).toEqual(["sup"]);
    expect(htmlToRichLines("<blockquote>q</blockquote>")[0].kind).toBe("blockquote");
    expect(htmlToRichLines("<pre>c</pre>")[0].kind).toBe("pre");
    expect(htmlToRichLines("<hr>")[0].kind).toBe("hr");
  });

  it("turns <br> into a line break within the same block", () => {
    expect(htmlToRichLines("<p>a<br>b</p>")).toEqual([
      { kind: "p", runs: [{ text: "a", marks: [] }] },
      { kind: "p", runs: [{ text: "b", marks: [] }] },
    ]);
  });

  it("returns no lines for empty or whitespace-only html", () => {
    expect(htmlToRichLines("")).toEqual([]);
    expect(htmlToRichLines("<p>   </p>")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run src/app/rich-text-runs.test.ts > /tmp/t4.log 2>&1; echo "EXIT=$?"; grep -E "Tests |Cannot find" /tmp/t4.log
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/app/rich-text-runs.ts`:

```ts
// src/app/rich-text-runs.ts — sanitized document HTML into styled runs.
//
// ★★ BROWSER-ONLY: uses DOMParser. That is the same posture as the two OOXML
// document renderers that consume it (doc-render-docx.ts's own header records
// it as DOM-BOUND), and the opposite of rich-text-plain.ts, which is DOM-FREE
// by contract. Do not import this from an entity sanitizer or from the sample
// generator's import graph.
//
// ★ It emits NO XML. Two renderers consume one parse; putting the walk inside
// either of them guarantees the two drift on the next tag added.

export type RunMark =
  | "bold" | "italic" | "underline" | "strike" | "code" | "highlight" | "sub" | "sup";

export type TextRun = { text: string; marks: RunMark[] };

export type RichLineKind = "p" | "blockquote" | "pre" | "hr";

export type RichLine = { kind: RichLineKind; runs: TextRun[] };

const MARK_BY_TAG: Record<string, RunMark> = {
  STRONG: "bold", B: "bold",
  EM: "italic", I: "italic",
  U: "underline",
  S: "strike",
  CODE: "code",
  MARK: "highlight",
  SUB: "sub",
  SUP: "sup",
};

const LINE_KIND_BY_TAG: Record<string, RichLineKind> = {
  BLOCKQUOTE: "blockquote",
  PRE: "pre",
};

/** Parse sanitized document HTML into flat lines of styled runs.
 *
 *  ★ A <br> ENDS the current line rather than emitting a marker, so a renderer
 *  never has to know about break elements — it emits one paragraph per line.
 *  ★ Whitespace-only lines are dropped, which is what makes an empty <p> from
 *  the editor disappear rather than emitting a blank paragraph in the export. */
export function htmlToRichLines(html: string): RichLine[] {
  if (!html) return [];
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const lines: RichLine[] = [];
  let current: RichLine | null = null;

  const startLine = (kind: RichLineKind) => {
    flush();
    current = { kind, runs: [] };
  };

  function flush() {
    if (current && (current.kind === "hr" || current.runs.length > 0)) lines.push(current);
    current = null;
  }

  function pushText(text: string, marks: RunMark[]) {
    if (!text) return;
    if (!current) current = { kind: "p", runs: [] };
    current.runs.push({ text, marks: [...marks] });
  }

  function walk(node: Node, marks: RunMark[]) {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 3) {
        // Collapse runs of whitespace the way the HTML renderer would, but keep
        // a single separating space so "<em>a</em> b" does not fuse to "ab".
        const text = (child.textContent ?? "").replace(/\s+/g, " ");
        if (text.trim() === "" && !current?.runs.length) continue;
        pushText(text, marks);
        continue;
      }
      if (child.nodeType !== 1) continue;
      const el = child as Element;
      const tag = el.tagName.toUpperCase();

      if (tag === "BR") { flush(); continue; }
      if (tag === "HR") { startLine("hr"); flush(); continue; }

      const lineKind = LINE_KIND_BY_TAG[tag];
      if (lineKind) { startLine(lineKind); walk(el, marks); flush(); continue; }

      if (tag === "P" || tag === "LI" || tag === "DIV") {
        startLine("p"); walk(el, marks); flush(); continue;
      }

      const mark = MARK_BY_TAG[tag];
      walk(el, mark ? [...marks, mark] : marks);
    }
  }

  walk(doc.body, []);
  flush();
  return lines.map((l) => ({
    ...l,
    runs: l.runs.map((r) => ({ ...r, text: r.text })).filter((r) => r.text !== ""),
  })).filter((l) => l.kind === "hr" || l.runs.some((r) => r.text.trim() !== ""));
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run src/app/rich-text-runs.test.ts > /tmp/t4.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/t4.log
```

Expected: PASS. If a whitespace case fails, fix the implementation — not the test — unless the test's expectation is itself wrong about what the HTML renderer does.

★ Expect one likely tsc complaint: `current` is a `let` captured by several closures, and TypeScript does not always keep the non-null narrowing across them. If `npx tsc --noEmit` flags `current` as possibly null inside `pushText` or `flush`, assign to a local first (`const line = current ?? { kind: "p", runs: [] }; current = line;`) rather than reaching for `!`.

- [ ] **Step 5: Typecheck**

```bash
npx tsc --noEmit; echo "EXIT=$?"
```

- [ ] **Step 6: Commit**

```bash
git add src/app/rich-text-runs.ts src/app/rich-text-runs.test.ts
git commit -m "feat: parse sanitized document HTML into styled runs"
```

---

### Task 5: Mark-aware DOCX paragraphs

**Files:**
- Modify: `src/app/doc-render-docx.ts`
- Test: `src/app/doc-render-docx.test.ts`

- [ ] **Step 1: Write the failing test**

The file already has `doc(blocks, title?)` at `:23` and `documentXml(d, w?)` at `:47` — use those:

```ts
it("emits Word run properties for each mark in a paragraph", async () => {
  const xml = await documentXml(
    doc([{ type: "paragraph", html: "<p><strong>b</strong><em>i</em><u>u</u><s>s</s></p>" }]),
  );
  expect(xml).toContain("<w:b/>");
  expect(xml).toContain("<w:i/>");
  expect(xml).toContain('<w:u w:val="single"/>');
  expect(xml).toContain("<w:strike/>");
});

it("emits a subscript run property", async () => {
  const xml = await documentXml(doc([{ type: "paragraph", html: "<p><sub>x</sub></p>" }]));
  expect(xml).toContain('<w:vertAlign w:val="subscript"/>');
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run src/app/doc-render-docx.test.ts > /tmp/t5.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/t5.log
```

Expected: FAIL — the current path flattens to text and emits no `<w:rPr>`.

- [ ] **Step 3: Implement**

In `src/app/doc-render-docx.ts`, add above `renderBlock`:

```ts
const DOCX_MARK_XML: Record<RunMark, string> = {
  bold: "<w:b/>",
  italic: "<w:i/>",
  underline: '<w:u w:val="single"/>',
  strike: "<w:strike/>",
  highlight: '<w:highlight w:val="yellow"/>',
  code: '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>',
  sub: '<w:vertAlign w:val="subscript"/>',
  sup: '<w:vertAlign w:val="superscript"/>',
};

/** One run, carrying its marks. `docxCellRuns` still does the escaping and the
 *  newline→<w:br/> mapping, so text and table cells cannot diverge on either. */
function markedRun(run: TextRun): string {
  const rPr = run.marks.length
    ? `<w:rPr>${run.marks.map((m) => DOCX_MARK_XML[m]).join("")}</w:rPr>`
    : "";
  return `<w:r>${rPr}${docxCellRuns(run.text)}</w:r>`;
}

const DOCX_LINE_STYLE: Partial<Record<RichLineKind, string>> = {
  blockquote: "Caption",
  pre: "Caption",
};

/** A rich paragraph block as one or more Word paragraphs. */
function richParas(html: string): string {
  const lines = htmlToRichLines(html);
  if (lines.length === 0) return "";
  return lines
    .map((line) => {
      if (line.kind === "hr") {
        return `<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="${COLOR_MEDIUM_GREY}"/></w:pBdr></w:pPr></w:p>`;
      }
      const style = DOCX_LINE_STYLE[line.kind];
      const pPr = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : "";
      return `<w:p>${pPr}${line.runs.map(markedRun).join("")}</w:p>`;
    })
    .join("");
}
```

Import `htmlToRichLines`, `type RunMark`, `type TextRun`, `type RichLineKind` from `./rich-text-runs`. Then change the `paragraph` case:

```ts
    case "paragraph":
      return richParas(block.html);
```

★ Leave `descriptionTextWithBreaks` imported only if another case still uses it. If nothing does, **remove the import** — an unused import is a fatal lint error under `--max-warnings=0`.

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run src/app/doc-render-docx.test.ts > /tmp/t5.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/t5.log
```

Expected: PASS, including every pre-existing test in the file.

- [ ] **Step 5: Lint and typecheck**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app; echo "EXIT=$?"
```

- [ ] **Step 6: Commit**

```bash
git add src/app/doc-render-docx.ts src/app/doc-render-docx.test.ts
git commit -m "feat: carry text marks into .docx paragraph runs"
```

---

### Task 6: Mark-aware PPTX paragraphs

**Files:**
- Modify: `src/app/doc-render-pptx.ts`
- Test: `src/app/doc-render-pptx.test.ts`

★ Read `doc-render-pptx.ts:155` and its surrounding function first. Today the `paragraph` case returns `string[]` (lines) and something downstream turns each into an `<a:p>`. The change is to return styled lines instead, so the downstream emitter needs the same treatment — follow the file's existing shape rather than forcing the DOCX structure onto it.

- [ ] **Step 1: Write the failing test**

The file already has `doc(blocks, title?)` at `:33` and `slides(d, w?)` at `:55`, which returns an array of slide XML strings — use those:

```ts
it("emits DrawingML run properties for each mark", async () => {
  const [xml] = await slides(
    doc([{ type: "paragraph", html: "<p><strong>b</strong><em>i</em><u>u</u></p>" }]),
  );
  expect(xml).toContain('b="1"');
  expect(xml).toContain('i="1"');
  expect(xml).toContain('u="sng"');
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run src/app/doc-render-pptx.test.ts > /tmp/t6.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/t6.log
```

Expected: FAIL — no run properties emitted.

- [ ] **Step 3: Implement**

Add to `src/app/doc-render-pptx.ts`:

```ts
/** DrawingML run properties for a run's marks. Attributes, not elements —
 *  <a:rPr> takes b/i/u/strike as attributes, unlike WordprocessingML's child
 *  elements, so the two renderers cannot share one mark table. */
function pptxRunProps(marks: readonly RunMark[]): string {
  const attrs: string[] = [];
  if (marks.includes("bold")) attrs.push('b="1"');
  if (marks.includes("italic")) attrs.push('i="1"');
  if (marks.includes("underline")) attrs.push('u="sng"');
  if (marks.includes("strike")) attrs.push('strike="sngStrike"');
  if (marks.includes("sub")) attrs.push('baseline="-25000"');
  if (marks.includes("sup")) attrs.push('baseline="30000"');
  return attrs.length ? ` ${attrs.join(" ")}` : "";
}
```

Then, in the emitter that builds `<a:p>` for a paragraph block, emit one `<a:r>` per run:

```ts
`<a:r><a:rPr lang="en-US"${pptxRunProps(run.marks)}/><a:t>${xmlEscape(run.text)}</a:t></a:r>`
```

Route the `paragraph` case through `htmlToRichLines(block.html)` so each `RichLine` becomes one `<a:p>`.

★ `highlight` and `code` have no clean DrawingML attribute equivalent — emit them unstyled rather than approximating. Record that in a comment beside `pptxRunProps` so the omission reads as a decision, not an oversight.

- [ ] **Step 4: Run to verify it passes**

```bash
npx vitest run src/app/doc-render-pptx.test.ts > /tmp/t6.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/t6.log
```

- [ ] **Step 5: Commit**

```bash
git add src/app/doc-render-pptx.ts src/app/doc-render-pptx.test.ts
git commit -m "feat: carry text marks into .pptx paragraph runs"
```

---

### Task 7: Full gate run and byte-stability check

**Files:** none modified unless a gate fails.

- [ ] **Step 1: Run the full unit suite**

```bash
npm run test:run > /tmp/suite.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/suite.log
```

Expected: exit 0. **If `golden-workspace.test` fails, STOP and read the diff.** That suite pins exact CSV/Markdown bytes for the *workspace* exporter, which this slice does not touch — a failure there means something leaked out of the documents path into the shared one, which is the exact regression Task 1 was shaped to prevent. Do **not** regenerate the fixtures to make it pass.

- [ ] **Step 2: Run the shuffled suite**

```bash
npm run test:shuffle > /tmp/shuf.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/shuf.log
```

Expected: exit 0. This is the only local reproduction of the blocking `unit-tests-shuffled` CI job.

- [ ] **Step 3: Run coverage**

```bash
npm run test:coverage > /tmp/cov.log 2>&1; echo "EXIT=$?"; grep -E "All files|ERROR" /tmp/cov.log
```

Expected: exit 0. `rich-text-runs.ts` is new and coverage-gated; if it drags a floor down, add tests rather than an exclusion — it is pure logic, not UI glue.

- [ ] **Step 4: Run the remaining gates**

```bash
npx tsc --noEmit; echo "TSC=$?"
npx eslint --max-warnings=0 src/app; echo "LINT=$?"
npm run size:check > /tmp/size.log 2>&1; echo "SIZE=$?"; tail -3 /tmp/size.log
npm run dup:check > /tmp/dup.log 2>&1; echo "DUP=$?"; tail -3 /tmp/dup.log
npm run build > /tmp/build.log 2>&1; echo "BUILD=$?"; tail -3 /tmp/build.log
```

All exit 0. ★ `size:check` counts `wc -l` **+ 1** — a file at `wc -l` 799 is already at the 800 limit.

- [ ] **Step 5: Commit any fixes**

```bash
git add -- <only the files you changed>
git commit -m "fix: <what the gate caught>"
```

★ Name the files explicitly. `git add -A` has swept unrelated repairs into a commit in this repo before.

---

## What this slice deliberately does NOT do

- **No UI.** The editor is S3b.
- **No §54 fix.** Needs a spike; must land before S3b.
- **No `HTML_START` change.** Documents keep the 8-tag classification, which escapes rather than deletes and is therefore safe. See §107's correction block.
- **No widening of `sanitizeTemplateHtml`.** Task 1 step 1 pins this.
- **No image behaviour.** `img`/`data-asset-id` are allow-listed but inert until S3c.
- **No code for two of the three cross-cutting policies.** The spec assigns them to S3a, and they are settled *as decisions* — but neither has an implementation here, deliberately:
  - *"Content versions; references and metadata do not"* binds the new `DocMutation` kinds that S4 and S3c add. There are no new kinds in this slice, so there is nothing to write. Its first real test is S4's link/unlink.
  - *One shared dangling-reference presentation* is **built in S4**, which is the first slice with a dangling case. Building it here would be a component with no consumer.

  The third — derive-per-sink for allow-list/classifier pairs — is the policy behind the `HTML_START` split, which moved out of S3a entirely.
