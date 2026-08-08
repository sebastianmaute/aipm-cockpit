import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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
    const caret = screen.getByRole("button", { name: t("en-US", "undoShowHistory") });
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
    expect(screen.getByRole("button", { name: t("en-US", "undoShowHistory") })).toBeInTheDocument();
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
    await userEvent.click(screen.getByRole("button", { name: t("en-US", "redoShowHistory") }));
    // Display order is newest-first, so the last option is the OLDEST entry, id 1.
    await userEvent.click(screen.getAllByRole("option")[2]);
    expect(onRedoThrough).toHaveBeenCalledWith(1);
  });
});

describe("UndoControl history listbox", () => {
  it("lists every entry newest-first inside a listbox", async () => {
    renderUndo();
    await userEvent.click(screen.getByRole("button", { name: t("en-US", "undoShowHistory") }));
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(3);
    expect(options[0]).toHaveTextContent("Delete 2 tasks");
  });

  it("gives duplicate labels UNIQUE accessible names by stack position", async () => {
    renderUndo();
    await userEvent.click(screen.getByRole("button", { name: t("en-US", "undoShowHistory") }));
    const names = screen.getAllByRole("option").map((o) => o.getAttribute("aria-label"));
    expect(new Set(names).size).toBe(names.length);
  });

  it("hovering row n marks rows 0..n as banded and updates the footer count", async () => {
    renderUndo();
    await userEvent.click(screen.getByRole("button", { name: t("en-US", "undoShowHistory") }));
    const options = screen.getAllByRole("option");
    await userEvent.hover(options[2]);
    expect(options.filter((o) => o.getAttribute("data-banded") === "true")).toHaveLength(3);
    expect(screen.getByText(t("en-US", "undoNActions", 3))).toBeInTheDocument();
  });

  it("marks ONLY the active option aria-selected, not the whole band", async () => {
    renderUndo();
    await userEvent.click(screen.getByRole("button", { name: t("en-US", "undoShowHistory") }));
    const options = screen.getAllByRole("option");
    await userEvent.hover(options[2]);
    expect(options.filter((o) => o.getAttribute("aria-selected") === "true")).toHaveLength(1);
    expect(options[2]).toHaveAttribute("aria-selected", "true");
  });

  it("arrow keys move the active option and Enter commits through it", async () => {
    const { onUndoThrough } = renderUndo();
    await userEvent.click(screen.getByRole("button", { name: t("en-US", "undoShowHistory") }));
    await userEvent.keyboard("{ArrowDown}{ArrowDown}{Enter}");
    // Display order is newest-first, so index 2 is the OLDEST entry, id 1.
    expect(onUndoThrough).toHaveBeenCalledWith(1);
  });

  it("exposes one tab stop, driving the active option via aria-activedescendant", async () => {
    renderUndo();
    await userEvent.click(screen.getByRole("button", { name: t("en-US", "undoShowHistory") }));
    const list = screen.getByRole("listbox");
    expect(list).toHaveAttribute("aria-activedescendant");
    expect(screen.getAllByRole("option").every((o) => o.getAttribute("tabindex") === null)).toBe(true);
  });

  it("renders nothing for an empty stack", () => {
    render(<UndoControl lang="en-US" entries={[]} onUndo={vi.fn()} onUndoThrough={vi.fn()} />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});

// ★★★ WHAT THESE CANNOT COVER: that the option actually MOVES INTO VIEW. jsdom
// has no layout — no scroll offsets, no viewport, and no real `scrollIntoView`
// (vitest.setup.ts installs a no-op stub). These pin the WIRING that makes the
// browser's scroll possible — WHICH element is scrolled, with WHICH `block`, and
// on which interactions — and nothing about the scroll itself. Do not read a
// green run here as "the active option is visible".
describe("UndoControl history listbox — active-option scroll", () => {
  /** Records the id + `block` of every scroll. The id is what makes this fail on
   *  a wrong-element match rather than as an opaque length mismatch. */
  let scrolls: { id: string; block?: string }[] = [];
  const originalScrollIntoView = Element.prototype.scrollIntoView;

  beforeEach(() => {
    scrolls = [];
    Element.prototype.scrollIntoView = function (
      this: Element,
      arg?: boolean | ScrollIntoViewOptions,
    ) {
      scrolls.push({
        id: this.getAttribute("id") ?? "(no id)",
        block: typeof arg === "object" ? arg.block : undefined,
      });
    };
  });

  afterEach(() => {
    Element.prototype.scrollIntoView = originalScrollIntoView;
  });

  it("scrolls the newly-active option into view on an arrow move", async () => {
    renderUndo();
    await userEvent.click(screen.getByRole("button", { name: t("en-US", "undoShowHistory") }));
    // Opening alone must not scroll — index 0 is at the top of a fresh list.
    expect(scrolls).toEqual([]);
    await userEvent.keyboard("{ArrowDown}");
    const activeId = screen.getByRole("listbox").getAttribute("aria-activedescendant");
    // Same source as aria-activedescendant: the scrolled row IS the announced one.
    expect(scrolls).toEqual([{ id: activeId, block: "nearest" }]);
  });

  it("does NOT scroll when the active option moves by HOVER", async () => {
    renderUndo();
    await userEvent.click(screen.getByRole("button", { name: t("en-US", "undoShowHistory") }));
    const options = screen.getAllByRole("option");
    await userEvent.hover(options[2]);
    // The hover DID take effect — otherwise this asserts nothing.
    expect(options[2]).toHaveAttribute("aria-selected", "true");
    expect(scrolls).toEqual([]);
  });
});

// ★★ The REAL trigger for this guard — a keyboard scroll sliding a row under a
// stationary pointer — cannot be reproduced here: jsdom has no layout, so
// nothing scrolls and no boundary event is synthesised. What IS reproducible is
// the SHAPE of that event: a `mouseenter` with no `mousemove` before it. These
// pin the guard on that shape. Measured in Chromium (11 entries, pointer resting
// on row 3): End landed on option 5 and the footer read "Undo 6 actions" instead
// of "Undo 11 actions", so Enter would have reverted six edits after the user
// asked for eleven.
describe("UndoControl history listbox — keyboard position survives a pointerless mouseenter", () => {
  async function openList() {
    renderUndo();
    await userEvent.click(screen.getByRole("button", { name: t("en-US", "undoShowHistory") }));
    return screen.getAllByRole("option");
  }

  it("ignores a mouseenter that arrives with no pointer movement after a key move", async () => {
    const options = await openList();
    await userEvent.keyboard("{End}");
    expect(screen.getByText(t("en-US", "undoNActions", 3))).toBeInTheDocument();

    // No mousemove first: this is what a scroll-induced enter looks like.
    fireEvent.mouseEnter(options[0]);

    expect(screen.getByText(t("en-US", "undoNActions", 3))).toBeInTheDocument();
    expect(options[2]).toHaveAttribute("aria-selected", "true");
  });

  it("re-arms hover as soon as the pointer actually moves", async () => {
    const options = await openList();
    await userEvent.keyboard("{End}");

    fireEvent.mouseMove(window);
    fireEvent.mouseEnter(options[0]);

    expect(screen.getByText(t("en-US", "undoNActions", 1))).toBeInTheDocument();
    expect(options[0]).toHaveAttribute("aria-selected", "true");
  });

  it("does not block hover before any key has been pressed", async () => {
    const options = await openList();
    fireEvent.mouseEnter(options[1]);
    expect(options[1]).toHaveAttribute("aria-selected", "true");
  });
});

// ★★★ THE STACK CAN SHRINK UNDER AN OPEN PANEL. `use-undo-hotkey` listens on
// `document` and skips only INPUT/TEXTAREA/SELECT/contenteditable — the focused
// listbox <ul> is none of those — so Ctrl/⌘+Z (and Ctrl+Y / Ctrl+Shift+Z on the
// redo control) pops an entry while this list is open and `activeIndex` keeps
// pointing past the end. The rerender below IS that event: same open panel,
// fewer entries.
describe("UndoControl history listbox — a shrinking stack", () => {
  it("clamps the active option, the footer count and aria-activedescendant", async () => {
    const onUndoThrough = vi.fn();
    const { rerender } = render(
      <UndoControl lang="en-US" entries={STACK} onUndo={vi.fn()} onUndoThrough={onUndoThrough} />,
    );
    await userEvent.click(screen.getByRole("button", { name: t("en-US", "undoShowHistory") }));
    await userEvent.keyboard("{End}");
    // Setup proof: the index really is at the last row before the stack shrinks.
    expect(screen.getByText(t("en-US", "undoNActions", 3))).toBeInTheDocument();

    rerender(
      <UndoControl
        lang="en-US"
        entries={STACK.slice(0, 2)}
        onUndo={vi.fn()}
        onUndoThrough={onUndoThrough}
      />,
    );

    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(2);
    // The footer is the half `options[activeIndex]?.id` would NOT fix: without
    // the clamp it still reads "Undo 3 action(s)" over two rows.
    expect(screen.getByText(t("en-US", "undoNActions", 2))).toBeInTheDocument();
    expect(screen.getByRole("listbox")).toHaveAttribute(
      "aria-activedescendant",
      options[1].getAttribute("id"),
    );
    expect(options.filter((o) => o.getAttribute("aria-selected") === "true")).toHaveLength(1);
    expect(options[1]).toHaveAttribute("aria-selected", "true");
  });

  it("commits through the LAST REMAINING entry on Enter instead of throwing", async () => {
    const onUndoThrough = vi.fn();
    const { rerender } = render(
      <UndoControl lang="en-US" entries={STACK} onUndo={vi.fn()} onUndoThrough={onUndoThrough} />,
    );
    await userEvent.click(screen.getByRole("button", { name: t("en-US", "undoShowHistory") }));
    await userEvent.keyboard("{End}");
    rerender(
      <UndoControl
        lang="en-US"
        entries={STACK.slice(0, 2)}
        onUndo={vi.fn()}
        onUndoThrough={onUndoThrough}
      />,
    );
    // Unclamped this threw `Cannot read properties of undefined (reading 'id')`.
    await userEvent.keyboard("{Enter}");
    // Newest-first display, so the clamped last row is the OLDEST survivor, id 1.
    expect(onUndoThrough).toHaveBeenCalledWith(1);
  });

  it("steps ArrowUp from the clamped row, not from the stranded index", async () => {
    const onUndoThrough = vi.fn();
    const { rerender } = render(
      <UndoControl lang="en-US" entries={STACK} onUndo={vi.fn()} onUndoThrough={onUndoThrough} />,
    );
    await userEvent.click(screen.getByRole("button", { name: t("en-US", "undoShowHistory") }));
    await userEvent.keyboard("{End}");
    rerender(
      <UndoControl
        lang="en-US"
        entries={STACK.slice(0, 2)}
        onUndo={vi.fn()}
        onUndoThrough={onUndoThrough}
      />,
    );
    await userEvent.keyboard("{ArrowUp}");
    // From the stored 2 a bare `i - 1` lands on 1 (no visible move); from the
    // clamped 1 it lands on 0.
    expect(screen.getByText(t("en-US", "undoNActions", 1))).toBeInTheDocument();
    expect(screen.getAllByRole("option")[0]).toHaveAttribute("aria-selected", "true");
  });
});

// WCAG 2.4.3. `PopoverPanel` autofocuses the <ul>; nothing restores focus when
// the panel unmounts, so without `close()` doing it the next Tab restarts at the
// top of the document. `.focus()` proves nothing on its own — what is asserted
// here is `document.activeElement` after each close path.
describe("UndoControl history popover — focus return", () => {
  async function openAndAssertFocusMoved() {
    const onUndoThrough = vi.fn();
    render(
      <UndoControl lang="en-US" entries={STACK} onUndo={vi.fn()} onUndoThrough={onUndoThrough} />,
    );
    const caret = screen.getByRole("button", { name: t("en-US", "undoShowHistory") });
    await userEvent.click(caret);
    // Without this the "focus is on the caret afterwards" assertions would be
    // satisfied by focus never having LEFT the caret.
    expect(document.activeElement).toBe(screen.getByRole("listbox"));
    return { caret, onUndoThrough };
  }

  it("returns focus to the caret when an option is clicked", async () => {
    const { caret } = await openAndAssertFocusMoved();
    await userEvent.click(screen.getAllByRole("option")[1]);
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(document.activeElement).toBe(caret);
  });

  it("returns focus to the caret when Enter commits", async () => {
    const { caret } = await openAndAssertFocusMoved();
    await userEvent.keyboard("{Enter}");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(document.activeElement).toBe(caret);
  });

  it("returns focus to the caret on Escape", async () => {
    const { caret } = await openAndAssertFocusMoved();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(document.activeElement).toBe(caret);
  });
});

// ★ The panel is the listbox's only accessible-name owner now — labelling the
//   role="dialog" wrapper too made AT announce the name twice.
describe("UndoControl history popover — accessible naming", () => {
  it("names the listbox and does NOT repeat that name on the dialog", async () => {
    renderUndo();
    await userEvent.click(screen.getByRole("button", { name: t("en-US", "undoShowHistory") }));
    expect(screen.getByRole("listbox")).toHaveAttribute(
      "aria-label",
      t("en-US", "undoHistoryLabel"),
    );
    expect(screen.getByRole("dialog")).not.toHaveAttribute("aria-label");
  });
});
