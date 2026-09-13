import { afterEach, describe, expect, it } from "vitest";
import {
  KEY_FACTS_CACHE_MAX_PROJECTS,
  clearKeyFactsCache,
  keyFactsSnapshot,
  loadKeyFactsSnapshot,
  loadKeyFactsSnapshots,
  removeKeyFactsSnapshot,
  saveKeyFactsSnapshot,
  type KeyFactsSnapshot,
} from "./project-key-facts-cache";
import type { ProjectMeta } from "./types";

const KEY = "aipm-cockpit:project-key-facts";

const SNAP: KeyFactsSnapshot = {
  filled: 9,
  missing: ["code", "regulatory"],
  customer: "ACME Corp",
  at: "2026-09-13T10:00:00.000Z",
};

afterEach(() => clearKeyFactsCache());

describe("project-key-facts-cache", () => {
  it("round-trips a project's snapshot", () => {
    saveKeyFactsSnapshot("p1", SNAP);
    expect(loadKeyFactsSnapshot("p1")).toEqual(SNAP);
  });

  // ★★ Spec §5.3: absence is UNKNOWN, never a measurement of zero.
  it("reads a never-cached project as null (unknown), not as zero", () => {
    expect(loadKeyFactsSnapshot("never-opened")).toBeNull();
  });

  it("keeps projects isolated", () => {
    saveKeyFactsSnapshot("p1", SNAP);
    saveKeyFactsSnapshot("p2", { ...SNAP, filled: 11, missing: [], customer: "Globex" });
    expect(loadKeyFactsSnapshot("p1")?.customer).toBe("ACME Corp");
    expect(loadKeyFactsSnapshot("p2")?.filled).toBe(11);
  });

  it("caps the map, evicting the oldest by `at`", () => {
    for (let i = 0; i < KEY_FACTS_CACHE_MAX_PROJECTS + 5; i++) {
      const n = String(i).padStart(2, "0");
      saveKeyFactsSnapshot(`p${n}`, { ...SNAP, at: `2026-06-${n}T00:00:00.000Z` });
    }
    expect(loadKeyFactsSnapshot("p00")).toBeNull();
    expect(loadKeyFactsSnapshot(`p${KEY_FACTS_CACHE_MAX_PROJECTS + 4}`)).not.toBeNull();
  });

  it("reads corrupt JSON as unknown without throwing", () => {
    window.localStorage.setItem(KEY, "{not json");
    expect(loadKeyFactsSnapshot("p1")).toBeNull();
  });

  it("reads a non-object stored value as unknown", () => {
    window.localStorage.setItem(KEY, JSON.stringify([1, 2]));
    expect(loadKeyFactsSnapshot("p1")).toBeNull();
  });

  it.each([
    ["a non-object entry", 5],
    ["a non-integer filled", { ...SNAP, filled: "9" }],
    ["an out-of-range filled", { ...SNAP, filled: 12, missing: [] }],
    ["an unknown fact id", { ...SNAP, missing: ["code", "nope"] }],
    ["a count that does not add up to eleven", { ...SNAP, filled: 5 }],
    ["a non-string customer", { ...SNAP, customer: 3 }],
    ["a non-string at", { ...SNAP, at: null }],
    ["a non-array missing", { ...SNAP, missing: "code" }],
    // G5: the untested defensive disjuncts.
    ["a null entry", null],
    ["an array-valued entry", ["code", "regulatory"]],
    // G5: a duplicate id in `missing` — without the dedupe check this would
    // wrongly pass (filled=9 + 2 entries === 11) despite repeating one fact
    // and omitting another.
    ["a missing array with a duplicate id", { ...SNAP, filled: 9, missing: ["code", "code"] }],
  ])("reads %s as unknown", (_label, entry) => {
    window.localStorage.setItem(KEY, JSON.stringify({ p1: entry }));
    expect(loadKeyFactsSnapshot("p1")).toBeNull();
  });

  // G5: a bare (non-object, non-array) top-level stored value — the existing
  // "non-object stored value" test only covers the array case.
  it.each([
    ["a bare string", JSON.stringify("nope")],
    ["a bare number", JSON.stringify(11)],
  ])("reads %s as the top-level stored value, as an empty map", (_label, raw) => {
    window.localStorage.setItem(KEY, raw);
    expect(loadKeyFactsSnapshot("p1")).toBeNull();
    expect(loadKeyFactsSnapshots()).toEqual({});
  });

  it("clears every snapshot", () => {
    saveKeyFactsSnapshot("p1", SNAP);
    clearKeyFactsCache();
    expect(loadKeyFactsSnapshot("p1")).toBeNull();
  });

  it("builds a snapshot from live metadata", () => {
    const meta: ProjectMeta = {
      name: "Apollo", code: "", projectManager: "Dana", keyStakeholdersInternal: [], keyStakeholdersExternal: [],
      customer: "ACME Corp", naceSection: "C", identityTypes: [], products: "Widget", deployment: "Cloud",
      startDate: "2026-01-01", endDate: "", profitCenter: "PC-9",
      contactPersons: [{ name: "Pat", email: "", synced: false }], regulatory: [],
    };
    expect(keyFactsSnapshot(meta, "2026-09-13T10:00:00.000Z")).toEqual({
      filled: 9, missing: ["code", "regulatory"], customer: "ACME Corp", at: "2026-09-13T10:00:00.000Z",
    });
  });
});

