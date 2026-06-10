import { describe, expect, test } from "vitest";
import {
  sanitizeDocumentLinks,
  encodeDocumentLinks,
  decodeDocumentLinks,
  type DocumentLink,
} from "./document-link";

const file: DocumentLink = {
  id: "01ABC",
  name: "Spec.docx",
  url: "https://contoso.sharepoint.com/sites/proj/Shared%20Documents/Spec.docx",
  kind: "file",
  driveId: "b!drive",
  itemId: "01ABC",
  mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  addedAt: "2026-06-10T00:00:00.000Z",
};

describe("sanitizeDocumentLinks", () => {
  test("returns [] for non-arrays / nullish", () => {
    expect(sanitizeDocumentLinks(undefined)).toEqual([]);
    expect(sanitizeDocumentLinks(null)).toEqual([]);
    expect(sanitizeDocumentLinks("nope")).toEqual([]);
    expect(sanitizeDocumentLinks({})).toEqual([]);
  });

  test("drops entries missing a usable url or name", () => {
    const out = sanitizeDocumentLinks([
      { name: "", url: "https://x", kind: "file" },
      { name: "ok", url: "", kind: "file" },
      { name: "keep", url: "https://contoso.sharepoint.com/a", kind: "folder" },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("keep");
    expect(out[0].kind).toBe("folder");
  });

  test("clamps kind to the union and trims strings", () => {
    const out = sanitizeDocumentLinks([
      { name: "  trimmed  ", url: "  https://contoso.sharepoint.com/a  ", kind: "weird" },
    ]);
    expect(out[0].name).toBe("trimmed");
    expect(out[0].url).toBe("https://contoso.sharepoint.com/a");
    expect(out[0].kind).toBe("file"); // unknown kind defaults to "file"
  });

  test("preserves a fully-formed link verbatim", () => {
    expect(sanitizeDocumentLinks([file])).toEqual([file]);
  });

  test("generates an id when missing", () => {
    const out = sanitizeDocumentLinks([{ name: "n", url: "https://contoso.sharepoint.com/a", kind: "file" }]);
    expect(typeof out[0].id).toBe("string");
    expect(out[0].id.length).toBeGreaterThan(0);
  });

  test("generates distinct ids for multiple id-less entries", () => {
    const out = sanitizeDocumentLinks([
      { name: "a", url: "https://x", kind: "file" },
      { name: "b", url: "https://y", kind: "file" },
    ]);
    expect(out[0].id).not.toBe(out[1].id);
  });
});

describe("encode/decode round-trip (JSON-in-cell)", () => {
  test("empty/undefined encodes to empty string (byte-stable)", () => {
    expect(encodeDocumentLinks(undefined)).toBe("");
    expect(encodeDocumentLinks([])).toBe("");
  });

  test("decode of empty string is []", () => {
    expect(decodeDocumentLinks("")).toEqual([]);
    expect(decodeDocumentLinks(undefined)).toEqual([]);
  });

  test("round-trips through encode -> decode", () => {
    const links = [file, { ...file, id: "02", name: "Folder", kind: "folder" as const }];
    expect(decodeDocumentLinks(encodeDocumentLinks(links))).toEqual(links);
  });

  test("decode tolerates malformed JSON", () => {
    expect(decodeDocumentLinks("{not json")).toEqual([]);
  });
});
