import { it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RecommendationReviewModal } from "./recommendation-review-modal";
import type { EditPlan } from "../inline-ai-edit/plan";

const planWithChanges: EditPlan = {
  updates: [{ field: "status", before: "To Do", after: "Done" }],
  creates: [{ entity: "raid", title: "New risk", toolName: "create_raid_item", input: {} }],
  deletes: [{ entity: "task", label: "Old task", toolName: "delete_task", id: 3 }],
  rejected: [],
  links: [],
};
const emptyPlan: EditPlan = { updates: [], creates: [], deletes: [], rejected: [], links: [] };

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
  // ★★ No `entity` here, deliberately — this is the MIXED-PLAN fallback.
  // `describeRecommendationPlan` merges every proposed call's diffs into one
  // plan, so a recommendation touching two registers has no single entity and
  // `recommendationPlanEntity` returns `undefined`. The raw property name is
  // then the honest answer: harder to read, but it cannot be WRONG.
  expect(screen.getByText(/status/)).toBeInTheDocument();
  expect(screen.getByText(/To Do/)).toBeInTheDocument();
  expect(screen.getByText(/Done/)).toBeInTheDocument();
  expect(screen.getByText(/New risk/)).toBeInTheDocument();
  expect(screen.getByText(/Old task/)).toBeInTheDocument();
});

// ★ The other half of the pair above: given an unambiguous entity, the same
// plan renders the register's own field label instead of the property name.
it("names the fields readably when the plan targets one entity", () => {
  render(
    <RecommendationReviewModal
      lang="en-US"
      summary="s"
      plan={planWithChanges}
      entity="task"
      onConfirm={vi.fn()}
      onCancel={vi.fn()}
    />,
  );
  expect(screen.getByText("Status")).toBeInTheDocument();
  expect(screen.queryByText("status")).not.toBeInTheDocument();
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

// ★★★ REWRITTEN, not merely extended. This test used to assert the bare COUNT
// ("2 proposed change(s) no longer apply…"), which pinned the gap: a user was
// told HOW MANY fields would not land but never WHICH. The count string is
// gone; the fields are named.
it("names the fields that will not land when the plan has rejected calls", () => {
  const planWithRejected: EditPlan = {
    updates: [{ field: "status", before: "To Do", after: "Done" }],
    creates: [],
    deletes: [],
    rejected: [
      { toolName: "update_task", reason: "unknown-id", detail: "targetDate=nope" },
      { toolName: "update_raid_item", reason: "unknown-id", detail: "owner=empty" },
    ],
    links: [],
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
  // "Skipped: {0}" — the DETAILS, not a tally.
  expect(screen.getByText("Skipped: targetDate=nope, owner=empty")).toBeInTheDocument();
  expect(screen.queryByText(/no longer apply and will be skipped/i)).toBeNull();
  // Confirm still enabled — there is one real update to apply.
  expect(screen.getByRole("button", { name: /apply recommendation/i })).not.toBeDisabled();
});

// ★★★ This consumer REPLAYS the original tool input through the dispatcher, so
// it really does write these links — and a relationship write REPLACES. An
// unrendered link change is therefore a destructive write the user was never
// shown, not merely an undisclosed one.
it("renders a link change with its resolved titles", () => {
  const planWithLinks: EditPlan = {
    updates: [],
    creates: [],
    deletes: [],
    rejected: [],
    links: [{ field: "linkedTaskIds", before: "Draft brief, Review", after: "Ship", rawIds: [2] }],
  };
  render(
    <RecommendationReviewModal
      lang="en-US"
      summary="s"
      plan={planWithLinks}
      entity="raid"
      onConfirm={vi.fn()}
      onCancel={vi.fn()}
    />,
  );
  // ★★ The READABLE name. This read `getByText("linkedTaskIds")` — the raw
  // property — until field labels landed.
  expect(screen.getByText("Linked tasks")).toBeInTheDocument();
  expect(screen.queryByText("linkedTaskIds")).not.toBeInTheDocument();
  expect(screen.getByText(/Draft brief, Review → Ship/)).toBeInTheDocument();
  // A link-only plan is NOT empty — `isEmptyPlan` counts `links` — so Confirm
  // must stay live and the empty-plan note must not appear.
  expect(screen.getByRole("button", { name: /apply recommendation/i })).not.toBeDisabled();
});

// ★★ `after` can legitimately be "" (every link removed) — the most
// destructive change this modal can show. A bare `{l.after}` renders nothing.
it("renders a cleared link list as an em dash rather than as nothing", () => {
  render(
    <RecommendationReviewModal
      lang="en-US"
      summary="s"
      plan={{
        updates: [],
        creates: [],
        deletes: [],
        rejected: [],
        links: [{ field: "linkedTaskIds", before: "Draft brief", after: "", rawIds: [] }],
      }}
      onConfirm={vi.fn()}
      onCancel={vi.fn()}
    />,
  );
  expect(screen.getByText(/Draft brief → —/)).toBeInTheDocument();
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
