import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { ProjectsPanel } from "./projects-panel";
import { type Contact } from "./contacts";
import { type ProjectRegistryEntry } from "./projects-registry";
import { type ProjectMeta } from "./types";

const STAKEHOLDERS = ["Alice Smith", "Bob Jones"];
const ADDRESS_BOOK: Contact[] = [
  { name: "Carol White", email: "carol@example.com" },
];

const PROJECTS: ProjectRegistryEntry[] = [
  { id: "p1", name: "Apollo", code: "APL-1", storageConfig: { kind: "local-json" } as never },
  { id: "p2", name: "Gemini", code: "GEM-2", storageConfig: { kind: "local-json" } as never },
];

const CURRENT_META: ProjectMeta = {
  name: "Apollo",
  code: "APL-1",
  projectManager: "Dana PM",
  keyStakeholdersInternal: ["Alice Smith"],
  keyStakeholdersExternal: ["Ext Person"],
  customer: "ACME Corp",
  naceSection: "C",
  identityTypes: [],
  products: "Widget",
  deployment: "Cloud",
  startDate: "2026-01-01",
  endDate: "2026-06-01",
  profitCenter: "PC-9",
  contactPersons: [],
  regulatory: ["GDPR / data protection regulation"],
};

function setup(overrides: Partial<React.ComponentProps<typeof ProjectsPanel>> = {}) {
  const onSwitch = vi.fn();
  const onCreate = vi.fn();
  const onUpdateCurrent = vi.fn();
  const onDelete = vi.fn();
  const onExportCurrent = vi.fn();
  const onLoadFromFile = vi.fn();
  render(
    <ProjectsPanel
      projects={PROJECTS}
      currentProjectId="p1"
      currentProject={CURRENT_META}
      stakeholderNames={STAKEHOLDERS}
      addressBook={ADDRESS_BOOK}
      resources={[]}
      lang="en-US"
      mode="file"
      onSwitch={onSwitch}
      onCreate={onCreate}
      onUpdateCurrent={onUpdateCurrent}
      onDelete={onDelete}
      onExportCurrent={onExportCurrent}
      onLoadFromFile={onLoadFromFile}
      {...overrides}
    />,
  );
  return { onSwitch, onCreate, onUpdateCurrent, onDelete, onExportCurrent, onLoadFromFile };
}

// --- ProjectForm fill helpers (mirrors project-form.test.tsx) -------------

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

function fillRequired() {
  setText("Project name", "NewProj");
  setText("Project code", "NEW-1");
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

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ProjectsPanel", () => {
  it("renders a row per project with name+code; current one shows the badge", () => {
    setup();
    expect(screen.getByText("Apollo")).toBeInTheDocument();
    expect(screen.getByText("APL-1")).toBeInTheDocument();
    expect(screen.getByText("Gemini")).toBeInTheDocument();
    expect(screen.getByText("GEM-2")).toBeInTheDocument();
    // Exactly one current badge, on the current project.
    expect(screen.getByText("Current project")).toBeInTheDocument();
  });

  it("calls onSwitch(id) when Switch is clicked on a non-current row", () => {
    const { onSwitch } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Switch project" }));
    expect(onSwitch).toHaveBeenCalledWith("p2");
  });

  it("deletes only when the confirm dialog is accepted", () => {
    const { onDelete } = setup();

    vi.spyOn(window, "confirm").mockReturnValueOnce(false);
    fireEvent.click(screen.getByRole("button", { name: "Delete project" }));
    expect(onDelete).not.toHaveBeenCalled();

    vi.spyOn(window, "confirm").mockReturnValueOnce(true);
    fireEvent.click(screen.getByRole("button", { name: "Delete project" }));
    expect(onDelete).toHaveBeenCalledWith("p1");
  });

  it("opens the create form and calls onCreate with meta + chosen format", () => {
    const { onCreate } = setup();
    fireEvent.click(screen.getByRole("button", { name: "+ New project" }));

    // Choose a non-default file format for the new project.
    fireEvent.change(screen.getByLabelText("File format"), {
      target: { value: "csv" },
    });

    fillRequired();
    fireEvent.click(screen.getByRole("button", { name: "New project" }));

    expect(onCreate).toHaveBeenCalledTimes(1);
    const [meta, format] = onCreate.mock.calls[0];
    expect(meta.name).toBe("NewProj");
    expect(format).toBe("csv");
  });

  it("opens Edit prefilled and calls onUpdateCurrent on submit", () => {
    const { onUpdateCurrent } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Edit project" }));

    // Prefill: the current project's name appears in the form.
    const nameInput = screen.getByLabelText("Project name", {
      exact: false,
    }) as HTMLInputElement;
    expect(nameInput.value).toBe("Apollo");

    // Edit-mode submit button uses the "Edit project" label.
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Edit project" }),
    );
    expect(onUpdateCurrent).toHaveBeenCalledTimes(1);
    expect(onUpdateCurrent.mock.calls[0][0].name).toBe("Apollo");
  });

  it("calls onExportCurrent with the chosen format from the export menu", () => {
    const { onExportCurrent } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Export project" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Excel (.xlsx)" }));
    expect(onExportCurrent).toHaveBeenCalledWith("xlsx");
  });
});

describe("ProjectsPanel file mode", () => {
  it("keeps Load from file and the existing Delete", () => {
    setup({ mode: "file" });
    expect(
      screen.getByRole("button", { name: /load from file/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Delete project" }),
    ).toBeInTheDocument();
  });
});

describe("ProjectsPanel turso mode", () => {
  const ARCHIVED: ProjectRegistryEntry[] = [
    { id: "p9", name: "Old", code: "OLD", storageConfig: { kind: "turso" } as never },
  ];

  it("default delete archives; Show archived reveals restore + permanent delete", () => {
    const onArchive = vi.fn();
    const onHardDelete = vi.fn();
    const onRestore = vi.fn();
    vi.spyOn(window, "confirm").mockReturnValue(true);

    setup({
      mode: "turso",
      archivedProjects: ARCHIVED,
      onArchive,
      onRestore,
      onHardDelete,
    });

    // Current row's destructive button is "Archive" in turso mode.
    fireEvent.click(screen.getByRole("button", { name: /^archive$/i }));
    expect(onArchive).toHaveBeenCalledWith("p1");

    // Reveal archived.
    fireEvent.click(screen.getByRole("button", { name: /show archived/i }));
    expect(screen.getByText("Old")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^restore$/i }));
    expect(onRestore).toHaveBeenCalledWith("p9");

    // Permanent delete: the row button opens the type-to-confirm dialog. Both
    // the row button and the dialog's confirm button share the "Delete
    // permanently" label, so disambiguate by clicking the LAST match (dialog).
    fireEvent.click(
      screen.getByRole("button", { name: /^delete permanently$/i }),
    );
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Old" } });
    const confirmButtons = screen.getAllByRole("button", {
      name: "Delete permanently",
    });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]);
    expect(onHardDelete).toHaveBeenCalledWith("p9");
  });

  it("hides Load from file", () => {
    setup({ mode: "turso" });
    expect(
      screen.queryByRole("button", { name: /load from file/i }),
    ).toBeNull();
  });

  it("does not show an Archive button in file mode", () => {
    setup({ mode: "file" });
    expect(
      screen.queryByRole("button", { name: /^archive$/i }),
    ).toBeNull();
  });
});
