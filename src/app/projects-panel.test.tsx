import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { ProjectsPanel } from "./projects-panel";

// Branded confirm dialog — mock the hook so tests control the resolved boolean
// (default accept). `confirmMock.result` is reset to true in afterEach.
const { confirmMock } = vi.hoisted(() => ({ confirmMock: { result: true } }));
vi.mock("./confirm-dialog", () => ({
  useConfirm: () => () => Promise.resolve(confirmMock.result),
}));
// TursoProjectPicker fetches the project list on mount — stub it so the
// picker-opening test doesn't trigger a real network call / unresolved
// promise warning (mirrors project-empty-state.test.tsx).
vi.mock("./turso-portfolio", () => ({
  listProjects: vi.fn().mockResolvedValue([]),
}));
import { type Contact } from "./contacts";
import { type ProjectRegistryEntry } from "./projects-registry";
import { defaultSettings } from "./settings-types";
import { type ProjectMeta } from "./types";
import { expectRowUniqueNames } from "../test/row-unique-names";

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
  contactPersons: [{ name: "Pat Contact", email: "", synced: false }],
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
      settings={defaultSettings}
      onChangeSettings={vi.fn()}
      lang="en-US"
      mode="file"
      onSwitch={onSwitch}
      onCreate={onCreate}
      onUpdateCurrent={onUpdateCurrent}
      onDelete={onDelete}
      onExportCurrent={onExportCurrent}
      onLoadFromFile={onLoadFromFile}
      onMigrateToTurso={vi.fn()}
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

