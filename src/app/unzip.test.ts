import { describe, expect, it } from "vitest";
import { readZipEntries } from "./unzip";
import { buildZip } from "./zip";
import { decodeUtf8 } from "./office-xml";

// buildZip returns a Blob and takes `{ path, data }` entries, so the fixture
// helper maps to that shape and reads the Blob back into bytes (async).
async function zipOf(files: { name: string; text: string }[]): Promise<Uint8Array> {
  const blob = buildZip(files.map((f) => ({ path: f.name, data: new TextEncoder().encode(f.text) })));
  return new Uint8Array(await blob.arrayBuffer());
}

describe("readZipEntries", () => {
  it("reads stored entries back by path", async () => {
    const zip = await zipOf([
      { name: "a.xml", text: "<root>alpha</root>" },
      { name: "dir/b.txt", text: "beta" },
    ]);
    const entries = await readZipEntries(zip);
    expect(decodeUtf8(entries.get("a.xml")!)).toBe("<root>alpha</root>");
    expect(decodeUtf8(entries.get("dir/b.txt")!)).toBe("beta");
  });

  it("inflates a real deflate-compressed entry", async () => {
    const b64 =
      "UEsDBBQAAAAIAAAAIQCwUGpZDQAAAAsAAAAJAAAAaGVsbG8udHh0y0jNyclXKM8vykkBAFBLAQIUABQAAAAIAAAAIQCwUGpZDQAAAAsAAAAJAAAAAAAAAAAAAAAAAAAAAABoZWxsby50eHRQSwUGAAAAAAEAAQA3AAAANAAAAAAA";
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const entries = await readZipEntries(bytes);
    expect(decodeUtf8(entries.get("hello.txt")!)).toBe("hello world");
  });

  it("throws on non-zip input", async () => {
    await expect(readZipEntries(new TextEncoder().encode("not a zip"))).rejects.toThrow();
  });

  it("rejects when total decompressed size exceeds the aggregate budget", async () => {
    const zip = await zipOf([
      { name: "a.txt", text: "x".repeat(50) },
      { name: "b.txt", text: "y".repeat(50) },
      { name: "c.txt", text: "z".repeat(50) },
    ]);
    // Total stored bytes = 150; a 100-byte budget must trip.
    await expect(readZipEntries(zip, 100)).rejects.toThrow(/exceeds/);
  });

  it("accepts an archive within the aggregate budget", async () => {
    const zip = await zipOf([{ name: "a.txt", text: "hello" }]);
    const entries = await readZipEntries(zip, 1000);
    expect(decodeUtf8(entries.get("a.txt")!)).toBe("hello");
  });
});
