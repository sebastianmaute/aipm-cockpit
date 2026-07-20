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
  // insights — this covers the three save literals, the outgoing snapshot, the
  // currentWorkspace() return, and (critically) the autosave-effect deps array.
  const tupleLines = SRC.split(/\r?\n/).filter(
    (line) => line.includes("knowledgeItems") && line.includes("settingsOverrides"),
  );

  it("has the shared workspace tuple in more than one place (sanity)", () => {
    // Guards against the scan silently matching nothing (e.g. after a rename)
    // and passing vacuously. There are 4 save/return literals + 1 deps array.
    expect(tupleLines.length).toBeGreaterThanOrEqual(5);
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
