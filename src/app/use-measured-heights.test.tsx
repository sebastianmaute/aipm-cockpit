import { describe, it, expect, vi, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { useMeasuredHeights, type MeasuredTile } from "./use-measured-heights";
import { rowsForHeight } from "./arrangement-measure";

const TILE_A: MeasuredTile = { id: "a", minH: 2, maxH: 4, flagged: false };

function Probe({
  onResult, density, tiles = [TILE_A], resetNonce = 0, extra,
}: {
  onResult: (m: ReadonlyMap<string, number>) => void;
  density: string;
  tiles?: MeasuredTile[];
  resetNonce?: number;
  /** More direct children of the body, after the measured one. */
  extra?: ReactNode;
}) {
  const m = useMeasuredHeights({ density, tiles, resetNonce });
  onResult(m);
  return (
    <div data-arrangement-grid="" style={{ gridAutoRows: "80px", rowGap: "16px" }}>
      <section data-arrangement-section="" data-tile-id="a">
        <div data-arrangement-body="" style={{ paddingTop: "8px", paddingBottom: "8px" }}>
          <div data-child="1" />
          {extra}
        </div>
      </section>
    </div>
  );
}

/**
 * Like {@link Probe}, but can render a second tile ("b") too. Used only by the font-frame race test
 * below, which needs a fresh frame's tile set to differ from a stale one's.
 */
function TwoTileProbe({
  onResult, tiles,
}: {
  onResult: (m: ReadonlyMap<string, number>) => void;
  tiles: MeasuredTile[];
}) {
  const m = useMeasuredHeights({ density: "comfortable", tiles, resetNonce: 0 });
  onResult(m);
  return (
    <div data-arrangement-grid="" style={{ gridAutoRows: "80px", rowGap: "16px" }}>
      <section data-arrangement-section="" data-tile-id="a">
        <div data-arrangement-body="" style={{ paddingTop: "8px", paddingBottom: "8px" }}>
          <div data-child-a="" />
        </div>
      </section>
      {tiles.some((t) => t.id === "b") && (
        <section data-arrangement-section="" data-tile-id="b">
          <div data-arrangement-body="" style={{ paddingTop: "8px", paddingBottom: "8px" }}>
            <div data-child-b="" />
          </div>
        </section>
      )}
    </div>
  );
}

const flushRaf = () => act(async () => { await new Promise((r) => requestAnimationFrame(() => r(null))); });

/** A DOMRect-shaped reading with only the axes the hook reads. */
const rect = (top: number, height: number) =>
  ({ top, bottom: top + height, height, left: 0, right: 0, width: 0, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;

/**
 * Stubs the three layout reads jsdom answers with 0: the section's rect, the body's
 * `clientHeight` and the child's rect. `childHeight` is the content extent.
 * ★ getComputedStyle is NOT stubbed — the inline grid and padding styles above are read back
 * through jsdom's own computed style, so the parse path is exercised for real.
 */
function stubLayout(childHeight: number) {
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    if (this.hasAttribute("data-arrangement-section")) return rect(0, 176);
    if (this.hasAttribute("data-child")) return rect(0, childHeight);
    return rect(0, 0);
  });
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (this: HTMLElement) {
    return this.hasAttribute("data-arrangement-body") ? 137 : 0;
  });
}

/**
 * ★ Chosen so the body padding CHANGES the answer: without the 16px of padding this extent needs one
 * row fewer. A round figure such as 300 lands on the same row count either way, and a test using it
 * stays green with the padding term deleted.
 */
const CHILD = 225;

afterEach(() => vi.restoreAllMocks());

