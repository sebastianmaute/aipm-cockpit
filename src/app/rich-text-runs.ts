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
  /** ★ DELIBERATELY NOT `LineBase`. A rule holds no text, so there is nothing to
   *  align, and it is CONSTRUCTED as `{ kind: "hr", runs: [] }` at the one site
   *  that makes one — an `align` in scope here could never be anything but
   *  `undefined`, while reading to a consumer as a field that is sometimes set.
   *  `runs` stays so every member has one and a consumer can reach `line.runs`
   *  without narrowing first. */
  | { kind: "hr"; runs: TextRun[] }
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
      /** Set on a line that CONTINUES an item whose first line has already gone
       *  out — the text after a `<br>`, or a second `<p>`.
       *
       *  ★★ It carries the FULL geometry, not a reduced one: a continuation is
       *  built by spreading the item it belongs to, so `ordered`/`depth`/
       *  `index`/`task` cannot drift from the line above and a renderer indents
       *  the two identically. What it asks of a renderer is one thing only —
       *  SUPPRESS the marker. A list item has one bullet however many lines it
       *  wraps to.
       *  ★ `true`, not `boolean`: `continuation: false` is unrepresentable, so
       *  `if (line.continuation)` is the only test a renderer can write.
       *  ★ It is OMITTED from a head line rather than set to `undefined` — the
       *  same argument the `hr` member above makes about `align`, and the one
       *  reason `align` gets away with breaking it is that it predates this. */
      continuation?: true;
    });

/** A list-item line — the shape a continuation is copied FROM. */
type LiLine = Extract<RichLine, { kind: "li" }>;

/** The kinds a line can INHERIT from an enclosing element.
 *
 *  ★ "hr" is excluded because a rule holds no text, so nothing can ever be
 *  nested inside one. "heading" and "li" are excluded for a different reason:
 *  each carries fields the walk cannot invent from an inherited kind alone (a
 *  level, a depth+index), so they are only ever produced by their OWN arm of
 *  the walk. Spelling this out rather than `Exclude<RichLineKind, "hr">` is
 *  what lets `pushText` build an inherited line with no cast.
 *
 *  ★★ "li" stays excluded even though a CONTINUATION is one: the walk still
 *  cannot invent a depth and an index, so it copies them off the live item
 *  instead (`continuationOf`). The item travels beside the kind, never in it. */
type BlockKind = "p" | "blockquote" | "pre";

/** A line continuing `item`: the item's geometry, its own runs, no marker.
 *
 *  ★★ BUILT BY SPREADING THE ITEM rather than by copying four named fields, so
 *  a field added to the `li` member is carried automatically and the two lines
 *  cannot describe different geometry.
 *
 *  ★★★ `align` IS THE CALLER'S TO DECIDE AND OVERRIDES THE ITEM'S, INCLUDING
 *  WHEN IT IS ABSENT — because the answer differs between the two shapes that
 *  produce a continuation, and this helper cannot tell them apart:
 *    • a SECOND `<p>` is a NEW paragraph, so it declares its own alignment and a
 *      centred first paragraph must not centre a left-aligned second one
 *      (alignment is per-PARAGRAPH: TextAlign is configured
 *      `types: ["heading", "paragraph"]` in rich-text-editor.tsx);
 *    • a `<br>` is a break WITHIN one paragraph, so both halves belong to the
 *      SAME `<p data-align="…">` and the caller passes that paragraph's align —
 *      hardcoding `undefined` there rendered one bullet half centred, half left.
 *  Which is why `walk` carries the alignment in force beside the kind. */
function continuationOf(item: LiLine, align: Align | undefined): LiLine {
  return { ...item, runs: [], align, continuation: true };
}

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

/** Whether a line carries anything a reader would see.
 *
 *  ★ This is the SURVIVAL predicate — `flush` keeps a line exactly when it holds
 *  visible text — and the LI-transparency guard asks the same question of a line
 *  still in progress ("would this be dropped if flushed right now?"). One helper
 *  so the two cannot drift.
 *  ★ Trimming does not change the answer: `trimLineEdges` only removes
 *  whitespace, so it can never turn a visible run invisible. That is why the
 *  guard may ask it of UNtrimmed runs. */
