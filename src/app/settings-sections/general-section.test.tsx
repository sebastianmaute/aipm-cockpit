import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, test, vi } from "vitest";
import { GeneralSection } from "./general-section";
import { defaultSettings } from "../settings-types";
import { t } from "../i18n";
import type { ProjectMeta } from "../types";

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

// A validateProjectMeta-passing fixture: projectManager/customer/naceSection/
// products/deployment/profitCenter non-blank + at least one contact person and
// one regulatory entry, or the edit form's Save button never enables and the
// submit-reaches-onUpdateProject test cannot exercise the write path.
const META = {
  name: "Apollo",
  code: "APL",
  projectManager: "Ada Lovelace",
  keyStakeholdersInternal: [],
  keyStakeholdersExternal: [],
  customer: "Acme Corp",
  naceSection: "C",
  identityTypes: [],
  products: "Widgets",
  deployment: "Cloud",
  startDate: "2026-01-01",
  endDate: "2026-12-31",
  profitCenter: "PC-1",
  contactPersons: [{ name: "Jane Doe", email: "jane@example.com", synced: false }],
  regulatory: ["Not applicable"],
  operatingTimezone: "Europe/Berlin",
} as unknown as ProjectMeta;

describe("GeneralSection project block", () => {
  test("shows the current project's summary", () => {
    render(
      <GeneralSection
        lang="en-US" settings={defaultSettings} onChange={vi.fn()}
        project={META} stakeholderNames={[]} addressBook={[]} resources={[]}
        onUpdateProject={vi.fn()}
      />,
    );
    expect(screen.getByText("Apollo")).toBeInTheDocument();
    expect(screen.getByText("APL")).toBeInTheDocument();
    expect(screen.getByText("Europe/Berlin")).toBeInTheDocument();
  });

  test("the edit button opens the project modal and a submit reaches onUpdateProject", async () => {
    // Headline claim FIRST: the WRITE direction. A render-only assertion would
    // stay green with the whole save path removed.
    const user = userEvent.setup();
    const onUpdateProject = vi.fn();
    render(
      <GeneralSection
        lang="en-US" settings={defaultSettings} onChange={vi.fn()}
        project={META} stakeholderNames={[]} addressBook={[]} resources={[]}
        onUpdateProject={onUpdateProject}
      />,
    );
    await user.click(screen.getByRole("button", { name: /edit project/i }));
    const submits = screen.getAllByRole("button", { name: /edit project/i });
    await user.click(submits[submits.length - 1]);
    expect(onUpdateProject).toHaveBeenCalledTimes(1);
    expect(onUpdateProject.mock.calls[0][0]).toMatchObject({ name: "Apollo" });
  });

  test("without a project the block renders a placeholder and no edit button", () => {
    render(<GeneralSection lang="en-US" settings={defaultSettings} onChange={vi.fn()} />);
    expect(screen.getByText("No project is open.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /edit project/i })).not.toBeInTheDocument();
  });

  test("without onUpdateProject (popout) the summary shows but editing is unavailable", () => {
    render(<GeneralSection lang="en-US" settings={defaultSettings} onChange={vi.fn()} project={META} />);
    expect(screen.getByText("Apollo")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /edit project/i })).not.toBeInTheDocument();
  });
});
