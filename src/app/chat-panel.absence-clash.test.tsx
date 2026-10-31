// src/app/chat-panel.absence-clash.test.tsx — §773 Task 4: a lone chat write that lands someone's work on
// their absence goes to the review card instead of being written; the staged tool result tells Claude about
// the clash while the card waits, and once approved the write lands.
import "fake-indexeddb/auto";
import "../test/ai-consent-live";
import { newConsent } from "./ai-consent";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
vi.mock("./ai-privacy-context", () => import("../test/ai-privacy-unprotected"));
import { ChatPanel } from "./chat-panel";
import type { ToolDispatcher } from "./chat-tools";
import { STAGED_TOOL_RESULT } from "./chat-proposal-stage";
import { peekMintId } from "./id-mint-session";
import { callAbsenceClashes } from "./chat-absence-clashes";
import { entityToken } from "./ai-entity-token";
import { defaultAiConfig as baseAiConfig } from "./settings-types";
import { emptyWorkspace, type Workspace } from "./workspace";
import type { Absence, Resource, Task } from "./types";

vi.mock("./chat-threads-store", () => ({
  loadThreads: vi.fn(async () => []),
  saveThread: vi.fn(async () => undefined),
  deleteThread: vi.fn(async () => undefined),
}));

vi.mock("./ai-usage-context", () => ({
  useAiUsageActions: vi.fn(() => ({ recordChatSend: vi.fn(), noteUnbilledChatSend: vi.fn() })),
  useAiUsageContext: vi.fn(() => ({
    sessionTotal: 0,
    sessionUsage: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 },
    weekTotal: 0,
    nextReset: new Date(),
    viewSwitchWeek: { sends: 0, requests: 0, switches: 0, warmSends: 0, switchCacheWrite: 0, warmCacheWrite: 0 },
    recordChatSend: vi.fn(),
    noteUnbilledChatSend: vi.fn(),
  })),
}));

vi.mock("./use-push-to-talk", () => ({
  usePushToTalk: () => ({
    listening: false, transcribing: false, supported: true, buttonHandlers: {}, toggle: () => {}, press: vi.fn(), release: vi.fn(),
  }),
}));

afterEach(() => vi.clearAllMocks());

const SCOPE_PROPS = { getScopeEpoch: () => 0, isSwapInFlight: () => false };
// ★ "sk-test" fails `isValidAnthropicApiKey`, so the model list never fetches; see chat-panel.scope.test.tsx.
const AI_WITH_KEY = { ...baseAiConfig, enabled: true, consent: newConsent(new Date(0)), apiKey: "sk-test" };
const CARD = { name: "Proposed changes" } as const;

const MAYA = { id: 1, firstName: "Maya", lastName: "Patel" } as Resource;
// 2026-11-02 is a Monday.
const MAYA_WEEK = { id: 1, assignee: "Maya Patel", resourceId: 1, type: "vacation", startDate: "2026-11-03", endDate: "2026-11-07" } as Absence;
const TASK = { id: 1, taskName: "Ship the release", assignee: "Maya Patel", resourceId: 1, dueDate: "2026-11-12", status: "To Do", priority: "Medium" } as Task;
const WORKSPACE = { ...emptyWorkspace(), tasks: [TASK], resources: [MAYA], absences: [MAYA_WEEK] } as Workspace;
const ABSENCE = { absences: [MAYA_WEEK], resources: [MAYA], holidaySet: new Set<string>() };

/** A dispatcher whose one task is stored and updated in place, and which judges clashes the way the live
 *  one does (`callAbsenceClashes` over the pre-write workspace). */