const hasVisibleText = (runs: readonly TextRun[]): boolean =>
  runs.some((r) => r.text.trim() !== "");

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
    if (hasVisibleText(runs)) lines.push({ ...line, runs });
  }

  function startLine(line: RichLine): void {
    flush();
    current = line;
  }

  /** Make the FIRST line an item put into the output its HEAD, so it carries
   *  the marker.
   *
   *  ★★★ THE DEFECT. An item whose own `li` line is DROPPED — it starts empty
   *  and a `<br>`, an `<hr>` or a heading closes it before any text arrives —
   *  re-opens at `pushText` as a CONTINUATION, and every renderer suppresses the
   *  marker on one. Its ordinal is still spent, so the exported list showed an
   *  unmarked line and then "2.", with no "1." anywhere.
   *
   *  ★★ It runs AFTER the item's walk because the question — "did the item's own
   *  head line survive `flush`?" — cannot be answered until that line has been
   *  flushed. Asking it FORWARD needs a witness travelling beside every line in
   *  progress, which is the identity Set 0.243.0 deliberately shed; asking it
   *  BACKWARD needs only the span this arm already snapshots for the ordinal.
   *
   *  ★★ `depth` narrows to the lines this item OWNS. A nested list's items sit
   *  one deeper and are heads of their own, so promoting one would move the
   *  outer item's marker inside its sub-list.
   *
   *  ★ It promotes ONE line. Every later `li` line at this depth is a genuine
   *  continuation, and a second promoted line would put two bullets on one item.
   *
   *  ★ AN ITEM WITH NO `li` LINE AT ALL IS LEFT ALONE, and that is the residue:
   *  `<li><h2>h</h2></li>` and `<li><ul>…</ul></li>` emit only lines of another
   *  kind, which keep that kind (and lose the indent) by §156 and cannot carry a
   *  marker. Such an item still spends its ordinal and renders none —
   *  open-followups §157. */
  function promoteItemHead(from: number, depth: number): void {
    for (let i = from; i < lines.length; i += 1) {
      const line = lines[i];
      if (line.kind !== "li" || line.depth !== depth) continue;
      if (line.continuation) {
        // ★ `delete` on a fresh copy, not a rest-destructure: the field must be
        // ABSENT on a head, never own-and-undefined (see the `continuation`
        // docblock), and this promoted head has to be indistinguishable from one
        // the LI arm opened itself.
        const head = { ...line };
        delete head.continuation;
        lines[i] = head;
      }
      return;
    }
  }

  /** ★ `item` is the list item this text belongs to, or null outside one. It is
   *  what makes the text after a `<br>` re-open as a CONTINUATION of the item
   *  rather than as a bare inherited line at zero indent. */
  /** ★★ `align` is the alignment of the block this text sits in, which the
   *  re-opened line has to inherit: `<br>` ends a line WITHOUT ending the
   *  paragraph, so the half after it belongs to the same declaration as the half
   *  before. Built from the kind alone, the second half exported unaligned. */
  function pushText(
    text: string,
    marks: readonly RunMark[],
    kind: BlockKind,
    item: LiLine | null,
    align: Align | undefined,
  ): void {
    if (text === "") return;
    if (!current) current = item === null ? { kind, runs: [], align } : continuationOf(item, align);
    current.runs.push({ text, marks: [...marks] });
  }

  /** Preformatted text: whitespace is kept verbatim and a newline ENDS the line,
   *  so a multi-line code block stays multi-line instead of collapsing into one
   *  run-on paragraph. */
  /** ★ No `item`: a `<pre>` is never walked with one (see the walk's nested
   *  arm), so its line breaks always re-open as `pre` lines. */
  function pushPreText(raw: string, marks: readonly RunMark[], align: Align | undefined): void {
    const parts = raw.split("\n");
    for (let i = 0; i < parts.length; i += 1) {
      if (i > 0) flush();
      pushText(parts[i], marks, "pre", null, align);
    }
  }

  /** `inListItem` says the children being iterated are the DIRECT content of an
   *  `<li>`, which is what turns on the transparency arm below. Everywhere else
   *  it is false, including inside a transparent element — see that arm.
   *
   *  ★★ `item` is a DIFFERENT question and the two are deliberately separate
   *  parameters: `inListItem` is one level deep ("may this element BECOME the
   *  item's own line?"), while `item` travels as far as the item's inherited
   *  kind does ("does a line opened here CONTINUE the item?") — through the
   *  transparent paragraph, through a `<span>`, through a second `<p>`. Every
   *  element that imposes a kind of its OWN — `<blockquote>`, `<pre>`, `<hN>`,
   *  and a nested `<ul>`/`<ol>` — clears it to null, which is what stops a
   *  nested item or a quoted line from inheriting the outer item's geometry.
   *
   *  ★★ `align` is the alignment IN FORCE — the one declared by the block whose
   *  children these are. It travels for the same reason `kind` does: a `<br>`
   *  re-opens a line mid-paragraph, and that line has to be built from the
   *  paragraph it is still inside. Every arm that OPENS a block declares its
   *  own (`alignOf(el)`); an inline mark passes the one it was given straight
   *  through, since `<em>` is not a paragraph. */
  function walk(
    node: Node,
    marks: readonly RunMark[],
    kind: BlockKind,
    inListItem = false,
    item: LiLine | null = null,
    align: Align | undefined = undefined,
  ): void {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === TEXT_NODE) {
        const raw = (child as Text).data;
        if (kind === "pre") pushPreText(raw, marks, align);
        else pushText(raw.replace(WS_RUN, " "), marks, kind, item, align);
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

      // ★★ A <blockquote> or <pre> inside an <li> KEEPS ITS OWN KIND and is
      // therefore NOT a continuation — walked with `item` cleared. The kind is
      // the point of both: a <pre>'s verbatim whitespace and monospace face are
      // exactly what turning it into an `li` line to win the indent would throw
      // away. The cost is that such a line loses the item's indent
      // (open-followups §156); losing the indent beats losing the kind.
      const nested = NESTED_KIND_BY_TAG[tag];
      if (nested) {
        const nestedAlign = alignOf(el);
        startLine({ kind: nested, runs: [], align: nestedAlign });
        walk(el, marks, nested, false, null, nestedAlign);
        flush();
        continue;
      }

      if (tag === "UL" || tag === "OL") {
        flush();
        listCounters.push({ ordered: tag === "OL" });
        listIndex.push(0);
        // ★ `item` cleared: a nested list's items are produced by the LI arm at
        // their OWN depth and index, and must inherit nothing from the item
        // they are nested inside.
        walk(el, marks, kind, false, null);
        listCounters.pop();
        listIndex.pop();
        continue;
      }

      if (tag === "LI") {
        const depth = Math.max(0, listCounters.length - 1);
        const ordered = listCounters[depth]?.ordered ?? false;
        const index = listIndex[depth] ?? 0;
        const checked = el.getAttribute("data-checked");
        const item: LiLine = {
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
        };
        // ★ The item's OWN align is what a break directly inside a bare
        // `<li data-align="right">a<br>b</li>` inherits. Where the item's text
        // sits in a transparent paragraph instead, that arm re-declares it.
        startLine(item);
        // ★★★ THE ORDINAL IS SPENT WHEN THE ITEM RENDERED, NOT WHEN ITS OWN
        // LINE SURVIVED. The question is "did this item put ANYTHING into
        // `lines`", so the witness is the output's length across the item's
        // walk — snapshotted AFTER `startLine`, which is the moment `current`
        // is this item and nothing earlier can still be pending.
        //
        // ★★ It used to be the IDENTITY of the flushed li line, and that answered
        // a NARROWER question: an item whose only child kept its own kind (an
        // <h2>, a <blockquote>, a nested list) emitted lines while its own empty
        // li line was dropped, so it spent no number and every later sibling
        // rendered one too LOW — "1." on the second item of a client-facing DOCX.
        // ★★ The comment that chose identity rejected a length delta for
        // "crediting this item with its CHILDREN's lines". A delta does do that,
        // and it is CORRECT that it does: an <li> holding only a sub-list still
        // occupies a numbered slot in every browser and in Word. What the old
        // reasoning was really protecting is the EMPTY item, which a delta gets
        // right for the same reason — it contributes nothing, so nothing counts.
        const outputBefore = lines.length;
        walk(el, marks, kind, true, item, item.align);
        flush();
        promoteItemHead(outputBefore, depth);
        // ★ AFTER the walk. The `listIndex.length` guard keeps a stray <li> with
        // no enclosing list from writing a counter that does not exist.
        if (listIndex.length > 0 && lines.length > outputBefore) listIndex[depth] = index + 1;
        continue;
      }

      const heading = HEADING_TAG.exec(tag);
      if (heading) {
        // ★ CLAMPED, not widened — see HeadingLevel.
        const level = Math.min(4, Number(heading[1])) as HeadingLevel;
        const headingAlign = alignOf(el);
        startLine({ kind: "heading", runs: [], align: headingAlign, level });
        // ★ `item` cleared for the same reason as <blockquote>/<pre>: a heading
        // inside an item keeps its LEVEL, which a continuation cannot carry.
        walk(el, marks, kind, false, null, headingAlign);
        flush();
        continue;
      }

      // ★★★ TRANSPARENT: the paragraph that IS the list item's text.
      //
      // Tiptap's listItem content spec is `paragraph block*`, so the editor
      // stores "<ul><li><p>a</p></li></ul>" and NEVER "<ul><li>a</li></ul>".
      // Without this arm the <p> took the LINE_TAGS arm below, whose startLine
      // flushed the still-empty `li` line — which `flush` then dropped for
      // holding no visible text — and the text arrived as a plain `p`. Every
      // list a real user typed lost its marker, its ordinal, its depth and its
      // task state, while the whole existing suite stayed green because its
      // fixtures (and the golden workspace's) carry the bare "<li>a</li>" form
      // that no editor produces.
      //
      // ★ Only P and DIV — i.e. exactly LINE_TAGS, the tags that carry no kind
      // of their own and merely INHERIT one. Nothing is lost by folding one into
      // the item. A <blockquote>, <pre> or <hN> each carries a kind (and a
      // level) that merging WOULD destroy, so those keep their own line; the
      // empty li line is then dropped as before, and since 0.243 that no longer
      // skews its siblings' numbering either.
      //
      // ★ `hasVisibleText` and not `runs.length === 0`: pretty-printed markup
      // puts a whitespace-only run between the <li> and its <p>, and that must
      // not count as the item already having text.
      //
      // ★ A SECOND <p> in one <li> finds the item non-empty and falls through
      // to LINE_TAGS below, which opens a CONTINUATION of the item rather than
      // a bare `p` — the same shape "<li>a<br>b</li>" produces.
      //
      // ★ `inListItem` is NOT threaded into the transparent element: this is
      // one level deep, matching "the direct content of an <li>". `item` IS,
      // because a <br> inside this very paragraph must continue the item.
      const host = current;
      if (
        inListItem &&
        LINE_TAGS.has(tag) &&
        host !== null &&
        host.kind === "li" &&
        !hasVisibleText(host.runs)
      ) {
        // The editor puts alignment on the PARAGRAPH, never on the <li>:
        // TextAlign is configured `types: ["heading", "paragraph"]`
        // (rich-text-editor.tsx). So the item's own align is almost always
        // absent and the transparent paragraph's is the real one — but the li's
        // wins where both are present, since it is the outer declaration.
        //
        // ★ REPLACED, not mutated in place. `flush` pushes a copy, so an
        // in-place `host.align = align` was safe by accident; a continuation is
        // now built by spreading the live item, which makes "who else holds
        // this object" a question worth not having to answer.
        const align = alignOf(el);
        // ★ The RESOLVED alignment — the li's own where it declared one, this
        // paragraph's otherwise — travels on, so a <br> inside this very
        // paragraph re-opens with the same alignment the head line got.
        const resolved = host.align ?? align;
        if (align !== undefined && host.align === undefined) current = { ...host, align };
        walk(el, marks, kind, false, item, resolved);
        continue;
      }

      if (LINE_TAGS.has(tag)) {
        const lineAlign = alignOf(el);
        startLine(
          item === null ? { kind, runs: [], align: lineAlign } : continuationOf(item, lineAlign),
        );
        walk(el, marks, kind, false, item, lineAlign);
        flush();
        continue;
      }

      // ★ `item` travels through an inline mark — "<li><p>a</p><em>x<br>y</em>"
      // has to continue the item at `y`. `inListItem` deliberately does not:
      // that would make a <p> wrapped in a <strong> transparent, which is not
      // today's behaviour and is not what this change is about.
      // ★ `align` passes straight through for the same reason `item` does: an
      // inline mark is not a paragraph, so it neither declares an alignment nor
      // ends the one in force.
      const mark = MARK_BY_TAG[tag];
      walk(el, mark ? addMark(marks, mark) : marks, kind, false, item, align);
    }
  }

  walk(doc.body, [], "p");
  flush();
  return lines;
}
