import "fake-indexeddb/auto";
import "../test/ai-consent-live";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import type { ReactNode } from "react";
import { ChatPanel } from "./chat-panel";
import { AiPrivacyProvider, useAiPrivacySource } from "./ai-privacy-context";
import { withPeopleAllowed } from "./ai-people-protection";
import { newConsent } from "./ai-consent";
import { defaultAiConfig } from "./settings-types";
import { emptyWorkspace } from "./workspace";
import { PEOPLE_TOOLS, RESOURCES_TOOLS, STAKEHOLDER_TOOLS } from "./chat-tool-defs";
import type { ToolDispatcher } from "./chat-tools";

// §810 — the chat decides at SEND time, from the snapshot it sends, whether the open project shows its
// Resources function; hidden, the request carries no people tool. The project allows people throughout, so
// the only thing that withdraws them here is the hidden function.

vi.mock("./chat-threads-store", () => ({
  loadThreads: vi.fn(async () => []),
  saveThread: vi.fn(async () => undefined),
  deleteThread: vi.fn(async () => undefined),
}));

const SCOPE_PROPS = { getScopeEpoch: () => 0, isSwapInFlight: () => false };
const AI = { ...defaultAiConfig, enabled: true, consent: newConsent(new Date(0)), apiKey: "sk-test" };
const ALLOWED = { ...emptyWorkspace(), settingsOverrides: withPeopleAllowed(undefined, true) };

function makeDispatcher(enabledModules: string[]): ToolDispatcher {
  return {
    getSnapshot: vi.fn(() => ({
      today: "2026-06-04", language: "en-US", holidayCountries: [], storageKind: "memory", taskCount: 0,
      knownGroups: [], knownLabels: [], mode: "advanced" as const, enabledModules,
      currentView: "open-points" as const,
    })),
  } as unknown as ToolDispatcher;
}

function renderOpen(enabledModules: string[]) {
  function Source({ children }: { children: ReactNode }) {
    useAiPrivacySource("p1", () => ALLOWED, () => 0, true);
    return <>{children}</>;
  }
  return render(
    <AiPrivacyProvider>
      <Source>
        <ChatPanel {...SCOPE_PROPS} lang="en-US" ai={AI} dispatcher={makeDispatcher(enabledModules)} projectId="p1" getChatConversation={() => ({ history: [], display: [] })} />
      </Source>
    </AiPrivacyProvider>,
  );
}

function stubMessages(): string[] {
  const bodies: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation((_url, init?: RequestInit) => {
    bodies.push(String(init?.body ?? ""));
    return Promise.resolve(new Response(JSON.stringify({
      content: [{ type: "text", text: "Done." }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 },
    }), { status: 200 }));
  });
  return bodies;
}

async function sentToolNames(enabledModules: string[]): Promise<string[]> {
  const bodies = stubMessages();
  renderOpen(enabledModules);
  fireEvent.change(screen.getByPlaceholderText("Ask Claude about your tasks…"), { target: { value: "Who is on the team?" } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  expect(await screen.findByText("Done.")).toBeTruthy();
  expect(bodies).toHaveLength(1);
  return (JSON.parse(bodies[0]!) as { tools: { name: string }[] }).tools.map((d) => d.name);
}

afterEach(() => vi.restoreAllMocks());

describe("chat with the Resources function hidden (§810)", () => {
  const NEVER_BY_A_FUNCTION = ["search_history", "search_chats", "send_inquiry", "escalate_raid_item"];

  it("sends none of the Resources tools while the project hides Resources, and keeps the stakeholder tools", async () => {
    const names = await sentToolNames(["raid", "milestones", "stakeholders"]);
    expect(names.filter((n) => RESOURCES_TOOLS.has(n))).toEqual([]);
    expect(names).toContain("list_stakeholders");
    for (const name of NEVER_BY_A_FUNCTION) expect(names, name).toContain(name);
  });

  it("Simple mode (no functions) still sends search, chat search, the inquiry and the escalation", async () => {
    const names = await sentToolNames([]);
    for (const name of NEVER_BY_A_FUNCTION) expect(names, name).toContain(name);
    expect(names.filter((n) => RESOURCES_TOOLS.has(n) || STAKEHOLDER_TOOLS.has(n))).toEqual([]);
  });

  it("sends no stakeholder tool while the project hides Stakeholders, whatever Resources does", async () => {
    const names = await sentToolNames(["raid", "resources"]);
    expect(names.filter((n) => STAKEHOLDER_TOOLS.has(n))).toEqual([]);
    expect(names).toContain("list_resources");
  });

  it("CONTROL: sends the people tools while the project shows Resources", async () => {
    const names = await sentToolNames(["raid", "milestones", "resources"]);
    expect(names).toContain("list_resources");
    expect(names.filter((n) => PEOPLE_TOOLS.has(n)).length).toBeGreaterThan(0);
  });
});
