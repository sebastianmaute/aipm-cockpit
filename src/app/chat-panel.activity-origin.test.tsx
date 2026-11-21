// src/app/chat-panel.activity-origin.test.tsx — §799: every chat send mints a request id on its user item, and
// the activity origin the chat's writes carry links to that thread and request in Turso mode ONLY. A staged
// proposal keeps the origin of the request that staged it, even when it is applied after a later request.
import "fake-indexeddb/auto";
import "../test/ai-consent-live";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { spyAiFetch } from "../test/fetch-real-response";
import { DIRECT_AI_STATUS } from "../test/ai-status-fetch";
import { setAiDeploymentState } from "./ai-deployment";
import { clearSessionAiKey } from "./session-ai-key";
import { ChatPanel } from "./chat-panel";
import { loadThreads, saveThread } from "./chat-threads-store";
import type { ChatThread } from "./chat-threads";
import { newConsent } from "./ai-consent";
import { entityToken } from "./ai-entity-token";
import { aiOrigin } from "./activity-origin";
import { defaultAiConfig } from "./settings-types";
import { emptyWorkspace, type Workspace } from "./workspace";
import type { ToolDispatcher } from "./chat-tools";
import type { Task } from "./types";

// Rendered without task-manager's AI privacy provider: requests carry the privacy of no project.
vi.mock("./ai-privacy-context", () => import("../test/ai-privacy-unprotected"));

vi.mock("./chat-threads-store", () => ({
  loadThreads: vi.fn(async () => []),
  saveThread: vi.fn(async () => undefined),
  deleteThread: vi.fn(async () => undefined),
  expireThreads: vi.fn(async () => undefined),
}));

vi.mock("./chat-key-vault", () => ({
  chatVaultAvailable: () => true,
  readChatIdentity: vi.fn(async () => ({ kind: "absent" })),
  getChatIdentity: vi.fn(async () => null),
  ensureChatIdentity: vi.fn(async () => ({ ownerId: "owner-test", chatKey: new Uint8Array(32) })),
  storedChatOwnerId: () => "owner-test",
  storedChatOwnerIds: () => ["owner-test"],
}));

const CHAT_ON = { retentionDays: 30, retentionInvalid: false, recoveryKey: "recovery-spki", recoveryKeyInvalid: false };
beforeEach(() => {
  setAiDeploymentState({ ...DIRECT_AI_STATUS, chat: CHAT_ON });
  vi.mocked(loadThreads).mockClear();
  vi.mocked(saveThread).mockClear();
});
afterEach(() => {
  clearSessionAiKey();
  vi.restoreAllMocks();
});

const SCOPE_PROPS = { getScopeEpoch: () => 0, isSwapInFlight: () => false };
const AI = { ...defaultAiConfig, enabled: true, consent: newConsent(new Date(0)), apiKey: "sk-test" };
const CARD = { name: "Proposed changes" } as const;
const TASK = {
  id: 1, taskName: "Ship it", assignee: "Alice", dueDate: "2030-12-31", lastUpdateDate: "2030-01-01",
  status: "To Do", priority: "Medium", blockers: "", description: "",
} as Task;
const WORKSPACE = { ...emptyWorkspace(), tasks: [TASK] } as Workspace;
// Hoisted so a rerender changes `tursoMode` alone.
const TURSO_CONFIG = {} as never;

function makeDispatcher(): ToolDispatcher {
  return {
    listTasks: vi.fn(() => [TASK]),
    getTask: vi.fn(() => TASK),
    updateTask: vi.fn(() => ({ ...TASK, status: "Done" })),
    deleteTask: vi.fn(() => true),
    getSnapshot: vi.fn(() => ({
      today: "2026-06-04", language: "en-US", holidayCountries: [], storageKind: "memory", taskCount: 1,
      knownGroups: [], knownLabels: [], mode: "advanced" as const, enabledModules: [] as string[], currentView: "open-points" as const,
    })),
    isPeopleProtected: () => false, isResourcesHidden: () => false, isStakeholdersHidden: () => false,
  } as unknown as ToolDispatcher;
}

type Block = { type: string; id?: string; name?: string; input?: unknown; text?: string };
const usage = { input_tokens: 1, output_tokens: 1 };
const toolTurn = (content: Block[]) => ({ content, stop_reason: "tool_use", usage });
const doneTurn = (text: string) => ({ content: [{ type: "text", text }], stop_reason: "end_turn", usage });
const loneWrite = toolTurn([
  { type: "tool_use", id: "w1", name: "update_task", input: { id: 1, expectedToken: entityToken("task", TASK), status: "Done" } },
]);

function scriptFetch(turns: unknown[]) {
  let call = 0;
  spyAiFetch().mockImplementation(() => {
    const body = turns[Math.min(call, turns.length - 1)];
    call += 1;
    return Promise.resolve({ ok: true, text: () => Promise.resolve(""), json: () => Promise.resolve(body) } as unknown as Response);
  });
}

