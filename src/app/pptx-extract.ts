// src/app/pptx-extract.ts — PresentationML slides → Markdown. One "## Slide N"
// section per slide (numeric order); each <a:p> paragraph becomes one bullet.
// Pure.

import { decodeUtf8, extractRuns } from "./office-xml";
import { forEachTagPair, type TagPairSpec } from "./tag-pair-walk";

function slideNum(path: string): number {
  const m = /slide(\d+)\.xml$/.exec(path);
  return m ? parseInt(m[1], 10) : 0;
}

// Walked via forEachTagPair rather than the former `<a:p\b[\s\S]*?<\/a:p>`
// lazy pair regex, which is quadratic on repetitive unclosed markup — see
// tag-pair-walk.ts (§558).
const P_PAIR: TagPairSpec = { openPattern: "<a:p\\b", closeName: () => "a:p", hasAttributes: true };

/** Extract Markdown from a pptx entry map (one section per slide). */
export function extractPptx(entries: Map<string, Uint8Array>): string {
  const slides = [...entries.keys()]
    .filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k))
    .sort((a, b) => slideNum(a) - slideNum(b));
  const sections: string[] = [];
  slides.forEach((path, i) => {
    const xml = decodeUtf8(entries.get(path)!);
    const bullets: string[] = [];
    forEachTagPair(xml, P_PAIR, (p) => {
      const text = extractRuns(p.whole, "a:t").join("").trim();
      if (text !== "") bullets.push(`- ${text}`);
      return true;
    });
    const heading = `## Slide ${i + 1}`;
    sections.push(bullets.length > 0 ? `${heading}\n${bullets.join("\n")}` : heading);
  });
  return sections.join("\n\n");
}
