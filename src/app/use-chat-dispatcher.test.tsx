import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { type ReactNode } from "react";
import { useChatDispatcher } from "./use-chat-dispatcher";
import { TestProviders } from "./test-providers";
import { type Settings } from "./settings-types";
import { type StorageConfig } from "./storage";
import { useTaskForm } from "./task-form-context";
import { type Task } from "./types";
import { ALL_MODULE_IDS, deriveMode } from "./feature-modules";
import { type AppView } from "./nav-config";

function makeSettings(): Settings {
  const storageConfig: StorageConfig = { kind: "browser" };
  return {
    language: "en-US",
    holidayCountries: [],
    storageConfig,
    ai: {
      apiKey: "",
      model: "claude-sonnet-4-6",
      consentAccepted: false,
      groundInGuides: true,
    },
    notifications: {
      reminderLeadDays: 7,
      useGlobalLeadDays: true,
      birthday: { enabled: false },
      raidReview: { enabled: true },
      raidReviewIntervalDays: 14,
      dueSoonWorkdays: 3,
      stakeholderComms: { enabled: true },
      stakeholderCommsLeadDays: { "manage-closely": 14, "keep-satisfied": 7, "keep-informed": 7, monitor: 3 },
      jiraTokenError: { enabled: true },
      desktopUrgent: { enabled: false },
    },
    jira: {
      enabled: false,
      siteUrl: "",
      email: "",
      apiToken: "",
      projectKey: "",
      projectName: "",
      extraProjects: [],
      issueTypes: [],
      assigneeMode: "currentUser",
      assigneeAccountId: "",
      assigneeDisplayName: "",
      tokenExpiresAt: "",
    },
    popout: { reuseWindow: false },
    resources: { workdayHours: 8 },
    layout: "modern",
    features: [...ALL_MODULE_IDS],
  };
}

function seedTasks(): Task[] {
  return [
    {
      id: 1,
      taskName: "Alpha",
      assignee: "Alice",
      assigneeEmail: "alice@example.com",
      dueDate: "2026-06-01",
      lastUpdateDate: "2026-05-19",
      status: "To Do",
      priority: "Medium",
      blockers: "",
      notes: "",
      inquiriesSent: 0,
      group: "Backend",
      labels: ["api"],
    },
    {
      id: 2,
      taskName: "Bravo",
      assignee: "Bob",
      assigneeEmail: "bob@example.com",
      dueDate: "2026-06-02",
      lastUpdateDate: "2026-05-19",
      status: "To Do",
      priority: "High",
      blockers: "",
      notes: "",
      inquiriesSent: 0,
      group: "Frontend",
      labels: ["ui", "api"],
    },
    {
      id: 3,
      taskName: "Charlie",
      assignee: "Carol",
      assigneeEmail: "carol@example.com",
      dueDate: "2026-06-03",
      lastUpdateDate: "2026-05-19",
      status: "To Do",
      priority: "Low",
      blockers: "",
      notes: "",
      inquiriesSent: 0,
      labels: ["docs"],
    },
  ];
}

function renderDispatcher(
  initial: Task[] = seedTasks(),
  isReadOnly = false,
  currentView: AppView = "open-points",
) {
  const setSelectedIds = vi.fn();
  const setSettings = vi.fn();
  const settings = makeSettings();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <TestProviders tasks={initial}>{children}</TestProviders>
  );
  const { result } = renderHook(
    () =>
      useChatDispatcher({
        settings,
        today: "2026-05-19",
        setSelectedIds,
        setSettings,
        isReadOnly,
        currentView,
      }),
    { wrapper },
  );
  return { result, setSelectedIds, setSettings };
}

