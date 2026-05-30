import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LocalizationSection } from "./localization-section";
import { defaultSettings } from "../settings-types";

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
});
