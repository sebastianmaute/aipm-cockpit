# Rich text S2 — export fidelity for the entity rich fields — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Headings, list numbering, text alignment and task markers stored in the seven rich entity fields survive an export to DOCX, HTML and PDF instead of being flattened to plain text.

**Architecture:** `export-sections.ts` stops flattening rich columns and instead emits a `RichCell = { html, text }` carrying both representations. It stays DOM-free — every parse happens in the DOM-bound renderers that already parse. `RichLine` (in `rich-text-runs.ts`, the shared HTML→styled-runs model behind the OOXML renderers) grows heading level, list structure, alignment and a task marker; the DOCX and HTML renderers map the new fields, and XLSX/PPTX/CSV read `cell.text` and emit byte-identical output.

**Tech Stack:** TypeScript, React 19, Next 16, vitest + jsdom, raw OOXML string builders (no OOXML library), DOMPurify.

**Spec:** `docs/superpowers/specs/2026-08-16-rich-text-export-fidelity-s2-design.md`

---

## Preconditions

Branch `feat/rich-text-export-fidelity-s2` already exists off `origin/main` at `2e2c8c00` (0.242.0 "Ashby") and holds the spec commit `5d0a2c47`. Work continues on it.

## File structure

| File | Responsibility | Change |
|---|---|---|
| `src/app/rich-text-runs.ts` | HTML → `RichLine[]` (DOM-bound) | **Model + parser.** New line kinds, alignment, list counters |
| `src/app/export-sections.ts` | Pure section model (DOM-free) | `RichCell` type; `richCell` returns it for rich columns |
| `src/app/download.ts` | Shared download + print helpers | `htmlCellWithBreaks` signature tightened; `PRINT_STYLES` cell rules |
| `src/app/ooxml-docx-primitives.ts` | Raw DOCX builders | `buildDocxTable` accepts `RichCell`; new `docxRichParagraphs` |
| `src/app/doc-render-docx.ts` | Document → DOCX | `DOC_STYLES` gains `Heading4`; line→`pPr` mapping; `richParas` comment |
| `src/app/doc-render-html.ts` | Document → HTML | `tableHtml` renders a `RichCell` as markup |
| `src/app/doc-render-pptx.ts` | Document → PPTX | Handles the new kinds; entity cells stay `.text` |
| `src/app/export.ts` | Workspace → HTML/PDF | `renderSectionHtml` renders a `RichCell` as markup |
| `src/app/export-xlsx.ts` | Workspace → XLSX | Reads `.text` |
| `src/app/export-pptx.ts` | Workspace → PPTX | Reads `.text` |
| `src/app/ai-document-blocks.ts` | Model-written blocks | Compile fix only |
| `src/app/html-start.ts` | Sink classifiers | No change; its constants get two new importers |

**No new files**, so no `coverage.exclude` decision and no new coverage-gated module.

---

## Task 1: Extend the `RichLine` model

**Files:**
- Modify: `src/app/rich-text-runs.ts`
- Test: `src/app/rich-text-runs.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/app/rich-text-runs.test.ts`:

```ts
describe("heading, list, alignment and task structure (open-followups §141(b))", () => {
  it("carries the heading level", () => {
    const lines = htmlToRichLines("<h2>Title</h2>");
    expect(lines).toEqual([
      { kind: "heading", level: 2, runs: [{ text: "Title", marks: [] }] },
    ]);
  });

  it("clamps h5 and h6 to level 4", () => {
    // The editor emits h1-h4 (StarterKit levels: [1,2,3,4]), but stored legacy
    // markup can carry h5/h6. DOCX declares no Heading5, and Word SILENTLY
    // ignores an undeclared style, so the level is clamped rather than widened.
    expect(htmlToRichLines("<h5>a</h5>")[0]).toMatchObject({ kind: "heading", level: 4 });
    expect(htmlToRichLines("<h6>b</h6>")[0]).toMatchObject({ kind: "heading", level: 4 });
  });

  it("carries bullet list items at depth 0", () => {
    const lines = htmlToRichLines("<ul><li>one</li><li>two</li></ul>");
    expect(lines).toEqual([
      { kind: "li", ordered: false, depth: 0, index: 0, runs: [{ text: "one", marks: [] }] },
      { kind: "li", ordered: false, depth: 0, index: 1, runs: [{ text: "two", marks: [] }] },
    ]);
  });

  it("numbers an ordered list from zero", () => {
    const lines = htmlToRichLines("<ol><li>a</li><li>b</li><li>c</li></ol>");
    expect(lines.map((l) => (l.kind === "li" ? l.index : null))).toEqual([0, 1, 2]);
    expect(lines.every((l) => l.kind === "li" && l.ordered)).toBe(true);
  });

  it("restarts the counter for an ol nested in an ol", () => {
    // The renderer must never count: a nested list restarting at 1 is the
    // property, and a single flat counter gets it wrong at exactly this shape.
    const lines = htmlToRichLines(
      "<ol><li>a</li><li>b<ol><li>b1</li><li>b2</li></ol></li><li>c</li></ol>",
    );
    const li = lines.filter((l) => l.kind === "li");
    expect(li.map((l) => [l.depth, l.index])).toEqual([
      [0, 0], // a
      [0, 1], // b
      [1, 0], // b1  <- restarts
      [1, 1], // b2
      [0, 2], // c   <- outer counter resumes
    ]);
  });

  it("marks task items in both states", () => {
    const lines = htmlToRichLines(
      '<ul data-type="taskList">' +
        '<li data-type="taskItem" data-checked="true">done</li>' +
        '<li data-type="taskItem" data-checked="false">open</li>' +
        "</ul>",
    );
    expect(lines.map((l) => (l.kind === "li" ? l.task : null))).toEqual([
      "checked",
      "unchecked",
    ]);
  });

  it("reads alignment on EVERY kind, not just paragraphs", () => {
    // align is ORTHOGONAL to kind — that is why it is a shared base field and
    // not a kind. One assertion on a paragraph does not cover the property.
    expect(htmlToRichLines('<p data-align="center">p</p>')[0].align).toBe("center");
    expect(htmlToRichLines('<h3 data-align="right">h</h3>')[0].align).toBe("right");
    expect(
      htmlToRichLines('<ul><li data-align="justify">l</li></ul>')[0].align,
    ).toBe("justify");
  });

  it("leaves align undefined when the attribute is absent", () => {
    expect(htmlToRichLines("<p>plain</p>")[0].align).toBeUndefined();
  });

  it("ignores an out-of-domain align value", () => {
    // sanitizeRichHtml's ATTR_VALUES predicate already admits only the four,
    // but htmlToRichLines is also called on values that did not come through
    // it, so the parser does not trust the attribute.
    expect(htmlToRichLines('<p data-align="middle">x</p>')[0].align).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run src/app/rich-text-runs.test.ts --reporter=dot
```

