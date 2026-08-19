import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { useNarrowElement } from "./use-narrow-element";

// ★★★ jsdom HAS NO ResizeObserver AND vitest.setup.ts INSTALLS NO POLYFILL.
//  The hook feature-detects for exactly this reason; this fake is what lets
//  the measuring branch be exercised at all. It captures the callback so the
//  test can DRIVE it — jsdom has no layout, so nothing will ever call it for
//  us and a test waiting for a real measurement would hang or pass vacuously.
type Cb = (entries: { contentRect: { width: number } }[]) => void;
let fire: Cb | undefined;
let observed: Element[] = [];
let disconnects = 0;

class FakeResizeObserver {
  constructor(cb: Cb) { fire = cb; }
  observe(el: Element) { observed.push(el); }
  disconnect() { disconnects += 1; }
  unobserve() {}
}

function Probe({ max }: { max: number }) {
  const { ref, narrow } = useNarrowElement(max);
  return <div ref={ref} data-testid="pane">{narrow ? "narrow" : "wide"}</div>;
}

describe("useNarrowElement", () => {
  beforeEach(() => {
    fire = undefined;
    observed = [];
    disconnects = 0;
    vi.stubGlobal("ResizeObserver", FakeResizeObserver);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("observes the element the ref is attached to", () => {
    render(<Probe max={640} />);
    expect(observed).toEqual([screen.getByTestId("pane")]);
  });

  it("reports wide until a measurement says otherwise", () => {
    render(<Probe max={640} />);
    expect(screen.getByTestId("pane")).toHaveTextContent("wide");
  });

  it("reports narrow at or below the threshold and wide above it", () => {
    render(<Probe max={640} />);
    act(() => fire?.([{ contentRect: { width: 640 } }]));
    expect(screen.getByTestId("pane")).toHaveTextContent("narrow");
    act(() => fire?.([{ contentRect: { width: 641 } }]));
    expect(screen.getByTestId("pane")).toHaveTextContent("wide");
  });

  // ★★ A ZERO WIDTH IS NOT A NARROW PANE. An unmeasured or detached element
  //  reports 0; treating that as "<= 640" would collapse the editor before the
  //  first real measurement lands, and again any time the pane is hidden.
  it("treats a zero width as NOT narrow", () => {
    render(<Probe max={640} />);
    act(() => fire?.([{ contentRect: { width: 0 } }]));
    expect(screen.getByTestId("pane")).toHaveTextContent("wide");
  });

  it("disconnects on unmount", () => {
    const { unmount } = render(<Probe max={640} />);
    unmount();
    expect(disconnects).toBe(1);
  });

  // ★★★ THE FEATURE GUARD. Without it every test that renders the Documents
  //  panel throws in jsdom, and so does any browser without the API.
  it("renders without throwing when ResizeObserver does not exist", () => {
    vi.unstubAllGlobals();
    // @ts-expect-error — deliberately removing a global the hook must survive.
    delete globalThis.ResizeObserver;
    expect(() => render(<Probe max={640} />)).not.toThrow();
    expect(screen.getByTestId("pane")).toHaveTextContent("wide");
  });
});
