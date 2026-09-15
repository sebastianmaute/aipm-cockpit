import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { InfoTooltip } from "./info-tooltip";

describe("InfoTooltip", () => {
  it("renders nothing when text is empty", () => {
    const { container } = render(<InfoTooltip text="" />);
    expect(container.firstChild).toBeNull();
  });

  it("renders an accessible trigger with aria-label defaulting to text", () => {
    render(<InfoTooltip text="Where your workspace is saved." />);
    const trigger = screen.getByRole("button", { name: "Where your workspace is saved." });
    expect(trigger).toBeInTheDocument();
    // bubble is NOT rendered until focus/hover
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("uses an explicit label when provided", () => {
    render(<InfoTooltip text="Long help text." label="Help: storage" />);
    expect(screen.getByRole("button", { name: "Help: storage" })).toBeInTheDocument();
  });

  it("shows the bubble (normal-case) on focus and uses the aria-label", () => {
    render(<InfoTooltip text="explains the field" label="info" />);
    const trigger = screen.getByRole("button", { name: "info" });
    fireEvent.focus(trigger);
    const tip = screen.getByRole("tooltip");
    expect(tip.textContent).toBe("explains the field");
    expect(tip.className).toContain("normal-case");
  });

  it("hides the bubble on blur", () => {
    render(<InfoTooltip text="Some help" />);
    const trigger = screen.getByRole("button", { name: "Some help" });
    fireEvent.focus(trigger);
    expect(screen.getByRole("tooltip")).toBeInTheDocument();
    fireEvent.blur(trigger);
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  describe("viewport clamping", () => {
    let originalInnerWidth: number;

    beforeEach(() => {
      originalInnerWidth = window.innerWidth;
    });

    afterEach(() => {
      Object.defineProperty(window, "innerWidth", {
        value: originalInnerWidth,
        configurable: true,
      });
    });

    it("clamps the bubble left so it stays within viewport when trigger is near the right edge", () => {
      // 1000px viewport, trigger at x=980..1000 (right edge)
      Object.defineProperty(window, "innerWidth", {
        value: 1000,
        configurable: true,
      });

      const { container } = render(<InfoTooltip text="Near right edge" />);

      // Stub getBoundingClientRect on the trigger span (the role=button span)
      const trigger = screen.getByRole("button", { name: "Near right edge" });
      const triggerParent = container.firstChild as HTMLElement; // outer wrapper span
      Object.defineProperty(triggerParent, "getBoundingClientRect", {
        value: () => ({
          left: 980,
          right: 1000,
          width: 20,
          bottom: 50,
          top: 30,
          height: 20,
          x: 980,
          y: 30,
          toJSON: () => ({}),
        }),
        configurable: true,
      });

      fireEvent.focus(trigger);

      const bubble = screen.getByRole("tooltip");
      // left is set as inline style px value
      const leftPx = parseFloat(bubble.style.left);
      // max clamped = innerWidth(1000) - MARGIN(8) - HALF(128) = 864
      expect(leftPx).toBeLessThanOrEqual(864);
    });
  });

  describe("custom trigger (children)", () => {
    const name = "Effort worse than € at current pace — why?";

    it("renders the children inside the one focusable trigger, named by label", () => {
      render(<InfoTooltip text="because" label={name}><span>Effort worse than €</span></InfoTooltip>);
      const trigger = screen.getByRole("button", { name });
      expect(trigger).toHaveTextContent("Effort worse than €");
      expect(trigger).toHaveAttribute("data-info-tooltip-trigger");
      expect(trigger.className).not.toContain("h-4");
      expect(screen.getAllByRole("button")).toHaveLength(1);
    });

    it("keeps the visible text inside the accessible name (label-in-name)", () => {
      render(<InfoTooltip text="because" label={name}><span>Effort worse than €</span></InfoTooltip>);
      const trigger = screen.getByRole("button", { name });
      expect(trigger.getAttribute("aria-label")).toContain(trigger.textContent ?? "");
    });

    it("opens on pointer enter and on focus, and closes on Escape", () => {
      render(<InfoTooltip text="because" label={name}><span>Effort worse than €</span></InfoTooltip>);
      const trigger = screen.getByRole("button", { name });
      fireEvent.pointerEnter(trigger);
      expect(screen.getByRole("tooltip")).toHaveTextContent("because");
      fireEvent.pointerLeave(trigger);
      expect(screen.queryByRole("tooltip")).toBeNull();
      act(() => trigger.focus());
      expect(screen.getByRole("tooltip")).toHaveTextContent("because");
      fireEvent.keyDown(trigger, { key: "Escape" });
      expect(screen.queryByRole("tooltip")).toBeNull();
    });

    it("requires a label with a custom trigger (type-level)", () => {
      // @ts-expect-error — `label` is required when `children` is given
      const element = <InfoTooltip text="x"><span>y</span></InfoTooltip>;
      expect(element).toBeTruthy();
    });
  });
});
