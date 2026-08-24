// src/app/jira-conflicts-modal.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { JiraConflictsModal, type ConflictResolution } from "./jira-conflicts-modal";
import type { ConflictItem } from "./jira-api";
import type { TaskStatus } from "./types";
import { t } from "./i18n";

// Modal and ModalHeader are pure shells — mock them so there is no portal/DOM
// complexity; the real content under test is the conflict list and the action buttons.
vi.mock("./modal", () => ({
  Modal: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div data-testid="modal">{children}</div> : null,
}));

vi.mock("./modal-header", () => ({
  ModalHeader: ({
    title,
    onClose,
  }: {
    title: string;
    onClose: () => void;
    dragHandleProps?: unknown;
  }) => (
    <div data-testid="modal-header">
      <span>{title}</span>
      <button type="button" onClick={onClose} aria-label={t("en-US", "alertModalClose")}>
        {t("en-US", "alertModalClose")}
      </button>
    </div>
  ),
}));

// Hooks used for dragging / resizing / column-resize — not under test here.
vi.mock("./use-draggable", () => ({
  useDraggable: () => ({ offset: { x: 0, y: 0 }, handleProps: {} }),
}));
vi.mock("./use-resizable", () => ({
  useResizable: () => ({ ref: { current: null } }),
}));
vi.mock("./use-column-resize", () => ({
  useColumnResize: (_key: string, defaults: Record<string, number>) => ({
    colWidths: defaults,
    startColResize: vi.fn(),
  }),
}));
vi.mock("./task-manager-ui", () => ({
  ColumnResizeHandle: () => null,
}));

const CONFLICT: ConflictItem = {
  taskId: 42,
  jiraKey: "PROJ-7",
  jiraIssueType: "Story",
  remoteDone: false,
  remoteStatus: "To Do",
  // No completion field is in conflict, so the local and remote status must
  // agree here (coherent with the fixture carrying no `completedDate` entry).
  localStatus: "To Do",
  fields: [
    { key: "taskName", localValue: "Local title", remoteValue: "Remote title" },
    { key: "priority", localValue: "High", remoteValue: "Low" },
  ],
};

function setup(
  over: Partial<React.ComponentProps<typeof JiraConflictsModal>> = {},
) {
  const onResolve = vi.fn();
  const onClose = vi.fn();
  render(
    <JiraConflictsModal
      lang="en-US"
      conflicts={[CONFLICT]}
      onResolve={onResolve}
      onClose={onClose}
      {...over}
    />,
  );
  return { onResolve, onClose };
}

describe("JiraConflictsModal", () => {
  it("renders the conflict's jiraKey and taskId", () => {
    setup();
    expect(screen.getByText("PROJ-7")).toBeTruthy();
    expect(screen.getByText("#42")).toBeTruthy();
  });

  it("renders local and remote field values", () => {
    setup();
    expect(screen.getByText("Local title")).toBeTruthy();
    expect(screen.getByText("Remote title")).toBeTruthy();
  });

  it("Defer button fires onClose", () => {
    const { onClose } = setup();
    fireEvent.click(screen.getByText(t("en-US", "jiraConflictDefer")));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Apply choices button fires onResolve with current picks", () => {
    const { onResolve } = setup();
    fireEvent.click(screen.getByText(t("en-US", "jiraConflictApply")));
    expect(onResolve).toHaveBeenCalledTimes(1);
    const resolutions = onResolve.mock.calls[0][0] as ConflictResolution[];
    expect(resolutions).toHaveLength(1);
    expect(resolutions[0].taskId).toBe(42);
    expect(resolutions[0].jiraKey).toBe("PROJ-7");
    // Default pick for non-assignee fields is "remote"
    expect(resolutions[0].picks.taskName).toBe("remote");
    expect(resolutions[0].picks.priority).toBe("remote");
  });

  it("Keep local everywhere changes picks to local for non-assignee fields", () => {
    const { onResolve } = setup();
    fireEvent.click(screen.getByText(t("en-US", "jiraConflictAllLocal")));
    fireEvent.click(screen.getByText(t("en-US", "jiraConflictApply")));
    const resolutions = onResolve.mock.calls[0][0] as ConflictResolution[];
    expect(resolutions[0].picks.taskName).toBe("local");
    expect(resolutions[0].picks.priority).toBe("local");
  });

  it("states on the completion row that the pick also sets the status", () => {
    // The completion pick writes `status` as well as `completedDate`, so the
    // row has to say so. The shared CONFLICT fixture carries no completion
    // field, hence a local one.
    const conflict: ConflictItem = {
      taskId: 7,
      jiraKey: "PROJ-9",
      remoteDone: true,
      remoteStatus: "Done",
      // Local completedDate is unset (below), so a coherent local status is
      // anything but "Done" — the invariant `status==="Done" ⟺ completedDate set`.
      localStatus: "In Progress",
      fields: [
        { key: "taskName", localValue: "Local title", remoteValue: "Remote title" },
        { key: "completedDate", localValue: undefined, remoteValue: "2026-05-09" },
      ],
    };
    setup({ conflicts: [conflict] });
    expect(
      screen.getByText(t("en-US", "jiraConflictCompletionNote")),
    ).toBeInTheDocument();
  });

  it("shows no such note when no completion field is in conflict", () => {
    // Guards the condition: without it the note would render on every row.
    setup(); // the shared CONFLICT fixture carries taskName + priority only
    expect(
      screen.queryByText(t("en-US", "jiraConflictCompletionNote")),
    ).toBeNull();
  });

  it("renders both halves of the pair on the completion row", () => {
    // After §226 the completion row can be queued when the DATES are identical
    // and only the status moved. Rendering the date alone then shows the user
    // "—" against "—" — two identical values and nothing to choose between.
    const conflict = {
      taskId: 7,
      jiraKey: "PROJ-9",
      remoteDone: false,
      remoteStatus: "To Do" as TaskStatus,
      localStatus: "In Progress" as TaskStatus,
      fields: [
        { key: "completedDate" as const, localValue: undefined, remoteValue: undefined },
      ],
    } as unknown as ConflictItem;

    setup({ conflicts: [conflict] });

    // Presence alone cannot tell the two sides apart -- a swap that put
    // remoteStatus under the "local" radio and localStatus under the
    // "remote" one would still satisfy a plain getByText pair. Anchor each
    // label on the radio it sits inside: the "local" input is unchecked
    // (default pick is remote), the "remote" input is checked.
    const localLabel = screen.getByText("In Progress").closest("label");
    const remoteLabel = screen.getByText("To Do").closest("label");
    expect(localLabel).not.toBeNull();
    expect(remoteLabel).not.toBeNull();
    const localInput = localLabel!.querySelector("input[type=radio]") as HTMLInputElement;
    const remoteInput = remoteLabel!.querySelector("input[type=radio]") as HTMLInputElement;
    expect(localInput.checked).toBe(false);
    expect(remoteInput.checked).toBe(true);
  });

  it("leaves a non-completion row rendering the value alone", () => {
    // Regression fence: every other key is a single field and must be
    // untouched — no status label may leak onto it.
    setup(); // the shared CONFLICT fixture carries taskName + priority only
    expect(screen.getByText("Local title")).toBeInTheDocument();
    expect(screen.queryByText("In Progress")).toBeNull();
  });
});
