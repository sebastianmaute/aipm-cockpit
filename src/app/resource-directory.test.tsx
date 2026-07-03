import { render, screen, fireEvent, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ResourceDirectory } from "./resource-directory";
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
  onAssignRole: vi.fn(),
  onEditResource: vi.fn(),
  onAddResource: vi.fn(),
  onAddAbsence: vi.fn(),
};

describe("ResourceDirectory", () => {
  beforeEach(() => vi.clearAllMocks());

  it("fires onEditResource when the name is clicked", () => {
    const onEdit = vi.fn();
    render(<ResourceDirectory lang="en-US" resources={rs} roles={[]} disciplines={[]} grades={[]} onAssignRole={vi.fn()} onEditResource={onEdit} onAddResource={vi.fn()} onAddAbsence={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Alex Example" }));
    expect(onEdit).toHaveBeenCalledWith(rs[0]);
  });
  it("fires onAddResource from the add button", () => {
    const onAdd = vi.fn();
    render(<ResourceDirectory lang="en-US" resources={rs} roles={[]} disciplines={[]} grades={[]} onAssignRole={vi.fn()} onEditResource={vi.fn()} onAddResource={onAdd} onAddAbsence={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /add resource/i }));
    // Must be called with NO argument — forwarding the click event as `seed`
    // pollutes the resource draft with a PointerEvent and crashes BroadcastChannel.
    expect(onAdd).toHaveBeenCalledWith();
  });
  it("fires onAddAbsence from the Add Absence button", () => {
    const onAdd = vi.fn();
    render(<ResourceDirectory lang="en-US" resources={rs} roles={[]} disciplines={[]} grades={[]} onAssignRole={vi.fn()} onEditResource={vi.fn()} onAddResource={vi.fn()} onAddAbsence={onAdd} />);
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
    render(<ResourceDirectory lang="en-US" resources={rs} roles={[]} disciplines={[]} grades={[]} onAssignRole={vi.fn()} onEditResource={onEdit} onAddResource={vi.fn()} onAddAbsence={vi.fn()} />);
    const row = screen.getByRole("button", { name: "Alex Example" }).closest("tr")!;
    expect(row.className).toContain("cursor-pointer");
    expect(row.className).toContain("hover:bg-surface-muted");
    fireEvent.click(row);
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onEdit).toHaveBeenCalledWith(rs[0]);
  });

  it("clicking the name button fires onEditResource exactly once (stopPropagation prevents double-fire)", () => {
    const onEdit = vi.fn();
    render(<ResourceDirectory lang="en-US" resources={rs} roles={[]} disciplines={[]} grades={[]} onAssignRole={vi.fn()} onEditResource={onEdit} onAddResource={vi.fn()} onAddAbsence={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Alex Example" }));
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it("clicking the discipline/grade select does NOT open the editor (stopPropagation)", () => {
    const onEdit = vi.fn();
    render(
      <ResourceDirectory
        lang="en-US"
        resources={rs}
        roles={[]}
        disciplines={[{ id: 1, name: "Engineering" }]}
        grades={[{ id: 1, name: "Senior" }]}
        onAssignRole={vi.fn()}
        onEditResource={onEdit}
        onAddResource={vi.fn()}
        onAddAbsence={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("combobox", { name: "Discipline for Alex Example" }));
    fireEvent.click(screen.getByRole("combobox", { name: "Grade for Alex Example" }));
    expect(onEdit).not.toHaveBeenCalled();
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
        onAssignRole={vi.fn()} onEditResource={vi.fn()} onAddResource={vi.fn()} onAddAbsence={vi.fn()} />,
    );
    expect(screen.queryByRole("button", { name: t("en-US", "outlookImportButton") })).toBeNull();
    rerender(
      <ResourceDirectory lang="en-US" resources={rs} roles={[]} disciplines={[]} grades={[]}
        onAssignRole={vi.fn()} onEditResource={vi.fn()} onAddResource={vi.fn()} onAddAbsence={vi.fn()} onImportOutlook={onImport} />,
    );
    const btn = screen.getByRole("button", { name: t("en-US", "outlookImportButton") });
    fireEvent.click(btn);
    expect(onImport).toHaveBeenCalled();
  });
});
