import { it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MilestoneEditModal } from "./milestone-edit-modal";

it("renders a new-milestone form without crashing", () => {
  render(
    <MilestoneEditModal
      lang="en-US"
      milestone={{ id: 1, name: "", date: "2026-08-01", linkedTaskIds: [] }}
      isNew
      tasks={[]}
      onSave={vi.fn()}
      onDelete={vi.fn()}
      onClose={vi.fn()}
    />,
  );
  expect(screen.getByText(/new milestone/i)).toBeTruthy();
});
