import { describe, test, expect, vi, beforeEach } from "vitest";
vi.mock("./diagnostics", async (orig) => ({ ...(await orig<typeof import("./diagnostics")>()), logDiag: vi.fn() }));
import { logDiag } from "./diagnostics";
import { runChatSend, type ChatSendDeps, type ChatTurnResponse, type PendingProposal } from "./chat-send-loop";
import { CONTINUE_NUDGE, INTERRUPTED_TOOL_RESULT, type ApiMessage, type ContentBlock, type DisplayItem, type ToolResultBlock } from "./chat-api";
import { PROPOSAL_PENDING_RESULT, stagedToolResult } from "./chat-proposal-stage";
import { PERSON_FIELDS_REMOVED_NOTE } from "./ai-person-fields";
import { emptyWorkspace, type Workspace } from "./workspace";
import type { Absence, Resource, Task } from "./types";
import { openSendRecord } from "./chat-send-record";

const mockLogDiag = vi.mocked(logDiag);

function turn(stopReason: string, content: ContentBlock[], cacheWrite = 0): ChatTurnResponse {
  return {
    content,
    stop_reason: stopReason,
    usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: cacheWrite, cache_read_input_tokens: 0 },
  };
}
const text = (t: string): ContentBlock => ({ type: "text", text: t });
const use = (id: string, name: string, input: Record<string, unknown> = {}): ContentBlock => ({ type: "tool_use", id, name, input });

const HISTORY: ApiMessage[] = [{ role: "user", content: "hello" }];

/** A send over scripted turns: every request is recorded (a copy of what it was sent) and answered by the
 *  next turn; a turn that is an Error is thrown instead. */
function harness(turns: (ChatTurnResponse | Error)[], over: Partial<ChatSendDeps> = {}) {
  const sent: ApiMessage[][] = [];
  const ran: string[] = [];
  const staged: PendingProposal[] = [];
  let display: DisplayItem[] = [];
  let clock = 1000;
  const queue = [...turns];
  const deps: ChatSendDeps = {
    maxTurns: 10,
    messages: HISTORY,
    sendRecord: openSendRecord(HISTORY),
    stale: () => false,
    request: async (messages) => {
      sent.push(messages.map((m) => ({ ...m })));
      const next = queue.shift();
      if (next === undefined) throw new Error("no scripted turn left");
      if (next instanceof Error) throw next;
      return next;
    },
    now: () => (clock += 10),
    executeTool: async (name) => {
      ran.push(name);
      return { ok: true, name };
    },
    updateDisplay: (update) => { display = update(display); },
    stageProposal: (p) => { staged.push(p); },
    rowTitle: () => "row",
    dispatcher: {
      getForecastScenarioRow: () => null,
      getSnapshot: () => ({ enabledModules: undefined }),
      previewSettings: () => ({}),
    } as unknown as ChatSendDeps["dispatcher"],
    toolFlags: { historySearch: true, chatSearch: true },
    getScopeEpoch: () => 0,
    sendEpoch: 0,
    getWorkspace: () => undefined,
    getHolidaySet: () => undefined,
    reviewAllWrites: () => false,
    proposalOrigin: { kind: "chat" } as unknown as ChatSendDeps["proposalOrigin"],
    ...over,
  };
  return { deps, sent, ran, staged, display: () => display };
}

/** The tool_result blocks of one user message, by id. */
function answers(m: ApiMessage | undefined): ToolResultBlock[] {
  if (!m || m.role !== "user" || typeof m.content === "string") return [];
  return m.content.filter((b): b is ToolResultBlock => b.type === "tool_result");
}

beforeEach(() => {
  mockLogDiag.mockClear();
});

