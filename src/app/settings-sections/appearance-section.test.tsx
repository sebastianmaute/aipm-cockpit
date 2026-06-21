import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AppearanceSection } from "./appearance-section";
import { defaultSettings, type Settings } from "../settings-types";

function renderSection(overrides: Partial<Settings> = {}) {
  const settings = { ...defaultSettings, ...overrides };
  const onChange = vi.fn();
  render(<AppearanceSection lang="en-US" settings={settings} onChange={onChange} />);
  return { onChange };
}

describe("AppearanceSection density control", () => {
  it("renders a Density radiogroup with both options", () => {
    renderSection();
    const group = screen.getByRole("radiogroup", { name: "Density" });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Comfortable" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Compact" })).toBeInTheDocument();
  });

  it("marks Comfortable selected by default", () => {
    renderSection();
    expect(screen.getByRole("radio", { name: "Comfortable" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Compact" })).toHaveAttribute("aria-checked", "false");
  });

  it("calls onChange with dashboardDensity=compact when Compact is picked", () => {
    const { onChange } = renderSection();
    fireEvent.click(screen.getByRole("radio", { name: "Compact" }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ dashboardDensity: "compact" }));
  });

  it("reflects a stored compact preference", () => {
    renderSection({ dashboardDensity: "compact" });
    expect(screen.getByRole("radio", { name: "Compact" })).toHaveAttribute("aria-checked", "true");
  });
});
