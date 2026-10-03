import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, waitFor } from "@testing-library/react";
import { AssetThumbnail } from "./asset-thumbnail";
import { createLoadLimiter } from "./asset-load-limiter";

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
  const loadImage = vi.fn(async () => TINY_GIF);
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
    const loadImage = vi.fn(async () => null);
    const { container } = renderThumb({ loadImage });
    scrollAllIntoView();
    await waitFor(() => expect(loadImage).toHaveBeenCalled());
    await act(async () => {});
    expect(container.querySelector("img")).toBeNull();
    expect(created).toEqual([]);
  });

  it("shows nothing when the loader fails", async () => {
    const loadImage = vi.fn(async () => { throw new Error("offline"); });
    const { container } = renderThumb({ loadImage });
    scrollAllIntoView();
    await waitFor(() => expect(loadImage).toHaveBeenCalled());
    await act(async () => {});
    expect(container.querySelector("img")).toBeNull();
  });

  it("revokes, and never shows, an image that arrives after the row went away", async () => {
    let release!: (v: string) => void;
    const loadImage = vi.fn(() => new Promise<string>((r) => { release = r; }));
    const { unmount } = renderThumb({ loadImage });
    scrollAllIntoView();
    await waitFor(() => expect(loadImage).toHaveBeenCalled());
    unmount();
    await act(async () => { release(TINY_GIF); });
    // Either never minted, or minted and immediately revoked — never leaked.
    expect(created.filter((u) => !revoked.includes(u))).toEqual([]);
  });

  // A row that scrolls past while its load is still QUEUED behind others must
  // give its turn back without fetching anything.
  it("does not fetch for a row that went away while its load was queued", async () => {
    const limiter = createLoadLimiter(1);
    let releaseFirst!: (v: string) => void;
    const first = vi.fn(() => new Promise<string>((r) => { releaseFirst = r; }));
    const second = vi.fn(async () => TINY_GIF);
    render(<AssetThumbnail id="a1" mime="image/png" loadImage={first} limiter={limiter} unavailable={false} />);
    const queued = render(<AssetThumbnail id="a2" mime="image/png" loadImage={second} limiter={limiter} unavailable={false} />);
    scrollAllIntoView();
    await waitFor(() => expect(first).toHaveBeenCalled());
    queued.unmount();
    await act(async () => { releaseFirst(TINY_GIF); });
    await settle();
    expect(second).not.toHaveBeenCalled();
  });
});