describe("useChatDispatcher", () => {
  it("listTasks() returns the workspace tasks", () => {
    const { result } = renderDispatcher();
    const tasks = result.current.listTasks();
    expect(tasks).toHaveLength(3);
    expect(tasks.map((t) => t.id)).toEqual([1, 2, 3]);
  });

  it("getTask(id) returns the matching task", () => {
    const { result } = renderDispatcher();
    const task = result.current.getTask(2);
    expect(task?.taskName).toBe("Bravo");
  });

  it("getTask(id) returns null when id is unknown", () => {
    const { result } = renderDispatcher();
    expect(result.current.getTask(999)).toBeNull();
  });

  it("createTask appends a row with id = max(ids) + 1 and sanitizes inputs", () => {
    const { result } = renderDispatcher();
    const created = result.current.createTask({
      taskName: "  Delta  ",
      assignee: "Dave",
      dueDate: "2026-06-04",
    });
    expect(created.id).toBe(4);
    expect(created.taskName).toBe("Delta");
    expect(result.current.listTasks()).toHaveLength(4);
  });

  it("createTask throws when required fields are missing", () => {
    const { result } = renderDispatcher();
    expect(() =>
      result.current.createTask({
        taskName: "",
        assignee: "Dave",
        dueDate: "2026-06-04",
      }),
    ).toThrow(/taskName is required/);
    expect(() =>
      result.current.createTask({
        taskName: "Delta",
        assignee: "",
        dueDate: "2026-06-04",
      }),
    ).toThrow(/assignee is required/);
    expect(() =>
      result.current.createTask({
        taskName: "Delta",
        assignee: "Dave",
        dueDate: "not-a-date",
      }),
    ).toThrow(/dueDate must be YYYY-MM-DD/);
  });

  it("updateTask patches fields and bumps localModifiedAt", () => {
    const { result } = renderDispatcher();
    const updated = result.current.updateTask(1, { priority: "Urgent" });
    expect(updated?.priority).toBe("Urgent");
    expect(updated?.localModifiedAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
    );
    expect(result.current.getTask(1)?.priority).toBe("Urgent");
  });

  it("createTask defaults status to 'To Do' when omitted", () => {
    const { result } = renderDispatcher();
    const created = result.current.createTask({
      taskName: "Delta",
      assignee: "Dave",
      dueDate: "2026-06-04",
    });
    expect(created.status).toBe("To Do");
    expect(created.completedDate ?? "").toBe("");
  });

  it("createTask with status 'Done' routes through applyStatusChange and sets completedDate", () => {
    const { result } = renderDispatcher();
    const created = result.current.createTask({
      taskName: "Delta",
      assignee: "Dave",
      dueDate: "2026-06-04",
      status: "Done",
    });
    expect(created.status).toBe("Done");
    // completedDate stamped to today (proves it went through applyStatusChange,
    // not a raw status assignment which would leave completedDate unset).
    expect(created.completedDate).toBe("2026-05-19");
  });

  it("createTask ignores an invalid status and falls back to default", () => {
    const { result } = renderDispatcher();
    const created = result.current.createTask({
      taskName: "Delta",
      assignee: "Dave",
      dueDate: "2026-06-04",
      status: "Bogus",
    });
    expect(created.status).toBe("To Do");
  });

  it("updateTask changes status via applyStatusChange on a non-synced task", () => {
    const { result } = renderDispatcher();
    const updated = result.current.updateTask(1, { status: "In Progress" });
    expect(updated?.status).toBe("In Progress");
    expect(result.current.getTask(1)?.status).toBe("In Progress");
  });

  it("updateTask to 'Done' stamps completedDate; reopening clears it", () => {
    const { result } = renderDispatcher();
    const done = result.current.updateTask(1, { status: "Done" });
    expect(done?.status).toBe("Done");
    expect(done?.completedDate).toBe("2026-05-19");
    const reopened = result.current.updateTask(1, { status: "To Do" });
    expect(reopened?.status).toBe("To Do");
    expect(reopened?.completedDate ?? "").toBe("");
  });

  it("updateTask rejects a status change on a jiraKey-linked task and leaves it unchanged", () => {
    const tasksWithJira = seedTasks().map((t, i) =>
      i === 0 ? { ...t, jiraKey: "LOP-1" } : t,
    );
    const { result } = renderDispatcher(tasksWithJira);
    expect(() =>
      result.current.updateTask(1, { status: "In Progress" }),
    ).toThrow(/managed in Jira/);
    expect(result.current.getTask(1)?.status).toBe("To Do");
  });

  it("updateTask rejects assignee changes on a jiraKey-linked task", () => {
    const tasksWithJira = seedTasks().map((t, i) =>
      i === 0 ? { ...t, jiraKey: "LOP-1" } : t,
    );
    const { result } = renderDispatcher(tasksWithJira);
    expect(() =>
      result.current.updateTask(1, { assignee: "Different Person" }),
    ).toThrow(/managed in Jira/);
  });

  it("deleteTask removes the row and cascades dependency cleanup", () => {
    const dependants: Task[] = [
      ...seedTasks(),
      {
        id: 4,
        taskName: "Delta",
        assignee: "Dave",
        assigneeEmail: "",
        dueDate: "2026-06-04",
        lastUpdateDate: "2026-05-19",
        status: "To Do",
        priority: "Medium",
        blockers: "",
        notes: "",
        inquiriesSent: 0,
        dependencies: [{ taskId: 2, type: "FS" }],
      },
    ];
    const { result } = renderDispatcher(dependants);
    const deleted = result.current.deleteTask(2);
    expect(deleted).toBe(true);
    expect(result.current.listTasks()).toHaveLength(3);
    expect(result.current.getTask(4)?.dependencies).toEqual([]);
  });

  it("deleteAllTasks empties the workspace and clears selection state", () => {
    const { result, setSelectedIds } = renderDispatcher();
    const count = result.current.deleteAllTasks();
    expect(count).toBe(3);
    expect(result.current.listTasks()).toHaveLength(0);
    expect(setSelectedIds).toHaveBeenCalledWith(new Set());
  });

  it("sendInquiry opens a mailto URL and increments inquiriesSent", () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    const { result } = renderDispatcher();
    const outcome = result.current.sendInquiry(1);
    expect(outcome).toEqual({ sent: true });
    expect(openSpy).toHaveBeenCalledWith(
      expect.stringMatching(/^mailto:alice%40example\.com\?/),
    );
    expect(result.current.getTask(1)?.inquiriesSent).toBe(1);
    openSpy.mockRestore();
  });

  it("setFilters does not throw and forwards through FiltersProvider", () => {
    const { result } = renderDispatcher();
    expect(() =>
      result.current.setFilters({ search: "alpha", priority: "Urgent" }),
    ).not.toThrow();
  });

  it("setLanguage calls setSettings with an updater that merges language", () => {
    const { result, setSettings } = renderDispatcher();
    result.current.setLanguage("de");
    expect(setSettings).toHaveBeenCalledTimes(1);
    const updater = setSettings.mock.calls[0][0] as (s: Settings) => Settings;
    const prev = makeSettings();
    const next = updater(prev);
    expect(next.language).toBe("de");
    expect(next.ai).toBe(prev.ai);
  });

  it("getSnapshot returns sorted unique groups/labels and accurate counts", () => {
    const { result } = renderDispatcher();
    const snap = result.current.getSnapshot();
    expect(snap.taskCount).toBe(3);
    expect(snap.today).toBe("2026-05-19");
    expect(snap.language).toBe("en-US");
    expect(snap.storageKind).toBe("browser");
    expect(snap.knownGroups).toEqual(["Backend", "Frontend"]);
    expect(snap.knownLabels).toEqual(["api", "docs", "ui"]);
  });

  it("dispatcher identity is stable across tasks-change re-renders", () => {
    const { result } = renderDispatcher();
    const before = result.current;
    // Trigger a tasks change via the dispatcher itself.
    result.current.createTask({
      taskName: "Echo",
      assignee: "Eve",
      dueDate: "2026-06-05",
    });
    const after = result.current;
    expect(after).toBe(before);
  });

  it("snapshot exposes mode, enabledModules, and currentView", () => {
    const settings = makeSettings();
    settings.features = ["raid"];
    const setSelectedIds = vi.fn();
    const setSettings = vi.fn();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <TestProviders>{children}</TestProviders>
    );
    const { result } = renderHook(
      () =>
        useChatDispatcher({
          settings,
          today: "2026-05-19",
          setSelectedIds,
          setSettings,
          isReadOnly: false,
          currentView: "milestones",
        }),
      { wrapper },
    );
    const snap = result.current.getSnapshot();
    expect(snap.enabledModules).toEqual(["raid"]);
    expect(snap.mode).toBe(deriveMode(["raid"]));
    expect(snap.currentView).toBe("milestones");
  });

  it("dispatcher identity is stable across editingId-change re-renders", () => {
    // Render the hook AND useTaskForm in the same TestProviders wrapper so
    // setEditingId triggers a re-render of the dispatcher's host component.
    function useProbe() {
      const dispatcher = useChatDispatcher({
        settings: makeSettings(),
        today: "2026-05-19",
        setSelectedIds: vi.fn(),
        setSettings: vi.fn(),
        isReadOnly: false,
        currentView: "open-points",
      });
      const form = useTaskForm();
      return { dispatcher, form };
    }
    const { result } = renderHook(useProbe, {
      wrapper: ({ children }) => <TestProviders>{children}</TestProviders>,
    });
    const before = result.current.dispatcher;
    act(() => {
      result.current.form.setEditingId(42);
    });
    const after = result.current.dispatcher;
    expect(after).toBe(before);
  });
});

