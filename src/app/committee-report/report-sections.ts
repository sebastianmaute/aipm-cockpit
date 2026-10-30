// Pure section split and merge for the AI meeting-report draft (AI-04). DOM-free:
// the input is already-sanitized rich-text HTML, so a string split on h1-h4 is
// enough; never call DOMPurify here (docs/AGENTS/rich-text.md).
//
// ★ Splitting assumes TOP-LEVEL headings. HEADING_RE is markup-blind, so a heading nested in a container (a
// blockquote, a list item) splits that element mid-way: the pieces are unbalanced fragments that still concatenate
// back to the input, and the save re-sanitizes the joined text (pinned in report-sections.test.ts).
import { htmlToPlainText, isBlankHtml } from "../html-to-text";

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

/** The sections of an AI draft as the proposal shows them: a BLANK opening (whitespace, an empty paragraph) is not a
 *  section. (The user's own text goes through splitSections whole, so a blank preamble there still round-trips.) */
export function splitProposalSections(html: string): ReportSection[] {
  const all = splitSections(html).filter((s) => !(s.level === 0 && isBlankHtml(s.html)));
  const levels = all.filter((s) => s.level !== 0).map((s) => s.level);
  const top = levels.length > 0 ? Math.min(...levels) : 0;
  // Only the draft's TOP heading level splits it: a deeper heading stays inside the section above it, so a Replace of
  // the parent brings its sub-sections along. (A deeper heading with nothing above it keeps its own section.)
  const out: ReportSection[] = [];
  for (const s of all) {
    const prev = out[out.length - 1];
    if (s.level > top && prev) out[out.length - 1] = { ...prev, html: prev.html + s.html };
    else out.push(s);
  }
  return out;
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

/** Where an unmatched AI section goes, in this order:
 *  1. after the nearest PRECEDING AI section the working text also has (or one placed in this call), at the end of that
 *     anchor's range, extended past anything deeper than the inserted section so a parent's later sub-sections stay put;
 *  2. else BEFORE the nearest FOLLOWING AI section the text has (or one placed in this call), counting only an anchor
 *     whose level is at most the inserted section's;
 *  3. else the end.
 *  The AI opening (level 0) goes after the text's own level-0 section, or first. */
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
          ? // The AI's opening is an anchor only when the user's text really holds it (its html sits inside the level-0 section, which may have grown a user intro around it); the user's OWN
            // intro is not the AI's opening, so keep walking back (to the end if nothing else anchors).
            (!isBlankHtml(ai[j].html) && items[level0]?.section.html.includes(ai[j].html) ? level0 : -1)
          : items.findIndex(
              (it) =>
                it.section.level !== 0 &&
                it.section.key === ai[j].key &&
                ai[j].key !== "",
            );
    if (at !== -1) {
      // An anchor DEEPER than the inserted section (a user h3 inside an h2) ends its own range, not the parent's: go on
      // to the end of the enclosing range at this level, or the parent's later sub-sections would fall under the new one.
      let e = rangeEnd(items, at);
      while (e < items.length && items[e].section.level > ai[aiIndex].level) e++;
      return e;
    }
  }
  // No preceding anchor: go BEFORE the nearest FOLLOWING AI section the text has (or one placed in this call), so the
  // AI order holds; only with neither does it go to the end.
  for (let j = aiIndex + 1; j < ai.length; j++) {
    if (ai[j].level === 0) continue;
    const at = items.findIndex(
      (it) =>
        (it.section === ai[j] || (ai[j].key !== "" && it.section.level !== 0 && it.section.key === ai[j].key)) &&
        it.section.level <= ai[aiIndex].level,
    );
    // (A following anchor deeper than the inserted section is no place to go before, it would pull the user's
    // sub-section out from under its parent: the predicate above skips it and the search goes on, else the end.)
    if (at !== -1) return at;
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
    // A blank opening is nothing to take (it would also "match" almost any intro by containment).
    if (sec.level === 0 && isBlankHtml(sec.html)) continue;
    // An opening the text already holds, word for word, is already there: neither a replacement nor an addition.
    if (sec.level === 0 && items.some((it) => it.section.level === 0 && it.section.html.includes(sec.html))) continue;
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
    // An AI section SHALLOWER than the user section it matches (an h2 matching a user h3 inside an h2) must not land
    // before that parent's later sub-sections, or they would fall under it: it goes to the end of the enclosing range
    // at ITS level. Same level or deeper: the user's range as before.
    const shallower = sec.level < items[m].section.level;
    if (confirmReplace) items.splice(m, end - m);
    let at = confirmReplace ? m : end;
    if (shallower) while (at < items.length && items[at].section.level > sec.level) at++;
    // Keep both, and a shallower Replace (which lands away from the matched spot), go past AI items already placed
    // there, so the AI sections keep AI order.
    if (!confirmReplace || shallower) while (at < items.length && items[at].placed) at++;
    items.splice(at, 0, placed);
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
