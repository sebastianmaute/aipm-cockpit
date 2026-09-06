import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TaskKanbanCard } from "./task-kanban-card";
import { indexDocumentsByEntity, type DocEntityRef } from "./document-ref";
import type { ProjectDocument } from "./document-model";
import { t } from "./i18n";
import type { RaidItem, Resource, Task } from "./types";
import { expectRowUniqueNames } from "../test/row-unique-names";
import { buildRowTokens, rowLabel } from "./row-tokens";

const taskFix = (over: Partial<Task> = {}): Task =>
  ({ id: 1, taskName: "Alpha", assignee: "Sam", assigneeEmail: "", dueDate: "2026-06-01",
     lastUpdateDate: "2026-05-01", priority: "High", blockers: "", notes: "",
     status: "In Progress", ...over }) as Task;

const raidFix = (category: RaidItem["category"]): RaidItem =>
  ({ id: 1, category, title: "R1" }) as RaidItem;

const resourceFix = (over: Partial<Resource> = {}): Resource =>
  ({ id: 3, firstName: "Cy", lastName: "Meyer", email: "", ...over }) as Resource;

describe("TaskKanbanCard", () => {
  // `TaskStatusSelect` derives its accessible name from `rowLabel(t(lang,
  // "colTaskStatus"), rowToken)` (task-status-select.tsx), so this remains the
  // single-card smoke test; the twin case is covered by "keeps every card
  // control distinct when two tasks share a name" below, which renders
  // `TaskStatusSelect` for two same-named tasks and asserts zero collisions.
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
    // The badge's name now carries the card's row token — a bare count has no
    // row identity, so two cards with equal ref counts used to collide — and it
    // LEADS with the visible count text, so the name contains the visible text
    // (WCAG 2.5.3). The exact string is pinned in task-raid-badge.test.tsx;
    // here the point is only that the badge renders and is clickable outside
    // RowContextProvider, so the name is composed the way the component does.
    const badge = screen.getByRole("button", {
      name: rowLabel(rowLabel(t("en-US", "raidReferencedByCount", 2), t("en-US", "raidReferencedBy", 2)), "Alpha"),
    });
    fireEvent.click(badge);
    expect(onJumpToRaid).toHaveBeenCalledWith(1);
  });

  // FIXED (was: "RECORDED, NOT FIXED" — same class of collision as the status
  // select above). The inline `<Select aria-label={t(lang,"assignPersonLabel",
  // rowToken)}>` now keys on the row-unique token rather than `task.taskName`
  // alone, mirroring the fix already threaded through TaskStatusSelect. Kept
  // as the single-card smoke test; the twin case is covered by "keeps every
  // card control distinct when two tasks share a name" below.
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

  const DEFAULT_CARDS: Task[] = [
    taskFix({ id: 7, taskName: "Alpha" }),
    taskFix({ id: 8, taskName: "Beta" }),
    taskFix({ id: 9, taskName: "Gamma" }),
  ];

  // THREE cards on purpose (default fixture). Two carry a badge with DIFFERENT
  // counts (2 vs 1), so a hardcoded number cannot pass and the qualifier is
  // proved to make the name card-unique (WCAG 2.4.6 — axe has no rule for a
  // duplicate accessible name at any seed size, so this test is the only
  // detector).
  //
  // ★★ TOKENS COME FROM `buildRowTokens`, NOT `task.taskName` DIRECTLY —
  // mirrors what the real board/swimlane callers do at
  // `task-kanban-board.tsx`/`task-kanban-swimlanes.tsx`, even though
  // DEFAULT_CARDS' three names are already distinct. (The shared-name
  // collision case is covered by "keeps every card control distinct when two
  // tasks share a name" below, which renders inline instead of through this
  // helper — it needs onAiEdit/aiEditEnabled/assignableResources/onAssign,
  // which this fixed three-card render does not exercise.)
  function renderCards(onOpenDocuments = vi.fn()) {
    const tokens = buildRowTokens(DEFAULT_CARDS.map((task) => ({ id: task.id, name: task.taskName })));
    render(
      <>
        {DEFAULT_CARDS.map((task) => (
          <TaskKanbanCard
            key={task.id}
            lang="en-US"
            task={task}
            rowToken={tokens.get(task.id) ?? task.taskName}
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
    return { onOpenDocuments };
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
    const { onOpenDocuments } = renderCards();
    fireEvent.click(screen.getByRole("button", { name: "Referenced by 1 document(s) – Beta" }));
    expect(onOpenDocuments).toHaveBeenCalledWith(8);
  });

  // WCAG 2.4.6 collision covering all FIVE sites this fix touches: the name
  // button (previously had no aria-label at all — its accessible name was its
  // CONTENT, so two "Alpha" cards collided on the most prominent control on
  // the card), DocumentBadge's `entityTitle`, the inline Ask-Claude trigger
  // and the assign select — each previously keyed on `task.taskName` alone —
  // plus `RaidBadge`, whose name was the bare reference COUNT with no row
  // identity at all (`raidRefs` is seeded on both cards below; leaving it
  // unseeded is why that site went uncaught). Only `rowToken` (built via
  // `buildRowTokens`, mirroring what
  // task-kanban-board.tsx/task-kanban-swimlanes.tsx pass in production)
  // distinguishes the two cards.
  it("keeps every card control distinct when two tasks share a name", () => {
    const twins = [
      taskFix({ id: 1, taskName: "Alpha" }),
      taskFix({ id: 2, taskName: "Alpha" }),
    ];
    const tokens = buildRowTokens(twins.map((task) => ({ id: task.id, name: task.taskName })));
    const twinDocs = indexDocumentsByEntity([
      doc(20, [{ kind: "task", id: 1 }]),
      doc(21, [{ kind: "task", id: 2 }]),
    ]);
    const { container } = render(
      <>
        {twins.map((task) => (
          <TaskKanbanCard
            key={task.id}
            lang="en-US"
            task={task}
            rowToken={tokens.get(task.id) ?? task.taskName}
            today="2026-06-19"
            holidaySet={new Set()}
            documentsByEntity={twinDocs}
            onOpenDocuments={vi.fn()}
            raidRefs={[raidFix("R"), raidFix("I")]}
            onStatusChange={vi.fn()}
            onEdit={vi.fn()}
            onJumpToRaid={vi.fn()}
            onAiEdit={vi.fn()}
            aiEditEnabled={() => true}
            assignableResources={[resourceFix()]}
            onAssign={vi.fn()}
          />
        ))}
      </>,
    );
    expectRowUniqueNames({
      // MEASURED (floor 999, read the printed `Rendered: [...]` length):
      // 10 before `raidRefs` seeded a RaidBadge onto each of the two cards.
      minControls: 12,
      scope: container,
      roles: ["button", "combobox"],
      requireCollisionSeed: true,
    });
  });
});
