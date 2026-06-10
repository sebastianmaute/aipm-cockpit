import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ProjectEmptyState } from "./project-empty-state";
import { type Contact } from "./contacts";
import { type ProjectMeta } from "./types";

const STAKEHOLDERS = ["Alice Smith", "Bob Jones"];
const ADDRESS_BOOK: Contact[] = [
  { name: "Carol White", email: "carol@example.com" },
];

function setup(overrides: Partial<React.ComponentProps<typeof ProjectEmptyState>> = {}) {
  const onCreate = vi.fn<(meta: ProjectMeta, format: "json" | "csv" | "md") => void>();
  const onLoadFromFile = vi.fn();
  render(
    <ProjectEmptyState
      lang="en-US"
      stakeholderNames={STAKEHOLDERS}
      addressBook={ADDRESS_BOOK}
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

  it("calls onLoadFromFile when the Load button is clicked", () => {
    const { onLoadFromFile } = setup();
    fireEvent.click(screen.getByRole("button", { name: /load from an existing file/i }));
    expect(onLoadFromFile).toHaveBeenCalledTimes(1);
  });

  it("clicking Create reveals the ProjectForm; filling required fields and submitting calls onCreate with meta + format", () => {
    const { onCreate } = setup();

    // Initially the form is NOT shown.
    expect(screen.queryByLabelText("Project name", { exact: false })).toBeNull();

    // Open the create view.
    fireEvent.click(screen.getByRole("button", { name: /create a new project/i }));

    // Form is now visible.
    expect(
      screen.getByLabelText("Project name", { exact: false }),
    ).toBeInTheDocument();

    // The save button label is "New project" (from ProjectForm create mode).
    const saveBtn = screen.getByRole("button", { name: "New project" }) as HTMLButtonElement;
    expect(saveBtn).toBeDisabled();

    // Fill the form.
    fillRequired();
    expect(saveBtn).toBeEnabled();

    // Submit — default format is json.
    fireEvent.click(saveBtn);

    expect(onCreate).toHaveBeenCalledTimes(1);
    const [meta, format] = onCreate.mock.calls[0];
    expect(meta.name).toBe("Apollo");
    expect(meta.deployment).toBe("Cloud");
    expect(format).toBe("json");
  });

  it("passes the chosen format to onCreate when the format selector is changed", () => {
    const { onCreate } = setup();

    fireEvent.click(screen.getByRole("button", { name: /create a new project/i }));

    // Change format to csv before filling (select is labelled "File format").
    fireEvent.change(
      screen.getByRole("combobox", { name: /file format/i }),
      { target: { value: "csv" } },
    );

    fillRequired();
    fireEvent.click(screen.getByRole("button", { name: "New project" }));

    expect(onCreate).toHaveBeenCalledTimes(1);
    const [, format] = onCreate.mock.calls[0];
    expect(format).toBe("csv");
  });
});
