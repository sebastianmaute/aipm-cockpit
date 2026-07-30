import { beforeEach, describe, expect, it, vi } from "vitest";
import { __resetMintStateForTests } from "./id-mint-session";
import { act, renderHook } from "@testing-library/react";
import { type ReactNode } from "react";
import { useChatDispatcher } from "./use-chat-dispatcher";
import { TestProviders } from "./test-providers";
import { useWorkspace } from "./workspace-context";
import { type Settings } from "./settings-types";
import { type StorageConfig } from "./storage";
import { useTaskForm } from "./task-form-context";
import { type Task } from "./types";
import { ALL_MODULE_IDS, deriveMode } from "./feature-modules";
import { type AppView } from "./nav-config";
import { type SettingsUpdateInput } from "./chat-tools";
import { type DashboardModel } from "./dashboard";
import { type AllocationsSnapshot } from "./alloc-plan/alloc-plan";

/** Minimal stub getters for the dashboard-snapshot deps: none of these tests
 *  exercise get_dashboard_snapshot. `stubGetDashboardModel` throws a named
 *  error rather than yielding a fake object, so a future test that reuses
 *  these fixtures and forgets to override it fails legibly instead of
 *  crashing deep inside buildDashboardSnapshot on an undefined property. */
const stubGetDashboardModel = (): DashboardModel => {
  throw new Error("getDashboardModel not stubbed for this test");
};
const stubGetBudgetRollup = () => null;
/** Same "throw a named error" convention as `stubGetDashboardModel` — none of
 *  these tests exercise list_allocations, and AllocationsSnapshot (unlike
 *  ProjectReport) has no cheap null fallback. */
const stubGetAllocationsSnapshot = (): AllocationsSnapshot => {
  throw new Error("getAllocationsSnapshot not stubbed for this test");
};

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
      description: "",
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
      description: "",
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
      description: "",
      inquiriesSent: 0,
      labels: ["docs"],
    },
  ];
}

/** Dispatcher + live workspace, for the RAID/change/milestone write boundaries.
 *  Their create/update return a SUMMARY (no rich fields), so the only way to
 *  assert what was actually WRITTEN is to read the stored entity. */
function renderRaidProbe() {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <TestProviders>{children}</TestProviders>
  );
  return renderHook(
    () => ({
      d: useChatDispatcher({
        settings: makeSettings(),
        today: "2026-05-19",
        setSelectedIds: vi.fn(),
        setSettings: vi.fn(),
        isReadOnly: false,
        currentView: "raid",
        getDashboardModel: stubGetDashboardModel,
        getBudgetRollup: stubGetBudgetRollup,
        getAllocationsSnapshot: stubGetAllocationsSnapshot,
      }),
      ws: useWorkspace(),
    }),
    { wrapper },
  );
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
        getDashboardModel: stubGetDashboardModel,
        getBudgetRollup: stubGetBudgetRollup,
        getAllocationsSnapshot: stubGetAllocationsSnapshot,
      }),
    { wrapper },
  );
  return { result, setSelectedIds, setSettings };
}

// Reset the session-scoped id minter before EVERY test in this file (all
// describe blocks) so exact-id assertions aren't inflated by ids minted in
// prior tests or other suites.
beforeEach(() => {
  __resetMintStateForTests();
});

