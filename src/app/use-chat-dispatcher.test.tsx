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
import { type ActivityKind } from "./activity-log";
import { CALENDAR_SUMMARY_KEYS, runTool, type SettingsUpdateInput } from "./chat-tools";
import { type DocumentUpdateResult } from "./chat-tools-documents";
import { type DocOp } from "./document-mutations";
import { MAX_BLOCKS_PER_DOC } from "./document-model";
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
        timezone: "UTC",
        setSelectedIds: vi.fn(),
        setSettings: vi.fn(),
        isReadOnly: false,
        currentView: "raid",
        settingsProjectId: "default", holidaySet: new Set<string>(),
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
  // ★ Deliberately OPTIONAL and left undefined by every other call in this
  // file: `logActivity` is an optional prop on ChatDispatcherArgs, so the ~60
  // callers below are the standing proof that omitting it does not throw
  // (the document-tool tests among them exercise every write path with it
  // absent). Only the ai.documentWrite suite passes a spy.
  logActivity?: (kind: ActivityKind, ...args: (string | number)[]) => void,
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
        timezone: "UTC",
        setSelectedIds,
        setSettings,
        isReadOnly,
        currentView,
        settingsProjectId: "default", holidaySet: new Set<string>(),
        getDashboardModel: stubGetDashboardModel,
        getBudgetRollup: stubGetBudgetRollup,
        getAllocationsSnapshot: stubGetAllocationsSnapshot,
        logActivity,
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

  // ★★★ open-followups §49. `sanitizeRaidItem` builds its result from an explicit
  //   field list and `noteLog` is NOT in it — and it CANNOT be, because the
  //   sanitizer is DOM-free by contract (it runs under bare node in the sample
  //   generator) while `sanitizeNoteLog` calls DOMPurify. So the round-trip through
  //   the sanitizer silently dropped the whole log: "push R#3's target date to June"
  //   erased every note on it, with no undo capture on AI writes to recover from.
  //   ★ The fix re-applies the STORED log after sanitizing — same "stored row wins"
  //   rule the RAID editor fix (§48) established, because `noteLog` is write-through
  //   and is not in any AI tool schema, so a patch can never legitimately carry one.
  it("keeps a RAID update from erasing the stored note log", () => {
    const { result } = renderRaidProbe();
    let id = 0;
    act(() => {
      id = result.current.d.createRaid({ category: "R", title: "Keep my notes", status: "Open" })!.id;
    });
    // A note exists on the stored row (the notes window writes through).
    act(() => {
      result.current.ws.setRaid((prev) =>
        prev.map((r) =>
          r.id === id
            ? { ...r, noteLog: [{ id: 1, timestamp: "2026-05-21T00:00:00.000Z", html: "<p>keep</p>", text: "keep" }] }
            : r,
        ),
      );
    });
    act(() => {
      result.current.d.updateRaid(id, { targetDate: "2026-06-30" });
    });
    const stored = result.current.ws.raid[0];
    expect(stored.targetDate).toBe("2026-06-30");
    expect(stored.noteLog?.map((n) => n.text)).toEqual(["keep"]);
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

  // ★★★ The same defect as §49, one register over: `sanitizeChangeItem` drops
  //   `noteLog` for the same DOM-free reason, so `update_change` erased the log.
  //   AI writes take no undo capture, so the loss is unrecoverable.
  it("update_change preserves the stored note log", () => {
    const { result } = renderRaidProbe();
    const log = [{ id: 1, timestamp: "2026-01-01T00:00:00.000Z", html: "<p>keep me</p>", text: "keep me" }];
    let id = 0;
    act(() => {
      id = result.current.d.createChange({ title: "Scope cut", status: "Proposed" })!.id;
    });
    // The note exists on the STORED row — the notes window writes through, and
    // `noteLog` is in no AI tool schema, so a patch can never carry one.
    act(() => {
      result.current.ws.setChanges((prev) => prev.map((c) => (c.id === id ? { ...c, noteLog: log } : c)));
    });
    // A title-only patch: the model never mentions noteLog, so nothing but the
    // sanitizer can be responsible if the log disappears.
    act(() => {
      result.current.d.updateChange(id, { title: "Scope cut v2" });
    });
    const stored = result.current.ws.changes[0];
    expect(stored.title).toBe("Scope cut v2");
    expect(stored.noteLog).toEqual(log);
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
          timezone: "UTC",
          setSelectedIds,
          setSettings,
          isReadOnly: false,
          currentView: "milestones",
          settingsProjectId: "default", holidaySet: new Set<string>(),
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

  it("includes a viewDigest on a digest view and omits it elsewhere", () => {
    const { result: onWorkload } = renderDispatcher(seedTasks(), false, "workload");
    expect(onWorkload.current.getSnapshot().viewDigest).toBeTruthy();

    const { result: onRaid } = renderDispatcher(seedTasks(), false, "raid");
    expect(onRaid.current.getSnapshot().viewDigest).toBeUndefined();
  });

  it("open-points viewDigest reflects the live task count", () => {
    const { result } = renderDispatcher(seedTasks(), false, "open-points");
    expect(result.current.getSnapshot().viewDigest).toContain("3");
  });

  // Pins the seam the bug actually lived at: getSnapshot must build the
  // open-points digest from `filteredSortedTasks` (what the table renders),
  // never the raw workspace-wide `tasks`. view-ai-digest.ts never sees the
  // raw list, so a unit test of the digest alone can't catch a dispatcher
  // that wires the wrong ref back in — this has to assert against the
  // dispatcher's own getSnapshot().
  it("open-points viewDigest reports the FILTERED count, not the workspace-wide one", () => {
    const { result } = renderDispatcher(seedTasks(), false, "open-points");
    // Unfiltered: 3 tasks (Alice/Bob/Carol).
    expect(result.current.getSnapshot().viewDigest).toContain("3 task(s)");

    act(() => {
      result.current.setFilters({ assignee: "Alice" });
    });

    const digest = result.current.getSnapshot().viewDigest;
    // Filtered to Alice's one task: the digest must report 1, not 3.
    expect(digest).toContain("1 task(s)");
    expect(digest).not.toContain("3 task(s)");
    expect(digest).toContain("Alice");
  });

  it("dispatcher identity is stable across editingId-change re-renders", () => {
    // Render the hook AND useTaskForm in the same TestProviders wrapper so
    // setEditingId triggers a re-render of the dispatcher's host component.
    function useProbe() {
      const dispatcher = useChatDispatcher({
        settings: makeSettings(),
        today: "2026-05-19",
        timezone: "UTC",
        setSelectedIds: vi.fn(),
        setSettings: vi.fn(),
        isReadOnly: false,
        currentView: "open-points",
        settingsProjectId: "default", holidaySet: new Set<string>(),
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

// Knowledge items / calendar events / budget buckets are read-only tools with
// no matching create* tool, so the fixtures are seeded directly into the
// workspace (via renderRaidProbe's `ws`, the same pattern the RAID-write
// tests above use to read what was actually stored) rather than round-tripped
// through the dispatcher.
describe("useChatDispatcher – knowledge, calendar and budget read tools", () => {
  it("lists knowledge items with real name/url/linkKind/taskIds fields", () => {
    const { result } = renderRaidProbe();
    act(() => {
      result.current.ws.setKnowledgeItems([
        {
          id: "dl-1",
          name: "Charter",
          url: "https://example.com/charter",
          kind: "file",
          linkKind: "confluence",
          taskIds: [1],
        },
      ]);
    });
    expect(result.current.d.listKnowledgeItems()).toEqual([
      {
        id: "dl-1",
        name: "Charter",
        url: "https://example.com/charter",
        linkKind: "confluence",
        taskIds: [1],
      },
    ]);
  });

  it("returns an empty list when the workspace has no knowledge items", () => {
    const { result } = renderRaidProbe();
    expect(result.current.d.listKnowledgeItems()).toEqual([]);
  });

  it("returns a calendar event's series definition, not an expansion", () => {
    const { result } = renderRaidProbe();
    act(() => {
      result.current.ws.setCalendarEvents([
        {
          id: 7,
          title: "Weekly sync",
          startDate: "2026-02-02",
          startTime: "09:00",
          durationMinutes: 30,
          attendeeResourceIds: [1, 2],
          recurrence: { freq: "weekly", interval: 1 },
        },
      ]);
    });
    const events = result.current.d.listCalendarEvents();
    expect(events).toHaveLength(1);
    expect(events[0].recurrence).toEqual({ freq: "weekly", interval: 1 });
    // ★★ No key outside the contract, rather than probing for `occurrences` —
    // that field has never existed, so `Array.isArray(undefined)` was false
    // unconditionally and would stay green against an expansion named anything
    // else (e.g. `dates: string[]`). See chat-tools.test.ts for the same guard.
    const ALLOWED_KEYS = new Set<string>(CALENDAR_SUMMARY_KEYS);
    expect(Object.keys(events[0]).filter((k) => !ALLOWED_KEYS.has(k))).toEqual([]);
  });

  it("returns an empty list when the workspace has no calendar events", () => {
    const { result } = renderRaidProbe();
    expect(result.current.d.listCalendarEvents()).toEqual([]);
  });

  it("lists budget buckets with id, name, status and per-role budget hours", () => {
    const { result } = renderRaidProbe();
    act(() => {
      result.current.ws.setBudgets([
        {
          id: 3,
          name: "Delivery",
          type: "tm",
          currency: "EUR",
          startDate: "2026-01-01",
          endDate: "2026-12-31",
          status: "open",
          allocations: [
            { roleId: 2, resourceIds: [], budgetHours: { "2026-01": 40 }, actualHours: {} },
          ],
        },
      ]);
    });
    expect(result.current.d.listBudgetBuckets()).toEqual([
      {
        id: 3,
        name: "Delivery",
        status: "open",
        startDate: "2026-01-01",
        endDate: "2026-12-31",
        allocations: [{ roleId: 2, budgetHours: { "2026-01": 40 } }],
      },
    ]);
  });

  it("returns an empty list when the workspace has no budget buckets", () => {
    const { result } = renderRaidProbe();
    expect(result.current.d.listBudgetBuckets()).toEqual([]);
  });
});

describe("useChatDispatcher – document tools", () => {
  it("creates a document through the tool and stores it", async () => {
    const { result } = renderDispatcher();
    await act(async () => {
      await runTool(result.current, "create_document", {
        title: "Charter",
        blocks: [{ type: "heading", level: 1, text: "Charter" }],
      });
    });
    expect(result.current.listDocuments()).toHaveLength(1);
    expect(result.current.listDocuments()[0].title).toBe("Charter");
  });

  // ★★ TEST AT THE WRITE, NOT AT THE TOOL CALL — read the STORED blocks back
  // rather than spying on runTool. S1's review found exactly this gap, and
  // only on a cold read.
  it("strips a script tag the model put in a paragraph before storing it", async () => {
    const { result } = renderDispatcher();
    await act(async () => {
      await runTool(result.current, "create_document", {
        title: "Charter",
        blocks: [{ type: "paragraph", html: "<p>ok</p><script>alert(1)</script>" }],
      });
    });
    const id = result.current.listDocuments()[0].id;
    const stored = result.current.getDocument(id);
    expect(stored).not.toBeNull();
    expect(JSON.stringify(stored!.blocks)).not.toContain("script");
    // Positive observable: the SAFE content must survive too — a sanitizer
    // that dropped the whole block would also make the "no script" assertion
    // pass, for the wrong reason.
    expect(JSON.stringify(stored!.blocks)).toContain("ok");
  });

  // ★★★ THIS TEST WAS VACUOUS, and in the way that reads as thorough: it ran
  // ONE tool while its name promised "every write", and a bare
  // `.rejects.toThrow()` accepted ANY error. MEASURED: deleting all three
  // `if (isReadOnly) throw readOnlyError()` lines from use-document-tools.ts
  // left it GREEN — renderDispatcher's first argument is the TASK list, so the
  // workspace holds no documents, and an unguarded `deleteDocument(1)` returns
  // `{deleted:false}`, which makes runDocumentTool throw `document #1 not
  // found` instead. A different branch, matched by the same assertion.
  // ★★ The repair is the MESSAGE, not a seeded document: TestProviders seeds
  // tasks only, and a read-only dispatcher cannot create the document that
  // would make the not-found branch unreachable. Pinning /read-only/ excludes
  // both fallbacks by name — `document #N not found` for delete/update, and a
  // RESOLVED create, which never throws at all. Re-measured after the repair:
  // the same three-line deletion turns all three cases RED.
  it.each(["create_document", "update_document", "delete_document"])(
    "refuses %s in a popout, routed through runTool",
    async (tool) => {
      const { result } = renderDispatcher([], true);
      await expect(
        runTool(result.current, tool, {
          id: 1,
          title: "Charter",
          ops: [{ op: "append", block: { type: "paragraph", html: "<p>x</p>" } }],
        }),
      ).rejects.toThrow(/read-only/);
      // Positive observable: the refusal is a refusal, not merely a throw —
      // nothing reached storage on the way out.
      expect(result.current.listDocuments()).toEqual([]);
    },
  );

  it("createDocument throws in a popout", () => {
    const { result } = renderDispatcher([], true);
    expect(() => result.current.createDocument("Charter", [])).toThrow(/read-only/);
  });

  it("updateDocument throws in a popout", () => {
    const { result } = renderDispatcher([], true);
    expect(() => result.current.updateDocument(1, [], "New title")).toThrow(/read-only/);
  });

  it("deleteDocument throws in a popout", () => {
    const { result } = renderDispatcher([], true);
    expect(() => result.current.deleteDocument(1)).toThrow(/read-only/);
  });

  // Seeded with REAL prior blocks — the assertion cannot pass by accident
  // against an empty document.
  it("leaves stored blocks untouched when every op is out of range", async () => {
    const { result } = renderDispatcher();
    await act(async () => {
      await runTool(result.current, "create_document", {
        title: "Doc",
        blocks: [{ type: "paragraph", html: "<p>keep me</p>" }],
      });
    });
    const id = result.current.listDocuments()[0].id;
    await expect(
      runTool(result.current, "update_document", { id, ops: [{ op: "delete", index: 42 }] }),
    ).rejects.toThrow();
    expect(JSON.stringify(result.current.getDocument(id)!.blocks)).toContain("keep me");
  });

  it("getDocument returns null for an unknown id", () => {
    const { result } = renderDispatcher();
    expect(result.current.getDocument(999)).toBeNull();
  });

  it("listDocuments returns an empty array when the workspace has no documents", () => {
    const { result } = renderDispatcher();
    expect(result.current.listDocuments()).toEqual([]);
  });

  it("updateDocument returns null when the document does not exist", () => {
    const { result } = renderDispatcher();
    expect(result.current.updateDocument(999, [], "New title")).toBeNull();
  });

  it("updateDocument applies a title-only rename with no ops", () => {
    const { result } = renderDispatcher();
    let id!: number;
    act(() => {
      id = result.current.createDocument("Old title", []).id;
    });
    let out: DocumentUpdateResult | null = null;
    act(() => {
      out = result.current.updateDocument(id, [], "New title");
    });
    expect(out).toMatchObject({ id, title: "New title", applied: 0, rejected: [] });
    expect(result.current.getDocument(id)!.title).toBe("New title");
  });

  it("updateDocument reports `removed` blocks after a replaceAll and sanitizes the new blocks", () => {
    const { result } = renderDispatcher();
    let id!: number;
    act(() => {
      id = result.current.createDocument("Doc", [
        { type: "paragraph", html: "<p>a</p>" },
        { type: "paragraph", html: "<p>b</p>" },
        { type: "paragraph", html: "<p>c</p>" },
      ]).id;
    });
    let out: DocumentUpdateResult | null = null;
    act(() => {
      out = result.current.updateDocument(
        id,
        [
          {
            op: "replaceAll",
            blocks: [{ type: "paragraph", html: "<p>only</p><script>alert(1)</script>" }],
          },
        ],
        undefined,
      );
    });
    expect(out).toMatchObject({ id, applied: 1, removed: 2 });
    const stored = result.current.getDocument(id)!;
    expect(stored.blocks).toHaveLength(1);
    expect(JSON.stringify(stored.blocks)).not.toContain("script");
  });

  // ★★★ IMPORTANT finding, review of 1580b011: the single-block arm rejected a
  // dropped block, the replaceAll arm ONE BRANCH EARLIER did not.
  // sanitizeAiDocBlocks returns a SHORTER array, nothing compared the lengths,
  // and a 4-block replaceAll carrying one bad block wrote 3 while reporting
  // `changed:true, rejected:[]` — the tool resolved, the model said it had
  // rewritten the document, and a section was simply gone. Chat tool writes
  // take no undo capture; the before-image could restore it but nothing said
  // there was anything to restore.
  it("names the blocks a replaceAll dropped instead of silently writing fewer", () => {
    const { result } = renderDispatcher();
    let id!: number;
    act(() => {
      id = result.current.createDocument("Doc", [{ type: "paragraph", html: "<p>old</p>" }]).id;
    });
    let out: DocumentUpdateResult | null = null;
    act(() => {
      out = result.current.updateDocument(
        id,
        [
          {
            op: "replaceAll",
            blocks: [
              { type: "paragraph", html: "<p>one</p>" },
              { type: "bogus" },
              { type: "paragraph", html: "<p>three</p>" },
              { type: "heading", level: 1, text: "four" },
            ],
          },
        ] as unknown as DocOp[],
        undefined,
      );
    });
    // The survivors DO land — a partial drop is not a refusal — but the drop
    // is reported rather than inferred from a blockCount the model never sees
    // a baseline for.
    expect(out!.applied).toBe(1);
    expect(out!.rejected).toEqual(["op 0: 1 block(s) failed the model-input allow-list"]);
    const stored = result.current.getDocument(id)!;
    expect(stored.blocks).toHaveLength(3);
    expect(JSON.stringify(stored.blocks)).not.toContain("bogus");
    // Positive observable: the assertion above would also pass if the whole op
    // had been refused and the OLD single block survived.
    expect(JSON.stringify(stored.blocks)).toContain("three");
  });

  // The XSS-shaped route into the same drop. ★★ It needs the payload WRAPPED:
  // a bare "<script>…" does not open with a tag the "document" sink keeps
  // (`isHtmlStart`, derived from DOCUMENT_ALLOWED_TAGS), so layer 1
  // escapes it as plain text and the block SURVIVES. "<p><script>…</script>
  // </p>" is real markup, DOMPurify strips the tag and its content, and the
  // remaining "<p></p>" collapses to "" — which is what gets dropped.
  it("names a replaceAll block dropped because its entire content was disallowed markup", () => {
    const { result } = renderDispatcher();
    let id!: number;
    act(() => {
      id = result.current.createDocument("Doc", [{ type: "paragraph", html: "<p>old</p>" }]).id;
    });
    let out: DocumentUpdateResult | null = null;
    act(() => {
      out = result.current.updateDocument(
        id,
        [
          {
            op: "replaceAll",
            blocks: [
              { type: "paragraph", html: "<p>kept</p>" },
              { type: "paragraph", html: "<p><script>alert(1)</script></p>" },
            ],
          },
        ],
        undefined,
      );
    });
    expect(out!.rejected).toEqual(["op 0: 1 block(s) failed the model-input allow-list"]);
    const stored = result.current.getDocument(id)!;
    expect(stored.blocks).toHaveLength(1);
    expect(JSON.stringify(stored.blocks)).not.toContain("script");
    expect(JSON.stringify(stored.blocks)).toContain("kept");
  });

  // ★★★ `sent > 0 && kept === 0` IS NOT A REQUEST TO CLEAR. Applying it would
  // wipe the document on the strength of content that never survived
  // validation — reported as a success, with the old blocks gone. The op is
  // refused instead, mirroring the single-block arm.
  it("refuses a replaceAll whose every block failed the allow-list, leaving the document intact", () => {
    const { result } = renderDispatcher();
    let id!: number;
    act(() => {
      id = result.current.createDocument("Doc", [
        { type: "paragraph", html: "<p>keep me</p>" },
        { type: "paragraph", html: "<p>and me</p>" },
      ]).id;
    });
    let out: DocumentUpdateResult | null = null;
    act(() => {
      out = result.current.updateDocument(
        id,
        [{ op: "replaceAll", blocks: [{ type: "bogus" }, { type: "alsoBogus" }] }] as unknown as DocOp[],
        undefined,
      );
    });
    expect(out!.applied).toBe(0);
    expect(out!.rejected).toEqual(["op 0: all 2 block(s) failed the model-input allow-list"]);
    const stored = result.current.getDocument(id)!;
    expect(stored.blocks).toHaveLength(2);
    expect(JSON.stringify(stored.blocks)).toContain("keep me");
  });

  // ★★★ THE OVER-CORRECTION GUARD for the test above. An EXPLICIT empty list
  // is a legitimate "clear this document" (document-mutations.ts says so at
  // length) and the before-image preserves what it replaced — so the refusal
  // must key on `sent > 0`, never on the emptiness of the RESULT. A guard
  // written the obvious way (`kept.length === 0`) passes every assertion in
  // the previous test and breaks this one.
  it("still clears a document when the model explicitly sends replaceAll with an empty list", () => {
    const { result } = renderDispatcher();
    let id!: number;
    act(() => {
      id = result.current.createDocument("Doc", [{ type: "paragraph", html: "<p>gone</p>" }]).id;
    });
    let out: DocumentUpdateResult | null = null;
    act(() => {
      out = result.current.updateDocument(id, [{ op: "replaceAll", blocks: [] }], undefined);
    });
    expect(out!.applied).toBe(1);
    expect(out!.rejected).toEqual([]);
    expect(out!.removed).toBe(1);
    expect(result.current.getDocument(id)!.blocks).toEqual([]);
  });

  // ★★★ The `applied` arithmetic keys on `/^op \d+:/` because `result.rejected`
  // mixes op-scoped entries with mutation-scoped ones (a blank title), and it
  // has already gone negative once when both landed together. The new
  // drop message is op-scoped and rides `selfRejected`, which that filter never
  // reads — this pins that a drop and a title rejection in ONE call still
  // produce a non-negative, truthful count.
  it("does not report a negative `applied` when a replaceAll drop meets a blank title", () => {
    const { result } = renderDispatcher();
    let id!: number;
    act(() => {
      id = result.current.createDocument("Doc", [{ type: "paragraph", html: "<p>old</p>" }]).id;
    });
    let out: DocumentUpdateResult | null = null;
    act(() => {
      out = result.current.updateDocument(
        id,
        [
          {
            op: "replaceAll",
            blocks: [{ type: "paragraph", html: "<p>new</p>" }, { type: "bogus" }],
          },
        ] as unknown as DocOp[],
        "   ",
      );
    });
    // The op DID apply, so 1 is the truthful count — not 1 minus the title
    // rejection, and never below zero.
    expect(out!.applied).toBe(1);
    expect(out!.applied).not.toBeLessThan(0);
    expect(out!.rejected).toEqual([
      "op 0: 1 block(s) failed the model-input allow-list",
      "title must not be empty",
    ]);
    const stored = result.current.getDocument(id)!;
    expect(stored.blocks).toHaveLength(1);
    expect(stored.title).toBe("Doc");
  });

  // ★★★ createDocument had the SAME silence and NO channel to break it: its
  // result is `{id, title, blockCount}` with no `rejected` field, so a shorter
  // array after sanitizing produced a document missing a section while the
  // tool resolved. It throws BEFORE the write instead — nothing is created and
  // no version row is minted, so the model gets a reason it can retry against
  // rather than a half-written document it believes is whole.
  it("refuses a create whose blocks the allow-list dropped, writing nothing at all", () => {
    const { result } = renderDispatcher();
    expect(() =>
      result.current.createDocument("Charter", [
        { type: "paragraph", html: "<p>intro</p>" },
        { type: "bogus" },
      ]),
    ).toThrow(/1 of 2 block\(s\) failed the model-input allow-list/);
    // The refusal is total: no partially-written document survives it.
    expect(result.current.listDocuments()).toEqual([]);
  });

  it("throws through the create tool when a block fails the allow-list, storing no document", async () => {
    const { result } = renderDispatcher();
    await expect(
      runTool(result.current, "create_document", {
        title: "Charter",
        blocks: [{ type: "paragraph", html: "<p><script>alert(1)</script></p>" }],
      }),
    ).rejects.toThrow(/failed the model-input allow-list/);
    expect(result.current.listDocuments()).toEqual([]);
  });

  // The other side of that guard: a create whose blocks all survive is
  // untouched by it. Without this, "throw whenever anything looks off" would
  // pass every assertion above.
  it("still creates a document when every block survives the allow-list", () => {
    const { result } = renderDispatcher();
    act(() => {
      result.current.createDocument("Charter", [
        { type: "heading", level: 1, text: "Charter" },
        { type: "paragraph", html: "<p>ok</p>" },
      ]);
    });
    expect(result.current.listDocuments()).toHaveLength(1);
    expect(result.current.listDocuments()[0].blockCount).toBe(2);
  });

  it("updateDocument reports a partial application when some ops are rejected and others succeed", () => {
    const { result } = renderDispatcher();
    let id!: number;
    act(() => {
      id = result.current.createDocument("Doc", [{ type: "paragraph", html: "<p>a</p>" }]).id;
    });
    let out: DocumentUpdateResult | null = null;
    act(() => {
      out = result.current.updateDocument(
        id,
        [
          { op: "append", block: { type: "paragraph", html: "<p>b</p>" } },
          { op: "delete", index: 99 },
        ],
        undefined,
      );
    });
    expect(out!.applied).toBe(1);
    expect(out!.rejected).toHaveLength(1);
    expect(result.current.getDocument(id)!.blocks).toHaveLength(2);
  });

  // ★★★ Regression, cold review of 005ede2c: `result.rejected` mixes
  // OP-SCOPED entries ("op N: …") with MUTATION-SCOPED ones (a blank title)
  // that describe the write as a whole, not any single op. Subtracting the
  // WHOLE array from an op count goes negative the moment both land in the
  // same call — this is the boundary that was untested (a blank title
  // beside ops) and the arithmetic bug hid behind that gap.
  it("does not report a negative `applied` when an out-of-range op meets a blank title", () => {
    const { result } = renderDispatcher();
    let id!: number;
    act(() => {
      id = result.current.createDocument("Doc", [
        { type: "paragraph", html: "<p>a</p>" },
        { type: "paragraph", html: "<p>b</p>" },
        { type: "paragraph", html: "<p>c</p>" },
      ]).id;
    });
    let out: DocumentUpdateResult | null = null;
    act(() => {
      out = result.current.updateDocument(id, [{ op: "delete", index: 99 }], "   ");
    });
    expect(out!.applied).toBe(0);
    expect(out!.applied).not.toBeLessThan(0);
    expect(out!.rejected).toHaveLength(2);
    // Neither half of the write landed: the blocks AND the title survive.
    expect(result.current.getDocument(id)!.blocks).toHaveLength(3);
    expect(result.current.getDocument(id)!.title).toBe("Doc");
  });

  // The other direction of the same bug: a REAL op succeeds while a blank
  // title is rejected alongside it. The old formula also gave `applied: 0`
  // here (0 op-rejections but 1 title-rejection subtracted from 1 op sent),
  // telling the model nothing landed when a block genuinely did.
  it("reports applied:1 when a valid op lands and only the accompanying title is rejected", () => {
    const { result } = renderDispatcher();
    let id!: number;
    act(() => {
      id = result.current.createDocument("Doc", [{ type: "paragraph", html: "<p>a</p>" }]).id;
    });
    let out: DocumentUpdateResult | null = null;
    act(() => {
      out = result.current.updateDocument(
        id,
        [{ op: "append", block: { type: "paragraph", html: "<p>b</p>" } }],
        "  ",
      );
    });
    expect(out!.applied).toBe(1);
    expect(out!.rejected).toEqual(["title must not be empty"]);
    const stored = result.current.getDocument(id)!;
    expect(stored.blocks).toHaveLength(2);
    expect(stored.title).toBe("Doc");
  });

  it("updateDocument sanitizes an insert op's block before applying it", () => {
    const { result } = renderDispatcher();
    let id!: number;
    act(() => {
      id = result.current.createDocument("Doc", [{ type: "paragraph", html: "<p>a</p>" }]).id;
    });
    let out: DocumentUpdateResult | null = null;
    act(() => {
      out = result.current.updateDocument(
        id,
        [
          {
            op: "insert",
            index: 0,
            block: { type: "paragraph", html: "<p>before</p><script>alert(1)</script>" },
          },
        ],
        undefined,
      );
    });
    expect(out).toMatchObject({ applied: 1, rejected: [] });
    const stored = result.current.getDocument(id)!;
    expect(stored.blocks).toHaveLength(2);
    expect(JSON.stringify(stored.blocks)).not.toContain("script");
    expect(JSON.stringify(stored.blocks)).toContain("before");
  });

  // ★★★ HIGH finding, cold review: an op whose block the allow-list DROPS
  // must be REJECTED, never forwarded unsanitized. applyOps has no
  // block-content validation of its own — append/insert/replace apply
  // whatever `op.block` they receive unconditionally — so a fallback to the
  // original op here would store the model's raw block, reported as a
  // success, and only drop it (silently) on the NEXT load. `as unknown as
  // DocOp[]` mirrors how the model's real JSON arrives at this boundary:
  // chat-tools-documents.ts's requireOps only checks array-ness, never
  // per-op shape.
  it("rejects an op whose block fails the allow-list, never storing it unsanitized", () => {
    const { result } = renderDispatcher();
    let id!: number;
    act(() => {
      id = result.current.createDocument("Doc", [{ type: "paragraph", html: "<p>a</p>" }]).id;
    });
    const badOps = [
      { op: "insert", index: 0, block: { type: "bogus" } },
    ] as unknown as DocOp[];
    let out: DocumentUpdateResult | null = null;
    act(() => {
      out = result.current.updateDocument(id, badOps, undefined);
    });
    expect(out!.applied).toBe(0);
    expect(out!.rejected).toHaveLength(1);
    const stored = result.current.getDocument(id)!;
    expect(stored.blocks).toHaveLength(1);
    expect(JSON.stringify(stored.blocks)).not.toContain("bogus");
  });

  // ★★★ The SUSPECTED case from the cold review, constructed and confirmed —
  // but NOT with a bare "<script>...": that string does not start with a
  // recognized HTML tag (`isHtmlStart` derives the "document" sink's test from
  // DOCUMENT_ALLOWED_TAGS, which carries no `script` — and note the `\b` in
  // `htmlStartRe` is what stops the listed `s` from matching "<script>"'s first
  // letter), so layer 1 (sanitizeRichText) treats it as PLAIN TEXT and
  // ESCAPES it into "<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>" — safe,
  // non-empty, and it survives (verified directly: sanitizeAiDocBlocks kept
  // that block). The actual empty-after-sanitize case needs the payload
  // WRAPPED in a recognized tag so layer 1 hands it to DOMPurify as real
  // markup: "<p><script>...</script></p>" starts with <p>, so DOMPurify
  // strips the <script> (tag AND its content — script content is not kept)
  // leaving "<p></p>", which the second sanitizeRichText pass's empty rule
  // collapses to "" — confirmed by direct call. An empty paragraph then
  // fails document-model.ts's structural validation (htmlTextLength must be
  // > 0), so sanitizeAiDocBlocks drops the block, same as an unknown type.
  // Before the fix, this hit the exact same unsanitized-fallback bug: the
  // RAW "<p><script>alert(1)</script></p>" would have reached storage
  // verbatim (a stored-XSS payload, not just a data-integrity gap) rather
  // than being rejected. Confirmed fixed: the op is rejected and no script
  // tag reaches storage.
  it("rejects a paragraph op whose entire content is a disallowed element (script-only html)", () => {
    const { result } = renderDispatcher();
    let id!: number;
    act(() => {
      id = result.current.createDocument("Doc", [{ type: "paragraph", html: "<p>a</p>" }]).id;
    });
    let out: DocumentUpdateResult | null = null;
    act(() => {
      out = result.current.updateDocument(
        id,
        [{ op: "append", block: { type: "paragraph", html: "<p><script>alert(1)</script></p>" } }],
        undefined,
      );
    });
    expect(out!.applied).toBe(0);
    expect(out!.rejected).toHaveLength(1);
    const stored = result.current.getDocument(id)!;
    expect(stored.blocks).toHaveLength(1);
    expect(JSON.stringify(stored.blocks)).not.toContain("script");
  });

  // ★★★ MEDIUM finding, cold review: `applied` must come from what was
  // actually SENT to the engine and what it reported rejected, not from the
  // caller's raw `ops.length` — otherwise an op this function itself
  // rejects (never reaching the engine) still counts as "applied".
  it("does not count a self-rejected op (bad block) toward `applied`, even mixed with a real success", async () => {
    const { result } = renderDispatcher();
    await act(async () => {
      await runTool(result.current, "create_document", {
        title: "Doc",
        blocks: [{ type: "paragraph", html: "<p>a</p>" }],
      });
    });
    const id = result.current.listDocuments()[0].id;
    let out: DocumentUpdateResult | null = null;
    act(() => {
      out = result.current.updateDocument(
        id,
        [
          { op: "append", block: { type: "paragraph", html: "<p>good</p>" } },
          { op: "insert", index: 0, block: { type: "bogus" } } as unknown as DocOp,
        ],
        undefined,
      );
    });
    expect(out!.applied).toBe(1);
    expect(out!.rejected).toHaveLength(1);
    const stored = result.current.getDocument(id)!;
    expect(stored.blocks).toHaveLength(2);
    expect(JSON.stringify(stored.blocks)).not.toContain("bogus");
    expect(JSON.stringify(stored.blocks)).toContain("good");
  });

  // Through the FULL tool boundary: every op self-rejected, none reach the
  // engine, so chat-tools-documents.ts's "nothing applied" guard must throw
  // rather than resolve with a hollow success.
  it("throws through the tool when every op is rejected by the allow-list before reaching the engine", async () => {
    const { result } = renderDispatcher();
    await act(async () => {
      await runTool(result.current, "create_document", {
        title: "Doc",
        blocks: [{ type: "paragraph", html: "<p>keep me</p>" }],
      });
    });
    const id = result.current.listDocuments()[0].id;
    await expect(
      runTool(result.current, "update_document", {
        id,
        ops: [{ op: "insert", index: 0, block: { type: "bogus" } }],
      }),
    ).rejects.toThrow();
    expect(JSON.stringify(result.current.getDocument(id)!.blocks)).toContain("keep me");
  });

  it("deleteDocument returns deleted:false and no restorableVersionId for an unknown id", () => {
    const { result } = renderDispatcher();
    expect(result.current.deleteDocument(999)).toEqual({ deleted: false, restorableVersionId: null });
  });

  it("deleteDocument reports a restorableVersionId on success and removes the document", () => {
    const { result } = renderDispatcher();
    let id!: number;
    act(() => {
      id = result.current.createDocument("Doc", []).id;
    });
    let out: { deleted: boolean; restorableVersionId: number | null } = {
      deleted: false,
      restorableVersionId: null,
    };
    act(() => {
      out = result.current.deleteDocument(id);
    });
    expect(out.deleted).toBe(true);
    expect(out.restorableVersionId).not.toBeNull();
    expect(result.current.getDocument(id)).toBeNull();
  });
});

// ★★ The `ai.documentWrite` activity row. The kind was registered everywhere
// (the ActivityKind union, ACTIVITY_KIND_TO_KEY, dashboard-activity-nav's
// documents deep-link, EN/DE strings) and emitted NOWHERE, so no AI document
// write ever appeared in the Activity panel.
//
// ★★★ EVERY "no row" TEST HERE CARRIES ITS OWN POSITIVE CONTROL IN THE SAME
// `it`. A bare `expect(spy).not.toHaveBeenCalled()` is vacuous by construction:
// it passes just as happily when the spy was never wired, when the write threw
// before reaching any interesting branch, or when the whole emitter was
// deleted. Each of these does the refused write, asserts nothing was logged,
// then MUTATES THE FIXTURE into a write that should log and asserts it did —
// so the assertion can only be green while the spy is live and the gate is the
// thing making the difference.
describe("useChatDispatcher – ai.documentWrite activity rows", () => {
  /** The exact input measured (in use-document-tools.ts's own comment) to be
   *  DROPPED by the model-input allow-list: a bare "<script>…</script>" does not
   *  open with a tag the "document" sink keeps (`isHtmlStart`, derived from
   *  DOCUMENT_ALLOWED_TAGS), so layer 1 escapes it as plain text and the
   *  block survives. Wrapped in <p>, DOMPurify strips tag AND content, the
   *  paragraph empties, and the block fails the structural check. */
  const DROPPED_BLOCK = { type: "paragraph" as const, html: "<p><script>alert(1)</script></p>" };
  const GOOD_BLOCK = { type: "paragraph" as const, html: "<p>keep me</p>" };

  function renderWithLog(isReadOnly = false) {
    const logActivity = vi.fn();
    const { result } = renderDispatcher(seedTasks(), isReadOnly, "open-points", logActivity);
    return { result, logActivity };
  }

  it("logs one ai.documentWrite row when the assistant creates a document", () => {
    const { result, logActivity } = renderWithLog();
    let id!: number;
    act(() => {
      id = result.current.createDocument("Charter", [GOOD_BLOCK]).id;
    });
    expect(logActivity).toHaveBeenCalledTimes(1);
    expect(logActivity).toHaveBeenCalledWith("ai.documentWrite", id, "Charter");
  });

  // ★ ONE row per WRITE, not per op — three ops in a single update_document
  // call are one thing the assistant did. A per-op emitter would report 3.
  it("logs exactly one row for a multi-op update", () => {
    const { result, logActivity } = renderWithLog();
    let id!: number;
    act(() => {
      id = result.current.createDocument("Charter", [GOOD_BLOCK]).id;
    });
    logActivity.mockClear();
    const ops: DocOp[] = [
      { op: "append", block: GOOD_BLOCK },
      { op: "append", block: GOOD_BLOCK },
      { op: "append", block: GOOD_BLOCK },
    ];
    act(() => {
      result.current.updateDocument(id, ops, undefined);
    });
    expect(logActivity).toHaveBeenCalledTimes(1);
    expect(logActivity).toHaveBeenCalledWith("ai.documentWrite", id, "Charter");
  });

  it("logs a row for a title-only rename, carrying the NEW title", () => {
    const { result, logActivity } = renderWithLog();
    let id!: number;
    act(() => {
      id = result.current.createDocument("Old title", []).id;
    });
    logActivity.mockClear();
    act(() => {
      result.current.updateDocument(id, [], "New title");
    });
    expect(logActivity).toHaveBeenCalledTimes(1);
    expect(logActivity).toHaveBeenCalledWith("ai.documentWrite", id, "New title");
  });

  // The title is read BEFORE the mutation — afterwards the row is gone from
  // result.documents, so a naive lookup would log an empty name.
  it("logs a row naming the document it deleted", () => {
    const { result, logActivity } = renderWithLog();
    let id!: number;
    act(() => {
      id = result.current.createDocument("Doomed", []).id;
    });
    logActivity.mockClear();
    act(() => {
      result.current.deleteDocument(id);
    });
    expect(logActivity).toHaveBeenCalledTimes(1);
    expect(logActivity).toHaveBeenCalledWith("ai.documentWrite", id, "Doomed");
  });

  it("logs NO row when a create is refused because a block failed the allow-list", () => {
    const { result, logActivity } = renderWithLog();
    expect(() => result.current.createDocument("Charter", [GOOD_BLOCK, DROPPED_BLOCK])).toThrow(
      /allow-list/,
    );
    expect(logActivity).not.toHaveBeenCalled();
    // Nothing was created either — the refusal is total.
    expect(result.current.listDocuments()).toEqual([]);
    // POSITIVE CONTROL: the ONLY change is dropping the bad block. Same spy,
    // same dispatcher, same call — and now it logs. Without this, the assertion
    // above would survive an unwired spy or a deleted emitter.
    let id!: number;
    act(() => {
      id = result.current.createDocument("Charter", [GOOD_BLOCK]).id;
    });
    expect(logActivity).toHaveBeenCalledTimes(1);
    expect(logActivity).toHaveBeenCalledWith("ai.documentWrite", id, "Charter");
  });

  it("logs NO row when every op of an update was rejected", () => {
    const { result, logActivity } = renderWithLog();
    let id!: number;
    act(() => {
      id = result.current.createDocument("Charter", [GOOD_BLOCK]).id;
    });
    logActivity.mockClear();
    act(() => {
      result.current.updateDocument(id, [{ op: "delete", index: 42 }], undefined);
    });
    expect(logActivity).not.toHaveBeenCalled();
    // The document really is untouched — the write was refused, not silently
    // applied with a missing row.
    expect(JSON.stringify(result.current.getDocument(id)!.blocks)).toContain("keep me");
    // POSITIVE CONTROL: same document, same dispatcher, an in-range op.
    act(() => {
      result.current.updateDocument(id, [{ op: "delete", index: 0 }], undefined);
    });
    expect(logActivity).toHaveBeenCalledTimes(1);
    expect(logActivity).toHaveBeenCalledWith("ai.documentWrite", id, "Charter");
  });

  it("logs NO row when a rename is a no-op (same title, no ops)", () => {
    const { result, logActivity } = renderWithLog();
    let id!: number;
    act(() => {
      id = result.current.createDocument("Charter", []).id;
    });
    logActivity.mockClear();
    act(() => {
      result.current.updateDocument(id, [], "Charter");
    });
    expect(logActivity).not.toHaveBeenCalled();
    // POSITIVE CONTROL: a title that actually differs logs.
    act(() => {
      result.current.updateDocument(id, [], "Charter v2");
    });
    expect(logActivity).toHaveBeenCalledTimes(1);
    expect(logActivity).toHaveBeenCalledWith("ai.documentWrite", id, "Charter v2");
  });

  it("logs NO row when deleting an id that does not exist", () => {
    const { result, logActivity } = renderWithLog();
    let id!: number;
    act(() => {
      id = result.current.createDocument("Charter", []).id;
    });
    logActivity.mockClear();
    act(() => {
      result.current.deleteDocument(999);
    });
    expect(logActivity).not.toHaveBeenCalled();
    // POSITIVE CONTROL: the id that DOES exist logs.
    act(() => {
      result.current.deleteDocument(id);
    });
    expect(logActivity).toHaveBeenCalledTimes(1);
    expect(logActivity).toHaveBeenCalledWith("ai.documentWrite", id, "Charter");
  });

  // A popout refuses before mutateDocuments is reached, so there is nothing to
  // record. Positive control is the non-popout dispatcher in the same test.
  it("logs NO row for a write refused in a read-only popout", () => {
    const { result, logActivity } = renderWithLog(true);
    expect(() => result.current.createDocument("Charter", [GOOD_BLOCK])).toThrow(/read-only/);
    expect(() => result.current.updateDocument(1, [], "New title")).toThrow(/read-only/);
    expect(() => result.current.deleteDocument(1)).toThrow(/read-only/);
    expect(logActivity).not.toHaveBeenCalled();
    // POSITIVE CONTROL: identical create against a WRITABLE dispatcher.
    const { result: writable, logActivity: writableLog } = renderWithLog(false);
    act(() => {
      writable.current.createDocument("Charter", [GOOD_BLOCK]);
    });
    expect(writableLog).toHaveBeenCalledTimes(1);
  });

  // logActivity is OPTIONAL on ChatDispatcherArgs (every other ai.* emitter is
  // too, and a required prop would break task-manager.characterization's prop
  // contract). Omitting it must no-op, not throw.
  it("does not throw when logActivity is omitted", () => {
    const { result } = renderDispatcher();
    let id!: number;
    expect(() => {
      act(() => {
        id = result.current.createDocument("Charter", [GOOD_BLOCK]).id;
        result.current.updateDocument(id, [], "Renamed");
        result.current.deleteDocument(id);
      });
    }).not.toThrow();
    // Positive observable: the writes really ran on the no-logger path.
    expect(result.current.getDocument(id)).toBeNull();
  });
});

// ★★★ THE OP-INDEX SPACES, THE BLOCK CAP, AND `removed`.
//
// Three defects that only became user-visible with e27fc155 (the chat
// transcript's document card renders `rejected`). Every assertion here is an
// EXACT array or an anchored pattern: `toContain("op 1")` passes on "op 10",
// and a loose `/failed/` matches whichever of the two reasons happens to fire —
// which is precisely the confusion these fix.
describe("useChatDispatcher – document tool rejection reporting", () => {
  const P = (n: number) => ({ type: "paragraph" as const, html: `<p>p${n}</p>` });
  const BAD = { type: "bogus" } as unknown as ReturnType<typeof P>;
  const OVER_CAP = MAX_BLOCKS_PER_DOC + 3;
  const CAP_REASON = `block limit exceeded (${OVER_CAP} > ${MAX_BLOCKS_PER_DOC})`;

  function docWith(result: { current: { createDocument: (t: string, b: unknown[]) => { id: number } } }, blocks: unknown[]) {
    let id!: number;
    act(() => {
      id = result.current.createDocument("Doc", blocks).id;
    });
    return id;
  }

  // ★★★ `selfRejected` is indexed against the CALLER's `ops`; applyOps indexes
  // the `cleanOps` it RECEIVES, which is shorter by every preceding
  // self-rejection. Measured before the fix: this exact input produced TWO
  // entries both reading "op 0:", so the model was told to retry the wrong op
  // and the user read a contradiction.
  it("renumbers an engine rejection into the caller's op space when an earlier op was self-rejected", () => {
    const { result } = renderDispatcher();
    const id = docWith(result, [P(1)]);
    let out: DocumentUpdateResult | null = null;
    act(() => {
      out = result.current.updateDocument(
        id,
        [
          { op: "insert", index: 0, block: BAD },
          { op: "delete", index: 42 },
        ] as unknown as DocOp[],
        undefined,
      );
    });
    // EXACT array: the second entry is "op 1", the caller's index for the
    // delete, and there is no longer a second "op 0".
    expect(out!.rejected).toEqual([
      "op 0: block failed the model-input allow-list",
      "op 1: delete index 42 out of range 0..0",
    ]);
    // Positive control: the write really ran and really refused both ops.
    expect(out!.applied).toBe(0);
    expect(result.current.getDocument(id)!.blocks).toHaveLength(1);
  });

  // ★★ The shift is not a hardcoded 1, and it is not a global offset by the
  // TOTAL self-rejection count either: here TWO ops are self-rejected but only
  // ONE of them precedes the engine-rejected op, so the correct caller index is
  // 1 — a "+2" would say "op 2", a "+0" would say "op 0".
  it("shifts each engine rejection by the self-rejections that PRECEDE it, not by the total", () => {
    const { result } = renderDispatcher();
    const id = docWith(result, [P(1), P(2), P(3)]);
    let out: DocumentUpdateResult | null = null;
    act(() => {
      out = result.current.updateDocument(
        id,
        [
          { op: "insert", index: 0, block: BAD },
          { op: "delete", index: 99 },
          { op: "append", block: BAD },
        ] as unknown as DocOp[],
        undefined,
      );
    });
    expect(out!.rejected).toEqual([
      "op 0: block failed the model-input allow-list",
      "op 2: block failed the model-input allow-list",
      "op 1: delete index 99 out of range 0..2",
    ]);
    expect(result.current.getDocument(id)!.blocks).toHaveLength(3);
  });

  // ★★★ THE `applied` FILTER, WITH ALL THREE KINDS IN ONE CALL. It counts only
  // `/^op \d+:/` entries because `result.rejected` mixes op-scoped ones with
  // MUTATION-scoped ones (a blank title), and it has gone negative once.
  // Renumbering must not move that count in either direction — it cannot,
  // because remapping preserves the prefix shape, and this pins it.
  it("keeps `applied` non-negative when a self-rejection, an engine rejection and a blank title all land", () => {
    const { result } = renderDispatcher();
    const id = docWith(result, [P(1)]);
    let out: DocumentUpdateResult | null = null;
    act(() => {
      out = result.current.updateDocument(
        id,
        [
          { op: "insert", index: 0, block: BAD },
          { op: "delete", index: 42 },
        ] as unknown as DocOp[],
        "   ",
      );
    });
    expect(out!.applied).toBe(0);
    expect(out!.applied).not.toBeLessThan(0);
    // The mutation-scoped entry is NOT renumbered and NOT counted as an op.
    expect(out!.rejected).toEqual([
      "op 0: block failed the model-input allow-list",
      "op 1: delete index 42 out of range 0..0",
      "title must not be empty",
    ]);
    // Positive control: neither half of the write landed.
    const stored = result.current.getDocument(id)!;
    expect(stored.blocks).toHaveLength(1);
    expect(stored.title).toBe("Doc");
  });

  // ★★★ FIX 2. sanitizeAiDocBlocks routes through sanitizeProjectDocuments,
  // which `.slice(0, MAX_BLOCKS_PER_DOC)`s BEFORE validating — so an over-cap
  // create came back shorter and was reported as an ALLOW-LIST failure
  // (measured: "3 of 503 block(s) failed the model-input allow-list"). Nothing
  // failed validation. A model told its blocks are invalid rewrites them; a
  // model told it hit a cap splits the document.
  it("names the block CAP, not the allow-list, when a create exceeds MAX_BLOCKS_PER_DOC", () => {
    const { result } = renderDispatcher();
    let message = "";
    try {
      result.current.createDocument("Big", Array.from({ length: OVER_CAP }, (_, i) => P(i)));
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toBe(`${CAP_REASON}; no document was created`);
    // The wrong reason must be ABSENT, not merely outranked — a substring
    // assertion would pass on a message carrying both.
    expect(message).not.toMatch(/failed the model-input allow-list/);
    expect(result.current.listDocuments()).toEqual([]);
  });

  // The other side of the same guard: an allow-list drop UNDER the cap must not
  // acquire a cap reason. Without this, "always mention the cap" passes above.
  it("names only the allow-list when blocks fail validation under the cap", () => {
    const { result } = renderDispatcher();
    let message = "";
    try {
      result.current.createDocument("Charter", [P(1), BAD, P(2)]);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toBe(
      "1 of 3 block(s) failed the model-input allow-list; no document was created",
    );
    expect(message).not.toMatch(/block limit exceeded/);
    expect(result.current.listDocuments()).toEqual([]);
  });

  // ★★★ A payload can hit BOTH, and neither reason may mask the other. The
  // decomposition is exact because truncation runs BEFORE validation: the two
  // invalid blocks sit inside the first MAX_BLOCKS_PER_DOC, so the allow-list
  // did see them, and the denominator is what it examined — never the full
  // send, which would claim a rate over blocks nothing ever tested.
  it("reports the cap AND the allow-list when an over-cap create also carries invalid blocks", () => {
    const { result } = renderDispatcher();
    const blocks = Array.from({ length: OVER_CAP }, (_, i) => (i === 3 || i === 7 ? BAD : P(i)));
    let message = "";
    try {
      result.current.createDocument("Big", blocks);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toBe(
      `${CAP_REASON}; 2 of ${MAX_BLOCKS_PER_DOC} block(s) failed the model-input allow-list; no document was created`,
    );
    expect(result.current.listDocuments()).toEqual([]);
  });

  // ★★ Invalid blocks PAST the cap are attributed to the cap alone: the slice
  // removed them before the allow-list could look. Reporting them as validation
  // failures would be the original bug wearing the new message.
  it("attributes over-cap blocks to the cap even when they are themselves invalid", () => {
    const { result } = renderDispatcher();
    const blocks = Array.from({ length: OVER_CAP }, (_, i) => (i >= MAX_BLOCKS_PER_DOC ? BAD : P(i)));
    let message = "";
    try {
      result.current.createDocument("Big", blocks);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toBe(`${CAP_REASON}; no document was created`);
  });

  // Threshold control: exactly MAX_BLOCKS_PER_DOC is legal, so the guard is the
  // cap and not "a large array looks suspicious".
  it("still creates a document of exactly MAX_BLOCKS_PER_DOC blocks", () => {
    const { result } = renderDispatcher();
    act(() => {
      result.current.createDocument(
        "Exactly at the cap",
        Array.from({ length: MAX_BLOCKS_PER_DOC }, (_, i) => P(i)),
      );
    });
    expect(result.current.listDocuments()).toHaveLength(1);
    expect(result.current.listDocuments()[0].blockCount).toBe(MAX_BLOCKS_PER_DOC);
  });

  // ★★★ The replaceAll arm carried the same wrong reason while APPLYING the
  // survivors — the worse half, since the write lands and the model is told the
  // wrong thing about it.
  it("names the block CAP on an over-cap replaceAll, and still applies the survivors", () => {
    const { result } = renderDispatcher();
    const id = docWith(result, [P(0)]);
    let out: DocumentUpdateResult | null = null;
    act(() => {
      out = result.current.updateDocument(
        id,
        [{ op: "replaceAll", blocks: Array.from({ length: OVER_CAP }, (_, i) => P(i)) }],
        undefined,
      );
    });
    expect(out!.rejected).toEqual([`op 0: ${CAP_REASON}`]);
    expect(out!.applied).toBe(1);
    // Positive control: the survivors really landed, so this is a reporting fix
    // and not a new refusal.
    expect(result.current.getDocument(id)!.blocks).toHaveLength(MAX_BLOCKS_PER_DOC);
  });

  // ★★★ FIX 3. `removed` is a before/after block-count delta and is documented
  // "non-zero only for replaceAll" — so the flag must read the CLEANED ops. A
  // replaceAll that `selfRejected` removed never ran, and measured before the
  // fix this reported `removed: 1` for the DELETE's block.
  it("reports removed:0 when the only replaceAll was self-rejected and another op did the removing", () => {
    const { result } = renderDispatcher();
    const id = docWith(result, [P(1), P(2), P(3)]);
    let out: DocumentUpdateResult | null = null;
    act(() => {
      out = result.current.updateDocument(
        id,
        [
          { op: "replaceAll", blocks: [BAD, BAD] },
          { op: "delete", index: 0 },
        ] as unknown as DocOp[],
        undefined,
      );
    });
    expect(out!.removed).toBe(0);
    // Positive controls: the delete DID apply, so a block genuinely went away —
    // `removed: 0` is an attribution statement, not "nothing happened".
    expect(out!.applied).toBe(1);
    expect(out!.rejected).toEqual(["op 0: all 2 block(s) failed the model-input allow-list"]);
    const stored = result.current.getDocument(id)!;
    expect(stored.blocks).toHaveLength(2);
    expect(JSON.stringify(stored.blocks)).not.toContain("p1");
  });

  // The second self-rejection route into the same flag: a replaceAll with a
  // non-array `blocks` is refused before the engine sees it.
  it("reports removed:0 when a replaceAll with no blocks array is self-rejected", () => {
    const { result } = renderDispatcher();
    const id = docWith(result, [P(1), P(2)]);
    let out: DocumentUpdateResult | null = null;
    act(() => {
      out = result.current.updateDocument(
        id,
        [{ op: "replaceAll" }, { op: "delete", index: 0 }] as unknown as DocOp[],
        undefined,
      );
    });
    expect(out!.removed).toBe(0);
    expect(out!.applied).toBe(1);
    expect(out!.rejected).toEqual(["op 0: replaceAll requires a blocks array"]);
    expect(result.current.getDocument(id)!.blocks).toHaveLength(1);
  });
});
