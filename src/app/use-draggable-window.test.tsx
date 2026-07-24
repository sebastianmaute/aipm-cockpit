import { describe, it, expect, beforeEach } from "vitest";
import { useRef } from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import {
  useDraggableWindow,
  type ComputeInitialPos,
} from "./use-draggable-window";

const KEY = "test:draggable-window-pos";

// Default policy: clamp a saved position, else a {96,96} corner.
const cornerInitial: ComputeInitialPos = ({ saved, clamp }) =>
  clamp(saved ?? { x: 96, y: 96 });

interface HarnessProps {
  open?: boolean;
  storageKey?: string;
  computeInitialPos?: ComputeInitialPos;
  fallbackWidth?: number;
  fallbackHeight?: number;
}

function Harness({
  open = true,
  storageKey = KEY,
  computeInitialPos = cornerInitial,
  fallbackWidth,
  fallbackHeight,
}: HarnessProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const { pos, onTitleBarMouseDown, resetPos } = useDraggableWindow(storageKey, {
    open,
    panelRef,
    computeInitialPos,
    fallbackWidth,
    fallbackHeight,
  });
  return (
    <div ref={panelRef} data-testid="panel">
      <div data-testid="bar" onMouseDown={onTitleBarMouseDown}>
        <button type="button" data-testid="ctrl">
          x
        </button>
      </div>
      <button type="button" data-testid="reset" onClick={resetPos}>
        reset
      </button>
      <span data-testid="pos">{pos ? `${pos.x},${pos.y}` : "null"}</span>
    </div>
  );
}

function posText(): string {
  return screen.getByTestId("pos").textContent ?? "";
}

function drag(from: { x: number; y: number }, to: { x: number; y: number }, onEl?: HTMLElement) {
  fireEvent.mouseDown(onEl ?? screen.getByTestId("bar"), { clientX: from.x, clientY: from.y });
  fireEvent.mouseMove(window, { clientX: to.x, clientY: to.y });
  fireEvent.mouseUp(window);
}

describe("useDraggableWindow", () => {
  beforeEach(() => {
    window.localStorage.clear();
    // jsdom defaults; make them explicit so clamp math is deterministic.
    (window as unknown as { innerWidth: number }).innerWidth = 1024;
    (window as unknown as { innerHeight: number }).innerHeight = 768;
  });

  it("places the window at the computed initial position on first open", () => {
    render(<Harness />);
    // jsdom offsetWidth/Height are 0, so clamp keeps {96,96} (well inside 1024x768).
    expect(posText()).toBe("96,96");
  });

  it("stays unplaced (pos null) while closed", () => {
    render(<Harness open={false} />);
    expect(posText()).toBe("null");
  });

  it("moves the window by the drag delta", () => {
    render(<Harness />);
    // origin {96,96}; press at (10,10), release at (60,40) → +50,+30.
    drag({ x: 10, y: 10 }, { x: 60, y: 40 });
    expect(posText()).toBe("146,126");
  });

  it("clamps to the lower viewport edge (never negative)", () => {
    render(<Harness />);
    // A move that would drive x/y negative clamps to 0.
    drag({ x: 100, y: 100 }, { x: 0, y: 0 }); // 96 + (0-100) = -4 → 0
    expect(posText()).toBe("0,0");
  });

  it("clamps to the upper viewport edge accounting for panel size", () => {
    render(<Harness />);
    const panel = screen.getByTestId("panel");
    // Give the panel a measurable size and shrink the viewport so max is exact.
    Object.defineProperty(panel, "offsetWidth", { configurable: true, value: 300 });
    Object.defineProperty(panel, "offsetHeight", { configurable: true, value: 300 });
    (window as unknown as { innerWidth: number }).innerWidth = 500;
    (window as unknown as { innerHeight: number }).innerHeight = 500;
    // Drag far past the edge → clamp to (innerWidth-panelW, innerHeight-panelH) = (200,200).
    drag({ x: 0, y: 0 }, { x: 2000, y: 2000 });
    expect(posText()).toBe("200,200");
  });

  it("persists the resting position and restores it on a fresh mount", () => {
    const { unmount } = render(<Harness />);
    drag({ x: 10, y: 10 }, { x: 40, y: 30 }); // → {126,116}
    expect(posText()).toBe("126,116");
    // Written to storage under the key.
    expect(JSON.parse(window.localStorage.getItem(KEY) ?? "null")).toEqual({ x: 126, y: 116 });
    unmount();
    // A brand-new window with the same key restores the saved position, not the default.
    render(<Harness />);
    expect(posText()).toBe("126,116");
  });

  it("does not start a drag when a control in the bar is pressed", () => {
    render(<Harness />);
    // mousedown on the button (bubbles to the bar handler with target=button).
    drag({ x: 10, y: 10 }, { x: 300, y: 260 }, screen.getByTestId("ctrl"));
    expect(posText()).toBe("96,96"); // unmoved
    // And nothing was persisted (the drag never armed).
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });

  it("resetPos clears the saved position and recomputes the default", () => {
    render(<Harness />);
    drag({ x: 10, y: 10 }, { x: 40, y: 30 }); // → {126,116}, persisted
    expect(window.localStorage.getItem(KEY)).not.toBeNull();
    act(() => {
      fireEvent.click(screen.getByTestId("reset"));
    });
    expect(window.localStorage.getItem(KEY)).toBeNull();
    // Placement re-runs → back to the {96,96} default.
    expect(posText()).toBe("96,96");
  });
});
