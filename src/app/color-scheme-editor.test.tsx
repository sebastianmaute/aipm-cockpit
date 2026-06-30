import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ColorSchemeEditor } from "./color-scheme-editor";

describe("ColorSchemeEditor", () => {
  beforeEach(() => localStorage.clear());

  it("renders a labeled color picker for each core token", () => {
    render(<ColorSchemeEditor lang="en-US" onApply={vi.fn()} />);
    expect(screen.getByLabelText("Brand primary")).toBeInTheDocument();
    expect(screen.getByLabelText("Accent")).toBeInTheDocument();
  });

  it("calls onApply with the resolved color map including a changed token", () => {
    const onApply = vi.fn();
    render(<ColorSchemeEditor lang="en-US" onApply={onApply} />);
    fireEvent.input(screen.getByLabelText("Accent"), { target: { value: "#123456" } });
    fireEvent.click(screen.getByRole("button", { name: /apply/i }));
    expect(onApply).toHaveBeenCalledTimes(1);
    const arg = onApply.mock.calls[0][0] as Record<string, string>;
    expect(arg["--AIPM-green"]).toBe("#123456");
    expect(arg["--AIPM-green-strong"]).toBeDefined();
  });

  it("shows a below-AA warning when text/background contrast is poor", () => {
    render(<ColorSchemeEditor lang="en-US" onApply={vi.fn()} />);
    fireEvent.input(screen.getByLabelText("Text"), { target: { value: "#eeeeee" } });
    expect(screen.getByText(/below AA/i)).toBeInTheDocument();
  });

  it("saves the working draft as a named scheme", () => {
    render(<ColorSchemeEditor lang="en-US" onApply={() => {}} />);
    fireEvent.change(screen.getByLabelText("Scheme name"), { target: { value: "Acme Blue" } });
    fireEvent.click(screen.getByRole("button", { name: /^new scheme$/i }));
    expect(screen.getByRole("option", { name: "Acme Blue" })).toBeInTheDocument();
  });
});
