// task-manager → TasksSection → TasksToolbar: the wiring of the shared AI not-ready reason. With AI not ready, Open
// Points holds two disabled AI triggers (Optimize with AI from `useWbsPlan` in task-manager, Deduplicate & unify from
// `useTasksDedup` in TasksSection) for the same reason, and the toolbar writes that reason ONCE. The toolbar unit
// test pins the sharing itself; only this file sees task-manager pass `aiOptimizeReason` on.
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Task } from "./types";
import { t } from "./i18n";

const seen = vi.hoisted(() => ({ setTasks: null as null | ((tasks: Task[]) => void) }));
vi.mock("./workspace-context", async (importOriginal) => {
  const mod = await importOriginal<typeof import("./workspace-context")>();
  return {
    ...mod,
    useWorkspace: () => {
      const ws = mod.useWorkspace();
      seen.setTasks = ws.setTasks as unknown as (tasks: Task[]) => void;
      return ws;
    },
  };
});

import TaskManager from "./task-manager";

const task = (id: number, taskName: string) => ({
  id, taskName, assignee: "", assigneeEmail: "", dueDate: "2030-12-31",
  lastUpdateDate: "2030-01-01", status: "To Do", priority: "Medium", blockers: "", description: "",
}) as Task;

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem(
    "aipm-cockpit:projects",
    JSON.stringify({
      projects: [{ id: "p1", name: "Seed", code: "SEED", storageConfig: { kind: "browser" } }],
      currentProjectId: "p1",
    }),
  );
  globalThis.indexedDB = new IDBFactory();
  window.location.hash = "";
});

describe("task-manager → Open Points: the shared AI not-ready reason", () => {
  it("writes the reason once and describes both AI triggers by it", async () => {
    render(<TaskManager />);
    fireEvent.click(await screen.findByRole("button", { name: "Open Points" }, { timeout: 30000 }));
    await vi.waitFor(() => expect(seen.setTasks).not.toBeNull());
    act(() => { seen.setTasks!([task(1, "Write API docs"), task(2, "Write the API documentation")]); });

    const hint = t("en-US", "aiActionNeedsAi");
    const dedup = await screen.findByRole("button", { name: /deduplicate & unify/i }, { timeout: 10000 });
    const optimize = screen.getByRole("button", { name: t("en-US", "wbsPlanButton") });
    expect(screen.getAllByText(hint)).toHaveLength(1);
    for (const btn of [dedup, optimize]) {
      expect(btn).toBeDisabled();
      expect(btn).toHaveAccessibleDescription(hint);
    }
  }, 45000);
});
