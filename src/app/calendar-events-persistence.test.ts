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
    const saveLiterals = SRC.match(/\{ tasks, raid, absences[^}]*\}/g) ?? [];
    expect(saveLiterals.length).toBeGreaterThanOrEqual(3);
    for (const lit of saveLiterals) expect(lit).toContain("calendarEvents");
  });

  it("appears in the autosave effect dependency array", () => {
    const deps = SRC.match(/\}, \[tasks, raid, absences[^\]]*\]/g) ?? [];
    expect(deps.length).toBeGreaterThan(0);
    for (const d of deps) expect(d).toContain("calendarEvents");
  });
});
