// AI people protection, Task 5 review round 2 (I2): with protection on, the dictation-off reason reaches
// assistive tech as the field's DESCRIPTION, so EVERY call site of `useDictationMic` must take its
// `describedById` and name it in its field's aria-describedby. The milestone name is pinned through the DOM
// (`milestone-edit-modal.people.test.tsx`); this sweep keeps every other site from forgetting.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DIR = join(__dirname);
const sources = readdirSync(DIR)
  .filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f) && f !== "dictation-mic.tsx")
  .map((f) => ({ f, text: readFileSync(join(DIR, f), "utf8") }))
  .filter(({ text }) => text.includes("useDictationMic("));

/** Each `const { … } = useDictationMic(` destructure in a file. */
function destructures(text: string): string[] {
  return [...text.matchAll(/const \{([^}]*)\} = useDictationMic\(/g)].map((m) => m[1]!);
}

describe("every dictation call site describes its field with the dictation-off reason", () => {
  it("finds the call sites (positive control)", () => {
    expect(sources.length).toBeGreaterThanOrEqual(7);
    expect(sources.flatMap(({ text }) => destructures(text)).length).toBeGreaterThanOrEqual(15);
  });

  it("each destructure takes describedById, and the file uses it in an aria-describedby", () => {
    const missing: string[] = [];
    for (const { f, text } of sources) {
      for (const d of destructures(text)) {
        const m = /describedById:\s*(\w+)/.exec(d);
        if (!m) { missing.push(`${f}: ${d.trim().slice(0, 40)} takes no describedById`); continue; }
        const used = new RegExp(`(aria-describedby|ariaDescribedBy|DescribedBy)[^\\n]*\\b${m[1]}\\b`).test(text);
        if (!used) missing.push(`${f}: ${m[1]} is never named in an aria-describedby`);
      }
    }
    expect(missing).toEqual([]);
  });
});
