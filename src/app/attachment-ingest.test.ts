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

  // ★★★ REGRESSION GUARD: before this branch existed, "mail" fell through to
  // the base64 path (payloadFor's default) while buildAttachmentBlock's
  // "mail" branch treats `data` as pre-extracted Markdown — so a dropped
  // .eml silently sent the model a base64 blob presented as prose. Assert
  // BOTH that real header/body content comes through AND that the output
  // does not look like the base64 of the raw message.
  it("routes eml through the mail extractor to readable Markdown, not base64", async () => {
    const eml = [
      "Subject: Weekly status",
      "From: alice@example.com",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Hello team, the migration is done.",
    ].join("\r\n");
    const r = await ingestBytes(enc(eml), "message/rfc822", "status.eml");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.node.kind).toBe("mail");
    const src = r.node.block.source as { type: string; data: string };
    expect(src.type).toBe("text");
    expect(src.data).toContain("**Subject:** Weekly status");
    expect(src.data).toContain("Hello team, the migration is done.");
    // The raw message contains no "@" once base64-encoded, and base64 of a
    // message this size is one unbroken run with no space or literal "@" —
    // the readable Markdown has both.
    expect(src.data).toContain("alice@example.com");
    expect(src.data).not.toMatch(/^[A-Za-z0-9+/=\s]+$/);
  });

  it("reports no children for a flat mail message (recursion is Task 10's job)", async () => {
    const eml = ["Subject: x", "", "body"].join("\r\n");
    const r = await ingestBytes(enc(eml), "message/rfc822", "x.eml");
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
