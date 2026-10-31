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
import { emptyWorkspace, type Workspace } from "./workspace";
import { t } from "./i18n";
import type { ToolDispatcher } from "./chat-tools";
import type { ChatConversation } from "./workspace-tab-context";

// AI people protection, Task 4: an image (or a document whose text cannot be extracted) cannot be
// redacted, so with protection on the transport refuses the request before sending it. The chat says
// why, and that the image in the conversation is what blocks it: an earlier one blocks every later send.

vi.mock("./chat-threads-store", () => ({
  loadThreads: vi.fn(async () => []),
  saveThread: vi.fn(async () => undefined),
  deleteThread: vi.fn(async () => undefined),
}));

const SCOPE_PROPS = { getScopeEpoch: () => 0, isSwapInFlight: () => false };
const AI = { ...defaultAiConfig, enabled: true, consent: newConsent(new Date(0)), apiKey: "sk-test" };

function makeDispatcher(): ToolDispatcher {
  return {
    getSnapshot: vi.fn(() => ({
      today: "2026-06-04", language: "en-US", holidayCountries: [], storageKind: "memory", taskCount: 0,
      knownGroups: [], knownLabels: [], mode: "advanced" as const, enabledModules: [] as string[],
      currentView: "open-points" as const,
    })),
  } as unknown as ToolDispatcher;
}

// An image sent earlier in this conversation.
const withImage: ChatConversation = {
  history: [
    { role: "user", content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw0KGgo=" } }] },
    { role: "assistant", content: [{ type: "text", text: "I see a chart." }] },
  ],
  display: [
    { kind: "user", text: "chart.png" },
    { kind: "assistant", text: "I see a chart." },
  ],
};

function renderOpen(ws: Workspace) {
  function Source({ children }: { children: ReactNode }) {
    useAiPrivacySource("p1", () => ws, () => 0);
    return <>{children}</>;
  }
  render(
    <AiPrivacyProvider>
      <Source>
        <ChatPanel {...SCOPE_PROPS} lang="en-US" ai={AI} dispatcher={makeDispatcher()} projectId="p1" getChatConversation={() => withImage} />
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

function send(text: string) {
  fireEvent.change(screen.getByPlaceholderText("Ask Claude about your tasks…"), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
}

afterEach(() => vi.restoreAllMocks());

describe("chat with people protection and an image in the conversation", () => {
  it("sends nothing and says the image blocks it", async () => {
    const bodies = stubMessages();
    renderOpen(emptyWorkspace()); // no override: protected by default
    send("What does the chart say?");
    expect(await screen.findByText(t("en-US", "chatPeopleProtectedContent"))).toBeTruthy();
    expect(bodies).toEqual([]);
  });

  // The positive control: the same conversation goes out when the project allows people, so the message
  // above is the protection's refusal and not a failure of the fixture.
  it("sends as before when the project allows people", async () => {
    const bodies = stubMessages();
    renderOpen({ ...emptyWorkspace(), settingsOverrides: withPeopleAllowed(undefined, true) });
    send("What does the chart say?");
    expect(await screen.findByText("Done.")).toBeTruthy();
    expect(bodies).toHaveLength(1);
    expect(screen.queryByText(t("en-US", "chatPeopleProtectedContent"))).toBeNull();
  });
});
