import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CreateProjectWizard } from "./create-project-wizard";
import { type Contact } from "./contacts";
import { type ProjectMeta } from "./types";
import { type NewProjectOpts } from "./new-project-workspace";
import { SETTINGS_KEY } from "./use-settings";

const STAKEHOLDERS = ["Alice Smith", "Bob Jones"];
const ADDRESS_BOOK: Contact[] = [
  { name: "Carol White", email: "carol@example.com" },
];

type CreateFn = (
  meta: ProjectMeta,
  format: "json" | "csv" | "md",
  opts: NewProjectOpts,
) => void;

function setup(
  overrides: Partial<React.ComponentProps<typeof CreateProjectWizard>> = {},
) {
  const onCreate = vi.fn<CreateFn>();
  const onCancel = vi.fn();
  render(
    <CreateProjectWizard
      lang="en-US"
      stakeholderNames={STAKEHOLDERS}
      addressBook={ADDRESS_BOOK}
      resources={[]}
      onCreate={onCreate}
      onCancel={onCancel}
      {...overrides}
    />,
  );
  return { onCreate, onCancel };
}

/** Fill every required project field so Step 1's form becomes valid. */
function fillRequired() {
  function setText(label: string, value: string) {
    fireEvent.change(screen.getByLabelText(label, { exact: false }), {
      target: { value },
    });
  }
  function addStakeholder(inputId: string, name: string) {
    const input = document.getElementById(inputId) as HTMLInputElement;
    fireEvent.change(input, { target: { value: name } });
    fireEvent.keyDown(input, { key: "Enter" });
  }
  setText("Project name", "WizardProj");
  setText("Project code", "WZ-1");
  setText("Project manager", "Dana PM");
  addStakeholder("keyStakeholdersInternal", "Alice Smith");
  addStakeholder("keyStakeholdersExternal", "Ext Person");
  setText("Customer", "ACME Corp");
  fireEvent.change(screen.getByLabelText("NACE section", { exact: false }), {
    target: { value: "C" },
  });
  setText("Products", "Widget");
  fireEvent.change(screen.getByLabelText("Deployment", { exact: false }), {
    target: { value: "Cloud" },
  });
  setText("Start date", "2026-01-01");
  setText("End date", "2026-06-01");
  setText("Profit center", "PC-9");
  fireEvent.click(screen.getByLabelText("GDPR / data protection regulation"));
}

/** Step 1 → submit the project details form (advances to Step 2). */
function completeStep1() {
  fillRequired();
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
}

describe("CreateProjectWizard", () => {
  beforeEach(() => {
    window.localStorage.removeItem(SETTINGS_KEY);
  });

  it("starts on Step 1 (Details) showing the project form", () => {
    setup();
    expect(
      screen.getByLabelText("Project name", { exact: false }),
    ).toBeInTheDocument();
    // Template/Functions steps are not reachable yet.
    expect(
      screen.queryByRole("button", { name: "Standard PM" }),
    ).toBeNull();
  });

  it("selecting a template pre-fills its features on Step 3, and Create reports the tweaked opts", () => {
    const { onCreate } = setup();

    // Step 1 → Step 2.
    completeStep1();

    // Step 2: select the built-in "Standard PM" template (features:
    // dashboard, gantt, milestones, raid, changes — NOT trends).
    fireEvent.click(screen.getByRole("button", { name: /Standard PM/ }));

    // Advance to Step 3.
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    // Step 3: the Dashboard module is pre-checked, Trends is not.
    const dashboard = screen.getByRole("checkbox", {
      name: "Dashboard",
    }) as HTMLInputElement;
    const trends = screen.getByRole("checkbox", {
      name: "Trends",
    }) as HTMLInputElement;
    expect(dashboard.checked).toBe(true);
    expect(trends.checked).toBe(false);

    // Toggle Trends on (tweak the set).
    fireEvent.click(trends);
    expect(trends.checked).toBe(true);

    // Create.
    fireEvent.click(screen.getByRole("button", { name: "Create project" }));

    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({ name: "WizardProj" }),
      expect.any(String),
      expect.objectContaining({ features: expect.any(Array) }),
    );
    const [, , opts] = onCreate.mock.calls[0];
    expect(opts.template?.id).toBe("builtin-standard");
    // tweaked set now includes trends in addition to the template's features.
    expect(opts.features).toContain("trends");
    expect(opts.features).toContain("dashboard");
    // Standard PM has a seed; the include-content toggle defaults on.
    expect(opts.includeSeed).toBe(true);
  });

  it("Blank template enables all modules and creates with no template", () => {
    const { onCreate } = setup();

    completeStep1();

    // Step 2: choose Blank.
    fireEvent.click(
      screen.getByRole("button", { name: /choose functions yourself/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    // Step 3: Blank starts with every module enabled.
    const trends = screen.getByRole("checkbox", {
      name: "Trends",
    }) as HTMLInputElement;
    expect(trends.checked).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "Create project" }));

    expect(onCreate).toHaveBeenCalledTimes(1);
    const [, , opts] = onCreate.mock.calls[0];
    expect(opts.template).toBeUndefined();
    expect(opts.includeSeed).toBe(false);
    expect(opts.features).toContain("trends");
  });

  it("Back returns from Step 2 to Step 1; Cancel on Step 1 calls onCancel", () => {
    const { onCancel } = setup();

    completeStep1();
    // On Step 2 now.
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    // Back on Step 1 — the form is visible again.
    expect(
      screen.getByLabelText("Project name", { exact: false }),
    ).toBeInTheDocument();

    // Step 1's Cancel.
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
