import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// `calendarEvents` must appear in EVERY save path or edits silently vanish on
// reload — the failure mode this repo has shipped TWICE (timelogLinks, and the
// knowledgeItems autosave deps array).
const SRC = readFileSync("src/app/use-storage-backend.ts", "utf8");

describe("calendarEvents is wired into every save path", () => {
  it("appears in each whole-workspace write literal and in currentWorkspace", () => {
    // ★★ MATCH THE LITERAL, NOT THE CALLEE. This scan first read `save({…})`,
    // which silently stopped seeing two of the three the moment §103 routed the
    // explicit-action writes through `truncationOps.guardedWrite(backend, {…})`
    // — the workspace literals were unchanged and still correct, but the count
    // assertion caught it (1 < 3) rather than the scan quietly covering less.
    // Anchoring on the literal's own first field keeps it callee-agnostic.
    // ★★ FLOOR LOWERED 3 → 2 BY CONSOLIDATION, NOT BY LOSS — do NOT "restore"
    // it. Commit 5ef9a9b0 moved the four file-picker actions into
    // `use-storage-file-ops.ts` and, in doing so, replaced the two
    // whole-workspace literals they re-spelled with `deps.currentWorkspace()`.
    // This file now holds exactly two: the `outgoing` autosave object and
    // `currentWorkspace()`'s own return. TWO spellings that every write path
    // funnels through is a STRONGER property than four independent ones — a
    // re-spelled literal is precisely how a new `Workspace` field gets counted
    // here and never written. The floor is only the anti-vacuity guard around
    // the per-field assertion below; what makes the lower number safe is the
    // next test, which forbids the extracted hooks from re-spelling the tuple.
    const saveLiterals = SRC.match(/\{ tasks, raid, absences[^}]*\}/g) ?? [];
    expect(saveLiterals.length).toBeGreaterThanOrEqual(2);
    for (const lit of saveLiterals) expect(lit).toContain("calendarEvents");
  });

  // The invariant that makes the lowered floor safe. The extracted storage
  // hooks must reach the live workspace through `currentWorkspace()` and never
  // re-spell the tuple themselves — otherwise a new `Workspace` field can be
  // added to both literals this file counts and still be dropped one file over,
  // which is the exact defect the floor above exists to catch.
  it("keeps the extracted storage hooks free of a re-spelled workspace literal", () => {
    for (const file of ["use-storage-file-ops.ts", "use-storage-turso-ops.ts"]) {
      const src = readFileSync(`src/app/${file}`, "utf8");
      // Positive observable FIRST: an absence assertion over a gutted or
      // emptied file would pass while checking nothing. These hooks must still
      // read the live workspace via the dep they were extracted to take.
      expect(src, `${file} no longer reads the live workspace at all`).toContain(
        "deps.currentWorkspace()",
      );
      expect(
        src.match(/\{ tasks, raid, absences[^}]*\}/g) ?? [],
        `${file} re-spells the whole-workspace literal — call deps.currentWorkspace() instead, or a new Workspace field lands in use-storage-backend.ts and is silently dropped here`,
      ).toEqual([]);
    }
  });

  it("appears in the autosave effect dependency array", () => {
    const deps = SRC.match(/\}, \[tasks, raid, absences[^\]]*\]/g) ?? [];
    expect(deps.length).toBeGreaterThan(0);
    for (const d of deps) expect(d).toContain("calendarEvents");
  });
});