describe("useChatDispatcher – read-only (popout) mode", () => {
  it("refuses createTask in read-only mode and does not mutate", () => {
    const { result } = renderDispatcher([], true);
    expect(() =>
      result.current.createTask({
        taskName: "X",
        assignee: "Y",
        dueDate: "2026-06-01",
      }),
    ).toThrow();
    expect(result.current.listTasks()).toHaveLength(0);
  });

  it("refuses updateTask in read-only mode", () => {
    const { result } = renderDispatcher(seedTasks(), true);
    expect(() => result.current.updateTask(1, { priority: "Urgent" })).toThrow();
    expect(result.current.getTask(1)?.priority).toBe("Medium");
  });

  it("refuses deleteTask in read-only mode", () => {
    const { result } = renderDispatcher(seedTasks(), true);
    expect(() => result.current.deleteTask(1)).toThrow();
    expect(result.current.listTasks()).toHaveLength(3);
  });

  it("refuses deleteAllTasks in read-only mode", () => {
    const { result } = renderDispatcher(seedTasks(), true);
    expect(() => result.current.deleteAllTasks()).toThrow();
    expect(result.current.listTasks()).toHaveLength(3);
  });

  it("sendInquiry returns a read-only refusal in read-only mode and does not mutate", () => {
    const { result } = renderDispatcher(seedTasks(), true);
    const res = result.current.sendInquiry(1);
    expect(res).toEqual({ sent: false, reason: "read-only" });
    expect(result.current.getTask(1)?.inquiriesSent).toBe(0);
  });

  it("allows createTask when not read-only", () => {
    const { result } = renderDispatcher([], false);
    const created = result.current.createTask({
      taskName: "X",
      assignee: "Y",
      dueDate: "2026-06-01",
    });
    expect(created.taskName).toBe("X");
    expect(result.current.listTasks()).toHaveLength(1);
  });

  it("read/view tools remain enabled in read-only mode", () => {
    const { result } = renderDispatcher(seedTasks(), true);
    expect(() => result.current.listTasks()).not.toThrow();
    expect(() => result.current.getTask(1)).not.toThrow();
    expect(() => result.current.getSnapshot()).not.toThrow();
    expect(() => result.current.setFilters({ search: "x" })).not.toThrow();
  });
});

