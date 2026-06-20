import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DisplayTzSwitcher } from "./display-tz-switcher";
import { t } from "./i18n";

function renderWith(over: { displayTz?: string; isOverridden?: boolean } = {}) {
  const setDisplayOverride = vi.fn();
  const ctx = {
    displayTz: over.displayTz ?? "Europe/Berlin", effectiveTz: "Europe/Berlin",
    isOverridden: over.isOverridden ?? false, setDisplayOverride, resetDisplayTz: () => setDisplayOverride(undefined),
  };
  render(<DisplayTzSwitcher lang="en-US" ctx={ctx} additionalTimezones={["America/New_York"]} />);
  return { setDisplayOverride };
}

describe("DisplayTzSwitcher", () => {
  it("is labeled and lists Default + UTC + additional zones", () => {
    renderWith();
    const sel = screen.getByLabelText(t("en-US", "displayTzLabel")) as HTMLSelectElement;
    const opts = Array.from(sel.options).map((o) => o.value);
    expect(opts).toContain("");
    expect(opts).toContain("UTC");
    expect(opts).toContain("America/New_York");
  });
  it("selecting a zone sets the override; selecting Default clears it", () => {
    const { setDisplayOverride } = renderWith();
    const sel = screen.getByLabelText(t("en-US", "displayTzLabel"));
    fireEvent.change(sel, { target: { value: "UTC" } });
    expect(setDisplayOverride).toHaveBeenCalledWith("UTC");
    fireEvent.change(sel, { target: { value: "" } });
    expect(setDisplayOverride).toHaveBeenCalledWith(undefined);
  });
});
