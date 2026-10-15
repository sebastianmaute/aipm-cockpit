import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { ProjectEditModal, ProjectModalShell } from "./project-edit-modal";
import { t } from "./i18n";
import { ALL_MODULE_IDS, FEATURE_MODULES, type FeatureModuleId } from "./feature-modules";
import type { ProjectMeta } from "./types";

const META = {
  name: "Apollo",
  code: "APL",
  projectManager: "Jane PM",
  keyStakeholdersInternal: [],
  keyStakeholdersExternal: [],
  customer: "Acme Corp",
  naceSection: "J",
  identityTypes: [],
  products: "Widgets",
  deployment: "Cloud",
  startDate: "2026-01-01",
  endDate: "2026-12-31",
  profitCenter: "PC-1",
  contactPersons: [{ name: "Jane PM", email: "jane@example.com", synced: false }],
  regulatory: ["Not applicable"],
} as unknown as ProjectMeta;

describe("ProjectModalShell", () => {
  test("renders its title and children inside a resizable modal panel", () => {
    render(
      <ProjectModalShell lang="en-US" title="Shell title" sizeKey="test:pm" onClose={vi.fn()}>
        <p>shell body</p>
      </ProjectModalShell>,
    );
    expect(screen.getByText("shell body")).toBeInTheDocument();
    const panel = document.querySelector("[data-modal-panel]") as HTMLElement;
    expect(panel.className).toContain("resize");
    expect(panel.className).toContain("min-h-[420px]");
  });
});

