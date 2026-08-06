// src/app/no-nul-bytes.test.ts
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** ★★ Filter by EXTENSION, never "everything under this directory" —
 *  `src/app/favicon.ico` is a tracked binary that holds NUL bytes legitimately,
 *  and `docs/assets/` is full of PNGs. `docs/open-followups.md` §67 records that
 *  the looser phrasing was written for one command and then disproved by the
 *  very sweep meant to confirm it.
 *
 *  ★★ `docs/**\/*.md` is covered because a NUL landed in `open-followups.md`
 *  while that entry was being CLOSED — same corruption, and the register is the
 *  file most likely to be grepped. Scoping this to source would have shipped a
 *  guard blind to the case that had just occurred. */
const ROOTS: readonly { dir: string; ext: RegExp }[] = [
  { dir: "src", ext: /\.tsx?$/ },
  { dir: "docs", ext: /\.md$/ },
];

/** Gitignored scratch trees. This guard is about what gets COMMITTED — an
 *  untracked working file that grep skips costs nobody but its author. ★ It is
 *  also not hypothetical: `docs/superpowers/` held two at the time this was
 *  written, and without the skip the guard would have been red on arrival and
 *  gone straight into the "just delete the assertion" bucket. */
const SKIP_DIRS: readonly string[] = ["superpowers"];

function filesUnder(dir: string, ext: RegExp): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (SKIP_DIRS.includes(entry)) continue;
      out.push(...filesUnder(full, ext));
      continue;
    }
    if (ext.test(entry)) out.push(full);
  }
  return out;
}

function scannedFiles(): string[] {
  return ROOTS.flatMap((root) =>
    filesUnder(join(process.cwd(), root.dir), root.ext),
  );
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
  it("no scanned source or doc file contains a NUL byte", () => {
    const offenders = scannedFiles()
      .map((file) => ({ file, at: readFileSync(file).indexOf(0) }))
      .filter((hit) => hit.at !== -1)
      .map((hit) => `${hit.file} @ byte ${hit.at}`);
    expect(offenders).toEqual([]);
  });
});
