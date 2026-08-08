// src/app/rich-text-runs.ts — sanitized document HTML into styled runs.
//
// ★★ BROWSER-ONLY: uses DOMParser. That is the same posture as the two OOXML
// document renderers that consume it, and the opposite of rich-text-plain.ts,
// which is DOM-FREE by contract. Do not import this from an entity sanitizer or
// from the sample generator's import graph.
//
// ★ It emits NO XML. Two renderers consume one parse; putting the walk inside
// either of them guarantees the two drift on the next tag added.
//
// ★ Line splitting agrees with rich-text-projection's descriptionTextWithBreaks,
// the flat projection this replaces for the DOCX/PPTX paragraph path: one line
// per block boundary, adjacent boundaries never producing a blank line. What it
// adds is the marks that projection throws away.

export type RunMark =
  | "bold"
  | "italic"
  | "underline"
  | "strike"
  | "code"
  | "highlight"
  | "sub"
  | "sup";

export type TextRun = { text: string; marks: RunMark[] };

export type RichLineKind = "p" | "blockquote" | "pre" | "hr";

export type RichLine = { kind: RichLineKind; runs: TextRun[] };

/** The kinds a line can INHERIT from an enclosing element. "hr" is excluded on
 *  purpose — a rule holds no text, so nothing can ever be nested inside one. */
type BlockKind = Exclude<RichLineKind, "hr">;

/** Inline tags that contribute a mark to every run beneath them.
 *
 *  ★ B and I cannot reach here from stored markup today — sanitizeDocumentHtml's
 *  allow-list omits both and DOMPurify UNWRAPS an unlisted tag while keeping its
 *  text, so a `<b>` arrives as bare text. They are mapped anyway because the cost
 *  is one entry each and the failure they prevent is silent: a widened allow-list,
 *  or a caller handing us markup that has not been through the sanitizer, would
 *  otherwise drop the mark with nothing to notice it by. */
const MARK_BY_TAG: Record<string, RunMark> = {
  STRONG: "bold",
  B: "bold",
  EM: "italic",
  I: "italic",
  U: "underline",
  S: "strike",
  CODE: "code",
  MARK: "highlight",
  SUB: "sub",
  SUP: "sup",
};

/** Elements that impose their own kind on every line inside them. */
const NESTED_KIND_BY_TAG: Record<string, BlockKind> = {
  BLOCKQUOTE: "blockquote",
  PRE: "pre",
};

/** Elements that end the current line and start a new one of the INHERITED kind.
 *
 *  ★ LI is here rather than carrying a kind of its own, so a list inside a
 *  paragraph block exports as plain paragraphs and the bullet is lost. Deliberate
 *  for this slice: there is a separate `bullets` DocBlock kind that owns real
 *  lists, so `<li>` inside a *paragraph* block is an edge case, and giving it a
 *  kind would force both OOXML renderers to grow list numbering in a slice scoped
 *  to marks. It is no worse than the flat projection it replaces, which also
 *  dropped the bullet.
 *  ★ H1-H6 are here for a narrower reason: they must at least BREAK. Falling
 *  through to the mark branch left two adjacent headings appending to one line,
 *  fusing "<h1>a</h1><h2>b</h2>" into "ab". Heading LEVEL is not represented —
 *  the block model has a `heading` DocBlock for that. */
const LINE_TAGS = new Set(["P", "DIV", "LI", "H1", "H2", "H3", "H4", "H5", "H6"]);

/** DOM node types, spelled numerically so the module does not depend on the
 *  `Node` global being present as a value. */
const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

const WS_RUN = /\s+/g;
const LEADING_WS = /^\s+/;
const TRAILING_WS = /\s+$/;

const addMark = (marks: readonly RunMark[], mark: RunMark): RunMark[] =>
  marks.includes(mark) ? [...marks] : [...marks, mark];

/** Strip the whitespace at the two ENDS of a line, walking inwards past runs that
 *  are whitespace-only, and drop whatever that empties.
 *
 *  ★ Only the ends. A space BETWEEN two runs is the word boundary that keeps
 *  "<em>a</em> b" from exporting as "ab", so it has to survive — which is why
 *  this cannot be a per-run trim.
 *  ★ It walks past emptied runs rather than trimming only the first and last:
 *  "<p> <em> a </em> </p>" puts the real leading space one run further in, and a
 *  first-and-last-only trim leaves it as a stray indent in the exported line. */
