import "fake-indexeddb/auto";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { useState } from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ChatPanel } from "./chat-panel";
import { buildSystemPrompt, systemBlocksText } from "./chat-api";
import type { ToolDispatcher } from "./chat-tools";
import { defaultAiConfig as baseAiConfig } from "./settings-types";
import type { OperatingGuide } from "./operating-guide";
import type { FeatureModuleId } from "./feature-modules";
import { saveSealed } from "./secrets-store";
import { sealPassphrase } from "./secrets";

// The AI master switch (settings.ai.enabled) defaults OFF; these tests exercise
// an active assistant, so the shared fixture turns it on. Tests that want the
// no-key path still pass apiKey: "" on top of this.
const defaultAiConfig = { ...baseAiConfig, enabled: true };

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
// Attachment guidance (audit #47)
// ---------------------------------------------------------------------------
describe("Attachment guidance", () => {
  afterEach(() => vi.restoreAllMocks());

  function renderComposer() {
    return render(
      <ChatPanel
        lang="en-US"
        ai={AI_WITH_KEY}
        dispatcher={makeDispatcher()}
        onAcceptConsent={vi.fn()}
      />,
    );
  }

  it("shows the accepted-types + size hint up front", () => {
    renderComposer();
    expect(screen.getByText(/Attach PDF, image.*up to 20 MB/i)).toBeInTheDocument();
  });

  it("surfaces EVERY failed file when several are picked at once", async () => {
    const { container } = renderComposer();
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    const bad1 = new File(["x"], "notes.exe", { type: "application/x-msdownload" });
    const bad2 = new File(["y"], "data.bin", { type: "application/octet-stream" });
    fireEvent.change(fileInput, { target: { files: [bad1, bad2] } });
    const alert = await screen.findByRole("alert");
    // Previously only the LAST file's error survived; both must now appear.
    expect(alert.textContent).toContain("notes.exe");
    expect(alert.textContent).toContain("data.bin");
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
      // Two Stops while busy: the send-slot swap + the one in the Thinking bubble.
      expect(screen.getAllByRole("button", { name: "Stop" }).length).toBeGreaterThan(0),
    );
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();

    // Click Stop first (sets cancelledRef.current = true), then reject fetch.
    fireEvent.click(screen.getAllByRole("button", { name: "Stop" })[0]);
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
      // Two Stops while busy: the send-slot swap + the one in the Thinking bubble.
      expect(screen.getAllByRole("button", { name: "Stop" }).length).toBeGreaterThan(0),
    );

    // Click Stop first, then simulate the in-flight fetch rejecting.
    fireEvent.click(screen.getAllByRole("button", { name: "Stop" })[0]);
    rejectWithAbort();

    // "Stopped" note appears in the conversation area.
    await waitFor(() =>
      expect(screen.getByText("Stopped")).toBeInTheDocument(),
    );
    // No error alert.
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("renders a second Stop inside the Thinking bubble while busy (discoverability)", async () => {
    setupNeverResolvingFetch();
    render(
      <ChatPanel lang="en-US" ai={AI_WITH_KEY} dispatcher={makeDispatcher()} onAcceptConsent={vi.fn()} />,
    );
    const textarea = screen.getByPlaceholderText("Ask Claude about your tasks…");
    fireEvent.change(textarea, { target: { value: "list tasks" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    // Two distinct controls: the send-slot swap ("Stop") + the Thinking-bubble
    // one ("Stop generating") — distinct accessible names, no duplicate.
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Stop" })).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "Stop generating" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Stop" })).toHaveLength(1);
  });

  it("Escape interrupts the in-flight response (keyboard path)", async () => {
    const rejectWithAbort = setupNeverResolvingFetch();
    render(
      <ChatPanel lang="en-US" ai={AI_WITH_KEY} dispatcher={makeDispatcher()} onAcceptConsent={vi.fn()} />,
    );
    const textarea = screen.getByPlaceholderText("Ask Claude about your tasks…");
    fireEvent.change(textarea, { target: { value: "list tasks" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: "Stop" }).length).toBeGreaterThan(0),
    );
    // Press Escape (bubbles to the document listener), then the aborted fetch rejects.
    fireEvent.keyDown(document.body, { key: "Escape" });
    rejectWithAbort();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument(),
    );
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("Escape does NOT interrupt the chat while a modal is open (modal owns Escape)", async () => {
    const rejectWithAbort = setupNeverResolvingFetch();
    render(
      <ChatPanel lang="en-US" ai={AI_WITH_KEY} dispatcher={makeDispatcher()} onAcceptConsent={vi.fn()} />,
    );
    const ta = screen.getByPlaceholderText("Ask Claude about your tasks…");
    fireEvent.change(ta, { target: { value: "list tasks" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() =>
      expect(screen.getAllByRole("button", { name: "Stop" }).length).toBeGreaterThan(0),
    );
    // An open modal is on screen; its own Escape handler should win.
    const modal = document.createElement("div");
    modal.setAttribute("aria-modal", "true");
    document.body.appendChild(modal);
    fireEvent.keyDown(document.body, { key: "Escape" });
    // Chat call was NOT aborted: still busy (Stop present, Send absent).
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
    expect(screen.getAllByRole("button", { name: "Stop" }).length).toBeGreaterThan(0);
    // cleanup — let the in-flight fetch resolve.
    document.body.removeChild(modal);
    rejectWithAbort();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument(),
    );
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
      // Two Stops while busy: the send-slot swap + the one in the Thinking bubble.
      expect(screen.getAllByRole("button", { name: "Stop" }).length).toBeGreaterThan(0),
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

  it("marks the message list as a log so streamed replies announce", () => {
    // #28: the messages <ul> is a live region (role=log implies aria-live
    // polite; additions-only) so screen readers hear assistant replies + the
    // thinking placeholder without re-announcing on removal/clear.
    expect(src).toMatch(/role="log"/);
    expect(src).toMatch(/aria-relevant="additions"/);
  });

  it("gates Clear behind the branded confirm dialog", () => {
    // #37: clearChat must not wipe history without confirmation.
    expect(src).toMatch(/useConfirm/);
    expect(src).toMatch(/confirm\(\{ message: t\(lang, "chatClearConfirm"\) \}\)/);
    // The Clear button no longer calls clearChat directly.
    expect(src).not.toMatch(/onClick=\{clearChat\}/);
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
      // Two Stops while busy: the send-slot swap + the one in the Thinking bubble.
      expect(screen.getAllByRole("button", { name: "Stop" }).length).toBeGreaterThan(0),
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

// ---------------------------------------------------------------------------
// Document attachments (SP2 ingestion)
// ---------------------------------------------------------------------------
describe("document attachments", () => {
  afterEach(() => vi.restoreAllMocks());

  function renderWithKey() {
    return render(
      <ChatPanel
        lang="en-US"
        ai={AI_WITH_KEY}
        dispatcher={makeDispatcher()}
        onAcceptConsent={vi.fn()}
      />,
    );
  }

  function fileInputOf(container: HTMLElement) {
    return container.querySelector('input[type="file"]') as HTMLInputElement;
  }

  it("attaching a text file stages a chip and enables Send with an empty textarea", async () => {
    const { container } = renderWithKey();
    const file = new File(["risk: budget overrun"], "notes.txt", { type: "text/plain" });
    fireEvent.change(fileInputOf(container), { target: { files: [file] } });
    expect(await screen.findByText("notes.txt")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send" })).not.toBeDisabled();
  });

  it("rejects an unsupported file type with an error and stages no chip", async () => {
    const { container } = renderWithKey();
    const file = new File(["x"], "archive.zip", { type: "application/zip" });
    fireEvent.change(fileInputOf(container), { target: { files: [file] } });
    expect(await screen.findByRole("alert")).toHaveTextContent(/not a supported file type/i);
    expect(screen.queryByText("archive.zip")).toBeNull();
  });

  it("removing a staged attachment clears its chip", async () => {
    const { container } = renderWithKey();
    const file = new File(["hi"], "notes.txt", { type: "text/plain" });
    fireEvent.change(fileInputOf(container), { target: { files: [file] } });
    await screen.findByText("notes.txt");
    fireEvent.click(screen.getByRole("button", { name: "Remove notes.txt" }));
    expect(screen.queryByText("notes.txt")).toBeNull();
  });

  it("sends the attachment as a text document block, then clears the chip", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve({
        ok: true,
        text: () => Promise.resolve(""),
        json: () =>
          Promise.resolve({
            content: [{ type: "text", text: "ok" }],
            stop_reason: "end_turn",
            usage: { input_tokens: 1, output_tokens: 1 },
          }),
      } as unknown as Response),
    );
    const { container } = renderWithKey();
    const file = new File(["budget overrun risk"], "notes.txt", { type: "text/plain" });
    fireEvent.change(fileInputOf(container), { target: { files: [file] } });
    await screen.findByText("notes.txt");
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());

    type Block = { type: string; source?: { type: string; data: string } };
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    const userMsg = body.messages[body.messages.length - 1];
    expect(Array.isArray(userMsg.content)).toBe(true);
    const doc = (userMsg.content as Block[]).find((b) => b.type === "document");
    expect(doc?.source?.type).toBe("text");
    expect(doc?.source?.data).toContain("budget overrun");
    // Chip is cleared once the message is sent.
    await waitFor(() => expect(screen.queryByText("notes.txt")).toBeNull());
  });
});

describe("dangling tool_use recovery (max_tokens truncation)", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("auto-continues a max_tokens-truncated tool_use WITHOUT executing the partial tool", async () => {
    const bodies: string[] = [];
    let call = 0;
    const dispatcher = makeDispatcher();
    vi.spyOn(globalThis, "fetch").mockImplementation((_url, init?: RequestInit) => {
      bodies.push(String(init?.body ?? ""));
      call += 1;
      // Turn 1: a tool_use cut off at max_tokens (possibly partial). Turn 2: done.
      const body =
        call === 1
          ? {
              content: [{ type: "tool_use", id: "t1", name: "create_task", input: { taskName: "X" } }],
              stop_reason: "max_tokens",
              usage: { input_tokens: 1, output_tokens: 1 },
            }
          : {
              content: [{ type: "text", text: "done" }],
              stop_reason: "end_turn",
              usage: { input_tokens: 1, output_tokens: 1 },
            };
      return Promise.resolve({
        ok: true,
        text: () => Promise.resolve(""),
        json: () => Promise.resolve(body),
      } as unknown as Response);
    });

    render(
      <ChatPanel lang="en-US" ai={AI_WITH_KEY} dispatcher={dispatcher} onAcceptConsent={vi.fn()} />,
    );
    const ta = screen.getByPlaceholderText("Ask Claude about your tasks…");
    fireEvent.change(ta, { target: { value: "create all entries" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    // Resolved within the ONE send (2 calls), final text shown — no user prod.
    await waitFor(() => expect(screen.getByText("done")).toBeInTheDocument());
    expect(bodies).toHaveLength(2);
    // The partial tool was NOT executed...
    expect(dispatcher.createTask).not.toHaveBeenCalled();
    // ...but the continuation request answers it with a tool_result (valid protocol).
    const sent = JSON.parse(bodies[1]) as { messages: { role: string; content: unknown }[] };
    const tuIdx = sent.messages.findIndex(
      (m) => Array.isArray(m.content) && (m.content as { type: string }[]).some((b) => b.type === "tool_use"),
    );
    const after = sent.messages[tuIdx + 1];
    expect(after.role).toBe("user");
    expect(
      (after.content as { type: string; tool_use_id?: string }[]).some(
        (b) => b.type === "tool_result" && b.tool_use_id === "t1",
      ),
    ).toBe(true);
  });

  it("auto-continues a truncated TEXT answer without a prod (both halves shown, nudge hidden)", async () => {
    const bodies: string[] = [];
    let call = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation((_url, init?: RequestInit) => {
      bodies.push(String(init?.body ?? ""));
      call += 1;
      const body =
        call === 1
          ? { content: [{ type: "text", text: "First half" }], stop_reason: "max_tokens", usage: { input_tokens: 1, output_tokens: 1 } }
          : { content: [{ type: "text", text: "second half." }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } };
      return Promise.resolve({
        ok: true,
        text: () => Promise.resolve(""),
        json: () => Promise.resolve(body),
      } as unknown as Response);
    });

    render(
      <ChatPanel lang="en-US" ai={AI_WITH_KEY} dispatcher={makeDispatcher()} onAcceptConsent={vi.fn()} />,
    );
    const ta = screen.getByPlaceholderText("Ask Claude about your tasks…");
    fireEvent.change(ta, { target: { value: "write a lot" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(screen.getByText("second half.")).toBeInTheDocument());
    expect(screen.getByText("First half")).toBeInTheDocument();
    expect(bodies).toHaveLength(2);
    // The continuation carried the invisible nudge — sent to the API, not shown.
    expect(bodies[1]).toContain("cut off at the length limit");
    expect(screen.queryByText(/cut off at the length limit/)).toBeNull();
  });
});
