import "fake-indexeddb/auto";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { useState } from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ChatPanel } from "./chat-panel";
import { loadThreads, saveThread } from "./chat-threads-store";
import type { ChatThread } from "./chat-threads";
import { t } from "./i18n";
import { buildSystemPrompt, systemBlocksText } from "./chat-api";
import type { ToolDispatcher } from "./chat-tools";
import { defaultAiConfig as baseAiConfig } from "./settings-types";
import type { OperatingGuide } from "./operating-guide";
import type { FeatureModuleId } from "./feature-modules";
import { saveSealed } from "./secrets-store";
import { sealPassphrase } from "./secrets";

// Force the dictation mic to be "supported" so useDictationMic renders the
// button (mirrors note-log-panel.test.tsx / task-form-fields.dictation.test.tsx
// — jsdom has no SpeechRecognition ctor, so getCtor() is null and the button
// is normally suppressed).
vi.mock("./chat-threads-store", () => ({
  loadThreads: vi.fn(async () => []),
  saveThread: vi.fn(async () => undefined),
  deleteThread: vi.fn(async () => undefined),
}));

vi.mock("./use-push-to-talk", () => ({
  usePushToTalk: () => ({
    listening: false,
    transcribing: false,
    supported: true,
    buttonHandlers: {},
    toggle: () => {},
    press: vi.fn(),
    release: vi.fn(),
  }),
}));

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

  // ★★ THE CHIP SET IS RENDERED-SURFACE STATE AND THIS IS THE ONLY THING THAT
  // PINS IT. 0.216.0 replaced four legacy chips ("Give me an update", "Show
  // overdue tasks", "What's at risk?", "Draft a status update for
  // stakeholders") plus the spread-in FOUNDATIONAL_PROMPTS with the four
  // CHAT_STARTER_PROMPTS. Dropping `...CHAT_STARTER_PROMPTS` from PROMPT_CHIPS
  // would remove them from the product while every module-level test still
  // passed — the same hole the attachment-chip test below was written for.
  it("renders exactly the five starter chips, starters first and attachment last", () => {
    renderEmpty();
    const list = screen.getByRole("list", { name: "Suggested prompts" });
    const names = Array.from(list.querySelectorAll("button")).map((b) => b.textContent?.trim());
    expect(names).toEqual([
      "Risk review",
      "Weekly status",
      "Stakeholder update",
      "Prioritize tasks",
      "Process attachment",
    ]);
  });

  // ★ The send-vs-fill behaviour is pinned by "clicking a starter chip
  // auto-sends" in the describe below — it owns the `jsonResponse` fetch stub.

  it("chips stay available after the first message is sent (while busy)", async () => {
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
    // The chip strip is now a persistent element below the output scroller,
    // so it stays visible for the whole session rather than disappearing
    // once the transcript is non-empty.
    expect(screen.queryByRole("list", { name: "Suggested prompts" })).not.toBeNull();

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

  // ★★ Names a CHAT_STARTER_PROMPTS chip, not a foundational one. The chat strip
  // stopped spreading FOUNDATIONAL_PROMPTS in 0.216.0 — those now live only in
  // the header Ask-Claude menu — so "What's next?" is no longer a chip here and
  // this test failed until it was repointed. That failure was the intended
  // signal, not a break: it is the only thing that pins the chip strip's
  // contents to a rendered surface (see the sibling attachment test's comment).
  it("clicking a starter chip auto-sends", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(jsonResponse);
    render(
      <ChatPanel
        lang="en-US"
        ai={AI_WITH_KEY}
        dispatcher={makeDispatcher()}
        onAcceptConsent={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Weekly status" }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    // ★★ SEND, not FILL. The legacy chips filled the textarea and left it
    // holding the prompt (autoSend: false); every chip now sends. Without this
    // second assertion the test passes against a chip that merely fills, which
    // is the exact regression the removal of the legacy set could reintroduce.
    const textarea = screen.getByPlaceholderText("Ask Claude about your tasks…") as HTMLTextAreaElement;
    expect(textarea.value).toBe("");
  });

  // The attachment prompt was moved OUT of FOUNDATIONAL_PROMPTS (the header
  // Ask-Claude menu has no attach affordance) into CHAT_ONLY_PROMPTS, which
  // only chat spreads. Nothing rendered pinned that second half: dropping
  // `...CHAT_ONLY_PROMPTS` from the chip list deletes the prompt from the whole
  // product while every module-level test still passes.
  it("still offers the chat-only attachment chip, and it auto-sends", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(jsonResponse);
    render(
      <ChatPanel
        lang="en-US"
        ai={AI_WITH_KEY}
        dispatcher={makeDispatcher()}
        onAcceptConsent={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "aiPromptProcessAttachmentLabel") }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
  });

  // ★ REMOVED in 0.216.0: "clicking an existing chip only fills (no send)".
  // It clicked "Give me an update", one of the four legacy autoSend:false
  // chips. No chip fills any more — every entry in PROMPT_CHIPS auto-sends —
  // so the test had no subject left. Deleted rather than repointed: repointing
  // it at a current chip would have asserted the OPPOSITE of the behaviour its
  // name describes.
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

// ---------------------------------------------------------------------------
// Attach / dictate button sizing (UX toolbar polish batch, Task 20)
// ---------------------------------------------------------------------------
describe("attach and dictate button sizing", () => {
  afterEach(() => vi.restoreAllMocks());

  function renderPanel() {
    return render(
      <ChatPanel
        lang="en-US"
        ai={AI_WITH_KEY}
        dispatcher={makeDispatcher()}
        onAcceptConsent={vi.fn()}
      />,
    );
  }

  it("gives the attach and dictate buttons the same centred-icon shell", () => {
    renderPanel();
    const attach = screen.getByRole("button", { name: t("en-US", "chatAttach") });
    expect(attach.className).toContain("justify-center");
    const mic = screen.getByRole("button", { name: new RegExp(t("en-US", "dictationHold")) });
    expect(mic.className).toContain("justify-center");
    expect(mic.className).toContain("px-4");
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
          ? { content: [{ type: "text", text: "First half " }], stop_reason: "max_tokens", usage: { input_tokens: 1, output_tokens: 1 } }
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

    // Continuation is STITCHED into one bubble (no split mid code-fence/table).
    await waitFor(() => expect(screen.getByText("First half second half.")).toBeInTheDocument());
    expect(bodies).toHaveLength(2);
    // The continuation carried the invisible nudge — sent to the API, not shown.
    expect(bodies[1]).toContain("cut off at the length limit");
    expect(screen.queryByText(/cut off at the length limit/)).toBeNull();
  });

  it("surfaces a partial-answer note when the round-trip cap is exhausted", async () => {
    let call = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation((_url, init?: RequestInit) => {
      void init;
      call += 1;
      // Never reaches end_turn — every turn truncates.
      return Promise.resolve({
        ok: true,
        text: () => Promise.resolve(""),
        json: () =>
          Promise.resolve({
            content: [{ type: "text", text: `chunk ${call} ` }],
            stop_reason: "max_tokens",
            usage: { input_tokens: 1, output_tokens: 1 },
          }),
      } as unknown as Response);
    });

    render(
      <ChatPanel lang="en-US" ai={AI_WITH_KEY} dispatcher={makeDispatcher()} onAcceptConsent={vi.fn()} />,
    );
    const ta = screen.getByPlaceholderText("Ask Claude about your tasks…");
    fireEvent.change(ta, { target: { value: "endless" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    // Bounded by the 12-turn cap, then a partial-answer note (not a silent stop).
    await waitFor(
      () => expect(screen.getByText(/cut short at the length limit/i)).toBeInTheDocument(),
      { timeout: 4000 },
    );
    expect(call).toBe(12);
  });
});

describe("conversation persistence across navigation (in-memory per-project store)", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  type Conv = { history: unknown[]; display: unknown[] };
  function makeChatStore() {
    const m = new Map<string, Conv>();
    return {
      m,
      get: (id: string) => m.get(id) as never,
      save: (id: string, conv: Conv) => { m.set(id, conv); },
    };
  }

  it("restores the conversation after unmount/remount (survives view navigation)", async () => {
    const store = makeChatStore();
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve({
        ok: true,
        text: () => Promise.resolve(""),
        json: () =>
          Promise.resolve({
            content: [{ type: "text", text: "assistant reply" }],
            stop_reason: "end_turn",
            usage: { input_tokens: 1, output_tokens: 1 },
          }),
      } as unknown as Response),
    );
    const props = {
      lang: "en-US" as const,
      ai: AI_WITH_KEY,
      dispatcher: makeDispatcher(),
      onAcceptConsent: vi.fn(),
      projectId: "p1",
      getChatConversation: store.get,
      saveChatConversation: store.save,
    };
    const { unmount } = render(<ChatPanel {...props} />);
    const ta = screen.getByPlaceholderText("Ask Claude about your tasks…");
    fireEvent.change(ta, { target: { value: "hello there" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(screen.getByText("assistant reply")).toBeInTheDocument());
    expect(store.m.get("p1")).toBeTruthy();

    // Simulate navigate-away (unmount) then return (fresh mount): the store
    // rehydrates both the user turn and the assistant reply.
    unmount();
    render(<ChatPanel {...props} />);
    expect(screen.getByText("assistant reply")).toBeInTheDocument();
    expect(screen.getByText("hello there")).toBeInTheDocument();
  });

  it("a project switch mid-send does not corrupt the new project's conversation", async () => {
    const store = makeChatStore();
    store.m.set("p2", { history: [{ role: "user", content: "q2" }], display: [{ kind: "user", text: "p2 msg" }] });
    let resolveFetch!: (r: Response) => void;
    const pending = new Promise<Response>((res) => { resolveFetch = res; });
    vi.spyOn(globalThis, "fetch").mockReturnValue(pending);
    const base = {
      lang: "en-US" as const,
      ai: AI_WITH_KEY,
      dispatcher: makeDispatcher(),
      onAcceptConsent: vi.fn(),
      getChatConversation: store.get,
      saveChatConversation: store.save,
    };
    const { rerender } = render(<ChatPanel {...base} projectId="p1" />);
    const ta = screen.getByPlaceholderText("Ask Claude about your tasks…");
    fireEvent.change(ta, { target: { value: "p1 question" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    // Switch to p2 while p1's send is still in flight.
    rerender(<ChatPanel {...base} projectId="p2" />);
    expect(screen.getByText("p2 msg")).toBeInTheDocument();

    // Now p1's reply lands — it must NOT leak onto p2 or clobber p2's store.
    resolveFetch({
      ok: true,
      text: () => Promise.resolve(""),
      json: () =>
        Promise.resolve({
          content: [{ type: "text", text: "P1 REPLY LEAK" }],
          stop_reason: "end_turn",
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
    } as unknown as Response);
    await waitFor(() => expect(screen.queryByText("P1 REPLY LEAK")).toBeNull());
    expect(store.m.get("p2")?.display).toEqual([{ kind: "user", text: "p2 msg" }]);
  });

  it("swaps to the target project's conversation on a project switch", () => {
    const store = makeChatStore();
    store.m.set("p1", { history: [{ role: "user", content: "q1" }], display: [{ kind: "user", text: "from p1" }] });
    store.m.set("p2", { history: [{ role: "user", content: "q2" }], display: [{ kind: "user", text: "from p2" }] });
    const base = {
      lang: "en-US" as const,
      ai: AI_WITH_KEY,
      dispatcher: makeDispatcher(),
      onAcceptConsent: vi.fn(),
      getChatConversation: store.get,
      saveChatConversation: store.save,
    };
    const { rerender } = render(<ChatPanel {...base} projectId="p1" />);
    expect(screen.getByText("from p1")).toBeInTheDocument();
    rerender(<ChatPanel {...base} projectId="p2" />);
    expect(screen.getByText("from p2")).toBeInTheDocument();
    expect(screen.queryByText("from p1")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Turso thread persistence (task 5): state, fetch-on-mount and the persistence
// effect only — no ChatThreadList sidebar UI yet (task 6 wires that).
// ---------------------------------------------------------------------------
describe("ChatPanel — Turso thread persistence", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // vi.restoreAllMocks() only restores vi.spyOn spies — it does NOT clear
    // call history on the plain vi.fn()s from the vi.mock("./chat-threads-store")
    // factory above, so loadThreads/saveThread/deleteThread call counts would
    // otherwise accumulate across this describe block's tests.
    vi.clearAllMocks();
  });
  afterEach(() => vi.restoreAllMocks());

  function renderChatPanel(extra: Record<string, unknown> = {}) {
    return render(
      <ChatPanel
        lang="en-US"
        ai={AI_WITH_KEY}
        dispatcher={makeDispatcher()}
        onAcceptConsent={vi.fn()}
        {...extra}
      />,
    );
  }

  it("does not fetch threads in file mode (tursoMode omitted) — existing behavior untouched", () => {
    renderChatPanel({});
    expect(loadThreads).not.toHaveBeenCalled();
  });

  it("fetches this project's threads on mount when tursoMode is true and adopts the most recent one", async () => {
    (loadThreads as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {
        id: "t1",
        projectId: "default",
        name: "Prior chat",
        createdAt: "c",
        updatedAt: "u",
        history: [],
        display: [{ kind: "user", text: "hi" }],
      },
    ] satisfies ChatThread[]);
    renderChatPanel({ tursoMode: true, tursoConfig: {} as never });
    await screen.findByText("hi");
    expect(loadThreads).toHaveBeenCalledWith({}, "default");
  });

  it("saves a new thread after the first turn completes, auto-named from the first message", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(""),
      json: () =>
        Promise.resolve({
          content: [{ type: "text", text: "assistant reply" }],
          stop_reason: "end_turn",
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
    } as unknown as Response);
    const loadThreadsMock = loadThreads as unknown as ReturnType<typeof vi.fn>;
    renderChatPanel({ tursoMode: true, tursoConfig: {} as never });
    // Let the initial (empty) thread-list fetch settle before sending — else
    // its own setDisplay([])/setHistory([]) can race and wipe the just-sent
    // user message, which is a timing artifact of this test's synchronous
    // send, not something this task's guard is meant to cover (Step 6 guards
    // an in-flight SEND against a thread switch, not the initial mount load
    // racing a send that started before it resolved).
    await waitFor(() => expect(loadThreadsMock).toHaveBeenCalledTimes(1));
    await loadThreadsMock.mock.results[0]!.value;
    const ta = screen.getByPlaceholderText("Ask Claude about your tasks…");
    fireEvent.change(ta, { target: { value: "Plan the Q1 review" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(saveThread).toHaveBeenCalled());
    const saved = (saveThread as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)![1] as ChatThread;
    expect(saved.name).toBe("Plan the Q1 review");
    expect(saved.projectId).toBe("default");
  });

  // ---------------------------------------------------------------------
  // Step 6's mid-send guard. There is no thread-switch UI to drive in THIS
  // task (ChatThreadList/selectThread's DOM wiring is task 6), so this test
  // exercises the same activeThreadId transition through the one path that
  // IS reachable today: the fetch-on-mount effect (step 5) resolving to a
  // different thread WHILE a send is still in flight. That is a genuine
  // activeThreadId change mid-send — exactly what Step 6 guards against —
  // it just arrives via the initial-load race rather than a sidebar click.
  // ---------------------------------------------------------------------
  it("a mid-send activeThreadId change does not let the in-flight reply corrupt the newly active thread", async () => {
    let resolveLoadThreads!: (threads: ChatThread[]) => void;
    (loadThreads as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      new Promise<ChatThread[]>((res) => {
        resolveLoadThreads = res;
      }),
    );
    let resolveFetch!: (r: Response) => void;
    const pendingFetch = new Promise<Response>((res) => {
      resolveFetch = res;
    });
    vi.spyOn(globalThis, "fetch").mockReturnValue(pendingFetch);

    renderChatPanel({ tursoMode: true, tursoConfig: {} as never });
    const ta = screen.getByPlaceholderText("Ask Claude about your tasks…");
    fireEvent.change(ta, { target: { value: "stale question" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    // Mid-send: the thread list resolves and adopts a DIFFERENT thread than
    // the one this send started on (activeThreadId was null at send-start).
    resolveLoadThreads([
      {
        id: "t-other",
        projectId: "default",
        name: "Other thread",
        createdAt: "c",
        updatedAt: "u",
        history: [],
        display: [{ kind: "user", text: "other thread content" }],
      },
    ] satisfies ChatThread[]);
    await screen.findByText("other thread content");

    // Now the stale send's reply lands.
    resolveFetch({
      ok: true,
      text: () => Promise.resolve(""),
      json: () =>
        Promise.resolve({
          content: [{ type: "text", text: "STALE REPLY LEAK" }],
          stop_reason: "end_turn",
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
    } as unknown as Response);

    await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument());
    // The stale reply must never appear...
    expect(screen.queryByText("STALE REPLY LEAK")).toBeNull();
    // ...and the newly active thread's own content must survive untouched —
    // not clobbered by a spurious "Stopped" note from the stale send (the
    // switchedAway check in Step 6's edit #2).
    expect(screen.getByText("other thread content")).toBeInTheDocument();
    expect(screen.queryByText("Stopped")).toBeNull();
  });

  it("a mid-send activeThreadId change also suppresses the catch-block error note (Step 6's edit #3)", async () => {
    let resolveLoadThreads!: (threads: ChatThread[]) => void;
    (loadThreads as unknown as ReturnType<typeof vi.fn>).mockReturnValueOnce(
      new Promise<ChatThread[]>((res) => {
        resolveLoadThreads = res;
      }),
    );
    let rejectFetch!: (reason: unknown) => void;
    const pendingFetch = new Promise<Response>((_res, rej) => {
      rejectFetch = rej;
    });
    vi.spyOn(globalThis, "fetch").mockReturnValue(pendingFetch);

    renderChatPanel({ tursoMode: true, tursoConfig: {} as never });
    const ta = screen.getByPlaceholderText("Ask Claude about your tasks…");
    fireEvent.change(ta, { target: { value: "stale question 2" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    resolveLoadThreads([
      {
        id: "t-other2",
        projectId: "default",
        name: "Other thread 2",
        createdAt: "c",
        updatedAt: "u",
        history: [],
        display: [{ kind: "user", text: "other thread content 2" }],
      },
    ] satisfies ChatThread[]);
    await screen.findByText("other thread content 2");

    // A genuine network error (not AbortError) on the stale send — proves the
    // catch block's suppression, not just the AbortError branch.
    rejectFetch(new Error("network down"));

    await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument());
    expect(screen.getByText("other thread content 2")).toBeInTheDocument();
    // No error banner from the stale send leaks onto the newly active thread.
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Usage-limit notice (T1): a 429 (Anthropic's own rate/usage limit) must APPEND
// a notice to the transcript and MUST NOT clear the prior messages.
// ---------------------------------------------------------------------------
describe("usage-limit notice", () => {
  afterEach(() => vi.restoreAllMocks());

  it("appends a notice on a 429 and keeps prior messages (does not clear the transcript)", async () => {
    const rateLimitBody = { error: { type: "rate_limit_error", message: "SECRET-do-not-render" } };
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 429,
      json: () => Promise.resolve(rateLimitBody),
      text: () => Promise.resolve(JSON.stringify(rateLimitBody)),
    } as unknown as Response);

    render(
      <ChatPanel lang="en-US" ai={AI_WITH_KEY} dispatcher={makeDispatcher()} onAcceptConsent={vi.fn()} />,
    );
    const ta = screen.getByPlaceholderText("Ask Claude about your tasks…");
    fireEvent.change(ta, { target: { value: "list tasks" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    // The advisory notice is appended to the transcript.
    await screen.findByText(/Claude usage limit reached/i);
    // The prior user message is STILL present — the transcript was not cleared.
    expect(screen.getByText("list tasks")).toBeInTheDocument();
    // Rendered as an in-transcript notice, not the error banner.
    expect(screen.queryByRole("alert")).toBeNull();
    // The response body's message text is never surfaced.
    expect(screen.queryByText(/SECRET-do-not-render/)).toBeNull();
    // Not blocked — the composer is usable again after the notice.
    await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument());
  });
});

// ---------------------------------------------------------------------------
// Closable error banner: the error alert carries a labeled dismiss control that
// clears the error.
// ---------------------------------------------------------------------------
describe("closable error banner", () => {
  afterEach(() => vi.restoreAllMocks());

  it("shows a dismiss button that clears the error banner", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("boom"));

    render(
      <ChatPanel lang="en-US" ai={AI_WITH_KEY} dispatcher={makeDispatcher()} onAcceptConsent={vi.fn()} />,
    );
    const ta = screen.getByPlaceholderText("Ask Claude about your tasks…");
    fireEvent.change(ta, { target: { value: "list tasks" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/Chat failed/i);

    // The banner carries a labeled dismiss control; clicking it clears the error.
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });
});

// ---------------------------------------------------------------------------
// 400 response message surfacing: an invalid_request_error (generic, not a rate
// limit) surfaces the sanitized RESPONSE error.message in the banner so the user
// sees WHY (e.g. "prompt is too long"), not just a bare status digit.
// ---------------------------------------------------------------------------
describe("400 response message surfacing", () => {
  afterEach(() => vi.restoreAllMocks());

  it("appends the Anthropic error.message text to the error banner on a 400", async () => {
    const body = {
      error: {
        type: "invalid_request_error",
        message: "prompt is too long: 250000 tokens > 200000 maximum",
      },
    };
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 400,
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
    } as unknown as Response);

    render(
      <ChatPanel lang="en-US" ai={AI_WITH_KEY} dispatcher={makeDispatcher()} onAcceptConsent={vi.fn()} />,
    );
    const ta = screen.getByPlaceholderText("Ask Claude about your tasks…");
    fireEvent.change(ta, { target: { value: "list tasks" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    const alert = await screen.findByRole("alert");
    // The message text is surfaced...
    expect(alert).toHaveTextContent(/prompt is too long: 250000 tokens > 200000/);
    // ...alongside the status digit from the chatError template.
    expect(alert).toHaveTextContent(/400/);
  });

  it("stays status-only when a non-400 failure has no readable message body", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.reject(new Error("not json")),
      text: () => Promise.resolve(""),
    } as unknown as Response);

    render(
      <ChatPanel lang="en-US" ai={AI_WITH_KEY} dispatcher={makeDispatcher()} onAcceptConsent={vi.fn()} />,
    );
    const ta = screen.getByPlaceholderText("Ask Claude about your tasks…");
    fireEvent.change(ta, { target: { value: "list tasks" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/500/);
    // No " — <message>" suffix when there is no readable body.
    expect(alert.textContent ?? "").not.toContain(" — ");
  });
});