function trimLineEdges(runs: readonly TextRun[]): TextRun[] {
  const out = runs.map((r) => ({ ...r }));
  for (const run of out) {
    run.text = run.text.replace(LEADING_WS, "");
    if (run.text !== "") break;
  }
  for (let i = out.length - 1; i >= 0; i -= 1) {
    const run = out[i];
    run.text = run.text.replace(TRAILING_WS, "");
    if (run.text !== "") break;
  }
  return out.filter((r) => r.text !== "");
}

/** Parse sanitized document HTML into flat lines of styled runs.
 *
 *  ★ A <br> ENDS the current line rather than emitting a marker, so a renderer
 *  never has to know about break elements — it emits one paragraph per line.
 *  ★ Whitespace-only lines are dropped, which is what makes an empty <p> from
 *  the editor disappear rather than emitting a blank paragraph in the export.
 *  That rule is uniform, so a blank line inside a <pre> collapses too — accepted:
 *  the alternative is a kind-specific exception that every consumer then has to
 *  know about. */
export function htmlToRichLines(html: string): RichLine[] {
  if (!html) return [];
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const lines: RichLine[] = [];
  let current: RichLine | null = null;

  /** Finish the line in progress, keeping it only if it carries visible text.
   *
   *  ★ `current` is read into a local and cleared FIRST so the "the line in
   *  progress is consumed either way" invariant is visible at a glance — a
   *  dropped whitespace-only line must not stay open and leak its runs into the
   *  next one. This is readability, NOT a typecheck workaround: `current` is a
   *  `let` several nested closures assign, but tsc narrows it fine in every shape
   *  tried here (measured — `npx tsc --noEmit` is clean on the `if (!current)
   *  current = …; current.runs.push(…)` form in pushText below). */
  function flush(): void {
    const line = current;
    current = null;
    if (!line) return;
    if (line.kind === "hr") {
      lines.push(line);
      return;
    }
    // A <pre> line keeps its own indentation — trimming it would defeat the one
    // property that makes preformatted text worth a kind of its own.
    const runs = line.kind === "pre" ? line.runs : trimLineEdges(line.runs);
    if (runs.some((r) => r.text.trim() !== "")) lines.push({ kind: line.kind, runs });
  }

  function startLine(kind: RichLineKind): void {
    flush();
    current = { kind, runs: [] };
  }

  function pushText(text: string, marks: readonly RunMark[], kind: BlockKind): void {
    if (text === "") return;
    if (!current) current = { kind, runs: [] };
    current.runs.push({ text, marks: [...marks] });
  }

  /** Preformatted text: whitespace is kept verbatim and a newline ENDS the line,
   *  so a multi-line code block stays multi-line instead of collapsing into one
   *  run-on paragraph. */
  function pushPreText(raw: string, marks: readonly RunMark[]): void {
    const parts = raw.split("\n");
    for (let i = 0; i < parts.length; i += 1) {
      if (i > 0) flush();
      pushText(parts[i], marks, "pre");
    }
  }

  function walk(node: Node, marks: readonly RunMark[], kind: BlockKind): void {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === TEXT_NODE) {
        const raw = (child as Text).data;
        if (kind === "pre") pushPreText(raw, marks);
        else pushText(raw.replace(WS_RUN, " "), marks, kind);
        continue;
      }
      if (child.nodeType !== ELEMENT_NODE) continue;
      const el = child as Element;
      const tag = el.tagName.toUpperCase();

      if (tag === "BR") {
        flush();
        continue;
      }
      if (tag === "HR") {
        startLine("hr");
        flush();
        continue;
      }

      const nested = NESTED_KIND_BY_TAG[tag];
      if (nested) {
        startLine(nested);
        walk(el, marks, nested);
        flush();
        continue;
      }
      if (LINE_TAGS.has(tag)) {
        startLine(kind);
        walk(el, marks, kind);
        flush();
        continue;
      }

      const mark = MARK_BY_TAG[tag];
      walk(el, mark ? addMark(marks, mark) : marks, kind);
    }
  }

  walk(doc.body, [], "p");
  flush();
  return lines;
}