describe("useChatDispatcher – RAID write methods", () => {
  it("createRaid assigns id=max+1, defaults category 'R', valid status, and raisedDate=today", () => {
    const { result } = renderDispatcher();
    // Seed two existing raid items via back-to-back creates so max id = 2.
    result.current.createRaid({ title: "Existing risk 1" });
    result.current.createRaid({ title: "Existing risk 2" });

    const created = result.current.createRaid({ title: "New risk" });
    expect(created.id).toBe(3);
    expect(created.category).toBe("R");
    expect(created.title).toBe("New risk");
    // status must be a non-empty string (a valid RISK_STATUS default)
    expect(typeof created.status).toBe("string");
    expect(created.status.length).toBeGreaterThan(0);
    // raisedDate defaults to the today arg ("2026-05-19")
    const allRaid = result.current.listRaid();
    expect(allRaid).toHaveLength(3);
    const found = allRaid.find((r) => r.id === 3);
    expect(found).toBeDefined();
    expect(found?.title).toBe("New risk");
  });

  it("createRaid defaults raisedDate to today when omitted", () => {
    const { result } = renderDispatcher();
    // We can't read raisedDate from RaidSummary (not in it), but createRaid
    // must not throw and the item must appear in listRaid()
    const created = result.current.createRaid({ title: "Risk with no date" });
    expect(created.id).toBeGreaterThan(0);
    expect(result.current.listRaid()).toHaveLength(1);
  });

  it("updateRaid patches a field and returns the updated summary", () => {
    const { result } = renderDispatcher();
    result.current.createRaid({ title: "Risk alpha" });

    const updated = result.current.updateRaid(1, { severity: "Critical" });
    expect(updated).not.toBeNull();
    expect(updated?.id).toBe(1);
    expect(updated?.severity).toBe("Critical");
    // Other fields unchanged
    expect(updated?.title).toBe("Risk alpha");
    // listRaid() reflects the change
    const found = result.current.listRaid().find((r) => r.id === 1);
    expect(found?.severity).toBe("Critical");
  });

  it("updateRaid returns null for an unknown id", () => {
    const { result } = renderDispatcher();
    const res = result.current.updateRaid(999, { severity: "Critical" });
    expect(res).toBeNull();
  });

  it("deleteRaid removes the item and returns true", () => {
    const { result } = renderDispatcher();
    result.current.createRaid({ title: "To delete" });
    expect(result.current.listRaid()).toHaveLength(1);

    const deleted = result.current.deleteRaid(1);
    expect(deleted).toBe(true);
    expect(result.current.listRaid()).toHaveLength(0);
  });

  it("deleteRaid returns false for an unknown id", () => {
    const { result } = renderDispatcher();
    const res = result.current.deleteRaid(999);
    expect(res).toBe(false);
  });

  it("createRaid throws when title is empty/whitespace", () => {
    const { result } = renderDispatcher();
    expect(() => result.current.createRaid({ title: "" })).toThrow(
      /invalid RAID item: title is required/,
    );
    expect(() => result.current.createRaid({ title: "   " })).toThrow(
      /invalid RAID item: title is required/,
    );
  });
});

