import { describe, it, expect, beforeEach } from "vitest";
import { recordDataLossEvent, readDataLossLog } from "./dataloss-forensics";
import { readDiagLog } from "./diagnostics";

beforeEach(() => window.localStorage.clear());

describe("dataloss-forensics (folded into diagnostics)", () => {
  it("records into the unified diag ring under a dataloss.* code", () => {
    recordDataLossEvent({ path: "save-effect", prevCollections: 2, nextCollections: 0, refused: true });
    const diag = readDiagLog();
    expect(diag).toHaveLength(1);
    expect(diag[0].code).toMatch(/^dataloss\./);
    expect(diag[0].fields!.path).toBe("save-effect");
  });

  it("readDataLossLog returns only the dataloss slice, newest-first", () => {
    recordDataLossEvent({ path: "load", prevCollections: 3, nextCollections: 0, refused: true });
    const log = readDataLossLog();
    expect(log).toHaveLength(1);
    expect(log[0].path).toBe("load");
  });
});
