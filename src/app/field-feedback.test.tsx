import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { CharCounter, FieldNotice } from "./field-feedback";

describe("CharCounter", () => {
  it("renders nothing below 80% of the cap", () => {
    const { container } = render(<CharCounter value={"x".repeat(70)} max={100} lang="en-US" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows count / max at >=80% of the cap", () => {
    render(<CharCounter value={"x".repeat(85)} max={100} lang="en-US" />);
    expect(screen.getByText("85 / 100")).toBeInTheDocument();
  });

  it("appends the trimmed-to-fit hint at the cap", () => {
    render(<CharCounter value={"x".repeat(100)} max={100} lang="en-US" />);
    expect(screen.getByText(/100 \/ 100/)).toHaveTextContent("trimmed to fit");
  });
});

describe("FieldNotice", () => {
  it("renders nothing when empty", () => {
    const { container } = render(<FieldNotice>{null}</FieldNotice>);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders children inside an aria-live region", () => {
    render(<FieldNotice>adjusted to max 24</FieldNotice>);
    const el = screen.getByText("adjusted to max 24");
    expect(el).toHaveAttribute("aria-live", "polite");
  });
});
