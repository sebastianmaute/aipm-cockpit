import { describe, expect, test } from "vitest";
import { buildProjectAnalysisInput } from "./project-analysis-input";
import { emptyWorkspace, type Workspace } from "./workspace";
import { defaultSettings } from "./settings-types";
import type { Task } from "./types";

const NOW = new Date("2026-10-23T09:00:00Z");

const overdueTask = (id: number): Task =>
  ({
    id, taskName: `Late work ${id}`, assignee: "Liam Foster", assigneeEmail: "", dueDate: "2026-09-01",
    lastUpdateDate: "2026-09-01", priority: "High", status: "In Progress", blockers: "", description: "",
  }) as Task;

const workspace = (over: Partial<Workspace> = {}): Workspace => ({
  ...emptyWorkspace(),
  project: { name: "Apollo" } as Workspace["project"],
  tasks: [overdueTask(1), overdueTask(2)],
  ...over,
});

const run = (ws: Workspace) =>
  buildProjectAnalysisInput({ workspace: ws, deviceSettings: defaultSettings, lang: "en-US", now: NOW });

describe("buildProjectAnalysisInput", () => {
  test("assembles the digest input from the workspace", () => {
    const { digestInput, grounding } = run(workspace());
    expect(digestInput.projectName).toBe("Apollo");
    expect(digestInput.today).toBe("2026-10-23");
    expect(digestInput.tasks).toHaveLength(2);
    expect(grounding["open-points"].has(1)).toBe(true);
  });

  test("a project override of the next-actions config changes the queue", () => {
    const tasks = Array.from({ length: 12 }, (_, i) => overdueTask(i + 1)).map((t) => ({ ...t, assignee: "" }));
    const plain = run(workspace({ tasks }));
    const overridden = run(workspace({ tasks, settingsOverrides: { nextActions: { staticPenalty: 500, clarityBonus: 0 } } }));
    expect(plain.digestInput.queue.length).toBeGreaterThan(0);
    expect(overridden.digestInput.queue).not.toEqual(plain.digestInput.queue);
    expect(overridden.effectiveSettings.nextActions?.staticPenalty).toBe(500);
  });

  test("effectiveSettings.timezone follows the project override", () => {
    const { effectiveSettings } = run(workspace({ settingsOverrides: { timezone: { timezone: "Pacific/Auckland" } } }));
    expect(effectiveSettings.timezone).toBe("Pacific/Auckland");
  });

  test("the day is computed in the effective zone", () => {
    const late = new Date("2026-10-23T20:00:00Z");
    const ws = workspace({ settingsOverrides: { timezone: { timezone: "Pacific/Auckland" } } });
    const { digestInput } = buildProjectAnalysisInput({ workspace: ws, deviceSettings: defaultSettings, lang: "en-US", now: late });
    expect(digestInput.today).toBe("2026-10-24");
  });

  test("queue strings are translated, not raw i18n keys", () => {
    const { digestInput } = run(workspace());
    expect(digestInput.queue.length).toBeGreaterThan(0);
    for (const q of digestInput.queue) {
      expect(q.title).not.toMatch(/^[a-z]+[A-Z][A-Za-z0-9]+$/);
      expect(q.why).not.toMatch(/^[a-z]+[A-Z][A-Za-z0-9]+$/);
      expect(q.title.length).toBeGreaterThan(0);
    }
  });
});
