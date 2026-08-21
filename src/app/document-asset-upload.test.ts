// src/app/document-asset-upload.test.ts
import { describe, expect, it } from "vitest";
import {
  ASSET_MIME_ALLOWED, ASSET_RAW_MAX_BYTES, ASSET_STORED_MAX_BYTES,
  ASSET_MAX_SOURCE_DIM, ASSET_DOWNSCALE_W, ASSET_DOWNSCALE_H,
  ASSET_MAX_PER_DOCUMENT, checkUploadCandidate,
  readHeaderDimensions, checkHeaderDimensions,
  targetSize, pickSmaller, checkStoredSize, processUpload,
  bytesToBase64, base64ToBytes, hashBytes, findDuplicate,
  type CandidateResult, type UploadRejection, type ImageEncoder,
} from "./document-asset-upload";

const file = (mime: string, size: number) => ({ type: mime, size, name: "x" }) as File;

// ★★ `expect(r.ok).toBe(false)` is a RUNTIME check, not a TS type guard — it
//    does not narrow `CandidateResult`, so `r.reason` fails tsc even though
//    vitest is green (the vitest-green/tsc-red trap this repo's AGENTS.md
//    warns about). This helper narrows for real; `undefined` on the `ok:true`
//    branch still fails a `.toBe(reason)` assertion, so behaviour is unchanged.
function reasonOf(r: CandidateResult): UploadRejection | undefined {
  return r.ok ? undefined : r.reason;
}

describe("checkUploadCandidate", () => {
  it("accepts PNG, JPEG and WebP", () => {
    for (const m of ["image/png", "image/jpeg", "image/webp"]) {
      expect(checkUploadCandidate(file(m, 1024)).ok).toBe(true);
    }
  });

  // ★★ SVG is excluded PERMANENTLY — it is an XSS surface, inheriting the
  //    branding allow-list's reasoning. This is not a cap to relax later.
  it("rejects SVG", () => {
    const r = checkUploadCandidate(file("image/svg+xml", 1024));
    expect(r.ok).toBe(false);
    expect(reasonOf(r)).toBe("format");
  });

  // ★★ GIF is excluded because downscaling re-encodes and would SILENTLY
  //    destroy animation.
  it("rejects GIF", () => {
    expect(reasonOf(checkUploadCandidate(file("image/gif", 1024)))).toBe("format");
  });

  it("rejects a file over the raw ceiling before any decode", () => {
    const r = checkUploadCandidate(file("image/png", ASSET_RAW_MAX_BYTES + 1));
    expect(r.ok).toBe(false);
    expect(reasonOf(r)).toBe("tooLargeRaw");
  });

  it("accepts a file exactly at the raw ceiling", () => {
    expect(checkUploadCandidate(file("image/png", ASSET_RAW_MAX_BYTES)).ok).toBe(true);
  });

  it("rejects an empty file", () => {
    expect(reasonOf(checkUploadCandidate(file("image/png", 0)))).toBe("empty");
  });
});

describe("upload constants", () => {
  it("pins the measured budget", () => {
    expect(ASSET_RAW_MAX_BYTES).toBe(25 * 1024 * 1024);
    expect(ASSET_STORED_MAX_BYTES).toBe(5 * 1024 * 1024);
    expect(ASSET_MAX_SOURCE_DIM).toBe(8000);
    expect(ASSET_DOWNSCALE_W).toBe(1920);
    expect(ASSET_DOWNSCALE_H).toBe(1080);
    expect(ASSET_MAX_PER_DOCUMENT).toBe(20);
  });

  // ★★ The ORDER matters and is the reason the stored cap is applied AFTER
  //    downscale: checking the raw upload against the stored cap would reject
  //    the exact photo that downscaling exists to rescue.
  it("keeps the raw ceiling well above the stored cap", () => {
    expect(ASSET_RAW_MAX_BYTES).toBeGreaterThan(ASSET_STORED_MAX_BYTES);
  });

  it("excludes svg and gif from the allow-list", () => {
    expect(ASSET_MIME_ALLOWED).not.toContain("image/svg+xml");
    expect(ASSET_MIME_ALLOWED).not.toContain("image/gif");
  });
});