describe("runChatSend — the direct tool path", () => {
  test("a tool turn runs its tools in order and feeds every result back on the next request", async () => {
    const h = harness([
      turn("tool_use", [text("Looking."), use("u1", "list_tasks"), use("u2", "update_task", { id: 1, title: "x" })], 7),
      turn("end_turn", [text("Done.")], 3),
    ]);
    const out = await runChatSend(h.deps);
    expect(out.threw).toBe(false);
    if (out.threw) return;
    expect(h.ran).toEqual(["list_tasks", "update_task"]);
    expect(h.sent).toHaveLength(2);
    const fed = answers(h.sent[1].at(-1));
    expect(fed.map((a) => a.tool_use_id)).toEqual(["u1", "u2"]);
    expect(out.completed).toBe(true);
    // One applied entity write (the read is not one), counted on the send's record.
    expect(out.sendRecord.appliedWrites).toBe(1);
    expect(out.counters).toEqual({ requests: 2, cacheWrite: 10, firstRequestAt: 1010, lastRequestAt: 1020 });
    // The tool output broke the text flow: two bubbles, with the tool lines between them.
    expect(h.display().map((d) => d.kind)).toEqual(["assistant", "tool", "tool", "assistant"]);
    // The input history is copied, never mutated.
    expect(HISTORY).toHaveLength(1);
    expect(out.messages.slice(0, 1)).toEqual(HISTORY);
  });

  test("a tool that throws is answered as an error and not counted as an applied write", async () => {
    const h = harness([turn("tool_use", [use("u1", "update_task", { id: 1 })]), turn("end_turn", [text("Sorry.")])], {
      executeTool: async () => { throw new Error("stale token"); },
    });
    const out = await runChatSend(h.deps);
    if (out.threw) throw out.error;
    expect(answers(h.sent[1].at(-1))).toEqual([{ type: "tool_result", tool_use_id: "u1", content: "stale token", is_error: true }]);
    expect(h.display()[0]).toMatchObject({ kind: "tool", name: "update_task", result: "stale token", error: true });
    expect(out.sendRecord.appliedWrites).toBe(0);
  });

  test("a tool_use turn carrying no tool_use block pushes no empty carrier", async () => {
    const h = harness([turn("tool_use", [text("Hmm.")]), turn("end_turn", [text("Ok.")])]);
    const out = await runChatSend(h.deps);
    if (out.threw) throw out.error;
    expect(h.sent[1].at(-1)?.role).toBe("assistant");
    expect(out.messages.some((m) => Array.isArray(m.content) && m.content.length === 0)).toBe(false);
    expect(out.completed).toBe(true);
  });

  test("a scope move during the first of two tools stops the second (site chat-panel.toolLoop)", async () => {
    let epoch = 0;
    const h = harness([turn("tool_use", [use("u1", "list_tasks"), use("u2", "update_task", { id: 2 })])], {
      getScopeEpoch: () => epoch,
      executeTool: async (name) => {
        h.ran.push(name);
        epoch += 1; // the first tool's handler moved the scope
        return {};
      },
      stale: () => epoch !== 0,
    });
    const out = await runChatSend(h.deps);
    if (out.threw) throw out.error;
    expect(h.ran).toEqual(["list_tasks"]);
    expect(answers(out.messages.at(-1)).map((a) => a.tool_use_id)).toEqual(["u1"]);
    expect(mockLogDiag).toHaveBeenCalledWith("warn", "storage.staleScopeWriteDropped", { writer: "chat-panel.toolLoop", tool: "update_task" });
    expect(h.sent).toHaveLength(1);
  });
});

