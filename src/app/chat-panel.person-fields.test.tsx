import "fake-indexeddb/auto";
import "../test/ai-consent-live";
import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import type { ReactNode } from "react";
import { ChatPanel } from "./chat-panel";
import { AiPrivacyProvider, useAiPrivacySource } from "./ai-privacy-context";
import { withPeopleAllowed } from "./ai-people-protection";
import { PERSON_FIELDS_REMOVED_NOTE } from "./ai-person-fields";
import { newConsent } from "./ai-consent";
import { defaultAiConfig } from "./settings-types";
import { emptyWorkspace, type Workspace } from "./workspace";
import type { ToolDispatcher } from "./chat-tools";

// AI people protection, Task 6 (R4): a staged turn's person fields are stripped BEFORE the review card is
// built, so the card shows what Apply will write, and the model is told which fields were dropped.

vi.mock("./chat-threads-store", () => ({
  loadThreads: vi.fn(async () => []),
  saveThread: vi.fn(async () => undefined),
  deleteThread: vi.fn(async () => undefined),
}));

const SCOPE_PROPS = { getScopeEpoch: () => 0, isSwapInFlight: () => false };
const AI = { ...defaultAiConfig, enabled: true, consent: newConsent(new Date(0)), apiKey: "sk-test" };
const CARD = { name: "Proposed changes" } as const;
const usage = { input_tokens: 1, output_tokens: 1 };

function makeDispatcher(): ToolDispatcher {
  return {
    getSnapshot: vi.fn(() => ({
      today: "2026-06-04", language: "en-US", holidayCountries: [], storageKind: "memory", taskCount: 0,
      knownGroups: [], knownLabels: [], mode: "advanced" as const, enabledModules: [] as string[],
      currentView: "open-points" as const,
    })),
  } as unknown as ToolDispatcher;
}

function renderOpen(ws: Workspace) {
  function Source({ children }: { children: ReactNode }) {
    useAiPrivacySource("p1", () => ws);
    return <>{children}</>;
  }
  render(
    <AiPrivacyProvider>
      <Source>
        <ChatPanel {...SCOPE_PROPS} lang="en-US" ai={AI} dispatcher={makeDispatcher()} projectId="p1" workspace={ws} />
      </Source>
    </AiPrivacyProvider>,
  );
}

/** Two creates in one turn: more than one write, so the turn is staged on a card. */
function scriptTwoCreates(): string[] {
  const turns = [
    {
      content: [
        { type: "tool_use", id: "t1", name: "create_task", input: { taskName: "Write spec", assignee: "Zelda Quartz", dueDate: "2026-06-10" } },
        { type: "tool_use", id: "t2", name: "create_task", input: { taskName: "Review spec", dueDate: "2026-06-11" } },
      ],
      stop_reason: "tool_use", usage,
    },
    { content: [{ type: "text", text: "Staged." }], stop_reason: "end_turn", usage },
  ];
  const bodies: string[] = [];
  let call = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation((_url, init?: RequestInit) => {
    bodies.push(String(init?.body ?? ""));
    const body = turns[Math.min(call, turns.length - 1)];
    call += 1;
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  });
  return bodies;
}

function send(text: string) {
  fireEvent.change(screen.getByPlaceholderText("Ask Claude about your tasks…"), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
}

/** The tool_result blocks of the request that answered the staged turn. */
function stagedResults(body: string): { tool_use_id: string; content: string }[] {
  const sent = JSON.parse(body) as { messages: { content: unknown }[] };
  const last = sent.messages[sent.messages.length - 1]!;
  return (last.content as { type: string; tool_use_id: string; content: string }[]).filter((b) => b.type === "tool_result");
}

afterEach(() => vi.restoreAllMocks());

describe("a staged turn under people protection", () => {
  it("shows the create without its assignee and tells the model the assignee was dropped", async () => {
    const bodies = scriptTwoCreates();
    renderOpen(emptyWorkspace()); // no override: protected by default
    send("Plan the spec work");
    const card = await screen.findByRole("region", CARD);
    expect(within(card).getAllByText(/Write spec/).length).toBeGreaterThan(0);
    expect(within(card).queryByText(/Zelda Quartz/)).toBeNull();
    await waitFor(() => expect(bodies).toHaveLength(2));
    const results = stagedResults(bodies[1]!);
    expect(results.find((r) => r.tool_use_id === "t1")!.content).toContain(PERSON_FIELDS_REMOVED_NOTE(["assignee"]));
    // A call that carried no person field gets no note.
    expect(results.find((r) => r.tool_use_id === "t2")!.content).not.toContain("protects its people");
  });

  // The positive control: allowed, the card shows the assignee the model chose and no note is sent.
  it("shows the assignee when the project allows people", async () => {
    const bodies = scriptTwoCreates();
    renderOpen({ ...emptyWorkspace(), settingsOverrides: withPeopleAllowed(undefined, true) });
    send("Plan the spec work");
    const card = await screen.findByRole("region", CARD);
    expect(within(card).getAllByText(/Zelda Quartz/).length).toBeGreaterThan(0);
    await waitFor(() => expect(bodies).toHaveLength(2));
    expect(stagedResults(bodies[1]!).some((r) => r.content.includes("protects its people"))).toBe(false);
  });
});
