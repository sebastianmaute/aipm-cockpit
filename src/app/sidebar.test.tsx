import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Sidebar } from "./sidebar";

describe("Sidebar", () => {
  const base = {
    lang: "en-US" as const,
    activeView: "open-points" as const,
    onNavigate: () => {},
    collapsed: false,
    onToggleCollapsed: () => {},
    version: "v0.29.0",
  };

  it("renders the brand subtitle and version with the Version label", () => {
    render(<Sidebar {...base} />);
    expect(screen.getByText("LIST OF OPEN POINTS")).toBeTruthy();
    expect(screen.getByText("Version v0.29.0")).toBeTruthy();
  });

  it("toggles collapse when the collapse button is clicked", () => {
    const onToggleCollapsed = vi.fn();
    render(<Sidebar {...base} onToggleCollapsed={onToggleCollapsed} />);
    fireEvent.click(screen.getByRole("button", { name: "Collapse sidebar" }));
    expect(onToggleCollapsed).toHaveBeenCalled();
  });

  it("hides the brand subtitle when collapsed", () => {
    render(<Sidebar {...base} collapsed={true} />);
    expect(screen.queryByText("LIST OF OPEN POINTS")).toBeNull();
  });
});