function makeDispatcher(): ToolDispatcher {
  let row: Task = TASK;
  return {
    listTasks: vi.fn(() => [row]),
    getTask: vi.fn((id: number) => (id === row.id ? row : null)),
    createTask: vi.fn(),
    updateTask: vi.fn((id: number, patch: Partial<Task>) => {
      if (id !== row.id) return null;
      row = { ...row, ...patch };
      return row;
    }),
    absenceClashesFor: vi.fn((name: string, input: Readonly<Record<string, unknown>>) => callAbsenceClashes({ name, input }, WORKSPACE, ABSENCE)),
    isPeopleProtected: () => false, // AI people protection: the executor asks on every write
    deleteTask: vi.fn(() => false),
    deleteAllTasks: vi.fn(() => 0),
    sendInquiry: vi.fn(() => ({ sent: false })),
    setFilters: vi.fn(),
    setLanguage: vi.fn(),
    getSnapshot: vi.fn(() => ({
      today: "2026-10-30", language: "en-US", holidayCountries: [], storageKind: "memory", taskCount: 1,
      knownGroups: [], knownLabels: [], mode: "advanced" as const, enabledModules: [] as string[], currentView: "open-points" as const,
    })),
  } as unknown as ToolDispatcher;
}

const usage = { input_tokens: 1, output_tokens: 1 };
const toolTurn = (...inputs: Record<string, unknown>[]) => ({
  content: inputs.map((input, i) => ({ type: "tool_use", id: `t${i + 1}`, name: "update_task", input })),
  stop_reason: "tool_use",
  usage,
});
const CLASH_JSON = JSON.stringify([
  { person: "Maya Patel", reason: "date-on-absence", date: "2026-11-05", ranges: [{ start: "2026-11-03", end: "2026-11-07" }] },
]);

/** The `tool_result` blocks a request body carries back to the model, by id. */
function resultsIn(body: string): Map<string, string> {
  const sent = JSON.parse(body) as { messages: { content: unknown }[] };
  const last = sent.messages[sent.messages.length - 1].content as { type: string; tool_use_id: string; content: string }[];
  return new Map(last.filter((b) => b.type === "tool_result").map((b) => [b.tool_use_id, b.content]));
}
const doneTurn = { content: [{ type: "text", text: "done" }], stop_reason: "end_turn", usage };

function scriptFetch(turns: unknown[], bodies: string[]) {
  let call = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation((_url, init?: RequestInit) => {
    bodies.push(String(init?.body ?? ""));
    const body = turns[Math.min(call, turns.length - 1)];
    call += 1;
    return Promise.resolve({ ok: true, text: () => Promise.resolve(""), json: () => Promise.resolve(body) } as unknown as Response);
  });
}