describe("readHeaderDimensions", () => {
  // PNG: 8-byte signature, then a 25-byte IHDR whose width/height are big-endian
  // uint32 at offsets 16 and 20.
  function pngHeader(w: number, h: number): Uint8Array {
    const b = new Uint8Array(24);
    b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    new DataView(b.buffer).setUint32(16, w);
    new DataView(b.buffer).setUint32(20, h);
    return b;
  }

  it("reads PNG dimensions from the IHDR", () => {
    expect(readHeaderDimensions(pngHeader(800, 600), "image/png")).toEqual({ width: 800, height: 600 });
  });

  it("returns null for a truncated header rather than throwing", () => {
    expect(readHeaderDimensions(new Uint8Array(4), "image/png")).toBeNull();
  });

  it("returns null when the PNG signature does not match", () => {
    const b = pngHeader(800, 600);
    b[0] = 0x00;
    expect(readHeaderDimensions(b, "image/png")).toBeNull();
  });

  // --- JPEG -----------------------------------------------------------
  //
  // ★★★ The plan's readJpegDimensions snippet was buggy (see the source file's
  // docstring on readJpegDimensions for the two defects) and was NOT used —
  // this file's marker walk was written from scratch against the JPEG marker
  // segment layout in ITU-T T.81 / the JFIF/RFC-2435 summaries of it. These
  // tests exercise the shapes the buggy version got wrong.

  const SOI = [0xff, 0xd8];
  // Minimal APP0/JFIF segment: FF E0, length 0x0010 (16), "JFIF\0", 1.1, units,
  // density x/y, thumbnail w/h.
  const APP0_JFIF = [
    0xff, 0xe0, 0x00, 0x10,
    0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
  ];
  const RST0 = [0xff, 0xd0]; // standalone, no length field
  function sof0(width: number, height: number): number[] {
    // FF C0, length 0x0007 (len field itself + precision + height + width;
    // no component table needed for these tests, which only exercise the
    // marker WALK, not full frame-header validity).
    return [
      0xff, 0xc0, 0x00, 0x07, 0x08,
      (height >> 8) & 0xff, height & 0xff,
      (width >> 8) & 0xff, width & 0xff,
    ];
  }

  it("reads JPEG dimensions from a real SOF0 preceded by an APP0/JFIF segment", () => {
    const bytes = new Uint8Array([...SOI, ...APP0_JFIF, ...sof0(800, 600)]);
    expect(readHeaderDimensions(bytes, "image/jpeg")).toEqual({ width: 800, height: 600 });
  });

  // ★★★ THIS IS THE TEST THAT FAILS AGAINST THE PLAN'S BUGGY WALK. A standalone
  // marker (RST0 here — no length field) sits between SOI and SOF0. The buggy
  // version always reads a 2-byte "length" after every marker byte, so it
  // consumes RST0's non-existent length from what are actually SOF0's own FF
  // C0 marker bytes, desynchronising the whole walk. Mutation-checked below.
  it("reads JPEG dimensions when SOF0 is preceded by a standalone marker", () => {
    const bytes = new Uint8Array([...SOI, ...RST0, ...sof0(640, 480)]);
    expect(readHeaderDimensions(bytes, "image/jpeg")).toEqual({ width: 640, height: 480 });
  });

  it("skips 0xFF fill bytes before a marker", () => {
    const bytes = new Uint8Array([...SOI, 0xff, 0xff, 0xff, ...sof0(320, 240).slice(1)]);
    expect(readHeaderDimensions(bytes, "image/jpeg")).toEqual({ width: 320, height: 240 });
  });

  it("returns null for a JPEG truncated mid-SOF0 rather than throwing", () => {
    const bytes = new Uint8Array([...SOI, 0xff, 0xc0, 0x00]);
    expect(readHeaderDimensions(bytes, "image/jpeg")).toBeNull();
  });

  it("returns null when SOS is reached before any SOF", () => {
    const bytes = new Uint8Array([...SOI, ...APP0_JFIF, 0xff, 0xda, 0x00, 0x0c, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(readHeaderDimensions(bytes, "image/jpeg")).toBeNull();
  });

  // --- WebP -------------------------------------------------------------
  //
  // ★ The plan ships three WebP branches (VP8X, VP8 lossy, VP8L lossless) and
  // tested none of them. Verified against the RIFF container layout and the
  // VP8/VP8L bitstream headers (RFC 6386 §9.1; WebP Lossless Bitstream Spec) —
  // all three offset derivations in the plan's code are correct; these tests
  // pin that rather than assuming it.

  function riffHeader(fourcc: string, chunkSize: number): number[] {
    const bytes: number[] = [];
    for (const c of "RIFF") bytes.push(c.charCodeAt(0));
    bytes.push(0, 0, 0, 0); // file size, unused by the reader
    for (const c of "WEBP") bytes.push(c.charCodeAt(0));
    for (const c of fourcc) bytes.push(c.charCodeAt(0));
    bytes.push(chunkSize & 0xff, (chunkSize >> 8) & 0xff, (chunkSize >> 16) & 0xff, (chunkSize >> 24) & 0xff);
    return bytes;
  }

  it("reads VP8X (extended) WebP dimensions", () => {
    const flags = [0x10, 0x00, 0x00, 0x00]; // flags + 3 reserved bytes
    // canvas width-1 = 799 -> width 800; canvas height-1 = 599 -> height 600
    const w1 = 799, h1 = 599;
    const dims = [
      w1 & 0xff, (w1 >> 8) & 0xff, (w1 >> 16) & 0xff,
      h1 & 0xff, (h1 >> 8) & 0xff, (h1 >> 16) & 0xff,
    ];
    const bytes = new Uint8Array([...riffHeader("VP8X", 10), ...flags, ...dims]);
    expect(readHeaderDimensions(bytes, "image/webp")).toEqual({ width: 800, height: 600 });
  });

  it("reads VP8 (lossy) WebP dimensions", () => {
    // Frame tag (3 bytes, values irrelevant to the reader) + start code
    // 0x9d 0x01 0x2a + width/height as 14-bit little-endian uint16s.
    const frameTag = [0x00, 0x00, 0x00];
    const startCode = [0x9d, 0x01, 0x2a];
    const width = 1024, height = 768;
    const dims = [width & 0xff, (width >> 8) & 0xff, height & 0xff, (height >> 8) & 0xff];
    const bytes = new Uint8Array([...riffHeader("VP8 ", 10), ...frameTag, ...startCode, ...dims]);
    expect(readHeaderDimensions(bytes, "image/webp")).toEqual({ width: 1024, height: 768 });
  });

  it("reads VP8L (lossless) WebP dimensions", () => {
    // Signature 0x2F, then a 32-bit little-endian packed value: 14 bits
    // width-1, 14 bits height-1, 1 bit alpha, 3 bits version.
    const w1 = 399, h1 = 299; // -> width 400, height 300
    const packed = (w1 & 0x3fff) | ((h1 & 0x3fff) << 14);
    const packedBytes = [
      packed & 0xff, (packed >> 8) & 0xff, (packed >> 16) & 0xff, (packed >> 24) & 0xff,
    ];
    // ★ readWebpDimensions floors ALL webp input at 30 bytes regardless of
    //   chunk kind (and never reads the RIFF chunk-size field), so a VP8L
    //   payload — whose real content ends at byte 24 — is padded with
    //   trailing zero bytes purely to clear that floor.
    const content = [...riffHeader("VP8L", 5), 0x2f, ...packedBytes];
    const bytes = new Uint8Array(30);
    bytes.set(content, 0);
    expect(readHeaderDimensions(bytes, "image/webp")).toEqual({ width: 400, height: 300 });
  });

  it("returns null for a truncated WebP rather than throwing", () => {
    const bytes = new Uint8Array([...riffHeader("VP8 ", 10)]); // header only, no chunk data
    expect(readHeaderDimensions(bytes, "image/webp")).toBeNull();
  });

  it("returns null for an unrecognised mime", () => {
    expect(readHeaderDimensions(pngHeader(1, 1), "image/gif")).toBeNull();
  });

  it("never throws on arbitrary bytes for any allowed mime", () => {
    // Deterministic seeded PRNG (mulberry32) — Math.random() is banned by this
    // repo's render-purity lint rule, and a non-deterministic fuzz test would
    // be strictly worse anyway (a failure could not be reproduced).
    function mulberry32(seed: number): () => number {
      let a = seed >>> 0;
      return () => {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    }
    const rand = mulberry32(0xc0ffee);
    const mimes = ["image/png", "image/jpeg", "image/webp"] as const;
    for (let iter = 0; iter < 300; iter++) {
      const len = Math.floor(rand() * 64);
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) bytes[i] = Math.floor(rand() * 256);
      for (const mime of mimes) {
        expect(() => readHeaderDimensions(bytes, mime)).not.toThrow();
      }
    }
  });
});

describe("checkHeaderDimensions", () => {
  it("rejects a decompression bomb before any decode", () => {
    expect(reasonOf(checkHeaderDimensions({ width: 30000, height: 30000 }))).toBe("dimensions");
  });

  it("accepts a dimension exactly at the ceiling", () => {
    expect(checkHeaderDimensions({ width: ASSET_MAX_SOURCE_DIM, height: 100 }).ok).toBe(true);
  });

  it("rejects one dimension over the ceiling even when the other is small", () => {
    expect(checkHeaderDimensions({ width: 100, height: ASSET_MAX_SOURCE_DIM + 1 }).ok).toBe(false);
  });

  // ★★ An UNREADABLE header must not be an automatic pass — that would make the
  //    bomb guard trivially bypassable by corrupting one signature byte.
  it("rejects when dimensions could not be read at all", () => {
    expect(reasonOf(checkHeaderDimensions(null))).toBe("decode");
  });
});

describe("targetSize", () => {
  it("leaves an image already inside the target untouched", () => {
    expect(targetSize({ width: 800, height: 600 })).toEqual({ width: 800, height: 600 });
  });

  it("scales a wide image down by width, preserving aspect ratio", () => {
    expect(targetSize({ width: 3840, height: 2160 })).toEqual({ width: 1920, height: 1080 });
  });

  it("scales a tall image down by height", () => {
    expect(targetSize({ width: 1080, height: 3840 })).toEqual({ width: 304, height: 1080 });
  });

  it("never returns a zero dimension for an extreme aspect ratio", () => {
    const out = targetSize({ width: 20000, height: 1 });
    expect(out.width).toBe(1920);
    expect(out.height).toBeGreaterThanOrEqual(1);
  });
});

describe("pickSmaller", () => {
  // ★★ Re-encoding a photo to PNG can come out LARGER than the source. Keeping
  //    the original in that case is the rule, not an optimisation.
  it("keeps the original when the re-encode came out larger", () => {
    expect(pickSmaller({ bytes: new Uint8Array(100), mime: "image/jpeg" },
                       { bytes: new Uint8Array(200), mime: "image/png" }).mime).toBe("image/jpeg");
  });

  it("takes the re-encode when it is smaller", () => {
    expect(pickSmaller({ bytes: new Uint8Array(300), mime: "image/jpeg" },
                       { bytes: new Uint8Array(120), mime: "image/png" }).mime).toBe("image/png");
  });

  it("keeps the original on a tie, avoiding a needless re-encode", () => {
    expect(pickSmaller({ bytes: new Uint8Array(100), mime: "image/jpeg" },
                       { bytes: new Uint8Array(100), mime: "image/png" }).mime).toBe("image/jpeg");
  });
});

describe("checkStoredSize", () => {
  it("accepts bytes at the stored cap", () => {
    expect(checkStoredSize(ASSET_STORED_MAX_BYTES).ok).toBe(true);
  });

  it("rejects bytes over the stored cap with its own reason code", () => {
    expect(reasonOf(checkStoredSize(ASSET_STORED_MAX_BYTES + 1))).toBe("tooLargeStored");
  });
});

describe("processUpload", () => {
  const png = (w: number, h: number, pad = 0) => {
    const b = new Uint8Array(24 + pad);
    b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    new DataView(b.buffer).setUint32(16, w);
    new DataView(b.buffer).setUint32(20, h);
    return b;
  };
  const shrink: ImageEncoder = async (_b, mime) => ({ bytes: new Uint8Array(10), mime });
  const grow: ImageEncoder = async (_b, mime) => ({ bytes: new Uint8Array(10_000), mime });

  it("does not call the encoder when the image is already within target", async () => {
    let called = false;
    const spy: ImageEncoder = async (b, m) => { called = true; return { bytes: b, mime: m }; };
    const r = await processUpload(png(800, 600), "image/png", spy);
    expect(called).toBe(false);
    expect(r.ok && r.size).toEqual({ width: 800, height: 600 });
  });

  it("records POST-downscale dimensions when the re-encode is kept", async () => {
    const r = await processUpload(png(3840, 2160, 5000), "image/png", shrink);
    expect(r.ok && r.size).toEqual({ width: 1920, height: 1080 });
  });

  // ★★ This is the trap: if the re-encode was DISCARDED for being larger, the
  //    stored bytes are the ORIGINAL, so the stored dimensions must be the
  //    ORIGINAL's too. Recording the target here would make every OOXML export
  //    size that image wrongly in slice S3c-2.
  it("records SOURCE dimensions when the re-encode was discarded as larger", async () => {
    const r = await processUpload(png(3840, 2160), "image/png", grow);
    expect(r.ok && r.size).toEqual({ width: 3840, height: 2160 });
  });

  it("rejects a bomb without calling the encoder", async () => {
    let called = false;
    const spy: ImageEncoder = async (b, m) => { called = true; return { bytes: b, mime: m }; };
    const r = await processUpload(png(30000, 30000), "image/png", spy);
    expect(r.ok).toBe(false);
    expect(called).toBe(false);
  });
});

describe("bytesToBase64 / base64ToBytes", () => {
  it("round-trips arbitrary bytes", () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 255]);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
  });

  it("round-trips an empty array", () => {
    expect(base64ToBytes(bytesToBase64(new Uint8Array(0)))).toEqual(new Uint8Array(0));
  });

  // ★ Chunked encoding: String.fromCharCode.apply blows the argument limit on a
  //   multi-megabyte image, which is exactly the size this ships for.
  it("round-trips a payload past the call-argument limit", () => {
    const big = new Uint8Array(200_000).map((_, i) => i % 256);
    expect(base64ToBytes(bytesToBase64(big))).toEqual(big);
  });

  it("emits no data: prefix — the store holds raw base64", () => {
    expect(bytesToBase64(new Uint8Array([1, 2, 3]))).not.toContain("data:");
  });
});