describe("useMeasuredHeights", () => {
  it("measures nothing in jsdom, where every rect is 0, so no tile is overridden", async () => {
    let last: ReadonlyMap<string, number> = new Map([["x", 9]]);
    render(<Probe onResult={(m) => { last = m; }} density="comfortable" />);
    await flushRaf();
    expect(last.size).toBe(0);
  });

  it("converts the children's extent plus body padding into rows, reading every metric from the page", async () => {
    stubLayout(CHILD);
    let last: ReadonlyMap<string, number> = new Map();
    render(<Probe onResult={(m) => { last = m; }} density="comfortable" />);
    await flushRaf();
    // ★ Derived, never literal: content = extent + padding 16; non-body = section 176 − body 137.
    expect(last.get("a")).toBe(rowsForHeight(CHILD + 16, 80, 16, 176 - 137, 2, 4));
    expect(last.get("a")).not.toBe(2);   // the stub is doing something: not the minH fallback
  });

  it("can SHRINK a tile — the reading does not depend on the box, unlike scrollHeight", async () => {
    stubLayout(20);
    let last: ReadonlyMap<string, number> = new Map();
    render(<Probe onResult={(m) => { last = m; }} density="comfortable" />);
    await flushRaf();
    expect(last.get("a")).toBe(rowsForHeight(20 + 16, 80, 16, 39, 2, 4));
    expect(last.get("a")).toBe(2);
  });

  it("skips a flagged tile — its height is the user's choice", async () => {
    stubLayout(CHILD);
    let last: ReadonlyMap<string, number> = new Map([["x", 9]]);
    render(<Probe onResult={(m) => { last = m; }} density="comfortable" tiles={[{ ...TILE_A, flagged: true }]} />);
    await flushRaf();
    expect(last.has("a")).toBe(false);
  });

  it("re-measures on a density change, and on a flag clearing (Reset), but not on a plain re-render", async () => {
    stubLayout(CHILD);
    const spy = vi.spyOn(window, "requestAnimationFrame");
    let last: ReadonlyMap<string, number> = new Map();
    const onResult = (m: ReadonlyMap<string, number>) => { last = m; };
    const { rerender } = render(<Probe onResult={onResult} density="comfortable" tiles={[{ ...TILE_A, flagged: true }]} />);
    await flushRaf();
    expect(last.has("a")).toBe(false);
    const afterMount = spy.mock.calls.length;

    // A fresh but equal tiles array must NOT schedule another pass (the panel builds it per render).
    rerender(<Probe onResult={onResult} density="comfortable" tiles={[{ ...TILE_A, flagged: true }]} />);
    await flushRaf();
    // flushRaf schedules one frame of its own, so exactly one new call means the hook scheduled none.
    expect(spy.mock.calls.length - afterMount).toBe(1);

    // Reset: the flag clears with density and tile set unchanged — the tile must now be measured.
    rerender(<Probe onResult={onResult} density="comfortable" tiles={[TILE_A]} />);
    await flushRaf();
    expect(last.get("a")).toBe(rowsForHeight(CHILD + 16, 80, 16, 39, 2, 4));

    // Density: a different content reading must be picked up.
    vi.restoreAllMocks();
    stubLayout(20);
    rerender(<Probe onResult={onResult} density="compact" tiles={[TILE_A]} />);
    await flushRaf();
    expect(last.get("a")).toBe(2);

  });

  it("re-measures on a Reset nonce alone — a width-only board has no flag to clear", async () => {
    stubLayout(CHILD);
    let last: ReadonlyMap<string, number> = new Map();
    const onResult = (m: ReadonlyMap<string, number>) => { last = m; };
    const { rerender } = render(<Probe onResult={onResult} density="comfortable" resetNonce={0} />);
    await flushRaf();
    const before = rowsForHeight(CHILD + 16, 80, 16, 39, 2, 4);
    expect(last.get("a")).toBe(before);

    // The content now reads differently (as it would after Reset narrows a widened tile), but
    // density, tile set and flags are all unchanged: without a trigger the old reading stays.
    vi.restoreAllMocks();
    stubLayout(20);
    rerender(<Probe onResult={onResult} density="comfortable" resetNonce={0} />);
    await flushRaf();
    expect(last.get("a")).toBe(before);

    // Reset bumps the nonce, and that alone must pick the new reading up.
    rerender(<Probe onResult={onResult} density="comfortable" resetNonce={1} />);
    await flushRaf();
    expect(last.get("a")).toBe(rowsForHeight(20 + 16, 80, 16, 39, 2, 4));
    expect(last.get("a")).not.toBe(before);
  });

  // ★ P2: the key is SORTED by id, so a drag preview that only reorders the board schedules no pass.
  it("does not re-measure when the same tiles only change order", async () => {
    stubLayout(CHILD);
    const TILE_B: MeasuredTile = { id: "b", minH: 2, maxH: 4, flagged: false };
    const spy = vi.spyOn(window, "requestAnimationFrame");
    const onResult = () => {};
    const { rerender } = render(<Probe onResult={onResult} density="comfortable" tiles={[TILE_A, TILE_B]} />);
    await flushRaf();
    const afterMount = spy.mock.calls.length;
    rerender(<Probe onResult={onResult} density="comfortable" tiles={[TILE_B, TILE_A]} />);
    await flushRaf();
    // flushRaf schedules one frame of its own, so exactly one new call means the hook scheduled none.
    expect(spy.mock.calls.length - afterMount).toBe(1);
  });

  // ★ m4: a direct child that takes no part in the body's flow must not stretch the extent. A
  //   display:none element reads as an all-zero rect at the viewport origin, and a fixed or absolute
  //   one sits wherever its containing block puts it; any of them, taken into min(top)/max(bottom),
  //   inflated the reading towards maxH.
  it("ignores a display:none child and a fixed or absolute child when taking the extent", async () => {
    const TOP = 300;
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      if (this.hasAttribute("data-arrangement-section")) return rect(0, 176);
      if (this.hasAttribute("data-child")) return rect(TOP, CHILD);
      if (this.hasAttribute("data-fixed-child") || this.hasAttribute("data-absolute-child")) {
        return { ...rect(0, 40), width: 40, right: 40 } as DOMRect;
      }
      return rect(0, 0);                      // the display:none child: every edge 0
    });
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (this: HTMLElement) {
      return this.hasAttribute("data-arrangement-body") ? 137 : 0;
    });
    let last: ReadonlyMap<string, number> = new Map();
    render(
      <Probe
        onResult={(m) => { last = m; }}
        density="comfortable"
        tiles={[{ ...TILE_A, maxH: 8 }]}
        extra={<><div data-hidden-child="" style={{ display: "none" }} /><div data-fixed-child="" style={{ position: "fixed" }} /><div data-absolute-child="" style={{ position: "absolute" }} /></>}
      />,
    );
    await flushRaf();
    const expected = rowsForHeight(CHILD + 16, 80, 16, 39, 2, 8);
    // Non-vacuity: counting either stray child would have produced a different row count.
    expect(rowsForHeight(TOP + CHILD + 16, 80, 16, 39, 2, 8)).not.toBe(expected);
    expect(last.get("a")).toBe(expected);
  });
});

