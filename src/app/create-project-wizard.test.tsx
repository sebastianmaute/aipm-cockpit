import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CreateProjectWizard } from "./create-project-wizard";
import { type Contact } from "./contacts";
import { type ProjectMeta } from "./types";
import { type NewProjectOpts } from "./new-project-workspace";
import { defaultSettings } from "./settings-types";
import { SETTINGS_KEY } from "./use-settings";
import { loadI18n, t } from "./i18n";

const generateMock = vi.fn();
vi.mock("./use-project-proposal", () => ({
  useProjectProposal: () => ({
    generate: generateMock,
    busy: false,
    error: null,
    reset: vi.fn(),
  }),
}));

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
      settings={defaultSettings}
      onChangeSettings={vi.fn()}
      onCreate={onCreate}
      onCancel={onCancel}
      {...overrides}
    />,
  );
  return { onCreate, onCancel };
}

/** Overrides for the complexity-driving Step-1 fields so a test can steer the
 *  resulting suggestTemplate tier (sparse → Minimal, heavy → Full delivery). */
interface Step1Overrides {
  /** Number-of-stakeholders value (drives the team-size complexity signal).
   *  Defaults to 2 (the prior Alice + Ext baseline = no team points). */
  stakeholderCount?: number;
  deployment?: "Cloud" | "On-premise" | "Hybrid";
  /** Regulatory checkbox label to tick (default GDPR). "Not applicable" =
   *  unregulated. */
  regulatoryLabel?: string;
  startDate?: string;
  endDate?: string;
}

