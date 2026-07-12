import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import { useResizable } from "./use-resizable";

const KEY = "aipm-cockpit:test-resizable";

function Harness() {
  const { ref, reset } = useResizable(KEY);
  return (
    <div>
      <div ref={ref} data-testid="box" />
      <button onClick={reset}>reset</button>
    </div>
  );
}

/** Stub the element's layout rect (jsdom reports all-zero otherwise). */
function stubRect(el: HTMLElement, rect: Partial<DOMRect>) {
  el.getBoundingClientRect = vi.fn(
    () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, ...rect }) as DOMRect,
  );
}

function pointer(type: string, coords?: { clientX: number; clientY: number }) {
  const ev = new Event(type, { bubbles: true });
  if (coords) Object.assign(ev, coords);
  return ev;
}

beforeEach(() => window.localStorage.clear());
afterEach(() => cleanup());

describe("useResizable — restore", () => {
  it("applies a saved size to the element's inline style on mount", () => {
    window.localStorage.setItem(KEY, JSON.stringify({ width: 500, height: 300 }));
    const { getByTestId } = render(<Harness />);
    const box = getByTestId("box");
    expect(box.style.width).toBe("500px");
    expect(box.style.height).toBe("300px");
  });

  it("ignores non-positive or non-numeric saved dimensions", () => {
    window.localStorage.setItem(KEY, JSON.stringify({ width: 0, height: "tall" }));
    const box = render(<Harness />).getByTestId("box");
    expect(box.style.width).toBe("");
    expect(box.style.height).toBe("");
  });

  it("ignores unparseable localStorage without throwing", () => {
    window.localStorage.setItem(KEY, "not json");
    const box = render(<Harness />).getByTestId("box");
    expect(box.style.width).toBe("");
  });
});

describe("useResizable — drag persistence", () => {
  it("persists the new size when the drag starts in the bottom-right corner", () => {
    const box = render(<Harness />).getByTestId("box");
    stubRect(box, { right: 200, bottom: 200, width: 512, height: 333 });
    // pointerdown inside the 20px corner, pointerup anywhere → save.
    box.dispatchEvent(pointer("pointerdown", { clientX: 195, clientY: 195 }));
    window.dispatchEvent(pointer("pointerup"));
    expect(JSON.parse(window.localStorage.getItem(KEY)!)).toEqual({ width: 512, height: 333 });
  });

  it("does NOT persist when the pointerdown is outside the corner", () => {
    const box = render(<Harness />).getByTestId("box");
    stubRect(box, { right: 200, bottom: 200, width: 512, height: 333 });
    box.dispatchEvent(pointer("pointerdown", { clientX: 10, clientY: 10 }));
    window.dispatchEvent(pointer("pointerup"));
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it("rounds fractional rect dimensions before saving", () => {
    const box = render(<Harness />).getByTestId("box");
    stubRect(box, { right: 200, bottom: 200, width: 511.7, height: 332.2 });
    box.dispatchEvent(pointer("pointerdown", { clientX: 199, clientY: 199 }));
    window.dispatchEvent(pointer("pointerup"));
    expect(JSON.parse(window.localStorage.getItem(KEY)!)).toEqual({ width: 512, height: 332 });
  });

  it("removes the window pointerup listener on unmount (no save after teardown)", () => {
    const view = render(<Harness />);
    const box = view.getByTestId("box");
    stubRect(box, { right: 200, bottom: 200, width: 512, height: 333 });
    box.dispatchEvent(pointer("pointerdown", { clientX: 195, clientY: 195 }));
    view.unmount();
    window.dispatchEvent(pointer("pointerup"));
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });
});

describe("useResizable — reset", () => {
  it("clears inline styles and the saved entry", () => {
    window.localStorage.setItem(KEY, JSON.stringify({ width: 500, height: 300 }));
    const { getByTestId, getByText } = render(<Harness />);
    const box = getByTestId("box");
    expect(box.style.width).toBe("500px");
    fireEvent.click(getByText("reset"));
    expect(box.style.width).toBe("");
    expect(box.style.height).toBe("");
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });
});
