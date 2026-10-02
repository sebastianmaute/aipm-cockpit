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

/** Cap on reported offenders, so a corrupted file cannot flood the failure message. */
const MAX_REPORTED = 50;

/** Every raw C0 control byte other than TAB, LF and CR (or DEL), up to `limit`. */
function controlBytes(bytes: Uint8Array, limit = MAX_REPORTED): Array<{ at: number; byte: number }> {
  const hits: Array<{ at: number; byte: number }> = [];
  for (let i = 0; i < bytes.length && hits.length < limit; i++) {
    const c = bytes[i];
    if (c < 9 || c === 11 || c === 12 || (c > 13 && c < 32) || c === 127) hits.push({ at: i, byte: c });
  }
  return hits;
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

  // ★ Widened for open-followups §201: ANY raw C0 control byte except TAB, LF and
  // CR, plus DEL. A NUL is the only one that makes grep print "Binary file", but a
  // raw U+0001 sat in `jira-api.ts` and two BEL bytes in a plan doc (a lost
  // backslash turning the escape into the byte) and nothing could see them.
  it("no .ts/.tsx/.md file under src/ or docs/ contains a raw control byte other than TAB, LF or CR", () => {
    const files = scannedFiles();
    // ★ Positive control — an empty sweep would pass `toEqual([])` trivially.
    expect(files.length).toBeGreaterThan(500);
    const offenders: string[] = [];
    for (const file of files) {
      for (const hit of controlBytes(readFileSync(file), MAX_REPORTED - offenders.length)) {
        offenders.push(`${relative(ROOT, file)} @ byte ${hit.at} (0x${hit.byte.toString(16).padStart(2, "0")})`);
      }
      if (offenders.length >= MAX_REPORTED) break;
    }
    expect(offenders).toEqual([]);
  });

  // ★ In-test positive control for the DETECTOR itself (the file-count control
  // above proves the sweep is broad, not that the predicate can fire).
  it("the control-byte detector flags a raw 0x01 and passes TAB, LF and CR", () => {
    expect(controlBytes(Buffer.from([0x61, 0x01, 0x62]))).toEqual([{ at: 1, byte: 1 }]);
    expect(controlBytes(Buffer.from([0x61, 0x09, 0x0a, 0x0d, 0x62]))).toEqual([]);
  });

  it("the control-byte detector reports EVERY offender in a buffer, up to its limit", () => {
    const buf = Buffer.from([0x01, 0x61, 0x07, 0x62, 0x00]);
    expect(controlBytes(buf)).toEqual([{ at: 0, byte: 1 }, { at: 2, byte: 7 }, { at: 4, byte: 0 }]);
    expect(controlBytes(buf, 2)).toHaveLength(2);
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
