import "fake-indexeddb/auto";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { useState } from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ChatPanel, buildSystemPrompt, systemBlocksText } from "./chat-panel";
import type { ToolDispatcher } from "./chat-tools";
import { defaultAiConfig } from "./settings-types";
import type { OperatingGuide } from "./operating-guide";
import type { FeatureModuleId } from "./feature-modules";
import { saveSealed } from "./secrets-store";
import { sealPassphrase } from "./secrets";

const src = readFileSync(
  join(process.cwd(), "src", "app", "chat-panel.tsx"),
  "utf8",
);

function makeDispatcher(): ToolDispatcher {
  return {
    listTasks: vi.fn(() => []),
    getTask: vi.fn(() => null),
    createTask: vi.fn(),
    updateTask: vi.fn(() => null),
    deleteTask: vi.fn(() => false),
    deleteAllTasks: vi.fn(() => 0),
    sendInquiry: vi.fn(() => ({ sent: false })),
    setFilters: vi.fn(),
    setLanguage: vi.fn(),
    getSnapshot: vi.fn(() => ({
      today: "2026-06-04",
      language: "en-US",
      holidayCountries: [],
      storageKind: "memory",
      taskCount: 0,
      knownGroups: [],
      knownLabels: [],
      mode: "advanced" as const,
      enabledModules: [] as string[],
      currentView: "open-points" as const,
    })),
  } as unknown as ToolDispatcher;
}

// ---------------------------------------------------------------------------
// Shared AI config for tests that need a real API key
// ---------------------------------------------------------------------------
const AI_WITH_KEY = {
  ...defaultAiConfig,
  consentAccepted: true,
  apiKey: "sk-test",
};

