// Pure section split and merge for the AI meeting-report draft (AI-04). DOM-free:
// the input is already-sanitized rich-text HTML, so a string split on h1-h4 is
// enough; never call DOMPurify here (docs/AGENTS/rich-text.md).
import { htmlToPlainText } from "../html-to-text";

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

export function normalizeHeading(text: string): string {
  return htmlToPlainText(text).replace(/\s+/g, " ").trim().toLowerCase();
}

export function splitSections(html: string): ReportSection[] {
  const out: ReportSection[] = [];
  const starts: { index: number; level: 1 | 2 | 3 | 4; inner: string }[] = [];
  for (const m of html.matchAll(HEADING_RE)) {
    starts.push({ index: m.index, level: Number(m[1]) as 1 | 2 | 3 | 4, inner: m[2] });
  }
  const firstEnd = starts.length > 0 ? starts[0].index : html.length;
  if (firstEnd > 0) out.push({ level: 0, heading: "", key: "", html: html.slice(0, firstEnd) });
  starts.forEach((s, i) => {
    const end = i + 1 < starts.length ? starts[i + 1].index : html.length;
    const heading = htmlToPlainText(s.inner).replace(/\s+/g, " ").trim();
    out.push({ level: s.level, heading, key: normalizeHeading(s.inner), html: html.slice(s.index, end) });
  });
  return out;
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
  return items.findIndex((it) => !it.placed && it.section.level !== 0 && it.section.key === key);
}

/** Where an unmatched AI section goes: after the nearest preceding AI section the working text also has, else the end. */
function insertionPoint(items: readonly Item[], ai: readonly ReportSection[], aiIndex: number): number {
  const level0 = items.findIndex((it) => it.section.level === 0);
  if (ai[aiIndex].level === 0) return level0 === -1 ? 0 : rangeEnd(items, level0);
  for (let j = aiIndex - 1; j >= 0; j--) {
    const at =
      ai[j].level === 0
        ? level0
        : items.findIndex((it) => it.section.level !== 0 && it.section.key === ai[j].key && ai[j].key !== "");
    if (at !== -1) return rangeEnd(items, at);
  }
  return items.length;
}

function run(currentHtml: string, ai: readonly ReportSection[], take: readonly number[], confirmReplace: boolean) {
  const items: Item[] = splitSections(currentHtml).map((section) => ({ section, placed: false }));
  const plan: TakePlan = { replacements: [], additions: [] };
  const order = [...new Set(take)].filter((i) => Number.isInteger(i) && i >= 0 && i < ai.length).sort((a, b) => a - b);
  for (const aiIndex of order) {
    const sec = ai[aiIndex];
    const placed: Item = { section: sec, placed: true };
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
    else items.splice(end, 0, placed);
  }
  return { plan, html: items.map((it) => it.section.html).join("") };
}

export function planTake(currentHtml: string, ai: readonly ReportSection[], take: readonly number[]): TakePlan {
  return run(currentHtml, ai, take, true).plan;
}

export function applyTake(
  currentHtml: string,
  ai: readonly ReportSection[],
  take: readonly number[],
  confirmReplace: boolean,
): string {
  return run(currentHtml, ai, take, confirmReplace).html;
}
