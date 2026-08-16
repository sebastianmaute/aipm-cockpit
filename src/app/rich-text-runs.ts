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

import { TASK_MARK_CHECKED, TASK_MARK_UNCHECKED } from "./rich-text-plain";

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

/** The kinds a line can INHERIT from an enclosing element.
 *
 *  ★ "hr" is excluded because a rule holds no text, so nothing can ever be
 *  nested inside one. "heading" and "li" are excluded for a different reason:
 *  each carries fields the walk cannot invent from an inherited kind alone (a
 *  level, a depth+index), so they are only ever produced by their OWN arm of
 *  the walk. Spelling this out rather than `Exclude<RichLineKind, "hr">` is
 *  what lets `pushText` build an inherited line with no cast. */
type BlockKind = "p" | "blockquote" | "pre";

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
/** Marker text for a list item. Neither OOXML renderer carries a numbering
 *  definition — DOCX has no numbering.xml part and PPTX gets no bullet
 *  properties from this path — so the marker is literal TEXT, and `ordered`
 *  still has to be honoured or the author's choice is silently discarded.
 *  Native numbering is open-followups §153 (PPTX) and §154 (DOCX).
 *
 *  ★★ It lives HERE, beside the model it serves, because BOTH renderers need
 *  it: it used to be declared identically in each of them, which is the shape
 *  that drifts on the next fix (and the one the BLOCKING jscpd gate flags).
 *
 *  ★ `ordered` is `boolean | undefined`, not `boolean`: a `RichLine` of kind
 *  "li" always carries one, but the `bullets` DocBlock's own `ordered` is
 *  OPTIONAL and both renderers feed that through here too.
 *
 *  ★ TASK ITEMS REUSE THE FLAT PROJECTION'S CONSTANTS rather than spelling
 *  "[x] " again, so the OOXML and plain-text projections cannot drift on the
 *  marker itself. `.trim()` drops their trailing space because every caller
 *  adds its own separator — see the callers, which append " " unconditionally
 *  so an ordered marker and a task marker are spaced alike. */
export function bulletMarker(
  ordered: boolean | undefined,
  index: number,
  task?: "checked" | "unchecked",
): string {
  if (task) return task === "checked" ? TASK_MARK_CHECKED.trim() : TASK_MARK_UNCHECKED.trim();
  return ordered ? `${index + 1}.` : "•";
}

export function htmlToRichLines(html: string): RichLine[] {
  if (!html) return [];
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const lines: RichLine[] = [];
  let current: RichLine | null = null;
  /** One counter per open list depth. `push`/`pop` in the UL/OL arm is what
   *  makes a nested list restart and the outer one resume. */
  const listCounters: { ordered: boolean }[] = [];
  const listIndex: number[] = [];

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
    if (runs.some((r) => r.text.trim() !== "")) lines.push({ ...line, runs });
  }

  function startLine(line: RichLine): void {
    flush();
    current = line;
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
        startLine({ kind: "hr", runs: [] });
        flush();
        continue;
      }

      const nested = NESTED_KIND_BY_TAG[tag];
      if (nested) {
        startLine({ kind: nested, runs: [], align: alignOf(el) });
        walk(el, marks, nested);
        flush();
        continue;
      }

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

      if (LINE_TAGS.has(tag)) {
        startLine({ kind, runs: [], align: alignOf(el) });
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
