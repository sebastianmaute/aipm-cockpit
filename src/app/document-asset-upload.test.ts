// src/app/document-asset-upload.test.ts
import { describe, expect, it } from "vitest";
import {
  ASSET_MIME_ALLOWED, ASSET_RAW_MAX_BYTES, ASSET_STORED_MAX_BYTES,
  ASSET_MAX_SOURCE_DIM, ASSET_DOWNSCALE_W, ASSET_DOWNSCALE_H,
  ASSET_MAX_PER_DOCUMENT, checkUploadCandidate,
  type CandidateResult, type UploadRejection,
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
