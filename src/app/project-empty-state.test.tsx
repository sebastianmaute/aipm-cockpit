import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { t } from "./i18n";
import { ProjectEmptyState } from "./project-empty-state";
import { type Contact } from "./contacts";
import { type ProjectMeta } from "./types";
import { type NewProjectOpts } from "./new-project-workspace";
import { defaultSettings } from "./settings-types";

const STAKEHOLDERS = ["Alice Smith", "Bob Jones"];
const ADDRESS_BOOK: Contact[] = [
  { name: "Carol White", email: "carol@example.com" },
];

function setup(overrides: Partial<React.ComponentProps<typeof ProjectEmptyState>> = {}) {
  const onCreate =
    vi.fn<(meta: ProjectMeta, format: "json" | "csv" | "md", opts?: NewProjectOpts) => void>();
  const onLoadFromFile = vi.fn();
  const onRestore = vi.fn();
  const onDeleteArchived = vi.fn();
  render(
    <ProjectEmptyState
      lang="en-US"
      stakeholderNames={STAKEHOLDERS}
      addressBook={ADDRESS_BOOK}
      resources={[]}
      settings={defaultSettings}
      onChangeSettings={vi.fn()}
      onCreate={onCreate}
      onLoadFromFile={onLoadFromFile}
      onRestore={onRestore}
      onDeleteArchived={onDeleteArchived}
      {...overrides}
    />,
  );
  return { onCreate, onLoadFromFile, onRestore, onDeleteArchived };
}

/** Fill every required project field so the form becomes valid.
 *  Mirrors the minimal fill used in project-form.test.tsx. */
