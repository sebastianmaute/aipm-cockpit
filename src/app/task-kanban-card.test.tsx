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
  // ★★★ RECORDED, NOT FIXED — a genuine, pre-existing WCAG 2.4.6 collision that
  // touches a SHARED primitive and is not fixable locally. Two cards for the
  // SAME task name render two comboboxes both named "Status – Alpha":
  // `TaskStatusSelect` (task-status-select.tsx) derives its aria-label from
  // `task.taskName` alone, with no per-render disambiguation, and it is a
  // per-item component with no visibility into sibling rows — it cannot build
  // a token map itself. The identical defect exists in the TABLE row
  // (task-row.tsx uses the same `TaskStatusSelect`), so fixing it means
  // threading a row-token prop through TaskStatusSelect AND both of its
  // callers (task-kanban-card.tsx/board/swimlanes AND task-row.tsx) — real
  // restructuring, not a local qualifier swap. Joins budget-panel /
  // roles-editor / reports as the fourth surface recorded this way (see
  // batch 4/6 commits on this branch). Kept as the ORIGINAL single-card smoke
  // test — seeding a twin here would only pin the bug in place.
  it("shows title, assignee, and a status select carrying an accessible name", () => {
    render(
      <TaskKanbanCard
        lang="en-US"
        task={taskFix()}
        rowToken="Alpha"
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
        rowToken="Alpha"
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
        rowToken="Alpha"
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

  // ★★★ RECORDED, NOT FIXED — same class of collision as the status select
  // above. Two cards with the SAME taskName render two "Assign – Alpha"
  // comboboxes (the inline `<Select aria-label={t(lang,"assignPersonLabel",
  // task.taskName)}>` in task-kanban-card.tsx, keyed on task.taskName alone).
  // TaskKanbanCard is a per-item component with no visibility into sibling
  // cards, so it cannot disambiguate itself — fixing needs a token threaded
  // down from the board/swimlanes caller. Kept as the ORIGINAL single-card
  // test; seeding a twin here would only pin the bug in place.
  it("the person select assigns without a drag", async () => {
    const onAssign = vi.fn();
    render(
      <TaskKanbanCard
        lang="en-US"
        task={taskFix({ id: 7, taskName: "Alpha" })}
        rowToken="Alpha"
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
        rowToken="Alpha"
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
        rowToken="Alpha"
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
            rowToken={task.taskName}
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
    expectRowUniqueNames({ minControls: 5 });
  });

  it("clicking a badge opens the Documents pane for THAT task", () => {
    const onOpenDocuments = renderCards();
    fireEvent.click(screen.getByRole("button", { name: "Referenced by 1 document(s) – Beta" }));
    expect(onOpenDocuments).toHaveBeenCalledWith(8);
  });
});