function fillRequired() {
  setText("Project name", "NewProj");
  setText("Project code", "NEW-1");
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

afterEach(() => {
  confirmMock.result = true;
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
    // Switch lives on the non-current row (Gemini/p2); its label is row-qualified.
    fireEvent.click(screen.getByRole("button", { name: /switch project/i }));
    expect(onSwitch).toHaveBeenCalledWith("p2");
  });

  it("deletes only when the confirm dialog is accepted (on a non-current row)", async () => {
    const { onDelete } = setup();

    // Delete now lives on the NON-current row (Gemini/p2) — the active project
    // (Apollo/p1) no longer exposes a destructive action.
    confirmMock.result = false;
    fireEvent.click(screen.getByRole("button", { name: /delete project/i }));
    await Promise.resolve();
    expect(onDelete).not.toHaveBeenCalled();

    confirmMock.result = true;
    fireEvent.click(screen.getByRole("button", { name: /delete project/i }));
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith("p2"));
  });

  it("does not show a destructive action on the current/active row", () => {
    setup();
    // Only the non-current row has a delete; the current row shows Edit/Export only.
    expect(screen.getAllByRole("button", { name: /delete project/i })).toHaveLength(1);
  });

  it("opens the create wizard and calls onCreate with meta + chosen format + opts", () => {
    const { onCreate } = setup();
    fireEvent.click(screen.getByRole("button", { name: "+ New project" }));

    // Step 1 (Details): choose a non-default file format, then advance.
    fireEvent.change(screen.getByLabelText("Storage"), {
      target: { value: "csv" },
    });
    fillRequired();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    // Step 2 (Template): the wizard now preselects a suggested template, so
    // explicitly pick Blank for a no-template create, then advance.
    fireEvent.click(
      screen.getByRole("button", { name: /choose functions yourself/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    // Step 3 (Functions): create.
    fireEvent.click(screen.getByRole("button", { name: "Create project" }));

    expect(onCreate).toHaveBeenCalledTimes(1);
    const [meta, format, opts] = onCreate.mock.calls[0];
    expect(meta.name).toBe("NewProj");
    expect(format).toBe("csv");
    // Blank → no template, every module enabled.
    expect(opts.template).toBeUndefined();
    expect(opts.features).toContain("dashboard");
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

  it("closes the export menu on outside click", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Export project" }));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("closes the export menu on Escape", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: "Export project" }));
    expect(screen.getByRole("menu")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  // `currentProject` stays a RENDER gate on Move-to-Turso: with no project
  // there is nothing to move, so a permanently disabled control there would be
  // noise. Not-configured is the DISABLED case instead — pinned in the
  // "Load from Turso" describe below, which covers both buttons.
  it("hides 'Move to Turso' when there is no current project", () => {
    setup({ currentProject: undefined });
    expect(screen.queryByRole("button", { name: "Move to Turso" })).toBeNull();
  });

  it("shows 'Move to Turso' in file mode when Turso is configured and fires it", () => {
    const onMigrateToTurso = vi.fn();
    const settings = {
      ...defaultSettings,
      integrations: {
        ...defaultSettings.integrations,
        turso: { enabled: true, databaseUrl: "libsql://db-org.turso.io", authToken: "tok" },
      },
    };
    setup({ settings, onMigrateToTurso });
    fireEvent.click(screen.getByRole("button", { name: "Move to Turso" }));
    expect(onMigrateToTurso).toHaveBeenCalledTimes(1);
  });
});

describe("ProjectsPanel file mode", () => {
  it("keeps Load from file and the Delete (now on non-current rows)", () => {
    setup({ mode: "file" });
    expect(
      screen.getByRole("button", { name: /load from file/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /delete project/i }),
    ).toBeInTheDocument();
  });

  // §309, the OTHER branch. `projects-panel.tsx` renders Archive OR Delete —
  // `{isTurso ? <Archive/> : <Delete/>}` — so the turso test above can never
  // reach the `projectsDelete` label and nothing pinned its name. File mode is
  // the only way in.
  it("gives every ACTIVE row control a row-unique accessible name in FILE mode (§309)", () => {
    const shared: ProjectRegistryEntry[] = [
      { id: "p1", name: "Migration", code: "MIG-1", storageConfig: { kind: "local-json" } as never },
      { id: "p2", name: "Migration", code: "MIG-2", storageConfig: { kind: "local-json" } as never },
    ];
    setup({ mode: "file", projects: shared, currentProjectId: null });
    // 9 = MEASURED, exactly as above: Load from file… · Load from Turso ·
    // Move to Turso · + New project · reset pane size, plus Switch + Delete on
    // each of the two rows. Turso is not configured in `defaultSettings`, so
    // the two Turso buttons render DISABLED rather than not at all — they are
    // still in the accessible tree and still need row-distinct names.
    expectRowUniqueNames({ minControls: 9, requireCollisionSeed: true });
  });
});

describe("ProjectsPanel turso mode", () => {
  const ARCHIVED: ProjectRegistryEntry[] = [
    { id: "p9", name: "Old", code: "OLD", storageConfig: { kind: "turso" } as never },
  ];

  it("default delete archives; Show archived reveals restore + permanent delete", async () => {
    const onArchive = vi.fn();
    const onHardDelete = vi.fn();
    const onRestore = vi.fn();
    confirmMock.result = true;

    setup({
      mode: "turso",
      archivedProjects: ARCHIVED,
      onArchive,
      onRestore,
      onHardDelete,
    });

    // Archive lives on the NON-current row (Gemini/p2) in turso mode; the active
    // project (Apollo/p1) no longer exposes it. Label is row-qualified.
    fireEvent.click(screen.getByRole("button", { name: /^archive –/i }));
    await waitFor(() => expect(onArchive).toHaveBeenCalledWith("p2"));

    // Reveal archived.
    fireEvent.click(screen.getByRole("button", { name: /show archived/i }));
    expect(screen.getByText("Old")).toBeInTheDocument();

    // Restore/Delete-permanently are now row-qualified (§276) even with a
    // single archived row — same unconditional-qualification convention the
    // Switch/Archive/Delete buttons above already follow.
    fireEvent.click(screen.getByRole("button", { name: /^restore –/i }));
    expect(onRestore).toHaveBeenCalledWith("p9");

    // Permanent delete: the row button ("Delete permanently – Old") opens the
    // type-to-confirm dialog, whose own confirm button carries the bare,
    // unqualified "Delete permanently" label — the two no longer collide.
    fireEvent.click(
      screen.getByRole("button", { name: /^delete permanently –/i }),
    );
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Old" } });
    fireEvent.click(screen.getByRole("button", { name: "Delete permanently" }));
    expect(onHardDelete).toHaveBeenCalledWith("p9");
  });

  it("gives every archived row's controls a row-unique name", () => {
    // Two archived projects with DIFFERENT names. requireCollisionSeed stays
    // OFF: the names differ, so the guard would throw against correct code.
    setup({
      mode: "turso",
      archivedProjects: [
        { id: "a1", name: "Nova", code: "NOV-1", storageConfig: { kind: "turso" } as never },
        { id: "a2", name: "Borealis", code: "BOR-1", storageConfig: { kind: "turso" } as never },
      ],
    });
    fireEvent.click(screen.getByRole("button", { name: /show archived/i }));
    expectRowUniqueNames({ minControls: 11, requireCollisionSeed: false });
  });

  it("numbers archived rows that share a name", () => {
    // Two archived projects with the SAME name -> occurrence suffixes.
    setup({
      mode: "turso",
      archivedProjects: [
        { id: "a1", name: "Zeta", code: "ZET-1", storageConfig: { kind: "turso" } as never },
        { id: "a2", name: "Zeta", code: "ZET-2", storageConfig: { kind: "turso" } as never },
      ],
    });
    fireEvent.click(screen.getByRole("button", { name: /show archived/i }));
    expectRowUniqueNames({ minControls: 11, requireCollisionSeed: true });
  });

  it("gives every ACTIVE row control a row-unique accessible name when two projects share a name (§309)", () => {
    // Two ACTIVE projects (not archived) sharing a display name. currentProjectId
    // is null so BOTH rows render as non-current — the non-current-row controls
    // (Switch + the destructive Archive) live only on non-current rows, so a
    // fixture with a current row would render just one Archive and the
    // assertion would cover nothing. (Switch itself is `variant="secondary"`;
    // only Archive/Delete are destructive.)
    const shared: ProjectRegistryEntry[] = [
      { id: "p1", name: "Migration", code: "MIG-1", storageConfig: { kind: "turso" } as never },
      { id: "p2", name: "Migration", code: "MIG-2", storageConfig: { kind: "turso" } as never },
    ];
    setup({
      mode: "turso",
      projects: shared,
      currentProjectId: null,
    });
    // 7 = MEASURED, not a floor over the row buttons alone: the panel renders
    // chrome outside the row map too (Show archived · + New project · reset
    // pane size) on top of the four row controls. Keeping it EXACT is the only
    // automatic guard against a silently narrowed `roles` list.
    expectRowUniqueNames({ minControls: 7, requireCollisionSeed: true });
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

describe("ProjectsPanel — Load from Turso", () => {
  it("shows the Turso buttons disabled when Turso is not configured", () => {
    setup();
    expect(screen.getByRole("button", { name: "Load from Turso" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move to Turso" })).toBeDisabled();
  });

  // ★★ A disabled button dispatches NO mouse events, so a `title` on the button
  // itself never surfaces — the explanation would be unreachable on the very
  // control it explains. It lives on a wrapper instead.
  it("puts the not-configured hint on the wrapper, not on the disabled button", () => {
    setup();
    const btn = screen.getByRole("button", { name: "Load from Turso" });
    expect(btn).not.toHaveAttribute("title");
    expect(btn.closest("[title]")).toHaveAttribute(
      "title",
      "Configure a Turso database in Settings → Integrations first.",
    );
  });

  it("enables the Turso buttons once Turso is configured", () => {
    setup({
      settings: {
        ...defaultSettings,
        integrations: {
          ...defaultSettings.integrations,
          turso: { enabled: true, databaseUrl: "libsql://db-org.turso.io", authToken: "tok" },
        },
      },
    });
    expect(screen.getByRole("button", { name: "Load from Turso" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Move to Turso" })).toBeEnabled();
  });

  it("hides the button while already in turso mode", () => {
    setup({
      mode: "turso",
      settings: {
        ...defaultSettings,
        integrations: {
          ...defaultSettings.integrations,
          turso: { enabled: true, databaseUrl: "libsql://db-org.turso.io", authToken: "tok" },
        },
      },
    });
    expect(screen.queryByRole("button", { name: "Load from Turso" })).toBeNull();
  });

  it("shows the button in file mode once Turso is configured, and opens the picker", () => {
    setup({
      settings: {
        ...defaultSettings,
        integrations: {
          ...defaultSettings.integrations,
          turso: { enabled: true, databaseUrl: "libsql://db-org.turso.io", authToken: "tok" },
        },
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Load from Turso" }));
    expect(screen.getByRole("dialog", { name: "Load a Turso project" })).toBeInTheDocument();
  });
});