function fillRequired() {
  function setText(label: string, value: string) {
    fireEvent.change(screen.getByLabelText(label, { exact: false }), {
      target: { value },
    });
  }

  setText("Project name", "Apollo");
  setText("Project code", "APL-1");
  setText("Project manager", "Dana PM");
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
  // Contacts are now mandatory (≥1): add one manual contact.
  fireEvent.change(screen.getByPlaceholderText("Add manually"), {
    target: { value: "Pat Contact" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add" }));
}

describe("ProjectEmptyState", () => {
  it("renders the two primary choices — Create and Load from file", () => {
    setup();
    expect(
      screen.getByRole("button", { name: /create a new project/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /load from an existing file/i }),
    ).toBeInTheDocument();
  });

  it("renders no close (✕) button — the empty state is non-dismissable", () => {
    setup();
    expect(screen.queryByLabelText(/close/i)).toBeNull();
  });

  it("offers Configure database / M365, Run setup wizard, and Configure AI assistant buttons", () => {
    setup();
    expect(
      screen.getByRole("button", { name: /configure database \/ m365/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /run setup wizard/i }),
    ).toBeInTheDocument();
    // Dedicated AI-config CTA for the new-project situation (opens AiSection).
    expect(
      screen.getByRole("button", { name: /configure ai assistant/i }),
    ).toBeInTheDocument();
    // The standalone M365 CTA stays folded into "Configure database / M365".
    expect(
      screen.queryByRole("button", { name: /configure m365 integration/i }),
    ).toBeNull();
  });

  it("opens the backend-config modal when the database / M365 button is clicked", () => {
    setup();
    // The empty state itself is one dialog; the config modal is a second.
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    fireEvent.click(
      screen.getByRole("button", { name: /configure database \/ m365/i }),
    );
    expect(screen.getAllByRole("dialog")).toHaveLength(2);
  });

  it("opens the guided setup wizard when the Run setup wizard button is clicked", () => {
    setup();
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /run setup wizard/i }));
    expect(screen.getAllByRole("dialog")).toHaveLength(2);
    expect(
      screen.getByText(t("en-US", "setupWizardTitle")),
    ).toBeInTheDocument();
  });

  it("calls onLoadFromFile when the Load button is clicked", () => {
    const { onLoadFromFile } = setup();
    fireEvent.click(screen.getByRole("button", { name: /load from an existing file/i }));
    expect(onLoadFromFile).toHaveBeenCalledTimes(1);
  });

  it("clicking Create reveals the wizard; completing all three steps calls onCreate with meta + format + opts", () => {
    const { onCreate } = setup();

    // Initially the form is NOT shown.
    expect(screen.queryByLabelText("Project name", { exact: false })).toBeNull();

    // Open the create wizard.
    fireEvent.click(screen.getByRole("button", { name: /create a new project/i }));

    // Step 1 (Details) form is now visible.
    expect(
      screen.getByLabelText("Project name", { exact: false }),
    ).toBeInTheDocument();

    // The Step-1 submit button label is "Next" (wizard overrides the default "New project").
    const saveBtn = screen.getByRole("button", { name: "Next" }) as HTMLButtonElement;
    expect(saveBtn).toBeDisabled();

    // Fill the form and advance to Step 2.
    fillRequired();
    expect(saveBtn).toBeEnabled();
    fireEvent.click(saveBtn);

    // Step 2 (Template): the wizard now preselects a suggested template, so
    // explicitly pick Blank for a no-template create, then advance to Step 3.
    fireEvent.click(
      screen.getByRole("button", { name: /choose functions yourself/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    // Step 3 (Functions): create — default format is json.
    fireEvent.click(screen.getByRole("button", { name: "Create project" }));

    expect(onCreate).toHaveBeenCalledTimes(1);
    const [meta, format, opts] = onCreate.mock.calls[0];
    expect(meta.name).toBe("Apollo");
    expect(meta.deployment).toBe("Cloud");
    expect(format).toBe("json");
    expect(opts).toBeDefined();
    expect(opts?.template).toBeUndefined();
  });

  it("turso mode still offers Load from file (it switches the portfolio to file mode)", () => {
    setup({ mode: "turso" });
    expect(
      screen.getByRole("button", { name: /create a new project/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /load from an existing file/i }),
    ).toBeInTheDocument();
  });

  it("turso mode lists archived projects with a row-unique Restore button; clicking calls onRestore", () => {
    const { onRestore } = setup({
      mode: "turso",
      archivedProjects: [
        { id: "p1", name: "Orion" },
        { id: "p2", name: "Pegasus" },
      ],
    });
    // Each row has a name-qualified accessible label (WCAG 2.4.6, not N identical "Restore").
    const restoreOrion = screen.getByRole("button", { name: /restore – orion/i });
    expect(restoreOrion).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /restore – pegasus/i })).toBeInTheDocument();
    fireEvent.click(restoreOrion);
    expect(onRestore).toHaveBeenCalledTimes(1);
    expect(onRestore).toHaveBeenCalledWith("p1");
  });

  it("file mode does not render the archived-projects restore list", () => {
    setup({ archivedProjects: [{ id: "p1", name: "Orion" }] });
    expect(screen.queryByRole("button", { name: /restore – orion/i })).toBeNull();
  });

  it("turso archived row offers a type-to-confirm Delete that calls onDeleteArchived", () => {
    const { onDeleteArchived } = setup({
      mode: "turso",
      archivedProjects: [{ id: "p1", name: "Orion" }],
    });
    // Per-row delete is name-qualified; clicking opens the confirm dialog.
    fireEvent.click(screen.getByRole("button", { name: /delete permanently – orion/i }));
    const input = screen.getByRole("textbox");
    // Confirm stays gated until the exact project name is typed.
    fireEvent.change(input, { target: { value: "Orion" } });
    // getByRole matches a string `name` as the full (normalized) accessible name,
    // so "Delete permanently" hits the dialog confirm — NOT the row trigger
    // "Delete permanently – Orion".
    const confirm = screen.getByRole("button", { name: "Delete permanently" });
    fireEvent.click(confirm);
    expect(onDeleteArchived).toHaveBeenCalledWith("p1");
  });

  it("turso mode hides the file-format selector in the create view", () => {
    setup({ mode: "turso" });
    fireEvent.click(screen.getByRole("button", { name: /create a new project/i }));
    expect(screen.queryByRole("combobox", { name: /file format/i })).toBeNull();
    // The form itself still renders.
    expect(
      screen.getByLabelText("Project name", { exact: false }),
    ).toBeInTheDocument();
  });

  it("passes the chosen format to onCreate when the format selector is changed", () => {
    const { onCreate } = setup();

    fireEvent.click(screen.getByRole("button", { name: /create a new project/i }));

    // Change format to csv before filling (select is labelled "Storage").
    fireEvent.change(
      screen.getByRole("combobox", { name: /storage/i }),
      { target: { value: "csv" } },
    );

    fillRequired();
    // Step 1 → 2 → 3 → create.
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Create project" }));

    expect(onCreate).toHaveBeenCalledTimes(1);
    const [, format] = onCreate.mock.calls[0];
    expect(format).toBe("csv");
  });

  it("shows 'Explore a demo project' and calls onLoadDemo when provided", () => {
    const onLoadDemo = vi.fn();
    setup({ onLoadDemo });
    fireEvent.click(
      screen.getByRole("button", { name: t("en-US", "tourLoadDemo") }),
    );
    expect(onLoadDemo).toHaveBeenCalledTimes(1);
  });

  it("hides the demo CTA when onLoadDemo is not provided", () => {
    setup();
    expect(
      screen.queryByRole("button", { name: t("en-US", "tourLoadDemo") }),
    ).toBeNull();
  });

  it("uses the active branding logo on the no-project landing when set", () => {
    const LOGO = "data:image/png;base64,QUJD";
    setup({
      settings: { ...defaultSettings, branding: { ...defaultSettings.branding, logo: LOGO } },
    });
    const img = screen.getByRole("img", { name: /consult|logo/i });
    expect(img).toHaveAttribute("src", LOGO);
  });
});
