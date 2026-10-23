import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CreateProjectWizard } from "./create-project-wizard";
import { type Contact } from "./contacts";
import { type ProjectMeta } from "./types";
import { type NewProjectOpts } from "./new-project-workspace";
import { defaultSettings } from "./settings-types";
import { SETTINGS_KEY } from "./use-settings";
import { loadI18n, t } from "./i18n";
import { BUILT_IN_TEMPLATES } from "./templates-builtin";
import { expectRowUniqueNames } from "../test/row-unique-names";
import { expectButtonOrder } from "../test/toolbar-order";

const sampleText = readFileSync(
  join(import.meta.dirname, "..", "..", "sample-workspace-small.json"),
  "utf8",
);

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
    fireEvent.change(screen.getByLabelText(label, { exact: false, selector: "input, select, textarea" }), {
      target: { value },
    });
  }
  setText("Project name", "WizardProj");
  setText("Project code", "WZ-1");
  setText("Project manager", "Dana PM");
  setText("Number of stakeholders", String(overrides.stakeholderCount ?? 2));
  setText("Customer", "ACME Corp");
  fireEvent.change(screen.getByLabelText("NACE section", { exact: false, selector: "input, select, textarea" }), {
    target: { value: "C" },
  });
  setText("Products", "Widget");
  fireEvent.change(screen.getByLabelText("Deployment", { exact: false, selector: "input, select, textarea" }), {
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
      screen.getByLabelText("Project name", { exact: false, selector: "input, select, textarea" }),
    ).toBeInTheDocument();
    // Template/Functions steps are not reachable yet.
    expect(
      screen.queryByRole("button", { name: "Standard PM" }),
    ).toBeNull();
  });

  // §523 — with AI off the Describe step never shows, so step 1 says how to
  // reach it instead of leaving AI-assisted creation undiscoverable.
  it("tells a user without AI how to create from a file or description", () => {
    setup();
    expect(screen.getByText(t("en-US", "wizardAiOffHint"))).toBeInTheDocument();
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

  it("choosing GBP in the currency select passes currency GBP and a creation clock to onCreate", () => {
    const { onCreate } = setup();
    fillRequired({});
    fireEvent.change(screen.getByLabelText(t("en-US", "baselineCurrencyLabel")), { target: { value: "GBP" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Create project" }));
    const [, , opts] = onCreate.mock.calls[0];
    expect(opts.baseline?.currency).toBe("GBP");
    expect(opts.baseline?.nowIso).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
  });

  // §476 B10 — the currency is a field of step 1's form, laid out like its sibling storage
  // field, not a row under the footer (where it sat below the Next button).
  it("renders the currency select inside the form's field layout, before the footer", () => {
    setup();
    const currency = screen.getByLabelText(t("en-US", "baselineCurrencyLabel"));
    const storage = screen.getByLabelText(t("en-US", "projectStorage"));
    const next = screen.getByRole("button", { name: "Next" });
    expect(currency.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(currency.closest("label")?.className).toBe(storage.closest("label")?.className);
  });

  it("defaults the currency select to EUR", () => {
    setup();
    expect((screen.getByLabelText(t("en-US", "baselineCurrencyLabel")) as HTMLSelectElement).value).toBe("EUR");
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

  // §707 — Step 3 shows what Time bookings uses and Turn on writes into the WIZARD's own
  // selection (not a stored setting), which Create then reports.
  it("Step 3 offers Turn on for a missing module and Create reports the updated selection", () => {
    const { onCreate } = setup();
    completeStep1();
    fireEvent.click(screen.getByRole("button", { name: /choose functions yourself/i }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    // Blank starts with every module on; take Budget off while Time bookings stays on.
    const budget = screen.getByRole("checkbox", { name: "Budget" }) as HTMLInputElement;
    fireEvent.click(budget);
    expect(budget.checked).toBe(false);
    expect((screen.getByRole("checkbox", { name: "Time bookings" }) as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole("status")).toHaveTextContent("Budget is off.");

    fireEvent.click(screen.getByRole("button", { name: "Turn on Budget" }));
    expect(budget.checked).toBe(true);
    expect(screen.queryByRole("status")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Create project" }));
    const [, , opts] = onCreate.mock.calls[0];
    expect(opts.features).toContain("budget");
    expect(opts.features).toContain("timelog");
  });

  // open-followups §55 (WCAG 1.4.1). The selected template was signalled by a
  // green border + tint ALONE, which measured 1.53-1.88:1 against the
  // unselected border in all four LIGHT schemes. The marker is the non-colour
  // cue; it is rendered in BOTH states. Asserting only the ON state would pass
  // against a conditional-render regression, which is the failure the mechanism
  // exists to prevent — so both states are pinned here. The card's WIDTH
  // behaviour is a separate guarantee (these cards pass `reserveMarkerSpace`)
  // and is pinned by the next test, not this one.
  it("every template option carries the non-colour selected marker in both states", () => {
    setup();
    completeStep1();

    const markerOf = (name: RegExp) => {
      const btn = screen.getByRole("button", { name });
      const marker = btn.querySelector("[data-pressed-marker]");
      expect(marker).not.toBeNull();
      return marker?.getAttribute("data-pressed-marker");
    };
    const STANDARD = /Standard PM/;
    const BLANK = /choose functions yourself/i;

    fireEvent.click(screen.getByRole("button", { name: STANDARD }));
    expect(markerOf(STANDARD)).toBe("on");
    expect(markerOf(BLANK)).toBe("off");

    fireEvent.click(screen.getByRole("button", { name: BLANK }));
    expect(markerOf(BLANK)).toBe("on");
    expect(markerOf(STANDARD)).toBe("off");
  });

  // ★★★ THE TEMPLATE CARDS ARE A ONE-OF-N GROUP (`chooseTemplate` REPLACES the
  //    selection), so the marker must RESERVE its width. The animated default
  //    is justified by the marker TRAILING the label — growth lands on the
  //    right edge, so a lone toggle moves only its rightward neighbours, never
  //    the control under the pointer. A MUTUALLY-EXCLUSIVE GROUP breaks that:
  //    one click collapses the old selection and expands the new one.
  // ★★ THE REFLOW HERE IS INTERNAL, NOT BETWEEN CARDS, and that is worth
  //    stating because the obvious reading is wrong. `TEMPLATE_CARD_CLASS` is
  //    `w-full` inside a `flex flex-col` fieldset, so a card's own box never
  //    changes size and the cards do not move each other. What moves is INSIDE
  //    the card: `size="card"` stretches the label wrapper, so collapsing the
  //    marker widens that wrapper by ~20px — on the very card the pointer is
  //    over. On the TEMPLATE cards that also drags the header row's
  //    `justify-between` badges across; the Blank card carries no badge row.
  // ★★ ANTI-VACUITY: only the OFF state discriminates, and the count is pinned
  //    so a step that failed to advance (which renders NO cards at all — the
  //    Step-1 form has no `aria-pressed` control) cannot pass an empty loop.
  it("reserves the marker's width on every template card, so a pick cannot reflow the card", () => {
    setup();
    completeStep1();

    const cards = Array.from(document.querySelectorAll<HTMLButtonElement>("button[aria-pressed]"));
    // COUNT: the Blank card + the three built-in templates (Minimal ·
    // Standard PM · Full delivery).
    expect(cards).toHaveLength(4);

    // Pick one explicitly rather than trusting the suggestion's preselect, so
    // the OFF set below is three cards whichever template was suggested.
    fireEvent.click(screen.getByRole("button", { name: /Standard PM/ }));
    const off = cards.filter((c) => c.getAttribute("aria-pressed") === "false");
    expect(off).toHaveLength(3);
    for (const card of off) {
      const cls = card.querySelector("[data-pressed-marker]")?.getAttribute("class") ?? "";
      expect(cls).toContain("w-3.5");
      expect(cls).not.toContain("w-0");
      // Only the collapsing path carries it, to cancel the gap a zero-width
      // marker leaves — so its absence is the second discriminator.
      expect(cls).not.toContain("-ml-1.5");
    }
  });

  // §669 — a user template can reuse a built-in name. The card keeps its whole
  // content as its name, so the occurrence rides a screen-reader-only suffix.
  it("names a user template that reuses a built-in name apart from the built-in", async () => {
    const std = BUILT_IN_TEMPLATES.find((tp) => tp.name === "Standard PM")!;
    window.localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({ ...defaultSettings, templates: [{ ...std, id: "user-std", builtIn: false }] }),
    );
    setup();
    completeStep1();
    // Settings hydrate in an effect after i18n loads, which can outlast the 1s default.
    const second = await screen.findByRole("button", { name: /^Standard PM \(2\)/ }, { timeout: 5000 });
    const first = screen.getByRole("button", { name: /^Standard PM \(1\)/ });
    expect(first).not.toBe(second);
    // The suffix is not visible text.
    expect(second.querySelector(".sr-only")?.textContent).toBe("(2)");
    expectRowUniqueNames({ minControls: 5 });
  });

  it("Back returns from Step 2 to Step 1; Cancel on Step 1 calls onCancel", () => {
    const { onCancel } = setup();

    completeStep1();
    // On Step 2 now.
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    // Back on Step 1 — the form is visible again.
    expect(
      screen.getByLabelText("Project name", { exact: false, selector: "input, select, textarea" }),
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
      exact: false, selector: "input, select, textarea",
    }) as HTMLInputElement;
    expect(nameInput.value).toBe("WizardProj");
    const codeInput = screen.getByLabelText("Project code", {
      exact: false, selector: "input, select, textarea",
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
      fireEvent.change(screen.getByLabelText(label, { exact: false, selector: "input, select, textarea" }), {
        target: { value },
      });
    }
    setText(t("de", "projectName"), "WizardProj");
    setText(t("de", "projectCode"), "WZ-1");
    setText(t("de", "projectManager"), "Dana PM");
    setText(t("de", "projectStakeholderCount"), "2");
    setText(t("de", "projectCustomer"), "ACME Corp");
    fireEvent.change(screen.getByLabelText(t("de", "projectNaceSection"), { exact: false, selector: "input, select, textarea" }), {
      target: { value: "C" },
    });
    setText(t("de", "projectProducts"), "Widget");
    fireEvent.change(screen.getByLabelText(t("de", "projectDeployment"), { exact: false, selector: "input, select, textarea" }), {
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

  // Review finding: the prompt asks for future dates but nothing enforced it,
  // so a proposal that still ends in the past is flagged on the Details step.
  const PAST_END = "2020-01-31";
  // In range for sanitizeIsoDate (1900–2100), so it really reaches the form.
  const FUTURE_END = "2099-12-31";
  const pastWarning = () => t("en-US", "wizardAiEndDatePast", PAST_END);
  async function generateWithEnd(endDate: string) {
    generateMock.mockResolvedValue({ meta: { name: "Dated", endDate }, features: [], seed: undefined });
    fireEvent.change(screen.getByLabelText(t("en-US", "aiCreateDescribeLabel")), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "aiCreateGenerate") }));
    await waitFor(() => expect(screen.getByDisplayValue(endDate)).toBeInTheDocument());
  }
  function importWorkspace(text: string) {
    const picker = screen
      .getByRole("button", { name: t("en-US", "wizardImportWorkspaceButton") })
      .parentElement!.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(picker, { target: { files: [new File([text], "sample.json", { type: "application/json" })] } });
  }

  it("warns when the proposed end date is in the past", async () => {
    renderWithKey();
    await generateWithEnd(PAST_END);
    expect(screen.getByText(pastWarning())).toBeInTheDocument();
  });

  it("does not warn when the proposed end date is in the future", async () => {
    renderWithKey();
    await generateWithEnd(FUTURE_END);
    expect(screen.queryByText(t("en-US", "wizardAiEndDatePast", FUTURE_END))).not.toBeInTheDocument();
  });

  it("drops the warning when a second proposal ends in the future", async () => {
    renderWithKey();
    await generateWithEnd(PAST_END);
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await generateWithEnd(FUTURE_END);
    expect(screen.queryByText(pastWarning())).not.toBeInTheDocument();
  });

  it("drops the warning when an imported workspace replaces the proposal's details", async () => {
    renderWithKey();
    await generateWithEnd(PAST_END);
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    importWorkspace(sampleText);
    await screen.findByText(/Importing sample\.json: \d+ tasks/);
    expect(screen.queryByDisplayValue(PAST_END)).toBeNull();
    expect(screen.queryByText(pastWarning())).not.toBeInTheDocument();
  });

  // An import with no project meta leaves the proposal's details in the form,
  // so dismissing that import must not leave the past date unflagged.
  it("keeps the warning when an imported workspace carries no project details", async () => {
    renderWithKey();
    await generateWithEnd(PAST_END);
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    const noProject = JSON.parse(sampleText) as Record<string, unknown>;
    delete noProject.project;
    importWorkspace(JSON.stringify(noProject));
    await screen.findByText(/Importing sample\.json: \d+ tasks/);
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "wizardImportWorkspaceClear", "sample.json") }));
    expect(screen.getByDisplayValue(PAST_END)).toBeInTheDocument();
    expect(screen.getByText(pastWarning())).toBeInTheDocument();
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

  // §523 — the AI-off hint is for users who CANNOT reach Describe; one who
  // skipped it has Back, so the hint would be noise on the same step 1.
  it("shows no AI-off hint on step 1 when AI is on", () => {
    renderWithKey();
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "aiCreateSkip") }));
    // Positive control: this IS step 1 (the project name field renders).
    expect(
      screen.getByLabelText("Project name", { exact: false, selector: "input, select, textarea" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(t("en-US", "wizardAiOffHint"))).toBeNull();
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
      screen.getByRole("radio", { name: t("en-US", "wizardImportMethodFile") }),
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

  // Final-review finding: import a workspace, go Back to Step 0 and accept an
  // AI proposal instead. `imported` used to survive that, so Next on Step 1
  // took the import shortcut and created from the OLD file — dropping the
  // proposal (and its seed) the user had just accepted.
  it("a new AI proposal after Back supersedes an earlier workspace import", async () => {
    generateMock.mockResolvedValue({ meta: { name: "Proposed Project" }, features: [], seed: undefined });
    const { onCreate } = renderWithKey();
    // The picker sits on Step 0 beside Skip; importing advances to Step 1 by itself.
    const picker = screen
      .getByRole("button", { name: t("en-US", "wizardImportWorkspaceButton") })
      .parentElement!.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(picker, {
      target: { files: [new File([sampleText], "sample.json", { type: "application/json" })] },
    });
    await screen.findByText(/Importing sample\.json: \d+ tasks/);
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.change(screen.getByLabelText(t("en-US", "aiCreateDescribeLabel")), {
      target: { value: "a crm project" },
    });
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "aiCreateGenerate") }));
    await waitFor(() => expect(screen.getByDisplayValue("Proposed Project")).toBeInTheDocument());
    expect(screen.queryByText(/Importing sample\.json/)).toBeNull();
    completeStep1();
    // The import shortcut would have called onCreate right here.
    expect(onCreate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Create project" }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    expect(onCreate.mock.calls[0][2].importedWorkspace).toBeUndefined();
  });

  // The workspace import sits on Step 0, directly right of Skip; Step 1 no longer repeats it.
  it("offers the workspace import beside Skip on Step 0, not on Step 1", () => {
    renderWithKey();
    expectButtonOrder(["aiCreateSkip", "wizardImportWorkspaceButton"], { contiguous: true });
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "aiCreateSkip") }));
    expect(screen.queryByRole("button", { name: t("en-US", "wizardImportWorkspaceButton") })).toBeNull();
  });

  it("importing a workspace from Step 0 advances to Step 1 with the import notice", async () => {
    renderWithKey();
    const picker = screen
      .getByRole("button", { name: t("en-US", "wizardImportWorkspaceButton") })
      .parentElement!.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(picker, {
      target: { files: [new File([sampleText], "sample.json", { type: "application/json" })] },
    });
    expect(await screen.findByText(/Importing sample\.json: \d+ tasks/)).toBeInTheDocument();
  });

  it("shows a Step-0 import error on Step 0 and clears it on Skip", async () => {
    renderWithKey();
    const picker = screen
      .getByRole("button", { name: t("en-US", "wizardImportWorkspaceButton") })
      .parentElement!.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(picker, { target: { files: [new File(["{ not json"], "bad.json", { type: "application/json" })] } });
    const msg = t("en-US", "wizardImportWorkspaceInvalid", "bad.json");
    expect(await screen.findByText(msg)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("en-US", "aiCreateSkip") })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "aiCreateSkip") }));
    expect(screen.queryByText(msg)).toBeNull();
  });

  // Final-review finding: a failed Generate is a new attempt too; its aiError must not sit beside a stale picker error.
  it("clears a Step-0 import error when a new Generate starts, even if it fails", async () => {
    generateMock.mockResolvedValue(null);
    renderWithKey();
    const picker = screen
      .getByRole("button", { name: t("en-US", "wizardImportWorkspaceButton") })
      .parentElement!.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(picker, { target: { files: [new File(["{ not json"], "bad.json", { type: "application/json" })] } });
    const msg = t("en-US", "wizardImportWorkspaceInvalid", "bad.json");
    const err = await screen.findByText(msg);
    // The error sits right above the footer that holds the picker, below the describe field, not at the top.
    const follows = (a: Node, b: Node) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    expect(follows(screen.getByLabelText(t("en-US", "aiCreateDescribeLabel")), err)).toBe(true);
    expect(follows(err, screen.getByRole("button", { name: t("en-US", "aiCreateSkip") }))).toBe(true);
    fireEvent.change(screen.getByLabelText(t("en-US", "aiCreateDescribeLabel")), {
      target: { value: "a crm project" },
    });
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "aiCreateGenerate") }));
    await waitFor(() => expect(generateMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByText(msg)).toBeNull());
    // Positive control: still Step 0 — the failed proposal did not advance.
    expect(screen.getByLabelText(t("en-US", "aiCreateDescribeLabel"))).toBeInTheDocument();
  });

  // Final-review finding: once details are captured, Step 1 hides Back to Describe, so it offers the picker itself.
  it("offers the workspace import on Step 1 once Back to Describe is gone", () => {
    renderWithKey();
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "aiCreateSkip") }));
    expect(screen.queryByRole("button", { name: t("en-US", "wizardImportWorkspaceButton") })).toBeNull();
    completeStep1();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.queryByRole("button", { name: t("en-US", "wizardBack") })).toBeNull();
    expect(screen.getByRole("button", { name: t("en-US", "wizardImportWorkspaceButton") })).toBeInTheDocument();
  });

  // Review finding: Generate also leaves Step 0, and the picker's error must not follow it.
  it("clears a Step-0 import error when Generate advances to Step 1", async () => {
    generateMock.mockResolvedValue({ meta: { name: "Proposed Project" }, features: [], seed: undefined });
    renderWithKey();
    const picker = screen
      .getByRole("button", { name: t("en-US", "wizardImportWorkspaceButton") })
      .parentElement!.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(picker, { target: { files: [new File(["{ not json"], "bad.json", { type: "application/json" })] } });
    const msg = t("en-US", "wizardImportWorkspaceInvalid", "bad.json");
    expect(await screen.findByText(msg)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(t("en-US", "aiCreateDescribeLabel")), {
      target: { value: "a crm project" },
    });
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "aiCreateGenerate") }));
    // Positive control: this IS Step 1, carrying the proposal.
    await waitFor(() => expect(screen.getByDisplayValue("Proposed Project")).toBeInTheDocument());
    expect(screen.queryByText(msg)).toBeNull();
  });

  it("hides SharePoint without M365 and Confluence without Jira config", () => {
    // defaultSettings: M365 disabled + no jira creds.
    renderWithKey();
    // §331 — the methods are radios now; the positive control keeps the two
    //  absence checks from passing because no element of that role exists.
    expect(screen.getByRole("radio", { name: t("en-US", "wizardImportMethodFile") })).toBeInTheDocument();
    expect(
      screen.queryByRole("radio", {
        name: t("en-US", "wizardImportMethodSharePoint"),
      }),
    ).toBeNull();
    expect(
      screen.queryByRole("radio", {
        name: t("en-US", "wizardImportMethodConfluence"),
      }),
    ).toBeNull();
  });
});