Expected: FAIL. The heading/li assertions fail because both tags currently produce `kind: "p"`; `align` is `undefined` everywhere because the field does not exist.

- [ ] **Step 3: Replace the type declarations**

In `src/app/rich-text-runs.ts`, replace:

```ts
export type RichLineKind = "p" | "blockquote" | "pre" | "hr";

export type RichLine = { kind: RichLineKind; runs: TextRun[] };
```

with:

```ts
export type RichLineKind = "p" | "blockquote" | "pre" | "hr" | "heading" | "li";

/** Paragraph alignment. These are exactly `data-align`'s guarded values
 *  (`ATTR_VALUES` in sanitize-html.ts) — keep the two in step, or a value the
 *  sanitizer admits arrives here and is silently dropped. */
export type Align = "left" | "center" | "right" | "justify";

/** ★★ `align` lives on the BASE, not in a kind, because it is ORTHOGONAL to
 *  kind: a heading, a paragraph and a list item can each be centred. Making it
 *  a kind would need one kind per (kind × align) pair. */
type LineBase = { runs: TextRun[]; align?: Align };

/** Heading levels the editor can produce — StarterKit is configured
 *  `levels: [1, 2, 3, 4]` (rich-text-editor.tsx). Stored legacy markup may
 *  still carry h5/h6, which the parser CLAMPS to 4 rather than widening this:
 *  DOC_STYLES declares no Heading5, and a `w:pStyle` naming an undeclared style
 *  is SILENTLY IGNORED by Word. */
export type HeadingLevel = 1 | 2 | 3 | 4;

export type RichLine =
  | (LineBase & { kind: "p" | "blockquote" | "pre" })
  | (LineBase & { kind: "hr" })
  | (LineBase & { kind: "heading"; level: HeadingLevel })
  | (LineBase & {
      kind: "li";
      ordered: boolean;
      /** 0 for a top-level list, 1 for a list nested inside one, and so on. */
      depth: number;
      /** 0-based position WITHIN this depth. The parser owns the counters so a
       *  renderer never counts — a nested `<ol>` restarting at 1 is the
       *  property, and a single flat counter gets exactly that shape wrong. */
      index: number;
      task?: "checked" | "unchecked";
    });
```

- [ ] **Step 4: Teach the parser the new structure**

In the same file, replace the `NESTED_KIND_BY_TAG` / `LINE_TAGS` declarations. `LI` and `H1`-`H6` leave `LINE_TAGS` — they now carry their own kinds:

```ts
/** Elements that impose their own kind on every line inside them. */
const NESTED_KIND_BY_TAG: Record<string, BlockKind> = {
  BLOCKQUOTE: "blockquote",
  PRE: "pre",
};

/** Elements that end the current line and start a new one of the INHERITED
 *  kind.
 *
 *  ★★ `LI` and `H1`-`H6` USED TO LIVE HERE and no longer do. The comment they
 *  carried said giving `LI` a kind "would force both OOXML renderers to grow
 *  list numbering in a slice scoped to marks", and that heading LEVEL was the
 *  `heading` DocBlock's job. Both were true of that slice and are false now:
 *  the seven rich ENTITY fields reach these renderers through table cells,
 *  where there is no block model to carry the structure. See
 *  open-followups §141(b). */
const LINE_TAGS = new Set(["P", "DIV"]);

const HEADING_TAG = /^H([1-6])$/;
const ALIGN_VALUES: ReadonlySet<string> = new Set(["left", "center", "right", "justify"]);

/** The element's declared alignment, or undefined.
 *
 *  ★ The value is CHECKED rather than cast. `sanitizeRichHtml`'s ATTR_VALUES
 *  predicate already admits only these four, but `htmlToRichLines` is also
 *  called on values that never went through it (a renderer parses whatever it
 *  is handed), so the parser does not trust the attribute. */
function alignOf(el: Element): Align | undefined {
  const raw = el.getAttribute("data-align");
  return raw !== null && ALIGN_VALUES.has(raw) ? (raw as Align) : undefined;
}
```

Then rework the line-building internals of `htmlToRichLines`. `current` becomes a full `RichLine`, and `startLine` takes one:

```ts
  const lines: RichLine[] = [];
  let current: RichLine | null = null;
  /** One counter per open list depth. `push`/`pop` in the UL/OL arm is what
   *  makes a nested list restart and the outer one resume. */
  const listCounters: { ordered: boolean }[] = [];
  const listIndex: number[] = [];
```

`flush` keeps its shape but must preserve the extra fields — replace its final line:

```ts
    if (runs.some((r) => r.text.trim() !== "")) lines.push({ ...line, runs });
```

`startLine` takes the line rather than a kind:

```ts
  function startLine(line: RichLine): void {
    flush();
    current = line;
  }
```

Its three existing call sites become `startLine({ kind: "hr", runs: [] })`, `startLine({ kind: nested, runs: [], align: alignOf(el) })` and `startLine({ kind, runs: [], align: alignOf(el) })`.

`pushText`'s implicit-line branch keeps the inherited kind:

```ts
    if (!current) current = { kind, runs: [] } as RichLine;
```

Finally, add three arms to `walk`, immediately **before** the `LINE_TAGS` arm:

```ts
      if (tag === "UL" || tag === "OL") {
        flush();
        listCounters.push({ ordered: tag === "OL" });
        listIndex.push(0);
        walk(el, marks, kind);
        listCounters.pop();
        listIndex.pop();
        continue;
      }

      if (tag === "LI") {
        const depth = Math.max(0, listCounters.length - 1);
        const ordered = listCounters[depth]?.ordered ?? false;
        const index = listIndex[depth] ?? 0;
        if (listIndex.length > 0) listIndex[depth] = index + 1;
        const checked = el.getAttribute("data-checked");
        startLine({
          kind: "li",
          runs: [],
          align: alignOf(el),
          ordered,
          depth,
          index,
          ...(checked === "true"
            ? { task: "checked" as const }
            : checked === "false"
              ? { task: "unchecked" as const }
              : {}),
        });
        walk(el, marks, kind);
        flush();
        continue;
      }

      const heading = HEADING_TAG.exec(tag);
      if (heading) {
        // ★ CLAMPED, not widened — see HeadingLevel.
        const level = Math.min(4, Number(heading[1])) as HeadingLevel;
        startLine({ kind: "heading", runs: [], align: alignOf(el), level });
        walk(el, marks, kind);
        flush();
        continue;
      }
```

