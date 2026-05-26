import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { SortableTh } from "./task-manager-ui";

describe("SortableTh", () => {
  it("shows a 'Sort by <label>' tooltip and the resources-matching hover class", () => {
    render(
      <table><thead><tr>
        <SortableTh label="Task" sortKey="taskName" currentKey="taskName" dir="asc" onClick={vi.fn()} lang="en-US" />
      </tr></thead></table>,
    );
    const btn = screen.getByRole("button", { name: /task/i });
    expect(btn).toHaveAttribute("title", "Sort by Task");
    expect(btn.className).toContain("hover:text-zinc-800");
  });
});
