import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { GANTT_ROW_ATTR, useGanttRowWindow } from "./use-gantt-row-window";
import { VIRTUALIZE_MIN_ROWS } from "./use-task-row-window";
import { HEADER_HEIGHT_PX, ROW_HEIGHT_PX } from "./gantt-engine";

// §5 Gantt row window (owner-approved design, 2026-10-08), over the REAL
// virtualizer: no mock, so the range, the header offset and the pinning are
// virtual-core's own answers for a box of a known size.

const BOX_PX = 640; // 20 rows
const keysOf = (n: number) => Array.from({ length: n }, (_, i) => `t-${i + 1}`);
const boxes: HTMLElement[] = [];

afterEach(() => {
  boxes.splice(0).forEach((b) => b.remove());
  vi.unstubAllGlobals();
});

function makeBox(): HTMLDivElement {
  const box = document.createElement("div");
  Object.defineProperty(box, "offsetHeight", { value: BOX_PX, configurable: true });
  Object.defineProperty(box, "offsetWidth", { value: 800, configurable: true });
  Object.defineProperty(box, "scrollTop", { value: 0, configurable: true, writable: true });
  document.body.append(box);
  boxes.push(box);
  return box;
}

function mount(count: number, pinnedKeys: readonly string[] = []) {
  const box = makeBox();
  const scrollRef = { current: box };
  const keys = keysOf(count);
  const hook = renderHook(
    (p: { keys: readonly string[]; pinnedKeys: readonly string[] }) => useGanttRowWindow({ keys: p.keys, scrollRef, pinnedKeys: p.pinnedKeys }),
    { initialProps: { keys, pinnedKeys } },
  );
  const scrollTo = (px: number) =>
    act(() => {
      box.scrollTop = px;
      box.dispatchEvent(new Event("scroll"));
    });
  return { box, keys, hook, scrollTo };
}

const indexes = (w: { items: readonly { index: number }[] }) => w.items.map((i) => i.index);
/** Every row is accounted for: rendered rows plus spacer rows equal the list. */
const accountedRows = (w: { items: readonly { padBefore: number }[]; padBottom: number }) =>
  w.items.length + (w.items.reduce((n, i) => n + i.padBefore, 0) + w.padBottom) / ROW_HEIGHT_PX;

describe("useGanttRowWindow (§5)", () => {
  it("is off at the threshold: the chart renders every row", () => {
    const { hook } = mount(VIRTUALIZE_MIN_ROWS);
    expect(hook.result.current).toEqual({ enabled: false, items: [], padBottom: 0 });
  });

  it("windows the rows above the threshold, from the top", () => {
    const { hook } = mount(VIRTUALIZE_MIN_ROWS + 1);
    const w = hook.result.current;
    expect(w.enabled).toBe(true);
    expect(indexes(w)[0]).toBe(0);
    expect(w.items[0]!.padBefore).toBe(0);
    // The visible rows plus the overscan, nowhere near all 201.
    expect(w.items.length).toBeGreaterThan(BOX_PX / ROW_HEIGHT_PX);
    expect(w.items.length).toBeLessThan(60);
    expect(accountedRows(w)).toBe(VIRTUALIZE_MIN_ROWS + 1);
  });

  it("follows the scroll, with row 0 starting below the header", () => {
    const { hook, scrollTo } = mount(1000);
    scrollTo(HEADER_HEIGHT_PX + 500 * ROW_HEIGHT_PX);
    const w = hook.result.current;
    expect(indexes(w)).toContain(500);
    expect(indexes(w)).toContain(519);
    expect(indexes(w)).not.toContain(470);
    // Overscan sits on both sides of the visible run.
    expect(indexes(w)[0]).toBe(490);
    expect(w.items[0]!.padBefore).toBe(490 * ROW_HEIGHT_PX);
    expect(accountedRows(w)).toBe(1000);
  });

  it("keeps a pinned row mounted far outside the window, with its own spacer", () => {
    const { hook } = mount(1000, ["t-901"]);
    const w = hook.result.current;
    expect(indexes(w)).toContain(900);
    const pinned = w.items.find((i) => i.index === 900)!;
    const before = w.items[w.items.indexOf(pinned) - 1]!;
    expect(pinned.padBefore).toBe((900 - before.index - 1) * ROW_HEIGHT_PX);
    expect(accountedRows(w)).toBe(1000);
  });

  it("pins a row that starts being dragged while the window is on", () => {
    const { hook, keys } = mount(1000);
    expect(indexes(hook.result.current)).not.toContain(700);
    hook.rerender({ keys, pinnedKeys: ["t-701"] });
    expect(indexes(hook.result.current)).toContain(700);
  });

  it("keeps the focused row mounted when it scrolls out of the window", () => {
    const { box, hook, scrollTo } = mount(1000);
    const row = document.createElement("div");
    row.setAttribute(GANTT_ROW_ATTR, "t-6");
    const button = document.createElement("button");
    row.append(button);
    box.append(row);
    button.focus();
    scrollTo(HEADER_HEIGHT_PX + 600 * ROW_HEIGHT_PX);
    expect(indexes(hook.result.current)).toContain(5);
    expect(indexes(hook.result.current)).toContain(600);
  });

  it("is off while printing", () => {
    const printMql = { matches: true, addEventListener: () => {}, removeEventListener: () => {} };
    vi.stubGlobal("matchMedia", (q: string) => (q === "print" ? printMql : { ...printMql, matches: false }));
    const { hook } = mount(1000);
    expect(hook.result.current.enabled).toBe(false);
  });
});
