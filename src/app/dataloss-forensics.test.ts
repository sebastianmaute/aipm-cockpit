import { describe, it, expect, beforeEach } from "vitest";
import { recordDataLossEvent, readDataLossLog } from "./dataloss-forensics";

beforeEach(() => window.localStorage.clear());

describe("dataloss-forensics", () => {
  it("appends events newest-first with a timestamp + stack", () => {
    recordDataLossEvent({ path: "save-effect", prevCollections: 2, nextCollections: 0, refused: true });
    recordDataLossEvent({ path: "load", prevCollections: 3, nextCollections: 0, refused: true });
    const log = readDataLossLog();
    expect(log).toHaveLength(2);
    expect(log[0].path).toBe("load"); // newest first
    expect(log[0].at).toMatch(/^\d{4}-/);
    expect(typeof log[0].stack).toBe("string");
  });

  it("caps the ring at 25", () => {
    for (let i = 0; i < 40; i++) {
      recordDataLossEvent({ path: `p${i}`, prevCollections: 1, nextCollections: 0, refused: false });
    }
    const log = readDataLossLog();
    expect(log).toHaveLength(25);
    expect(log[0].path).toBe("p39"); // newest retained
  });

  it("returns [] and never throws on malformed storage", () => {
    window.localStorage.setItem("lop-app:dataloss-log", "{not json");
    expect(readDataLossLog()).toEqual([]);
  });
});
