// src/app/no-nul-bytes.test.ts
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** Tracked files only, straight from the index — this guard is about what gets
 *  COMMITTED, so `git ls-files` IS the definition rather than an approximation
 *  of it.
 *
 *  ★★ An earlier version walked the filesystem and skipped one hardcoded
 *  directory name while its comment claimed it "skips gitignored trees". It did
 *  not: `docs/patterns/` is also gitignored and was scanned, so a scratch file
 *  dropped there could turn the suite red for a reason unrelated to any commit
 *  — the exact failure the skip existed to prevent. Asking git removes the
 *  category/instance gap instead of widening the list.
 *
 *  ★ Filter by EXTENSION as well: `src/app/favicon.ico` and
 *  `docs/assets/dashboard.png` are TRACKED binaries holding NULs legitimately
 *  (verified: offsets 0 and 8). `docs/open-followups.md` §67 records that the
 *  looser "everything under src" phrasing was written for one command and then
 *  disproved by the very sweep meant to confirm it. */
function scannedFiles(): string[] {
  const out = execFileSync("git", ["ls-files", "-z", "src", "docs"], {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  });
  return out
    .split("\0")
    .filter((p) => /\.(tsx?|md)$/.test(p))
    .map((p) => join(process.cwd(), p));
}

describe("committed source files are text", () => {
  // A NUL byte is BENIGN at runtime — as a cache-key separator it works exactly
  // as a space would, which is why nothing caught the one in
  // `use-portfolio-health.ts` for months. The cost is to tooling: ripgrep and
  // grep classify the file as BINARY and print "Binary file … matches" with no
  // line content, so every content sweep silently SKIPS it. That already cost a
  // reviewer once, on a file holding `completionPercent` (open-followups §67).
  //
  // The Edit tool is a known source of these, and writing the escape sequence as
  // PROSE about the escape sequence is another — that is how two landed in
  // `open-followups.md` while §67 was being closed. This is a ratchet against
  // recurrence, not a one-time cleanup.
  it("no tracked .ts/.tsx/.md file under src/ or docs/ contains a NUL byte", () => {
    const files = scannedFiles();

    // ★★ POSITIVE CONTROL, and it is load-bearing: the real assertion below is
    //    `toEqual([])`, which passes trivially if `scannedFiles()` ever returns
    //    nothing — a bad extension regex, a cwd that is not the repo root, a
    //    refactor to some glob helper. Without these two lines the guard can
    //    scan zero files and report success.
    expect(files.length).toBeGreaterThan(500);
    expect(files.some((f) => f.endsWith("use-portfolio-health.ts"))).toBe(true);

    const offenders = files
      .map((file) => ({ file, at: readFileSync(file).indexOf(0) }))
      .filter((hit) => hit.at !== -1)
      .map((hit) => `${hit.file} @ byte ${hit.at}`);
    expect(offenders).toEqual([]);
  });
});