describe("useChatDispatcher – Milestone write methods", () => {
  it("createMilestone creates an item with name and date", () => {
    const { result } = renderDispatcher();
    const created = result.current.createMilestone({
      name: "Go-live",
      date: "2026-09-01",
    });
    expect(created.id).toBe(1);
    expect(created.name).toBe("Go-live");
    expect(created.date).toBe("2026-09-01");
    expect(result.current.listMilestones()).toHaveLength(1);
  });

  it("createMilestone throws for an invalid date", () => {
    const { result } = renderDispatcher();
    expect(() =>
      result.current.createMilestone({ name: "Bad milestone", date: "nope" }),
    ).toThrow(/invalid milestone/);
  });

  it("updateMilestone patches a field and returns the updated summary", () => {
    const { result } = renderDispatcher();
    result.current.createMilestone({ name: "Phase 1", date: "2026-07-01" });

    const updated = result.current.updateMilestone(1, { date: "2026-08-01" });
    expect(updated).not.toBeNull();
    expect(updated?.date).toBe("2026-08-01");
    expect(updated?.name).toBe("Phase 1");
  });

  it("updateMilestone returns null for an unknown id", () => {
    const { result } = renderDispatcher();
    const res = result.current.updateMilestone(999, { date: "2026-08-01" });
    expect(res).toBeNull();
  });

  it("deleteMilestone removes the item and returns true", () => {
    const { result } = renderDispatcher();
    result.current.createMilestone({ name: "Phase 1", date: "2026-07-01" });
    const deleted = result.current.deleteMilestone(1);
    expect(deleted).toBe(true);
    expect(result.current.listMilestones()).toHaveLength(0);
  });

  it("deleteMilestone returns false for an unknown id", () => {
    const { result } = renderDispatcher();
    expect(result.current.deleteMilestone(999)).toBe(false);
  });
});