function panel(dispatcher: ToolDispatcher, tursoMode: boolean) {
  return (
    <ChatPanel {...SCOPE_PROPS} lang="en-US" ai={AI} dispatcher={dispatcher} workspace={WORKSPACE}
      tursoMode={tursoMode} tursoConfig={TURSO_CONFIG} />
  );
}

function send(text: string) {
  fireEvent.change(screen.getByPlaceholderText("Ask Claude about your tasks…"), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
}

/** Let the mount's thread-list fetch settle, so its reset cannot race the first send. */
async function settleThreadLoad() {
  await waitFor(() => expect(loadThreads).toHaveBeenCalledTimes(1));
  await vi.mocked(loadThreads).mock.results[0]!.value;
}

/** The saved thread and the requestId on its user item `text`, read from the latest save that holds it. */
function savedRequest(text: string): { threadId: string; requestId: unknown } {
  const saves = vi.mocked(saveThread).mock.calls.map((c) => c[1] as ChatThread);
  const hit = [...saves].reverse().find((th) => th.display.some((d) => d.kind === "user" && d.text === text));
  if (!hit) throw new Error(`no save holds the user item "${text}"`);
  const item = hit.display.find((d) => d.kind === "user" && d.text === text) as { requestId?: unknown };
  return { threadId: hit.id, requestId: item.requestId };
}

describe("the chat origin of a write (§799)", () => {
  it("in Turso mode a write carries the thread and the request id on the user item", async () => {
    const dispatcher = makeDispatcher();
    scriptFetch([loneWrite, doneTurn("ok")]);
    render(panel(dispatcher, true));
    await settleThreadLoad();
    send("mark it done");
    await screen.findByText("ok");
    expect(dispatcher.updateTask).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(saveThread).toHaveBeenCalled());
    const { threadId, requestId } = savedRequest("mark it done");
    expect(typeof requestId).toBe("string");
    expect(requestId).not.toBe("");
    expect(vi.mocked(dispatcher.updateTask).mock.calls[0].at(-1)).toEqual(
      aiOrigin("chat", { threadId, requestId: requestId as string }),
    );
  });

  it("in file mode a write carries the feature only, even while the panel holds a thread id", async () => {
    vi.mocked(loadThreads).mockResolvedValueOnce([
      {
        id: "t1", projectId: "default", ownerId: null, name: "Prior chat", createdAt: "c",
        updatedAt: new Date().toISOString(), history: [], display: [{ kind: "user", text: "prior message" }],
      },
    ] satisfies ChatThread[]);
    const dispatcher = makeDispatcher();
    scriptFetch([loneWrite, doneTurn("ok")]);
    // ★ A RERENDER, never a second render: a remount would reseed the thread id to null and the test
    //   could not tell "gated on tursoMode" from "gated on a thread id existing".
    const { rerender } = render(panel(dispatcher, true));
    await screen.findByText("prior message"); // Turso mode adopted t1
    rerender(panel(dispatcher, false));
    send("mark it done");
    await screen.findByText("ok");
    expect(dispatcher.updateTask).toHaveBeenCalledTimes(1);
    expect(vi.mocked(dispatcher.updateTask).mock.calls[0].at(-1)).toEqual({ feature: "chat" });
  });

  it("a proposal applied after a later request stamps the request that staged it", async () => {
    const dispatcher = makeDispatcher();
    scriptFetch([
      // A delete always stages, so the card is the only way this write can run.
      toolTurn([{ type: "tool_use", id: "d1", name: "delete_task", input: { id: 1, expectedToken: entityToken("task", TASK) } }]),
      doneTurn("staged"),
      doneTurn("later"),
    ]);
    render(panel(dispatcher, true));
    await settleThreadLoad();
    send("first request");
    const card = await screen.findByRole("region", CARD);
    await screen.findByText("staged");
    send("second request");
    await screen.findByText("later");
    await waitFor(() => expect(() => savedRequest("second request")).not.toThrow());
    const first = savedRequest("first request");
    const second = savedRequest("second request");
    expect(typeof first.requestId).toBe("string");
    expect(typeof second.requestId).toBe("string");
    expect(first.requestId).not.toBe(second.requestId); // never reused
    expect(dispatcher.deleteTask).not.toHaveBeenCalled();
    fireEvent.click(within(card).getByRole("button", { name: /^Apply \(/ }));
    await waitFor(() => expect(dispatcher.deleteTask).toHaveBeenCalledTimes(1));
    expect(dispatcher.deleteTask).toHaveBeenCalledWith(
      1,
      aiOrigin("chatProposal", { threadId: first.threadId, requestId: first.requestId as string }),
    );
  });
});
