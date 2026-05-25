import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ResourceDirectory } from "./resource-directory";
import type { Resource } from "./types";

const rs: Resource[] = [{ id: 1, firstName: "Sample", lastName: "Dummy", title: "Architect", roleId: null, utilizationMode: "percent", utilization: {} }];

describe("ResourceDirectory", () => {
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
});
