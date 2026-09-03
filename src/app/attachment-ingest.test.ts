import { describe, it, expect } from "vitest";
import { ingestBytes } from "./attachment-ingest";

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
});
