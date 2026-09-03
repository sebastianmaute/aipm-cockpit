import { describe, it, expect } from "vitest";
import { ingestBytes, ingestFile } from "./attachment-ingest";

const enc = (s: string) => new TextEncoder().encode(s);

describe("ingestBytes", () => {
  it("rejects an unsupported type", async () => {
    const r = await ingestBytes(enc("x"), "application/x-thing", "a.thing");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("unsupported-type");
  });

  it("rejects an oversized file before reading it", async () => {
    const r = await ingestBytes(new Uint8Array(21 * 1024 * 1024), "text/plain", "big.txt");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("too-large");
  });

  it("decodes text", async () => {
    const r = await ingestBytes(enc("hello"), "text/plain", "a.txt");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.node.kind).toBe("text");
      expect(r.node.block.source).toMatchObject({ type: "text", data: "hello" });
    }
  });

  it("routes html through the html extractor", async () => {
    const r = await ingestBytes(enc("<p>Hi</p><script>x()</script>"), "text/html", "a.html");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.node.kind).toBe("html");
      const src = r.node.block.source as { data: string };
      expect(src.data).toContain("Hi");
      expect(src.data).not.toContain("x()");
    }
  });

  it("base64-encodes a pdf without decoding it as text", async () => {
    const r = await ingestBytes(new Uint8Array([0x25, 0x50, 0x44, 0x46]), "application/pdf", "a.pdf");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.node.block.source).toMatchObject({ type: "base64", data: "JVBERg==" });
  });

  it("reports one node and no children for a flat file", async () => {
    const r = await ingestBytes(enc("hello"), "text/plain", "a.txt");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.node.children).toEqual([]);
  });

  // ★★★ REGRESSION GUARD: buildAttachmentBlock passes an image's mimeType
  // straight into source.media_type (unlike every other kind, which builds a
  // fixed internal value) — an empty File.type (common on drag-drop) must not
  // reach it verbatim, or the API 400s on media_type: "". mimeForKind's old
  // `file.type || mimeForKind(kind)` fallback covered this before the
  // three-consumer refactor; this pins its replacement.
  it("falls back to a media_type derived from the extension when mimeType is empty", async () => {
    const r = await ingestBytes(new Uint8Array([1, 2, 3]), "", "photo.jpg");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.node.block.source).toMatchObject({ media_type: "image/jpeg" });
  });

  it("falls back to image/png for a mimeType-less .png", async () => {
    const r = await ingestBytes(new Uint8Array([1, 2, 3]), "", "photo.png");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.node.block.source).toMatchObject({ media_type: "image/png" });
  });

  // Control: a NON-empty (if wrong) mimeType is passed through unchanged —
  // the fallback only fires on "", matching the old `||` semantics exactly.
  it("does not override a present (even if wrong) image mimeType", async () => {
    const r = await ingestBytes(new Uint8Array([1, 2, 3]), "image/gif", "photo.jpg");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.node.block.source).toMatchObject({ media_type: "image/gif" });
  });
});

describe("ingestFile", () => {
  // ★★★ REGRESSION GUARD: ingestFile must classify BEFORE reading the file's
  // bytes — both old callers ordered it size -> classify -> read. Reading
  // first meant a large unsupported file was fully loaded into memory before
  // being rejected, and a read failure on a would-be-unsupported file
  // surfaced as "read-failed" instead of "unsupported-type" — the wizard's
  // batch loop treats those two very differently (drop-and-continue vs.
  // abandon-the-whole-batch).
  it("classifies before reading — an unsupported file's bytes are never read", async () => {
    const file = new File(["x"], "bad.exe", { type: "application/x-msdownload" });
    let readCalled = false;
    file.arrayBuffer = () => {
      readCalled = true;
      return Promise.reject(new Error("should not be called"));
    };
    const r = await ingestFile(file);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe("unsupported-type");
    expect(readCalled).toBe(false);
  });

  it("still reads a supported file's bytes", async () => {
    const file = new File(["hello"], "a.txt", { type: "text/plain" });
    const r = await ingestFile(file);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.node.block.source).toMatchObject({ type: "text", data: "hello" });
  });
});
