import { describe, it, expect, vi, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import { useMeasuredHeights, type MeasuredTile } from "./use-measured-heights";
import { rowsForHeight } from "./arrangement-measure";

const TILE_A: MeasuredTile = { id: "a", minH: 2, maxH: 4, flagged: false };

function Probe({
  onResult, density, tiles = [TILE_A], resetNonce = 0,
}: {
  onResult: (m: ReadonlyMap<string, number>) => void;
  density: string;
  tiles?: MeasuredTile[];
  resetNonce?: number;
}) {
  const m = useMeasuredHeights({ density, tiles, resetNonce });
  onResult(m);
  return (
    <div data-arrangement-grid="" style={{ gridAutoRows: "80px", rowGap: "16px" }}>
      <section data-arrangement-section="" data-tile-id="a">
        <div data-arrangement-body="" style={{ paddingTop: "8px", paddingBottom: "8px" }}>
          <div data-child="1" />
        </div>
      </section>
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
});
