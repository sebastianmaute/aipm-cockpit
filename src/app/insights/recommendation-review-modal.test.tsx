import { it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RecommendationReviewModal } from "./recommendation-review-modal";
import type { EditPlan } from "../inline-ai-edit/plan";

const planWithChanges: EditPlan = {
  updates: [{ field: "status", before: "To Do", after: "Done" }],
  creates: [{ entity: "raid", title: "New risk", toolName: "create_raid_item", input: {} }],
  deletes: [{ entity: "task", label: "Old task", toolName: "delete_task", id: 3 }],
  rejected: [],
};
const emptyPlan: EditPlan = { updates: [], creates: [], deletes: [], rejected: [] };

it("renders the summary and the plan's updates/creates/deletes", () => {
  render(
    <RecommendationReviewModal
      lang="en-US"
      summary="Mark the overdue task done"
      plan={planWithChanges}
      onConfirm={vi.fn()}
      onCancel={vi.fn()}
    />,
  );
  expect(screen.getByText("Mark the overdue task done")).toBeInTheDocument();
  expect(screen.getByText(/status/)).toBeInTheDocument();
  expect(screen.getByText(/To Do/)).toBeInTheDocument();
  expect(screen.getByText(/Done/)).toBeInTheDocument();
  expect(screen.getByText(/New risk/)).toBeInTheDocument();
  expect(screen.getByText(/Old task/)).toBeInTheDocument();
});

it("calls onConfirm when Confirm is clicked", () => {
  const onConfirm = vi.fn();
  render(
    <RecommendationReviewModal
      lang="en-US"
      summary="s"
      plan={planWithChanges}
      onConfirm={onConfirm}
      onCancel={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /apply recommendation/i }));
  expect(onConfirm).toHaveBeenCalledTimes(1);
});

it("calls onCancel when Cancel is clicked", () => {
  const onCancel = vi.fn();
  render(
    <RecommendationReviewModal
      lang="en-US"
      summary="s"
      plan={planWithChanges}
      onConfirm={vi.fn()}
      onCancel={onCancel}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(onCancel).toHaveBeenCalledTimes(1);
});

it("surfaces a skipped-count notice when the plan has rejected calls", () => {
  const planWithRejected: EditPlan = {
    updates: [{ field: "status", before: "To Do", after: "Done" }],
    creates: [],
    deletes: [],
    rejected: [
      { toolName: "update_task", reason: "unknown-id", detail: "99" },
      { toolName: "update_raid_item", reason: "unknown-id", detail: "42" },
    ],
  };
  render(
    <RecommendationReviewModal
      lang="en-US"
      summary="s"
      plan={planWithRejected}
      onConfirm={vi.fn()}
      onCancel={vi.fn()}
    />,
  );
  // "{0} proposed change(s) no longer apply and will be skipped."
  expect(screen.getByText(/no longer apply and will be skipped/i)).toBeInTheDocument();
  expect(screen.getByText(/^2 /)).toBeInTheDocument();
  // Confirm still enabled — there is one real update to apply.
  expect(screen.getByRole("button", { name: /apply recommendation/i })).not.toBeDisabled();
});

it("disables Confirm and shows the empty-plan note when the plan has no changes", () => {
  render(
    <RecommendationReviewModal
      lang="en-US"
      summary="s"
      plan={emptyPlan}
      onConfirm={vi.fn()}
      onCancel={vi.fn()}
    />,
  );
  expect(screen.getByRole("button", { name: /apply recommendation/i })).toBeDisabled();
  expect(screen.getByText(/no remaining changes/i)).toBeInTheDocument();
});
