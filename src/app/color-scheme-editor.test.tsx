import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ColorSchemeEditor } from "./color-scheme-editor";
import { addScheme, loadSchemes } from "./color-schemes";

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

// Coherence: the active library scheme must always == what is applied (rendered).
describe("ColorSchemeEditor coherence", () => {
  beforeEach(() => localStorage.clear());

  it("applies a scheme when it is selected from the dropdown", () => {
    addScheme("Red", { "--AIPM-green": "#ff0000" }, {});
    addScheme("Blue", { "--AIPM-green": "#0000ff" }, {}); // active = Blue (id 2)
    const onApply = vi.fn();
    render(<ColorSchemeEditor lang="en-US" onApply={onApply} />);
    onApply.mockClear();
    fireEvent.change(screen.getByLabelText("Saved schemes"), { target: { value: "1" } }); // Red
    expect(onApply).toHaveBeenCalled();
    expect(onApply.mock.calls.at(-1)![0]["--AIPM-green"]).toBe("#ff0000");
  });

  it("applies a newly saved scheme", () => {
    const onApply = vi.fn();
    render(<ColorSchemeEditor lang="en-US" onApply={onApply} />);
    fireEvent.input(screen.getByLabelText("Accent"), { target: { value: "#123456" } });
    fireEvent.change(screen.getByLabelText("Scheme name"), { target: { value: "Acme" } });
    onApply.mockClear();
    fireEvent.click(screen.getByRole("button", { name: /^new scheme$/i }));
    expect(onApply).toHaveBeenCalled();
    expect(onApply.mock.calls.at(-1)![0]["--AIPM-green"]).toBe("#123456");
  });

  it("clears the applied colors when the active scheme is deleted", () => {
    addScheme("Red", { "--AIPM-green": "#ff0000" }, {});
    const onClear = vi.fn();
    render(<ColorSchemeEditor lang="en-US" onApply={vi.fn()} onClear={onClear} />);
    fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("persists applied edits to the active scheme (survives reload)", () => {
    addScheme("Red", { "--AIPM-green": "#ff0000" }, {});
    render(<ColorSchemeEditor lang="en-US" onApply={vi.fn()} />);
    fireEvent.input(screen.getByLabelText("Accent"), { target: { value: "#00ff00" } });
    fireEvent.click(screen.getByRole("button", { name: /^apply$/i }));
    const red = loadSchemes().schemes.find((s) => s.name === "Red");
    expect(red!.colors["--AIPM-green"]).toBe("#00ff00");
  });
});