describe("runChatSend — the staged path", () => {
  test("a staged turn runs its reads in place, stages one card and answers every id; a second staging turn gets PROPOSAL_PENDING", async () => {
    const h = harness([
      turn("tool_use", [use("a", "list_tasks"), use("b", "delete_task", { id: 1 }), use("c", "list_milestones")]),
      turn("tool_use", [use("d", "delete_task", { id: 2 }), use("e", "list_raid")]),
      turn("end_turn", [text("Waiting for you.")]),
    ]);
    const out = await runChatSend(h.deps);
    if (out.threw) throw out.error;
    // Reads ran in place, in the turn's order; the delete ran in neither turn.
    expect(h.ran).toEqual(["list_tasks", "list_milestones", "list_raid"]);
    expect(h.staged).toHaveLength(1);
    expect(h.staged[0].rows).toHaveLength(1);
    expect(h.staged[0].scopeEpoch).toBe(0);
    // Every id of the staging turn answered exactly once, in order.
    const first = answers(h.sent[1].at(-1));
    expect(first.map((a) => a.tool_use_id)).toEqual(["a", "b", "c"]);
    expect(first[1].content).not.toBe(INTERRUPTED_TOOL_RESULT);
    // The second turn would stage again: its write is answered as pending, its read still runs.
    const second = answers(h.sent[2].at(-1));
    expect(second.map((a) => a.tool_use_id)).toEqual(["d", "e"]);
    expect(second[0].content).toBe(PROPOSAL_PENDING_RESULT);
    expect(second[1].content).not.toBe(PROPOSAL_PENDING_RESULT);
    expect(out.sendRecord.staged).toBe(true);
    expect(h.display().filter((d) => d.kind === "proposal")).toHaveLength(1);
    expect(out.completed).toBe(true);
  });

  test("a scope move during a staged turn's reads stages no card and answers the rest INTERRUPTED (site chat-panel.stagedRead)", async () => {
    let epoch = 0;
    const h = harness([turn("tool_use", [use("a", "list_tasks"), use("b", "list_milestones"), use("c", "delete_task", { id: 1 })])], {
      getScopeEpoch: () => epoch,
      executeTool: async (name) => {
        h.ran.push(name);
        epoch += 1;
        return {};
      },
      stale: () => epoch !== 0,
    });
    const out = await runChatSend(h.deps);
    if (out.threw) throw out.error;
    expect(h.ran).toEqual(["list_tasks"]);
    expect(h.staged).toHaveLength(0);
    const fed = answers(out.messages.at(-1));
    expect(fed.map((a) => a.tool_use_id)).toEqual(["a", "b", "c"]);
    expect(fed.slice(1).map((a) => a.content)).toEqual([INTERRUPTED_TOOL_RESULT, INTERRUPTED_TOOL_RESULT]);
    expect(mockLogDiag).toHaveBeenCalledWith("warn", "storage.staleScopeWriteDropped", { writer: "chat-panel.stagedRead", tool: "list_milestones" });
  });
});

describe("runChatSend — continuation, cap, failure, stale", () => {
  test("a max_tokens turn answers its partial tool_use INTERRUPTED, nudges, and stitches the next text onto the same bubble", async () => {
    const h = harness([turn("max_tokens", [text("Hello "), use("p", "update_task", { id: 1 })]), turn("end_turn", [text("world")])]);
    const out = await runChatSend(h.deps);
    if (out.threw) throw out.error;
    expect(h.ran).toEqual([]);
    const nudge = h.sent[1].at(-1);
    expect(nudge?.role).toBe("user");
    expect(nudge?.content).toEqual([
      { type: "tool_result", tool_use_id: "p", content: INTERRUPTED_TOOL_RESULT, is_error: true },
      { type: "text", text: CONTINUE_NUDGE },
    ]);
    expect(h.display()).toEqual([{ kind: "assistant", text: "Hello world" }]);
    expect(out.completed).toBe(true);
  });

  test("exhausting the turn cap returns completed false", async () => {
    const h = harness([turn("tool_use", [use("u1", "list_tasks")]), turn("tool_use", [use("u2", "list_tasks")])], { maxTurns: 2 });
    const out = await runChatSend(h.deps);
    if (out.threw) throw out.error;
    expect(out.completed).toBe(false);
    expect(out.counters.requests).toBe(2);
  });

  test("a thrown request still returns the counters of the requests that answered", async () => {
    const boom = new Error("boom");
    const h = harness([turn("tool_use", [use("u1", "list_tasks")], 5), boom]);
    const out = await runChatSend(h.deps);
    expect(out).toEqual({ threw: true, error: boom, counters: { requests: 1, cacheWrite: 5, firstRequestAt: 1010, lastRequestAt: 1010 } });
  });

  test("stale() before the call sends nothing", async () => {
    const h = harness([turn("end_turn", [text("never")])], { stale: () => true });
    const out = await runChatSend(h.deps);
    if (out.threw) throw out.error;
    expect(h.sent).toHaveLength(0);
    expect(out.completed).toBe(false);
    expect(out.counters.requests).toBe(0);
  });

  test("stale() after the call counts the request but writes nothing of the turn", async () => {
    let calls = 0;
    const h = harness([turn("end_turn", [text("late")], 4)], { stale: () => calls++ > 0 });
    const out = await runChatSend(h.deps);
    if (out.threw) throw out.error;
    expect(out.counters).toMatchObject({ requests: 1, cacheWrite: 4 });
    expect(out.messages).toEqual(HISTORY);
    expect(h.display()).toEqual([]);
  });
});

