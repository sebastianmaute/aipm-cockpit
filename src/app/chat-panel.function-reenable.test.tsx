// src/app/chat-panel.function-reenable.test.tsx — §810: through the real chat send, a lone update_settings that
// turns a hidden function back on waits on the review card; with the function shown it applies at once.
import "fake-indexeddb/auto";
import "../test/ai-consent-live";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { spyAiFetch } from "../test/fetch-real-response";
import type { ReactNode } from "react";
import { ChatPanel } from "./chat-panel";
import { AiPrivacyProvider, useAiPrivacySource } from "./ai-privacy-context";
import { withPeopleAllowed } from "./ai-people-protection";
import { setDisabledIntegrations } from "./integration-switches";
import { newConsent } from "./ai-consent";
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

function makeDispatcher(resourcesHidden: boolean): ToolDispatcher {
  let row: Task = TASK;
  let features: string[] = resourcesHidden ? ["raid"] : ["raid", "resources"];
  return {
    listTasks: vi.fn(() => [row]),
    getTask: vi.fn((id: number) => (id === row.id ? row : null)),
    updateTask: vi.fn((id: number, patch: Partial<Task>) => {
      if (id !== row.id) return null;
      row = { ...row, ...patch };
      return row;
    }),
    absenceClashesFor: vi.fn(() => []),
    isPeopleProtected: () => false, isResourcesHidden: () => !features.includes("resources"), isStakeholdersHidden: () => false,
    listResources: vi.fn(() => []),
    updateSettings: vi.fn((patch: { enabledModules?: string[] }) => {
      if (patch.enabledModules) features = [...patch.enabledModules];
      return { enabledModules: features };
    }),
    previewSettings: vi.fn(() => ({ enabledModules: ["raid", "resources"] })),
    getSnapshot: vi.fn(() => ({
      today: "2026-10-30", language: "en-US", holidayCountries: [], storageKind: "memory", taskCount: 1,
      knownGroups: [], knownLabels: [], mode: "advanced" as const, enabledModules: [...features], currentView: "open-points" as const,
    })),
  } as unknown as ToolDispatcher;
}

const usage = { input_tokens: 1, output_tokens: 1 };
const reEnable = {
  content: [{ type: "tool_use", id: "t1", name: "update_settings", input: { enabledModules: ["raid", "resources"] } }],
  stop_reason: "tool_use",
  usage,
};
const doneTurn = { content: [{ type: "text", text: "done" }], stop_reason: "end_turn", usage };

function scriptFetch(turns: unknown[]): string[] {
  let call = 0;
  const bodies: string[] = [];
  spyAiFetch().mockImplementation((_url, init?: RequestInit) => {
    bodies.push(String(init?.body ?? ""));
    const body = turns[Math.min(call, turns.length - 1)];
    call += 1;
    return Promise.resolve({ ok: true, text: () => Promise.resolve(""), json: () => Promise.resolve(body) } as unknown as Response);
  });
  return bodies;
}

function mountAndSend(dispatcher: ToolDispatcher) {
  const ws: Workspace = { ...emptyWorkspace(), tasks: [TASK], features: ["raid"], settingsOverrides: withPeopleAllowed(undefined, true) };
  function Source({ children }: { children: ReactNode }) {
    useAiPrivacySource("p1", () => ws, () => 0, true);
    return <>{children}</>;
  }
  render(
    <AiPrivacyProvider>
      <Source>
        <ChatPanel {...SCOPE_PROPS} lang="en-US" ai={AI} dispatcher={dispatcher} workspace={ws} projectId="p1" />
      </Source>
    </AiPrivacyProvider>,
  );
  fireEvent.change(screen.getByPlaceholderText("Ask Claude about your tasks…"), { target: { value: "turn resources on" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
}

describe("turning a hidden Resources function back on through the chat (§810)", () => {
  it("waits on the review card and is not written", async () => {
    const dispatcher = makeDispatcher(true);
    scriptFetch([reEnable, doneTurn]);
    mountAndSend(dispatcher);
    await screen.findByRole("region", CARD);
    await screen.findByText("done");
    expect(dispatcher.updateSettings).not.toHaveBeenCalled();
  });

  // The same-send guarantee, end to end: after the staged re-enable, a later turn of the same send that calls a
  // Resources tool is refused, because the saved functions did not change. Applying the call at once instead (the
  // mutant: no staging for a re-enable) would let it through.
  it("a later turn of the same send that calls a Resources tool is refused while the re-enable waits", async () => {
    const dispatcher = makeDispatcher(true);
    const listTurn = { content: [{ type: "tool_use", id: "t2", name: "list_resources", input: {} }], stop_reason: "tool_use", usage };
    const bodies = scriptFetch([reEnable, listTurn, doneTurn]);
    mountAndSend(dispatcher);
    await screen.findByRole("region", CARD);
    await screen.findByText("done");
    expect(dispatcher.updateSettings).not.toHaveBeenCalled();
    expect(dispatcher.listResources).not.toHaveBeenCalled();
    const third = bodies[2] ?? "";
    expect(third).toContain("t2");
    expect(third).toContain("Resources function is switched off");
  });

  it("CONTROL - with Resources shown the same lone call applies at once", async () => {
    const dispatcher = makeDispatcher(false);
    scriptFetch([reEnable, doneTurn]);
    mountAndSend(dispatcher);
    await screen.findByText("done");
    expect(dispatcher.updateSettings).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("region", CARD)).toBeNull();
  });
});
