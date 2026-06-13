import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CreateProjectForm } from "./create-project-form";
import { type Contact } from "./contacts";
import { defaultSettings } from "./settings-types";
import { type ProjectMeta } from "./types";

const STAKEHOLDERS = ["Alice Smith", "Bob Jones"];
const ADDRESS_BOOK: Contact[] = [
  { name: "Carol White", email: "carol@example.com" },
];

function setup(overrides: Partial<React.ComponentProps<typeof CreateProjectForm>> = {}) {
  const onCreate =
    vi.fn<(meta: ProjectMeta, format: "json" | "csv" | "md", storage: "file" | "turso") => void>();
  const onCancel = vi.fn();
  const onChangeSettings = vi.fn();
  render(
    <CreateProjectForm
      lang="en-US"
      stakeholderNames={STAKEHOLDERS}
      addressBook={ADDRESS_BOOK}
      resources={[]}
      settings={defaultSettings}
      onChangeSettings={onChangeSettings}
      onCreate={onCreate}
      onCancel={onCancel}
      {...overrides}
    />,
  );
  return { onCreate, onCancel, onChangeSettings };
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
  it("renders the storage selector (labelled 'Storage') with a Turso option and the project form", () => {
    setup();
    expect(screen.getByLabelText("Storage")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /Turso/i })).toBeInTheDocument();
    expect(screen.getByLabelText("Project name", { exact: false })).toBeInTheDocument();
  });

  it("hides the storage selector when hideFormat is set", () => {
    setup({ hideFormat: true });
    expect(screen.queryByLabelText("Storage")).toBeNull();
    expect(screen.queryByRole("combobox", { name: /storage/i })).toBeNull();
    // The rest of the form still renders.
    expect(
      screen.getByLabelText("Project name", { exact: false }),
    ).toBeInTheDocument();
  });

  it("submits format 'json' and storage 'file' when hideFormat is set", () => {
    const { onCreate } = setup({ hideFormat: true });
    fillRequired();
    fireEvent.click(screen.getByRole("button", { name: "New project" }));
    expect(onCreate).toHaveBeenCalledTimes(1);
    const [, format, storage] = onCreate.mock.calls[0];
    expect(format).toBe("json");
    expect(storage).toBe("file");
  });

  it("calls onCreate with meta, the chosen format, and storage 'file' on submit", () => {
    const { onCreate } = setup();

    // Change from default json to md.
    fireEvent.change(screen.getByLabelText("Storage"), {
      target: { value: "md" },
    });

    fillRequired();
    fireEvent.click(screen.getByRole("button", { name: "New project" }));

    expect(onCreate).toHaveBeenCalledTimes(1);
    const [meta, format, storage] = onCreate.mock.calls[0];
    expect(meta.name).toBe("TestProj");
    expect(format).toBe("md");
    expect(storage).toBe("file");
  });

  it("opens the backend-config modal when Turso storage is selected", () => {
    setup();
    fireEvent.change(screen.getByLabelText("Storage"), {
      target: { value: "turso" },
    });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
