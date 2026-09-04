import "fake-indexeddb/auto";
import { asTimeZoneForTests } from "./timezone";
import { act, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { useState } from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ChatPanel } from "./chat-panel";
import { ATTACHMENT_ACCEPT } from "./chat-attachments";
import { buildCfbf } from "./__fixtures__/cfbf-writer";
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
import { peekMintId } from "./id-mint-session";
import type { ChatConversation } from "./workspace-tab-context";

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

  // ★★★ THE ONLY END-TO-END COVER FOR `chatAttachmentEncrypted`, and the reason
  //  it exists is that the string, the union member and the branch below all
  //  shipped with NO producer (docs/open-followups.md §352) — a reader grepped
  //  for the capability, found three of its four parts, and concluded it
  //  worked. A unit test on the detector would have reproduced exactly that
  //  gap, so this drives a real File through the real ingest pipeline and
  //  asserts on the rendered text.
  it("tells the user a password-protected office file needs its password removed", async () => {
    const { container } = renderComposer();
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    // MS-OFFCRYPTO: a password-protected .docx is an MS-CFB compound file
    // carrying the ciphertext, not a zip. Streams are padded past the fixture
    // writer's 4096-byte mini-stream cutoff so they read back non-empty.
    const encrypted = buildCfbf([
      { name: "EncryptionInfo", data: new Uint8Array(4608).fill(1) },
      { name: "EncryptedPackage", data: new Uint8Array(4608).fill(2) },
    ]);
    // ★ Copy into a plain ArrayBuffer rather than handing the Uint8Array to
    //  File directly: a `Uint8Array<ArrayBufferLike>` is not a `BlobPart`
    //  under this tsconfig, and vitest is green either way — `next build`
    //  does not typecheck tests, so only `npx tsc --noEmit` catches it.
    const buf = new ArrayBuffer(encrypted.byteLength);
    new Uint8Array(buf).set(encrypted);
    const file = new File([buf], "plan.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
    fireEvent.change(fileInput, { target: { files: [file] } });
    const alert = await screen.findByRole("alert");
    // ★ `toContain`, not `toBe`: the alert also holds its own dismiss glyph.
    expect(alert.textContent).toContain(t("en-US", "chatAttachmentEncrypted", "plan.docx"));
    // And NOT the generic read failure this file used to surface — the whole
    // point of the variant is that the two messages differ.
    expect(alert.textContent).not.toContain(t("en-US", "chatAttachmentReadFailed", "plan.docx"));
  });

  it("offers the shared accept list, not a hand-written literal", () => {
    const { container } = renderComposer();
    const input = container.querySelector('input[type="file"]');
    expect(input?.getAttribute("accept")).toBe(ATTACHMENT_ACCEPT);
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
  timezone: asTimeZoneForTests("UTC"),
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
    const s = systemBlocksText(buildSystemPrompt("en-US", snap, [], true, {}));
    expect(s).toContain("APP CONTEXT");
    expect(s).toContain("Mode: advanced");
    expect(s).toContain("Current view: milestones");
    expect(s).toContain("senior project");
  });

  it("includes in-scope guides when grounding is ON", () => {
    const s = systemBlocksText(buildSystemPrompt("en-US", snap, [guide], true, {}));
    expect(s).toContain("Be decisive.");
    expect(s).toContain("priority order");
  });

  it("omits the guide block when grounding is OFF", () => {
    const s = systemBlocksText(buildSystemPrompt("en-US", snap, [guide], false, {}));
    expect(s).not.toContain("Be decisive.");
  });

  it("omits the guide block when no guide is in scope", () => {
    const off: OperatingGuide = { ...guide, scope: { views: ["budget" as const] } };
    const s = systemBlocksText(buildSystemPrompt("en-US", snap, [off], true, {}));
    expect(s).not.toContain("Be decisive.");
  });

  it("caches the stable prefix (incl. guide) and leaves volatile state uncached", () => {
    const blocks = buildSystemPrompt("en-US", snap, [guide], true, {});
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

  it("summarises a mail attachment's children so the user can see the tree", async () => {
    const { container } = renderWithKey();
    const eml = new File(
      [[
        'Content-Type: multipart/mixed; boundary="B"', "Subject: S", "",
        "--B", "Content-Type: text/plain", "", "body",
        "--B", 'Content-Type: text/plain; name="a.txt"',
        'Content-Disposition: attachment; filename="a.txt"', "", "alpha",
        "--B--", "",
      ].join("\r\n")],
      "m.eml",
      { type: "message/rfc822" },
    );
    await userEvent.upload(fileInputOf(container), eml);
    // Exact match: the chip's own name span, not the summary span below it
    // (which also contains "m.eml" as part of its "{name} — N attachments" text).
    expect(await screen.findByText("m.eml")).toBeInTheDocument();
    expect(await screen.findByText(/1 attachment/i)).toBeInTheDocument();
  });

  // ★★★ THE ASSERTION THIS WHOLE BRANCH EXISTS FOR. The recursive walk in
  // attachment-ingest.ts was computed and thrown away: chat-panel staged
  // `result.node.block` alone, so a mail reached the model as its headers,
  // its body and an attachment LIST NAMING the spreadsheet — with not one
  // word of the spreadsheet in the payload. The chip said "1 attachment", so
  // the user believed it had gone, and asking about the attached budget got
  // an answer invented from the filename.
  //
  // ★★ It asserts on the PAYLOAD TEXT, deliberately not on a block count: a
  // count is satisfied by any second block, including an empty one.
  it("sends a mail attachment's content, not just its name", async () => {
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
    const eml = new File(
      [[
        'Content-Type: multipart/mixed; boundary="B"', "Subject: Q3 status", "",
        "--B", "Content-Type: text/plain", "", "See the attached budget.",
        "--B", 'Content-Type: text/plain; name="Q3-budget.txt"',
        'Content-Disposition: attachment; filename="Q3-budget.txt"', "",
        "Budget line: TOTALCAPEX-4711-EUR",
        "--B--", "",
      ].join("\r\n")],
      "status.eml",
      { type: "message/rfc822" },
    );
    await userEvent.upload(fileInputOf(container), eml);
    await screen.findByText("status.eml");
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());

    type Block = { type: string; source?: { type: string; data: string } };
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    const userMsg = body.messages[body.messages.length - 1];
    const payload = (userMsg.content as Block[])
      .map((b) => b.source?.data ?? "")
      .join("\n");
    // The mail names the file — that half always worked, and is what made the
    // omission actively misleading rather than merely incomplete.
    expect(payload).toContain("Q3-budget.txt");
    // ...and now the file's own words are there too.
    expect(payload).toContain("TOTALCAPEX-4711-EUR");
  });

  // The chip is per dropped FILE; the blocks are per walked NODE. Sending the
  // tree must not split one mail into several chips.
  it("stages exactly one chip for one dropped mail, however many nodes it holds", async () => {
    const { container } = renderWithKey();
    const eml = new File(
      [[
        'Content-Type: multipart/mixed; boundary="B"', "Subject: S", "",
        "--B", "Content-Type: text/plain", "", "body",
        "--B", 'Content-Type: text/plain; name="a.txt"',
        'Content-Disposition: attachment; filename="a.txt"', "", "alpha",
        "--B", 'Content-Type: text/plain; name="b.txt"',
        'Content-Disposition: attachment; filename="b.txt"', "", "bravo",
        "--B--", "",
      ].join("\r\n")],
      "m.eml",
      { type: "message/rfc822" },
    );
    await userEvent.upload(fileInputOf(container), eml);
    await screen.findByText(/2 attachments/i);
    expect(screen.getAllByRole("button", { name: /^Remove / })).toHaveLength(1);
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
  // Step 6's mid-send guard: a THREAD SWITCH while a send is in flight must
  // not let that send's reply land on the newly selected thread.
  //
  // ★★ These two tests used to drive the switch through the fetch-on-mount
  // effect resolving to a different thread mid-send, because the sidebar did
  // not exist yet when they were written (their old comment said so). That
  // proxy is no longer valid: the mount fetch now DETECTS a thread adopted
  // while it was in flight and merges instead of adopting, precisely so it
  // cannot orphan a send that started first — see use-chat-threads.ts's
  // fetch effect. So they drive the real sidebar switch instead, which is
  // the transition the guard is actually about.
  // ---------------------------------------------------------------------
  const TWO_THREADS: ChatThread[] = [
    {
      id: "t-a",
      projectId: "default",
      name: "Thread A",
      createdAt: "c",
      updatedAt: "u2",
      history: [],
      display: [{ kind: "user", text: "thread A content" }],
    },
    {
      id: "t-b",
      projectId: "default",
      name: "Thread B",
      createdAt: "c",
      updatedAt: "u1",
      history: [],
      display: [{ kind: "user", text: "thread B content" }],
    },
  ];

  it("a mid-send activeThreadId change does not let the in-flight reply corrupt the newly active thread", async () => {
    (loadThreads as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(TWO_THREADS);
    let resolveFetch!: (r: Response) => void;
    const pendingFetch = new Promise<Response>((res) => {
      resolveFetch = res;
    });
    vi.spyOn(globalThis, "fetch").mockReturnValue(pendingFetch);

    renderChatPanel({ tursoMode: true, tursoConfig: {} as never });
    // Thread A (first in the fetched list) is adopted on mount; send from it.
    await screen.findByText("thread A content");
    const ta = screen.getByPlaceholderText("Ask Claude about your tasks…");
    fireEvent.change(ta, { target: { value: "stale question" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    // Mid-send: the user clicks a DIFFERENT thread in the sidebar.
    fireEvent.click(screen.getByRole("button", { name: 'Open "Thread B"' }));
    await screen.findByText("thread B content");

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
    expect(screen.getByText("thread B content")).toBeInTheDocument();
    expect(screen.queryByText("Stopped")).toBeNull();
  });

  it("a mid-send activeThreadId change also suppresses the catch-block error note (Step 6's edit #3)", async () => {
    (loadThreads as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(TWO_THREADS);
    let rejectFetch!: (reason: unknown) => void;
    const pendingFetch = new Promise<Response>((_res, rej) => {
      rejectFetch = rej;
    });
    vi.spyOn(globalThis, "fetch").mockReturnValue(pendingFetch);

    renderChatPanel({ tursoMode: true, tursoConfig: {} as never });
    await screen.findByText("thread A content");
    const ta = screen.getByPlaceholderText("Ask Claude about your tasks…");
    fireEvent.change(ta, { target: { value: "stale question 2" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    fireEvent.click(screen.getByRole("button", { name: 'Open "Thread B"' }));
    await screen.findByText("thread B content");

    // A genuine network error (not AbortError) on the stale send — proves the
    // catch block's suppression, not just the AbortError branch.
    rejectFetch(new Error("network down"));

    await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument());
    expect(screen.getByText("thread B content")).toBeInTheDocument();
    // No error banner from the stale send leaks onto the newly active thread.
    expect(screen.queryByRole("alert")).toBeNull();
  });

  // -------------------------------------------------------------------
  // Task 6: the sidebar itself. Everything above this point predates the
  // sidebar UI; these two pin that the tursoMode gate — the one thing that
  // could silently regress file mode — actually gates rendering.
  // -------------------------------------------------------------------
  it("renders no sidebar in file mode (tursoMode omitted) — existing behavior untouched", () => {
    renderChatPanel({});
    expect(screen.queryByRole("button", { name: "New chat" })).not.toBeInTheDocument();
  });

  it("renders the thread sidebar when tursoMode is true", () => {
    renderChatPanel({ tursoMode: true, tursoConfig: {} as never });
    expect(screen.getByRole("button", { name: "New chat" })).toBeInTheDocument();
  });

  // -------------------------------------------------------------------
  // Review Finding 1 (HIGH) + Finding 2 (HIGH): a fresh Turso project has
  // ZERO threads, so activeThreadId starts null — the state the app is in
  // before the user has EVER clicked "New chat" or selected a thread. That
  // is the most common way a user's first message reaches Turso persistence,
  // and it was the one path ensureThreadForSend's `activeThreadId === null`
  // bail left uncovered: the message got no row and no recovery path if the
  // user switched threads before the reply landed.
  // -------------------------------------------------------------------
  //
  // MUTATION-PROVED, 2026-08-14, by TWO separate mutants: (a) restoring the
  // old `activeThreadId === null` bail in ensureThreadForSend, and (b)
  // deleting its call site here (`const sendThreadId =
  // chatThreads.ensureThreadForSend(…)` → `= chatThreads.activeThreadId`).
  // Each turns this test AND the "saves the new thread's row before the model
  // reply resolves" test below red — 2 red in this file per mutant — because
  // `saveThread` is never called before the New-chat click, so the row (and
  // therefore the sidebar entry) never exists.
  it("a fresh project's first-ever message survives clicking New chat before the reply lands (Finding 1)", async () => {
    let resolveFetch!: (r: Response) => void;
    const pendingFetch = new Promise<Response>((res) => {
      resolveFetch = res;
    });
    vi.spyOn(globalThis, "fetch").mockReturnValue(pendingFetch);

    renderChatPanel({ tursoMode: true, tursoConfig: {} as never });
    const loadThreadsMock = loadThreads as unknown as ReturnType<typeof vi.fn>;
    await waitFor(() => expect(loadThreadsMock).toHaveBeenCalledTimes(1));
    // Flush the (empty) thread list so activeThreadId settles to null before
    // sending — the exact starting state this finding is about.
    await loadThreadsMock.mock.results[0]!.value;

    const ta = screen.getByPlaceholderText("Ask Claude about your tasks…");
    fireEvent.change(ta, { target: { value: "first ever message" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    // The row must exist and be saved BEFORE the model even replies.
    await waitFor(() => expect(saveThread).toHaveBeenCalledTimes(1));
    const savedFirst = (saveThread as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1] as ChatThread;
    expect(savedFirst.display).toEqual([{ kind: "user", text: "first ever message" }]);

    // Switch away — the "+ New chat" button is not busy-guarded — BEFORE the
    // stale reply lands.
    fireEvent.click(screen.getByRole("button", { name: "New chat" }));

    resolveFetch({
      ok: true,
      text: () => Promise.resolve(""),
      json: () =>
        Promise.resolve({
          content: [{ type: "text", text: "STALE REPLY" }],
          stop_reason: "end_turn",
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
    } as unknown as Response);

    await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument());
    // The stale reply never lands on the new (empty) thread...
    expect(screen.queryByText("STALE REPLY")).toBeNull();
    // ...and the first thread's row — with the user's message — still exists
    // in the sidebar (its name is auto-derived from that first message).
    expect(screen.getByText("first ever message")).toBeInTheDocument();
  });

  // -------------------------------------------------------------------
  // Review Finding 2 (HIGH): deleting the ensureThreadForSend call site left
  // all pre-existing tests green, because the only assertion anywhere was
  // "saveThread was eventually called" after a FULL send+reply cycle — which
  // the busy-persist settle effect satisfies on its own. This pins the EARLY
  // save specifically: it must have already happened while the model call is
  // still pending, which only ensureThreadForSend's call site can produce.
  //
  // MUTATION-PROVED, 2026-08-14: replacing that call site with the
  // pre-3b1e962b `const sendThreadId = chatThreads.activeThreadId;` turns
  // this test red — saveThread is never called while the fetch is pending,
  // only once it settles via the busy-persist effect. (It turns 2 tests red
  // in this file; the other is the Finding-1 test above.)
  // -------------------------------------------------------------------
  it("saves the new thread's row before the model reply resolves — pins the ensureThreadForSend call site (Finding 2)", async () => {
    let resolveFetch!: (r: Response) => void;
    const pendingFetch = new Promise<Response>((res) => {
      resolveFetch = res;
    });
    vi.spyOn(globalThis, "fetch").mockReturnValue(pendingFetch);

    renderChatPanel({ tursoMode: true, tursoConfig: {} as never });
    const loadThreadsMock = loadThreads as unknown as ReturnType<typeof vi.fn>;
    await waitFor(() => expect(loadThreadsMock).toHaveBeenCalledTimes(1));
    await loadThreadsMock.mock.results[0]!.value;

    const ta = screen.getByPlaceholderText("Ask Claude about your tasks…");
    fireEvent.change(ta, { target: { value: "early save check" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    // The model call is STILL PENDING here — a save at this point can only
    // have come from the early call site, never the busy-persist settle
    // effect (which fires only once busy flips back to false).
    await waitFor(() => expect(saveThread).toHaveBeenCalledTimes(1));
    const saved = (saveThread as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1] as ChatThread;
    expect(saved.display).toEqual([{ kind: "user", text: "early save check" }]);

    resolveFetch({
      ok: true,
      text: () => Promise.resolve(""),
      json: () =>
        Promise.resolve({
          content: [{ type: "text", text: "reply" }],
          stop_reason: "end_turn",
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
    } as unknown as Response);
    await waitFor(() => expect(screen.getByText("reply")).toBeInTheDocument());
  });

  // -------------------------------------------------------------------
  // Round-4 Finding 1 (HIGH, a regression): `tursoMode` flipping to FALSE on
  // a LIVE panel — a Turso→File project switch, where `panel-chat` in
  // workspace-section.tsx is mounted unconditionally with `hidden=` and no
  // `key`, so it never remounts — left the OLD Turso thread id in
  // threadIdRef (nothing resets activeThreadId on that flip) while
  // ensureThreadForSend returned a hardcoded `null`. `stale()` was therefore
  // true on its FIRST evaluation, which is the send loop's first statement:
  // no API call, no reply, no error, no banner. Every file-mode send after
  // such a switch was a silent no-op.
  //
  // ★ TEST TRAP: this MUST be a rerender, never a second render. A remount
  // reseeds threadIdRef to null, the old `return null` then MATCHES it, and
  // the test passes with the fix reverted — i.e. vacuous.
  // -------------------------------------------------------------------
  it("still sends after tursoMode flips to false on a live (never remounted) panel", async () => {
    (loadThreads as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      {
        id: "t1",
        projectId: "default",
        name: "Prior chat",
        createdAt: "c",
        updatedAt: "u",
        history: [],
        display: [{ kind: "user", text: "prior message" }],
      },
    ] satisfies ChatThread[]);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(""),
      json: () =>
        Promise.resolve({
          content: [{ type: "text", text: "file mode reply" }],
          stop_reason: "end_turn",
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
    } as unknown as Response);

    // Hoisted so `tursoMode` is the ONLY prop that changes across the
    // rerender (a fresh {} each call would also churn the fetch effect's
    // tursoConfig dependency).
    const tursoConfig = {} as never;
    const dispatcher = makeDispatcher();
    const onAcceptConsent = vi.fn();
    const panel = (tursoMode: boolean) => (
      <ChatPanel
        lang="en-US"
        ai={AI_WITH_KEY}
        dispatcher={dispatcher}
        onAcceptConsent={onAcceptConsent}
        tursoMode={tursoMode}
        tursoConfig={tursoConfig}
      />
    );

    const { rerender } = render(panel(true));
    // Turso mode adopted t1, so threadIdRef now holds "t1" — the stale value
    // the file-mode send used to trip over.
    await screen.findByText("prior message");

    rerender(panel(false));
    // Same panel, file mode now: the sidebar is gone but the ref is not.
    expect(screen.queryByRole("button", { name: "New chat" })).not.toBeInTheDocument();

    const ta = screen.getByPlaceholderText("Ask Claude about your tasks…");
    fireEvent.change(ta, { target: { value: "file mode question" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    // The model call really happened — the send loop was not short-circuited
    // by the stale-thread guard before its first callClaude.
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.filter((c) => String(c[0]).includes("/v1/messages")),
      ).toHaveLength(1),
    );
    // ...and the reply reached the transcript.
    expect(await screen.findByText("file mode reply")).toBeInTheDocument();
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

// ---------------------------------------------------------------------------
// The historySearch kill switch, asserted on the WIRE
// ---------------------------------------------------------------------------
// ★★★ `toolsFor` is well covered in chat-api.test.ts, but nothing observed that
//   chat-panel actually HANDS IT the setting. `chat-panel.tsx` passes
//   `ai.historySearch` as the fifth argument to `callClaude`; measured before
//   this suite, replacing it with a hardcoded `undefined` left 91 tests across
//   4 suites green — the user's "off" switch was inert on every chat request
//   and no test could tell.
//
// ★★ Asserted on the REQUEST BODY rather than on a `callClaude` spy: the body
//   is what the API actually receives, so this cannot pass while the tool
//   schema still ships. It also survives a refactor of how the panel reaches
//   the network, which a module spy would not. ★ "The body" only became a
//   complete claim when the helper started reading `system` as well as `tools`
//   — see below; while it parsed one key it was one call site's worth of
//   coverage wearing a whole-request name.
// ★★★ READ *BOTH* HALVES OF THE BODY — `body.tools` ALONE IS HALF A TEST, and
//   the half it misses is the defect this branch exists to fix. `ai.historySearch`
//   reaches the request through TWO independent call sites in `chat-panel.tsx`:
//   `buildSystemPrompt(..., ai)` → `body.system` (the
//   ADVERTISEMENT) and `callClaude(..., ai)` → `toolsFor()` →
//   `body.tools` (the SCHEMA). Pinning only the second means passing a literal
//   `undefined` as `buildSystemPrompt`'s fifth argument reinstates exactly the
//   shipped bug — a system prompt naming `search_history` on every turn of every
//   conversation while the request carries no such tool — with the whole suite
//   green. `chat-api.test.ts` cannot cover it either: it calls
//   `buildSystemPrompt` directly with an explicit argument, so it tests the
//   BUILDER, never the WIRING. This describe block is the only place the two
//   call sites are checked against ONE setting.
describe("historySearch reaches the request body", () => {
  // ★★ BOTH hooks, and the beforeEach is the load-bearing one. `globalThis.fetch`
  // is msw's `fetchProxy`; `vi.spyOn` on a property that is ALREADY spied returns
  // the EXISTING spy, call history and all, rather than a fresh one. A sibling
  // describe that leaves its spy installed therefore hands this one a mock that
  // has already been called, and `requestBodyFor`'s `toHaveBeenCalledTimes(1)`
  // reads 2 before this render has done anything. Measured: with only the
  // afterEach, `vitest --sequence.shuffle --sequence.seed=1` puts "chips stay
  // available after the first message is sent" immediately before this test and
  // the spy arrives carrying one call. An afterEach cannot protect this describe
  // from what ran BEFORE it — only a beforeEach can.
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  // ★★★ THE VIEW IS FIXTURE, NOT DECORATION. The system prompt only NAMES a
  //   tool where something advertises it, and the shared `makeDispatcher()`
  //   snapshot advertises nothing: `currentView: "open-points"` (whose scope
  //   entry has no `search_history` hint) and no `activitySummary` (so
  //   `buildActivityRecapBlock` returns ""). Against that fixture the `system`
  //   assertions below would pass for BOTH settings and pin nothing. The
  //   `activity` view's scope entry carries `toolHints: ["search_history"]` AND
  //   `readingRequiresTool: "search_history"`, so `buildViewScopeBlock` names
  //   the tool exactly when it is offered and drops it when it is not.
  function activityViewDispatcher(): ToolDispatcher {
    const base = makeDispatcher();
    return {
      ...base,
      getSnapshot: vi.fn(() => ({ ...base.getSnapshot(), currentView: "activity" as const })),
    } as unknown as ToolDispatcher;
  }

  function okResponse() {
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

  /** Both halves of the ONE request body: the tool schema list and the system
   *  prompt text. `system` is `SystemBlock[]` (`{type:"text", text}`), joined
   *  here because the block SPLIT (cached prefix / volatile suffix) is a
   *  caching decision no assertion below should depend on. */
  async function requestBodyFor(ai: typeof AI_WITH_KEY) {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(okResponse);
    const view = render(
      <ChatPanel
        lang="en-US"
        ai={ai}
        dispatcher={activityViewDispatcher()}
        onAcceptConsent={vi.fn()}
      />,
    );
    const ta = screen.getByPlaceholderText("Ask Claude about your tasks…");
    fireEvent.change(ta, { target: { value: "what changed recently" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(String(init.body)) as {
      tools: { name: string }[];
      system: { text: string }[];
    };
    view.unmount();
    fetchSpy.mockRestore();
    return {
      tools: body.tools.map((tool) => tool.name),
      system: body.system.map((block) => block.text).join("\n"),
    };
  }

  it("ships the search_history schema AND advertises it in the system prompt by default", async () => {
    const { tools, system } = await requestBodyFor(AI_WITH_KEY);
    expect(tools).toContain("search_history");
    expect(system).toContain("search_history");
  });

  it("omits the search_history schema AND its advertisement when the toggle is off", async () => {
    const off = await requestBodyFor({ ...AI_WITH_KEY, historySearch: false });
    expect(off.tools).not.toContain("search_history");
    // The half `body.tools` cannot see: a prompt naming a tool the request does
    // not carry. This is the assertion that goes red if `chat-panel.tsx` stops
    // threading `ai.historySearch` into `buildSystemPrompt`.
    expect(off.system).not.toContain("search_history");
    // ★ CONTROL for the negatives above: `not.toContain` also passes on an empty
    //   array, so pin that exactly ONE tool was dropped rather than the list
    //   being gutted — the same trap chat-api.test.ts guards for `toolsFor`.
    const on = await requestBodyFor(AI_WITH_KEY);
    expect(off.tools).toHaveLength(on.tools.length - 1);
    // ★ And the mirror control for the prompt: the block itself must still be
    //   there, only its tool-bearing lines gone — otherwise a prompt that lost
    //   the whole view-scope block would satisfy the negative above.
    expect(off.system).toContain("VIEW SCOPE");
  });
});

// ---------------------------------------------------------------------------
// abortRef ownership under a same-tick double dispatch (open-followups §312)
// ---------------------------------------------------------------------------
describe("abortRef ownership across concurrent sends", () => {
  afterEach(() => vi.restoreAllMocks());

  it("still holds the second send's controller after the first send settles", async () => {
    const signals: AbortSignal[] = [];
    let rejectFirst!: (reason: unknown) => void;
    const first = new Promise<Response>((_res, rej) => { rejectFirst = rej; });
    const second = new Promise<Response>(() => {});
    vi.spyOn(globalThis, "fetch").mockImplementation((_url, init) => {
      signals.push((init as RequestInit).signal as AbortSignal);
      return signals.length === 1 ? first : second;
    });

    const base = {
      lang: "en-US" as const,
      ai: AI_WITH_KEY,
      dispatcher: makeDispatcher(),
      onAcceptConsent: vi.fn(),
    };
    const { rerender } = render(<ChatPanel {...base} projectId="p1" />);
    fireEvent.change(screen.getByPlaceholderText("Ask Claude about your tasks…"), {
      target: { value: "list tasks" },
    });

    // Two native clicks with NO render between them, so both submitPrompt calls
    // read `busy === false` off the same render closure. That is the same-tick
    // double dispatch submitPrompt's own `busy` bail cannot stop, and it is the
    // only way to give abortRef a second owner.
    const send = screen.getByRole("button", { name: "Send" });
    await act(async () => {
      send.click();
      send.click();
    });
    await waitFor(() => expect(signals).toHaveLength(2));

    // Settle send 1. Its `finally` runs while send 2 is still in flight.
    await act(async () => {
      rejectFirst(new Error("boom"));
    });
    // ★ WITNESS that the finally actually ran, without which this block has no
    // discriminating power at all: if the rejection ever stops reaching it,
    // signals[1] is unaborted-then-aborted under the fixed AND the unconditional
    // clear alike, and the assertion below passes for the wrong reason. `setBusy
    // (false)` sits in that same finally, one line under the clear being tested,
    // so the Send control returning proves the finally ran.
    await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument());

    // A project switch aborts whatever abortRef holds. It must still be send 2's
    // controller: an unconditional clear in send 1's `finally` empties the slot,
    // and retryLoad then reads that same ref as "no send in flight".
    await act(async () => {
      rerender(<ChatPanel {...base} projectId="p2" />);
    });

    expect(signals[1].aborted).toBe(true);
    // Control: send 1 already settled and was never the target, so a passing
    // assertion above cannot come from a blanket abort of every controller.
    expect(signals[0].aborted).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Staged destructive writes: the review card (follow-up 377)
// ---------------------------------------------------------------------------
describe("staged tool calls (the review card)", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  const CARD = { name: "Proposed changes" } as const;
  const NEW_TASK = { taskName: "A", assignee: "me", dueDate: "2026-06-10" };

  type Block = { type: string; id?: string; name?: string; input?: unknown; text?: string };
  const usage = { input_tokens: 1, output_tokens: 1 };
  const toolTurn = (content: Block[]) => ({ content, stop_reason: "tool_use", usage });
  const doneTurn = (text: string) => ({
    content: [{ type: "text", text }],
    stop_reason: "end_turn",
    usage,
  });

  /** Serve `turns` in order, recording every request body. */
  function scriptFetch(turns: unknown[], bodies: string[]) {
    let call = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation((_url, init?: RequestInit) => {
      bodies.push(String(init?.body ?? ""));
      const body = turns[Math.min(call, turns.length - 1)];
      call += 1;
      return Promise.resolve({
        ok: true,
        text: () => Promise.resolve(""),
        json: () => Promise.resolve(body),
      } as unknown as Response);
    });
  }

  function send(text = "go") {
    fireEvent.change(screen.getByPlaceholderText("Ask Claude about your tasks…"), {
      target: { value: text },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
  }

  /** The `tool_result` blocks the SECOND request carries back to the model. */
  function resultsIn(body: string): { type: string; tool_use_id: string; content: string }[] {
    const sent = JSON.parse(body) as { messages: { role: string; content: unknown }[] };
    const last = sent.messages[sent.messages.length - 1];
    return last.content as { type: string; tool_use_id: string; content: string }[];
  }

  it("a NON-destructive single write still runs immediately — the unchanged path", async () => {
    // ★ THE CONTROL FOR THE WHOLE FEATURE. `shouldStage` is false for one
    //   non-destructive entity write, and that turn must behave exactly as it
    //   did before the gate existed: the tool RUNS, its real result goes back to
    //   the model, and no card appears. Mutant: `if (true)` at the gate — the
    //   dispatcher assertion and the tool-block assertion both go red.
    const dispatcher = makeDispatcher();
    const bodies: string[] = [];
    scriptFetch(
      [
        toolTurn([{ type: "tool_use", id: "t1", name: "create_task", input: NEW_TASK }]),
        doneTurn("done"),
      ],
      bodies,
    );

    render(
      <ChatPanel lang="en-US" ai={AI_WITH_KEY} dispatcher={dispatcher} onAcceptConsent={vi.fn()} />,
    );
    send();

    await waitFor(() => expect(screen.getByText("done")).toBeInTheDocument());
    expect(dispatcher.createTask).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("region", CARD)).toBeNull();
    // The transcript shows the tool block the immediate path has always pushed.
    expect(screen.getByText(/Used create_task/)).toBeInTheDocument();
    // ...and the model got the REAL result, not the staged notice.
    expect(bodies[1]).not.toContain("staged for the user");
  });

  it("a destructive turn runs NOTHING, renders the card, and answers EVERY tool_use id", async () => {
    // ★★★ THE UNANSWERED-ID HALF IS THE EXPENSIVE ONE. A `tool_use` left with
    //   no `tool_result` 400s the next request and wedges the chat permanently
    //   — `closeDanglingToolUses` exists because of exactly that. Mutant: drop
    //   `messages.push({role:"user", content: …})` from the staging branch and
    //   the id assertion goes red.
    const dispatcher = makeDispatcher();
    const bodies: string[] = [];
    scriptFetch(
      [
        toolTurn([
          { type: "tool_use", id: "t1", name: "delete_all_tasks", input: {} },
          { type: "tool_use", id: "t2", name: "create_task", input: NEW_TASK },
        ]),
        doneTurn("ok"),
      ],
      bodies,
    );

    render(
      <ChatPanel lang="en-US" ai={AI_WITH_KEY} dispatcher={dispatcher} onAcceptConsent={vi.fn()} />,
    );
    send();

    await screen.findByRole("region", CARD);
    expect(dispatcher.deleteAllTasks).not.toHaveBeenCalled();
    expect(dispatcher.createTask).not.toHaveBeenCalled();

    const results = resultsIn(bodies[1]);
    expect(results.every((b) => b.type === "tool_result")).toBe(true);
    expect(results.map((b) => b.tool_use_id).sort()).toEqual(["t1", "t2"]);
    expect(results[0].content).toContain("has NOT been applied");
  });

  it("the staged result for a create carries its provisional id, and the mint ADVANCED", async () => {
    // ★★★ THE `peekMintId` MUTANT AT THE SEAM. `peekMintId` does not advance
    //   the mark, so the first create's provisional id would equal the id apply
    //   later mints for it and the remap would be dormant for that row — live
    //   for every later one. The second assertion is what separates the two.
    //   Read BEFORE the send: the mark is module state this file shares, so an
    //   absolute number would be order-dependent, a relative one is not.
    const before = peekMintId("task", []);
    const bodies: string[] = [];
    scriptFetch(
      [
        toolTurn([
          { type: "tool_use", id: "t1", name: "delete_all_tasks", input: {} },
          { type: "tool_use", id: "t2", name: "create_task", input: NEW_TASK },
        ]),
        doneTurn("ok"),
      ],
      bodies,
    );

    render(
      <ChatPanel
        lang="en-US"
        ai={AI_WITH_KEY}
        dispatcher={makeDispatcher()}
        onAcceptConsent={vi.fn()}
      />,
    );
    send();
    await screen.findByRole("region", CARD);

    const created = resultsIn(bodies[1]).find((b) => b.tool_use_id === "t2");
    expect(created?.content).toContain(`id ${before}`);
    // The non-minting row must NOT invent one.
    expect(resultsIn(bodies[1]).find((b) => b.tool_use_id === "t1")?.content).not.toMatch(
      /refer to it as id/,
    );
    expect(peekMintId("task", [])).toBeGreaterThan(before);
  });

  it("Apply replays every kept row INSIDE one undo batch", async () => {
    // ★★★ ONE ENTRY, NOT N. The collapse itself is `use-undo-batch`'s own test;
    //   what this pins is the WIRING — that the replay happens inside the
    //   threaded `runBatched` and not around it. Mutant: pass `RUN_UNBATCHED`
    //   unconditionally instead of `runBatched ?? RUN_UNBATCHED` and `batchCalls`
    //   stays 0.
    const dispatcher = makeDispatcher();
    // `delete_task` THROWS when the dispatcher reports not-found, so a default
    // `false` would make both rows fail and this test would still pass — for
    // the wrong reason. Succeed, so the counts below describe real writes.
    vi.mocked(dispatcher.deleteTask).mockReturnValue(true);
    let batchCalls = 0;
    let deletesAtStart = -1;
    let deletesAtEnd = -1;
    const runBatched = async <T,>(fn: () => Promise<T>): Promise<T> => {
      batchCalls += 1;
      deletesAtStart = vi.mocked(dispatcher.deleteTask).mock.calls.length;
      const out = await fn();
      deletesAtEnd = vi.mocked(dispatcher.deleteTask).mock.calls.length;
      return out;
    };

    scriptFetch(
      [
        toolTurn([
          { type: "tool_use", id: "t1", name: "delete_task", input: { id: 1 } },
          { type: "tool_use", id: "t2", name: "delete_task", input: { id: 2 } },
        ]),
        doneTurn("ok"),
      ],
      [],
    );

    render(
      <ChatPanel
        lang="en-US"
        ai={AI_WITH_KEY}
        dispatcher={dispatcher}
        onAcceptConsent={vi.fn()}
        runBatched={runBatched}
      />,
    );
    send();

    const card = await screen.findByRole("region", CARD);
    await screen.findByText("ok"); // let the send settle before interacting
    expect(dispatcher.deleteTask).not.toHaveBeenCalled();
    fireEvent.click(within(card).getByRole("button", { name: /^Apply \(/ }));

    await waitFor(() => expect(batchCalls).toBe(1));
    // Every write happened between the batch opening and closing — none leaked
    // outside it, which is what makes the collapse cover the whole plan.
    expect(deletesAtStart).toBe(0);
    expect(deletesAtEnd).toBe(2);
  });

  it("marks the row that did not land, and unticks the ones that did", async () => {
    // ★★★ THE CARD MUST NOT CLAIM SUCCESS FOR A ROW THAT DID NOT WRITE. Row 1
    //   succeeds, row 2 throws (`delete_task` throws on not-found). Mutant:
    //   `selected: failed` → `selected: prev.selected` and the succeeded row
    //   stays ticked, offering a second Apply that would re-run a landed write;
    //   mutant: drop `failed` and the refused row reads as applied.
    const dispatcher = makeDispatcher();
    vi.mocked(dispatcher.deleteTask).mockImplementation((id: number) => id === 1);
    scriptFetch(
      [
        toolTurn([
          { type: "tool_use", id: "t1", name: "delete_task", input: { id: 1 } },
          { type: "tool_use", id: "t2", name: "delete_task", input: { id: 2 } },
        ]),
        doneTurn("ok"),
      ],
      [],
    );

    render(
      <ChatPanel lang="en-US" ai={AI_WITH_KEY} dispatcher={dispatcher} onAcceptConsent={vi.fn()} />,
    );
    send();

    const card = await screen.findByRole("region", CARD);
    await screen.findByText("ok"); // let the send settle before interacting
    fireEvent.click(within(card).getByRole("button", { name: /^Apply \(/ }));

    // Matched by regex, not by the literal string: `chatProposalFailed` carries
    // an EM DASH, and a copied-out literal that lost it would fail for a reason
    // that has nothing to do with the behaviour under test.
    await waitFor(() => expect(within(card).getByText(/^Not applied/)).toBeInTheDocument());
    // Exactly one row is flagged — the other genuinely wrote.
    expect(within(card).getAllByText(/^Not applied/)).toHaveLength(1);
    const boxes = within(card).getAllByRole("checkbox");
    expect(boxes[0]).not.toBeChecked(); // landed → cannot be re-applied
    expect(boxes[1]).toBeChecked(); // refused → still offered for retry
  });

  it("deselecting a create cascades to the row that depends on it", async () => {
    // The update names the id the create will mint, so `buildPlanRows` links
    // row 1 → row 0. Mutant: replace `cascadeDeselect(...)` with a plain
    // set-minus and row 1 stays checked and enabled — it would then be applied
    // at a provisional id whose row is never created.
    const provisional = peekMintId("task", []);
    scriptFetch(
      [
        toolTurn([
          { type: "tool_use", id: "t1", name: "create_task", input: NEW_TASK },
          {
            type: "tool_use",
            id: "t2",
            name: "update_task",
            input: { id: provisional, assignee: "you" },
          },
        ]),
        doneTurn("ok"),
      ],
      [],
    );

    render(
      <ChatPanel
        lang="en-US"
        ai={AI_WITH_KEY}
        dispatcher={makeDispatcher()}
        onAcceptConsent={vi.fn()}
      />,
    );
    send();

    const card = await screen.findByRole("region", CARD);
    expect(within(card).getAllByRole("checkbox")).toHaveLength(2);
    expect(within(card).getAllByRole("checkbox")[1]).toBeChecked();

    fireEvent.click(within(card).getAllByRole("checkbox")[0]);

    await waitFor(() =>
      expect(within(card).getAllByRole("checkbox")[1]).not.toBeChecked(),
    );
    // Disabled as well as unchecked: re-ticking it alone would send a write at
    // a provisional id (see `isCascadedRow`).
    expect(within(card).getAllByRole("checkbox")[1]).toBeDisabled();
  });

  it("a project switch clears a pending proposal, even when the transcript comes back", async () => {
    // ★★★ NON-VACUOUS ONLY BECAUSE THE STORE RESTORES THE MARKER. Without
    //   `getChatConversation`, switching away empties `display` outright and the
    //   card cannot render whether or not the plan was cleared — the obvious
    //   version of this test passes with `setPendingProposal(null)` DELETED.
    //   Here p1's transcript (and its marker) comes back, so the card would
    //   render again if the plan had survived.
    const store = new Map<string, ChatConversation>();
    const base = {
      lang: "en-US" as const,
      ai: AI_WITH_KEY,
      dispatcher: makeDispatcher(),
      onAcceptConsent: vi.fn(),
      getChatConversation: (id: string) => store.get(id),
      saveChatConversation: (id: string, conv: ChatConversation) => {
        store.set(id, conv);
      },
    };
    scriptFetch(
      [
        toolTurn([{ type: "tool_use", id: "t1", name: "delete_all_tasks", input: {} }]),
        doneTurn("ok"),
      ],
      [],
    );

    const { rerender } = render(<ChatPanel {...base} projectId="p1" />);
    send();
    await screen.findByRole("region", CARD);
    // Let the send settle before switching, so its trailing writes cannot race
    // the reconcile and make this test order-dependent.
    await screen.findByText("ok");

    await act(async () => {
      rerender(<ChatPanel {...base} projectId="p2" />);
    });
    expect(screen.queryByRole("region", CARD)).toBeNull();

    await act(async () => {
      rerender(<ChatPanel {...base} projectId="p1" />);
    });
    // The marker returned...
    expect(screen.getByText("This proposal is no longer active.")).toBeInTheDocument();
    // ...and it is NOT an applyable card.
    expect(screen.queryByRole("region", CARD)).toBeNull();
  });

  it("a restored transcript's marker renders expired, never an applyable plan", () => {
    // The persistence decision, stated as a test: the MARKER is persisted and
    // the plan is not, so a conversation restored from the store (or, in Turso
    // mode, from a thread row) can never offer to apply writes staged against a
    // workspace that has since moved. Mutant: put the described rows on the
    // DisplayItem and render from those — this goes red.
    const stored: ChatConversation = {
      history: [],
      display: [{ kind: "proposal", id: "from-a-previous-session", count: 3 }],
    };
    render(
      <ChatPanel
        lang="en-US"
        ai={AI_WITH_KEY}
        dispatcher={makeDispatcher()}
        onAcceptConsent={vi.fn()}
        projectId="p1"
        getChatConversation={() => stored}
      />,
    );
    expect(screen.getByText("This proposal is no longer active.")).toBeInTheDocument();
    expect(screen.queryByRole("region", CARD)).toBeNull();
  });
});