describe("Consent screen accept", () => {
  it("clicking I understand after ticking the policy fires onAcceptConsent", () => {
    const onAcceptConsent = vi.fn();
    render(
      <ChatPanel
        lang="en-US"
        ai={{ ...defaultAiConfig, consentAccepted: false }}
        dispatcher={makeDispatcher()}
        onAcceptConsent={onAcceptConsent}
      />,
    );
    const button = screen.getByRole("button", { name: /I understand/i });
    expect(button).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(button).not.toBeDisabled();
    fireEvent.click(button);
    expect(onAcceptConsent).toHaveBeenCalledTimes(1);
  });

  it("clears the consent screen once onAcceptConsent flips the SAME ai instance", () => {
    // Regression for the cross-instance bug: the consent handler must write to
    // the settings instance ChatPanel actually reads. Here onAcceptConsent
    // updates the very `ai` passed to ChatPanel, and the consent screen must go.
    function Harness() {
      const [ai, setAi] = useState({ ...defaultAiConfig, consentAccepted: false });
      return (
        <ChatPanel
          lang="en-US"
          ai={ai}
          dispatcher={makeDispatcher()}
          onAcceptConsent={() => setAi((a) => ({ ...a, consentAccepted: true }))}
        />
      );
    }
    render(<Harness />);
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: /I understand/i }));
    // Consent screen gone → the chat composer is shown.
    expect(screen.queryByRole("button", { name: /I understand/i })).toBeNull();
    expect(screen.getByPlaceholderText("Ask Claude about your tasks…")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Stop-button tests
// ---------------------------------------------------------------------------
describe("Stop button", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function setupNeverResolvingFetch() {
    // Returns a fetch mock that stays pending until rejectWithAbort() is called.
    // The caller clicks Stop first (setting cancelledRef + calling controller.abort),
    // then calls rejectWithAbort() to simulate the in-flight fetch rejecting.
    let rejectFetch!: (reason: unknown) => void;
    const pending = new Promise<Response>((_res, rej) => {
      rejectFetch = rej;
    });
    vi.spyOn(globalThis, "fetch").mockReturnValue(pending);
    const abortError = Object.assign(new Error("Aborted"), { name: "AbortError" });
    return () => rejectFetch(abortError);
  }

  it("shows Stop while busy and re-enables Send after Stop is clicked", async () => {
    const rejectWithAbort = setupNeverResolvingFetch();

    render(
      <ChatPanel
        lang="en-US"
        ai={AI_WITH_KEY}
        dispatcher={makeDispatcher()}
        onAcceptConsent={vi.fn()}
      />,
    );

    // Type something and send.
    const textarea = screen.getByPlaceholderText("Ask Claude about your tasks…");
    fireEvent.change(textarea, { target: { value: "list tasks" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    // While busy: Stop button must be present, Send must be gone.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument(),
    );
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();

    // Click Stop first (sets cancelledRef.current = true), then reject fetch.
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    rejectWithAbort();

    // After abort resolves: Send is back, no error alert shown.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument(),
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows 'Stopped' note in chat after Stop, not an error", async () => {
    const rejectWithAbort = setupNeverResolvingFetch();

    render(
      <ChatPanel
        lang="en-US"
        ai={AI_WITH_KEY}
        dispatcher={makeDispatcher()}
        onAcceptConsent={vi.fn()}
      />,
    );

    const textarea = screen.getByPlaceholderText("Ask Claude about your tasks…");
    fireEvent.change(textarea, { target: { value: "list tasks" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument(),
    );

    // Click Stop first, then simulate the in-flight fetch rejecting.
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    rejectWithAbort();

    // "Stopped" note appears in the conversation area.
    await waitFor(() =>
      expect(screen.getByText("Stopped")).toBeInTheDocument(),
    );
    // No error alert.
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("suggested prompt chips", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  function renderEmpty() {
    render(
      <ChatPanel
        lang="en-US"
        ai={AI_WITH_KEY}
        dispatcher={makeDispatcher()}
        onAcceptConsent={vi.fn()}
      />,
    );
  }

  it("renders the suggested-prompt chip list when the conversation is empty", () => {
    renderEmpty();
    // The <ul aria-label="Suggested prompts"> is the landmark for the chips.
    expect(screen.getByRole("list", { name: "Suggested prompts" })).toBeInTheDocument();
  });

  it("renders a 'Give me an update' chip", () => {
    renderEmpty();
    expect(
      screen.getByRole("button", { name: "Give me an update" }),
    ).toBeInTheDocument();
  });

  it("renders all four chips", () => {
    renderEmpty();
    expect(screen.getByRole("button", { name: "Give me an update" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Show overdue tasks" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "What's at risk?" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Draft a status update for stakeholders" })).toBeInTheDocument();
  });

  it("clicking 'Give me an update' fills the textarea with the directive prompt body", () => {
    renderEmpty();
    fireEvent.click(screen.getByRole("button", { name: "Give me an update" }));
    const textarea = screen.getByPlaceholderText("Ask Claude about your tasks…") as HTMLTextAreaElement;
    expect(textarea.value).toMatch(/list_tasks/);
    expect(textarea.value).toMatch(/list_raid/);
    expect(textarea.value).toMatch(/list_changes/);
    expect(textarea.value).toMatch(/list_milestones/);
  });

  it("clicking 'Show overdue tasks' fills the textarea with that text", () => {
    renderEmpty();
    fireEvent.click(screen.getByRole("button", { name: "Show overdue tasks" }));
    const textarea = screen.getByPlaceholderText("Ask Claude about your tasks…") as HTMLTextAreaElement;
    expect(textarea.value).toBe("Show overdue tasks");
  });

  it("chips are hidden after the first message is sent (while busy)", async () => {
    let rejectFetch!: (reason: unknown) => void;
    const pending = new Promise<Response>((_res, rej) => { rejectFetch = rej; });
    vi.spyOn(globalThis, "fetch").mockReturnValue(pending);

    renderEmpty();
    const textarea = screen.getByPlaceholderText("Ask Claude about your tasks…");
    fireEvent.change(textarea, { target: { value: "hello" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument(),
    );
    expect(screen.queryByRole("list", { name: "Suggested prompts" })).toBeNull();

    // clean up
    const abortError = Object.assign(new Error("Aborted"), { name: "AbortError" });
    rejectFetch(abortError);
  });
});

describe("SP1 seed + foundational chips", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function jsonResponse() {
    return Promise.resolve({
      ok: true,
      text: () => Promise.resolve(""),
      json: () =>
        Promise.resolve({
          content: [{ type: "text", text: "ok" }],
          stop_reason: "end_turn",
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
    } as unknown as Response);
  }

  it("seeds the input without sending when autoSend is false", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(jsonResponse);
    const onChatSeedConsumed = vi.fn();
    render(
      <ChatPanel
        lang="en-US"
        ai={AI_WITH_KEY}
        dispatcher={makeDispatcher()}
        onAcceptConsent={vi.fn()}
        chatSeed={{ prompt: "Summarize risks", autoSend: false }}
        onChatSeedConsumed={onChatSeedConsumed}
      />,
    );
    const textarea = screen.getByPlaceholderText(
      "Ask Claude about your tasks…",
    ) as HTMLTextAreaElement;
    expect(textarea.value).toBe("Summarize risks");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(onChatSeedConsumed).toHaveBeenCalledTimes(1);
  });

  it("auto-sends the seed when autoSend is true and the key is present", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(jsonResponse);
    const onChatSeedConsumed = vi.fn();
    render(
      <ChatPanel
        lang="en-US"
        ai={AI_WITH_KEY}
        dispatcher={makeDispatcher()}
        onAcceptConsent={vi.fn()}
        chatSeed={{ prompt: "What's next?", autoSend: true }}
        onChatSeedConsumed={onChatSeedConsumed}
      />,
    );
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    expect(onChatSeedConsumed).toHaveBeenCalledTimes(1);
  });

  it("does not auto-send when the api key is missing (seeds input only)", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(jsonResponse);
    const onChatSeedConsumed = vi.fn();
    render(
      <ChatPanel
        lang="en-US"
        ai={{ ...defaultAiConfig, consentAccepted: true, apiKey: "" }}
        dispatcher={makeDispatcher()}
        onAcceptConsent={vi.fn()}
        chatSeed={{ prompt: "What's next?", autoSend: true }}
        onChatSeedConsumed={onChatSeedConsumed}
      />,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(onChatSeedConsumed).toHaveBeenCalledTimes(1);
  });

  it("does not auto-send when guides are pending (seeds input only)", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(jsonResponse);
    const onChatSeedConsumed = vi.fn();
    render(
      <ChatPanel
        lang="en-US"
        ai={{ ...defaultAiConfig, consentAccepted: true, apiKey: "sk-test", groundInGuides: true }}
        dispatcher={makeDispatcher()}
        onAcceptConsent={vi.fn()}
        guidesReady={false}
        chatSeed={{ prompt: "What's next?", autoSend: true }}
        onChatSeedConsumed={onChatSeedConsumed}
      />,
    );
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(onChatSeedConsumed).toHaveBeenCalledTimes(1);
  });

  it("clicking a foundational chip auto-sends", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(jsonResponse);
    render(
      <ChatPanel
        lang="en-US"
        ai={AI_WITH_KEY}
        dispatcher={makeDispatcher()}
        onAcceptConsent={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "What's next?" }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
  });

  it("clicking an existing chip only fills (no send)", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(jsonResponse);
    render(
      <ChatPanel
        lang="en-US"
        ai={AI_WITH_KEY}
        dispatcher={makeDispatcher()}
        onAcceptConsent={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Give me an update" }));
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("chat panel layout", () => {
  it("chat root is the centered half-size resizable card, not the plain fill card", () => {
    expect(src).toMatch(/CHAT_PANE_CLASS/);
    expect(src).not.toMatch(/className=\{VIEW_PANE_FILL_CLASS\}/);
  });

  it("renders the reset-size button before the textarea in the input row", () => {
    render(
      <ChatPanel
        lang="en-US"
        ai={{ ...defaultAiConfig, consentAccepted: true, apiKey: "sk-test" }}
        dispatcher={makeDispatcher()}
        onAcceptConsent={vi.fn()}
      />,
    );

    const textarea = screen.getByPlaceholderText("Ask Claude about your tasks…");
    const reset = screen.getByRole("button", {
      name: "Reset back to the default size.",
    });

    // DOCUMENT_POSITION_FOLLOWING set => textarea follows reset => reset is first.
    expect(
      reset.compareDocumentPosition(textarea) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// buildSystemPrompt — app-context + operating-guide block
// ---------------------------------------------------------------------------
const snap = {
  today: "2026-06-16",
  language: "en-US" as const,
  holidayCountries: [] as string[],
  storageKind: "browser",
  taskCount: 0,
  knownGroups: [] as string[],
  knownLabels: [] as string[],
  mode: "advanced" as const,
  enabledModules: ["raid", "milestones"] as FeatureModuleId[],
  currentView: "milestones" as const,
};

const guide: OperatingGuide = {
  id: "g",
  name: "Lead",
  content: "Be decisive.",
  enabled: true,
  priority: 1,
  scope: {},
  builtIn: true,
};

describe("buildSystemPrompt app-context + guides", () => {
  it("includes an APP CONTEXT block with mode/modules/view", () => {
    const s = systemBlocksText(buildSystemPrompt("en-US", snap, [], true));
    expect(s).toContain("APP CONTEXT");
    expect(s).toContain("Mode: advanced");
    expect(s).toContain("Current view: milestones");
    expect(s).toContain("senior project");
  });

  it("includes in-scope guides when grounding is ON", () => {
    const s = systemBlocksText(buildSystemPrompt("en-US", snap, [guide], true));
    expect(s).toContain("Be decisive.");
    expect(s).toContain("priority order");
  });

  it("omits the guide block when grounding is OFF", () => {
    const s = systemBlocksText(buildSystemPrompt("en-US", snap, [guide], false));
    expect(s).not.toContain("Be decisive.");
  });

  it("omits the guide block when no guide is in scope", () => {
    const off: OperatingGuide = { ...guide, scope: { views: ["budget" as const] } };
    const s = systemBlocksText(buildSystemPrompt("en-US", snap, [off], true));
    expect(s).not.toContain("Be decisive.");
  });

  it("caches the stable prefix (incl. guide) and leaves volatile state uncached", () => {
    const blocks = buildSystemPrompt("en-US", snap, [guide], true);
    // Block 0 = cached stable prefix, contains the guide text.
    expect(blocks[0].cache_control?.type).toBe("ephemeral");
    expect(blocks[0].text).toContain("Be decisive.");
    // Block 1 = uncached volatile suffix, contains the APP CONTEXT + state.
    expect(blocks[1].cache_control).toBeUndefined();
    expect(blocks[1].text).toContain("APP CONTEXT");
    expect(blocks[1].text).toContain("Current view: milestones");
  });
});

// ---------------------------------------------------------------------------
// Prompt caching — system sent as cache-controlled content block
// ---------------------------------------------------------------------------
describe("prompt caching", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends system as a cache-controlled content block", async () => {
    let rejectFetch!: (reason: unknown) => void;
    const pending = new Promise<Response>((_res, rej) => { rejectFetch = rej; });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockReturnValue(pending);

    render(
      <ChatPanel
        lang="en-US"
        ai={AI_WITH_KEY}
        dispatcher={makeDispatcher()}
        onAcceptConsent={vi.fn()}
      />,
    );

    const textarea = screen.getByPlaceholderText("Ask Claude about your tasks…");
    fireEvent.change(textarea, { target: { value: "hello" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument(),
    );

    // Capture the fetch call body before aborting.
    expect(fetchSpy.mock.calls.length).toBeGreaterThan(0);
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect(Array.isArray(body.system)).toBe(true);
    expect(body.system[0].cache_control.type).toBe("ephemeral");
    expect(body.system[1].cache_control).toBeUndefined();

    // Clean up pending fetch.
    const abortError = Object.assign(new Error("Aborted"), { name: "AbortError" });
    rejectFetch(abortError);
  });
});

// ---------------------------------------------------------------------------
// guidesReady gate
// ---------------------------------------------------------------------------
describe("guidesReady gate", () => {
  it("disables send and shows loading placeholder when grounding is on but guides are not ready", () => {
    render(
      <ChatPanel
        lang="en-US"
        ai={{ ...defaultAiConfig, consentAccepted: true, apiKey: "sk-test", groundInGuides: true }}
        dispatcher={{
          listTasks: vi.fn(() => []),
          getTask: vi.fn(() => null),
          createTask: vi.fn(),
          updateTask: vi.fn(() => null),
          deleteTask: vi.fn(() => false),
          deleteAllTasks: vi.fn(() => 0),
          listRaid: vi.fn(() => []),
          listChanges: vi.fn(() => []),
          listMilestones: vi.fn(() => []),
          listStakeholders: vi.fn(() => []),
          listDocuments: vi.fn(() => []),
          getSnapshot: vi.fn(() => null),
        } as unknown as Parameters<typeof ChatPanel>[0]["dispatcher"]}
        onAcceptConsent={vi.fn()}
        guidesReady={false}
      />,
    );
    expect(screen.getByPlaceholderText("Loading operating guides…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// Unlock prompt when the Anthropic key is passphrase-locked
// ---------------------------------------------------------------------------
describe("passphrase-locked API key unlock prompt", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  function renderLocked() {
    render(
      <ChatPanel
        lang="en-US"
        ai={{ ...defaultAiConfig, consentAccepted: true, apiKey: "" }}
        dispatcher={makeDispatcher()}
        onAcceptConsent={vi.fn()}
      />,
    );
  }

  it("shows an Unlock prompt (not the no-API-key text) when the key is passphrase-locked", async () => {
    await saveSealed(await sealPassphrase("anthropicApiKey", "sk-real", "pw"));
    renderLocked();
    expect(
      await screen.findByRole("button", { name: /^unlock$/i }),
    ).toBeInTheDocument();
  });

  it("unlocks the key and reveals the chat input on the correct passphrase", async () => {
    await saveSealed(await sealPassphrase("anthropicApiKey", "sk-real", "pw"));
    renderLocked();
    fireEvent.change(screen.getByLabelText(/^passphrase$/i), {
      target: { value: "pw" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^unlock$/i }));
    // After a successful unlock the Unlock prompt is gone and the chat textarea
    // (the one with the chatPlaceholder) becomes enabled.
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: /^unlock$/i }),
      ).toBeNull(),
    );
    expect(
      screen.getByPlaceholderText("Ask Claude about your tasks…"),
    ).not.toBeDisabled();
  });

  it("shows an error on the wrong passphrase", async () => {
    await saveSealed(await sealPassphrase("anthropicApiKey", "sk-real", "pw"));
    renderLocked();
    fireEvent.change(screen.getByLabelText(/^passphrase$/i), {
      target: { value: "wrong" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^unlock$/i }));
    await waitFor(() =>
      expect(screen.getByText("Wrong passphrase.")).toBeInTheDocument(),
    );
    // Still locked: Unlock prompt remains.
    expect(screen.getByRole("button", { name: /^unlock$/i })).toBeInTheDocument();
  });
});
