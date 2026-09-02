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

  // ★★★ THE ONLY INPUT THAT CAN SEE THE CHECK ORDER, AND THE MODULE HEADER
  // MAKES THAT ORDER LOAD-BEARING. It says this function tests the blocked
  // mime BEFORE decoding while `attachAssetImages` decodes first and tests
  // after, "so for bytes that are both undecodable AND blocked the two
  // disagree" — that documented disagreement is the stated reason migrating
  // the other call site is not a pure refactor. Nothing pinned it: every
  // other test here holds one of the two variables sound (valid bytes, or an
  // allowed mime), so swapping the two guards left the whole file green and
  // the header's justification became unfalsifiable.
  // ★ Mutation: move the `isBlockedAssetMime` check below the decode in
  // `asset-object-url.ts`. Only this test goes red, and it reports
  // "unavailable" — which is exactly `attachAssetImages`' answer, i.e. the
  // mutation silently converts this module into the other one.
  it("reports a blocked mime even when the bytes are also undecodable", () => {
    const r = assetBytesToObjectUrl("!!!not base64!!!", "image/svg+xml");
    expect(r).toEqual({ kind: "blocked" });
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
});
