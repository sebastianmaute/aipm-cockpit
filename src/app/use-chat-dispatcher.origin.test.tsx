// §799 — a chat tool's activity row names the AI feature whose call ran it. The origin travels as an
// ARGUMENT (`runTool(d, name, input, origin)` → handler), never on the shared dispatcher, so two AI
// operations overlapping in time (a chat turn running tools while an insight recommendation applies)
// each stamp their own. Asserted on the STORED log: the real `useActivityLog` renders beside the real
// dispatcher over one workspace.
import { act, renderHook } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
// AI people protection: this file tests the origin, not the protection (`ai-people-gates.test.tsx`).
vi.mock("./ai-privacy-context", () => import("../test/ai-privacy-unprotected"));
import { dispatcherWrapperWith, makeDispatcherArgs } from "../test/chat-dispatcher-fixture";
import { entityToken } from "./ai-entity-token";
import { aiOrigin } from "./activity-origin";
import { runTool } from "./chat-tools";
import { DEFAULT_TASK_STATUS, type ProjectMeta, type Task } from "./types";
import { useActivityLog } from "./use-activity-log";
import { useChatDispatcher } from "./use-chat-dispatcher";

function seedTask(id: number, taskName: string): Task {
  return {
    id,
    taskName,
    assignee: "M. Bennett",
    assigneeEmail: "",
    dueDate: "2026-09-30",
    lastUpdateDate: "2026-05-19",
    priority: "Medium",
    status: DEFAULT_TASK_STATUS,
    blockers: "",
    description: "",
  };
}

const STORED: ProjectMeta = {
  name: "Apollo",
  code: "AP-1",
  description: "Moon programme",
  projectManager: "Pat",
  keyStakeholdersInternal: [],
  keyStakeholdersExternal: [],
  customer: "Acme",
  naceSection: "C",
  identityTypes: ["B2B"],
  products: "Rockets",
  deployment: "Cloud",
  startDate: "2030-03-01",
  endDate: "2030-12-31",
  profitCenter: "PC1",
  contactPersons: [],
  regulatory: [],
  knowledgeLinks: [],
};

const TASKS = [seedTask(1, "First"), seedTask(2, "Second")];

type Writer = (meta: ProjectMeta) => Promise<boolean>;

function mount(writer: Writer = async () => true) {
  const projectWriterRef = { current: writer as Writer | null };
  return renderHook(
    () => {
      const log = useActivityLog();
      const dispatcher = useChatDispatcher(makeDispatcherArgs({ logActivityAi: log.logActivityAi, projectWriterRef }));
      return { log, dispatcher };
    },
    { wrapper: dispatcherWrapperWith({ tasks: TASKS, project: STORED }) },
  );
}

type Rendered = ReturnType<typeof mount>["result"];

/** The stored entries of `kind` whose first arg is `first`. */
function entriesFor(result: Rendered, kind: string, first: string | number) {
  return result.current.log.activityLog.filter((e) => e.kind === kind && e.args[0] === first);
}

describe("§799 — a chat tool row carries the origin of the call that ran it", () => {
  test("runTool forwards its origin to the handler's stored row", async () => {
    const { result } = mount();
    await act(async () => {
      await runTool(result.current.dispatcher, "update_task", {
        id: 1, expectedToken: entityToken("task", TASKS[0]), taskName: "First, renamed",
      }, aiOrigin("inlineEdit"));
    });
    const rows = entriesFor(result, "task.updated", 1);
    expect(rows).toHaveLength(1);
    expect(rows[0].actor).toBe("ai");
    expect(rows[0].origin).toEqual({ feature: "inlineEdit" });
  });

  test("a link on the origin reaches the stored row unchanged", async () => {
    const { result } = mount();
    const origin = aiOrigin("chat", { threadId: "t-1", requestId: "r-1" });
    await act(async () => {
      await runTool(result.current.dispatcher, "create_milestone", { name: "Go-live", date: "2026-10-01" }, origin);
    });
    const rows = result.current.log.activityLog.filter((e) => e.kind === "milestone.created");
    expect(rows).toHaveLength(1);
    expect(rows[0].origin).toEqual({ feature: "chat", threadId: "t-1", requestId: "r-1" });
  });

  test("two overlapping calls on two tasks: each row carries its own feature", async () => {
    const { result } = mount();
    const d = result.current.dispatcher;
    await act(async () => {
      // ★ The first is NOT awaited before the second starts.
      const first = runTool(d, "update_task", {
        id: 1, expectedToken: entityToken("task", TASKS[0]), taskName: "First, by chat",
      }, aiOrigin("chat"));
      const second = runTool(d, "update_task", {
        id: 2, expectedToken: entityToken("task", TASKS[1]), taskName: "Second, by insight",
      }, aiOrigin("insightRecommendation"));
      await Promise.all([first, second]);
    });
    const one = entriesFor(result, "task.updated", 1);
    const two = entriesFor(result, "task.updated", 2);
    expect(one).toHaveLength(1);
    expect(two).toHaveLength(1);
    expect(one[0].origin?.feature).toBe("chat");
    expect(two[0].origin?.feature).toBe("insightRecommendation");
  });

  // ★★★ THE CASE THE TASK PAIR ABOVE CANNOT SEE. `update_task`'s handler never suspends, so a design
  //   that parked the origin on the dispatcher at `runTool` entry would pass it too. `update_project`
  //   AWAITS the project writer before it logs: both calls are in flight at once, and the SECOND to
  //   start finishes FIRST — a stored "current origin" would stamp both rows with the second's feature.
  test("two overlapping calls whose handler awaits before it logs: each row carries its own feature", async () => {
    const resolvers: (() => void)[] = [];
    const { result } = mount(() => new Promise<boolean>((resolve) => { resolvers.push(() => resolve(true)); }));
    const d = result.current.dispatcher;
    const token = entityToken("project", STORED);
    await act(async () => {
      const byChat = runTool(d, "update_project", { expectedToken: token, customer: "Globex" }, aiOrigin("chat"));
      const byInsight = runTool(d, "update_project", { expectedToken: token, description: "Lunar programme" }, aiOrigin("insightRecommendation"));
      await Promise.resolve();
      expect(resolvers).toHaveLength(2); // anti-vacuity: both writes are in flight at once
      resolvers[1](); // the second call's write lands first
      await byInsight;
      resolvers[0]();
      await byChat;
    });
    const customer = entriesFor(result, "project.updated", "customer");
    const description = entriesFor(result, "project.updated", "description");
    expect(customer).toHaveLength(1);
    expect(description).toHaveLength(1);
    expect(customer[0].origin?.feature).toBe("chat");
    expect(description[0].origin?.feature).toBe("insightRecommendation");
  });
});
