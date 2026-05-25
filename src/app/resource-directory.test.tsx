import { render, screen, fireEvent, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ResourceDirectory } from "./resource-directory";
import type { Resource } from "./types";

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
};

describe("ResourceDirectory", () => {
  beforeEach(() => vi.clearAllMocks());

  it("fires onEditResource when the name is clicked", () => {
    const onEdit = vi.fn();
    render(<ResourceDirectory lang="en-US" resources={rs} roles={[]} disciplines={[]} grades={[]} onAssignRole={vi.fn()} onEditResource={onEdit} onAddResource={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Alex Example" }));
    expect(onEdit).toHaveBeenCalledWith(rs[0]);
  });
  it("fires onAddResource from the add button", () => {
    const onAdd = vi.fn();
    render(<ResourceDirectory lang="en-US" resources={rs} roles={[]} disciplines={[]} grades={[]} onAssignRole={vi.fn()} onEditResource={vi.fn()} onAddResource={onAdd} />);
    fireEvent.click(screen.getByRole("button", { name: /add resource/i }));
    expect(onAdd).toHaveBeenCalled();
  });
  it("renders Open address book button only when the handler is provided", () => {
    const onOpen = vi.fn();
    const { rerender } = render(<ResourceDirectory lang="en-US" resources={rs} roles={[]} disciplines={[]} grades={[]} onAssignRole={vi.fn()} onEditResource={vi.fn()} onAddResource={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /open address book/i })).toBeNull();
    rerender(<ResourceDirectory lang="en-US" resources={rs} roles={[]} disciplines={[]} grades={[]} onAssignRole={vi.fn()} onEditResource={vi.fn()} onAddResource={vi.fn()} onOpenAddressBook={onOpen} />);
    fireEvent.click(screen.getByRole("button", { name: /open address book/i }));
    expect(onOpen).toHaveBeenCalled();
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
});