// G1: one parse-and-validate pass over the whole map, so a caller needing
// every row (the Projects-list memo) doesn't re-parse the stored blob once
// per row.
describe("loadKeyFactsSnapshots", () => {
  it("reads every stored snapshot in one call", () => {
    saveKeyFactsSnapshot("p1", SNAP);
    saveKeyFactsSnapshot("p2", { ...SNAP, filled: 11, missing: [], customer: "Globex" });
    expect(loadKeyFactsSnapshots()).toEqual({
      p1: SNAP,
      p2: { ...SNAP, filled: 11, missing: [], customer: "Globex" },
    });
  });

  it("returns an empty map when nothing is cached", () => {
    expect(loadKeyFactsSnapshots()).toEqual({});
  });

  // Same validation as loadKeyFactsSnapshot — a corrupt entry is dropped,
  // not merely hidden from a single-id lookup.
  it("drops a corrupt entry, keeping the valid ones", () => {
    saveKeyFactsSnapshot("p1", SNAP);
    const map = JSON.parse(window.localStorage.getItem(KEY)!);
    map.p2 = { ...SNAP, filled: "9" }; // non-integer filled
    window.localStorage.setItem(KEY, JSON.stringify(map));
    expect(loadKeyFactsSnapshots()).toEqual({ p1: SNAP });
  });
});

// G2: drop a project's entry when it is deleted/de-registered — mirrors
// clearKeyFactsCache's use of removeDeviceKey for the whole-map-empty case.
describe("removeKeyFactsSnapshot", () => {
  it("removes one project's entry, leaving the others", () => {
    saveKeyFactsSnapshot("p1", SNAP);
    saveKeyFactsSnapshot("p2", { ...SNAP, filled: 11, missing: [], customer: "Globex" });
    removeKeyFactsSnapshot("p1");
    expect(loadKeyFactsSnapshot("p1")).toBeNull();
    expect(loadKeyFactsSnapshot("p2")?.customer).toBe("Globex");
  });

  it("is a no-op for an unknown id", () => {
    saveKeyFactsSnapshot("p1", SNAP);
    removeKeyFactsSnapshot("never-opened");
    expect(loadKeyFactsSnapshot("p1")).toEqual(SNAP);
  });

  it("removes the key entirely once the map becomes empty", () => {
    saveKeyFactsSnapshot("p1", SNAP);
    removeKeyFactsSnapshot("p1");
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });
});