★ The `UL`/`OL` arm must come before `LI` is reached, and both before `LINE_TAGS`, because a `<li>` nested in a `<ul>` inside a `<li>` walks through all three.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
npx vitest run src/app/rich-text-runs.test.ts --reporter=dot
```

Expected: PASS, all pre-existing tests in the file included.

- [ ] **Step 6: Mutation-prove the two load-bearing assertions**

The nested-counter and the clamp are the two pieces a renderer cannot re-derive. Prove each test is not vacuous:

```bash
# 1. Break the nested counter: use a single flat counter.
#    Change `const depth = Math.max(0, listCounters.length - 1);` to `const depth = 0;`
npx vitest run src/app/rich-text-runs.test.ts --reporter=dot   # expect RED
# 2. Break the clamp: `Math.min(4, …)` -> `Number(heading[1])`
npx vitest run src/app/rich-text-runs.test.ts --reporter=dot   # expect RED (type error or level 5)
```

Revert both mutants before continuing. Record the red counts in the commit message.

- [ ] **Step 7: Typecheck and commit**

```bash
npx tsc --noEmit; echo "EXIT=$?"
```

Expected: **non-zero.** `doc-render-docx.ts`, `doc-render-pptx.ts` and `ai-document-blocks.ts` consume `RichLine` and have not been updated — that is Task 2, and tsc naming all three is the point of the union change. Commit the model + parser alone:

```bash
git add src/app/rich-text-runs.ts src/app/rich-text-runs.test.ts
git commit -m "feat(rich-text): carry heading level, list structure and alignment on RichLine"
```

---

## Task 2: Restore the existing `RichLine` consumers to green

**Files:**
- Modify: `src/app/doc-render-docx.ts`, `src/app/doc-render-pptx.ts`, `src/app/ai-document-blocks.ts`
- Test: `src/app/doc-render-pptx.test.ts`

**Scope note.** These three already parse rich lines for *document paragraph blocks*, so the new kinds reach them now, before any entity-cell work. DOCX gets its real mapping in Task 5. **PPTX gets the marker and heading treatment here** rather than being left inert: it would otherwise render a document's `<li>` with no bullet while the same document's DOCX shows one, and that inconsistency is worse than the small diff. PPTX **entity cells** remain flat — that is Task 4, and unaffected.

- [ ] **Step 1: Write the failing test**

Append to `src/app/doc-render-pptx.test.ts`:

```ts
describe("new RichLine kinds in a document paragraph block (§141(b))", () => {
  it("prefixes a list item with its marker and indents it", () => {
    const xml = renderDocumentPptxXml(
      docWith({ type: "paragraph", html: "<ol><li>first</li><li>second</li></ol>" }),
    );
    expect(xml).toContain("1. first");
    expect(xml).toContain("2. second");
  });

  it("does not indent a heading line", () => {
    const xml = renderDocumentPptxXml(
      docWith({ type: "paragraph", html: "<h2>Section</h2>" }),
    );
    expect(xml).toContain("Section");
    expect(xml).not.toContain(`marL="228600"`);
  });
});
```

Use the file's existing document-building and XML-extracting helpers; if it has none named as above, add a local `docWith` returning a `ProjectDocument` with a single block and reuse the file's existing render entry point.

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run src/app/doc-render-pptx.test.ts --reporter=dot
```

Expected: FAIL — no marker text is emitted, and the heading line currently takes the non-`p` indent branch.

- [ ] **Step 3: Move `bulletMarker` to the shared module**

`bulletMarker` currently lives in `doc-render-docx.ts` and is needed by two renderers. Move it to `src/app/rich-text-runs.ts` (it is pure and already beside the model it serves) and export it:

```ts
/** Marker text for a list item. Neither OOXML renderer carries a numbering
 *  definition — DOCX has no numbering.xml part and PPTX gets no bullet
 *  properties from this path — so the marker is literal TEXT, and `ordered`
 *  still has to be honoured or the author's choice is silently discarded.
 *  Native numbering is open-followups §153 (PPTX) and §154 (DOCX).
 *
 *  ★ TASK ITEMS REUSE THE FLAT PROJECTION'S CONSTANTS rather than spelling
 *  "[x] " again, so the OOXML and plain-text projections cannot drift on the
 *  trailing space. */
export function bulletMarker(
  ordered: boolean,
  index: number,
  task?: "checked" | "unchecked",
): string {
  if (task) return task === "checked" ? TASK_MARK_CHECKED.trim() : TASK_MARK_UNCHECKED.trim();
  return ordered ? `${index + 1}.` : "•";
}
```

Import `TASK_MARK_CHECKED` / `TASK_MARK_UNCHECKED` from `./rich-text-plain`. Update `doc-render-docx.ts` to import `bulletMarker` from `./rich-text-runs` instead of declaring it.

★ `rich-text-plain.ts` is DOM-FREE and `rich-text-runs.ts` is DOM-BOUND, so this import direction is legal. The reverse would not be.

- [ ] **Step 4: Handle the new kinds in PPTX**

In `src/app/doc-render-pptx.ts`, replace `bodyParagraph`:

```ts
function bodyParagraph(line: SlideLine): PptxParagraph {
  if (typeof line === "string") return { text: line, sizeHundredths: BODY_SIZE };
  if (line.kind === "hr") return { runs: [{ text: HR_TEXT }], sizeHundredths: BODY_SIZE };
  const runs = line.runs.map((run) => pptxRun(run, line.kind));
  // ★ The marker is a RUN, not a paragraph property: this path emits no bullet
  //   properties at all (see bulletMarker), so the ordinal has to be text or it
  //   is lost. It inherits no marks, so it never renders bold or struck.
  const marked =
    line.kind === "li"
      ? [{ text: `${bulletMarker(line.ordered, line.index, line.task)} ` }, ...runs]
      : runs;
  return {
    runs: marked,
    sizeHundredths: BODY_SIZE,
    indentEmu: pptxIndentFor(line),
  };
}

/** ★ A heading takes NO indent — it is a structural marker, not an aside, and
 *  indenting it would make a section title line up with a block quote. A list
 *  item indents per depth so nesting is visible; `p` is flush. */
function pptxIndentFor(line: Exclude<SlideLine, string>): number | undefined {
  if (line.kind === "p" || line.kind === "heading") return undefined;
  if (line.kind === "li") return RICH_INDENT_EMU * (line.depth + 1);
  return RICH_INDENT_EMU;
}
```

`pptxRun`'s `kind` parameter already takes `RichLineKind`, so it compiles unchanged; `heading` and `li` fall through its `blockquote`/`pre` checks and get no extra styling, which is correct.

- [ ] **Step 5: Fix `doc-render-docx.ts` and `ai-document-blocks.ts` to compile**

