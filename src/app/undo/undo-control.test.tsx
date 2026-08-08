import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { t } from "../i18n";
import { UndoControl, RedoControl } from "./undo-control";

// ★ `kind` must be a real ActivityKind member and must NOT widen to string.
//   "task.edited" DOES NOT EXIST — the task members are task.created /
//   task.updated / task.deleted / task.completed / task.reopened
//   (`activity-log.ts:13-17`). An invented literal or a widened `string` both
//   run green under vitest (which never typechecks) and fail ONLY tsc in CI.
const meta = (id: number, label: string) => ({
  id, kind: "task.updated" as const, count: 1, timestamp: "2026-08-08T00:00:00.000Z", label,
});

// Stack order is oldest-first, matching UndoStackApi.stack.
const STACK = [meta(1, 'Edit task "A"'), meta(2, 'Edit task "A"'), meta(3, 'Delete 2 tasks')];

function renderUndo(onUndoThrough = vi.fn(), onUndo = vi.fn()) {
  render(
    <UndoControl lang="en-US" entries={STACK} onUndo={onUndo} onUndoThrough={onUndoThrough} />,
  );
  return { onUndoThrough, onUndo };
}

describe("UndoControl", () => {
  it("renders nothing when the stack is empty", () => {
    const { container } = render(
      <UndoControl lang="en-US" entries={[]} onUndo={() => {}} onUndoThrough={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders a labeled button with the depth and fires onUndo", async () => {
    const onUndo = vi.fn();
    render(
      <UndoControl lang="en-US" entries={STACK} onUndo={onUndo} onUndoThrough={vi.fn()} />,
    );
    const btn = screen.getByRole("button", { name: t("en-US", "undoTooltip") });
    expect(btn).toHaveAttribute("aria-label");
    expect(btn).toHaveTextContent("3");
    await userEvent.click(btn);
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  // Was "caret opens a popover previewing the next entry's label" — the single-entry
  // preview is gone; the caret now opens the multi-step history.
  it("caret toggles the history popover", async () => {
    renderUndo();
    const caret = screen.getByRole("button", { name: t("en-US", "undoShowNext") });
    expect(caret).toHaveAttribute("aria-haspopup");
    expect(caret).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(caret);
    expect(caret).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });

  // Was "renders no caret when nextLabel is absent" — there is no preview label to
  // gate on any more, so the caret rides the stack depth alone.
  it("renders the caret for any non-empty stack, including a single entry", () => {
    render(
      <UndoControl
        lang="en-US"
        entries={[meta(7, 'Edit task "Solo"')]}
        onUndo={vi.fn()}
        onUndoThrough={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: t("en-US", "undoShowNext") })).toBeInTheDocument();
  });
});

describe("RedoControl", () => {
  it("renders nothing when the redo stack is empty", () => {
    const { container } = render(
      <RedoControl lang="en-US" entries={[]} onRedo={() => {}} onRedoThrough={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders a labeled button with the depth and fires onRedo", async () => {
    const onRedo = vi.fn();
    render(
      <RedoControl
        lang="en-US"
        entries={STACK.slice(0, 2)}
        onRedo={onRedo}
        onRedoThrough={vi.fn()}
      />,
    );
    const btn = screen.getByRole("button", { name: t("en-US", "redoTooltip") });
    expect(btn).toHaveAttribute("aria-label");
    expect(btn).toHaveTextContent("2");
    await userEvent.click(btn);
    expect(onRedo).toHaveBeenCalledTimes(1);
  });

  it("commits through the clicked option via onRedoThrough", async () => {
    const onRedoThrough = vi.fn();
    render(
      <RedoControl lang="en-US" entries={STACK} onRedo={vi.fn()} onRedoThrough={onRedoThrough} />,
    );
    await userEvent.click(screen.getByRole("button", { name: t("en-US", "redoShowNext") }));
    // Display order is newest-first, so the last option is the OLDEST entry, id 1.
    await userEvent.click(screen.getAllByRole("option")[2]);
    expect(onRedoThrough).toHaveBeenCalledWith(1);
  });
});

describe("UndoControl history listbox", () => {
  it("lists every entry newest-first inside a listbox", async () => {
    renderUndo();
    await userEvent.click(screen.getByRole("button", { name: t("en-US", "undoShowNext") }));
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(3);
    expect(options[0]).toHaveTextContent("Delete 2 tasks");
  });

  it("gives duplicate labels UNIQUE accessible names by stack position", async () => {
    renderUndo();
    await userEvent.click(screen.getByRole("button", { name: t("en-US", "undoShowNext") }));
    const names = screen.getAllByRole("option").map((o) => o.getAttribute("aria-label"));
    expect(new Set(names).size).toBe(names.length);
  });

  it("hovering row n marks rows 0..n as banded and updates the footer count", async () => {
    renderUndo();
    await userEvent.click(screen.getByRole("button", { name: t("en-US", "undoShowNext") }));
    const options = screen.getAllByRole("option");
    await userEvent.hover(options[2]);
    expect(options.filter((o) => o.getAttribute("data-banded") === "true")).toHaveLength(3);
    expect(screen.getByText(t("en-US", "undoNActions", 3))).toBeInTheDocument();
  });

  it("marks ONLY the active option aria-selected, not the whole band", async () => {
    renderUndo();
    await userEvent.click(screen.getByRole("button", { name: t("en-US", "undoShowNext") }));
    const options = screen.getAllByRole("option");
    await userEvent.hover(options[2]);
    expect(options.filter((o) => o.getAttribute("aria-selected") === "true")).toHaveLength(1);
    expect(options[2]).toHaveAttribute("aria-selected", "true");
  });

  it("arrow keys move the active option and Enter commits through it", async () => {
    const { onUndoThrough } = renderUndo();
    await userEvent.click(screen.getByRole("button", { name: t("en-US", "undoShowNext") }));
    await userEvent.keyboard("{ArrowDown}{ArrowDown}{Enter}");
    // Display order is newest-first, so index 2 is the OLDEST entry, id 1.
    expect(onUndoThrough).toHaveBeenCalledWith(1);
  });

  it("exposes one tab stop, driving the active option via aria-activedescendant", async () => {
    renderUndo();
    await userEvent.click(screen.getByRole("button", { name: t("en-US", "undoShowNext") }));
    const list = screen.getByRole("listbox");
    expect(list).toHaveAttribute("aria-activedescendant");
    expect(screen.getAllByRole("option").every((o) => o.getAttribute("tabindex") === null)).toBe(true);
  });

  it("renders nothing for an empty stack", () => {
    render(<UndoControl lang="en-US" entries={[]} onUndo={vi.fn()} onUndoThrough={vi.fn()} />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
