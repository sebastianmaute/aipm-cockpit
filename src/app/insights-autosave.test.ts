// src/app/insights-autosave.test.ts
//
// Regression guard for the AUTOSAVE-DEPS data-loss landmine (shipped twice
// before for other persisted fields): a persisted `Workspace` field must be
// present in EVERY `backend.save({…})` / `currentWorkspace()` literal in
// use-storage-backend.ts AND in the autosave-effect DEPS ARRAY. If it is in a
// save literal but missing from the deps array, a field-only edit is silently
// LOST on reload because the debounced save effect never refires.
//
// `insights` is wired in lockstep with `knowledgeItems` (its precedent), so
// this scans the source and asserts that every line carrying the shared
// `knowledgeItems … settingsOverrides` workspace tuple (the save literals, the
// `outgoing` snapshot, the `currentWorkspace()` return, AND the deps array)
// also carries `insights`. A source scan is the honest guard here — the deps
// array is not observable from a behavioral round-trip.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SRC = readFileSync(
  join(process.cwd(), "src/app/use-storage-backend.ts"),
  "utf8",
);

describe("insights autosave wiring (use-storage-backend.ts)", () => {
  // Every workspace tuple that persists knowledgeItems must also persist
  // insights — this covers the `outgoing` snapshot, the currentWorkspace()
  // return, and (critically) the autosave-effect deps array.
  const tupleLines = SRC.split(/\r?\n/).filter(
    (line) => line.includes("knowledgeItems") && line.includes("settingsOverrides"),
  );

  it("has the shared workspace tuple in more than one place (sanity)", () => {
    // Guards against the scan silently matching nothing (e.g. after a rename)
    // and passing vacuously.
    // ★★ FLOOR LOWERED 5 → 3 BY CONSOLIDATION, NOT BY LOSS — do NOT "restore"
    // it. It used to be 4 save/return literals + 1 deps array; commit 5ef9a9b0
    // moved the four file-picker actions into `use-storage-file-ops.ts` and, in
    // doing so, replaced the two whole-workspace literals they re-spelled with
    // `deps.currentWorkspace()`. What remains is the `outgoing` snapshot, the
    // autosave-effect deps array and `currentWorkspace()`'s return — THREE
    // lines every write path now funnels through, which is a stronger property
    // than five independent spellings. What makes the lower number safe is the
    // next test, forbidding a re-spelled tuple in the extracted hooks.
    expect(tupleLines.length).toBeGreaterThanOrEqual(3);
  });

  // The invariant that makes the lowered floor safe. The extracted storage
  // hooks must take the live workspace from `currentWorkspace()` and never
  // re-spell the tuple — otherwise `insights` can be present in all three lines
  // above and still be dropped by a write path one file over, which is the
  // exact defect this scan exists to catch.
  it("keeps the extracted storage hooks free of a re-spelled workspace tuple", () => {
    for (const file of ["use-storage-file-ops.ts", "use-storage-turso-ops.ts"]) {
      const src = readFileSync(join(process.cwd(), "src/app", file), "utf8");
      // Positive observable FIRST: an absence assertion over a gutted or
      // emptied file would pass while checking nothing. These hooks must still
      // read the live workspace via the dep they were extracted to take.
      expect(src, `${file} no longer reads the live workspace at all`).toContain(
        "deps.currentWorkspace()",
      );
      const respelled = src
        .split(/\r?\n/)
        .filter((line) => line.includes("knowledgeItems") && line.includes("settingsOverrides"));
      expect(
        respelled,
        `${file} re-spells the whole-workspace tuple — call deps.currentWorkspace() instead, or a field wired into use-storage-backend.ts is silently dropped here:\n${respelled.join("\n")}`,
      ).toEqual([]);
    }
  });

  it("carries `insights` in every knowledgeItems/settingsOverrides tuple (incl. the deps array)", () => {
    const missing = tupleLines.filter((line) => !line.includes("insights"));
    expect(
      missing,
      `insights missing from ${missing.length} workspace tuple(s) — a save literal or the autosave DEPS array dropped it (silent data-loss on reload):\n${missing.join("\n")}`,
    ).toEqual([]);
  });

  it("applyWorkspace restores insights on load", () => {
    expect(SRC).toMatch(/setInsights\(workspace\.insights\)/);
  });
});
