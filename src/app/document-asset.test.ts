import { describe, expect, it } from "vitest";
import { sanitizeDocumentAsset, type DocumentAsset } from "./document-asset";

const valid: DocumentAsset = {
  id: "a1",
  name: "chart.png",
  mime: "image/png",
  size: 1024,
  width: 800,
  height: 600,
  hash: "abc123",
  createdAt: "2026-08-21T10:00:00.000Z",
};

describe("sanitizeDocumentAsset", () => {
  it("passes a valid asset through unchanged", () => {
    expect(sanitizeDocumentAsset({ ...valid })).toEqual(valid);
  });

  it("returns null when id is missing or blank", () => {
    expect(sanitizeDocumentAsset({ ...valid, id: "" })).toBeNull();
    expect(sanitizeDocumentAsset({ ...valid, id: undefined })).toBeNull();
  });

  it("returns null for a non-object", () => {
    expect(sanitizeDocumentAsset(null)).toBeNull();
    expect(sanitizeDocumentAsset("nope")).toBeNull();
  });

  it("coerces numeric fields from strings, as the CSV decode path supplies them", () => {
    const out = sanitizeDocumentAsset({ ...valid, size: "1024", width: "800", height: "600" });
    expect(out).toEqual(valid);
  });

  // ★ The store is mime-GENERIC on purpose: format policy lives in the upload
  //   pipeline (Task 11), never here. A PDF row must survive this sanitizer so a
  //   later attachment slice needs no migration.
  it("keeps a non-image mime and omits dimensions", () => {
    const out = sanitizeDocumentAsset({
      id: "p1", name: "spec.pdf", mime: "application/pdf",
      size: 2048, hash: "def456", createdAt: "2026-08-21T10:00:00.000Z",
    });
    expect(out?.mime).toBe("application/pdf");
    expect(out?.width).toBeUndefined();
    expect(out?.height).toBeUndefined();
  });

  it("drops a dimension that is not a finite positive number", () => {
    expect(sanitizeDocumentAsset({ ...valid, width: "abc" })?.width).toBeUndefined();
    expect(sanitizeDocumentAsset({ ...valid, height: -5 })?.height).toBeUndefined();
    expect(sanitizeDocumentAsset({ ...valid, width: Infinity })?.width).toBeUndefined();
  });

  it("floors size at 0 rather than dropping the row", () => {
    expect(sanitizeDocumentAsset({ ...valid, size: -1 })?.size).toBe(0);
    expect(sanitizeDocumentAsset({ ...valid, size: "junk" })?.size).toBe(0);
  });

  // A bare object literal ({ toString: null }) does NOT reproduce the hazard —
  // its prototype's Object.prototype.toString is still reachable. Only a
  // literal own-key of null (as JSON.parse produces) makes Number()/String()
  // throw "Cannot convert object to primitive value".
  it("does not throw on a poisoned primitive-conversion object, for every coerced field", () => {
    const poison = JSON.parse('{"toString":null,"valueOf":null}') as unknown;
    expect(() => sanitizeDocumentAsset({ ...valid, id: poison })).not.toThrow();
    expect(sanitizeDocumentAsset({ ...valid, id: poison })).toBeNull();

    for (const field of ["name", "mime", "hash", "createdAt", "size", "width", "height"] as const) {
      expect(() => sanitizeDocumentAsset({ ...valid, [field]: poison })).not.toThrow();
      expect(sanitizeDocumentAsset({ ...valid, [field]: poison })).not.toBeNull();
    }
  });

  it("omits an absent dimension as a missing key, not an undefined value", () => {
    const out = sanitizeDocumentAsset({
      id: "p1", name: "spec.pdf", mime: "application/pdf",
      size: 2048, hash: "def456", createdAt: "2026-08-21T10:00:00.000Z",
    });
    expect("width" in out!).toBe(false);
    expect("height" in out!).toBe(false);
  });

  it("caps name and hash at their length limits", () => {
    const longName = "n".repeat(300);
    const longHash = "h".repeat(300);
    const out = sanitizeDocumentAsset({ ...valid, name: longName, hash: longHash });
    expect(out?.name.length).toBe(256);
    expect(out?.hash.length).toBe(128);
  });
});
