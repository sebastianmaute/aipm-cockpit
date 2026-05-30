import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GeneralSection } from "./general-section";
import { defaultSettings } from "../settings-types";
import { t } from "../i18n";

describe("GeneralSection", () => {
  it("toggling reuse-window persists popout.reuseWindow", () => {
    const onChange = vi.fn();
    render(<GeneralSection lang="en-US" settings={defaultSettings} onChange={onChange} />);
    fireEvent.click(screen.getByRole("checkbox", { name: t("en-US", "popoutReuseWindow") }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ popout: { reuseWindow: true } }),
    );
  });

  it("editing workday hours persists resources.workdayHours", () => {
    const onChange = vi.fn();
    render(<GeneralSection lang="en-US" settings={defaultSettings} onChange={onChange} />);
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "10" } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ resources: { workdayHours: 10 } }),
    );
  });
});
