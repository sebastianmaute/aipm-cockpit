import { describe, expect, it } from "vitest";
import { formatFromFileName } from "./fs-access";

describe("formatFromFileName", () => {
  it("maps .csv to csv (case-insensitive)", () => {
    expect(formatFromFileName("export.csv")).toBe("csv");
    expect(formatFromFileName("EXPORT.CSV")).toBe("csv");
  });

  it("maps .md and .markdown to md", () => {
    expect(formatFromFileName("notes.md")).toBe("md");
    expect(formatFromFileName("notes.markdown")).toBe("md");
  });

  it("defaults to json for .json, unknown extensions, and missing names", () => {
    expect(formatFromFileName("data.json")).toBe("json");
    expect(formatFromFileName("data.txt")).toBe("json");
    expect(formatFromFileName("noext")).toBe("json");
    expect(formatFromFileName(undefined)).toBe("json");
  });
});
