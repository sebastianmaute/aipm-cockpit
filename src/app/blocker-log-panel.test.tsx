import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { BlockerLogPanel } from "./blocker-log-panel";
import { ConfirmProvider } from "./confirm-dialog";
import { addBlocker, deleteBlocker, editBlocker, reopenBlocker, resolveBlocker } from "./blocker-log";
import { t } from "./i18n";
import type { BlockerEntry, Resource, Task } from "./types";
import { buttonClassFor } from "../test/button-variant";

const EN = "en-US" as const;

const RESOURCES: Resource[] = [
  { id: 1, firstName: "Alice", lastName: "Anders", roleId: null, utilizationMode: "percent", utilization: {} },
];

const NOW = "2026-05-10T09:00:00.000Z";

const OPEN_A: BlockerEntry = { id: 1, text: "Waiting on vendor", createdAt: "2026-05-01T09:00:00.000Z", authorName: "Alice Anders" };
const OPEN_B: BlockerEntry = { id: 2, text: "Legal review", createdAt: "2026-05-02T09:00:00.000Z" };
const RESOLVED_C: BlockerEntry = {
  id: 3,
  text: "Missing access",
  createdAt: "2026-04-01T09:00:00.000Z",
  resolvedAt: "2026-04-03T09:00:00.000Z",
};

// Cast-built: only the blocker fields matter to the panel.
function taskWith(log: BlockerEntry[]): Task {
  return { id: 7, taskName: "Draft charter", blockers: "", blockerLog: log } as unknown as Task;
}

/** Real state + the real mutators, so each test asserts what the user SEES
 *  after a write rather than which callback fired. */
function Harness({ initial, onEditSpy }: { initial: BlockerEntry[]; onEditSpy?: (id: number, text: string) => void }) {
  const [task, setTask] = useState<Task>(() => taskWith(initial));
  return (
    <ConfirmProvider lang={EN}>
      <BlockerLogPanel
        entries={task.blockerLog ?? []}
        onAdd={(text) => setTask((prev) => addBlocker(prev, text, {}, NOW))}
        onEdit={(id, text) => {
          onEditSpy?.(id, text);
          setTask((prev) => editBlocker(prev, id, text, NOW));
        }}
        onResolve={(id) => setTask((prev) => resolveBlocker(prev, id, NOW))}
        onReopen={(id) => setTask((prev) => reopenBlocker(prev, id))}
        onDelete={(id) => setTask((prev) => deleteBlocker(prev, id))}
        resources={RESOURCES}
        lang={EN}
      />
    </ConfirmProvider>
  );
}

function openList(): HTMLElement {
  return screen.getByRole("list", { name: t(EN, "blockerLogOpen") });
}