function mountAndSend(dispatcher: ToolDispatcher) {
  render(<ChatPanel {...SCOPE_PROPS} lang="en-US" ai={AI_WITH_KEY} dispatcher={dispatcher} workspace={WORKSPACE} />);
  fireEvent.change(screen.getByPlaceholderText("Ask Claude about your tasks…"), { target: { value: "move it" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
}

describe("a lone chat date write that clashes with an absence (§773)", () => {
  it("is staged with the warning on the card instead of being written", async () => {
    // Mutation: dropping the clash predicate from the gate's `shouldStage` call turns this red — the write
    // runs at once and no card appears.
    const dispatcher = makeDispatcher();
    const bodies: string[] = [];
    scriptFetch([toolTurn({ id: 1, dueDate: "2026-11-05" }), doneTurn], bodies);
    mountAndSend(dispatcher);

    const card = await screen.findByRole("region", CARD);
    expect(dispatcher.updateTask).not.toHaveBeenCalled();
    expect(within(card).getByText(/Maya Patel is absent on the due date/)).toBeInTheDocument();
    await screen.findByText("done");
    expect(bodies[1]).toContain("has NOT been applied");
  });

  it("a lone date write with no clash still applies at once", async () => {
    const dispatcher = makeDispatcher();
    const bodies: string[] = [];
    scriptFetch([toolTurn({ id: 1, expectedToken: entityToken("task", TASK), dueDate: "2026-11-13" }), doneTurn], bodies);
    mountAndSend(dispatcher);

    await screen.findByText("done");
    expect(dispatcher.updateTask).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("region", CARD)).toBeNull();
    expect(bodies[1]).not.toContain("has NOT been applied");
  });

  it("the staged tool result tells Claude about the clash, and approving the card writes the task", async () => {
    // Mutation: staging with `stagedToolResult(mintedId)` alone (no clashes) turns this red — Claude is told
    // only that the write waits, with no word of the absence.
    const dispatcher = makeDispatcher();
    const bodies: string[] = [];
    scriptFetch([toolTurn({ id: 1, dueDate: "2026-11-05" }), doneTurn], bodies);
    mountAndSend(dispatcher);

    const card = await screen.findByRole("region", CARD);
    await screen.findByText("done");
    const staged = resultsIn(bodies[1]).get("t1") ?? "";
    expect(staged.startsWith(STAGED_TOOL_RESULT)).toBe(true);
    expect(staged).toContain(`absenceClashes: ${CLASH_JSON}`);

    fireEvent.click(within(card).getByRole("button", { name: /^Apply \(/ }));
    await waitFor(() => expect(dispatcher.updateTask).toHaveBeenCalledTimes(1));
    expect(dispatcher.getTask(1)?.dueDate).toBe("2026-11-05");
  });

  it("in a staged turn only the clashing call's result names a clash; the other keeps today's text", async () => {
    const dispatcher = makeDispatcher();
    const bodies: string[] = [];
    scriptFetch([toolTurn({ id: 1, dueDate: "2026-11-05" }, { id: 1, priority: "High" }), doneTurn], bodies);
    mountAndSend(dispatcher);

    await screen.findByRole("region", CARD);
    await screen.findByText("done");
    const results = resultsIn(bodies[1]);
    expect(results.get("t1")).toContain(`absenceClashes: ${CLASH_JSON}`);
    expect(results.get("t2")).toBe(STAGED_TOOL_RESULT);
  });
});

// §773 — a change to a task created earlier in the same turn: its target is in no workspace yet.
describe("a chat change to a task created earlier in the same turn (§773)", () => {
  /** `create_task` (no date), then `update_task` on the id the staging will provisionally mint for it. */
  function createThenMove(dueDate: string) {
    const provisional = peekMintId("task", WORKSPACE.tasks);
    return {
      content: [
        { type: "tool_use", id: "t1", name: "create_task", input: { taskName: "Draft", assignee: "Maya Patel" } },
        { type: "tool_use", id: "t2", name: "update_task", input: { id: provisional, dueDate } },
      ],
      stop_reason: "tool_use",
      usage,
    };
  }

  it("a move onto the owner's absence shows the warning and tells Claude in that call's staged result", async () => {
    // Mutation: describing a pending row with an empty plan (no turn judgment) turns this red.
    const bodies: string[] = [];
    scriptFetch([createThenMove("2026-11-05"), doneTurn], bodies);
    mountAndSend(makeDispatcher());

    const card = await screen.findByRole("region", CARD);
    expect(within(card).getByText(/Maya Patel is absent on the due date/)).toBeInTheDocument();
    await screen.findByText("done");
    const results = resultsIn(bodies[1]);
    expect(results.get("t2")).toContain(`absenceClashes: ${CLASH_JSON}`);
    expect(results.get("t1")).not.toContain("absenceClashes");
  });

  it("a move onto a free day warns nowhere and the staged results are unchanged", async () => {
    const bodies: string[] = [];
    scriptFetch([createThenMove("2026-11-13"), doneTurn], bodies);
    mountAndSend(makeDispatcher());

    const card = await screen.findByRole("region", CARD);
    await screen.findByText("done");
    expect(within(card).queryByText(/is absent/)).toBeNull();
    const results = resultsIn(bodies[1]);
    expect(results.get("t2")).toBe(STAGED_TOOL_RESULT);
    expect(results.get("t1")).not.toContain("absenceClashes");
  });
});
