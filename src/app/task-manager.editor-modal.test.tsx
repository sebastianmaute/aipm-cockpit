import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, beforeEach } from "vitest";
import TaskManager from "./task-manager";

// Seed one registered project so the multi-project empty-state gate does not
// replace the app chrome (mirrors task-manager.nav-close-edit.test.tsx).
// Default layout is modern.
function seedRegistry() {
  window.localStorage.setItem(
    "aipm-cockpit:projects",
    JSON.stringify({
      projects: [{ id: "p1", name: "Seed", code: "SEED", storageConfig: { kind: "browser" } }],
      currentProjectId: "p1",
    }),
  );
}

describe("TaskManager modern layout uses the floating task-form modal", () => {
  beforeEach(() => {
    window.localStorage.clear();
    seedRegistry();
    globalThis.indexedDB = new IDBFactory();
    window.location.hash = "";
  });

  it("opens the task editor as a role=dialog modal, not a full-page edit view", async () => {
    render(<TaskManager />);

    fireEvent.click(await screen.findByRole("button", { name: "Open Points" }));
    fireEvent.click(await screen.findByRole("button", { name: "Add task" }));

    // The editor now renders as the shared floating TaskFormModal (role=dialog),
    // NOT the retired full-page TaskEditView.
    const dialog = await screen.findByRole("dialog", { name: "New task" });
    expect(dialog).toBeInTheDocument();

    // The underlying view stays Open Points — the modal floats over it rather
    // than replacing the shell with an "edit" page.
    expect(
      screen.getByRole("button", { name: "Open Points" }).getAttribute("aria-current"),
    ).toBe("page");
  });

  it("closes the modal editor on Cancel and returns to Open Points", async () => {
    render(<TaskManager />);

    fireEvent.click(await screen.findByRole("button", { name: "Open Points" }));
    fireEvent.click(await screen.findByRole("button", { name: "Add task" }));
    await screen.findByRole("dialog", { name: "New task" });

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "New task" })).toBeNull();
    });
    expect(
      screen.getByRole("button", { name: "Open Points" }).getAttribute("aria-current"),
    ).toBe("page");
  });
});
