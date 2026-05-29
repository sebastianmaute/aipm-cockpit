import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { InfoTooltip } from "./info-tooltip";

describe("InfoTooltip", () => {
  it("renders an accessible trigger with the tooltip text", () => {
    render(<InfoTooltip text="Where your workspace is saved." />);
    const trigger = screen.getByRole("button", { name: "Where your workspace is saved." });
    expect(trigger).toBeInTheDocument();
    expect(screen.getByText("Where your workspace is saved.")).toBeInTheDocument();
  });

  it("uses an explicit label when provided", () => {
    render(<InfoTooltip text="Long help text." label="Help: storage" />);
    expect(screen.getByRole("button", { name: "Help: storage" })).toBeInTheDocument();
  });

  it("renders nothing when text is empty", () => {
    const { container } = render(<InfoTooltip text="" />);
    expect(container).toBeEmptyDOMElement();
  });
});