describe("runChatSend — the third stale() site and the bubble reset", () => {
  test("stale() after the turn's text shows the text but runs none of the turn's tools", async () => {
    let calls = 0;
    // Before the call, after it, then (third) after the text: only the third reads stale.
    const h = harness([turn("tool_use", [text("On it."), use("u1", "list_tasks")])], { stale: () => ++calls >= 3 });
    const out = await runChatSend(h.deps);
    if (out.threw) throw out.error;
    expect(h.display()).toEqual([{ kind: "assistant", text: "On it." }]);
    expect(h.ran).toEqual([]);
    expect(out.messages.at(-1)?.role).toBe("assistant");
    expect(out.completed).toBe(false);
  });

  test("a tool turn after a max_tokens turn takes the stitch, then the NEXT text starts a new bubble", async () => {
    // The tool turn carries no tool_use block, so no tool line sits between the bubbles: only the
    // reset of the stitch flag keeps "C" off the "AB" bubble.
    const h = harness([
      turn("max_tokens", [text("A")]),
      turn("tool_use", [text("B")]),
      turn("end_turn", [text("C")]),
    ]);
    const out = await runChatSend(h.deps);
    if (out.threw) throw out.error;
    expect(h.display()).toEqual([
      { kind: "assistant", text: "AB" },
      { kind: "assistant", text: "C" },
    ]);
  });
});

describe("runChatSend — what a staged result tells Claude", () => {
  const MAYA = { id: 1, firstName: "Maya", lastName: "Patel" } as Resource;
  // 2026-11-02 is a Monday.
  const MAYA_WEEK = { id: 1, assignee: "Maya Patel", resourceId: 1, type: "vacation", startDate: "2026-11-03", endDate: "2026-11-07" } as Absence;
  const TASK = { id: 1, taskName: "Ship the release", assignee: "Maya Patel", resourceId: 1, dueDate: "2026-11-12", status: "To Do", priority: "Medium" } as Task;
  const WORKSPACE = { ...emptyWorkspace(), tasks: [TASK], resources: [MAYA], absences: [MAYA_WEEK] } as Workspace;

  function stagedAnswers(h: ReturnType<typeof harness>, out: Awaited<ReturnType<typeof runChatSend>>): ToolResultBlock[] {
    if (out.threw) throw out.error;
    expect(h.staged).toHaveLength(1);
    return answers(h.sent[1].at(-1));
  }

  test("a lone date write that lands on an absence is staged, and its result names the clash", async () => {
    const h = harness([turn("tool_use", [use("t1", "update_task", { id: 1, dueDate: "2026-11-05" })]), turn("end_turn", [text("ok")])], {
      getWorkspace: () => WORKSPACE,
    });
    const [only] = stagedAnswers(h, await runChatSend(h.deps));
    expect(only.content).not.toBe(stagedToolResult(undefined));
    expect(only.content).toContain("absenceClashes:");
    expect(h.ran).toEqual([]);
  });

  test("the control: with Resources hidden the staged result names no clash (the card still stages)", async () => {
    const h = harness([turn("tool_use", [use("t1", "update_task", { id: 1, dueDate: "2026-11-05" })]), turn("end_turn", [text("ok")])], {
      getWorkspace: () => WORKSPACE,
      toolFlags: { historySearch: true, chatSearch: true, resourcesHidden: true },
    });
    const [only] = stagedAnswers(h, await runChatSend(h.deps));
    expect(only.content).toBe(stagedToolResult(undefined));
  });

  test("under people protection a staged call's removed person fields are named in its result", async () => {
    const h = harness([
      turn("tool_use", [
        use("c1", "create_task", { taskName: "One", assignee: "Maya Patel" }),
        use("c2", "create_task", { taskName: "Two" }),
      ]),
      turn("end_turn", [text("ok")]),
    ], { toolFlags: { historySearch: true, chatSearch: true, peopleProtected: true } });
    const [first, second] = stagedAnswers(h, await runChatSend(h.deps));
    expect(first.content).toContain(PERSON_FIELDS_REMOVED_NOTE(["assignee"]));
    // A call that carried no person field gets no note.
    expect(second.content).not.toContain(PERSON_FIELDS_REMOVED_NOTE(["assignee"]));
    // Both creates went on the one card.
    expect(h.staged[0].rows).toHaveLength(2);
  });
});
