import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, waitFor } from "@testing-library/react";
import { AssetThumbnail } from "./asset-thumbnail";
import { createLoadLimiter } from "./asset-load-limiter";
import type { AssetByteLoader } from "./document-asset-images";

const TINY_GIF = "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

// A controllable IntersectionObserver: tests decide when a thumbnail scrolls
// into view. The shared setup's stub never reports anything, which is exactly
// what keeps the OTHER asset-library tests from loading thumbnails at mount.
let observers: { cb: IntersectionObserverCallback; targets: Element[] }[] = [];
class ControlledIO {
  private entry: { cb: IntersectionObserverCallback; targets: Element[] };
  constructor(cb: IntersectionObserverCallback) {
    this.entry = { cb, targets: [] };
    observers.push(this.entry);
  }
  observe(el: Element) { this.entry.targets.push(el); }
  unobserve() {}
  disconnect() { this.entry.targets = []; }
  takeRecords() { return []; }
}
function scrollAllIntoView() {
  act(() => {
    for (const o of observers) {
      o.cb(o.targets.map((target) => ({ isIntersecting: true, target }) as IntersectionObserverEntry), {} as IntersectionObserver);
    }
  });
}

function scrollAllOutOfView() {
  act(() => {
    for (const o of observers) {
      o.cb(o.targets.map((target) => ({ isIntersecting: false, target }) as IntersectionObserverEntry), {} as IntersectionObserver);
    }
  });
}

