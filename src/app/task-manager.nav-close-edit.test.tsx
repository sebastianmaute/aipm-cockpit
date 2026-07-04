import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, beforeEach } from "vitest";
import TaskManager from "./task-manager";

// Seed one registered project so the multi-project empty-state gate does not
// replace the app chrome these tests assert against (mirrors
// task-manager.shell.test.tsx). Default layout is modern.
function seedRegistry() {
  window.localStorage.setItem(
    "lop-app:projects",
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
});