describe("ProjectEditModal", () => {
  test("prefills from the given meta and submits a sanitized meta", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <ProjectEditModal
        lang="en-US"
        initial={META}
        stakeholderNames={[]}
        addressBook={[]}
        resources={[]}
        features={[]}
        sizeKey="test:pem"
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByDisplayValue("Apollo")).toBeInTheDocument();
    // Headline claim: the WRITE direction reaches the caller.
    // ★★ EXACT name: the submit reads "Save" (`projectEditSave`), and an RTL string `name` is a
    // whole-string match, so no other button containing "Save" can be selected by accident.
    // Composing it from the i18n key keeps a DE run resolving.
    await user.click(screen.getByRole("button", { name: t("en-US", "projectEditSave") }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ name: "Apollo", code: "APL" });
  });

  // --- §706: the Functions part -------------------------------------------------
  const FEATURES: FeatureModuleId[] = ["dashboard", "gantt"];
  const labelOf = (id: FeatureModuleId) =>
    t("en-US", FEATURE_MODULES.find((m) => m.id === id)!.labelKey);

  function renderEdit(extra: Partial<React.ComponentProps<typeof ProjectEditModal>> = {}) {
    const onSubmit = vi.fn();
    const onCancel = vi.fn();
    render(
      <ProjectEditModal
        lang="en-US"
        initial={META}
        stakeholderNames={[]}
        addressBook={[]}
        resources={[]}
        features={FEATURES}
        sizeKey="test:pem"
        onSubmit={onSubmit}
        onCancel={onCancel}
        {...extra}
      />,
    );
    return { onSubmit, onCancel };
  }
  const saveButton = () => screen.getByRole("button", { name: t("en-US", "projectEditSave") });

  test("toggling a function then Save submits the meta and the new set", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderEdit();
    await user.click(screen.getByRole("checkbox", { name: labelOf("milestones") }));
    await user.click(saveButton());
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ name: "Apollo" });
    const next = onSubmit.mock.calls[0][1] as FeatureModuleId[];
    expect(new Set(next)).toEqual(new Set<FeatureModuleId>([...FEATURES, "milestones"]));
    expect(next.length).toBe(FEATURES.length + 1);
  });

  test("Save without touching the functions submits null for them", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderEdit();
    await user.click(saveButton());
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][1]).toBeNull();
  });

  test("a function toggled on and off again compares equal as a set, so Save submits null", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderEdit();
    const box = screen.getByRole("checkbox", { name: labelOf("milestones") });
    await user.click(box);
    await user.click(box);
    await user.click(saveButton());
    expect(onSubmit.mock.calls[0][1]).toBeNull();
  });

  test("a different order of the same functions still counts as unchanged", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderEdit({ features: ["gantt", "dashboard"] });
    await user.click(saveButton());
    expect(onSubmit.mock.calls[0][1]).toBeNull();
  });

  test("toggling a function then Cancel calls onCancel and never onSubmit", async () => {
    const user = userEvent.setup();
    const { onSubmit, onCancel } = renderEdit();
    await user.click(screen.getByRole("checkbox", { name: labelOf("milestones") }));
    await user.click(screen.getByRole("button", { name: t("en-US", "cancel") }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test("the Functions part is a labelled section headed 'Functions', below the form fields", () => {
    renderEdit();
    const section = screen.getByRole("region", { name: t("en-US", "editProjectFunctionsHeading") });
    expect(section).toContainElement(screen.getByRole("checkbox", { name: labelOf("gantt") }));
    expect(screen.getByRole("checkbox", { name: labelOf("gantt") })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: labelOf("milestones") })).not.toBeChecked();
    const nameInput = screen.getByDisplayValue("Apollo");
    expect(nameInput.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  test("focusFunctions moves focus to the Functions heading after mount", async () => {
    renderEdit({ focusFunctions: true });
    const heading = screen.getByRole("heading", { name: t("en-US", "editProjectFunctionsHeading") });
    expect(heading).toHaveAttribute("tabindex", "-1");
    // The Modal runs its own initial focus in a frame; the heading must still win it.
    await waitFor(() => expect(heading).toHaveFocus());
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    expect(heading).toHaveFocus();
  });

  test("without focusFunctions focus does not land on the Functions heading", async () => {
    renderEdit();
    const heading = screen.getByRole("heading", { name: t("en-US", "editProjectFunctionsHeading") });
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    expect(heading).not.toHaveFocus();
  });

  test("the draft is seeded from the features prop (every module can be on)", () => {
    renderEdit({ features: ALL_MODULE_IDS });
    for (const id of ALL_MODULE_IDS) {
      expect(screen.getByRole("checkbox", { name: labelOf(id) })).toBeChecked();
    }
  });

  // --- §502: the Monte Carlo switch ----------------------------------------------
  const simSwitch = () => screen.getByRole("button", { name: new RegExp(t("en-US", "simulationShow")) });

  test("without a simulation prop there is no Forecasting section (held back, or a popout)", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderEdit();
    expect(screen.queryByRole("group", { name: t("en-US", "editProjectForecastHeading") })).toBeNull();
    expect(screen.queryByRole("button", { name: new RegExp(t("en-US", "simulationShow")) })).toBeNull();
    await user.click(saveButton());
    expect(onSubmit.mock.calls[0][2]).toBeNull();
  });

  test("the switch is a Forecasting field directly after Project manager, seeded from the stored value", () => {
    renderEdit({ simulation: true });
    const field = screen.getByRole("group", { name: t("en-US", "editProjectForecastHeading") });
    expect(field).toContainElement(simSwitch());
    expect(simSwitch()).toHaveAttribute("aria-pressed", "true");
    // The grid cell beside Project manager: the PM field's wrapper is the field's previous sibling.
    const pm = screen.getByRole("textbox", { name: new RegExp(`^${t("en-US", "projectManager")}`) });
    expect(field.previousElementSibling).toContainElement(pm);
    // The toggle keeps its own name; a <label> caption would have replaced it.
    expect(simSwitch()).toHaveAccessibleName(new RegExp(`^${t("en-US", "simulationShow")}`));
  });

  test("toggling the switch then Save submits the new value", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderEdit({ simulation: false });
    await user.click(simSwitch());
    expect(simSwitch()).toHaveAttribute("aria-pressed", "true");
    await user.click(saveButton());
    expect(onSubmit.mock.calls[0][2]).toBe(true);
  });

  test("Save with the switch untouched, or toggled back, submits null for it", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderEdit({ simulation: true });
    await user.click(simSwitch());
    await user.click(simSwitch());
    await user.click(saveButton());
    expect(onSubmit.mock.calls[0][2]).toBeNull();
  });

  test("toggling the switch then Cancel submits nothing", async () => {
    const user = userEvent.setup();
    const { onSubmit, onCancel } = renderEdit({ simulation: false });
    await user.click(simSwitch());
    await user.click(screen.getByRole("button", { name: t("en-US", "cancel") }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
