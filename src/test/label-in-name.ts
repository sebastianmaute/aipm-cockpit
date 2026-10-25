// Shared assertion: a control's VISIBLE label is contained in its accessible
// name (WCAG 2.5.3 Label in Name — the speech-input criterion: a user says what
// they see, and that has to match the name the control is reached by).
//
// ★★ WHY A UNIT HELPER WHEN THE AXE GATE NOW RUNS THE RULE. Since axe-core 4.14
// `label-content-name-mismatch` is no longer tagged `experimental`, so the
// tag-only runOnly in `e2e/a11y.spec.ts` runs it — but only over what the e2e
// seed renders in the scanned views, and never over a `<select>` (its `matches`
// admits only roles that take their name from content; see
// `docs/AGENTS/accessibility.md`). A control outside a scanned view, behind a
// mode the seed does not reach, or rendered only in a state the seed lacks is
// still covered by a unit test or by nothing.
//
// ★★ THIS MIRRORS AXE 4.14's COMPARISON, NOT A STRICTER ONE. axe's
// `isLabelContainedInName` curates both strings into WORD TOKENS and asks
// whether the label's tokens are a CONTIGUOUS run inside the name's tokens:
//   · NFKD-normalised, case-folded;
//   · parentheticals removed — so a row token's "(2)" suffix is invisible to
//     the comparison on either side;
//   · every non-letter, non-number character becomes a space — so "–", ":",
//     "#", "%" and the ↑ glyph never matter, while "Status3" stays ONE token.
// Containment, never prefix: the Understanding doc for 2.5.3 puts the visible
// text first only as a best practice in a note.
//
// ★★★ VISIBLE TEXT IS JOINED THE WAY AXE JOINS IT — sibling text nodes are
// concatenated with NO separator. `<span>Status</span><span>3</span>` is the
// visible text "Status3", one token, which no name containing "Status" and "3"
// as separate words can contain. That is a real failure mode in this repo
// (the filter chip and its count), and a `textContent`-plus-`trim` reading
// would hide it just the same, so the helper keeps it.
// ★ "Visible" is visible ON SCREEN, which is what axe 4.14 evaluates
// (`visibleVirtual(node, false, …)`): `aria-hidden` content COUNTS as visible
// text, so hiding a visible count from AT does not take it out of the
// comparison. Excluded here: `sr-only` elements (clipped off screen), the
// `hidden` attribute, inline `display:none`, and an SVG `<title>` (no box).
// jsdom has no layout, so a class that hides by CSS other than `sr-only` is
// not seen — keep fixtures to those mechanisms.
import { computeAccessibleName } from "dom-accessibility-api";

/** axe 4.14's `curateTokens`, minus two steps: its emoji table (no fixture here
 *  uses emoji), and its word split, which uses `Intl.Segmenter` (word
 *  granularity) where the runtime has it and splits on whitespace only where it
 *  does not. After every non-letter/non-number has become a space the two agree
 *  for Latin-script text such as EN and DE; for scripts written without spaces
 *  (CJK, Thai) the segmenter splits words this helper keeps whole, so do not use
 *  it to certify those. */
export function curateTokens(text: string): string[] {
  let s = text.normalize("NFKD");
  let previous: string;
  do {
    previous = s;
    s = s.replace(/\([^()]*\)/g, "");
  } while (s !== previous);
  return s
    .replace(/[^\p{L}\p{N}]/gu, " ")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

/** True when `label`'s tokens are a contiguous run inside `name`'s tokens. */
export function isLabelInName(label: string, name: string): boolean {
  const needle = curateTokens(label);
  if (needle.length === 0) return true;
  const haystack = curateTokens(name);
  for (let i = 0; i + needle.length <= haystack.length; i++) {
    if (needle.every((w, j) => haystack[i + j] === w)) return true;
  }
  return false;
}

function isOffScreen(el: Element): boolean {
  if (el.classList.contains("sr-only")) return true;
  if (el.hasAttribute("hidden")) return true;
  if ((el as HTMLElement).style?.display === "none") return true;
  const tag = el.tagName.toLowerCase();
  return tag === "title" || tag === "style" || tag === "script";
}

/** The on-screen text of `el`, joined as axe joins it (no separator between siblings). */
export function visibleText(el: Element): string {
  let out = "";
  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === 3) out += child.nodeValue ?? "";
    else if (child.nodeType === 1) {
      const c = child as Element;
      if (c.tagName.toLowerCase() === "br") out += " ";
      else if (!isOffScreen(c)) out += visibleText(c);
    }
  }
  return out;
}

/**
 * Throws unless `el`'s visible text is contained in its computed accessible
 * name. Also throws when the visible text has no word at all — a blank label is
 * contained in everything, so the assertion would pass vacuously.
 */
export function expectLabelInName(el: Element): void {
  const visible = visibleText(el);
  const name = computeAccessibleName(el);
  if (curateTokens(visible).length === 0) {
    throw new Error(`label-in-name: no visible words to compare (visible ${JSON.stringify(visible)}, name ${JSON.stringify(name)})`);
  }
  if (!isLabelInName(visible, name)) {
    throw new Error(`label-in-name: visible ${JSON.stringify(visible)} is not contained in accessible name ${JSON.stringify(name)}`);
  }
}
