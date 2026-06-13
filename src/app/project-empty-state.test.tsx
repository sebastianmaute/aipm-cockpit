import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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
      {...overrides}
    />,
  );
  return { onCreate, onLoadFromFile };
}

/** Fill every required project field so the form becomes valid.
 *  Mirrors the minimal fill used in project-form.test.tsx. */
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

  setText("Project name", "Apollo");
  setText("Project code", "APL-1");
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

  it("offers backend-config buttons for Turso and M365", () => {
    setup();
    expect(
      screen.getByRole("button", { name: /configure the turso backend/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /configure m365 integration/i }),
    ).toBeInTheDocument();
  });

  it("opens the backend-config modal when a backend button is clicked", () => {
    setup();
    // The empty state itself is one dialog; the config modal is a second.
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    fireEvent.click(
      screen.getByRole("button", { name: /configure the turso backend/i }),
    );
    expect(screen.getAllByRole("dialog")).toHaveLength(2);
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

  it("turso mode shows Create only (no Load from file)", () => {
    setup({ mode: "turso" });
    expect(
      screen.getByRole("button", { name: /create a new project/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /load from an existing file/i }),
    ).toBeNull();
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
});
