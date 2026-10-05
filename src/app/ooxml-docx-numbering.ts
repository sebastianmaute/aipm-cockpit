// src/app/ooxml-docx-numbering.ts — real Word list numbering for the DOCX
// renderers (open-followups §154). Pure and DOM-free: it mints numbering ids
// and returns `word/numbering.xml` as a string.
//
// ★★ Before this module, a list item's marker was LITERAL TEXT in its own run
// (`bulletMarker`), so a list in an exported file was not a Word list: no
// renumbering on edit, no list-style change. A paragraph now carries
// `<w:numPr>` and Word draws the marker from the definitions below.
//
// ★★ TASK ITEMS STAY LITERAL. Word numbering has no checked/unchecked state,
// so a ☐/☑ item keeps its marker run; `bulletMarker` still decides it, and
// still decides every marker the PPTX renderer and the flat projection spell.
//
// ★★★ ONE `w:num` PER LIST INSTANCE, not per list kind. Word counts per
// `w:num` and level, so two ordered lists sharing one `w:num` would number
// as ONE list: the second would start at 4, not 1. A list instance begins
// where the parser restarts its counter (`index === 0` at that depth) or where
// the kind changes at that depth, and each instance gets a fresh `w:num`
// whose `startOverride` restarts its level.
//
// ★ The package part, content-type override and relationship are added only
// when a numbering id was minted (`buildDocxPackage`'s `numberingXml`), so a
// list-free package is unchanged — docs/baselines/ooxml-parts.json pins that.

/** The relationship id of the numbering part in `word/_rels/document.xml.rels`.
 *
 *  ★★ NOT a numbered `rIdN`. Media and links mint `rId2`… in ranges their
 *  callers reserve; a fixed non-numeric id cannot collide with either, and an
 *  `Id` is any xsd:ID. `buildDocxPackage` asserts that no media or link id
 *  takes it. */
export const NUMBERING_REL_ID = "rIdNumbering";

/** Word's nine list levels (`w:ilvl` 0..8). A deeper item clamps to the last. */
const MAX_LEVEL = 8;

/** Text indent per level, in twips — the step the literal-marker path used
 *  (`<w:ind w:left="720 * (depth + 1)"/>`), so a list's text and its
 *  continuation lines sit where they did. */
export const LIST_INDENT_TWIPS = 720;

/** The marker hangs this far left of the text. */
const LIST_HANGING_TWIPS = 360;

/** The direct `<w:ind>` a numbered list item's first line carries — the SAME
 *  indent its numbering level declares.
 *
 *  ★★ DELIBERATELY REDUNDANT. Word ranks a numbering level's indent above the
 *  paragraph style's (`ListParagraph` sets `w:left="720"`), but ECMA-376's
 *  property hierarchy as written applies paragraph-style properties AFTER
 *  numbering, so a reader that follows the text would put every depth at 720
 *  while its continuation lines sit deeper. Direct formatting wins in every
 *  reader, so stating the level's indent here removes the question. */
export function listHeadIndent(depth: number): string {
  const level = Math.min(Math.max(depth, 0), MAX_LEVEL);
  return `<w:ind w:left="${LIST_INDENT_TWIPS * (level + 1)}" w:hanging="${LIST_HANGING_TWIPS}"/>`;
}

const ABSTRACT_BULLET = 0;
const ABSTRACT_DECIMAL = 1;

export type NumberingSink = {
  /** The `<w:numPr>` for a list item's FIRST line. Continuation lines take
   *  none — a list item has one marker however many lines it wraps to. Pair
   *  it with `listHeadIndent`. */
  numPrFor(item: { ordered: boolean; depth: number; index: number }): string;
  /** The `word/numbering.xml` part, or undefined when nothing was minted. */
  partXml(): string | undefined;
};

type Instance = { numId: number; ordered: boolean; level: number; start: number; next: number };

export function createNumberingSink(): NumberingSink {
  const instances: Instance[] = [];
  /** The open instance per depth — what a later item at that depth continues. */
  const open = new Map<number, Instance>();

  return {
    numPrFor({ ordered, depth, index }) {
      const level = Math.min(Math.max(depth, 0), MAX_LEVEL);
      let inst = open.get(level);
      // ★ `index !== inst.next` covers `index === 0` (a restarted list) AND a
      // count that skipped: items a NUMBERED path never saw (task items, which
      // keep their literal box) spent ordinals, so the next numbered item must
      // start where the parser says, not continue an older list's count.
      if (!inst || index !== inst.next || inst.ordered !== ordered) {
        inst = { numId: instances.length + 1, ordered, level, start: index + 1, next: index };
        instances.push(inst);
        open.set(level, inst);
      }
      inst.next = index + 1;
      return `<w:numPr><w:ilvl w:val="${level}"/><w:numId w:val="${inst.numId}"/></w:numPr>`;
    },
    partXml() {
      if (instances.length === 0) return undefined;
      const nums = instances
        .map(
          (i) =>
            `<w:num w:numId="${i.numId}"><w:abstractNumId w:val="${i.ordered ? ABSTRACT_DECIMAL : ABSTRACT_BULLET}"/>` +
            `<w:lvlOverride w:ilvl="${i.level}"><w:startOverride w:val="${i.start}"/></w:lvlOverride></w:num>`,
        )
        .join("");
      return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${abstractNum(ABSTRACT_BULLET, false)}${abstractNum(ABSTRACT_DECIMAL, true)}${nums}</w:numbering>`;
    },
  };
}

/** ★★ `CT_Lvl` children are an xsd:sequence — start, numFmt, lvlText, lvlJc,
 *  pPr — and Word rejects the part when they are out of order. */
function abstractNum(id: number, ordered: boolean): string {
  const levels = Array.from({ length: MAX_LEVEL + 1 }, (_, ilvl) => {
    const fmt = ordered
      ? `<w:numFmt w:val="decimal"/><w:lvlText w:val="%${ilvl + 1}."/>`
      : `<w:numFmt w:val="bullet"/><w:lvlText w:val="•"/>`;
    return (
      `<w:lvl w:ilvl="${ilvl}"><w:start w:val="1"/>${fmt}<w:lvlJc w:val="left"/>` +
      `<w:pPr><w:ind w:left="${LIST_INDENT_TWIPS * (ilvl + 1)}" w:hanging="${LIST_HANGING_TWIPS}"/></w:pPr></w:lvl>`
    );
  }).join("");
  return `<w:abstractNum w:abstractNumId="${id}"><w:multiLevelType w:val="multilevel"/>${levels}</w:abstractNum>`;
}