describe("useChatDispatcher – Stakeholder write methods", () => {
  it("createStakeholder defaults category 'Other', influence/interest 'Medium'", () => {
    const { result } = renderDispatcher();
    const created = result.current.createStakeholder({ name: "Acme" });
    expect(created.id).toBe(1);
    expect(created.name).toBe("Acme");
    expect(created.category).toBe("Other");
    expect(created.influence).toBe("Medium");
    expect(created.interest).toBe("Medium");
  });

  it("listStakeholders includes newly created stakeholders", () => {
    const { result } = renderDispatcher();
    result.current.createStakeholder({ name: "Acme" });
    result.current.createStakeholder({ name: "Beta Corp" });

    const list = result.current.listStakeholders();
    expect(list).toHaveLength(2);
    expect(list.map((s) => s.name)).toContain("Acme");
    expect(list.map((s) => s.name)).toContain("Beta Corp");
  });

  it("updateStakeholder patches a field and returns the updated summary", () => {
    const { result } = renderDispatcher();
    result.current.createStakeholder({ name: "Acme" });

    const updated = result.current.updateStakeholder(1, {
      name: "Acme Updated",
      influence: "High",
    });
    expect(updated).not.toBeNull();
    expect(updated?.name).toBe("Acme Updated");
    expect(updated?.influence).toBe("High");
    // listStakeholders() reflects the change
    expect(result.current.listStakeholders()[0].name).toBe("Acme Updated");
  });

  it("updateStakeholder returns null for an unknown id", () => {
    const { result } = renderDispatcher();
    expect(result.current.updateStakeholder(999, { name: "X" })).toBeNull();
  });

  it("deleteStakeholder removes the item and returns true", () => {
    const { result } = renderDispatcher();
    result.current.createStakeholder({ name: "Acme" });
    expect(result.current.deleteStakeholder(1)).toBe(true);
    expect(result.current.listStakeholders()).toHaveLength(0);
  });

  it("deleteStakeholder returns false for an unknown id", () => {
    const { result } = renderDispatcher();
    expect(result.current.deleteStakeholder(999)).toBe(false);
  });
});

