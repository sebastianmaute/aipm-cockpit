import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ResourceDirectory } from "./resource-directory";
import { ConfirmProvider } from "./confirm-dialog";
import type { Resource } from "./types";
import { t } from "./i18n";

const rs: Resource[] = [{ id: 1, firstName: "Sample", lastName: "Dummy", title: "Architect", roleId: null, utilizationMode: "percent", utilization: {} }];

const twoResources: Resource[] = [
  { id: 1, firstName: "Zoe", lastName: "Adams", title: "PM", roleId: null, utilizationMode: "percent", utilization: {} },
  { id: 2, firstName: "Amy", lastName: "Bell", title: "Dev", roleId: null, utilizationMode: "percent", utilization: {} },
];

const common = {
  lang: "en-US" as const,
  roles: [],
  disciplines: [],
  grades: [],
  onAssignRoleById: vi.fn(),
  onEditResource: vi.fn(),
  onAddResource: vi.fn(),
  onAddAbsence: vi.fn(),
};

describe("ResourceDirectory", () => {
  beforeEach(() => vi.clearAllMocks());

  it("fires onEditResource when the name is clicked", () => {
    const onEdit = vi.fn();
    render(<ResourceDirectory lang="en-US" resources={rs} roles={[]} disciplines={[]} grades={[]} onAssignRoleById={vi.fn()} onEditResource={onEdit} onAddResource={vi.fn()} onAddAbsence={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Alex Example" }));
    expect(onEdit).toHaveBeenCalledWith(rs[0]);
  });
  it("fires onAddResource from the add button", () => {
    const onAdd = vi.fn();
    render(<ResourceDirectory lang="en-US" resources={rs} roles={[]} disciplines={[]} grades={[]} onAssignRoleById={vi.fn()} onEditResource={vi.fn()} onAddResource={onAdd} onAddAbsence={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /add resource/i }));
    // Must be called with NO argument — forwarding the click event as `seed`
    // pollutes the resource draft with a PointerEvent and crashes BroadcastChannel.
    expect(onAdd).toHaveBeenCalledWith();
  });
  it("fires onAddAbsence from the Add Absence button", () => {
    const onAdd = vi.fn();
    render(<ResourceDirectory lang="en-US" resources={rs} roles={[]} disciplines={[]} grades={[]} onAssignRoleById={vi.fn()} onEditResource={vi.fn()} onAddResource={vi.fn()} onAddAbsence={onAdd} />);
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "resourcesAddAbsence") }));
    // Must be called with NO argument — forwarding the click event as `seed`
    // pollutes the absence draft with a PointerEvent and crashes BroadcastChannel.
    expect(onAdd).toHaveBeenCalledWith();
  });

  it("filters rows by the search box", () => {
    render(<ResourceDirectory {...common} resources={twoResources} />);
    fireEvent.change(screen.getByPlaceholderText(/filter by/i), { target: { value: "amy" } });
    expect(screen.queryByText("Zoe Adams")).toBeNull();
    expect(screen.getByText("Amy Bell")).toBeInTheDocument();
  });

  it("sorts by name when the Name header is clicked", () => {
    render(<ResourceDirectory {...common} resources={twoResources} />);
    // Click the sort button in the Name (Assignee) column header
    fireEvent.click(screen.getByRole("button", { name: /sort by assignee/i }));
    const rows = screen.getAllByRole("row").slice(1); // skip header
    expect(within(rows[0]).getByText("Amy Bell")).toBeInTheDocument();
  });

  it("reverses to descending on a second click of the same header", () => {
    render(<ResourceDirectory {...common} resources={twoResources} />);
    const nameHeader = screen.getByRole("button", { name: /sort by assignee/i });
    fireEvent.click(nameHeader); // asc → Amy first
    fireEvent.click(nameHeader); // desc → Zoe first
    const rows = screen.getAllByRole("row").slice(1);
    expect(within(rows[0]).getByText("Zoe Adams")).toBeInTheDocument();
  });

  it("clicking a directory row opens the editor (RAID-style row click)", () => {
    const onEdit = vi.fn();
    render(<ResourceDirectory lang="en-US" resources={rs} roles={[]} disciplines={[]} grades={[]} onAssignRoleById={vi.fn()} onEditResource={onEdit} onAddResource={vi.fn()} onAddAbsence={vi.fn()} />);
    const row = screen.getByRole("button", { name: "Alex Example" }).closest("tr")!;
    expect(row.className).toContain("cursor-pointer");
    expect(row.className).toContain("hover:bg-surface-muted");
    fireEvent.click(row);
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onEdit).toHaveBeenCalledWith(rs[0]);
  });

  it("clicking the name button fires onEditResource exactly once (stopPropagation prevents double-fire)", () => {
    const onEdit = vi.fn();
    render(<ResourceDirectory lang="en-US" resources={rs} roles={[]} disciplines={[]} grades={[]} onAssignRoleById={vi.fn()} onEditResource={onEdit} onAddResource={vi.fn()} onAddAbsence={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Alex Example" }));
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it("assigns a role via the single picker and does NOT open the editor (stopPropagation)", () => {
    const onEdit = vi.fn();
    const onAssign = vi.fn();
    render(
      <ResourceDirectory
        lang="en-US"
        resources={rs}
        roles={[{ id: 5, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 150 }]}
        disciplines={[{ id: 1, name: "Engineering" }]}
        grades={[{ id: 1, name: "Senior" }]}
        onAssignRoleById={onAssign}
        onEditResource={onEdit}
        onAddResource={vi.fn()}
        onAddAbsence={vi.fn()}
      />,
    );
    const select = screen.getByRole("combobox", { name: "Role for Alex Example" });
    fireEvent.click(select);
    fireEvent.change(select, { target: { value: "5" } });
    expect(onAssign).toHaveBeenCalledWith(1, 5);
    expect(onEdit).not.toHaveBeenCalled();
  });

  it("renders primary + additional emails as copy buttons and copies on click", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const withEmails: Resource[] = [
      { id: 1, firstName: "Ada", lastName: "Byte", email: "ada@x.com", emails: ["ada.alt@y.com"], roleId: null, utilizationMode: "percent", utilization: {} },
    ];
    render(<ResourceDirectory {...common} resources={withEmails} />);
    const primary = screen.getByRole("button", { name: "Copy ada@x.com" });
    const alt = screen.getByRole("button", { name: "Copy ada.alt@y.com" });
    expect(alt).toBeInTheDocument();
    fireEvent.click(primary);
    expect(writeText).toHaveBeenCalledWith("ada@x.com");
    fireEvent.click(alt);
    expect(writeText).toHaveBeenCalledWith("ada.alt@y.com");
  });

  it("shows no checkbox column without bulk handlers", () => {
    render(<ResourceDirectory {...common} resources={twoResources} />);
    expect(screen.queryByRole("checkbox", { name: /select all/i })).toBeNull();
  });

  it("selecting rows shows the bulk bar; bulk-edit applies a patch to the selection", () => {
    const onBulkEdit = vi.fn();
    render(
      <ResourceDirectory
        {...common}
        resources={twoResources}
        roles={[{ id: 5, disciplineId: 1, gradeId: 1, internalRate: 0, externalRate: 0 }]}
        disciplines={[{ id: 1, name: "Eng" }]}
        grades={[{ id: 1, name: "Senior" }]}
        onBulkEditResources={onBulkEdit}
        onBulkDeleteResources={vi.fn()}
      />,
    );
    // Select all visible → bulk bar appears.
    fireEvent.click(screen.getByRole("checkbox", { name: /select all/i }));
    fireEvent.click(screen.getByRole("button", { name: /^bulk edit$/i }));
    // Enable the External field (its enable checkbox), set it to External, apply.
    fireEvent.click(screen.getByRole("checkbox", { name: /external resource/i }));
    fireEvent.change(screen.getByRole("combobox", { name: /external resource/i }), { target: { value: "yes" } });
    fireEvent.click(screen.getByRole("button", { name: /apply/i }));
    expect(onBulkEdit).toHaveBeenCalledTimes(1);
    const [ids, patch] = onBulkEdit.mock.calls[0];
    expect(ids.sort()).toEqual([1, 2]);
    expect(patch).toMatchObject({ isExternal: true });
  });

  it("bulk delete confirms then calls onBulkDeleteResources", async () => {
    const onBulkDelete = vi.fn();
    render(
      <ConfirmProvider lang="en-US">
        <ResourceDirectory {...common} resources={twoResources} onBulkEditResources={vi.fn()} onBulkDeleteResources={onBulkDelete} />
      </ConfirmProvider>,
    );
    fireEvent.click(screen.getByRole("checkbox", { name: /select all/i }));
    fireEvent.click(screen.getByRole("button", { name: /delete selected/i }));
    // Branded confirm dialog → warns the cascade also removes calendar entries.
    expect(await screen.findByText(/calendar entries \(absences and shifts\) will also be removed/i)).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: /^confirm$/i }));
    await waitFor(() => expect(onBulkDelete).toHaveBeenCalledWith(expect.arrayContaining([1, 2])));
  });

  it("gives the directory search box a descriptive tooltip", () => {
    render(<ResourceDirectory {...common} resources={rs} />);
    expect(screen.getByPlaceholderText(/filter by name, title/i)).toHaveAttribute(
      "title",
      "Filter the directory to people whose name, title, department, or email match your text.",
    );
  });

  it("renders Import from Outlook only when onImportOutlook is provided", () => {
    const onImport = vi.fn();
    const { rerender } = render(
      <ResourceDirectory lang="en-US" resources={rs} roles={[]} disciplines={[]} grades={[]}
        onAssignRoleById={vi.fn()} onEditResource={vi.fn()} onAddResource={vi.fn()} onAddAbsence={vi.fn()} />,
    );
    expect(screen.queryByRole("button", { name: t("en-US", "outlookImportButton") })).toBeNull();
    rerender(
      <ResourceDirectory lang="en-US" resources={rs} roles={[]} disciplines={[]} grades={[]}
        onAssignRoleById={vi.fn()} onEditResource={vi.fn()} onAddResource={vi.fn()} onAddAbsence={vi.fn()} onImportOutlook={onImport} />,
    );
    const btn = screen.getByRole("button", { name: t("en-US", "outlookImportButton") });
    fireEvent.click(btn);
    expect(onImport).toHaveBeenCalled();
  });
});
