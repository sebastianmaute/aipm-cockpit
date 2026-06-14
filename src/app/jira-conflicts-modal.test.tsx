// src/app/jira-conflicts-modal.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { JiraConflictsModal, type ConflictResolution } from "./jira-conflicts-modal";
import type { ConflictItem } from "./jira-api";
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
});