describe("CreateProjectWizard native workspace import (Step 1, key-free)", () => {
  beforeEach(() => {
    window.localStorage.removeItem(SETTINGS_KEY);
  });

  /** The Step-1 picker renders `<Button>` + a sibling hidden file input
   *  (FilePickerButton's DOM shape). */
  function workspacePickerInput() {
    return screen
      .getByRole("button", { name: t("en-US", "wizardImportWorkspaceButton") })
      .parentElement!.querySelector('input[type="file"]') as HTMLInputElement;
  }

  // Regression guard for the "picker AI-only" mutant: the workspace-import
  // control must be offered even when no Anthropic key is configured — it is
  // the key-free route, not an AI-fast-path extra.
  it("offers the workspace import without an API key", () => {
    setup();
    expect(
      screen.getByRole("button", { name: t("en-US", "wizardImportWorkspaceButton") }),
    ).toBeInTheDocument();
  });

  // §523 — the AI-off hint must not sit beside the key-free import's notice,
  // where it would read as if that file route needed AI.
  it("hides the AI-off hint while an imported workspace is pending", async () => {
    setup();
    expect(screen.getByText(t("en-US", "wizardAiOffHint"))).toBeInTheDocument();
    fireEvent.change(workspacePickerInput(), {
      target: { files: [new File([sampleText], "sample.json", { type: "application/json" })] },
    });
    expect(await screen.findByText(/Importing sample\.json: \d+ tasks/)).toBeInTheDocument();
    expect(screen.queryByText(t("en-US", "wizardAiOffHint"))).toBeNull();
  });

  it("imports a workspace file from Step 1 and creates the project with its content", async () => {
    const { onCreate } = setup();
    fireEvent.change(workspacePickerInput(), {
      target: { files: [new File([sampleText], "sample.json", { type: "application/json" })] },
    });
    expect(await screen.findByText(/Importing sample\.json: \d+ tasks/)).toBeInTheDocument();
    // The imported file's own project meta pre-fills Step 1 — not a blank form.
    expect(
      screen.getByLabelText("Project name", { exact: false, selector: "input, select, textarea" }),
    ).toHaveValue("Customer Identity Platform");
    // Submit Step 1 with its pre-filled name — the import must have replaced
    // the (previously blank) form draft, or Next stays disabled.
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledTimes(1));
    const opts = onCreate.mock.calls[0][2];
    expect(opts.importedWorkspace?.tasks.length).toBeGreaterThan(0);
  });

  it("rejects a JSON that is not a workspace, and creates nothing", async () => {
    const { onCreate } = setup();
    fireEvent.change(workspacePickerInput(), {
      target: { files: [new File(['{"a":1}'], "x.json", { type: "application/json" })] },
    });
    expect(await screen.findByText("x.json is not a workspace file.")).toBeInTheDocument();
    expect(onCreate).not.toHaveBeenCalled();
  });

  // Final-review finding: Step 1's picker read the file with no size gate and
  // no catch — a failed read was an unhandled rejection with no message.
  it("rejects an oversize workspace file without reading it", async () => {
    const { onCreate } = setup();
    const big = new File([sampleText], "huge.json", { type: "application/json" });
    Object.defineProperty(big, "size", { value: 21 * 1024 * 1024 });
    const text = vi.spyOn(big, "text");
    fireEvent.change(workspacePickerInput(), { target: { files: [big] } });
    expect(await screen.findByText(t("en-US", "wizardImportErrorTooLarge"))).toBeInTheDocument();
    expect(text).not.toHaveBeenCalled();
    expect(screen.queryByText(/Importing huge\.json/)).toBeNull();
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("reports a workspace file whose read fails", async () => {
    const { onCreate } = setup();
    const broken = new File([sampleText], "broken.json", { type: "application/json" });
    vi.spyOn(broken, "text").mockRejectedValue(new Error("NotReadableError"));
    fireEvent.change(workspacePickerInput(), { target: { files: [broken] } });
    expect(
      await screen.findByText("broken.json looks like a workspace file but could not be read."),
    ).toBeInTheDocument();
    expect(onCreate).not.toHaveBeenCalled();
  });

  // Review finding 1: acceptImport must clear any meta captured from a prior
  // manual Step-1 visit (the same guard runIngest already carries), or an
  // import that lands AFTER a Details → Next → Back round-trip is shadowed by
  // the stale meta — the notice says "Importing X" but the form (and the
  // eventual submit) still carries the OLD project's name.
  it("clears stale Step-1 meta on import, so Back-then-import shows the file's own project name", async () => {
    setup();
    // Submit Step 1 manually (captures `meta` with name "WizardProj") …
    completeStep1();
    // … then Back to Step 1: the manually-submitted meta is still in effect.
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(
      screen.getByLabelText("Project name", { exact: false, selector: "input, select, textarea" }),
    ).toHaveValue("WizardProj");
    // Now import — the file's OWN project name must win, not the stale meta.
    fireEvent.change(workspacePickerInput(), {
      target: { files: [new File([sampleText], "sample.json", { type: "application/json" })] },
    });
    await waitFor(() =>
      expect(
        screen.getByLabelText("Project name", { exact: false, selector: "input, select, textarea" }),
      ).toHaveValue("Customer Identity Platform"),
    );
  });

  // Controller ruling: the clear button must be a REAL control, not a no-op —
  // it drops `imported` so a subsequent Next takes the normal (Template/
  // Functions) path instead of the import shortcut.
  it("Clear import removes the notice, and a subsequent Next takes the normal (non-import) path", async () => {
    const { onCreate } = setup();
    fireEvent.change(workspacePickerInput(), {
      target: { files: [new File([sampleText], "sample.json", { type: "application/json" })] },
    });
    await screen.findByText(/Importing sample\.json: \d+ tasks/);
    fireEvent.click(
      screen.getByRole("button", { name: "Clear imported workspace sample.json" }),
    );
    expect(screen.queryByText(/Importing sample\.json: \d+ tasks/)).toBeNull();
    // The form draft is untouched by Clear (still valid from the import), so
    // Next is enabled — but `imported` is gone, so it goes to Step 2
    // (Template), never straight to onCreate.
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(onCreate).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /Standard PM/ })).toBeInTheDocument();
  });
});
