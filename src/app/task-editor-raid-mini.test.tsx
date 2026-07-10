import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TaskEditorRaidMini } from "./task-editor-raid-mini";

describe("TaskEditorRaidMini", () => {
  it("adds a RAID spec via category+title and calls onAdd", () => {
    const onAdd = vi.fn();
    render(<TaskEditorRaidMini lang="en-US" onAdd={onAdd} pending={[]} />);
    fireEvent.click(screen.getByRole("button", { name: /create raid/i }));
    fireEvent.change(screen.getByLabelText(/raid category/i), { target: { value: "R" } });
    fireEvent.change(screen.getByLabelText(/raid title/i), { target: { value: "New risk" } });
    fireEvent.click(screen.getByRole("button", { name: /^add$/i }));
    expect(onAdd).toHaveBeenCalledWith({ category: "R", title: "New risk" });
  });

  it("does not call onAdd for a blank title", () => {
    const onAdd = vi.fn();
    render(<TaskEditorRaidMini lang="en-US" onAdd={onAdd} pending={[]} />);
    fireEvent.click(screen.getByRole("button", { name: /create raid/i }));
    fireEvent.click(screen.getByRole("button", { name: /^add$/i }));
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("renders the pending RAID specs", () => {
    const onAdd = vi.fn();
    render(
      <TaskEditorRaidMini
        lang="en-US"
        onAdd={onAdd}
        pending={[{ category: "A", title: "Buffered assumption" }]}
      />,
    );
    expect(screen.getByText(/buffered assumption/i)).toBeInTheDocument();
  });
});
