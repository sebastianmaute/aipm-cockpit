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

  // ★★★ THE SECOND RUN IS THE REAL ONE. A §212 repair re-runs this over the
  // SAME subtree — `html` has not changed, so React never replaces the
  // innerHTML and these are the elements the FAILED run stamped. Leaving
  // `data-asset-missing` on keeps `globals.css`'s dashed red frame and min-size
  // box around an image that now has perfectly good bytes.
  it("clears a stale missing marker when a later run resolves the same element", async () => {
    const el = root('<img data-asset-id="a1">');
    const first = await attachAssetImages(el, async () => null);
    expect(el.querySelector("img")?.getAttribute("data-asset-missing")).toBe("true");
    first();

    const second = await attachAssetImages(el, async () => "QUJD");
    const img = el.querySelector("img");
    expect(img?.getAttribute("src")).toMatch(/^blob:/);
    expect(img?.hasAttribute("data-asset-missing")).toBe(false);
    second();
  });

  // ★★★ THE CATCH CANNOT SEE THIS ONE, WHICH IS WHY THE DECODE HAD TO MOVE TO
  // `safeBase64ToBytes`. `atob` strips ASCII whitespace before decoding, so a
  // whitespace-only stored row returns "" and raises NOTHING — the raw
  // `base64ToBytes` this used to call handed back a truthy `Uint8Array(0)`, a
  // zero-byte Blob got an object URL, and the resolve branch then REMOVED
  // `data-asset-missing`. `globals.css` draws the dashed repair frame off that
  // attribute, so stripping it leaves a bare broken-image icon disclosing
  // nothing. Reproduce the premise:
  //   node -e "console.log(atob('\t\r\n ').length)"  → 0
  it("marks a whitespace-only byte row instead of minting a zero-byte blob URL", async () => {
    const el = root('<img data-asset-id="blank">');
    const detach = await attachAssetImages(el, async () => "\t\r\n ");
    const img = el.querySelector("img");
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(img?.hasAttribute("src")).toBe(false);
    expect(img?.getAttribute("data-asset-missing")).toBe("true");
    detach();
  });

  // The other half of the same branch: a row that DOES throw already reached
  // the marker via the catch, but only by accident of ordering — pinned so a
  // future refactor cannot drop one of the two paths.
  it("marks a row atob rejects outright (a length fault passes any alphabet test)", async () => {
    const el = root('<img data-asset-id="bad">');
    const detach = await attachAssetImages(el, async () => "abcde");
    const img = el.querySelector("img");
    expect(img?.hasAttribute("src")).toBe(false);
    expect(img?.getAttribute("data-asset-missing")).toBe("true");
    detach();
  });

  // ★★ THE OTHER DIRECTION, and the reason the guard is `atob` rather than an
  // alphabet regex: `atob` strips interior whitespace, so a line-wrapped stored
  // row is a GOOD image and must keep rendering. A regex-based guard would
  // reject it.
  it("still resolves a line-wrapped base64 row — atob strips interior whitespace", async () => {
    const el = root('<img data-asset-id="wrapped">');
    const createObjectURL = URL.createObjectURL as unknown as ReturnType<typeof vi.fn>;
    const detach = await attachAssetImages(el, async () => "iVBORw0K\r\n  Ggo=");
    expect(el.querySelector("img")?.getAttribute("src")).toMatch(/^blob:/);
    expect(el.querySelector("img")?.hasAttribute("data-asset-missing")).toBe(false);
    expect((createObjectURL.mock.calls[0][0] as Blob).size).toBe(8);
    detach();
  });

  // ★★★ THE MARKER-STRIPPING HALF, asserted separately because the first test
  // above passes on a FRESH element even with the fix reverted's src left
  // unset. This is the §212 repair path: a failed run stamped the marker, and
  // a later run over the SAME element must not clear it for a row that is
  // still undrawable.
  it("does not clear a stale missing marker when the retried row is still blank", async () => {
    const el = root('<img data-asset-id="blank">');
    const first = await attachAssetImages(el, async () => null);
    expect(el.querySelector("img")?.getAttribute("data-asset-missing")).toBe("true");
    first();

    const second = await attachAssetImages(el, async () => "   ");
    expect(el.querySelector("img")?.getAttribute("data-asset-missing")).toBe("true");
    second();
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

  // ★★★ THE EIGHTH CONSUMER OF THE ASSET-MIME ALLOWLIST — the one no search
  // for the constant could find, because it never spelled one. A stored row
  // whose mime is outside `ASSET_MIME_ALLOWED` (an `image/svg+xml` written by
  // an older build, a hand-edited JSON workspace, a desynchronised metadata
  // table) minted a Blob carrying that type verbatim. Declined down the SAME
  // marker path a missing byte row already uses.
  // ★★★ NOT BECAUSE THAT BLOB WOULD RUN SCRIPT — an earlier revision of this
  // comment said "an SVG object URL in an `<img>` is a script-bearing
  // document", which contradicts §223 and §225, both of which state that a
  // blob assigned to `<img src>` runs no script. Those two are right and this
  // was wrong; it mattered because this is the guard's only discriminating
  // test, so the false reason was the first one a reader met. The real reason
  // is consistency of policy: the upload path refuses these bytes, so the
  // render path must not resolve a row that carries them, whatever put it
  // there. Treat the guard as policy enforcement, NOT as a security boundary —
  // §225 records why it cannot be one.
  it("declines an asset whose stored mime is outside the allowlist", async () => {
    const el = root('<img data-asset-id="evil">');
    const detach = await attachAssetImages(el, async () => "QUJD", () => "image/svg+xml");
    const img = el.querySelector("img");
    expect(img?.hasAttribute("src")).toBe(false);
    expect(img?.getAttribute("data-asset-missing")).toBe("true");
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    detach();
  });

  // ★★★ THE GUARD IS TRUTHY, NOT `!== undefined`, AND THIS TEST IS THE ONLY
  // THING THAT SAYS SO. `sanitizeDocumentAsset` requires an `id` and nothing
  // else; its mime is `sanitizeText(o.mime, ASSET_MIME_MAX)`, which returns
  // "" for anything non-string. So a row with a missing, blank or non-string
  // mime survives sanitising as `mime === ""` on EVERY load path, and has
  // always rendered — the Blob simply carries no type and the browser sniffs.
  // `isAllowedAssetMime("")` is false, so the plausible `mime !== undefined`
  // spelling would DECLINE it and stamp the repair marker on a working image.
  it("still renders an asset whose stored mime is the empty string", async () => {
    const el = root('<img data-asset-id="blankmime">');
    const createObjectURL = URL.createObjectURL as unknown as ReturnType<typeof vi.fn>;
    const detach = await attachAssetImages(el, async () => "QUJD", () => "");
    const img = el.querySelector("img");
    expect(img?.getAttribute("src")).toMatch(/^blob:/);
    expect(img?.hasAttribute("data-asset-missing")).toBe(false);
    expect((createObjectURL.mock.calls[0][0] as Blob).type).toBe("");
    detach();
  });

  // ★★ A LOOKUP THAT MISSES IS NOT THE SAME CASE AS NO LOOKUP AT ALL, which is
  // why this is not a duplicate of "mints a typeless Blob when no mime lookup
  // is supplied" above. `documentAssets` is an OPTIONAL slice left `undefined`
  // when empty, metadata rows are dropped INDIVIDUALLY on load while the byte
  // rows are untouched, and metadata and bytes live in different tables with
  // different lifecycles (§207 records them desynchronising in production) —
  // four mechanisms that hand a live `mimeFor` an id it knows nothing about.
  // ★★ WHAT THIS DOES AND DOES NOT BUY, because the distinction was overstated
  // once already. A MISS and an absent lookup converge on the identical value
  // (`mime === undefined`) one line above the guard, so NO one-token mutation of
  // the guard separates them: the `!== undefined` mutant leaves both green and
  // the drop-the-truthiness mutant reddens both. What this test genuinely covers
  // is the OPTIONAL CALL itself — mutate `mimeFor?.(id)` to `mimeFor!(id)` and
  // this stays green while the no-lookup test throws. It is kept because the
  // miss is a distinct DOMAIN case with four real mechanisms behind it (an
  // optional slice set to undefined when empty; rows dropped individually on
  // load while bytes survive; metadata and bytes in different tables with
  // different lifecycles, per §207; and the `<img>` reference living in a third
  // slice) — not because it discriminates a distinct branch here.
  it("falls through to a typeless Blob when the mime lookup misses", async () => {
    const el = root('<img data-asset-id="orphan">');
    const createObjectURL = URL.createObjectURL as unknown as ReturnType<typeof vi.fn>;
    const detach = await attachAssetImages(el, async () => "QUJD", () => undefined);
    const img = el.querySelector("img");
    expect(img?.getAttribute("src")).toMatch(/^blob:/);
    expect(img?.hasAttribute("data-asset-missing")).toBe(false);
    expect((createObjectURL.mock.calls[0][0] as Blob).type).toBe("");
    detach();
  });

  // ★★★ THE STALE-RUN RACE. Two runs over the SAME subtree is not a contrived
  // shape — it is exactly what a §212 repair produces: the repair bumps
  // `assetRepairGeneration` while a run over the OLD, broken bytes is still in
  // flight, `html` is unchanged so React never replaces the elements, and both
  // runs hold the very same `<img>`. Every write in this module lands after an
  // await, so absent the guard the run that SETTLES last wins regardless of
  // which STARTED first. Here the stale run settles second and fails, so it
  // would stamp `data-asset-missing` back over the image the fresh run just
  // repaired — and it stays visibly broken until some unrelated dep changes.
  // ★★ The caller's own `cancelled` flag cannot prevent this; it runs only
  // after these writes have already happened. Deleting the `shouldApply` block
  // reddens both assertions below.
  it("lets a stale run neither re-stamp the marker nor undo a repaired src", async () => {
    const el = root('<img data-asset-id="a1">');
    let stale = false;
    let releaseStale: (v: string | null) => void = () => {};
    const staleBytes = new Promise<string | null>((r) => { releaseStale = r; });
    const staleRun = attachAssetImages(el, () => staleBytes, undefined, () => !stale);

    stale = true; // a repair lands: the in-flight run above is now the old one
    const freshDetach = await attachAssetImages(el, async () => "QUJD");
    expect(el.querySelector("img")?.getAttribute("src")).toMatch(/^blob:/);

    releaseStale(null); // the stale run's old bytes finally resolve, and fail
    (await staleRun)();

    const img = el.querySelector("img");
    expect(img?.hasAttribute("data-asset-missing")).toBe(false);
    expect(img?.getAttribute("src")).toMatch(/^blob:/);
    freshDetach();
  });

  // ★ The other half: a stale run that SUCCEEDS has already minted URLs by the
  // time it is told to stand down. Its own disposer is discarded (the caller
  // keeps the fresh run's), so it must revoke them itself or they leak for the
  // lifetime of the document.
  it("makes a stale run revoke its own object URLs rather than leak them", async () => {
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL: vi.fn(() => "blob:stale"), revokeObjectURL });
    const el = root('<img data-asset-id="a1">');
    const detach = await attachAssetImages(el, async () => "QUJD", undefined, () => false);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:stale");
    expect(el.querySelector("img")?.hasAttribute("src")).toBe(false);
    detach(); // a no-op disposer: the run already released everything it held
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
  });
});
