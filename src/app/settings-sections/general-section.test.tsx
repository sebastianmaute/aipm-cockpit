import { render, screen, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GeneralSection } from "./general-section";
import { defaultSettings } from "../settings-types";
import { t } from "../i18n";

const resetMock = vi.fn();
vi.mock("../app-reset", () => ({
  resetAppToCleanSlate: () => resetMock(),
}));

afterEach(() => resetMock.mockReset());

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

  it("reset stays gated until the exact phrase is typed, then runs the reset", () => {
    render(<GeneralSection lang="en-US" settings={defaultSettings} onChange={vi.fn()} />);
    // Open the type-to-confirm dialog.
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "settingsResetButton") }));
    const confirm = screen.getByRole("button", {
      name: t("en-US", "settingsResetConfirmLabel"),
    }) as HTMLButtonElement;
    expect(confirm).toBeDisabled();

    // Wrong phrase keeps it disabled; the reset never fires.
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "reset" } });
    expect(confirm).toBeDisabled();

    // Exact phrase enables confirm and triggers the reset.
    fireEvent.change(input, { target: { value: "yes, reset everything" } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    expect(resetMock).toHaveBeenCalledTimes(1);
  });
});