describe("BlockerLogPanel", () => {
  it("adds an entry and clears the box", () => {
    render(<Harness initial={[]} />);
    const box = screen.getByRole("textbox", { name: t(EN, "blockerLogPlaceholder") });
    fireEvent.change(box, { target: { value: "Waiting on sign-off" } });
    fireEvent.click(screen.getByRole("button", { name: t(EN, "blockerLogAdd") }));

    expect(within(openList()).getByText("Waiting on sign-off")).toBeTruthy();
    expect((box as HTMLTextAreaElement).value).toBe("");
  });

  it("Add is disabled for blank text", () => {
    render(<Harness initial={[]} />);
    const add = screen.getByRole("button", { name: t(EN, "blockerLogAdd") }) as HTMLButtonElement;
    expect(add.disabled).toBe(true);
    fireEvent.change(screen.getByRole("textbox", { name: t(EN, "blockerLogPlaceholder") }), {
      target: { value: "   \n  " },
    });
    expect(add.disabled).toBe(true);
    fireEvent.change(screen.getByRole("textbox", { name: t(EN, "blockerLogPlaceholder") }), {
      target: { value: "Real text" },
    });
    expect(add.disabled).toBe(false);
  });

  it("shows the empty state only when there are no entries at all", () => {
    const { unmount } = render(<Harness initial={[]} />);
    expect(screen.getByText(t(EN, "blockerLogEmpty"))).toBeTruthy();
    unmount();
    render(<Harness initial={[RESOLVED_C]} />);
    expect(screen.queryByText(t(EN, "blockerLogEmpty"))).toBeNull();
  });

  it("says so when entries exist but none is open", () => {
    const { unmount } = render(<Harness initial={[RESOLVED_C]} />);
    expect(screen.getByText(t(EN, "blockerLogNoneOpen"))).toBeTruthy();
    unmount();
    render(<Harness initial={[OPEN_A, RESOLVED_C]} />);
    expect(screen.queryByText(t(EN, "blockerLogNoneOpen"))).toBeNull();
  });

  it("edit to blank keeps the old text", () => {
    const spy = vi.fn();
    render(<Harness initial={[OPEN_A]} onEditSpy={spy} />);
    fireEvent.click(screen.getByRole("button", { name: `${t(EN, "edit")} – #1` }));
    const editor = screen.getByRole("textbox", { name: `${t(EN, "edit")} – #1` });
    fireEvent.change(editor, { target: { value: "   " } });
    const save = screen.getByRole("button", { name: `${t(EN, "blockerLogSave")} – #1` }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.click(save);
    expect(spy).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: `${t(EN, "cancel")} – #1` }));
    expect(within(openList()).getByText("Waiting on vendor")).toBeTruthy();
  });

  it("edit saves the new text", () => {
    render(<Harness initial={[OPEN_A]} />);
    fireEvent.click(screen.getByRole("button", { name: `${t(EN, "edit")} – #1` }));
    fireEvent.change(screen.getByRole("textbox", { name: `${t(EN, "edit")} – #1` }), {
      target: { value: "Waiting on vendor quote" },
    });
    fireEvent.click(screen.getByRole("button", { name: `${t(EN, "blockerLogSave")} – #1` }));
    expect(within(openList()).getByText("Waiting on vendor quote")).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: `${t(EN, "edit")} – #1` })).toBeNull();
  });

  it("shows the author when the entry has one", () => {
    render(<Harness initial={[OPEN_A, OPEN_B]} />);
    expect(within(openList()).getByText("Alice Anders")).toBeTruthy();
  });

  it("resolve moves an entry under Resolved", () => {
    render(<Harness initial={[OPEN_A, OPEN_B]} />);
    fireEvent.click(screen.getByRole("button", { name: `${t(EN, "blockerLogResolve")} – #1` }));

    expect(within(openList()).queryByText("Waiting on vendor")).toBeNull();
    const toggle = screen.getByRole("button", { name: t(EN, "blockerLogResolvedHeading", 1) });
    fireEvent.click(toggle);
    const resolved = screen.getByRole("list", { name: t(EN, "blockerLogResolvedHeading", 1) });
    expect(within(resolved).getByText("Waiting on vendor")).toBeTruthy();
  });

  it("Resolved is collapsed by default and lists the count", () => {
    render(<Harness initial={[OPEN_A, RESOLVED_C]} />);
    const toggle = screen.getByRole("button", { name: t(EN, "blockerLogResolvedHeading", 1) });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    // Collapsed: the resolved list and its controls are hidden from the user.
    const heading = t(EN, "blockerLogResolvedHeading", 1);
    expect(screen.queryByRole("list", { name: heading })).toBeNull();
    expect(screen.queryByRole("button", { name: `${t(EN, "blockerLogReopen")} – #3` })).toBeNull();

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(within(screen.getByRole("list", { name: heading })).getByText("Missing access")).toBeTruthy();
  });

  it("reopen moves it back", () => {
    render(<Harness initial={[OPEN_A, RESOLVED_C]} />);
    fireEvent.click(screen.getByRole("button", { name: t(EN, "blockerLogResolvedHeading", 1) }));
    fireEvent.click(screen.getByRole("button", { name: `${t(EN, "blockerLogReopen")} – #3` }));

    expect(within(openList()).getByText("Missing access")).toBeTruthy();
    // No resolved entries left → no Resolved section.
    expect(screen.queryByRole("button", { name: t(EN, "blockerLogResolvedHeading", 0) })).toBeNull();
  });

  it("delete asks first", async () => {
    render(<Harness initial={[OPEN_A, OPEN_B]} />);

    // Declined: nothing is removed.
    fireEvent.click(screen.getByRole("button", { name: `${t(EN, "delete")} – #1` }));
    expect(await screen.findByText(t(EN, "blockerLogDeleteConfirm"))).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: t(EN, "cancel") }));
    expect(screen.queryByText(t(EN, "blockerLogDeleteConfirm"))).toBeNull();
    expect(within(openList()).getByText("Waiting on vendor")).toBeTruthy();

    // Confirmed: the entry goes.
    fireEvent.click(screen.getByRole("button", { name: `${t(EN, "delete")} – #1` }));
    await screen.findByText(t(EN, "blockerLogDeleteConfirm"));
    fireEvent.click(screen.getByRole("button", { name: t(EN, "delete") }));
    await vi.waitFor(() => {
      expect(screen.queryByText("Waiting on vendor")).toBeNull();
    });
    expect(within(openList()).getByText("Legal review")).toBeTruthy();
  });

  it("per-entry controls have row-unique names", () => {
    render(<Harness initial={[OPEN_A, OPEN_B, RESOLVED_C]} />);
    fireEvent.click(screen.getByRole("button", { name: t(EN, "blockerLogResolvedHeading", 1) }));

    const names = screen.getAllByRole("button").map((b) => b.getAttribute("aria-label") ?? b.textContent ?? "");
    // Positive observable: every per-entry control is present (3 open-row
    // controls × 2 rows + 2 resolved-row controls), so "no duplicates" below
    // cannot pass on an empty list.
    const perEntry = names.filter((n) => / – #\d+$/.test(n));
    expect(perEntry).toHaveLength(8);
    expect(new Set(perEntry).size).toBe(perEntry.length);
    expect(perEntry).toEqual(
      expect.arrayContaining([
        `${t(EN, "edit")} – #1`,
        `${t(EN, "blockerLogResolve")} – #2`,
        `${t(EN, "delete")} – #2`,
        `${t(EN, "blockerLogReopen")} – #3`,
        `${t(EN, "delete")} – #3`,
      ]),
    );
  });
});

