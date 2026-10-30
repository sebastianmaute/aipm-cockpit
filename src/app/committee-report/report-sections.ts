// Pure section split and merge for the AI meeting-report draft (AI-04). DOM-free:
// the input is already-sanitized rich-text HTML, so a string split on h1-h4 is
// enough; never call DOMPurify here (docs/AGENTS/rich-text.md).
//
// ★ Splitting assumes TOP-LEVEL headings. HEADING_RE is markup-blind, so a heading nested in a container (a
// blockquote, a list item) splits that element mid-way: the pieces are unbalanced fragments that still concatenate
// back to the input, and the save re-sanitizes the joined text (pinned in report-sections.test.ts).
import { htmlToPlainText } from "../html-to-text";

// The ONE blank rule (the hook refuses to send a blank body, the panel disables Send on it, the sanitizer drops a
// blank `previous`); it lives beside htmlToPlainText so the shared sanitizer need not import this feature module.
export { isBlankHtml as isBlankReport } from "../html-to-text";

export interface ReportSection {
  level: 0 | 1 | 2 | 3 | 4;
  heading: string;
  key: string;
  html: string;
}

export interface TakeReplacement {
  aiIndex: number;
  userHeading: string;
  removedSubheadings: string[];
}

export interface TakePlan {
  replacements: TakeReplacement[];
  additions: number[];
}

// A heading element; inner content may carry inline tags but never another heading.
const HEADING_RE = /<h([1-4])\b[^>]*>((?:[^<]|<(?!\/?h[1-4]\b))*)<\/h\1>/gi;

// Numeric references are decoded BEFORE htmlToPlainText so its named-entity pass
// never sees a decoded "&" (no double decode of "&amp;#8211;"); the markup
// characters stay encoded for the same reason.
function headingText(inner: string): string {
  const numeric = inner.replace(
    /&#(x[0-9a-f]+|[0-9]+);/gi,
    (whole, body: string) => {
      const n =
        body[0].toLowerCase() === "x"
          ? Number.parseInt(body.slice(1), 16)
          : Number.parseInt(body, 10);
      if (
        !Number.isFinite(n) ||
        n <= 0 ||
        n > 0x10ffff ||
        n === 38 ||
        n === 60 ||
        n === 62
      )
        return whole;
      return String.fromCodePoint(n);
    },
  );
  return htmlToPlainText(numeric).replace(/\s+/g, " ").trim();
}

/** Match key for heading text; the input may contain inline markup and entities. */
export function normalizeHeading(text: string): string {
  return headingText(text).toLowerCase();
}

export function splitSections(html: string): ReportSection[] {
  const out: ReportSection[] = [];
  const starts: { index: number; level: 1 | 2 | 3 | 4; inner: string }[] = [];
  for (const m of html.matchAll(HEADING_RE)) {
    starts.push({
      index: m.index,
      level: Number(m[1]) as 1 | 2 | 3 | 4,
      inner: m[2],
    });
  }
  const firstEnd = starts.length > 0 ? starts[0].index : html.length;
  if (firstEnd > 0)
    out.push({ level: 0, heading: "", key: "", html: html.slice(0, firstEnd) });
  starts.forEach((s, i) => {
    const end = i + 1 < starts.length ? starts[i + 1].index : html.length;
    const heading = headingText(s.inner);
    out.push({
      level: s.level,
      heading,
      key: normalizeHeading(s.inner),
      html: html.slice(s.index, end),
    });
  });
  return out;
}

/** A section's html WITHOUT its own leading heading element (h1-h4), for a preview shown under a row that already
 *  names it. Only the first heading is dropped, and only when it opens the html (a level-0 opening section has none). */
export function sectionBodyHtml(html: string): string {
  const m = /^\s*<h([1-4])\b[^>]*>(?:[^<]|<(?!\/?h[1-4]\b))*<\/h\1>/i.exec(html);
  return m ? html.slice(m[0].length) : html;
}

interface Item {
  section: ReportSection;
  placed: boolean; // came from the AI: never a match target, may anchor an insertion
}

