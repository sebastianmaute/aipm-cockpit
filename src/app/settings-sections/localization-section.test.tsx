import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LocalizationSection } from "./localization-section";
import { defaultSettings } from "../settings-types";
import { t } from "../i18n";

describe("LocalizationSection", () => {
  it("changing the language select calls onChange with the new language", () => {
    const onChange = vi.fn();
    render(<LocalizationSection lang="en-US" settings={defaultSettings} onChange={onChange} />);
    fireEvent.change(screen.getByDisplayValue("English (US)"), {
      target: { value: "de" },
    });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ language: "de" }));
  });

  it("adding a holiday country appends it to holidayCountries", () => {
    const onChange = vi.fn();
    render(<LocalizationSection lang="en-US" settings={defaultSettings} onChange={onChange} />);
    const select = screen.getAllByRole("combobox")[1] as HTMLSelectElement;
    const firstReal = select.options[1];
    fireEvent.change(select, { target: { value: firstReal.value } });
    fireEvent.click(screen.getByRole("button", { name: /add/i }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ holidayCountries: [firstReal.value] }),
    );
  });

  // Class A tooltip batch: the chip's ✕ is icon-only, so the row-unique
  // accessible name is repeated as a `title` for the mouse. The fix lives in the
  // shared `RemovableChipRow`, so it also covers Settings → Timezones. Sampled
  // row — the batch is not fully pinned; see docs/tooltip-inventory.md.
  it("gives the holiday-country remove button a hover title matching its accessible name", () => {
    render(
      <LocalizationSection
        lang="en-US"
        settings={{ ...defaultSettings, holidayCountries: ["DE"] }}
        onChange={vi.fn()}
      />,
    );
    const expected = `${t("en-US", "remove")} Germany`;
    expect(screen.getByRole("button", { name: expected })).toHaveAttribute("title", expected);
  });
});
