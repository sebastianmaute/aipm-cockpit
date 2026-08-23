import { describe, it, expect } from "vitest";
import { buildZip } from "../app/zip";
import { unzipBytes } from "./unzip-bytes";

describe("unzipBytes", () => {
  it("round-trips binary that is not valid UTF-8", async () => {
    // 0xFF 0xFE 0x00 is invalid UTF-8 — TextDecoder would replace it with
    // U+FFFD, which is exactly why the text helper cannot check an image.
    const bytes = new Uint8Array([0xff, 0xfe, 0x00, 0x41, 0x89, 0x50]);
    const blob = buildZip([{ path: "media/image1.png", data: bytes }], "application/zip");
    const parts = await unzipBytes(blob);
    expect(Array.from(parts.get("media/image1.png")!)).toEqual(Array.from(bytes));
  });

  it("returns every entry", async () => {
    const blob = buildZip(
      [{ path: "a.xml", data: "<a/>" }, { path: "b/c.bin", data: new Uint8Array([1, 2]) }],
      "application/zip",
    );
    const parts = await unzipBytes(blob);
    expect([...parts.keys()].sort()).toEqual(["a.xml", "b/c.bin"]);
  });
});
