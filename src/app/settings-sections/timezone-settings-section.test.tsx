// src/app/settings-sections/timezone-settings-section.test.tsx
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TimezoneSettingsSection } from "./timezone-settings-section";
import { defaultSettings } from "../settings-types";
import { t } from "../i18n";
import { expectRowUniqueNames } from "../../test/row-unique-names";

function setup(overrides = {}) {
  const onChange = vi.fn();
  const settings = { ...defaultSettings, ...overrides };
  render(<TimezoneSettingsSection lang="en-US" settings={settings} onChange={onChange} />);
  return { onChange, settings };
}

describe("TimezoneSettingsSection", () => {
  it("renders a labeled default-timezone control", () => {
    setup();
    expect(
      screen.getByRole("combobox", { name: t("en-US", "tzDefaultLabel") }),
    ).toBeInTheDocument();
  });

  it("choosing System default (value '') sets timezone: undefined", () => {
    const { onChange } = setup({ timezone: "Europe/Berlin" });
    const select = screen.getByRole("combobox", { name: t("en-US", "tzDefaultLabel") });
    fireEvent.change(select, { target: { value: "" } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ timezone: undefined }),
    );
  });

  it("selecting a default zone writes timezone through onChange", () => {
    const { onChange } = setup();
    const select = screen.getByRole("combobox", { name: t("en-US", "tzDefaultLabel") });
    fireEvent.change(select, { target: { value: "America/New_York" } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ timezone: "America/New_York" }),
    );
  });

  it("adding a zone appends it to additionalTimezones", () => {
    const { onChange } = setup();
    const addSelect = screen.getByRole("combobox", { name: t("en-US", "tzAddLabel") });
    fireEvent.change(addSelect, { target: { value: "America/New_York" } });
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "tzAddLabel") }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ additionalTimezones: ["America/New_York"] }),
    );
  });

  it("does not add the default zone as a redundant additional", () => {
    const { onChange } = setup({ timezone: "Europe/Berlin" });
    const addSelect = screen.getByRole("combobox", { name: t("en-US", "tzAddLabel") }) as HTMLSelectElement;
    // The default zone isn't even offered as an add option…
    expect(Array.from(addSelect.options).map((o) => o.value)).not.toContain("Europe/Berlin");
    // …and forcing it through addZone is a no-op.
    fireEvent.change(addSelect, { target: { value: "Europe/Berlin" } });
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "tzAddLabel") }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("does not add a duplicate zone", () => {
    const { onChange } = setup({ additionalTimezones: ["America/New_York"] });
    const addSelect = screen.getByRole("combobox", { name: t("en-US", "tzAddLabel") });
    fireEvent.change(addSelect, { target: { value: "America/New_York" } });
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "tzAddLabel") }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("toggling the show-switcher checkbox sets showDisplayTzSwitcher: true", () => {
    const { onChange } = setup({ showDisplayTzSwitcher: false });
    const checkbox = screen.getByRole("checkbox", { name: t("en-US", "tzShowSwitcher") });
    expect(checkbox).not.toBeChecked();
    fireEvent.click(checkbox);
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ showDisplayTzSwitcher: true }),
    );
  });

  it("removing a zone filters it out, with a row-unique remove label", () => {
    const { onChange } = setup({ additionalTimezones: ["America/New_York", "Asia/Tokyo"] });
    const removeBtn = screen.getByRole("button", {
      name: `${t("en-US", "tzRemoveLabel")} – America/New_York`,
    });
    expect(removeBtn).toBeInTheDocument();
    expectRowUniqueNames({ minRows: 3 });
    fireEvent.click(removeBtn);
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ additionalTimezones: ["Asia/Tokyo"] }),
    );
  });
});
