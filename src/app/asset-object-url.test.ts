import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { assetBytesToObjectUrl } from "./asset-object-url";

// A 1x1 transparent GIF, base64 — small, real, and decodes under jsdom's atob.
const TINY_GIF = "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

describe("assetBytesToObjectUrl", () => {
  beforeEach(() => {
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "blob:stub-url"),
      revokeObjectURL: vi.fn(),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  // ★ `image/gif` is NOT in ASSET_MIME_ALLOWED (document-asset-upload.ts) —
  // GIF is blocked because downscaling would destroy animation — so this uses
  // `image/png` for the allowed case. The base64 bytes are a real GIF, but
  // assetBytesToObjectUrl trusts the passed mime, not the sniffed content.
  it("returns an object URL for an allowed mime", () => {
    const r = assetBytesToObjectUrl(TINY_GIF, "image/png");
    expect(r).toEqual({ kind: "ok", url: "blob:stub-url" });
  });

  // ★★★ THE CASE A `!== undefined` TEST GETS WRONG. A blank mime survives
  // sanitising and such an asset has always rendered by content-sniffing, so
  // it must produce a URL, not a refusal.
  it("still returns a URL when the stored mime is blank", () => {
    const r = assetBytesToObjectUrl(TINY_GIF, "");
    expect(r).toEqual({ kind: "ok", url: "blob:stub-url" });
  });

  it("refuses a blocked mime without minting a URL", () => {
    const r = assetBytesToObjectUrl(TINY_GIF, "image/svg+xml");
    expect(r).toEqual({ kind: "blocked" });
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("reports undecodable bytes rather than throwing", () => {
    const r = assetBytesToObjectUrl("!!!not base64!!!", "image/png");
    expect(r).toEqual({ kind: "unavailable" });
  });
});
