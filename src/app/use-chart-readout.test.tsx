import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useChartReadout } from "./use-chart-readout";

const STOPS = ["2026-01-01", "2026-02-01", "2026-03-01"];
const RECT = { left: 100, top: 50, width: 640, height: 240, right: 740, bottom: 290, x: 100, y: 50, toJSON: () => ({}) } as DOMRect;

function Harness() {
  const readout = useChartReadout({
    stops: STOPS, xDomain: ["2026-01-01", "2026-03-01"], x0: 64, x1: 560, viewBoxWidth: 640,
  });
  return (
    <div>
      <button type="button" {...readout.triggerProps}>chart</button>
      <output>{readout.stop ?? "closed"}</output>
      <span data-testid="anchor">{readout.anchor ? `${readout.anchor.top}/${Math.round(readout.anchor.left)}` : "none"}</span>
    </div>
  );
}

afterEach(() => { vi.restoreAllMocks(); });

function stubRect(rect: DOMRect = RECT) {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(rect);
}

/** A chart narrower than the 352px box, as the dashboard tile is at `xl`. */
function narrowRect(left: number): DOMRect {
  return { left, top: 50, width: 200, height: 240, right: left + 200, bottom: 290, x: left, y: 50, toJSON: () => ({}) } as DOMRect;
}

