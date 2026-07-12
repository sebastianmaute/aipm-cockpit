import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, beforeEach } from "vitest";
import TaskManager from "./task-manager";
import { createBackend, emptyWorkspace } from "./storage";
import type { Task } from "./types";

// Seed one registered project so the multi-project empty-state gate does not
// replace the app chrome these tests assert against (mirrors
// task-manager.shell.test.tsx). Default layout is modern.
function seedRegistry() {
  window.localStorage.setItem(
    "aipm-cockpit:projects",
    JSON.stringify({
      projects: [{ id: "p1", name: "Seed", code: "SEED", storageConfig: { kind: "browser" } }],
      currentProjectId: "p1",
    }),
  );
}

describe("TaskManager modern-shell nav while the full-page task editor is open", () => {
  beforeEach(() => {
    window.localStorage.clear();
    seedRegistry();
    // Fresh in-memory IndexedDB per test so a seeded task doesn't leak
    // across cases (mirrors browser-backend.test.ts).
    globalThis.indexedDB = new IDBFactory();
    window.location.hash = "";
  });

  it("closes the editor and navigates to the clicked view instead of snapping back to edit", async () => {
    render(<TaskManager />);

    // Reach Open Points and open the full-page task editor.
    fireEvent.click(await screen.findByRole("button", { name: "Open Points" }));
    fireEvent.click(await screen.findByRole("button", { name: "Add task" }));
    // The editor title renders in both the TopBar <h1> and the editor's own
    // <h2> heading, so assert on the count rather than a single unique node.
    expect((await screen.findAllByText("New task")).length).toBeGreaterThan(0);

    // Clicking a different sidebar entry while editing must SILENTLY discard
    // the in-progress edit (same as Cancel) and land on the clicked view —
    // not revert back to the editor (the bug: the taskModalOpen<->"edit" sync
    // effect used to instantly snap activeTab back to "edit").
    fireEvent.click(screen.getByRole("button", { name: "Milestones" }));

    await waitFor(() => {
      expect(screen.queryAllByText("New task").length).toBe(0);
    });
    expect(screen.getByRole("button", { name: "Milestones" }).getAttribute("aria-current")).toBe(
      "page",
    );
  });

  it("closes the editor when the alerts bell is clicked (top-bar nav path, not the sidebar)", async () => {
    render(<TaskManager />);

    fireEvent.click(await screen.findByRole("button", { name: "Open Points" }));
    fireEvent.click(await screen.findByRole("button", { name: "Add task" }));
    expect((await screen.findAllByText("New task")).length).toBeGreaterThan(0);

    // The alerts bell wires directly to setActiveTab("actions") — it never
    // goes through the sidebar's onNavigate handler, so this exercises a
    // different code path than the test above.
    fireEvent.click(screen.getByRole("button", { name: "Show due-date notifications" }));

    await waitFor(() => {
      expect(screen.queryAllByText("New task").length).toBe(0);
    });
    expect(screen.getByRole("button", { name: "Next actions" }).getAttribute("aria-current")).toBe(
      "page",
    );
  });

  it("closes the editor when the top-bar Ask-Claude menu navigates to chat, instead of snapping back to edit", async () => {
    render(<TaskManager />);

    fireEvent.click(await screen.findByRole("button", { name: "Open Points" }));
    fireEvent.click(await screen.findByRole("button", { name: "Add task" }));
    expect((await screen.findAllByText("New task")).length).toBeGreaterThan(0);

    // The Ask-Claude menu's onAsk wires to requestChat(body, true), which
    // calls setActiveTab("chat") directly — another nav path that never goes
    // through the sidebar's onNavigate handler (and, unlike global search,
    // requestChat carries no item id so it does not write the URL hash,
    // keeping this test's timing deterministic).
    fireEvent.click(screen.getByRole("button", { name: "Ask Claude" }));
    fireEvent.click(await screen.findByRole("button", { name: "What's next?" }));

    await waitFor(() => {
      expect(screen.queryAllByText("New task").length).toBe(0);
    });
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("AI Assistant");
  });

  it("clears the stale deep-link flash target on nav-away, so a later normal editor close does not flash the wrong row", async () => {
    // Seed one existing task directly into storage — need an existing item
    // to deep-link to below, without the ceremony of driving the create form.
    const task: Task = {
      id: 1,
      taskName: "Zephyr Alpha",
      assignee: "Ann",
      assigneeEmail: "",
      dueDate: "2030-01-01",
      lastUpdateDate: "2026-01-01",
      priority: "Medium",
      status: "To Do",
      blockers: "",
      notes: "",
    };
    await createBackend({ kind: "browser" }).save({ ...emptyWorkspace(), tasks: [task] });

    render(<TaskManager />);
    fireEvent.click(await screen.findByRole("button", { name: "Open Points" }));
    await screen.findByText("Zephyr Alpha");

    // Deep-link that task via the URL hash — the same requestOpen path a real
    // cross-view deep link (Action-Center/Dashboard chip, global search) uses,
    // and the only path that arms flashOnEditReturnRef.
    window.location.hash = "#open-points/1";
    await waitFor(() => {
      expect(screen.getAllByDisplayValue("Zephyr Alpha").length).toBeGreaterThan(0);
    });
    // requestOpen writes the hash via direct assignment, which can trigger one
    // delayed, self-reentrant `hashchange` (a documented race — see
    // use-hash-view.ts's doc comment on why the VIEW->hash write uses
    // replaceState instead). Let that fully settle before proceeding so it
    // can't land in the middle of the nav-away below.
    await new Promise((resolve) => setTimeout(resolve, 100));
    await waitFor(() => {
      expect(screen.getAllByDisplayValue("Zephyr Alpha").length).toBeGreaterThan(0);
    });

    // NAV-AWAY while editing (branch 2 of the taskModalOpen<->activeTab sync
    // effect): must silently discard the edit AND — the fix under test —
    // clear the stale flash target, not just close the editor.
    fireEvent.click(screen.getByRole("button", { name: "Milestones" }));
    await waitFor(() => {
      expect(screen.queryAllByDisplayValue("Zephyr Alpha").length).toBe(0);
    });

    // Back on Open Points, open the editor NORMALLY (not a deep link) and
    // cancel it. Before the fix, the stale flashOnEditReturnRef left over
    // from the deep-linked task above would still be armed, so this
    // unrelated close would wrongly fire requestFlash for "Zephyr Alpha"'s
    // row.
    fireEvent.click(screen.getByRole("button", { name: "Open Points" }));
    // With a task already in the list, the toolbar's icon "Add task" button
    // and the table's inline dashed quick-add row both share that accessible
    // name — the toolbar button (first in the DOM) is the one under test.
    fireEvent.click((await screen.findAllByRole("button", { name: "Add task" }))[0]);
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Open Points" }).getAttribute("aria-current"),
      ).toBe("page");
    });
    const row = screen.getByText("Zephyr Alpha").closest("tr");
    expect(row).not.toBeNull();
    expect(row!.className).not.toContain("outline-AIPM-green");
  });
});