/** Index one past the last item of the section at `at`: it runs to the next heading of the same or higher level. */
function rangeEnd(items: readonly Item[], at: number): number {
  const level = items[at].section.level;
  let e = at + 1;
  if (level === 0) return e;
  while (e < items.length && items[e].section.level > level) e++;
  return e;
}

function findUserMatch(items: readonly Item[], key: string): number {
  if (key === "") return -1;
  return items.findIndex(
    (it) => !it.placed && it.section.level !== 0 && it.section.key === key,
  );
}

/** Where an unmatched AI section goes: after the nearest preceding AI section the working text also has, else the end. */
function insertionPoint(
  items: readonly Item[],
  ai: readonly ReportSection[],
  aiIndex: number,
): number {
  const level0 = items.findIndex((it) => it.section.level === 0);
  if (ai[aiIndex].level === 0)
    return level0 === -1 ? 0 : rangeEnd(items, level0);
  for (let j = aiIndex - 1; j >= 0; j--) {
    // Deliberately includes AI items placed in this call (keeps AI order in take-all); matching skips them.
    const placedAt = items.findIndex((it) => it.section === ai[j]);
    const at =
      placedAt !== -1
        ? placedAt
        : ai[j].level === 0
          ? // The AI's opening is an anchor only when the user's text really holds it (same html); the user's OWN
            // intro is not the AI's opening, so keep walking back (to the end if nothing else anchors).
            (items[level0]?.section.html === ai[j].html ? level0 : -1)
          : items.findIndex(
              (it) =>
                it.section.level !== 0 &&
                it.section.key === ai[j].key &&
                ai[j].key !== "",
            );
    if (at !== -1) return rangeEnd(items, at);
  }
  return items.length;
}

function run(
  currentHtml: string,
  ai: readonly ReportSection[],
  take: readonly number[],
  confirmReplace: boolean,
) {
  const items: Item[] = splitSections(currentHtml).map((section) => ({
    section,
    placed: false,
  }));
  const plan: TakePlan = { replacements: [], additions: [] };
  const order = [...new Set(take)]
    .filter((i) => Number.isInteger(i) && i >= 0 && i < ai.length)
    .sort((a, b) => a - b);
  for (const aiIndex of order) {
    const sec = ai[aiIndex];
    const placed: Item = { section: sec, placed: true };
    // An opening the text already holds, word for word, is already there: neither a replacement nor an addition.
    if (sec.level === 0 && items.some((it) => it.section.level === 0 && it.section.html === sec.html)) continue;
    const m = sec.level === 0 ? -1 : findUserMatch(items, sec.key);
    if (m === -1) {
      plan.additions.push(aiIndex);
      items.splice(insertionPoint(items, ai, aiIndex), 0, placed);
      continue;
    }
    const end = rangeEnd(items, m);
    plan.replacements.push({
      aiIndex,
      userHeading: items[m].section.heading,
      removedSubheadings: items
        .slice(m + 1, end)
        .filter((it) => it.section.level !== 0)
        .map((it) => it.section.heading),
    });
    if (confirmReplace) items.splice(m, end - m, placed);
    else {
      // Keep both: after the user's range, and past AI items already placed there, so the AI sections keep AI order.
      let at = end;
      while (at < items.length && items[at].placed) at++;
      items.splice(at, 0, placed);
    }
  }
  return { plan, html: items.map((it) => it.section.html).join("") };
}

/** What taking `take` would do. `confirmReplace` picks the answer the plan describes: Replace (default, what the
 *  confirm dialog lists) or Keep both, which matches the same headings but removes nothing, so a later section the
 *  Replace path would call an addition can be a match here. Same engine as applyTake, so they cannot disagree. */
export function planTake(
  currentHtml: string,
  ai: readonly ReportSection[],
  take: readonly number[],
  confirmReplace = true,
): TakePlan {
  return run(currentHtml, ai, take, confirmReplace).plan;
}

export function applyTake(
  currentHtml: string,
  ai: readonly ReportSection[],
  take: readonly number[],
  confirmReplace: boolean,
): string {
  return run(currentHtml, ai, take, confirmReplace).html;
}
