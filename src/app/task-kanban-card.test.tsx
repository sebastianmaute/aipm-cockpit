import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TaskKanbanCard } from "./task-kanban-card";
import { indexDocumentsByEntity, type DocEntityRef } from "./document-ref";
import type { ProjectDocument } from "./document-model";
import { t } from "./i18n";
import type { RaidItem, Resource, Task } from "./types";
import { expectRowUniqueNames } from "../test/row-unique-names";

const taskFix = (over: Partial<Task> = {}): Task =>
  ({ id: 1, taskName: "Alpha", assignee: "Sam", assigneeEmail: "", dueDate: "2026-06-01",
     lastUpdateDate: "2026-05-01", priority: "High", blockers: "", notes: "",
     status: "In Progress", ...over }) as Task;

const raidFix = (category: RaidItem["category"]): RaidItem =>
  ({ id: 1, category, title: "R1" }) as RaidItem;

const resourceFix = (over: Partial<Resource> = {}): Resource =>
  ({ id: 3, firstName: "Cy", lastName: "Meyer", email: "", ...over }) as Resource;

describe("TaskKanbanCard", () => {
  it("shows title, assignee, and a row-unique status select", () => {
    render(
      <TaskKanbanCard
        lang="en-US"
        task={taskFix()}
        today="2026-06-19"
        holidaySet={new Set()}
        onStatusChange={vi.fn()}
        onEdit={vi.fn()}
        onJumpToRaid={vi.fn()}
      />,
    );
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Sam")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Status – Alpha" })).toBeInTheDocument();
  });

  it("shows a Jira badge and disables the select when synced", () => {
    render(
      <TaskKanbanCard
        lang="en-US"
        task={taskFix({ jiraKey: "LOP-5" })}
        today="2026-06-19"
        holidaySet={new Set()}
        onStatusChange={vi.fn()}
        onEdit={vi.fn()}
        onJumpToRaid={vi.fn()}
      />,
    );
    expect(screen.getByText("LOP-5")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Status – Alpha" })).toBeDisabled();
  });

  // Regression: the board renders cards OUTSIDE the table's RowContextProvider.
  // RaidBadge must take lang/onJumpToRaid as props (not read context) so a card
  // with RAID refs renders without throwing. (Earlier impl crashed here.)
  it("renders a RAID badge from props (no RowContextProvider) and fires onJumpToRaid", () => {
    const onJumpToRaid = vi.fn();
    render(
      <TaskKanbanCard
        lang="en-US"
        task={taskFix()}
        today="2026-06-19"
        holidaySet={new Set()}
        raidRefs={[raidFix("R"), raidFix("I")]}
        onStatusChange={vi.fn()}
        onEdit={vi.fn()}
        onJumpToRaid={onJumpToRaid}
      />,
    );
    const badge = screen.getByRole("button", { name: t("en-US", "raidReferencedBy", 2) });
    fireEvent.click(badge);
    expect(onJumpToRaid).toHaveBeenCalledWith(1);
  });

  it("the person select assigns without a drag, and is row-unique", async () => {
    const onAssign = vi.fn();
    render(
      <TaskKanbanCard
        lang="en-US"
        task={taskFix({ id: 7, taskName: "Alpha" })}
        today="2026-06-19"
        holidaySet={new Set()}
        assignableResources={[resourceFix({ id: 3, firstName: "Cy", lastName: "Meyer" })]}
        onAssign={onAssign}
        onStatusChange={vi.fn()}
        onEdit={vi.fn()}
        onJumpToRaid={vi.fn()}
      />,
    );
    const select = screen.getByRole("combobox", { name: "Assign – Alpha" });
    await userEvent.selectOptions(select, "3");
    expect(onAssign).toHaveBeenCalledWith(7, 3);
  });

  it("a Jira-synced card renders no person select", () => {
    render(
      <TaskKanbanCard
        lang="en-US"
        task={taskFix({ jiraKey: "LOP-8" })}
        today="2026-06-19"
        holidaySet={new Set()}
        assignableResources={[resourceFix()]}
        onAssign={vi.fn()}
        onStatusChange={vi.fn()}
        onEdit={vi.fn()}
        onJumpToRaid={vi.fn()}
      />,
    );
    expect(screen.queryByRole("combobox", { name: /^Assign/ })).toBeNull();
  });

  it("renders no person select when onAssign/assignableResources are absent (board usage)", () => {
    render(
      <TaskKanbanCard
        lang="en-US"
        task={taskFix()}
        today="2026-06-19"
        holidaySet={new Set()}
        onStatusChange={vi.fn()}
        onEdit={vi.fn()}
        onJumpToRaid={vi.fn()}
      />,
    );
    expect(screen.queryByRole("combobox", { name: /^Assign/ })).toBeNull();
  });
});

describe("TaskKanbanCard linked-documents badge", () => {
  const doc = (id: number, links: DocEntityRef[]): ProjectDocument => ({
    id,
    title: `Doc ${id}`,
    blocks: [],
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    linkedEntities: links,
  });

  // Built with the REAL indexer over real documents, so the (kind, id) key
  // derivation is exercised end to end rather than stubbed. `doc(12)` is a DECOY
  // linking raid:7 while Alpha IS task 7 — a count keyed on the bare id inflates
  // Alpha to 3 and fails.
  const documentsByEntity = indexDocumentsByEntity([
    doc(10, [{ kind: "task", id: 7 }, { kind: "task", id: 8 }]),
    doc(11, [{ kind: "task", id: 7 }]),
    doc(12, [{ kind: "raid", id: 7 }]),
  ]);

  // THREE cards on purpose. Two carry a badge with DIFFERENT counts (2 vs 1), so
  // a hardcoded number cannot pass and the `– <taskName>` qualifier is proved to
  // make the name card-unique (WCAG 2.4.6 — axe has no rule for a duplicate
  // accessible name at any seed size, so this test is the only detector).
  function renderCards(onOpenDocuments = vi.fn()) {
    render(
      <>
        {[
          taskFix({ id: 7, taskName: "Alpha" }),
          taskFix({ id: 8, taskName: "Beta" }),
          taskFix({ id: 9, taskName: "Gamma" }),
        ].map((task) => (
          <TaskKanbanCard
            key={task.id}
            lang="en-US"
            task={task}
            today="2026-06-19"
            holidaySet={new Set()}
            documentsByEntity={documentsByEntity}
            onOpenDocuments={onOpenDocuments}
            onStatusChange={vi.fn()}
            onEdit={vi.fn()}
            onJumpToRaid={vi.fn()}
          />
        ))}
      </>,
    );
    return onOpenDocuments;
  }

  it("badges only the referenced cards, with the real count and a card-unique name", () => {
    renderCards();
    const badges = screen.getAllByRole("button", { name: /^Referenced by/ });
    expect(badges.map((b) => b.getAttribute("aria-label"))).toEqual([
      "Referenced by 2 document(s) – Alpha",
      "Referenced by 1 document(s) – Beta",
    ]);
    // Gamma links no document → no badge at all (not a badge reading 0).
    expect(screen.queryByRole("button", { name: /Referenced by .* – Gamma/ })).toBeNull();
    expectRowUniqueNames({ minRows: 5 });
  });

  it("clicking a badge opens the Documents pane for THAT task", () => {
    const onOpenDocuments = renderCards();
    fireEvent.click(screen.getByRole("button", { name: "Referenced by 1 document(s) – Beta" }));
    expect(onOpenDocuments).toHaveBeenCalledWith(8);
  });
});
