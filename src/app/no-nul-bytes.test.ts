// src/app/no-nul-bytes.test.ts
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

/** Repo-root-relative directories git is told to ignore, read from `.gitignore`
 *  rather than hardcoded. Only the anchored directory form (`/docs/patterns/`)
 *  is taken — that is the shape this repo uses for the trees that matter here,
 *  and matching the general gitignore grammar is not worth it for a guard.
 *
 *  ★★ Derived, not listed, because the first version of this file hardcoded ONE
 *  directory name under a comment claiming it "skips gitignored trees" —
 *  `docs/patterns/` is also ignored and was being scanned. A sentence describing
 *  a CATEGORY over code implementing one INSTANCE is the defect; reading the
 *  source of truth removes the gap rather than lengthening the list.
 *
 *  ★★★ An intermediate version fixed that by shelling out to `git ls-files`,
 *  which would have been CORRECT and would have FAILED THE PIPELINE: the CI
 *  default image is `node:24-bookworm-slim`, which ships no `git` binary, and
 *  `unit-tests` is a blocking gate. Accuracy in a comment is not worth a new
 *  external dependency inside a gate — especially one no other file in `src`
 *  has, so nothing would have proved it works first. */
function ignoredDirs(): Set<string> {
  const text = readFileSync(join(ROOT, ".gitignore"), "utf8");
  const dirs = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || line.startsWith("!")) continue;
    if (line.startsWith("/") && line.endsWith("/")) dirs.add(line.slice(1, -1));
  }
  return dirs;
}

/** ★ Filter by EXTENSION: `src/app/favicon.ico` and `docs/assets/dashboard.png`
 *  are TRACKED binaries holding NUL bytes legitimately (offsets 0 and 8).
 *  `docs/open-followups.md` §67 records that the looser "everything under src"
 *  phrasing was written for one command and then disproved by the very sweep
 *  meant to confirm it. */
const EXT = /\.(tsx?|md)$/;

function filesUnder(dir: string, skip: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      // Compare the REPO-RELATIVE path, not the bare name — a hypothetical
      // `src/app/patterns/` must not inherit `docs/patterns/`'s exemption.
      const rel = relative(ROOT, full).split(sep).join("/");
      if (skip.has(rel)) continue;
      out.push(...filesUnder(full, skip));
      continue;
    }
    if (EXT.test(entry)) out.push(full);
  }
  return out;
}

function scannedFiles(): string[] {
  const skip = ignoredDirs();
  return ["src", "docs"].flatMap((d) => filesUnder(join(ROOT, d), skip));
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
  // `open-followups.md` while §67 was being closed. Hence `docs/**/*.md`.
  it("no .ts/.tsx/.md file under src/ or docs/ contains a NUL byte", () => {
    const files = scannedFiles();

    // ★★ POSITIVE CONTROL, and it is load-bearing: the real assertion below is
    //    `toEqual([])`, which passes trivially if `scannedFiles()` ever returns
    //    nothing — a bad extension regex, a cwd that is not the repo root, an
    //    over-broad skip set. Without these the guard can scan zero files and
    //    report success. ★ The second line proves one specific path survives the
    //    filter; the first is what proves the sweep is broad. Do not read either
    //    as proving the extension regex is right.
    expect(files.length).toBeGreaterThan(500);
    expect(files.some((f) => f.endsWith("use-portfolio-health.ts"))).toBe(true);

    const offenders = files
      .map((file) => ({ file, at: readFileSync(file).indexOf(0) }))
      .filter((hit) => hit.at !== -1)
      .map((hit) => `${hit.file} @ byte ${hit.at}`);
    expect(offenders).toEqual([]);
  });

  // The skip set must come from `.gitignore`, never a hardcoded list.
  //
  // ★★★ THIS ASSERTION WAS INVERTED ON 2026-08-21 (0.253.0), AND THE INVERSION IS
  // THE POINT. It used to require BOTH `docs/superpowers` and `docs/patterns` to
  // be skipped, which was right while the planning tree was gitignored — scanning
  // it then meant going red on somebody's untracked scratch file. That tree is now
  // TRACKED: 218 specs and 238 plans, 298 of them recovered from zip archives that
  // were their only copy. It is real repo content, so scanning it is exactly what
  // this guard is for, and the very first run over it found a genuine NUL byte in
  // a recovered document (`2026-07-10-weekly-status-digest.md`) that had sat there
  // unreadable to every grep for months.
  //
  // ★★ Asserting its ABSENCE from the skip set is what stops that coverage being
  // quietly handed back. Re-adding `/docs/superpowers/` to `.gitignore` would make
  // ~456 tracked files invisible to this sweep again while every test still passed,
  // which is the failure this line now exists to prevent.
  it("derives its skip set from .gitignore, and no longer exempts the tracked planning tree", () => {
    const skip = ignoredDirs();
    expect(skip.has("docs/patterns")).toBe(true);
    expect(skip.has("docs/superpowers")).toBe(false);
    // ★ Positive control. `toBe(false)` above is satisfied for the WRONG reason by
    //   a skip set that came back empty — a renamed `.gitignore`, a parser that
    //   stopped matching the anchored-directory form, a cwd that is not the repo
    //   root. This pins that the derivation still produces something.
    expect(skip.size).toBeGreaterThan(0);
  });
});