let created: string[];
let revoked: string[];
beforeEach(() => {
  observers = [];
  created = [];
  revoked = [];
  let n = 0;
  vi.stubGlobal("IntersectionObserver", ControlledIO);
  // Same stub shape as asset-preview-modal.test.tsx.
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: vi.fn(() => { const u = `blob:thumb-${++n}`; created.push(u); return u; }),
    revokeObjectURL: vi.fn((u: string) => { revoked.push(u); }),
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

/** ★★ Loads go through the limiter, which starts a task on a MICROTASK — so a
 *  "loader not called" assertion made synchronously passes whether or not a
 *  load was scheduled. Settle pending work first, then assert absence. */
async function settle() {
  await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
}

function renderThumb(over: Partial<Parameters<typeof AssetThumbnail>[0]> = {}) {
  const loadImage = vi.fn<AssetByteLoader>(async () => TINY_GIF);
  const props = { id: "a1", mime: "image/png", loadImage, limiter: createLoadLimiter(3), unavailable: false, ...over };
  const view = render(<AssetThumbnail {...props} />);
  return { ...view, loadImage: props.loadImage };
}

describe("AssetThumbnail", () => {
  it("loads nothing until the row scrolls into view", async () => {
    const { container, loadImage } = renderThumb();
    await settle();
    expect(loadImage).not.toHaveBeenCalled();
    expect(container.querySelector("img")).toBeNull();
  });

  it("loads the asset's bytes once visible and shows them as a decorative image", async () => {
    const { container, loadImage } = renderThumb();
    scrollAllIntoView();
    await waitFor(() => expect(container.querySelector("img")).not.toBeNull());
    expect(loadImage).toHaveBeenCalledWith("a1");
    const img = container.querySelector("img")!;
    expect(img).toHaveAttribute("src", created[0]);
    // Decorative: the row already names the asset, so the image adds no name
    // and the box is hidden from assistive tech.
    expect(img).toHaveAttribute("alt", "");
    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
  });

  it("revokes its object URL when the row goes away", async () => {
    const { container, unmount } = renderThumb();
    scrollAllIntoView();
    await waitFor(() => expect(container.querySelector("img")).not.toBeNull());
    unmount();
    expect(revoked).toEqual([created[0]]);
  });

  // Going unavailable revokes the URL. Coming back under the SAME id and mime
  // must not render that revoked URL while (or instead of) reloading.
  it("never shows a revoked URL after the row turns unavailable and back", async () => {
    let bytes: string | null = TINY_GIF;
    const loadImage = vi.fn<AssetByteLoader>(async () => bytes);
    const limiter = createLoadLimiter(3);
    const props = { id: "a1", mime: "image/png", loadImage, limiter };
    const { container, rerender } = render(<AssetThumbnail {...props} unavailable={false} />);
    scrollAllIntoView();
    await waitFor(() => expect(container.querySelector("img")).not.toBeNull());
    const first = created[0];
    rerender(<AssetThumbnail {...props} unavailable={true} />);
    expect(revoked).toContain(first);
    expect(container.querySelector("img")).toBeNull();
    bytes = null; // the reload finds nothing
    rerender(<AssetThumbnail {...props} unavailable={false} />);
    expect(container.querySelector("img")).toBeNull();
    await settle();
    expect(container.querySelector("img")).toBeNull();
  });

  it("does not load an asset marked unavailable (dangling or refused format)", async () => {
    const { container, loadImage } = renderThumb({ unavailable: true });
    scrollAllIntoView();
    await settle();
    expect(loadImage).not.toHaveBeenCalled();
    expect(container.querySelector("img")).toBeNull();
  });

  // Same order as the preview lightbox: a refused format is never fetched.
  it("does not fetch an asset whose stored format is refused", async () => {
    const { container, loadImage } = renderThumb({ mime: "image/svg+xml" });
    scrollAllIntoView();
    await settle();
    expect(loadImage).not.toHaveBeenCalled();
    expect(container.querySelector("img")).toBeNull();
  });

  it("shows nothing when the bytes are missing", async () => {
    const loadImage = vi.fn<AssetByteLoader>(async () => null);
    const { container } = renderThumb({ loadImage });
    scrollAllIntoView();
    await waitFor(() => expect(loadImage).toHaveBeenCalled());
    await act(async () => {});
    expect(container.querySelector("img")).toBeNull();
    expect(created).toEqual([]);
  });

  it("shows nothing when the loader fails", async () => {
    const loadImage = vi.fn<AssetByteLoader>(async () => { throw new Error("offline"); });
    const { container } = renderThumb({ loadImage });
    scrollAllIntoView();
    await waitFor(() => expect(loadImage).toHaveBeenCalled());
    await act(async () => {});
    expect(container.querySelector("img")).toBeNull();
  });

  it("never mints a URL for bytes that arrive after the row went away", async () => {
    let release!: (v: string) => void;
    const loadImage = vi.fn<AssetByteLoader>(() => new Promise<string>((r) => { release = r; }));
    const { unmount } = renderThumb({ loadImage });
    scrollAllIntoView();
    await waitFor(() => expect(loadImage).toHaveBeenCalled());
    unmount();
    await act(async () => { release(TINY_GIF); });
    expect(created).toEqual([]);
  });

  // A row that scrolls past while its load is still QUEUED behind others must
  // give its turn back without fetching anything.
  it("does not fetch for a row that went away while its load was queued", async () => {
    const limiter = createLoadLimiter(1);
    let releaseFirst!: (v: string) => void;
    const first = vi.fn<AssetByteLoader>(() => new Promise<string>((r) => { releaseFirst = r; }));
    const second = vi.fn<AssetByteLoader>(async () => TINY_GIF);
    render(<AssetThumbnail id="a1" mime="image/png" loadImage={first} limiter={limiter} unavailable={false} />);
    const queued = render(<AssetThumbnail id="a2" mime="image/png" loadImage={second} limiter={limiter} unavailable={false} />);
    scrollAllIntoView();
    await waitFor(() => expect(first).toHaveBeenCalled());
    queued.unmount();
    await act(async () => { releaseFirst(TINY_GIF); });
    await settle();
    expect(second).not.toHaveBeenCalled();
  });
  // §482 review I2 — live URLs are bounded by the rows in view: a row that
  // scrolls out gives its URL back, and one that scrolls back in reloads.
  it("revokes a row's URL when it scrolls out, and reloads it when it scrolls back in", async () => {
    const { container, loadImage } = renderThumb();
    scrollAllIntoView();
    await waitFor(() => expect(container.querySelector("img")).not.toBeNull());
    const first = created[0];

    scrollAllOutOfView();
    expect(revoked).toContain(first);
    expect(container.querySelector("img")).toBeNull();

    scrollAllIntoView();
    await waitFor(() => expect(container.querySelector("img")).not.toBeNull());
    expect(loadImage).toHaveBeenCalledTimes(2);
    expect(container.querySelector("img")).toHaveAttribute("src", created[1]);
  });

  // A fast scroll must not leave every row it passed queued ahead of the rows
  // the user stopped on.
  it("drops a queued load whose row scrolls out before its turn", async () => {
    const limiter = createLoadLimiter(1);
    let releaseFirst!: (v: string) => void;
    const first = vi.fn<AssetByteLoader>(() => new Promise<string>((r) => { releaseFirst = r; }));
    const second = vi.fn<AssetByteLoader>(async () => TINY_GIF);
    render(<AssetThumbnail id="a1" mime="image/png" loadImage={first} limiter={limiter} unavailable={false} />);
    render(<AssetThumbnail id="a2" mime="image/png" loadImage={second} limiter={limiter} unavailable={false} />);
    scrollAllIntoView();
    await waitFor(() => expect(first).toHaveBeenCalled());
    // Only the SECOND row scrolls out while it waits behind the first.
    act(() => {
      const o = observers[1];
      o.cb(o.targets.map((target) => ({ isIntersecting: false, target }) as IntersectionObserverEntry), {} as IntersectionObserver);
    });
    await act(async () => { releaseFirst(TINY_GIF); });
    await settle();
    expect(second).not.toHaveBeenCalled();
  });

  // §482 review M2 — an A→B→A mime change returns to a key whose URL the
  // effect cleanup already revoked; that URL must not be shown again.
  it("never shows a revoked URL after the asset changes and changes back", async () => {
    let bytes: string | null = TINY_GIF;
    const loadImage = vi.fn<AssetByteLoader>(async () => bytes);
    const limiter = createLoadLimiter(3);
    const { container, rerender } = render(<AssetThumbnail id="a1" mime="image/png" loadImage={loadImage} limiter={limiter} unavailable={false} />);
    scrollAllIntoView();
    await waitFor(() => expect(container.querySelector("img")).not.toBeNull());
    const firstUrl = created[0];
    bytes = null; // every later load finds nothing
    rerender(<AssetThumbnail id="a1" mime="image/jpeg" loadImage={loadImage} limiter={limiter} unavailable={false} />);
    await settle();
    expect(revoked).toContain(firstUrl);
    rerender(<AssetThumbnail id="a1" mime="image/png" loadImage={loadImage} limiter={limiter} unavailable={false} />);
    expect(container.querySelector("img")).toBeNull();
    await settle();
    expect(container.querySelector("img")).toBeNull();
  });
});