In `doc-render-docx.ts`, `DOCX_LINE_STYLE` is a `Partial<Record<RichLineKind, string>>`, so it still compiles; leave it for Task 5. Fix only what tsc names. Same for `ai-document-blocks.ts` — apply the minimal change that restores the build without altering behaviour.

- [ ] **Step 6: Run the tests and typecheck**

```bash
npx vitest run src/app/doc-render-pptx.test.ts src/app/doc-render-docx.test.ts src/app/ai-document-blocks.test.ts --reporter=dot
npx tsc --noEmit; echo "EXIT=$?"
```

Expected: tests PASS, `EXIT=0`.

- [ ] **Step 7: Commit**

```bash
git add src/app/rich-text-runs.ts src/app/doc-render-pptx.ts src/app/doc-render-docx.ts src/app/ai-document-blocks.ts src/app/doc-render-pptx.test.ts
git commit -m "feat(documents): render list markers and headings in PPTX paragraph blocks"
```

---

## Task 3: `RichCell` — carry html and text through the section model

**Files:**
- Modify: `src/app/export-sections.ts`, `src/app/download.ts`
- Test: `src/app/export-sections.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/app/export-sections.test.ts`:

```ts
describe("rich cells carry both representations (§141(b))", () => {
  const html = "<h2>Plan</h2><ol><li>first</li><li>second</li></ol>";

  it("emits a RichCell for a rich column", () => {
    const ws = wsWithTask({ description: html });
    const section = buildExportSections(ws, allSections, "en-US").find((s) => s.key === "tasks")!;
    const col = section.columns.indexOf("description");
    const cell = section.rows[0][col];
    expect(isRichCell(cell)).toBe(true);
    expect((cell as RichCell).html).toBe(html);
  });

  it("keeps .text byte-identical to the previous flat projection", () => {
    // This is the regression that proves the FLAT consumers did not move.
    const ws = wsWithTask({ description: html });
    const section = buildExportSections(ws, allSections, "en-US").find((s) => s.key === "tasks")!;
    const col = section.columns.indexOf("description");
    const cell = section.rows[0][col] as RichCell;
    expect(cell.text).toBe(descriptionTextWithBreaks(html));
  });

  it("leaves a NON-rich column a plain string", () => {
    const ws = wsWithTask({ description: html, title: "T" });
    const section = buildExportSections(ws, allSections, "en-US").find((s) => s.key === "tasks")!;
    const col = section.columns.indexOf("title");
    expect(isRichCell(section.rows[0][col])).toBe(false);
    expect(section.rows[0][col]).toBe("T");
  });
});
```

Reuse the file's existing workspace-building helper for `wsWithTask` and its existing full `ExportConfig` for `allSections`.

- [ ] **Step 2: Run to verify they fail**

```bash
npx vitest run src/app/export-sections.test.ts --reporter=dot
```

Expected: FAIL — `RichCell` and `isRichCell` do not exist.

- [ ] **Step 3: Add the type and the guard**

In `src/app/export-sections.ts`, above `ExportSection`:

```ts
/** A cell whose stored value is rich HTML.
 *
 *  ★★ IT CARRIES BOTH REPRESENTATIONS, ALWAYS. A renderer that can lay out
 *  paragraphs parses `html`; every other one reads `text`. That redundancy is
 *  the whole guarantee — a flat consumer can never accidentally receive markup,
 *  which is what a mode flag or a side-channel would have risked.
 *
 *  ★★ THIS MODULE STAYS DOM-FREE. The cell CARRIES html and never parses it —
 *  `htmlToRichLines` is DOMParser-bound, so every parse belongs in the
 *  DOM-bound renderers. Importing it here would put a DOM dependency in the
 *  pure section model. */
export type RichCell = { html: string; text: string };

export type ExportCell = string | number | RichCell;

export function isRichCell(cell: ExportCell): cell is RichCell {
  return typeof cell === "object" && cell !== null && "html" in cell;
}
```

Change `ExportSection.rows` to `ExportCell[][]` and replace `richCell`:

```ts
function richCell(value: string, column: string, rich: ReadonlySet<string>): ExportCell {
  if (!rich.has(column)) return value;
  return { html: value, text: descriptionTextWithBreaks(value) };
}
```

- [ ] **Step 4: Tighten `htmlCellWithBreaks`**

In `src/app/download.ts`:

```ts
/** ★★★ `string | number`, NOT `unknown`. This is the ONE consumer of an export
 *  cell that tsc would not name when the cell type widened — `unknown` accepts
 *  a RichCell silently and emits "[object Object]" into an HTML table. The
 *  narrow signature is what makes the widening safe; do not loosen it. */
export function htmlCellWithBreaks(cell: string | number): string {
  return htmlEscape(cell).replace(/\n/g, "<br>");
}
```

- [ ] **Step 5: Run the tests**

```bash
npx vitest run src/app/export-sections.test.ts --reporter=dot
```

Expected: PASS.

- [ ] **Step 6: Confirm tsc names every remaining consumer**

```bash
npx tsc --noEmit 2>&1 | grep -E "export\.ts|export-docx|export-xlsx|export-pptx|doc-render-html|doc-render-docx|doc-render-pptx|ooxml-docx"
```

Expected: errors in `export.ts`, `export-xlsx.ts`, `export-pptx.ts`, `doc-render-html.ts`, `doc-render-docx.ts`, `doc-render-pptx.ts` and `ooxml-docx-primitives.ts`. **Record this list in the commit message** — it is the measured blast radius, and Tasks 4–7 close it. If `export.ts` is absent from the list, Step 4 was not applied and the type-safety argument is void.

- [ ] **Step 7: Commit**

```bash
git add src/app/export-sections.ts src/app/download.ts src/app/export-sections.test.ts
git commit -m "feat(export): carry rich cells as { html, text } through the section model"
```

---

## Task 4: Flat consumers read `.text`

**Files:**
- Modify: `src/app/export-xlsx.ts`, `src/app/export-pptx.ts`, `src/app/doc-render-pptx.ts`
- Test: `src/app/export-xlsx.test.ts`, `src/app/export-pptx.test.ts`

- [ ] **Step 1: Write the failing byte-stability tests**