describe("hashBytes", () => {
  it("returns a stable lowercase hex digest", async () => {
    const h = await hashBytes(new Uint8Array([1, 2, 3]));
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashBytes(new Uint8Array([1, 2, 3]))).toBe(h);
  });

  it("gives different bytes different digests", async () => {
    expect(await hashBytes(new Uint8Array([1]))).not.toBe(await hashBytes(new Uint8Array([2])));
  });
});

describe("findDuplicate", () => {
  const assets = [
    { id: "a1", name: "x", mime: "image/png", size: 1, hash: "aaa", createdAt: "" },
    { id: "a2", name: "y", mime: "image/png", size: 1, hash: "bbb", createdAt: "" },
  ];

  it("finds an existing asset with the same hash", () => {
    expect(findDuplicate(assets, "bbb")?.id).toBe("a2");
  });

  it("returns undefined when nothing matches", () => {
    expect(findDuplicate(assets, "ccc")).toBeUndefined();
  });

  // ★ A blank hash must never match. A row whose hash failed to compute would
  //   otherwise dedup against every other such row and serve the wrong image.
  it("never matches on a blank hash", () => {
    const withBlank = [...assets, { id: "a3", name: "z", mime: "image/png", size: 1, hash: "", createdAt: "" }];
    expect(findDuplicate(withBlank, "")).toBeUndefined();
  });
});
