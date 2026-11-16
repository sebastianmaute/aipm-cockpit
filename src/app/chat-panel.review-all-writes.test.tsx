// src/app/chat-panel.review-all-writes.test.tsx — §794: with the project's "review every AI write" switch on,
// a lone chat write goes to the review card instead of being written; with it off it applies at once.
import "fake-indexeddb/auto";
import "../test/ai-consent-live";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import type { ReactNode } from "react";
import { ChatPanel } from "./chat-panel";
import { AiPrivacyProvider, useAiPrivacySource } from "./ai-privacy-context";
import { withPeopleAllowed } from "./ai-people-protection";
import { withAiSwitch } from "./ai-project-switches";
import { setDisabledIntegrations } from "./integration-switches";
import { newConsent } from "./ai-consent";
import { entityToken } from "./ai-entity-token";
import { defaultAiConfig } from "./settings-types";
import { emptyWorkspace, type Workspace } from "./workspace";
import type { ToolDispatcher } from "./chat-tools";
import type { Task } from "./types";

vi.mock("./chat-threads-store", () => ({
  loadThreads: vi.fn(async () => []),
  saveThread: vi.fn(async () => undefined),
  deleteThread: vi.fn(async () => undefined),
}));

afterEach(() => {
  vi.restoreAllMocks();
  setDisabledIntegrations([]);
});

const SCOPE_PROPS = { getScopeEpoch: () => 0, isSwapInFlight: () => false };
const AI = { ...defaultAiConfig, enabled: true, consent: newConsent(new Date(0)), apiKey: "sk-test" };
const CARD = { name: "Proposed changes" } as const;
const TASK = { id: 1, taskName: "Ship the release", assignee: "", dueDate: "2026-11-12", status: "To Do", priority: "Medium" } as Task;

function makeDispatcher(): ToolDispatcher {
  let row: Task = TASK;
  return {
    listTasks: vi.fn(() => [row]),
    getTask: vi.fn((id: number) => (id === row.id ? row : null)),
    updateTask: vi.fn((id: number, patch: Partial<Task>) => {
      if (id !== row.id) return null;
      row = { ...row, ...patch };
      return row;
    }),
    absenceClashesFor: vi.fn(() => []),
    isPeopleProtected: () => false, isResourcesHidden: () => false,
    getSnapshot: vi.fn(() => ({
      today: "2026-10-30", language: "en-US", holidayCountries: [], storageKind: "memory", taskCount: 1,
      knownGroups: [], knownLabels: [], mode: "advanced" as const, enabledModules: [] as string[], currentView: "open-points" as const,
    })),
  } as unknown as ToolDispatcher;
}

const usage = { input_tokens: 1, output_tokens: 1 };
const loneWrite = {
  content: [{ type: "tool_use", id: "t1", name: "update_task", input: { id: 1, expectedToken: entityToken("task", TASK), priority: "High" } }],
  stop_reason: "tool_use",
  usage,
};
const doneTurn = { content: [{ type: "text", text: "done" }], stop_reason: "end_turn", usage };

function scriptFetch(turns: unknown[]) {
  let call = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation(() => {
    const body = turns[Math.min(call, turns.length - 1)];
    call += 1;
    return Promise.resolve({ ok: true, text: () => Promise.resolve(""), json: () => Promise.resolve(body) } as unknown as Response);
  });
}

function mountAndSend(dispatcher: ToolDispatcher, overrides: Workspace["settingsOverrides"]) {
  const ws: Workspace = { ...emptyWorkspace(), tasks: [TASK], settingsOverrides: overrides };
  function Source({ children }: { children: ReactNode }) {
    useAiPrivacySource("p1", () => ws, () => 0);
    return <>{children}</>;
  }
  render(
    <AiPrivacyProvider>
      <Source>
        <ChatPanel {...SCOPE_PROPS} lang="en-US" ai={AI} dispatcher={dispatcher} workspace={ws} projectId="p1" />
      </Source>
    </AiPrivacyProvider>,
  );
  fireEvent.change(screen.getByPlaceholderText("Ask Claude about your tasks…"), { target: { value: "raise it" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
}

const ALLOWED = withPeopleAllowed(undefined, true);

describe("a lone chat write when the project reviews every AI write (§794)", () => {
  it("lands on the review card and is not written", async () => {
    // Mutation: dropping the flag from the gate's `shouldStage` call turns this red — the write runs at once.
    const dispatcher = makeDispatcher();
    scriptFetch([loneWrite, doneTurn]);
    mountAndSend(dispatcher, withAiSwitch(ALLOWED, "reviewAllWrites", true));
    await screen.findByRole("region", CARD);
    await screen.findByText("done");
    expect(dispatcher.updateTask).not.toHaveBeenCalled();
  });

  it("the deployment lock does the same with nothing stored", async () => {
    setDisabledIntegrations(["ai-direct-writes"]);
    const dispatcher = makeDispatcher();
    scriptFetch([loneWrite, doneTurn]);
    mountAndSend(dispatcher, ALLOWED);
    await screen.findByRole("region", CARD);
    expect(dispatcher.updateTask).not.toHaveBeenCalled();
  });

  it("CONTROL - without the switch the same lone write applies at once", async () => {
    const dispatcher = makeDispatcher();
    scriptFetch([loneWrite, doneTurn]);
    mountAndSend(dispatcher, ALLOWED);
    await screen.findByText("done");
    expect(dispatcher.updateTask).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("region", CARD)).toBeNull();
  });
});
