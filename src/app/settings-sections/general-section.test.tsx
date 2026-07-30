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
  it("no longer renders the project block or its edit button", () => {
    // GeneralSectionProps dropped project/stakeholderNames/addressBook/
    // resources/onUpdateProject entirely, so there is no longer any way to
    // even ask this component to render a project. The base render below is
    // sufficient to prove that: the old heading rendered UNCONDITIONALLY
    // (not gated on a project prop), so it — and the edit button, which can
    // no longer be reached via any prop combination — are both provably gone.
    render(<GeneralSection lang="en-US" settings={defaultSettings} onChange={vi.fn()} />);
    // "Project" is a literal, not a t() lookup: the heading's own key
    // (settingsProjectHeading) is deleted below as orphaned once this is the
    // only surface that ever rendered it.
    expect(screen.queryByText("Project")).toBeNull();
    expect(screen.queryByRole("button", { name: t("en-US", "projectsEdit") })).toBeNull();
  });

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
