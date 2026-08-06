// src/app/no-nul-bytes.test.ts
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(process.cwd(), "src");

/** ★★ Filter by EXTENSION, never "everything under src" — `src/app/favicon.ico`
 *  is a tracked binary that holds NUL bytes legitimately. `docs/open-followups.md`
 *  §67 records that the looser phrasing was written for one command and then
 *  disproved by the very sweep meant to confirm it. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
      continue;
    }
    if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

describe("committed source files are text", () => {
  // A NUL byte is BENIGN at runtime — as a cache-key separator it works exactly
  // as a space would, which is why nothing ever caught the one in
  // `use-portfolio-health.ts`. The cost is to tooling: ripgrep and grep classify
  // the file as BINARY and print "Binary file … matches" with no line content,
  // so every content sweep over src/ silently SKIPS it. That already cost a
  // reviewer once, on a file holding `completionPercent` (open-followups §67).
  //
  // The Edit tool is a known source of these (it can turn a space into a NUL),
  // so this is a ratchet against recurrence, not a one-time cleanup.
  it("no .ts/.tsx file under src/ contains a NUL byte", () => {
    const offenders = sourceFiles(SRC)
      .map((file) => ({ file, at: readFileSync(file).indexOf(0) }))
      .filter((hit) => hit.at !== -1)
      .map((hit) => `${hit.file} @ byte ${hit.at}`);
    expect(offenders).toEqual([]);
  });
});
