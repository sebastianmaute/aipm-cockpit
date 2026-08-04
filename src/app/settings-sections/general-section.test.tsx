import { render, screen, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GeneralSection } from "./general-section";
import { defaultSettings } from "../settings-types";
import type { Resource } from "../types";
import { t } from "../i18n";

const resetMock = vi.fn();
vi.mock("../app-reset", () => ({
  resetAppToCleanSlate: () => resetMock(),
}));

afterEach(() => resetMock.mockReset());

describe("GeneralSection", () => {
  it("no longer renders the project block or its edit button", () => {
    // GeneralSectionProps dropped project/stakeholderNames/addressBook/
    // onUpdateProject entirely, so there is no longer any way to even ask
    // this component to render a project. (`resources` came BACK later, for
    // the "I am this resource" picker below — it feeds that select and
    // nothing else, so it cannot revive the project block.) The base render
    // below is sufficient to prove that: the old heading rendered UNCONDITIONALLY
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

const SELF_RESOURCES = [
  { id: 5, firstName: "Alice", lastName: "Smith" },
] as unknown as Resource[];

describe("GeneralSection 'I am' resource", () => {
  it("renders a labeled directory select defaulting to 'Not set'", () => {
    render(
      <GeneralSection
        lang="en-US"
        settings={defaultSettings}
        onChange={vi.fn()}
        resources={SELF_RESOURCES}
      />,
    );
    expect(screen.getByLabelText(t("en-US", "selfResourceLabel"))).toHaveValue("");
    expect(screen.getByRole("option", { name: "Alice Smith" })).toBeInTheDocument();
  });

  it("writes settings.selfResourceId when a resource is picked", () => {
    const onChange = vi.fn();
    render(
      <GeneralSection
        lang="en-US"
        settings={defaultSettings}
        onChange={onChange}
        resources={SELF_RESOURCES}
      />,
    );
    fireEvent.change(screen.getByLabelText(t("en-US", "selfResourceLabel")), {
      target: { value: "5" },
    });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ selfResourceId: 5 }));
  });

  it("picking 'Not set' CLEARS the id rather than storing 0", () => {
    // The "" → undefined mapping is load-bearing: a bare Number("") is 0, which
    // would claim the user is resource #0 instead of clearing the setting.
    const onChange = vi.fn();
    render(
      <GeneralSection
        lang="en-US"
        settings={{ ...defaultSettings, selfResourceId: 5 }}
        onChange={onChange}
        resources={SELF_RESOURCES}
      />,
    );
    fireEvent.change(screen.getByLabelText(t("en-US", "selfResourceLabel")), {
      target: { value: "" },
    });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ selfResourceId: undefined }),
    );
  });

  it("reflects a stored selfResourceId", () => {
    render(
      <GeneralSection
        lang="en-US"
        settings={{ ...defaultSettings, selfResourceId: 5 }}
        onChange={vi.fn()}
        resources={SELF_RESOURCES}
      />,
    );
    expect(screen.getByLabelText(t("en-US", "selfResourceLabel"))).toHaveValue("5");
  });
});