/** Fill every required project field so Step 1's form becomes valid. */
function fillRequired(overrides: Step1Overrides = {}) {
  function setText(label: string, value: string) {
    fireEvent.change(screen.getByLabelText(label, { exact: false }), {
      target: { value },
    });
  }
  setText("Project name", "WizardProj");
  setText("Project code", "WZ-1");
  setText("Project manager", "Dana PM");
  setText("Number of stakeholders", String(overrides.stakeholderCount ?? 2));
  setText("Customer", "ACME Corp");
  fireEvent.change(screen.getByLabelText("NACE section", { exact: false }), {
    target: { value: "C" },
  });
  setText("Products", "Widget");
  fireEvent.change(screen.getByLabelText("Deployment", { exact: false }), {
    target: { value: overrides.deployment ?? "Cloud" },
  });
  setText("Start date", overrides.startDate ?? "2026-01-01");
  setText("End date", overrides.endDate ?? "2026-06-01");
  setText("Profit center", "PC-9");
  fireEvent.click(
    screen.getByLabelText(
      overrides.regulatoryLabel ?? "GDPR / data protection regulation",
    ),
  );
  // Contacts are now mandatory (≥1): add one manual contact.
  fireEvent.change(screen.getByPlaceholderText("Add manually"), {
    target: { value: "Pat Contact" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
}

/** Step 1 → submit the project details form (advances to Step 2). */
function completeStep1(overrides: Step1Overrides = {}) {
  fillRequired(overrides);
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
}

describe("CreateProjectWizard", () => {
  beforeEach(() => {
    window.localStorage.removeItem(SETTINGS_KEY);
  });

  it("does not own a reset-size button (resize lives on the modal panel)", () => {
    setup();
    expect(
      screen.queryByRole("button", { name: "Reset back to the default size." }),
    ).toBeNull();
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

  it("Step 1 storage step shows the Turso recommendation note", () => {
    setup();
    expect(screen.getByText(/Turso recommended/i)).toBeInTheDocument();
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

  it("Back from Step 2 preserves the Step-1 details", () => {
    setup();

    completeStep1();
    // On Step 2 now — go Back to Step 1.
    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    // The previously-entered project name is still in the field.
    const nameInput = screen.getByLabelText("Project name", {
      exact: false,
    }) as HTMLInputElement;
    expect(nameInput.value).toBe("WizardProj");
    const codeInput = screen.getByLabelText("Project code", {
      exact: false,
    }) as HTMLInputElement;
    expect(codeInput.value).toBe("WZ-1");
  });

  it("Cancel on Step 2 calls onCancel", () => {
    const { onCancel } = setup();

    completeStep1();
    // On Step 2 — both Back and Cancel are present in the nav row.
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("Step 2 preselects + badges the suggested template (high complexity → Full delivery)", () => {
    setup();

    // HIGH-complexity meta: 8 internal stakeholders (team ≥ 8 → +2), Hybrid
    // deployment (+2), DORA regulatory (+1), >12-month timeline (+2) → score 7
    // → advanced tier → builtin-full "Full delivery".
    completeStep1({
      stakeholderCount: 9,
      deployment: "Hybrid",
      regulatoryLabel: "DORA",
      startDate: "2026-01-01",
      endDate: "2027-06-01",
    });

    // On Step 2: the suggested "Full delivery" row is preselected and badged.
    const fullRow = screen.getByRole("button", { name: /Full delivery/ });
    expect(fullRow).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByText(t("en-US", "templateSuggested")),
    ).toBeInTheDocument();
  });

  it("sparse meta suggests + preselects Minimal", () => {
    setup();

    // Minimal valid meta: just the required stakeholders (team 3 → +1), Cloud,
    // unregulated ("Not applicable"), and a short (~1 month) timeline → score 1
    // → simple tier → builtin-minimal "Minimal".
    completeStep1({
      deployment: "Cloud",
      regulatoryLabel: "Not applicable",
      startDate: "2026-01-01",
      endDate: "2026-02-01",
    });

    expect(
      screen.getByRole("button", { name: /Minimal/ }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("manual pick of Blank overrides the suggestion and sticks", () => {
    setup();

    // Reach Step 2 with something preselected (default meta → Standard PM).
    completeStep1();
    expect(
      screen.getByRole("button", { name: /Standard PM/ }),
    ).toHaveAttribute("aria-pressed", "true");

    // Pick Blank — it wins over the suggestion.
    fireEvent.click(
      screen.getByRole("button", { name: /choose functions yourself/i }),
    );
    const blank = screen.getByRole("button", {
      name: /choose functions yourself/i,
    });
    expect(blank).toHaveAttribute("aria-pressed", "true");

    // Navigate Next → Back; the manual Blank choice is NOT re-overwritten by the
    // suggestion (preselect runs once, only while untouched).
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(
      screen.getByRole("button", { name: /choose functions yourself/i }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  // The DE dictionary is lazy — load it BEFORE asserting German output, or the
  // assertion silently reads English and passes for nothing.
  it("translates the Step 3 preset buttons' accessible names under German", async () => {
    await loadI18n("de");
    setup({ lang: "de" });

    // Step 1, all labels/placeholders/buttons in German; the NACE code, date
    // values and the regulatory-framework checkbox label are data, not UI
    // copy, so they stay as in the English flow.
    function setText(label: string, value: string) {
      fireEvent.change(screen.getByLabelText(label, { exact: false }), {
        target: { value },
      });
    }
    setText(t("de", "projectName"), "WizardProj");
    setText(t("de", "projectCode"), "WZ-1");
    setText(t("de", "projectManager"), "Dana PM");
    setText(t("de", "projectStakeholderCount"), "2");
    setText(t("de", "projectCustomer"), "ACME Corp");
    fireEvent.change(screen.getByLabelText(t("de", "projectNaceSection"), { exact: false }), {
      target: { value: "C" },
    });
    setText(t("de", "projectProducts"), "Widget");
    fireEvent.change(screen.getByLabelText(t("de", "projectDeployment"), { exact: false }), {
      target: { value: "Cloud" },
    });
    setText(t("de", "projectStartDate"), "2026-01-01");
    setText(t("de", "projectEndDate"), "2026-06-01");
    setText(t("de", "projectProfitCenter"), "PC-9");
    fireEvent.click(screen.getByLabelText("GDPR / data protection regulation"));
    fireEvent.change(screen.getByPlaceholderText(t("de", "contactAddManual")), {
      target: { value: "Pat Contact" },
    });
    fireEvent.click(screen.getByRole("button", { name: t("de", "add") }));
    fireEvent.click(screen.getByRole("button", { name: t("de", "wizardNext") }));

    // Step 2 → Blank (choose functions yourself) → Step 3.
    fireEvent.click(screen.getByRole("button", { name: /Funktionen selbst/i }));
    fireEvent.click(screen.getByRole("button", { name: t("de", "wizardNext") }));

    // Step 3: both preset buttons carry the translated accessible name, and
    // the hardcoded English string is gone.
    expect(
      screen.getByRole("button", { name: t("de", "modeApplySimplePreset") }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: t("de", "modeApplyAdvancedPreset") }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Apply Simple preset" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Apply Advanced preset" }),
    ).not.toBeInTheDocument();
  });
});

describe("CreateProjectWizard AI Step 0", () => {
  beforeEach(() => {
    window.localStorage.removeItem(SETTINGS_KEY);
    generateMock.mockReset();
  });

  // Render with an API key configured so Step 0 (Describe) shows.
  function renderWithKey(
    overrides: Partial<React.ComponentProps<typeof CreateProjectWizard>> = {},
  ) {
    const settings = {
      ...defaultSettings,
      ai: { ...defaultSettings.ai, apiKey: "sk-test", enabled: true },
    };
    const onCreate = vi.fn<CreateFn>();
    const onCancel = vi.fn();
    render(
      <CreateProjectWizard
        lang="en-US"
        stakeholderNames={STAKEHOLDERS}
        addressBook={ADDRESS_BOOK}
        resources={[]}
        settings={settings}
        onChangeSettings={vi.fn()}
        onCreate={onCreate}
        onCancel={onCancel}
        {...overrides}
      />,
    );
    return { onCreate, onCancel };
  }

  it("starts on Step 0 (Describe) when an API key is configured", () => {
    renderWithKey();
    expect(
      screen.getByLabelText(t("en-US", "aiCreateDescribeLabel")),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: t("en-US", "aiCreateGenerate") }),
    ).toBeInTheDocument();
  });

  it("starts on Step 1 (Details) when no API key is configured", () => {
    setup();
    expect(
      screen.queryByLabelText(t("en-US", "aiCreateDescribeLabel")),
    ).not.toBeInTheDocument();
  });

  it("Generate populates the Details form and advances to Step 1", async () => {
    generateMock.mockResolvedValue({
      meta: { name: "Proposed Project" },
      features: [],
      seed: undefined,
    });
    renderWithKey();
    fireEvent.change(screen.getByLabelText(t("en-US", "aiCreateDescribeLabel")), {
      target: { value: "a crm project" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: t("en-US", "aiCreateGenerate") }),
    );
    await waitFor(() =>
      expect(screen.getByDisplayValue("Proposed Project")).toBeInTheDocument(),
    );
  });

  it("Skip jumps straight to the Details form", () => {
    renderWithKey();
    fireEvent.click(
      screen.getByRole("button", { name: t("en-US", "aiCreateSkip") }),
    );
    expect(
      screen.queryByLabelText(t("en-US", "aiCreateDescribeLabel")),
    ).not.toBeInTheDocument();
  });

  it("ingests an uploaded file and runs the proposal with content blocks", async () => {
    generateMock.mockResolvedValue({
      meta: { name: "From File Project" },
      features: [],
      seed: undefined,
    });
    renderWithKey();

    // Switch the import method to "file".
    fireEvent.click(
      screen.getByRole("button", { name: t("en-US", "wizardImportMethodFile") }),
    );

    // Fire a change on the file input with a small text file.
    const input = screen.getByLabelText(
      t("en-US", "wizardImportFileLabel"),
    ) as HTMLInputElement;
    const file = new File(["hi"], "brief.txt", { type: "text/plain" });
    fireEvent.change(input, { target: { files: [file] } });

    // The FileReader read is async — wait for generate to be called.
    await waitFor(() => expect(generateMock).toHaveBeenCalledTimes(1));
    const arg = generateMock.mock.calls[0][0];
    expect(Array.isArray(arg)).toBe(true);
    const last = arg[arg.length - 1];
    // Text attachment → a document block with a text source.
    expect(last.type).toBe("document");
    expect(last.source.type).toBe("text");
    expect(last.source.data).toBe("hi");
  });

  it("hides SharePoint without M365 and Confluence without Jira config", () => {
    // defaultSettings: M365 disabled + no jira creds.
    renderWithKey();
    expect(
      screen.queryByRole("button", {
        name: t("en-US", "wizardImportMethodSharePoint"),
      }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", {
        name: t("en-US", "wizardImportMethodConfluence"),
      }),
    ).toBeNull();
  });
});
