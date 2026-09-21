// ★ Wiring guard: ChatPanel → ChatPanelInner → ToolBlock must hand on
//   `exportFooter`, which a chat document card's download prints. The prop is
//   optional at every layer, so a dropped hop would bring the built-in footer
//   back with tsc and every other test green. ToolBlock is stubbed to record its
//   props; the conversation is seeded with one tool turn so it renders.
import "fake-indexeddb/auto";
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const seen = vi.hoisted(() => ({ props: [] as Record<string, unknown>[] }));
vi.mock("./chat-tool-block", () => ({
  ToolBlock: (p: Record<string, unknown>) => {
    seen.props.push(p);
    return null;
  },
}));
vi.mock("./chat-threads-store", () => ({
  loadThreads: vi.fn(async () => []),
  saveThread: vi.fn(async () => undefined),
}));

import { ChatPanel } from "./chat-panel";
import { defaultAiConfig } from "./settings-types";
import type { ToolDispatcher } from "./chat-tools";
import type { ChatConversation } from "./workspace-tab-context";

const TOOL_TURN: ChatConversation = {
  history: [],
  display: [
    { kind: "tool", name: "create_document", input: {}, result: JSON.stringify({ id: 4, title: "Deck", blockCount: 1 }), error: false },
  ],
};

function renderPanel(exportFooter: string | undefined) {
  seen.props.length = 0;
  render(
    <ChatPanel
      lang="en-US"
      ai={{ ...defaultAiConfig, enabled: true, consentAccepted: true, apiKey: "sk-test" }}
      dispatcher={{} as unknown as ToolDispatcher}
      onAcceptConsent={vi.fn()}
      projectId="p1"
      getChatConversation={() => TOOL_TURN}
      saveChatConversation={vi.fn()}
      getScopeEpoch={() => 0}
      isSwapInFlight={() => false}
      exportFooter={exportFooter}
    />,
  );
}

describe("ChatPanel hands the export footer to each tool block", () => {
  it("passes the footer it was given", () => {
    renderPanel("Acme GmbH");
    expect(seen.props.length).toBeGreaterThan(0);
    expect(seen.props.at(-1)!.exportFooter).toBe("Acme GmbH");
  });

  it("passes nothing when it was given nothing — the control for the case above", () => {
    renderPanel(undefined);
    expect(seen.props.length).toBeGreaterThan(0);
    expect(seen.props.at(-1)!.exportFooter).toBeUndefined();
  });
});
