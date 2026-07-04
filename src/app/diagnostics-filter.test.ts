import { describe, it, expect } from "vitest";
import { filterDiag, summarizeDiag } from "./diagnostics-filter";
import type { DiagEvent } from "./diagnostics";

const evts: DiagEvent[] = [
  { at: "2026-07-04T10:00:03.000Z", level: "error", code: "storage.saveFailed" },
  { at: "2026-07-04T10:00:02.000Z", level: "warn", code: "dataloss.refused" },
  { at: "2026-07-04T10:00:01.000Z", level: "info", code: "storage.loaded" },
];

describe("filterDiag", () => {
  it("filters by level set", () => {
    expect(filterDiag(evts, new Set(["error"]), "").map((e) => e.code)).toEqual(["storage.saveFailed"]);
  });
  it("filters by code substring (case-insensitive)", () => {
    expect(filterDiag(evts, new Set(["error", "warn", "info"]), "STORAGE").map((e) => e.code)).toEqual(["storage.saveFailed", "storage.loaded"]);
  });
  it("empty query returns all (of the allowed levels)", () => {
    expect(filterDiag(evts, new Set(["error", "warn", "info"]), "").length).toBe(3);
  });
  it("empty level set returns none", () => {
    expect(filterDiag(evts, new Set(), "").length).toBe(0);
  });
});

describe("summarizeDiag", () => {
  it("counts per level + newest error (events newest-first)", () => {
    expect(summarizeDiag(evts)).toMatchObject({ error: 1, warn: 1, info: 1, newestErrorAt: "2026-07-04T10:00:03.000Z" });
  });
  it("no errors → no newestErrorAt", () => {
    expect(summarizeDiag([evts[2]]).newestErrorAt).toBeUndefined();
  });
});
