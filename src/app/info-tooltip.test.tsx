import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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
});
