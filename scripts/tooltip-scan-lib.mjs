// Pure scanner behind `tooltips:check` (§109): finds button-family controls in
// a .tsx source and says which are icon-only and which carry a `title`.
//
// ★★ Built on the TypeScript parser, not on a hand-rolled lexer. The scan in
// docs/tooltip-inventory.md walked characters and misread an apostrophe in a
// `//` comment inside an opening tag as an unclosed string, which produced both
// phantom rows and, worse for a ratchet, a real control silently dropped. It
// also counted the word `<button` written in comments. The parser has neither
// problem: comments are trivia and never reach the tree.
import ts from "typescript";

export const BUTTON_TAGS = Object.freeze(["button", "Button", "IconButton", "ToggleButton"]);

/** Visible content this short, and only these glyphs, still reads as icon-only. */
const GLYPH_ONLY = /^[×✕⋮▸▾▼▲↑↓+•]{1,3}$/;

function attrNames(opening) {
  const names = new Set();
  for (const p of opening.attributes.properties) {
    if (ts.isJsxAttribute(p)) names.add(p.name.getText());
  }
  return names;
}

function isDecorative(el) {
  const opening = ts.isJsxElement(el) ? el.openingElement : el;
  const tag = opening.tagName.getText();
  if (/Icon$/.test(tag)) return true;
  return tag === "span" && attrNames(opening).has("aria-hidden");
}

/** The visible residue of a control's children once icons, `aria-hidden` spans,
 *  JSX comments and whitespace are removed. A non-literal expression counts as
 *  visible text, since it renders something the scan cannot read. */
function residue(children) {
  let out = "";
  for (const c of children) {
    if (ts.isJsxText(c)) out += c.text.trim();
    else if (ts.isJsxExpression(c)) {
      if (!c.expression) continue; // `{/* comment */}`
      out += ts.isStringLiteralLike(c.expression) ? c.expression.text.trim() : "{expr}";
    } else if ((ts.isJsxElement(c) || ts.isJsxSelfClosingElement(c)) && isDecorative(c)) continue;
    else out += "<el>";
  }
  return out;
}

/** One row per button-family element in `text`. `line` is 1-based. */
export function scanTsx(text, fileName = "file.tsx") {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const rows = [];
  const visit = (node) => {
    const opening = ts.isJsxElement(node) ? node.openingElement : ts.isJsxSelfClosingElement(node) ? node : null;
    if (opening) {
      const tag = opening.tagName.getText(sf);
      if (BUTTON_TAGS.includes(tag)) {
        const names = attrNames(opening);
        // ★ A spread (`{...props}`) may carry the title, as in the Button and
        // TextButton primitives' own <button>: the CALLER decides, and the
        // caller's element is scanned in its own right. Counting the internal
        // element too would hold every primitive in the baseline forever.
        const spread = opening.attributes.properties.some((p) => ts.isJsxSpreadAttribute(p));
        const rest = ts.isJsxElement(node) ? residue(node.children) : "";
        rows.push({
          tag,
          line: sf.getLineAndCharacterOfPosition(opening.getStart(sf)).line + 1,
          hasTitle: names.has("title") || spread,
          named: names.has("aria-label") || names.has("label"),
          iconOnly: tag === "IconButton" || rest === "" || GLYPH_ONLY.test(rest),
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return rows;
}

/** Icon-only controls with no hover tooltip: the surface the ratchet holds. */
export function untitledIconOnly(rows) {
  return rows.filter((r) => r.iconOnly && !r.hasTitle);
}

/**
 * Compare per-file counts against the baseline. A file absent from the baseline
 * has an allowance of 0. Returns the files that grew and the ones that shrank
 * (the latter only so the caller can say the baseline may be tightened).
 */
export function compareToBaseline(counts, baseline) {
  const grew = [];
  const shrank = [];
  for (const [file, n] of Object.entries(counts)) {
    const allowed = baseline[file] ?? 0;
    if (n > allowed) grew.push({ file, count: n, allowed });
  }
  for (const [file, allowed] of Object.entries(baseline)) {
    const n = counts[file] ?? 0;
    if (n < allowed) shrank.push({ file, count: n, allowed });
  }
  return { grew, shrank };
}
