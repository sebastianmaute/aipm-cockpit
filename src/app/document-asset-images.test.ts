import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { attachAssetImages } from "./document-asset-images";

function root(html: string): HTMLElement {
  const el = document.createElement("div");
  el.innerHTML = html;
  return el;
}

// jsdom does not implement createObjectURL/revokeObjectURL, so every test
// needs them stubbed. ★ Stubbed via vi.stubGlobal + vi.unstubAllGlobals (the
// pattern document-download.test.ts already uses for the same APIs), rather
// than a bare vi.spyOn left unrestored — an unrestored spy on a shared global
// leaks into whichever test runs next in this file.
describe("attachAssetImages", () => {
  beforeEach(() => {
    vi.stubGlobal("URL", { ...URL, createObjectURL: vi.fn(() => "blob:x"), revokeObjectURL: vi.fn() });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("sets a blob URL as src for each referenced asset", async () => {
    const el = root('<img data-asset-id="a1">');
    const detach = await attachAssetImages(el, async () => "QUJD");
    expect(el.querySelector("img")?.getAttribute("src")).toMatch(/^blob:/);
    detach();
  });

  // ★★ ~67 MB of base64 in one dangerouslySetInnerHTML string is the reason
  //    this exists. Never inline.
  it("never inlines base64 into src", async () => {
    const el = root('<img data-asset-id="a1">');
    const detach = await attachAssetImages(el, async () => "QUJD");
    expect(el.querySelector("img")?.getAttribute("src")).not.toContain("base64");
    detach();
  });

  it("fetches each distinct id exactly once, however many times it appears", async () => {
    const el = root('<img data-asset-id="a1"><img data-asset-id="a1"><img data-asset-id="a2">');
    const load = vi.fn(async () => "QUJD");
    const detach = await attachAssetImages(el, load);
    expect(load).toHaveBeenCalledTimes(2);
    detach();
  });

  it("marks an image whose bytes are missing, and leaves src unset", async () => {
    const el = root('<img data-asset-id="gone">');
    const detach = await attachAssetImages(el, async () => null);
    const img = el.querySelector("img");
    expect(img?.hasAttribute("src")).toBe(false);
    expect(img?.getAttribute("data-asset-missing")).toBe("true");
    detach();
  });

  it("marks an image whose load threw, rather than propagating", async () => {
    const el = root('<img data-asset-id="boom">');
    const detach = await attachAssetImages(el, async () => { throw new Error("network"); });
    expect(el.querySelector("img")?.getAttribute("data-asset-missing")).toBe("true");
    detach();
  });

  it("revokes every object URL it created when detached", async () => {
    const el = root('<img data-asset-id="a1"><img data-asset-id="a2">');
    const detach = await attachAssetImages(el, async () => "QUJD");
    detach();
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
  });

  it("does nothing when the subtree references no assets", async () => {
    const load = vi.fn(async () => "QUJD");
    const detach = await attachAssetImages(root("<p>no images</p>"), load);
    expect(load).not.toHaveBeenCalled();
    detach();
  });

  // ★★ THE DEFECT: `new Blob([bytes])` with no second argument carries no MIME
  // type, leaving rendering to browser content-sniffing. `mimeFor` is how the
  // caller (document-preview.tsx, from `ws.documentAssets`) supplies it.
  it("gives the created Blob the asset's mime type when a mime lookup is supplied", async () => {
    const el = root('<img data-asset-id="a1">');
    const createObjectURL = URL.createObjectURL as unknown as ReturnType<typeof vi.fn>;
    const detach = await attachAssetImages(el, async () => "QUJD", () => "image/png");
    const blob = createObjectURL.mock.calls[0][0] as Blob;
    expect(blob.type).toBe("image/png");
    detach();
  });

  it("mints a typeless Blob when no mime lookup is supplied", async () => {
    const el = root('<img data-asset-id="a1">');
    const createObjectURL = URL.createObjectURL as unknown as ReturnType<typeof vi.fn>;
    const detach = await attachAssetImages(el, async () => "QUJD");
    const blob = createObjectURL.mock.calls[0][0] as Blob;
    expect(blob.type).toBe("");
    detach();
  });
});