describe("useChartReadout", () => {
  it("starts closed", () => {
    stubRect();
    render(<Harness />);
    expect(screen.getByRole("status")).toHaveTextContent("closed");
    expect(screen.getByTestId("anchor")).toHaveTextContent("none");
  });

  it("opens on pointer move at the nearest stop and closes on pointer leave", async () => {
    stubRect();
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "chart" });
    // Client 100 + 312 = the SVG's x 312, nearest the middle stop (x 312).
    await user.pointer({ target: trigger, coords: { clientX: 412, clientY: 60 } });
    expect(screen.getByRole("status")).toHaveTextContent("2026-02-01");
    expect(screen.getByTestId("anchor")).toHaveTextContent("58/");
    await user.pointer({ target: document.body, coords: { clientX: 0, clientY: 0 } });
    expect(screen.getByRole("status")).toHaveTextContent("closed");
  });

  it("stays open when a non-hovering pen lifts off and leaves", async () => {
    stubRect();
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "chart" });
    await user.pointer({ target: trigger, coords: { clientX: 412, clientY: 60 } });
    expect(screen.getByRole("status")).toHaveTextContent("2026-02-01");
    // user-event has no pen binding, so synthetic events are the only way to
    // reach this pointerType — fireEvent, not user.pointer, here. A pen that
    // cannot hover fires pointerleave in the same task as its pointerup.
    fireEvent.pointerUp(trigger, { pointerType: "pen" });
    fireEvent.pointerLeave(trigger, { pointerType: "pen" });
    expect(screen.getByRole("status")).toHaveTextContent("2026-02-01");
  });

  // The mirror case: a pen that HOVERS opens the readout by pointermove alone and never
  // focuses the button, so leaving is its only close path — there is no blur or Escape.
  it("closes when a hovering pen leaves", async () => {
    stubRect();
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "chart" });
    await user.pointer({ target: trigger, coords: { clientX: 412, clientY: 60 } });
    expect(screen.getByRole("status")).toHaveTextContent("2026-02-01");
    fireEvent.pointerLeave(trigger, { pointerType: "pen" });
    expect(screen.getByRole("status")).toHaveTextContent("closed");
  });

  // The lift-off window is one task wide: a pen that tapped, then hovered away LATER,
  // is a hovering pen again and must close.
  it("closes when a pen leaves after its lift-off has passed", async () => {
    stubRect();
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "chart" });
    await user.pointer({ target: trigger, coords: { clientX: 412, clientY: 60 } });
    fireEvent.pointerUp(trigger, { pointerType: "pen" });
    await act(() => new Promise((resolve) => { setTimeout(resolve, 0); }));
    expect(screen.getByRole("status")).toHaveTextContent("2026-02-01");
    fireEvent.pointerLeave(trigger, { pointerType: "pen" });
    expect(screen.getByRole("status")).toHaveTextContent("closed");
  });

  it("stays open when a touch contact leaves, lift-off or not", async () => {
    stubRect();
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "chart" });
    await user.pointer({ target: trigger, coords: { clientX: 412, clientY: 60 } });
    fireEvent.pointerLeave(trigger, { pointerType: "touch" });
    expect(screen.getByRole("status")).toHaveTextContent("2026-02-01");
  });

  // Pure arithmetic over the stubbed rect, so jsdom's lack of layout is no barrier. The
  // chart's x axis runs 64…560 of a 640-wide viewBox, drawn 1:1 into RECT (left 100,
  // right 740); the box is 352 wide, so its centre is clamped to [276, 564].
  describe("anchor clamp", () => {
    const anchorAt = async (key: "{Home}" | "{End}") => {
      const user = userEvent.setup();
      render(<Harness />);
      await user.tab();
      await user.keyboard(key);
      return screen.getByTestId("anchor").textContent;
    };

    it("keeps the box inside the chart at the first stop", async () => {
      stubRect();
      // Raw x 100 + 64 = 164, pulled right to 100 + 176.
      expect(await anchorAt("{Home}")).toBe("58/276");
    });

    it("keeps the box inside the chart at the last stop", async () => {
      stubRect();
      // Raw x 100 + 560 = 660, pulled left to 740 - 176.
      expect(await anchorAt("{End}")).toBe("58/564");
    });

    // A chart narrower than the box cannot hold it, so the chart-box clamp stands down —
    // but the viewport clamp still applies: centre within [8 + 176, innerWidth - 8 - 176].
    it("keeps a box wider than the chart inside the viewport on the right", async () => {
      expect(window.innerWidth).toBe(1024);
      stubRect(narrowRect(800));
      // Raw x 800 + 560 * 200/640 = 975, pulled left to 1024 - 184 = 840.
      expect(await anchorAt("{End}")).toBe("58/840");
    });

    it("keeps a box wider than the chart inside the viewport on the left", async () => {
      stubRect(narrowRect(0));
      // Raw x 64 * 200/640 = 20, pulled right to 184.
      expect(await anchorAt("{Home}")).toBe("58/184");
    });

    it("leaves a narrow chart's stop unclamped where the box already fits the viewport", async () => {
      stubRect(narrowRect(500));
      // Raw x 500 + 20 = 520: inside both viewport bounds, and the chart-box clamp is off.
      expect(await anchorAt("{Home}")).toBe("58/520");
    });
  });

  it("closes on scroll and on resize", async () => {
    stubRect();
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "chart" });
    await user.pointer({ target: trigger, coords: { clientX: 412, clientY: 60 } });
    expect(screen.getByRole("status")).toHaveTextContent("2026-02-01");
    act(() => { window.dispatchEvent(new Event("scroll")); });
    expect(screen.getByRole("status")).toHaveTextContent("closed");

    // Move away first: user-event tracks a virtual pointer position, and
    // re-issuing the same coords without an intervening move is a no-op that
    // fires no pointermove, which would leave this half of the test vacuous.
    await user.pointer({ target: document.body, coords: { clientX: 0, clientY: 0 } });
    await user.pointer({ target: trigger, coords: { clientX: 412, clientY: 60 } });
    expect(screen.getByRole("status")).toHaveTextContent("2026-02-01");
    act(() => { window.dispatchEvent(new Event("resize")); });
    expect(screen.getByRole("status")).toHaveTextContent("closed");
  });

  it("does not open on a right-click", async () => {
    stubRect();
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "chart" });
    fireEvent.pointerDown(trigger, { button: 2, clientX: 412, clientY: 60 });
    expect(screen.getByRole("status")).toHaveTextContent("closed");
  });

  it("steps with the arrow keys and jumps with Home and End", async () => {
    stubRect();
    const user = userEvent.setup();
    render(<Harness />);
    await user.tab();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("status")).toHaveTextContent("2026-01-01");
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("status")).toHaveTextContent("2026-02-01");
    await user.keyboard("{End}");
    expect(screen.getByRole("status")).toHaveTextContent("2026-03-01");
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("status")).toHaveTextContent("2026-03-01");
    await user.keyboard("{Home}");
    expect(screen.getByRole("status")).toHaveTextContent("2026-01-01");
    await user.keyboard("{ArrowLeft}");
    expect(screen.getByRole("status")).toHaveTextContent("2026-01-01");
  });

  it("closes on Escape and on blur", async () => {
    stubRect();
    const user = userEvent.setup();
    render(<Harness />);
    await user.tab();
    await user.keyboard("{ArrowRight}");
    await user.keyboard("{Escape}");
    expect(screen.getByRole("status")).toHaveTextContent("closed");
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("status")).toHaveTextContent("2026-01-01");
    await user.tab();
    expect(screen.getByRole("status")).toHaveTextContent("closed");
  });

  it("opens on a tap and stays open on a second tap", async () => {
    stubRect();
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "chart" });
    // A real touch tap has no preceding hover: userEvent's mouse-flavoured
    // `click()` synthesizes a pointermove first, which would open the readout
    // via onPointerMove and mask a broken onPointerDown — so exercise the
    // touch pointer type directly, which fires pointerdown/click with no move.
    const tap = () => user.pointer([
      { keys: "[TouchA>]", target: trigger, coords: { clientX: 412, clientY: 60 } },
      { keys: "[/TouchA]" },
    ]);
    await tap();
    expect(screen.getByRole("status")).not.toHaveTextContent("closed");
    await tap();
    expect(screen.getByRole("status")).not.toHaveTextContent("closed");
  });

  // Regression test for the click-driven toggle this hook used to have: it
  // closed the readout a hover had just opened, so an ordinary mouse user
  // hovering then clicking would watch it vanish instead of stay put.
  it("stays open when a mouse hovers and then clicks", async () => {
    stubRect();
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "chart" });
    await user.pointer({ target: trigger, coords: { clientX: 412, clientY: 60 } });
    expect(screen.getByRole("status")).toHaveTextContent("2026-02-01");
    await user.click(trigger);
    expect(screen.getByRole("status")).not.toHaveTextContent("closed");
    expect(screen.getByRole("status")).toHaveTextContent("2026-02-01");
  });

  it("opens at the first stop on a keyboard activation", async () => {
    stubRect();
    const user = userEvent.setup();
    render(<Harness />);
    await user.tab();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("status")).toHaveTextContent("2026-01-01");
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("status")).toHaveTextContent("2026-02-01");
    // The `stop === null` half of onClick's fallback: a second keyboard
    // activation while already open must be a no-op, not re-snap to the
    // first stop (which would silently undo the ArrowRight above).
    await user.keyboard("{Enter}");
    expect(screen.getByRole("status")).toHaveTextContent("2026-02-01");
  });

  it("stays closed with no stops, by pointer or keyboard", async () => {
    stubRect();
    function Empty() {
      const r = useChartReadout({ stops: [], xDomain: ["2026-01-01", "2026-03-01"], x0: 64, x1: 560, viewBoxWidth: 640 });
      // A plain `r.stop ?? "closed"` renders `undefined` and `null`
      // identically, which is exactly the value a dropped `stops.length ===
      // 0` guard produces (it indexes an empty array and hands `step`
      // `undefined` instead of a date) — so that fallback alone cannot tell
      // a correct guard from a missing one. Render `undefined` as its own
      // distinct string so the assertion below is checking the real
      // invariant ("stays closed", not merely "didn't say a date").
      const text = r.stop === undefined ? "undefined" : r.stop ?? "closed";
      return <><button type="button" {...r.triggerProps}>chart</button><output>{text}</output></>;
    }
    // Secondary signal, kept alongside the direct check above: a dropped
    // guard also throws downstream (`scaleDate` on an `undefined` date), and
    // a synchronous `window` `"error"` listener catches that uncaught
    // exception deterministically. This is a proxy for the real invariant,
    // not a replacement for it — a future change that made the downstream
    // code tolerate a bad date instead of throwing would silently defeat it
    // while leaving the guard missing, which is why the direct check above
    // exists too.
    const onError = vi.fn();
    window.addEventListener("error", onError);
    try {
      const user = userEvent.setup();
      render(<Empty />);
      await user.click(screen.getByRole("button", { name: "chart" }));
      expect(screen.getByRole("status")).toHaveTextContent("closed");
      await user.tab();
      await user.keyboard("{ArrowRight}");
      expect(screen.getByRole("status")).toHaveTextContent("closed");
      expect(onError).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("error", onError);
    }
  });
});