// §102 (batch 23): the blocker log's buttons are the shared Button at xs, matching
// the notes log: Edit, Resolve, Reopen, Cancel and Save secondary, Delete destructive.
describe("BlockerLogPanel buttons on the shared Button", () => {
  const secondary = () => buttonClassFor({ variant: "secondary", size: "xs" });
  const destructive = () => buttonClassFor({ variant: "destructive", size: "xs" });

  it("draws an open entry's and a resolved entry's buttons at xs", () => {
    render(<Harness initial={[OPEN_A, RESOLVED_C]} />);
    expect(screen.getByRole("button", { name: "Edit – #1" }).className).toBe(secondary());
    expect(screen.getByRole("button", { name: `${t(EN, "blockerLogResolve")} – #1` }).className).toBe(secondary());
    expect(screen.getByRole("button", { name: "Delete – #1" }).className).toBe(destructive());
    // Resolved is collapsed by default.
    fireEvent.click(screen.getByRole("button", { name: t(EN, "blockerLogResolvedHeading", 1) }));
    expect(screen.getByRole("button", { name: `${t(EN, "blockerLogReopen")} – #3` }).className).toBe(secondary());
    expect(screen.getByRole("button", { name: "Delete – #3" }).className).toBe(destructive());
  });

  it("draws the edit form's Cancel and Save at xs", () => {
    render(<Harness initial={[OPEN_A]} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit – #1" }));
    expect(screen.getByRole("button", { name: "Cancel – #1" }).className).toBe(secondary());
    expect(screen.getByRole("button", { name: `${t(EN, "blockerLogSave")} – #1` }).className).toBe(secondary());
  });
});

// §102 (batch 23, owner decision 2026-10-09): the near-size buttons moved to the shared `xs`.
describe("BlockerLogPanel Add on the shared Button", () => {
  it("draws Add blocker as primary xs, with no matching border (no bordered neighbour)", () => {
    render(<Harness initial={[]} />);
    expect(screen.getByRole("button", { name: t(EN, "blockerLogAdd") }).className).toBe(
      buttonClassFor({ variant: "primary", size: "xs" }),
    );
  });
});

// Review fix (§685): the growing textareas are capped so a long blocker cannot
// push the Add button out of the fixed-height floating window.
describe("BlockerLogPanel draft field height", () => {
  it("caps the auto-growing draft and scrolls inside it", () => {
    render(<Harness initial={[]} />);
    const draft = screen.getByLabelText(t("en-US", "blockerLogPlaceholder"));
    expect(draft.className.split(/\s+/)).toEqual(expect.arrayContaining(["max-h-40", "overflow-y-auto"]));
  });
});
