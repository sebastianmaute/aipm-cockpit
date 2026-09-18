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

function stubRect() {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(RECT);
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

  it("stays open when a non-hovering pen leaves", async () => {
    stubRect();
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole("button", { name: "chart" });
    await user.pointer({ target: trigger, coords: { clientX: 412, clientY: 60 } });
    expect(screen.getByRole("status")).toHaveTextContent("2026-02-01");
    // user-event has no pen binding, so a synthetic pointerleave is the only
    // way to reach this pointerType — fireEvent, not user.pointer, here.
    fireEvent.pointerLeave(trigger, { pointerType: "pen" });
    expect(screen.getByRole("status")).not.toHaveTextContent("closed");
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
      return <><button type="button" {...r.triggerProps}>chart</button><output>{r.stop ?? "closed"}</output></>;
    }
    // A dropped `stops.length === 0` guard would index an empty `stops`
    // array and pass `undefined` where a date is expected downstream. The
    // harness's `?? "closed"` fallback renders `undefined` and `null`
    // identically, so the text assertions below cannot tell a correct guard
    // from a missing one on their own — a synchronous `window` `"error"`
    // listener catches the resulting uncaught exception deterministically
    // instead of relying on it merely failing the process (which it also
    // does, but only as an unasserted side effect).
    const onError = vi.fn();
    window.addEventListener("error", onError);
    const user = userEvent.setup();
    render(<Empty />);
    await user.click(screen.getByRole("button", { name: "chart" }));
    expect(screen.getByRole("status")).toHaveTextContent("closed");
    await user.tab();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("status")).toHaveTextContent("closed");
    expect(onError).not.toHaveBeenCalled();
    window.removeEventListener("error", onError);
  });
});
