import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CreateProjectForm } from "./create-project-form";
import { type Contact } from "./contacts";
import { type ProjectMeta } from "./types";

const STAKEHOLDERS = ["Alice Smith", "Bob Jones"];
const ADDRESS_BOOK: Contact[] = [
  { name: "Carol White", email: "carol@example.com" },
];

function setup(overrides: Partial<React.ComponentProps<typeof CreateProjectForm>> = {}) {
  const onCreate = vi.fn<(meta: ProjectMeta, format: "json" | "csv" | "md") => void>();
  const onCancel = vi.fn();
  render(
    <CreateProjectForm
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
  setText("Project name", "TestProj");
  setText("Project code", "TST-1");
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

describe("CreateProjectForm", () => {
  it("renders the file-format selector (labelled 'File format') and the project form", () => {
    setup();
    expect(screen.getByLabelText("File format")).toBeInTheDocument();
    expect(screen.getByLabelText("Project name", { exact: false })).toBeInTheDocument();
  });

  it("hides the file-format selector when hideFormat is set", () => {
    setup({ hideFormat: true });
    expect(screen.queryByLabelText("File format")).toBeNull();
    expect(screen.queryByRole("combobox", { name: /file format/i })).toBeNull();
    // The rest of the form still renders.
    expect(
      screen.getByLabelText("Project name", { exact: false }),
    ).toBeInTheDocument();
  });

  it("submits format 'json' when hideFormat is set", () => {
    const { onCreate } = setup({ hideFormat: true });
    fillRequired();
    fireEvent.click(screen.getByRole("button", { name: "New project" }));
    expect(onCreate).toHaveBeenCalledTimes(1);
    const [, format] = onCreate.mock.calls[0];
    expect(format).toBe("json");
  });

  it("calls onCreate with meta and the chosen format on submit", () => {
    const { onCreate } = setup();

    // Change from default json to md.
    fireEvent.change(screen.getByLabelText("File format"), {
      target: { value: "md" },
    });

    fillRequired();
    fireEvent.click(screen.getByRole("button", { name: "New project" }));

    expect(onCreate).toHaveBeenCalledTimes(1);
    const [meta, format] = onCreate.mock.calls[0];
    expect(meta.name).toBe("TestProj");
    expect(format).toBe("md");
  });
});