describe("useChatDispatcher", () => {
  it("mints monotonic ids: two back-to-back createTask calls get distinct ids", () => {
    const { result } = renderDispatcher([]);
    let a: Task;
    let b: Task;
    act(() => {
      a = result.current.createTask({
        taskName: "First",
        assignee: "Alice",
        dueDate: "2026-06-01",
      });
      b = result.current.createTask({
        taskName: "Second",
        assignee: "Bob",
        dueDate: "2026-06-02",
      });
    });
    expect(a!.id).toBe(1);
    expect(b!.id).toBe(2);
    expect(a!.id).not.toBe(b!.id);
  });

  it("never reuses a deleted task's id within a session", () => {
    const { result } = renderDispatcher([]);
    let a: Task;
    let b: Task;
    act(() => {
      a = result.current.createTask({
        taskName: "First",
        assignee: "Alice",
        dueDate: "2026-06-01",
      });
    });
    act(() => {
      result.current.deleteTask(a!.id);
    });
    act(() => {
      b = result.current.createTask({
        taskName: "Second",
        assignee: "Bob",
        dueDate: "2026-06-02",
      });
    });
    // Old inline mint (max+1 over the now-empty list) would reuse id 1;
    // the session minter must hand out 2.
    expect(a!.id).toBe(1);
    expect(b!.id).toBe(2);
  });

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

  it("updateTask stores HTML in description as HTML, not double-escaped", () => {
    // ★★★ THE SEAM. Task.description is rich HTML, but this is the one rich
    // field whose write boundary was plain-text-in: `plainToHtml(sanitizeNotes(x))`
    // ESCAPES & < >, so an HTML value arriving here was stored as
    // "<p>&lt;p&gt;…&lt;/p&gt;</p>" — literal tags visible in the field, in every
    // export, and in the search index thereafter.
    //
    // ★★ 0.210.0 is what made this REACHABLE: renaming the inline-AI descriptor's
    // dead "notes" to "description" produced a task-description diff for the
    // first time, and the confirm path applies the model's VERBATIM value, which
    // it echoes back as HTML because it was handed the stored HTML to read. The
    // path used to be inert ("No changes to apply.").
    //
    // ★ The existing inline-AI tests stop one hop short of this: they spy on
    // runTool and assert what reaches the tool, never what the tool WRITES.
    const { result } = renderDispatcher();
    const html = "<p><strong>Vendor</strong> delay</p><p>New plan</p>";
    const updated = result.current.updateTask(1, { description: html });
    expect(updated?.description).toBe(html);
    expect(updated?.description).not.toContain("&lt;");
  });

  it("updateTask still upgrades a PLAIN-text description to HTML", () => {
    // The other half: the chat model usually sends prose, and that must still be
    // wrapped and escaped. Fixing the HTML case must not stop this working.
    const { result } = renderDispatcher();
    const updated = result.current.updateTask(1, { description: "a < b\nsecond line" });
    expect(updated?.description).toBe("<p>a &lt; b<br>second line</p>");
  });

  it("createTask stores an HTML description as HTML too", () => {
    // Same boundary, create side — the shape the cold review flagged as the
    // pre-existing twin of the update defect.
    const { result } = renderDispatcher();
    const html = "<p>one</p><p>two</p>";
    const created = result.current.createTask({
      taskName: "Rich",
      assignee: "Ada",
      dueDate: "2026-09-01",
      description: html,
    });
    expect(created?.description).toBe(html);
    expect(created?.description).not.toContain("&lt;");
  });

  it("strips a script from a RAID description the model supplies", () => {
    // ★★★ The fix for Task.description was scoped to ONE entity while the rule it
    // documented said "every rich write boundary". RAID/change/milestone hand a
    // whole object to their entity sanitizer, and those are DOM-FREE
    // (sanitize-records → sanitizeRichText), so they cannot run an allow-list —
    // verified directly: sanitizeRaidItem stored "<script>alert(1)</script>"
    // verbatim. The model's value has to be cleaned before it gets there.
    // ★ createRaid returns a SUMMARY (no description), so the assertion has to
    // read the STORED item — which is also the only thing that proves the write.
    const { result } = renderRaidProbe();
    act(() => {
      result.current.d.createRaid({
        category: "R",
        title: "Vendor risk",
        status: "Open",
        description: "<p>real risk</p><script>alert(1)</script>",
        mitigation: "<p>plan</p><img src=x onerror=alert(2)>",
      });
    });
    const stored = result.current.ws.raid[0];
    expect(stored.description).not.toContain("script");
    expect(stored.description).toContain("real risk");
    expect(stored.mitigation).not.toContain("onerror");
    expect(stored.mitigation).toContain("plan");
  });

  it("keeps a RAID update from erasing the stored description it did not touch", () => {
    // ★★ The other half of the helper's contract, at the real seam: a patch that
    // names only the title must leave description/mitigation exactly as stored.
    // Blanking an unsupplied rich field here would silently wipe both.
    const { result } = renderRaidProbe();
    let id = 0;
    act(() => {
      id = result.current.d.createRaid({
        category: "R",
        title: "Keep me",
        status: "Open",
        description: "<p>original <strong>detail</strong></p>",
      })!.id;
    });
    act(() => {
      result.current.d.updateRaid(id, { title: "Renamed" });
    });
    const stored = result.current.ws.raid[0];
    expect(stored.title).toBe("Renamed");
    expect(stored.description).toBe("<p>original <strong>detail</strong></p>");
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
        description: "",
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

  it("updateSettings applies hideExternalTasks and merges it onto prior settings", () => {
    const { result, setSettings } = renderDispatcher();
    act(() => {
      result.current.updateSettings({ hideExternalTasks: true });
    });
    expect(setSettings).toHaveBeenCalledTimes(1);
    const updater = setSettings.mock.calls[0][0] as (s: Settings) => Settings;
    const prev = makeSettings();
    const next = updater(prev);
    expect(next.hideExternalTasks).toBe(true);
    expect(next.ai).toBe(prev.ai);
  });

  it("updateSettings applies ONLY the allowlisted field from a patch that also carries a secret-adjacent one", () => {
    const { result, setSettings } = renderDispatcher();
    // Simulate the untrusted, arbitrary-shape input the model can actually send —
    // the same `Record<string, unknown> as SettingsUpdateInput` cast `runTool`
    // performs before handing the raw tool-call args to the dispatcher.
    const patch: Record<string, unknown> = {
      hideExternalTasks: true,
      apiKey: "sk-ant-nope",
    };
    act(() => {
      result.current.updateSettings(patch as SettingsUpdateInput);
    });
    expect(setSettings).toHaveBeenCalledTimes(1);
    const updater = setSettings.mock.calls[0][0] as (s: Settings) => Settings;
    const prev = makeSettings();
    const next = updater(prev);
    expect(next.hideExternalTasks).toBe(true);
    expect(next).not.toHaveProperty("apiKey");
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
          getDashboardModel: stubGetDashboardModel,
          getBudgetRollup: stubGetBudgetRollup,
          getAllocationsSnapshot: stubGetAllocationsSnapshot,
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
        getDashboardModel: stubGetDashboardModel,
        getBudgetRollup: stubGetBudgetRollup,
        getAllocationsSnapshot: stubGetAllocationsSnapshot,
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

describe("useChatDispatcher – setTaskDependencies", () => {
  it("writes a valid link: the task's dependencies becomes the applied list", () => {
    const { result } = renderDispatcher();
    const res = result.current.setTaskDependencies(1, [{ taskId: 2, type: "FS" }]);
    expect(res).toMatchObject({
      id: 1,
      dependencies: [{ taskId: 2, type: "FS" }],
      rejected: [],
    });
    expect(result.current.getTask(1)?.dependencies).toEqual([{ taskId: 2, type: "FS" }]);
  });

  it("refuses a wholly-rejected write and preserves the task's existing links (FIX A1)", () => {
    // Task 1 already depends on task 2 (1 -> 2), so proposing 2 -> 1 on task 2
    // would close the loop and must be refused. Task 2 ALSO carries an
    // existing, UNRELATED link to task 3 — that link is the actual subject of
    // this test: it must SURVIVE a write whose every proposed link is
    // rejected, not be silently wiped by an unconditional
    // `dependencies: applied` write. (A prior version of this test seeded
    // task 2 with NO links at all, so `getTask(2)?.dependencies ?? []` passed
    // whether the implementation preserved or erased — it never actually
    // exercised the preserve-on-refusal behaviour.)
    const seeded = seedTasks().map((t) => {
      if (t.id === 1) return { ...t, dependencies: [{ taskId: 2, type: "FS" as const }] };
      if (t.id === 2) return { ...t, dependencies: [{ taskId: 3, type: "FS" as const }] };
      return t;
    });
    const { result } = renderDispatcher(seeded);

    const res = result.current.setTaskDependencies(2, [{ taskId: 1, type: "FS" }]);
    expect(res).toMatchObject({
      id: 2,
      dependencies: [{ taskId: 3, type: "FS" }],
      rejected: [{ taskId: 1, type: "FS", reason: "cycle" }],
    });
    expect(result.current.getTask(2)?.dependencies).toEqual([{ taskId: 3, type: "FS" }]);
  });

  it("reports every omitted existing link in `removed` when a write only partially replaces the list (FIX A2)", () => {
    // Task 2 already links to BOTH task 1 and task 3. The model's replacement
    // list names only task 1 — replace semantics still apply (the omitted
    // link to task 3 IS removed, "clear all" must keep working), but the
    // removal must be visible in `removed` instead of vanishing with zero
    // trace anywhere the transcript shows.
    const seeded = seedTasks().map((t) =>
      t.id === 2
        ? {
            ...t,
            dependencies: [
              { taskId: 1, type: "FS" as const },
              { taskId: 3, type: "SS" as const },
            ],
          }
        : t,
    );
    const { result } = renderDispatcher(seeded);

    const res = result.current.setTaskDependencies(2, [{ taskId: 1, type: "FS" }]);
    expect(res).toMatchObject({
      id: 2,
      dependencies: [{ taskId: 1, type: "FS" }],
      rejected: [],
      removed: [{ taskId: 3, type: "SS" }],
    });
    expect(result.current.getTask(2)?.dependencies).toEqual([{ taskId: 1, type: "FS" }]);
  });

  it("throws in a popout (read-only) and writes nothing", () => {
    const seeded = seedTasks().map((t) =>
      t.id === 1 ? { ...t, dependencies: [{ taskId: 2, type: "FS" as const }] } : t,
    );
    const { result } = renderDispatcher(seeded, true);
    expect(() =>
      result.current.setTaskDependencies(1, [{ taskId: 3, type: "FS" }]),
    ).toThrow();
    expect(result.current.getTask(1)?.dependencies).toEqual([{ taskId: 2, type: "FS" }]);
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
