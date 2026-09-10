// @vitest-environment node
import { describe, expect, it } from "vitest";
import { resolveLogDir } from "./log-paths";

describe("resolveLogDir", () => {
  it("uses LOCALAPPDATA when present", () => {
    expect(resolveLogDir({ LOCALAPPDATA: "C:\\Users\\x\\AppData\\Local" })).toBe(
      "C:\\Users\\x\\AppData\\Local\\aipm-cockpit\\logs",
    );
  });

  it("falls back to a temp path when LOCALAPPDATA is absent", () => {
    // Never return an empty string or throw: losing the log is how a remote
    // "it doesn't open" becomes unsupportable.
    const dir = resolveLogDir({ TEMP: "C:\\Temp" });
    expect(dir).toBe("C:\\Temp\\aipm-cockpit\\logs");
  });

  it("never returns an empty path even with an empty environment", () => {
    const dir = resolveLogDir({});
    expect(dir.length).toBeGreaterThan(0);
    expect(dir).toContain("aipm-cockpit");
  });

  it("ignores an empty-string LOCALAPPDATA rather than building a rooted path", () => {
    const dir = resolveLogDir({ LOCALAPPDATA: "", TEMP: "C:\\Temp" });
    expect(dir).toBe("C:\\Temp\\aipm-cockpit\\logs");
  });
});
