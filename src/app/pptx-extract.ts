// src/app/pptx-extract.ts — PresentationML slides → Markdown. One "## Slide N"
// section per slide (numeric order); each <a:p> paragraph becomes one bullet.
// Pure.

import { decodeUtf8, extractRuns } from "./office-xml";

function slideNum(path: string): number {
  const m = /slide(\d+)\.xml$/.exec(path);
  return m ? parseInt(m[1], 10) : 0;
}

/** Extract Markdown from a pptx entry map (one section per slide). */
export function extractPptx(entries: Map<string, Uint8Array>): string {
  const slides = [...entries.keys()]
    .filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k))
    .sort((a, b) => slideNum(a) - slideNum(b));
  const sections: string[] = [];
  slides.forEach((path, i) => {
    const xml = decodeUtf8(entries.get(path)!);
    const bullets: string[] = [];
    const pRe = /<a:p\b[\s\S]*?<\/a:p>/g;
    let m: RegExpExecArray | null;
    while ((m = pRe.exec(xml)) !== null) {
      const text = extractRuns(m[0], "a:t").join("").trim();
      if (text !== "") bullets.push(`- ${text}`);
    }
    const heading = `## Slide ${i + 1}`;
    sections.push(bullets.length > 0 ? `${heading}\n${bullets.join("\n")}` : heading);
  });
  return sections.join("\n\n");
}