Add to each of `src/app/export-xlsx.test.ts` and `src/app/export-pptx.test.ts` (adapting the builder call to the file's existing helpers):

```ts
it("emits the same bytes for a rich cell as for its flat projection (§141(b))", async () => {
  const html = "<h2>Plan</h2><ul><li>one</li></ul>";
  const rich = { key: "tasks", title: "Tasks", columns: ["description"],
                 rows: [[{ html, text: descriptionTextWithBreaks(html) }]] } as ExportSection;
  const flat = { key: "tasks", title: "Tasks", columns: ["description"],
                 rows: [[descriptionTextWithBreaks(html)]] } as ExportSection;
  expect(await blobText(buildXlsx([rich]))).toBe(await blobText(buildXlsx([flat])));
});
```

Use `buildPptx([...], "en-US")` in the PPTX file. `blobText` unzips the package and concatenates the relevant part; reuse whatever the file already uses to inspect output.

- [ ] **Step 2: Run to verify they fail**

```bash
npx vitest run src/app/export-xlsx.test.ts src/app/export-pptx.test.ts --reporter=dot
```

Expected: FAIL — the rich cell stringifies to `[object Object]`.

- [ ] **Step 3: Add one shared flattener and use it**

In `src/app/export-sections.ts`:

```ts
/** The flat projection of any cell. The ONLY thing a renderer that cannot lay
 *  out paragraphs should call. */
export function cellText(cell: ExportCell): string | number {
  return isRichCell(cell) ? cell.text : cell;
}
```

In `export-xlsx.ts`, change `buildSheetXml`'s parameter to `ExportCell[][]` and its cell emit to `s(cellText(row[ci]))`.

In `export-pptx.ts`, change `buildPptxRowSlide`'s `row` to `ExportCell[]` and every `String(row[i] ?? "")` to `String(cellText(row[i] ?? ""))`.

In `doc-render-pptx.ts`, apply `cellText` where a `dataSection`'s rows are consumed.

- [ ] **Step 4: Run the tests**

```bash
npx vitest run src/app/export-xlsx.test.ts src/app/export-pptx.test.ts src/app/doc-render-pptx.test.ts --reporter=dot
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/export-sections.ts src/app/export-xlsx.ts src/app/export-pptx.ts src/app/doc-render-pptx.ts src/app/export-xlsx.test.ts src/app/export-pptx.test.ts
git commit -m "feat(export): flat renderers read the rich cell's text projection"
```

---

## Task 5: DOCX fidelity

**Files:**
- Modify: `src/app/doc-render-docx.ts`, `src/app/ooxml-docx-primitives.ts`, `src/app/export-docx.ts`
- Test: `src/app/doc-render-docx.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/app/doc-render-docx.test.ts`:

```ts
describe("rich entity cells in a DOCX table (§141(b))", () => {
  const cellXml = (html: string): string =>
    buildDocxTable(["description"], [[{ html, text: "ignored" }]]);

  it("renders a heading with its level's style", () => {
    expect(cellXml("<h2>Plan</h2>")).toContain(`<w:pStyle w:val="Heading2"/>`);
  });

  it("renders h4, whose style this slice had to declare", () => {
    expect(cellXml("<h4>Deep</h4>")).toContain(`<w:pStyle w:val="Heading4"/>`);
  });

  it("numbers an ordered list as literal marker text", () => {
    const xml = cellXml("<ol><li>first</li><li>second</li></ol>");
    expect(xml).toContain("1. first");
    expect(xml).toContain("2. second");
  });

  it("indents a nested list item one further step", () => {
    const xml = cellXml("<ul><li>a<ul><li>b</li></ul></li></ul>");
    expect(xml).toContain(`<w:ind w:left="720"/>`);
    expect(xml).toContain(`<w:ind w:left="1440"/>`);
  });

  it("marks a task item with the flat projection's own constant", () => {
    const xml = cellXml('<ul data-type="taskList"><li data-checked="true">done</li></ul>');
    expect(xml).toContain(`${TASK_MARK_CHECKED.trim()} done`);
  });

  it("maps justify to OOXML's `both`", () => {
    // ST_Jc spells justified as "both". Passing "justify" through is a value
    // Word does not recognise and silently drops.
    expect(cellXml('<p data-align="justify">x</p>')).toContain(`<w:jc w:val="both"/>`);
    expect(cellXml('<p data-align="center">x</p>')).toContain(`<w:jc w:val="center"/>`);
  });

  it("emits several paragraphs in ONE table cell", () => {
    const xml = cellXml("<p>one</p><p>two</p>");
    const cellBody = xml.slice(xml.indexOf("<w:tc>", xml.indexOf("</w:tr>")));
    expect((cellBody.match(/<w:p>/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
npx vitest run src/app/doc-render-docx.test.ts --reporter=dot
```

Expected: FAIL.

- [ ] **Step 3: Declare `Heading4`**

In `doc-render-docx.ts`, add to `DOC_STYLES` immediately after `Heading3`:

```
  <w:style w:type="paragraph" w:styleId="Heading4">
    <w:name w:val="heading 4"/>
    <w:pPr><w:spacing w:before="140" w:after="70"/><w:outlineLvl w:val="3"/></w:pPr>
    <w:rPr><w:b/><w:i/><w:color w:val="${COLOR_TEXT}"/><w:sz w:val="22"/></w:rPr>
  </w:style>
```

★ Palette constants only — a test pins that, so a hardcoded hex fails rather than silently shipping off-brand.

- [ ] **Step 4: Add the shared line→paragraph builder**

In `src/app/ooxml-docx-primitives.ts`:

```ts
/** OOXML's ST_Jc spelling for each alignment.
 *
 *  ★★★ `justify` IS `both`. Passing "justify" through emits a value Word does
 *  not recognise and SILENTLY DROPS, so the paragraph renders left-aligned with
 *  every string assertion still green. */
const JC_VALUE: Record<Align, string> = {
  left: "left",
  center: "center",
  right: "right",
  justify: "both",
};

const LIST_INDENT_TWIPS = 720;

/** One `RichLine` as one `<w:p>`.
 *
 *  ★★★ `<w:pPr>`'s children are an `xsd:sequence` (CT_PPr), exactly like the
 *  `<w:rPr>` ordering `DOCX_MARK_RPR`'s `rank` exists for. The order below is
 *  pStyle -> pBdr -> spacing -> ind -> jc, and a `<w:pPr>` emitted in any other
 *  order makes Word reject the part or drop the properties. A string-comparison
 *  test passes whatever the order, so this is pinned by its own assertion. */
export function docxRichParagraph(
  line: RichLine,
  styleOf: (line: RichLine) => string | undefined,
): string {
  if (line.kind === "hr") return HR_PARAGRAPH;
  const style = styleOf(line);
  const parts: string[] = [];
  if (style) parts.push(`<w:pStyle w:val="${style}"/>`);
  if (line.kind === "li") {
    parts.push(`<w:ind w:left="${LIST_INDENT_TWIPS * (line.depth + 1)}"/>`);
  }
  if (line.align) parts.push(`<w:jc w:val="${JC_VALUE[line.align]}"/>`);
  const pPr = parts.length > 0 ? `<w:pPr>${parts.join("")}</w:pPr>` : "";
  const marker =
    line.kind === "li"
      ? `<w:r>${docxCellRuns(`${bulletMarker(line.ordered, line.index, line.task)} `)}</w:r>`
      : "";
  return `<w:p>${pPr}${marker}${line.runs.map(markedRun).join("")}</w:p>`;
}
```

Move `HR_PARAGRAPH` and `markedRun` here from `doc-render-docx.ts`, or pass `markedRun` in — whichever keeps `doc-render-docx.ts` under its size baseline. Check both files before choosing:

```bash
node -e "for (const f of ['src/app/doc-render-docx.ts','src/app/ooxml-docx-primitives.ts']) console.log(f, require('fs').readFileSync(f,'utf8').split('\n').length)"
```

★ `size:check` counts `wc -l` **plus one**, so budget from the number this command prints, not from `wc -l`.

Add the style resolver in `doc-render-docx.ts`:

```ts
const DOCX_LINE_STYLE: Partial<Record<RichLineKind, string>> = {
  blockquote: "Quote",
  pre: "CodeBlock",
  li: "ListParagraph",
};

export function docxStyleFor(line: RichLine): string | undefined {
  return line.kind === "heading" ? `Heading${line.level}` : DOCX_LINE_STYLE[line.kind];
}
```

- [ ] **Step 5: Emit rich cells from `buildDocxTable`**

In `ooxml-docx-primitives.ts`, change `buildDocxTable`'s `rows` to `ExportCell[][]` and replace the body cell's paragraph:

```
            ${isRichCell(row[i])
              ? docxRichParagraphs((row[i] as RichCell).html)
              : `<w:p><w:r>${docxCellRuns(cellText(row[i] ?? ""))}</w:r></w:p>`}
```

where `docxRichParagraphs(html)` is `htmlToRichLines(descriptionHtml(html, RENDER_SINK)).map((l) => docxRichParagraph(l, docxStyleFor)).join("")`, with an empty-input guard returning a single empty `<w:p>` so a cell is never structurally empty.

- [ ] **Step 6: Rewrite the falsified comment**

In `doc-render-docx.ts`, `richParas`'s docstring currently reads *"Only ever called for a body-level `paragraph` block... Table cells never come through here — `buildDocxTable` takes plain strings — so no `<w:p>`/`<w:pBdr>` emitted here can land somewhere a paragraph is not allowed."* Replace with:

```ts
/** A rich paragraph block as one or more Word paragraphs.
 *
 *  ★★ AN EARLIER VERSION OF THIS COMMENT SAID "Table cells never come through
 *  here — buildDocxTable takes plain strings". That is FALSE as of §141(b):
 *  buildDocxTable now renders a RichCell through the same docxRichParagraph
 *  builder, so this shape reaches table cells too. The emission stays valid —
 *  `<w:p>` is legal inside `<w:tc>` — but the guarantee the old comment
 *  asserted no longer holds, so do not reason from it. */
```

- [ ] **Step 7: Run the tests and typecheck**

```bash
npx vitest run src/app/doc-render-docx.test.ts src/app/export-docx.test.ts --reporter=dot
npx tsc --noEmit; echo "EXIT=$?"
```

Expected: PASS, `EXIT=0`.

- [ ] **Step 8: Commit**

```bash
git add src/app/doc-render-docx.ts src/app/ooxml-docx-primitives.ts src/app/export-docx.ts src/app/doc-render-docx.test.ts
git commit -m "feat(export): render heading level, list numbering and alignment in DOCX"
```

---

## Task 6: The three DOCX invariant tests

These are the compensating controls for the fact that no test here can prove Word opens the file.

**Files:**
- Test: `src/app/doc-render-docx.test.ts`

- [ ] **Step 1: Write the tests**

```ts
describe("DOCX mechanical invariants — the failures Word makes SILENT (§141(b))", () => {
  /** Every style any renderer names must be declared, or Word ignores the
   *  pStyle and renders body text with every XML assertion still green. */
  it("declares every paragraph style it emits", () => {
    const xml = renderEverySupportedShape();          // one doc exercising all kinds
    const used = [...xml.matchAll(/<w:pStyle w:val="([^"]+)"\/>/g)].map((m) => m[1]);
    const declared = [...DOC_STYLES.matchAll(/w:styleId="([^"]+)"/g)].map((m) => m[1]);
    expect(used.length).toBeGreaterThan(0);           // guard against a vacuous pass
    for (const style of new Set(used)) expect(declared).toContain(style);
  });

  it("emits <w:pPr> children in schema sequence order", () => {
    const ORDER = ["w:pStyle", "w:pBdr", "w:spacing", "w:ind", "w:jc"];
    const xml = renderEverySupportedShape();
    for (const [, body] of xml.matchAll(/<w:pPr>(.*?)<\/w:pPr>/g)) {
      const seen = [...body.matchAll(/<(w:[a-zA-Z]+)[ />]/g)].map((m) => m[1]);
      const ranks = seen.map((t) => ORDER.indexOf(t)).filter((r) => r >= 0);
      expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    }
  });

  it("emits only legal ST_Jc values", () => {
    const xml = renderEverySupportedShape();
    for (const [, v] of xml.matchAll(/<w:jc w:val="([^"]+)"\/>/g)) {
      expect(["left", "center", "right", "both"]).toContain(v);
    }
  });
});
```

`renderEverySupportedShape()` is a local helper rendering one document whose blocks cover every `RichLine` kind, both list orderings, a nested list, a task item and all four alignments. Assert inside it that its own output is non-empty.

- [ ] **Step 2: Run — they should pass immediately**

```bash
npx vitest run src/app/doc-render-docx.test.ts --reporter=dot
```

Expected: PASS. These are invariants over Task 5's work, not new behaviour.

- [ ] **Step 3: Mutation-prove all three**

A green invariant test that cannot fail is worse than none — it reports coverage it does not have.

```bash
# (a) remove Heading4 from DOC_STYLES            -> style-declaration test RED
# (b) emit <w:jc> BEFORE <w:pStyle>              -> sequence test RED
# (c) map justify -> "justify"                   -> ST_Jc test RED
```

Run the suite after each, revert each before the next, and record 3/3 in the commit message.

- [ ] **Step 4: Commit**

```bash
git add src/app/doc-render-docx.test.ts
git commit -m "test(export): pin the three DOCX invariants Word fails silently on"
```

---

## Task 7: HTML and PDF fidelity

**Files:**
- Modify: `src/app/export.ts`, `src/app/doc-render-html.ts`, `src/app/download.ts`
- Test: `src/app/export.test.ts`, `src/app/doc-render-html.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
describe("rich cells in an HTML/PDF export table (§141(b))", () => {
  it("emits markup instead of escaping it", () => {
    const html = buildPdfHtml(wsWithTask({ description: "<h2>Plan</h2>" }), allSections, "en-US");
    expect(html).toContain("<h2>Plan</h2>");
    expect(html).not.toContain("&lt;h2&gt;");
  });

  it("re-sanitizes at the sink", () => {
    const html = buildPdfHtml(
      wsWithTask({ description: '<p onclick="x()">hi</p><script>bad()</script>' }),
      allSections, "en-US",
    );
    expect(html).toContain("hi");
    expect(html).not.toContain("onclick");
    expect(html).not.toContain("bad()");
  });

  it("still escapes a NON-rich cell", () => {
    const html = buildPdfHtml(wsWithTask({ title: "<b>not markup</b>" }), allSections, "en-US");
    expect(html).toContain("&lt;b&gt;");
  });
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
npx vitest run src/app/export.test.ts --reporter=dot
```

- [ ] **Step 3: Render the cell**

Add to `src/app/download.ts`:

```ts
/** One export cell as table-cell HTML.
 *
 *  ★★ The rich branch is the ONE unescaped path here, and it re-sanitizes at
 *  the SINK — idempotent, and the same defense-in-depth RichTextView and the
 *  comm-send preview already apply. A stored value is sanitizer-clean in
 *  principle; "in principle" is not what a sink relies on. */
export function exportCellHtml(cell: ExportCell): string {
  return isRichCell(cell)
    ? sanitizeRichHtml(descriptionHtml(cell.html, RENDER_SINK))
    : htmlCellWithBreaks(cell);
}
```

★ `descriptionHtml` first: a legacy plain-text value is not markup, and handing it straight to the sanitizer drops its line breaks (§118). `RENDER_SINK` because `htmlToRichLines` and the HTML sink keep every tag's text — a narrower classifier escapes the whole value.

Use it in `export.ts`'s `renderSectionHtml` and in `doc-render-html.ts`'s `tableHtml`, widening `tableHtml`'s `rows` to `readonly (readonly ExportCell[])[]`.

- [ ] **Step 4: Scope the print stylesheet**

In `PRINT_STYLES`, add rules so a heading inside a table cell does not blow the row apart:

```css
    td h1, td h2, td h3, td h4 { font-size: 1em; font-weight: 600; margin: 0 0 2pt; }
    td p { margin: 0 0 2pt; }
    td ul, td ol { margin: 0 0 2pt; padding-left: 14pt; }
    td blockquote { margin: 0 0 2pt 8pt; font-style: italic; }
    td pre { margin: 0; font-family: Consolas, monospace; white-space: pre-wrap; }
    td [data-align="center"] { text-align: center; }
    td [data-align="right"] { text-align: right; }
    td [data-align="justify"] { text-align: justify; }
```

★ Palette tokens only, and no `box-shadow` — `globals.css`'s palette sweep does not scan this string, so it is eye-discipline rather than a gate.

- [ ] **Step 5: Run the tests and typecheck**

```bash
npx vitest run src/app/export.test.ts src/app/doc-render-html.test.ts --reporter=dot
npx tsc --noEmit; echo "EXIT=$?"
```

- [ ] **Step 6: Commit**

```bash
git add src/app/export.ts src/app/doc-render-html.ts src/app/download.ts src/app/export.test.ts src/app/doc-render-html.test.ts
git commit -m "feat(export): render rich entity fields as markup in HTML and PDF"
```

---

## Task 8: The two riders

**Files:**
- Modify: `src/app/doc-render-docx.ts`, `src/app/doc-render-pptx.ts`
- Test: `src/app/doc-render-html.test.ts`, `src/app/html-start.test.ts`

- [ ] **Step 1: §141(d) — pin `CONTAINS_TAG`'s `/i`**

Add to `src/app/doc-render-html.test.ts`:

```ts
it("does not escape UPPERCASE legacy markup (open-followups §141(d))", () => {
  // CONTAINS_TAG is case-INSENSITIVE. Dropping its /i leaves 215 tests across
  // six files green while <P>/<STRONG> get escaped into Word, PowerPoint, the
  // HTML preview and the PDF. No fixture in any of those files carried an
  // uppercase-markup value; this is that fixture.
  const html = renderParagraphBlockHtml("Intro <STRONG>bold</STRONG> tail");
  expect(html).toContain("bold");
  expect(html).not.toContain("&lt;STRONG&gt;");
});
```

Mutation-prove it by removing `/i` from `CONTAINS_TAG` in `html-start.ts` — expect RED — then revert.

- [ ] **Step 2: §143 — convert the two renderer sink literals**

In `doc-render-docx.ts` and `doc-render-pptx.ts`, import `RENDER_SINK` from `./html-start` and replace the raw `"render"` literals. Re-derive the counts (8 + 25 = 33 must still hold before the change; 10 + 23 after):

```bash
git grep -nE 'descriptionHtml\(|sanitizeRichText\(|isHtmlStart\(' -- 'src/app/*.ts' 'src/app/*.tsx' \
  | grep -v '\.test\.' | grep -E '"(rich|document|projection|render)"' | grep -vE ':[0-9]+: *\*' | grep -c .
git grep -nE 'RICH_SINK|DOCUMENT_SINK|PROJECTION_SINK|RENDER_SINK' -- 'src/app/*.ts' 'src/app/*.tsx' \
  | grep -v '\.test\.' | grep -vE 'export const|import ' | grep -c .
```

- [ ] **Step 3: §143 — the construction test**

Add to `src/app/html-start.test.ts`:

```ts
describe("the document/projection sink pair is equivalent BY CONSTRUCTION (§143)", () => {
  // No input distinguishes these two, permanently, for as long as they derive
  // from one list — so no fixture-based test is possible and this pins the
  // PREMISE instead. It goes red the moment they diverge, at which point a
  // fixture becomes possible and should be written.
  it("shares one tag array", () => {
    expect(SINK_TAGS.projection).toBe(SINK_TAGS.document);
  });

  it("yields byte-identical regex source and flags", () => {
    const d = htmlStartRe(SINK_TAGS.document);
    const p = htmlStartRe(SINK_TAGS.projection);
    expect(p.source).toBe(d.source);
    expect(p.flags).toBe(d.flags);
  });
});
```

- [ ] **Step 4: Run and commit**

```bash
npx vitest run src/app/doc-render-html.test.ts src/app/html-start.test.ts --reporter=dot
git add src/app/doc-render-html.test.ts src/app/html-start.test.ts src/app/doc-render-docx.ts src/app/doc-render-pptx.ts
git commit -m "test(rich-text): pin CONTAINS_TAG's /i and the document/projection sink premise"
```

---

## Task 9: Documentation and the register

**Files:**
- Modify: `docs/open-followups.md`, `AGENTS.md`, `docs/CODEMAPS/data.md`

- [ ] **Step 1: Close §141(b) and §141(d)**

Mark both CLOSED with the date, and record the correction that the loss was never DOCX/PPTX-only — HTML and PDF were flattening the same values.

- [ ] **Step 2: Update §143**

Keep it open. Record that the construction test landed and the two renderer sites converted, with the re-derived counts from Task 8 Step 2.

- [ ] **Step 3: Open §153 and §154**

**§153 — PPTX export fidelity.** Its export renders one slide per row, not a table: columns 0–1 become title and subtitle, columns 2–7 become `"Label: value"` lines, capped at six extras (`columns.slice(2, 8)`), so a `description` column is frequently not on the slide at all. Covers native bullets (`buChar`/`buAutoNum`, no new package part) and a real table layout.

**§154 — native DOCX list numbering.** A `numbering.xml` part plus `[Content_Types].xml` and rels wiring, replacing the literal markers. Record that the blocker is not the XML but the absence of any detector for a malformed package part: the entry has to choose between package-level validation and an accepted manual-open step.

- [ ] **Step 4: Update `AGENTS.md`**

The rich-text bullet states that exports take the flat `descriptionTextWithBreaks` projection and that heading level and list numbering are lost. That is now true only of XLSX, PPTX and CSV. Correct it, name the `RichCell` shape, and state the DOM-free boundary (`export-sections.ts` carries, renderers parse).

★ Attach a command to each new claim and **run the command against the replacement text**, not against the error being corrected.

- [ ] **Step 5: Run the doc gates**

```bash
npm run docs:symbols:check; echo "EXIT=$?"
npm run docs:claims:check; echo "EXIT=$?"
```

Both must exit 0. Never re-baseline `docs/baselines/doc-line-cites.json` to admit a new citation.

- [ ] **Step 6: Commit**

```bash
git add docs/open-followups.md AGENTS.md docs/CODEMAPS/data.md
git commit -m "docs: close 141(b) and 141(d), open 153 and 154, correct the export-fidelity claims"
```

---

## Task 10: Release prep

**Files:**
- Modify: `src/app/version.ts`, `CHANGELOG.md`, `src/app/i18n.ts`, `src/app/i18n.de.ts`, `package.json`, `package-lock.json`, `README.md`, `docs/CODEMAPS/*.md`

- [ ] **Step 1: Pick an unused codename**

```bash
grep -oE '^## \[[0-9.]+\] - [0-9-]+ "[^"]+"' CHANGELOG.md | grep -oE '"[^"]+"' | sort -u | wc -l
```

★ Anchor on `^## \[` alone — a `^## \[…\] - ` anchor reports every em-dash entry as free and returns already-used names as available.

- [ ] **Step 2: Bump all eight sites**

`src/app/version.ts` (`APP_VERSION`, the build-date comment, the codename history block, `APP_MILESTONE`, `APP_HIGHLIGHT_KEYS`), `CHANGELOG.md`, the EN/DE `versionHighlight*` pair, `package.json`, `package-lock.json` (**two** occurrences), the README shields badge (version **and** codename), and the five `docs/CODEMAPS/*.md` headers.

★★ `src/app/version.ts` is **mixed CRLF/LF** and `i18n.ts`/`i18n.de.ts` are CRLF throughout. A node replace whose anchor uses `\n` silently no-ops on a CRLF line. Write the bump as a script with an **anchor-count refusal guard** on every replacement:

```js
const n = s.split(from).length - 1;
if (n !== expect) { console.error(`ANCHOR ${f} count=${n} expected=${expect} REFUSING`); process.exit(9); }
```

★ Never edit `i18n.de.ts` with the Edit tool — it corrupts umlauts and curls double quotes. Patch via a node utf8 write and re-verify.

★ No `[session link removed]...` URL in `CHANGELOG.md`.

- [ ] **Step 3: Run the full gate set**

Redirect and check the exit code unpiped — **never read a gate's exit code through a pipe.**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app; echo "EXIT=$?"
npm run size:check; echo "EXIT=$?"
npm run dup:check; echo "EXIT=$?"
npm run docs:symbols:check; echo "EXIT=$?"
npm run docs:claims:check; echo "EXIT=$?"
npm run test:run > /tmp/suite.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/suite.log
npm run test:shuffle > /tmp/shuffle.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/shuffle.log
npm run test:coverage > /tmp/cov.log 2>&1; echo "EXIT=$?"
```

★ Shard a run over 10 minutes **foreground** (`--shard=N/4`); backgrounding kills it and the notification reports the trailing `echo`'s exit code. Never run two vitest processes at once.

- [ ] **Step 4: Run the a11y gate**

```bash
npx playwright test e2e/a11y.spec.ts --project=chromium --workers=1
```

★ `--workers=1` always — CI runs axe serially and local runs it at CPU count; contention produces `Test timeout` failures that name no rule and are not violations.

- [ ] **Step 5: Manual verification — OWED, and named in the spec**

No test in this repo can prove Word or PowerPoint opens the file. Export a workspace whose task, RAID and change descriptions carry a heading, a nested ordered list, a task list and a centred paragraph, then:

1. Open the `.docx` in **Word** — headings styled, markers present and correctly numbered, nesting indented, alignment applied, no repair prompt.
2. Open the same file in **LibreOffice Writer** — it is stricter than Word about undeclared styles.
3. Print the HTML export to PDF — table rows are not blown apart by cell headings.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore(release): <version> \"<codename>\""
```

**Stop here.** Push, MR and merge require the user's explicit say-so.

---

## Self-review notes

- **Spec coverage:** every section of the design maps to a task — architecture and `RichCell` to Task 3, the model to Task 1, renderer mapping to Tasks 5 and 7, flat consumers to Task 4, riders to Task 8, testing to Tasks 1–8, out-of-scope and the two new register entries to Task 9.
- **One deviation from the spec, deliberate and flagged:** the spec described PPTX as flat throughout. PPTX *entity cells* are flat (Task 4), but PPTX *document paragraph blocks* already parse `RichLine`, so the new kinds reach them whether or not they are handled. Task 2 gives them the marker and heading treatment rather than leaving a document's list unbulleted in PPTX while its DOCX shows markers. This does not touch PPTX layout and does not pre-empt §153.
- **Type consistency:** `ExportCell`, `RichCell`, `isRichCell` and `cellText` are all introduced in `export-sections.ts` (Tasks 3 and 4) and used under those names in Tasks 4–7. `Align`, `HeadingLevel` and `bulletMarker` come from `rich-text-runs.ts` (Tasks 1 and 2) and are used under those names in Tasks 2 and 5.