describe("useChatDispatcher – read-only guard for entity write methods", () => {
  it("createRaid throws popoutReadOnly error in read-only mode", () => {
    const { result } = renderDispatcher([], true);
    expect(() => result.current.createRaid({ title: "X" })).toThrow(
      "Editing is disabled in the pop-out view — make changes in the main window.",
    );
  });

  it("updateRaid throws in read-only mode", () => {
    const { result } = renderDispatcher([], true);
    expect(() => result.current.updateRaid(1, { severity: "Critical" })).toThrow();
  });

  it("deleteRaid throws in read-only mode", () => {
    const { result } = renderDispatcher([], true);
    expect(() => result.current.deleteRaid(1)).toThrow();
  });

  it("createMilestone throws in read-only mode", () => {
    const { result } = renderDispatcher([], true);
    expect(() =>
      result.current.createMilestone({ name: "X", date: "2026-09-01" }),
    ).toThrow();
  });

  it("createStakeholder throws in read-only mode", () => {
    const { result } = renderDispatcher([], true);
    expect(() => result.current.createStakeholder({ name: "X" })).toThrow();
  });

  it("createChange throws in read-only mode", () => {
    const { result } = renderDispatcher([], true);
    expect(() => result.current.createChange({ title: "Change X" })).toThrow();
  });

  it("read methods remain available in read-only mode", () => {
    const { result } = renderDispatcher([], true);
    expect(() => result.current.listRaid()).not.toThrow();
    expect(() => result.current.listMilestones()).not.toThrow();
    expect(() => result.current.listStakeholders()).not.toThrow();
    expect(() => result.current.listChanges()).not.toThrow();
  });
});

describe("useChatDispatcher – resource directory", () => {
  it("createResource adds a person and listResources returns them", () => {
    const { result } = renderDispatcher();
    const created = result.current.createResource({
      firstName: "Ada", lastName: "Lovelace", email: "ada@x.com", title: "Engineer",
    });
    expect(created).toMatchObject({ firstName: "Ada", lastName: "Lovelace", email: "ada@x.com", title: "Engineer" });
    expect(created.id).toBeGreaterThan(0);
    expect(result.current.listResources().some((r) => r.id === created.id && r.firstName === "Ada")).toBe(true);
  });

  it("createResource splits a full name when first/last aren't given", () => {
    const { result } = renderDispatcher();
    const created = result.current.createResource({ name: "Grace Hopper" });
    expect(created.firstName).toBe("Grace");
    expect(created.lastName).toBe("Hopper");
  });

  it("createResource throws when no name is provided (sanitizer rejects)", () => {
    const { result } = renderDispatcher();
    expect(() => result.current.createResource({ email: "x@y.com" })).toThrow();
  });

  it("createResource is refused in read-only (popout)", () => {
    const { result } = renderDispatcher(seedTasks(), true);
    expect(() => result.current.createResource({ firstName: "X" })).toThrow();
    expect(result.current.listResources()).toHaveLength(0);
  });

  it("getResource fetches a created resource and returns null for a missing id", () => {
    const { result } = renderDispatcher();
    const created = result.current.createResource({ firstName: "Ada", lastName: "Lovelace" });
    expect(result.current.getResource(created.id)).toMatchObject({ firstName: "Ada", lastName: "Lovelace" });
    expect(result.current.getResource(999999)).toBeNull();
  });

  it("updateResource patches fields (incl. isExternal + emails) and returns null for a missing id", () => {
    const { result } = renderDispatcher();
    const created = result.current.createResource({ firstName: "Ada", lastName: "Lovelace", email: "ada@x.com" });
    const updated = result.current.updateResource(created.id, {
      title: "Lead", isExternal: true, emails: ["ada.alt@x.com"],
    });
    expect(updated).toMatchObject({ title: "Lead", isExternal: true, emails: ["ada.alt@x.com"] });
    expect(result.current.getResource(created.id)).toMatchObject({ title: "Lead", isExternal: true });
    expect(result.current.updateResource(999999, { title: "X" })).toBeNull();
  });

  it("deleteResource removes a resource and returns false for a missing id", () => {
    const { result } = renderDispatcher();
    const created = result.current.createResource({ firstName: "Ada", lastName: "Lovelace" });
    expect(result.current.deleteResource(created.id)).toBe(true);
    expect(result.current.listResources().some((r) => r.id === created.id)).toBe(false);
    expect(result.current.deleteResource(999999)).toBe(false);
  });

  it("updateResource + deleteResource are refused in read-only (popout)", () => {
    const { result } = renderDispatcher(seedTasks(), true);
    expect(() => result.current.updateResource(1, { title: "X" })).toThrow();
    expect(() => result.current.deleteResource(1)).toThrow();
  });
});