// ★ m5: the landing view is measured on its first frame, which can precede the web font swap. One
//   more pass once `document.fonts.ready` resolves picks up the re-wrapped text.
describe("useMeasuredHeights and web fonts", () => {
  const hadFonts = Object.prototype.hasOwnProperty.call(document, "fonts");
  const setFonts = (value: unknown) =>
    Object.defineProperty(document, "fonts", { configurable: true, value });
  afterEach(() => {
    if (!hadFonts) delete (document as { fonts?: unknown }).fonts;
  });

  function deferred() {
    let resolve!: () => void;
    const ready = new Promise<void>((r) => { resolve = r; });
    return { ready, resolve };
  }

  it("re-measures once the fonts finish loading", async () => {
    const d = deferred();
    setFonts({ status: "loading", ready: d.ready });
    stubLayout(CHILD);
    let last: ReadonlyMap<string, number> = new Map();
    render(<Probe onResult={(m) => { last = m; }} density="comfortable" />);
    await flushRaf();
    expect(last.get("a")).toBe(rowsForHeight(CHILD + 16, 80, 16, 39, 2, 4));

    // The font swap re-wraps the text: the content now reads shorter.
    vi.restoreAllMocks();
    stubLayout(20);
    await act(async () => { d.resolve(); await d.ready; });
    await flushRaf();
    expect(last.get("a")).toBe(2);
  });

  it("schedules no font pass when the fonts are already loaded", async () => {
    setFonts({ status: "loaded", ready: Promise.resolve() });
    stubLayout(CHILD);
    const spy = vi.spyOn(window, "requestAnimationFrame");
    render(<Probe onResult={() => {}} density="comfortable" />);
    await flushRaf();
    await act(async () => { await Promise.resolve(); });
    // The mount pass plus flushRaf's own frame, and nothing for the fonts.
    expect(spy.mock.calls.length).toBe(2);
  });

  it("does nothing when the fonts resolve after unmount", async () => {
    const d = deferred();
    setFonts({ status: "loading", ready: d.ready });
    stubLayout(CHILD);
    const { unmount } = render(<Probe onResult={() => {}} density="comfortable" />);
    await flushRaf();
    unmount();
    const spy = vi.spyOn(window, "requestAnimationFrame");
    await act(async () => { d.resolve(); await d.ready; });
    expect(spy).not.toHaveBeenCalled();
  });

  // ★ Minor-2 (fixwave-review): `cancelAnimationFrame(fontRaf)` in the cleanup stops an ALREADY-
  //   SCHEDULED font frame (distinct from the `cancelled` flag, which only stops a resolution that
  //   has not yet scheduled one). Without it, a font frame scheduled against a stale tile set can
  //   still fire after a newer trigger's own frame and overwrite the fresh reading. This test drives
  //   requestAnimationFrame under manual control so it can force exactly that ordering: the stale
  //   font frame is scheduled first, a newer trigger (a second tile joining the board) supersedes it,
  //   that newer trigger's OWN frame is run first, and only then is the stale frame attempted.
  it("cancels a pending font frame that a newer trigger has superseded, so it cannot overwrite the fresh reading with a stale tile set", async () => {
    const pending = new Map<number, FrameRequestCallback>();
    let nextId = 0;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb: FrameRequestCallback) => {
      const id = ++nextId;
      pending.set(id, cb);
      return id;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id: number) => { pending.delete(id); });
    const run = (id: number): boolean => {
      const cb = pending.get(id);
      if (!cb) return false;
      pending.delete(id);
      act(() => { cb(0); });
      return true;
    };
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      if (this.hasAttribute("data-arrangement-section")) return rect(0, 176);
      if (this.hasAttribute("data-child-a") || this.hasAttribute("data-child-b")) return rect(0, CHILD);
      return rect(0, 0);
    });
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (this: HTMLElement) {
      return this.hasAttribute("data-arrangement-body") ? 137 : 0;
    });

    const d = deferred();
    setFonts({ status: "loading", ready: d.ready });
    let last: ReadonlyMap<string, number> = new Map();
    const onResult = (m: ReadonlyMap<string, number>) => { last = m; };
    const { rerender } = render(<TwoTileProbe onResult={onResult} tiles={[TILE_A]} />);

    // Mount's own frame (id 1), against the one-tile board.
    expect(run(1)).toBe(true);
    expect(last.has("b")).toBe(false);

    // Fonts resolve: schedules a font frame (id 2) closed over the MOUNT tile set. Left un-run.
    await act(async () => { d.resolve(); await d.ready; });

    // Fonts are now loaded, so the NEWER trigger's own effect will not schedule a second font pass.
    setFonts({ status: "loaded", ready: Promise.resolve() });

    // The newer trigger: a second tile joins the board. Its cleanup must cancel the pending font
    // frame (id 2); its own effect schedules a fresh one (id 3).
    const TILE_B: MeasuredTile = { id: "b", minH: 2, maxH: 4, flagged: false };
    rerender(<TwoTileProbe onResult={onResult} tiles={[TILE_A, TILE_B]} />);

    // The fresh frame wins the race, as it would in the browser when it runs first.
    expect(run(3)).toBe(true);
    expect(last.has("b")).toBe(true);

    // The stale font frame must already be cancelled — not merely late. Attempting to run it must do
    // nothing: it must not still be pending, and it must not overwrite the fresh two-tile reading
    // with the mount closure's one-tile reading. Remove `cancelAnimationFrame(fontRaf)` from the
    // cleanup and `run(2)` succeeds, dropping "b" from `last`.
    expect(run(2)).toBe(false);
    expect(last.has("b")).toBe(true);
  });
});
