import "fake-indexeddb/auto";
import "../test/ai-consent-live";
import { newConsent, publishAiConsentState } from "./ai-consent";
import { asTimeZoneForTests } from "./timezone";
import { act, render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { __resetAiKeyStatusForTests, getAiKeyStatus, syncAiKey } from "./ai-key-status";
import { clearSessionAiKey } from "./session-ai-key";
import { setAiDeploymentState } from "./ai-deployment";
import { __setAiStatusRequestForTests } from "./ai-status-request";
import { answerAiStatusDirect, DIRECT_AI_STATUS } from "../test/ai-status-fetch";
// §717 — an unlocked key lives in a page-wide store now, not in one panel: forget it after every test.
afterEach(() => { clearSessionAiKey(); });
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ChatPanel } from "./chat-panel";
import { ATTACHMENT_ACCEPT } from "./chat-attachments";
import { MAX_NODE_EXTRACT_CHARS } from "./attachment-ingest";
import { buildCfbf } from "./__fixtures__/cfbf-writer";
import { loadThreads, saveThread } from "./chat-threads-store";
import { fitHistoryToBudget, type ChatThread } from "./chat-threads";
import { t } from "./i18n";
import { buildSystemPrompt, INTERRUPTED_TOOL_RESULT, systemBlocksText } from "./chat-api";
import { appliedProposalNotice, PROPOSAL_PENDING_RESULT } from "./chat-proposal-stage";
import type { ToolDispatcher } from "./chat-tools";
import type { AppView } from "./nav-config";
import { defaultAiConfig as baseAiConfig } from "./settings-types";
import type { OperatingGuide } from "./operating-guide";
import type { FeatureModuleId } from "./feature-modules";
import { emptyWorkspace, type Workspace } from "./workspace";
import { saveSealed } from "./secrets-store";
import { sealPassphrase } from "./secrets";
import { peekMintId } from "./id-mint-session";
import { entityToken } from "./ai-entity-token";
import type { Task } from "./types";
import type { UndoBatch } from "./use-undo-batch";
import type { ChatConversation } from "./workspace-tab-context";
import { useAiUsageContext } from "./ai-usage-context";
import type { SendFingerprint } from "./ai-view-switch";

// §548/§596 — `ChatPanel`'s two scope readers are REQUIRED props (see
// `ChatScopeProps` in chat-panel.tsx: an optional one degrades silently, which is
// the whole defect). Nothing in THIS file exercises a project swap, so every mount
// here gets the inert pair: a frozen epoch and "no swap in flight". Spread FIRST at
// each site so a test that cares can still override it after the spread.
// ★ The scope behaviour itself lives in `chat-panel.scope.test.tsx`, which passes
//   its own readers — do not add scope tests here.
const SCOPE_PROPS = { getScopeEpoch: () => 0, isSwapInFlight: () => false };

// Force the dictation mic to be "supported" so useDictationMic renders the
// button (mirrors note-log-panel.test.tsx / task-form-fields.dictation.test.tsx
// — jsdom has no SpeechRecognition ctor, so getCtor() is null and the button
// is normally suppressed).
// Pass-through spy: lets a test read what history each send handed to the budget trim.
vi.mock("./chat-threads", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./chat-threads")>();
  return { ...actual, fitHistoryToBudget: vi.fn(actual.fitHistoryToBudget) };
});

vi.mock("./chat-threads-store", () => ({
  loadThreads: vi.fn(async () => []),
  saveThread: vi.fn(async () => undefined),
  deleteThread: vi.fn(async () => undefined),
}));

// Default double of the shared usage context — no-op `recordChatSend` and
// `noteUnbilledChatSend`, matching the real context's own default value
// (chat-panel is rendered directly in this file with no <AiUsageProvider>, so
// it was already reading that default). Token usage is not the panel's to
// record (the transport's tap does it). Individual tests override the return
// value to spy on `recordChatSend`.
//
// Hoisted (vi.hoisted) so this object can be shared between the factory below
// and the per-test beforeEach in the "cache-token usage recording" describe
// block: vi.mock(...) calls are hoisted above ordinary top-level statements,
// so a factory referencing a plain module-scope `const` declared later in
// this file would hit it before that const is initialized (a TDZ
// ReferenceError) — vi.hoisted() is vitest's sanctioned way around that.
const { DEFAULT_AI_USAGE_CONTEXT } = vi.hoisted(() => ({
  DEFAULT_AI_USAGE_CONTEXT: {
    sessionTotal: 0,
    sessionUsage: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 },
    weekTotal: 0,
    nextReset: new Date(),
    weekByFeature: [],
    backgroundWeekCost: 0,
    weekHardCapReached: false,
    viewSwitchWeek: { sends: 0, requests: 0, switches: 0, warmSends: 0, switchCacheWrite: 0, warmCacheWrite: 0 },
    recordChatSend: vi.fn(),
    noteUnbilledChatSend: vi.fn(),
  },
}));

vi.mock("./ai-usage-context", () => ({
  useAiUsageContext: vi.fn(() => DEFAULT_AI_USAGE_CONTEXT),
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
  consent: newConsent(new Date(0)),
  apiKey: "sk-test",
};

describe("Without a current AI consent", () => {
  // The consent form no longer lives in the chat: Settings → AI asks (ai-consent-dialog.test.tsx).
  it("an enabled switch with a stale disclosure shows the review prompt and the configure button, and no consent form", () => {
    const onConfigureAi = vi.fn();
    render(
      <ChatPanel {...SCOPE_PROPS}
        lang="en-US"
        ai={{ ...defaultAiConfig, consent: undefined, apiKey: "sk-test" }}
        dispatcher={makeDispatcher()}
        onConfigureAi={onConfigureAi}
      />,
    );
    expect(screen.getByText(t("en-US", "aiConsentReviewPrompt"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "chatConfigureAi") }));
    expect(onConfigureAi).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: /I understand/i })).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("a persisted transcript does not hide why the chat is off: the prompt and configure button show once, the composer is disabled", () => {
    const onConfigureAi = vi.fn();
    render(
      <ChatPanel {...SCOPE_PROPS}
        lang="en-US"
        ai={{ ...defaultAiConfig, consent: undefined, apiKey: "sk-test" }}
        dispatcher={makeDispatcher()}
        projectId="p1"
        getChatConversation={() => ({
          history: [{ role: "user", content: "earlier question" }],
          display: [{ kind: "user", text: "earlier question" }],
        })}
        onConfigureAi={onConfigureAi}
      />,
    );
    // Positive control: the transcript really is on screen, so this is not the empty state.
    expect(screen.getByText("earlier question")).toBeInTheDocument();
    expect(screen.getAllByText(t("en-US", "aiConsentReviewPrompt"))).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "chatConfigureAi") }));
    expect(onConfigureAi).toHaveBeenCalledTimes(1);
    expect(screen.getByPlaceholderText("Ask Claude about your tasks…")).toBeDisabled();
  });

  it("the master switch off shows the no-key empty state, not the review prompt", () => {
    render(
      <ChatPanel {...SCOPE_PROPS}
        lang="en-US"
        ai={{ ...defaultAiConfig, enabled: false, consent: undefined }}
        dispatcher={makeDispatcher()}
        onConfigureAi={vi.fn()}
      />,
    );
    expect(screen.getByText(t("en-US", "chatNoApiKey"))).toBeInTheDocument();
    expect(screen.queryByText(t("en-US", "aiConsentReviewPrompt"))).toBeNull();
  });

  it("a deployment with AI off leaves the composer in the AI-disabled state", () => {
    setAiDeploymentState({ off: true, route: "direct", invalid: false });
    try {
      render(<ChatPanel {...SCOPE_PROPS} lang="en-US" ai={AI_WITH_KEY} dispatcher={makeDispatcher()} onConfigureAi={vi.fn()} />);
      expect(screen.getByText(t("en-US", "aiDeploymentOff"))).toBeInTheDocument();
      expect(screen.getByPlaceholderText("Ask Claude about your tasks…")).toBeDisabled();
    } finally {
      setAiDeploymentState(DIRECT_AI_STATUS);
    }
  });

  // The organisation switched AI off: no key or consent the user could supply would turn it on.
  it("a deployment with AI off says so instead of asking for a key", () => {
    setAiDeploymentState({ off: true, route: "direct", invalid: false });
    try {
      render(<ChatPanel {...SCOPE_PROPS} lang="en-US" ai={{ ...defaultAiConfig, apiKey: "" }} dispatcher={makeDispatcher()} onConfigureAi={vi.fn()} />);
      expect(screen.getByText(t("en-US", "aiDeploymentOff"))).toBeInTheDocument();
      expect(screen.queryByText(t("en-US", "chatNoApiKey"))).toBeNull();
      expect(screen.queryByRole("button", { name: t("en-US", "chatConfigureAi") })).toBeNull();
    } finally {
      setAiDeploymentState(DIRECT_AI_STATUS);
    }
  });

  it.each([
    ["off", { off: true, route: "direct", invalid: false }, "aiDeploymentOff"],
    ["invalid", { off: false, route: "gateway", invalid: true }, "aiDeploymentInvalid"],
  ] as const)("a deployment %s with a conversation on screen names it beside the disabled composer, with no consent banner", (_n, state, key) => {
    setAiDeploymentState(state);
    try {
      render(
        <ChatPanel {...SCOPE_PROPS}
          lang="en-US"
          ai={{ ...defaultAiConfig, consent: undefined, apiKey: "sk-test" }}
          dispatcher={makeDispatcher()}
          projectId="p1"
          getChatConversation={() => ({
            history: [{ role: "user", content: "earlier question" }],
            display: [{ kind: "user", text: "earlier question" }],
          })}
          onConfigureAi={vi.fn()}
        />,
      );
      // Positive control: the transcript is on screen, so this is not the empty state.
      expect(screen.getByText("earlier question")).toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent(t("en-US", key));
      expect(screen.queryByText(t("en-US", "aiConsentReviewPrompt"))).toBeNull();
      expect(screen.queryByRole("button", { name: t("en-US", "chatConfigureAi") })).toBeNull();
      expect(screen.getByPlaceholderText("Ask Claude about your tasks…")).toBeDisabled();
    } finally {
      setAiDeploymentState(DIRECT_AI_STATUS);
    }
  });

  it("an invalid gateway setting names the invalid setting in the empty state", () => {
    setAiDeploymentState({ off: false, route: "gateway", invalid: true });
    try {
      render(<ChatPanel {...SCOPE_PROPS} lang="en-US" ai={AI_WITH_KEY} dispatcher={makeDispatcher()} onConfigureAi={vi.fn()} />);
      expect(screen.getByText(t("en-US", "aiDeploymentInvalid"))).toBeInTheDocument();
      expect(screen.queryByText(t("en-US", "chatNoApiKey"))).toBeNull();
      expect(screen.queryByRole("button", { name: t("en-US", "chatConfigureAi") })).toBeNull();
    } finally {
      setAiDeploymentState(DIRECT_AI_STATUS);
    }
  });

  it.each([
    ["the empty state", false],
    ["the banner beside a transcript", true],
  ] as const)("the disabled composer is described by the deployment notice in %s", (_where, withTranscript) => {
    setAiDeploymentState({ off: true, route: "direct", invalid: false });
    try {
      render(
        <ChatPanel {...SCOPE_PROPS}
          lang="en-US"
          ai={AI_WITH_KEY}
          dispatcher={makeDispatcher()}
          projectId="p1"
          getChatConversation={withTranscript ? () => ({
            history: [{ role: "user", content: "earlier question" }],
            display: [{ kind: "user", text: "earlier question" }],
          }) : undefined}
          onConfigureAi={vi.fn()}
        />,
      );
      if (withTranscript) expect(screen.getByText("earlier question")).toBeInTheDocument();
      const box = screen.getByPlaceholderText("Ask Claude about your tasks…");
      const send = screen.getByRole("button", { name: t("en-US", "chatSend") });
      for (const control of [box, send]) {
        expect(control).toBeDisabled();
        const id = control.getAttribute("aria-describedby");
        expect(id).toBeTruthy();
        expect(document.getElementById(id ?? "")).toHaveTextContent(t("en-US", "aiDeploymentOff"));
      }
    } finally {
      setAiDeploymentState(DIRECT_AI_STATUS);
    }
  });

  it("an AI-on composer carries no deployment description (control)", () => {
    render(<ChatPanel {...SCOPE_PROPS} lang="en-US" ai={AI_WITH_KEY} dispatcher={makeDispatcher()} onConfigureAi={vi.fn()} />);
    expect(screen.getByPlaceholderText("Ask Claude about your tasks…")).not.toHaveAttribute("aria-describedby");
    expect(screen.getByRole("button", { name: t("en-US", "chatSend") })).not.toHaveAttribute("aria-describedby");
  });

  it("a deployment with AI off shows no consent review banner for a stale consent", () => {
    setAiDeploymentState({ off: true, route: "direct", invalid: false });
    try {
      render(<ChatPanel {...SCOPE_PROPS} lang="en-US" ai={{ ...defaultAiConfig, consent: undefined, apiKey: "sk-test" }} dispatcher={makeDispatcher()} onConfigureAi={vi.fn()} />);
      // Positive control: the deployment message is on screen.
      expect(screen.getByText(t("en-US", "aiDeploymentOff"))).toBeInTheDocument();
      expect(screen.queryByText(t("en-US", "aiConsentReviewPrompt"))).toBeNull();
      expect(screen.queryByRole("button", { name: t("en-US", "chatConfigureAi") })).toBeNull();
    } finally {
      setAiDeploymentState(DIRECT_AI_STATUS);
    }
  });

  // M3 — one neutral message for both causes: the published flag the request path reads is off after a withdrawn
  // consent and after a switch-off alike, so the message cannot name only one of them.
  it.each([
    ["consent was withdrawn", { ...AI_WITH_KEY, enabled: true, consent: undefined }],
    ["AI was switched off", { ...AI_WITH_KEY, enabled: false }],
  ])("a send stopped because %s names both causes and sends nothing", async (_cause, published) => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(
      <ChatPanel {...SCOPE_PROPS} lang="en-US" ai={AI_WITH_KEY} dispatcher={makeDispatcher()} />,
    );
    // The props still carry a consent; the PUBLISHED state (what the request path reads) no longer allows a send.
    publishAiConsentState(published);
    try {
      fireEvent.change(screen.getByPlaceholderText("Ask Claude about your tasks…"), { target: { value: "hi" } });
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
      await screen.findByText("AI was switched off or its consent was withdrawn, so the request was stopped.");
      expect(screen.queryByText(/AI consent was revoked/)).toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      // Back to what ../test/ai-consent-live published (the published flag needs the switch on).
      publishAiConsentState({ ...AI_WITH_KEY, enabled: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Attachment guidance (audit #47)
// ---------------------------------------------------------------------------
describe("Attachment guidance", () => {
  afterEach(() => vi.restoreAllMocks());

  function renderComposer() {
    return render(
      <ChatPanel {...SCOPE_PROPS}
        lang="en-US"
        ai={AI_WITH_KEY}
        dispatcher={makeDispatcher()}
      />,
    );
  }

  it("shows the accepted-types + size hint up front", () => {
    renderComposer();
    expect(
      screen.getByText(/Attach or drop one or more files.*up to 20 MB/i),
    ).toBeInTheDocument();
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

  // §47: the input used to be display:none (Tailwind `hidden`), which some
  // browsers refuse to open a file picker for — §15's rule, which the other
  // file-picker sites (file-picker-button.tsx) already follow via `sr-only`.
  // ★ jsdom applies no CSS, so this pins the CLASS CONTRACT only — it cannot
  // reproduce the browser's refusal-to-open behaviour itself.
  it("uses sr-only, not display:none, for the attachment input", () => {
    const { container } = renderComposer();
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input.className).toContain("sr-only");
    expect(input.className).not.toContain("hidden");
  });

  it("forwards the attach button click to the input", async () => {
    const user = userEvent.setup();
    const { container } = renderComposer();
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const click = vi.spyOn(input, "click");
    await user.click(screen.getByRole("button", { name: t("en-US", "chatAttach") }));
    expect(click).toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // Multi-file caps + drag-and-drop (json-import-multi-attach-demo-refresh, task 3)
  // ---------------------------------------------------------------------------
  function pick(container: HTMLElement, files: File[]) {
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files } });
  }
  const txt = (name: string, body = "hello") => new File([body], name, { type: "text/plain" });

  it("stages every valid file from one pick as its own chip", async () => {
    const { container } = renderComposer();
    pick(container, [txt("a.txt"), txt("b.md"), new File(["{}"], "c.json", { type: "application/json" })]);
    for (const n of ["a.txt", "b.md", "c.json"]) {
      expect(await screen.findByRole("button", { name: `Remove ${n}` })).toBeInTheDocument();
    }
  });

  it("stages at most 10 and names every file past the cap", async () => {
    const { container } = renderComposer();
    pick(container, Array.from({ length: 12 }, (_, i) => txt(`f${i}.txt`)));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("f10.txt");
    expect(alert.textContent).toContain("f11.txt");
    expect(alert.textContent).not.toContain("f9.txt");
    expect(screen.getAllByRole("button", { name: /^Remove f\d+\.txt$/ })).toHaveLength(10);
  });

  it("counts already-staged files toward the cap across two picks", async () => {
    const { container } = renderComposer();
    pick(container, Array.from({ length: 9 }, (_, i) => txt(`a${i}.txt`)));
    await screen.findByRole("button", { name: "Remove a8.txt" });
    pick(container, [txt("b0.txt"), txt("b1.txt")]);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("b1.txt");
    expect(screen.getByRole("button", { name: "Remove b0.txt" })).toBeInTheDocument();
  });

  // open-followups §359 — the whole-batch text ceiling. Each text file's block
  // is capped at MAX_NODE_EXTRACT_CHARS by ingest, so seven large files cannot
  // all fit under MAX_BATCH_TEXT_CHARS; the last one is named and not staged.
  it("skips and names a file that would push the batch past the text ceiling", async () => {
    const { container } = renderComposer();
    const big = "x".repeat(MAX_NODE_EXTRACT_CHARS + 1000);
    pick(container, Array.from({ length: 7 }, (_, i) => txt(`big${i}.txt`, big)));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(t("en-US", "chatAttachmentOverBatchLimit", "big6.txt"));
    expect(screen.queryByRole("button", { name: "Remove big6.txt" })).toBeNull();
    expect(screen.getByRole("button", { name: "Remove big0.txt" })).toBeInTheDocument();
  });

  it("stages dropped files exactly like picked ones", async () => {
    const { container } = renderComposer();
    const target = container.firstElementChild as HTMLElement;
    fireEvent.drop(target, { dataTransfer: { types: ["Files"], files: [txt("dropped.txt")] } });
    expect(await screen.findByRole("button", { name: "Remove dropped.txt" })).toBeInTheDocument();
  });

  // A text or link drag has no "Files" type. The pane root used to cancel
  // EVERY drag, so selected text dropped on the composer textarea vanished.
  // ★ `fireEvent` returns false exactly when a handler called preventDefault,
  // which is the observable the browser uses to decide whether its own
  // default (inserting the text) runs.
  it("lets a text drag through to the composer instead of cancelling it", async () => {
    const { container } = renderComposer();
    const target = container.firstElementChild as HTMLElement;
    const dt = { types: ["text/plain", "text/uri-list"], files: [] };
    expect(fireEvent.dragOver(target, { dataTransfer: dt })).toBe(true);
    expect(fireEvent.drop(target, { dataTransfer: dt })).toBe(true);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(screen.queryAllByRole("button", { name: /^Remove / })).toHaveLength(0);
  });

  it("still claims a file drag (dragover and drop are cancelled)", () => {
    const { container } = renderComposer();
    const target = container.firstElementChild as HTMLElement;
    const dt = { types: ["Files"], files: [txt("claimed.txt")] };
    expect(fireEvent.dragOver(target, { dataTransfer: dt })).toBe(false);
    expect(fireEvent.drop(target, { dataTransfer: dt })).toBe(false);
  });

  // Two picks fired back-to-back, neither awaited: each reads its files
  // before planning, so the second plans BEFORE React re-renders the first's
  // chips. It must still see the first pick's staged set through the ref.
  it("caps two overlapping picks at 10 in total", async () => {
    const { container } = renderComposer();
    pick(container, Array.from({ length: 6 }, (_, i) => txt(`p${i}.txt`)));
    pick(container, Array.from({ length: 6 }, (_, i) => txt(`q${i}.txt`)));
    await screen.findByRole("button", { name: "Remove q0.txt" });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(screen.getAllByRole("button", { name: /^Remove [pq]\d\.txt$/ })).toHaveLength(10);
    expect(screen.getByRole("alert").textContent).toContain("q5.txt");
  });

  // No dedicated "API key missing" test fixture exists in this file (grepped
  // `apiKeyMissing` / `AI_WITHOUT_KEY`) — reuse the `guidesReady gate`
  // describe block's own mechanism (groundInGuides + guidesReady=false) to
  // reach `attachDisabled`, rather than skip drop-guard coverage entirely.
  it("does not stage a dropped file while the composer is disabled (guides pending)", async () => {
    const { container } = render(
      <ChatPanel {...SCOPE_PROPS}
        lang="en-US"
        ai={{ ...AI_WITH_KEY, groundInGuides: true }}
        dispatcher={makeDispatcher()}
        guidesReady={false}
      />,
    );
    const target = container.firstElementChild as HTMLElement;
    fireEvent.drop(target, { dataTransfer: { types: ["Files"], files: [txt("blocked.txt")] } });
    // handleFiles is async (ingestFile awaits file.arrayBuffer()) — a
    // synchronous check here would pass whether the onDrop guard blocked the
    // drop OR the async chain simply had not resolved yet, which is vacuous
    // (fix-round-1: a mutant that deletes only the guard line, leaving
    // onDrop/handleFiles intact, stayed green against the old synchronous
    // assertion). Flush real timers first so any staging that WOULD happen
    // has actually happened before asserting its absence.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(screen.queryByRole("button", { name: "Remove blocked.txt" })).toBeNull();
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
      <ChatPanel {...SCOPE_PROPS}
        lang="en-US"
        ai={AI_WITH_KEY}
        dispatcher={makeDispatcher()}
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
      <ChatPanel {...SCOPE_PROPS}
        lang="en-US"
        ai={AI_WITH_KEY}
        dispatcher={makeDispatcher()}
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
      <ChatPanel {...SCOPE_PROPS} lang="en-US" ai={AI_WITH_KEY} dispatcher={makeDispatcher()} />,
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
      <ChatPanel {...SCOPE_PROPS} lang="en-US" ai={AI_WITH_KEY} dispatcher={makeDispatcher()} />,
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
      <ChatPanel {...SCOPE_PROPS} lang="en-US" ai={AI_WITH_KEY} dispatcher={makeDispatcher()} />,
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
      <ChatPanel {...SCOPE_PROPS}
        lang="en-US"
        ai={AI_WITH_KEY}
        dispatcher={makeDispatcher()}
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
      <ChatPanel {...SCOPE_PROPS}
        lang="en-US"
        ai={AI_WITH_KEY}
        dispatcher={makeDispatcher()}
        chatSeed={{ prompt: "Summarize risks", autoSend: false, originView: "dashboard" }}
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

  it("adds a prefill after a draft the user is typing, never replacing it (§519)", () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(jsonResponse);
    const props = { ...SCOPE_PROPS, lang: "en-US" as const, ai: AI_WITH_KEY, dispatcher: makeDispatcher(), onChatSeedConsumed: vi.fn() };
    const { rerender } = render(<ChatPanel {...props} chatSeed={null} />);
    const textarea = screen.getByPlaceholderText("Ask Claude about your tasks…") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "half-typed question" } });
    rerender(<ChatPanel {...props} chatSeed={{ prompt: "Plan the kickoff", autoSend: false, originView: "dashboard" }} />);
    expect(textarea.value).toBe("half-typed question\nPlan the kickoff");
  });

  it("applies a prefill present at mount once, under StrictMode's double effect run", () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(jsonResponse);
    render(
      <ChatPanel {...SCOPE_PROPS} lang="en-US" ai={AI_WITH_KEY} dispatcher={makeDispatcher()}
        chatSeed={{ prompt: "Plan the kickoff", autoSend: false, originView: "dashboard" }} onChatSeedConsumed={vi.fn()} />,
      { reactStrictMode: true },
    );
    expect((screen.getByPlaceholderText("Ask Claude about your tasks…") as HTMLTextAreaElement).value).toBe("Plan the kickoff");
  });

  it("auto-sends the seed when autoSend is true and the key is present, naming the page it came from (§703)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(jsonResponse);
    const onChatSeedConsumed = vi.fn();
    const dispatcher = makeDispatcher();
    render(
      <ChatPanel {...SCOPE_PROPS}
        lang="en-US"
        ai={AI_WITH_KEY}
        dispatcher={dispatcher}
        chatSeed={{ prompt: "What's next?", autoSend: true, originView: "dashboard" }}
        onChatSeedConsumed={onChatSeedConsumed}
      />,
    );
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    expect(onChatSeedConsumed).toHaveBeenCalledTimes(1);
    expect(dispatcher.getSnapshot).toHaveBeenCalledWith({ originView: "dashboard" });
  });

  // §703: a seed the send gate only PREFILLS keeps the page it was requested
  // from, and the user's later send of that text, unchanged, names it.
  describe("a prefilled seed sent later", () => {
    const GUIDES_AI = { ...AI_WITH_KEY, groundInGuides: true };
    const seed = { prompt: "What's next?", autoSend: true, originView: "dashboard" as const };
    function sendBox() {
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
    }

    it("names the page when the seed waited for the guides and is sent unchanged", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(jsonResponse);
      const dispatcher = makeDispatcher();
      const props = { ...SCOPE_PROPS, lang: "en-US" as const, ai: GUIDES_AI, dispatcher, onChatSeedConsumed: vi.fn(), chatSeed: seed };
      const { rerender } = render(<ChatPanel {...props} guidesReady={false} />);
      expect(fetchSpy).not.toHaveBeenCalled();
      rerender(<ChatPanel {...props} guidesReady />);
      sendBox();
      await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
      expect(dispatcher.getSnapshot).toHaveBeenLastCalledWith({ originView: "dashboard" });
    });

    it("names the page for a prefill-only seed sent unchanged", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(jsonResponse);
      const dispatcher = makeDispatcher();
      render(
        <ChatPanel {...SCOPE_PROPS} lang="en-US" ai={AI_WITH_KEY} dispatcher={dispatcher}
          chatSeed={{ ...seed, autoSend: false, originView: "gantt" }} onChatSeedConsumed={vi.fn()} />,
      );
      sendBox();
      await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
      expect(dispatcher.getSnapshot).toHaveBeenLastCalledWith({ originView: "gantt" });
    });

    it("sends an edited prefill as a typed message, with no page", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(jsonResponse);
      const dispatcher = makeDispatcher();
      render(
        <ChatPanel {...SCOPE_PROPS} lang="en-US" ai={AI_WITH_KEY} dispatcher={dispatcher}
          chatSeed={{ ...seed, autoSend: false }} onChatSeedConsumed={vi.fn()} />,
      );
      fireEvent.change(screen.getByPlaceholderText("Ask Claude about your tasks…"), { target: { value: "What's next for me?" } });
      sendBox();
      await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
      expect(dispatcher.getSnapshot).toHaveBeenLastCalledWith({ originView: undefined });
    });

    // No edit happens here: the box holds the draft and the seed together, so
    // only the text match keeps this a typed message.
    it("sends a seed appended after a draft as a typed message, with no page", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(jsonResponse);
      const dispatcher = makeDispatcher();
      const props = { ...SCOPE_PROPS, lang: "en-US" as const, ai: AI_WITH_KEY, dispatcher, onChatSeedConsumed: vi.fn() };
      const { rerender } = render(<ChatPanel {...props} chatSeed={null} />);
      fireEvent.change(screen.getByPlaceholderText("Ask Claude about your tasks…"), { target: { value: "my draft" } });
      rerender(<ChatPanel {...props} chatSeed={{ ...seed, autoSend: false }} />);
      sendBox();
      await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
      expect(dispatcher.getSnapshot).toHaveBeenLastCalledWith({ originView: undefined });
    });

    it("drops the page once the box is edited, even if the text is typed back", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(jsonResponse);
      const dispatcher = makeDispatcher();
      render(
        <ChatPanel {...SCOPE_PROPS} lang="en-US" ai={AI_WITH_KEY} dispatcher={dispatcher}
          chatSeed={{ ...seed, autoSend: false }} onChatSeedConsumed={vi.fn()} />,
      );
      const box = screen.getByPlaceholderText("Ask Claude about your tasks…");
      fireEvent.change(box, { target: { value: "" } });
      fireEvent.change(box, { target: { value: "What's next?" } });
      sendBox();
      await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
      expect(dispatcher.getSnapshot).toHaveBeenLastCalledWith({ originView: undefined });
    });

    // ★ The keydown on a disabled box is not a user path, but the same early return is: an
    //   auto-send chip stays enabled while guides load or a send is in flight, and its click
    //   returns early with the prefill still pending. This pins that such a send leaves the
    //   page for the real one.
    it("keeps the page through a send that returned early", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(jsonResponse);
      const dispatcher = makeDispatcher();
      const props = { ...SCOPE_PROPS, lang: "en-US" as const, ai: GUIDES_AI, dispatcher, onChatSeedConsumed: vi.fn(), chatSeed: seed };
      const { rerender } = render(<ChatPanel {...props} guidesReady={false} />);
      fireEvent.keyDown(screen.getByPlaceholderText("Loading operating guides…"), { key: "Enter" });
      expect(fetchSpy).not.toHaveBeenCalled();
      rerender(<ChatPanel {...props} guidesReady />);
      sendBox();
      await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
      expect(dispatcher.getSnapshot).toHaveBeenLastCalledWith({ originView: "dashboard" });
    });

    it("drops the page once the project scope has changed", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(jsonResponse);
      const dispatcher = makeDispatcher();
      let epoch = 0;
      render(
        <ChatPanel {...SCOPE_PROPS} getScopeEpoch={() => epoch} lang="en-US" ai={AI_WITH_KEY} dispatcher={dispatcher}
          chatSeed={{ ...seed, autoSend: false }} onChatSeedConsumed={vi.fn()} />,
      );
      epoch = 1;
      sendBox();
      await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
      expect(dispatcher.getSnapshot).toHaveBeenLastCalledWith({ originView: undefined });
    });
  });

  // §703: the request names the page an Ask-Claude press came from, and a
  // `get_app_state` call later in the same send must not contradict it. The
  // stub answers "chat" when no origin is passed, as the real dispatcher does
  // once the chat tab is showing.
  describe("get_app_state inside a send", () => {
    type Block = { type: string; id?: string; name?: string; input?: unknown; text?: string; tool_use_id?: string; content?: unknown };
    function toolTurnFetch(bodies: string[]) {
      const usage = { input_tokens: 1, output_tokens: 1 };
      const turns = [
        { content: [{ type: "tool_use", id: "t1", name: "get_app_state", input: {} }], stop_reason: "tool_use", usage },
        { content: [{ type: "text", text: "done" }], stop_reason: "end_turn", usage },
      ];
      return vi.spyOn(globalThis, "fetch").mockImplementation((_url, init?: RequestInit) => {
        bodies.push(String(init?.body ?? ""));
        const body = turns[Math.min(bodies.length - 1, turns.length - 1)];
        return Promise.resolve({ ok: true, text: () => Promise.resolve(""), json: () => Promise.resolve(body) } as unknown as Response);
      });
    }
    function viewDispatcher(): ToolDispatcher {
      const d = makeDispatcher();
      const base = d.getSnapshot();
      d.getSnapshot = vi.fn((opts?: { originView?: AppView }) => ({ ...base, currentView: opts?.originView ?? ("chat" as const) }));
      return d;
    }
    /** The `currentView` the get_app_state tool result carried in the second request. */
    function toolResultView(body: string): unknown {
      const msgs = (JSON.parse(body) as { messages: { content: unknown }[] }).messages;
      const blocks = msgs.flatMap((m) => (Array.isArray(m.content) ? (m.content as Block[]) : []));
      const result = blocks.find((b) => b.type === "tool_result" && b.tool_use_id === "t1");
      return (JSON.parse(String(result?.content)) as { currentView?: unknown }).currentView;
    }

    it("answers with the page an auto-sent seed came from", async () => {
      const bodies: string[] = [];
      toolTurnFetch(bodies);
      render(
        <ChatPanel {...SCOPE_PROPS} lang="en-US" ai={AI_WITH_KEY} dispatcher={viewDispatcher()}
          chatSeed={{ prompt: "What's next?", autoSend: true, originView: "dashboard" }} onChatSeedConsumed={vi.fn()} />,
      );
      await waitFor(() => expect(screen.getByText("done")).toBeInTheDocument());
      expect(bodies).toHaveLength(2);
      expect(toolResultView(bodies[1])).toBe("dashboard");
    });

    it("answers with the chat tab for a typed message", async () => {
      const bodies: string[] = [];
      toolTurnFetch(bodies);
      render(<ChatPanel {...SCOPE_PROPS} lang="en-US" ai={AI_WITH_KEY} dispatcher={viewDispatcher()} />);
      fireEvent.change(screen.getByPlaceholderText("Ask Claude about your tasks…"), { target: { value: "where am I?" } });
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
      await waitFor(() => expect(screen.getByText("done")).toBeInTheDocument());
      expect(bodies).toHaveLength(2);
      expect(toolResultView(bodies[1])).toBe("chat");
    });
  });

  it("does not auto-send when the api key is missing (seeds input only)", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(jsonResponse);
    const onChatSeedConsumed = vi.fn();
    render(
      <ChatPanel {...SCOPE_PROPS}
        lang="en-US"
        ai={{ ...defaultAiConfig, consent: newConsent(new Date(0)), apiKey: "" }}
        dispatcher={makeDispatcher()}
        chatSeed={{ prompt: "What's next?", autoSend: true, originView: "dashboard" }}
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
      <ChatPanel {...SCOPE_PROPS}
        lang="en-US"
        ai={{ ...defaultAiConfig, consent: newConsent(new Date(0)), apiKey: "sk-test", groundInGuides: true }}
        dispatcher={makeDispatcher()}
        guidesReady={false}
        chatSeed={{ prompt: "What's next?", autoSend: true, originView: "dashboard" }}
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
      <ChatPanel {...SCOPE_PROPS}
        lang="en-US"
        ai={AI_WITH_KEY}
        dispatcher={makeDispatcher()}
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
      <ChatPanel {...SCOPE_PROPS}
        lang="en-US"
        ai={AI_WITH_KEY}
        dispatcher={makeDispatcher()}
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
      <ChatPanel {...SCOPE_PROPS}
        lang="en-US"
        ai={{ ...defaultAiConfig, consent: newConsent(new Date(0)), apiKey: "sk-test" }}
        dispatcher={makeDispatcher()}
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
    // Two blocks: [0] cached always-on stable prefix, [1] uncached volatile
    // turn-context suffix. `guide` here has `scope: {}` (always-on), so it
    // contributes no view-scoped text — `buildStableSystemBlocks` omits that
    // middle block entirely rather than sending it empty, so this fixture
    // never has a THIRD block to skip. This assertion must go red if a
    // view-scoped block reappears unexpectedly, or the split changes shape
    // some other way.
    expect(blocks).toHaveLength(2);
    // Block 0 = cached stable prefix, contains the guide text (`guide` here
    // has `scope: {}`, i.e. it is always-on).
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

  // ★★★ `system` no longer carries the volatile half — Task 7 (the
  //   prompt-cache-layout slice) moved it (APP CONTEXT et al.) off the
  //   `system` array and onto the current user turn, via `buildWireMessages`,
  //   so the `system` array sent over the wire is only ever
  //   `buildStableSystemBlocks`'s output. See the "prompt cache layout
  //   wiring" describe block below for where the relocated volatile half is
  //   now asserted.
  //   ★★ The guide-block cache split (Slice G) then split THAT array further:
  //   block 0 is the view-invariant half and carries the sole `cache_control`
  //   marker `system` gets; a SECOND block for the current view's guide text
  //   is appended ONLY when the view contributes one, and is omitted
  //   entirely otherwise — never sent as an empty string. `ChatPanel` here is
  //   rendered with no `guides` prop (defaults to `[]`), so no view ever
  //   contributes guide text and `system` is a ONE-element array: just block
  //   0, cache-controlled. A fixture WITH guides gets a real second block
  //   instead (see "caches the stable prefix (incl. guide)..." above).
  it("sends system as one block when there is no view-scoped guide, cache-controlled", async () => {
    let rejectFetch!: (reason: unknown) => void;
    const pending = new Promise<Response>((_res, rej) => { rejectFetch = rej; });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockReturnValue(pending);

    render(
      <ChatPanel {...SCOPE_PROPS}
        lang="en-US"
        ai={AI_WITH_KEY}
        dispatcher={makeDispatcher()}
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
    // One block: no `guides` prop was passed to `ChatPanel` (defaults to
    // `[]`), so there is no view-scoped guide text for
    // `buildStableSystemBlocks` to put in a second block, and it omits that
    // block rather than sending it empty.
    expect(body.system).toHaveLength(1);
    expect(body.system[0].cache_control.type).toBe("ephemeral");

    // ★★ Anthropic allows FOUR cache_control breakpoints per request and this
    //    app spends all four: tools 1, system 1, messages 2. Asserted on the
    //    ASSEMBLED request rather than any one layer, because exceeding four
    //    is an API error that no single layer can see coming.
    const markerCount = (JSON.stringify(body).match(/"cache_control"/g) ?? []).length;
    expect(markerCount).toBeLessThanOrEqual(4);

    // Clean up pending fetch.
    const abortError = Object.assign(new Error("Aborted"), { name: "AbortError" });
    rejectFetch(abortError);
  });
});

// ---------------------------------------------------------------------------
// Prompt cache layout wiring (Task 7 of the prompt-cache-layout slice) — the
// volatile turn context moves off `system` and onto the current user turn's
// wire copy, so the transcript sits inside a byte-identical, cacheable prefix.
// ---------------------------------------------------------------------------
describe("prompt cache layout wiring", () => {
  afterEach(() => vi.restoreAllMocks());

  function okResponse(text = "ok") {
    return Promise.resolve({
      ok: true,
      text: () => Promise.resolve(""),
      json: () =>
        Promise.resolve({
          content: [{ type: "text", text }],
          stop_reason: "end_turn",
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
    } as unknown as Response);
  }

  // ★★★ If this ever goes green while the turn context IS persisted, the only
  //     symptom in production is a larger bill. Nothing else changes.
  // ★★ Captured via `saveThread` (the SAME seam the Turso-persistence describe
  //   block above already uses): `saveThread`'s LAST call, fired by the
  //   busy-persist effect once the turn settles, carries the exact `history`
  //   `chat-panel.tsx` committed via `setHistory` — i.e. the persisted array —
  //   so this is the one place that array can be inspected without reaching
  //   into component internals.
  it("never writes the turn context into persisted history", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() => okResponse());
    render(
      <ChatPanel {...SCOPE_PROPS}
        lang="en-US"
        ai={AI_WITH_KEY}
        dispatcher={makeDispatcher()}
        tursoMode={true}
        tursoConfig={{} as never}
      />,
    );
    await waitFor(() => expect(loadThreads).toHaveBeenCalledTimes(1));
    await (loadThreads as unknown as ReturnType<typeof vi.fn>).mock.results[0]!.value;
    fireEvent.change(screen.getByPlaceholderText("Ask Claude about your tasks…"), {
      target: { value: "hi" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    // ★ TWO calls, not one: `ensureThreadForSend` saves a minimal row the
    //   instant the send starts (user turn only, before any turn context
    //   exists) and the busy-persist effect saves again once the turn
    //   SETTLES. Waiting for merely "called" reads the FIRST of the two —
    //   which trivially satisfies the assertions below either way — and
    //   would leave this test unable to see the mutation Step 5 proves it
    //   catches. Wait for the second, settled save specifically.
    await waitFor(() => expect(saveThread).toHaveBeenCalledTimes(2));

    const saved = (saveThread as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)![1] as ChatThread;
    // Positive observable that this really is the settled save, not a false
    // pass off an unrelated empty array (see the repo's absence-tests rule).
    expect(JSON.stringify(saved.history)).toContain("ok");
    const persisted = JSON.stringify(saved.history);
    expect(persisted).not.toContain("APP CONTEXT");
    expect(persisted).not.toContain("Today is");
  });

  // ★★ ASSERTED ON THE REQUEST BODY, NOT A `callClaude` SPY — this file's
  //   established convention (see the "historySearch reaches the request
  //   body" describe block's own comment for the reason): the body is what the
  //   API actually receives, so the assertion cannot pass while the wrong
  //   thing still ships, and it survives a refactor of how the panel reaches
  //   the network.
  it("sends a system array with the guide-cache split, and the context on the turn", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => okResponse());
    render(
      <ChatPanel {...SCOPE_PROPS}
        lang="en-US"
        ai={AI_WITH_KEY}
        dispatcher={makeDispatcher()}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText("Ask Claude about your tasks…"), {
      target: { value: "hi" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));

    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    // One block: no `guides` prop was passed to `ChatPanel` (defaults to
    // `[]`), so there is no view-scoped guide text and
    // `buildStableSystemBlocks` omits that second block rather than sending
    // it empty — see "sends system as one block..." above.
    expect(body.system).toHaveLength(1);
    expect(JSON.stringify(body.system)).not.toContain("APP CONTEXT");
    // …and it did not simply vanish: it must be on the final user message.
    // ★★ THIS IS WHAT STOPS THE ASSERTIONS ABOVE PASSING VACUOUSLY — dropping
    //   the turn context entirely (rather than relocating it) would also
    //   satisfy a one-block `system` and the `not.toContain` above, and would
    //   be a far worse bug than the one being fixed: the model would lose
    //   today's date, the current view and the insight list on every turn.
    expect(JSON.stringify(body.messages[body.messages.length - 1])).toContain("APP CONTEXT");
  });

  // The "one extra check" from the task brief: the API requires a user
  // message's tool_result blocks to LEAD its content, and buildWireMessages
  // appends the turn context AFTER existing blocks for exactly that reason —
  // confirm that holds on a REAL tool-call round trip's second request, not
  // just on `buildWireMessages`'s own unit tests.
  it("keeps tool_result blocks leading and the turn context trailing on the tool-result turn", async () => {
    type Block = { type: string; id?: string; name?: string; input?: unknown; text?: string };
    const usage = { input_tokens: 1, output_tokens: 1 };
    const bodies: string[] = [];
    let call = 0;
    const turns = [
      { content: [{ type: "tool_use", id: "t1", name: "list_tasks", input: {} }] as Block[], stop_reason: "tool_use", usage },
      { content: [{ type: "text", text: "done" }] as Block[], stop_reason: "end_turn", usage },
    ];
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

    render(
      <ChatPanel {...SCOPE_PROPS} lang="en-US" ai={AI_WITH_KEY} dispatcher={makeDispatcher()} />,
    );
    fireEvent.change(screen.getByPlaceholderText("Ask Claude about your tasks…"), {
      target: { value: "list my tasks" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(screen.getByText("done")).toBeInTheDocument());

    expect(bodies).toHaveLength(2);
    const secondBody = JSON.parse(bodies[1]) as { messages: { role: string; content: Block[] }[] };
    const toolResultMsg = secondBody.messages[secondBody.messages.length - 1];
    expect(toolResultMsg.content[0].type).toBe("tool_result");
    const last = toolResultMsg.content[toolResultMsg.content.length - 1];
    expect(last.type).toBe("text");
    expect(last.text).toContain("APP CONTEXT");
  });
});

// ---------------------------------------------------------------------------
// guidesReady gate
// ---------------------------------------------------------------------------
describe("guidesReady gate", () => {
  it("disables send and shows loading placeholder when grounding is on but guides are not ready", () => {
    render(
      <ChatPanel {...SCOPE_PROPS}
        lang="en-US"
        ai={{ ...defaultAiConfig, consent: newConsent(new Date(0)), apiKey: "sk-test", groundInGuides: true }}
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
      <ChatPanel {...SCOPE_PROPS}
        lang="en-US"
        ai={{ ...defaultAiConfig, consent: newConsent(new Date(0)), apiKey: "" }}
        dispatcher={makeDispatcher()}
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
      <ChatPanel {...SCOPE_PROPS}
        lang="en-US"
        ai={AI_WITH_KEY}
        dispatcher={makeDispatcher()}
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

  it("names each Remove apart when two staged attachments share a file name (§316)", async () => {
    const { container } = renderWithKey();
    const a = new File(["first"], "notes.txt", { type: "text/plain" });
    const b = new File(["second"], "notes.txt", { type: "text/plain" });
    fireEvent.change(fileInputOf(container), { target: { files: [a, b] } });
    await waitFor(() => expect(screen.getAllByText("notes.txt")).toHaveLength(2));
    expect(screen.getByRole("button", { name: "Remove notes.txt (1)" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove notes.txt (2)" }));
    // One chip left, and its name is plain again.
    await waitFor(() => expect(screen.getAllByText("notes.txt")).toHaveLength(1));
    expect(screen.getByRole("button", { name: "Remove notes.txt" })).toBeInTheDocument();
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
// History budget wiring (§575): earlier turns' attachments must not blow the
// Messages API's request-size limit. `fitHistoryToBudget` itself is pinned in
// chat-threads.test.ts — this only checks chat-panel actually calls it on the
// outgoing request, and that the STORED (persisted) copy is left untouched.
// ---------------------------------------------------------------------------
describe("history budget wiring (§575)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("placeholders the oldest earlier-turn attachment in the request, never in stored history", async () => {
    const bigDoc = {
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: "x".repeat(20 * 1024 * 1024) },
    } as const;
    const stored: ChatConversation = {
      history: [
        { role: "user", content: [bigDoc] },
        { role: "assistant", content: [{ type: "text", text: "ok" }] },
        { role: "user", content: [bigDoc] },
        { role: "assistant", content: [{ type: "text", text: "ok" }] },
      ],
      display: [
        { kind: "user", text: "first" },
        { kind: "assistant", text: "ok" },
        { kind: "user", text: "second" },
        { kind: "assistant", text: "ok" },
      ],
    };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve({
        ok: true,
        text: () => Promise.resolve(""),
        json: () =>
          Promise.resolve({
            content: [{ type: "text", text: "done" }],
            stop_reason: "end_turn",
            usage: { input_tokens: 1, output_tokens: 1 },
          }),
      } as unknown as Response),
    );

    render(
      <ChatPanel {...SCOPE_PROPS}
        lang="en-US"
        ai={AI_WITH_KEY}
        dispatcher={makeDispatcher()}
        projectId="p1"
        getChatConversation={() => stored}
      />,
    );

    const textarea = screen.getByPlaceholderText("Ask Claude about your tasks…");
    fireEvent.change(textarea, { target: { value: "third question" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());

    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string) as {
      messages: { role: string; content: unknown }[];
    };
    // The 40 MB of earlier-turn attachments busts the 30 MB budget, so the
    // OLDEST one (index 0) is placeholdered — stopping there already fits.
    expect(body.messages[0].content).toEqual([{ type: "text", text: "[attachment: document]" }]);
    // The more recent earlier-turn attachment (index 2) survives untouched.
    expect(body.messages[2].content).toEqual(stored.history[2].content);
    // The current turn is never touched.
    expect(JSON.stringify(body.messages[body.messages.length - 1])).toContain("third question");

    // The stored/persisted history (what use-chat-threads/component state was
    // seeded from) still holds the ORIGINAL block, byte for byte — budgeting
    // ran on the outgoing copy only, never mutated the source array/objects.
    expect(stored.history[0].content).toEqual([bigDoc]);
  });
});

describe("history budget keeps stored attachments (§575)", () => {
  afterEach(() => vi.restoreAllMocks());

  const reply = () =>
    Promise.resolve({
      ok: true,
      text: () => Promise.resolve(""),
      json: () =>
        Promise.resolve({
          content: [{ type: "text", text: "done" }],
          stop_reason: "end_turn",
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
    } as unknown as Response);

  async function sendTwice(mb: number) {
    const doc = {
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: "x".repeat(mb * 1024 * 1024) },
    } as const;
    const stored: ChatConversation = {
      history: [
        { role: "user", content: [doc] },
        { role: "assistant", content: [{ type: "text", text: "ok" }] },
        { role: "user", content: [doc] },
        { role: "assistant", content: [{ type: "text", text: "ok" }] },
      ],
      display: [
        { kind: "user", text: "first" },
        { kind: "assistant", text: "ok" },
        { kind: "user", text: "second" },
        { kind: "assistant", text: "ok" },
      ],
    };
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(reply);
    vi.mocked(fitHistoryToBudget).mockClear();
    render(
      <ChatPanel {...SCOPE_PROPS}
        lang="en-US"
        ai={AI_WITH_KEY}
        dispatcher={makeDispatcher()}
        projectId="p1"
        getChatConversation={() => stored}
      />,
    );
    const textarea = screen.getByPlaceholderText("Ask Claude about your tasks…");
    const send = async (text: string, calls: number) => {
      fireEvent.change(textarea, { target: { value: text } });
      fireEvent.click(screen.getByRole("button", { name: "Send" }));
      await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(calls));
      await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).toBeTruthy());
    };
    await send("third question", 1);
    await send("fourth question", 2);
    return { doc, fetchSpy };
  }

  it("a send over the budget keeps the original attachments in the stored history", async () => {
    const { doc, fetchSpy } = await sendTwice(20);
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string) as {
      messages: { content: unknown }[];
    };
    // (a) the first request carried the placeholder for the oldest attachment.
    expect(body.messages[0].content).toEqual([{ type: "text", text: "[attachment: document]" }]);
    // (b) the history the SECOND send handed to the trim still holds the original block.
    const second = vi.mocked(fitHistoryToBudget).mock.calls[1][0];
    expect(second[0].content).toEqual([doc]);
  });

  it("under the budget the stored history equals the sent history", async () => {
    const { doc } = await sendTwice(1);
    const second = vi.mocked(fitHistoryToBudget).mock.calls[1][0];
    expect(second[0].content).toEqual([doc]);
    expect(second[2].content).toEqual([doc]);
  });
});

// ---------------------------------------------------------------------------
// Attach / dictate button sizing (UX toolbar polish batch, Task 20)
// ---------------------------------------------------------------------------
describe("attach and dictate button sizing", () => {
  afterEach(() => vi.restoreAllMocks());

  function renderPanel() {
    return render(
      <ChatPanel {...SCOPE_PROPS}
        lang="en-US"
        ai={AI_WITH_KEY}
        dispatcher={makeDispatcher()}
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
      <ChatPanel {...SCOPE_PROPS} lang="en-US" ai={AI_WITH_KEY} dispatcher={dispatcher} />,
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

  it("a tool_use turn carrying no tool_use block never puts an empty carrier on the wire", async () => {
    // ★★★ REACHABLE WITH NO AWAIT ANYWHERE, which is why the guard sits at the
    //  push rather than in a downstream repair. `stop_reason: "tool_use"` with no
    //  `tool_use` block in the content is malformed — but it is EXTERNAL DATA and
    //  nothing between the socket and here validates it. `shouldStage([])` is
    //  false, so the turn takes the immediate path, the loop matches nothing, and
    //  `results` ends empty.
    // ★★ WHY AN EMPTY CARRIER IS FATAL AND NOT MERELY UNTIDY: `content: []` is an
    //  INVALID message, so the request 400s; `closeDanglingToolUses` runs at the
    //  top of every send and (before §596) had no rule that removes an empty
    //  message, so the next send rebuilt the same invalid array — forever. The
    //  history is `setHistory`'d, and in Turso mode persisted by
    //  `use-chat-threads`'s save effect, so the thread stayed dead across reload
    //  and tab close and only a new thread recovered it.
    // ★★★ IT BITES ON THE *NEXT* SEND, NOT ON THIS SEND'S CONTINUATION, and the
    //  first cut of this test asserted the wrong one and PASSED against the
    //  unguarded code. Within a send the empty carrier is the history TAIL, and
    //  `buildWireMessages` appends the turn-context block INTO a trailing user
    //  message — so the wire sees `content: [ctx]` and nothing looks wrong. The
    //  next send appends the user's new turn AFTER the empty one, which is then
    //  no longer the tail, gets no backfill, and goes out as `content: []` behind
    //  two consecutive `user` turns. Hence the second send below; asserting on
    //  `bodies[1]` proves nothing.
    // OBSERVABLE: the THIRD request's `messages` (the second SEND's first call).
    //  Guarded — no empty content, no consecutive user turns. Unguarded — both.
    const bodies: string[] = [];
    let call = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation((_url, init?: RequestInit) => {
      bodies.push(String(init?.body ?? ""));
      call += 1;
      const body =
        call === 1
          ? {
              // Malformed: says tool_use, carries none.
              content: [{ type: "text", text: "let me look" }],
              stop_reason: "tool_use",
              usage: { input_tokens: 1, output_tokens: 1 },
            }
          : {
              content: [{ type: "text", text: call === 2 ? "all done" : "second answer" }],
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
      <ChatPanel {...SCOPE_PROPS} lang="en-US" ai={AI_WITH_KEY} dispatcher={makeDispatcher()} />,
    );
    const ta = screen.getByPlaceholderText("Ask Claude about your tasks…");
    fireEvent.change(ta, { target: { value: "what is open?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(screen.getByText("all done")).toBeInTheDocument());

    fireEvent.change(ta, { target: { value: "and now?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(screen.getByText("second answer")).toBeInTheDocument());

    // PRECONDITION: the first send really round-tripped twice and the second send
    // really went out, so a clean read below is not a read of nothing.
    expect(bodies).toHaveLength(3);
    const sent = JSON.parse(bodies[2]) as { messages: { role: string; content: unknown }[] };
    expect(sent.messages.some((m) => Array.isArray(m.content) && m.content.length === 0)).toBe(false);
    // The second property the API rejects, pinned beside it: an empty carrier that
    // `closeDanglingToolUses` later "repairs" also splits the turn into two
    // consecutive user messages.
    expect(
      sent.messages.some((m, i) => i > 0 && m.role === "user" && sent.messages[i - 1].role === "user"),
    ).toBe(false);
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
      <ChatPanel {...SCOPE_PROPS} lang="en-US" ai={AI_WITH_KEY} dispatcher={makeDispatcher()} />,
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
      <ChatPanel {...SCOPE_PROPS} lang="en-US" ai={AI_WITH_KEY} dispatcher={makeDispatcher()} />,
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
     
      projectId: "p1",
      getChatConversation: store.get,
      saveChatConversation: store.save,
    };
    const { unmount } = render(<ChatPanel {...SCOPE_PROPS} {...props} />);
    const ta = screen.getByPlaceholderText("Ask Claude about your tasks…");
    fireEvent.change(ta, { target: { value: "hello there" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(screen.getByText("assistant reply")).toBeInTheDocument());
    expect(store.m.get("p1")).toBeTruthy();

    // Simulate navigate-away (unmount) then return (fresh mount): the store
    // rehydrates both the user turn and the assistant reply.
    unmount();
    render(<ChatPanel {...SCOPE_PROPS} {...props} />);
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
     
      getChatConversation: store.get,
      saveChatConversation: store.save,
    };
    const { rerender } = render(<ChatPanel {...SCOPE_PROPS} {...base} projectId="p1" />);
    const ta = screen.getByPlaceholderText("Ask Claude about your tasks…");
    fireEvent.change(ta, { target: { value: "p1 question" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    // Switch to p2 while p1's send is still in flight.
    rerender(<ChatPanel {...SCOPE_PROPS} {...base} projectId="p2" />);
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
     
      getChatConversation: store.get,
      saveChatConversation: store.save,
    };
    const { rerender } = render(<ChatPanel {...SCOPE_PROPS} {...base} projectId="p1" />);
    expect(screen.getByText("from p1")).toBeInTheDocument();
    rerender(<ChatPanel {...SCOPE_PROPS} {...base} projectId="p2" />);
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
      <ChatPanel {...SCOPE_PROPS}
        lang="en-US"
        ai={AI_WITH_KEY}
        dispatcher={makeDispatcher()}
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
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockReturnValue(pendingFetch);

    renderChatPanel({ tursoMode: true, tursoConfig: {} as never });
    await screen.findByText("thread A content");
    const ta = screen.getByPlaceholderText("Ask Claude about your tasks…");
    fireEvent.change(ta, { target: { value: "stale question 2" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    // The request leaves after the deployment status check; switch threads once it is in flight, so the
    // rejection below reaches the send's catch block as a network error, not as an abort.
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled());

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
    const panel = (tursoMode: boolean) => (
      <ChatPanel {...SCOPE_PROPS}
        lang="en-US"
        ai={AI_WITH_KEY}
        dispatcher={dispatcher}
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
      <ChatPanel {...SCOPE_PROPS} lang="en-US" ai={AI_WITH_KEY} dispatcher={makeDispatcher()} />,
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
      <ChatPanel {...SCOPE_PROPS} lang="en-US" ai={AI_WITH_KEY} dispatcher={makeDispatcher()} />,
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
      <ChatPanel {...SCOPE_PROPS} lang="en-US" ai={AI_WITH_KEY} dispatcher={makeDispatcher()} />,
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
      <ChatPanel {...SCOPE_PROPS} lang="en-US" ai={AI_WITH_KEY} dispatcher={makeDispatcher()} />,
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

  /** Both halves of the ONE request body: the tool schema list and the full
   *  prompt text the model reads this turn. `system` is `SystemBlock[]`
   *  (`{type:"text", text}`), joined with the volatile turn context — since
   *  Task 7 of the prompt-cache-layout slice, that context is no longer a
   *  `system` block at all; `buildWireMessages` appends it as a trailing text
   *  block on the final user message instead (see chat-cache-layout.ts), which
   *  is where `buildViewScopeBlock`'s tool advertisement now lives. Joining
   *  the two here keeps this describe block's assertions about what the model
   *  reads, not about which array a given block happens to sit in — a caching
   *  decision no assertion below should depend on. */
  async function requestBodyFor(ai: typeof AI_WITH_KEY) {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(okResponse);
    const view = render(
      <ChatPanel {...SCOPE_PROPS}
        lang="en-US"
        ai={ai}
        dispatcher={activityViewDispatcher()}
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
      messages: { role: string; content: { type: string; text?: string }[] | string }[];
    };
    view.unmount();
    fetchSpy.mockRestore();
    const lastMsg = body.messages[body.messages.length - 1];
    const lastMsgText = Array.isArray(lastMsg.content)
      ? lastMsg.content.map((b) => b.text ?? "").join("\n")
      : String(lastMsg.content);
    return {
      tools: body.tools.map((tool) => tool.name),
      system: [...body.system.map((block) => block.text), lastMsgText].join("\n"),
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

// §502 — the seam chat-api.test.ts cannot see: chat-panel.tsx builds toolFlags.forecast from the
// snapshot's forecastSimulation and hands the ONE value to callClaude (the schemas) and to the two prompt
// builders (the advertisement). Read both halves of the request body, as the historySearch block above does.
describe("the forecast flag reaches the request body", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  async function requestFor(forecastSimulation: boolean) {
    const base = makeDispatcher();
    const dispatcher = {
      ...base,
      getSnapshot: vi.fn(() => ({ ...base.getSnapshot(), forecastSimulation, forecastView: true })),
    } as unknown as ToolDispatcher;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve({
        ok: true,
        text: () => Promise.resolve(""),
        json: () => Promise.resolve({
          content: [{ type: "text", text: "ok" }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 },
        }),
      } as unknown as Response));
    const view = render(
      <ChatPanel {...SCOPE_PROPS} lang="en-US" ai={AI_WITH_KEY} dispatcher={dispatcher} />,
    );
    fireEvent.change(screen.getByPlaceholderText("Ask Claude about your tasks…"), { target: { value: "when do we finish" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const body = JSON.parse(String((fetchSpy.mock.calls[0][1] as RequestInit).body)) as {
      tools: { name: string }[];
      system: { text: string }[];
      messages: { content: { text?: string }[] | string }[];
    };
    view.unmount();
    fetchSpy.mockRestore();
    const last = body.messages[body.messages.length - 1];
    const lastText = Array.isArray(last.content) ? last.content.map((b) => b.text ?? "").join("\n") : String(last.content);
    return {
      tools: body.tools.map((tool) => tool.name),
      prompt: [...body.system.map((b) => b.text), lastText].join("\n"),
    };
  }

  it("offers the six forecast tools and the quoting rules when the snapshot says true", async () => {
    const { tools, prompt } = await requestFor(true);
    expect(tools).toEqual(expect.arrayContaining([
      "get_forecast", "create_forecast_scenario", "update_forecast_scenario",
      "delete_forecast_scenario", "set_forecast_proposal", "set_forecast_target_confidence",
    ]));
    expect(prompt).toContain("safe to commit");
  });

  it("offers none of them, and says the switch is off, when the snapshot says false", async () => {
    const off = await requestFor(false);
    expect(off.tools).not.toContain("get_forecast");
    expect(off.tools).not.toContain("create_forecast_scenario");
    expect(off.prompt).toContain('its "Use Monte Carlo forecasting" switch is off');
    expect(off.prompt).not.toContain("get_forecast");
    // CONTROL: the list was not gutted, exactly the six forecast tools are the difference (§502 part 4 added
    // delete, proposal and target confidence to the original three).
    const on = await requestFor(true);
    expect(off.tools).toHaveLength(on.tools.length - 6);
  });
});

// ---------------------------------------------------------------------------
// Structural single-flight under a same-tick double dispatch (§321, was §312)
// ---------------------------------------------------------------------------
// ★ This block used to stage TWO concurrent sends and pin that the first send's
//   `finally` left the second one's controller in `abortRef` (§312). Since §321
//   submitPrompt bails on a non-null `abortRef`, so that state is unreachable;
//   the identity clear stays in the `finally` as defence in depth.
describe("single-flight submitPrompt", () => {
  afterEach(() => vi.restoreAllMocks());

  it("a same-tick double dispatch sends exactly once", async () => {
    const signals: AbortSignal[] = [];
    let rejectFirst!: (reason: unknown) => void;
    const first = new Promise<Response>((_res, rej) => { rejectFirst = rej; });
    const later = new Promise<Response>(() => {});
    vi.spyOn(globalThis, "fetch").mockImplementation((_url, init) => {
      signals.push((init as RequestInit).signal as AbortSignal);
      return signals.length === 1 ? first : later;
    });

    render(
      <ChatPanel
        {...SCOPE_PROPS}
        lang="en-US"
        ai={AI_WITH_KEY}
        dispatcher={makeDispatcher()}
        projectId="p1"
      />,
    );
    const input = screen.getByPlaceholderText("Ask Claude about your tasks…");
    fireEvent.change(input, { target: { value: "list tasks" } });

    // Two native clicks with NO render between them, so both submitPrompt calls
    // read `busy === false` off the same render closure. Only the ref bail can
    // stop the second.
    const send = screen.getByRole("button", { name: "Send" });
    await act(async () => {
      send.click();
      send.click();
    });
    // ★ WITNESS that the first dispatch really sent, so "one" below is not "zero".
    await waitFor(() => expect(signals).toHaveLength(1));
    // Give a second dispatch, had it passed the bail, every chance to fetch.
    await act(async () => { await Promise.resolve(); });
    expect(signals).toHaveLength(1);

    // Control: the bail must RELEASE when the send settles, or the ref would
    // wedge the composer for good. Settle send 1, then send again.
    await act(async () => { rejectFirst(new Error("boom")); });
    await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument());
    fireEvent.change(input, { target: { value: "again" } });
    await act(async () => { screen.getByRole("button", { name: "Send" }).click(); });
    await waitFor(() => expect(signals).toHaveLength(2));
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

  /** The card's ROW checkboxes, in row order.
   *
   *  ★★ NEVER `getAllByRole("checkbox")` HERE. The card also renders a header
   *   select-all, which is the FIRST checkbox in DOM order — so a positional
   *   index over every checkbox silently shifts by one the moment that control
   *   is present, and two tests in this file did exactly that. `data-proposal-row`
   *   is the row marker the card sets for precisely this kind of query. */
  const rowBoxes = (card: HTMLElement): HTMLInputElement[] =>
    Array.from(card.querySelectorAll('[data-proposal-row] input[type="checkbox"]'));

  /** The `tool_result` blocks the SECOND request carries back to the model.
   *  ★ Filtered to `type === "tool_result"`: since Task 7 of the
   *  prompt-cache-layout slice, `buildWireMessages` appends the volatile turn
   *  context as a trailing text block on this same message (after the
   *  tool_result blocks, per the API's ordering requirement — see the
   *  "prompt cache layout wiring" describe block's ordering test), so the raw
   *  content array is no longer tool_result blocks alone. */
  function resultsIn(body: string): { type: string; tool_use_id: string; content: string }[] {
    const sent = JSON.parse(body) as { messages: { role: string; content: unknown }[] };
    const last = sent.messages[sent.messages.length - 1];
    return (last.content as { type: string; tool_use_id: string; content: string }[]).filter(
      (b) => b.type === "tool_result",
    );
  }

  /** The RAW, unfiltered content of the same message `resultsIn` reads —
   *  needed wherever a test cares about the message's exact SHAPE, not just
   *  its tool_result blocks. `resultsIn` filters to `type === "tool_result"`,
   *  which would make a shape check against its output tautological. */
  function rawContentIn(body: string): { type: string }[] {
    const sent = JSON.parse(body) as { messages: { role: string; content: unknown }[] };
    return sent.messages[sent.messages.length - 1].content as { type: string }[];
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
      <ChatPanel {...SCOPE_PROPS} lang="en-US" ai={AI_WITH_KEY} dispatcher={dispatcher} />,
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
      <ChatPanel {...SCOPE_PROPS} lang="en-US" ai={AI_WITH_KEY} dispatcher={dispatcher} />,
    );
    send();

    await screen.findByRole("region", CARD);
    expect(dispatcher.deleteAllTasks).not.toHaveBeenCalled();
    expect(dispatcher.createTask).not.toHaveBeenCalled();

    // ★ Restores the bite of the pre-Task-7 `results.every((b) => b.type ===
    //   "tool_result")).toBe(true)` line, which `resultsIn`'s new filter made
    //   tautological (it can now only ever return tool_result blocks). Read
    //   against the RAW, unfiltered content instead: the staged-proposal
    //   tool_result message must carry exactly the two tool_result blocks
    //   (in order) plus the trailing turn-context text block
    //   `buildWireMessages` appends — nothing else.
    expect(rawContentIn(bodies[1]).map((b) => b.type)).toEqual([
      "tool_result",
      "tool_result",
      "text",
    ]);

    const results = resultsIn(bodies[1]);
    expect(results.map((b) => b.tool_use_id).sort()).toEqual(["t1", "t2"]);
    expect(results[0].content).toContain("has NOT been applied");
  });

  it("Apply refuses a functions row as a conflict when the project's functions moved since staging (§779)", async () => {
    // Mutation: not passing `getFeatures` to `applyProposal` turns this red: the row is replayed (the
    // mock dispatcher has no updateSettings, so it fails as an error, not as a conflict).
    const dispatcher = makeDispatcher();
    scriptFetch(
      [
        toolTurn([
          { type: "tool_use", id: "t1", name: "create_task", input: NEW_TASK },
          { type: "tool_use", id: "t2", name: "update_settings", input: { enabledModules: ["raid"] } },
        ]),
        doneTurn("ok"),
      ],
      [],
    );
    const staged = { ...emptyWorkspace(), features: ["dashboard", "budget"] as FeatureModuleId[] };
    const panel = (workspace: Workspace) => (
      <ChatPanel {...SCOPE_PROPS} lang="en-US" ai={AI_WITH_KEY} dispatcher={dispatcher} workspace={workspace} />
    );
    const { rerender } = render(panel(staged));
    send();
    const card = await screen.findByRole("region", CARD);
    await screen.findByText("ok");
    // The user turns Changes on before clicking Apply.
    rerender(panel({ ...staged, features: ["dashboard", "budget", "changes"] }));
    fireEvent.click(within(card).getByRole("button", { name: /^Apply \(/ }));
    await waitFor(() => expect(within(card).getByText(t("en-US", "chatProposalFailed"))).toBeInTheDocument());
    expect(dispatcher.createTask).toHaveBeenCalledTimes(1);
  });

  it("a staged functions change shows a title and the functions it switches off (§779)", async () => {
    // Mutation: not passing `row.functions` through `proposalCardRows`, or dropping `functionsRowTitle`
    // from the staging titles, turns this red: the row reads `update_settings` with nothing under it.
    const dispatcher = makeDispatcher();
    scriptFetch(
      [
        toolTurn([
          { type: "tool_use", id: "t1", name: "create_task", input: NEW_TASK },
          { type: "tool_use", id: "t2", name: "update_settings", input: { enabledModules: ["raid"] } },
        ]),
        doneTurn("ok"),
      ],
      [],
    );
    render(
      <ChatPanel {...SCOPE_PROPS} lang="en-US" ai={AI_WITH_KEY} dispatcher={dispatcher} />,
    );
    send();
    const card = await screen.findByRole("region", CARD);
    expect(dispatcher.createTask).not.toHaveBeenCalled();
    expect(within(card).getByText("Project functions")).toBeInTheDocument();
    expect(within(card).getByText(/^Turns off: Dashboard, /)).toBeInTheDocument();
  });

  it("the card's other settings come from the dispatcher's live preview (§779)", async () => {
    // Mutation: not passing `previewSettings` to `describeProposal` turns this red: the line is then
    // computed against the defaults and shows "scopePendingRed 5".
    const dispatcher = makeDispatcher();
    (dispatcher as unknown as { previewSettings: unknown }).previewSettings = vi.fn(() => ({
      nextActionsWeights: { scopePendingRed: 9 },
    }));
    scriptFetch(
      [
        toolTurn([
          { type: "tool_use", id: "t1", name: "create_task", input: NEW_TASK },
          {
            type: "tool_use",
            id: "t2",
            name: "update_settings",
            input: { enabledModules: ["raid"], nextActionsWeights: { scopePendingRed: "junk" } },
          },
        ]),
        doneTurn("ok"),
      ],
      [],
    );
    render(
      <ChatPanel {...SCOPE_PROPS} lang="en-US" ai={AI_WITH_KEY} dispatcher={dispatcher} />,
    );
    send();
    const card = await screen.findByRole("region", CARD);
    expect(within(card).getByText("Also sets nextActionsWeights = scopePendingRed 9")).toBeInTheDocument();
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
      <ChatPanel {...SCOPE_PROPS}
        lang="en-US"
        ai={AI_WITH_KEY}
        dispatcher={makeDispatcher()}
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

  it("tells the MODEL the batch landed, and shows the user it landed", async () => {
    // ★★★ THE DEFECT THIS PINS WAS REPORTED FROM THE RUNNING APP, and both of
    //   its halves were invisible to this file. `applyPendingProposal` wrote the
    //   workspace and the card and never touched `history`, so the only thing
    //   the transcript ever said about the batch was `STAGED_TOOL_RESULT` —
    //   "has NOT been applied". Two turns later the model duly reminded the user
    //   to go and approve writes that were already committed.
    //   ★★ ASSERTED ON THE REQUEST BODY, not on component state: what matters is
    //   that the notice reaches the API on the NEXT turn. A state assertion
    //   would pass with the message stranded in a ref nothing sends.
    const dispatcher = makeDispatcher();
    vi.mocked(dispatcher.deleteTask).mockReturnValue(true);
    const bodies: string[] = [];
    scriptFetch(
      [
        toolTurn([{ type: "tool_use", id: "t1", name: "delete_task", input: { id: 1 } }]),
        doneTurn("ok"),
        doneTurn("after"),
      ],
      bodies,
    );

    render(
      <ChatPanel {...SCOPE_PROPS}
        lang="en-US"
        ai={AI_WITH_KEY}
        dispatcher={dispatcher}
      />,
    );
    send();

    const card = await screen.findByRole("region", CARD);
    await screen.findByText("ok");
    fireEvent.click(within(card).getByRole("button", { name: /^Apply \(/ }));

    // The USER half: success had no string at all, so a clean Apply merely
    // emptied the selection and disabled the button — indistinguishable from a
    // dead control, which is exactly how it was reported.
    await waitFor(() =>
      expect(within(card).getByText(t("en-US", "chatProposalApplied", 1))).toBeInTheDocument(),
    );

    // The MODEL half: send again and read what the request carries.
    send("and then?");
    await waitFor(() => expect(bodies.length).toBeGreaterThanOrEqual(3));
    const sent = bodies[bodies.length - 1];
    expect(sent).toContain(appliedProposalNotice(1, 0));

    // ★★ IT IS CARRIED AS THE USER, EXACTLY ONCE. Role matters: an assistant-role
    //   note would be the model appearing to assert its own success, which is
    //   the thing this whole fix exists to stop it inventing. Once matters
    //   because Apply is clickable again after a partial failure, and a notice
    //   duplicated per click would tell the model a row landed twice.
    //   ★★★ TWO WRONGER VERSIONS OF THIS ASSERTION CAME FIRST, both about WHERE
    //   the note sits, and the measurement refuted each. It does NOT ride the
    //   staged `tool_result` carrier: by the time Apply is clicked the turn has
    //   finished, so the transcript's tail is the ASSISTANT's closing message
    //   and `appendUserNote` therefore appends. Its merge branch is real but is
    //   not the path this test walks. And a no-consecutive-user-turns assertion
    //   is false against the app as it already ships — the carrier is a user
    //   message and the next send appends another. Assert the property, not a
    //   guess about the layout.
    const messages = (JSON.parse(sent) as { messages: { role: string; content: unknown }[] })
      .messages;
    const carrying = messages.filter((m) => JSON.stringify(m.content).includes("approved them"));
    expect(carrying).toHaveLength(1);
    expect(carrying[0].role).toBe("user");
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
      <ChatPanel {...SCOPE_PROPS}
        lang="en-US"
        ai={AI_WITH_KEY}
        dispatcher={dispatcher}
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
      <ChatPanel {...SCOPE_PROPS} lang="en-US" ai={AI_WITH_KEY} dispatcher={dispatcher} />,
    );
    send();

    const card = await screen.findByRole("region", CARD);
    await screen.findByText("ok"); // let the send settle before interacting
    fireEvent.click(within(card).getByRole("button", { name: /^Apply \(/ }));

    // ★★★ THE WHOLE STRING, NOT `/^Not applied/`. All four `chatProposalFailed*`
    //   labels begin with "Not applied", so a prefix match cannot tell them
    //   apart and the `failedKind` seam was UNPINNED by this file: mutating
    //   `failedKind: p.failed.get(i)` to `undefined` in `chat-panel.tsx` left it
    //   0 failed / 73 passed, i.e. all three §381 strings could be dead in
    //   production behind a green suite. `delete_task`'s throw is kind "error",
    //   whose label is the BARE string — so an exact match goes red the moment
    //   the card falls back to the em-dashed conflict wording.
    //   ★ Read through `t` rather than copied out: the fallback string carries
    //   an EM DASH, and a literal that lost it would fail for a reason that has
    //   nothing to do with the behaviour under test.
    await waitFor(() =>
      expect(within(card).getByText(t("en-US", "chatProposalFailedError"))).toBeInTheDocument(),
    );
    // Exactly one row is flagged — the other genuinely wrote. The prefix regex
    // is the right matcher HERE: it counts failure labels of ANY kind.
    //
    // ★★★ SCOPED TO THE ROW'S FAILURE NOTICE (`<p>`), because "Not applied" is
    //  NOT unique to it any more. `inlineAiEditRejected` is ALSO "Not applied:
    //  {0}", and since the approval card started rendering `plan.rejected` every
    //  described-but-ungrounded call adds an `<li>` carrying that prefix — here
    //  both staged `delete_task` rows, whose ids the panel's workspace does not
    //  hold, so the bare regex counted 3. Widening the expectation to 3 would
    //  have hidden the very thing this test pins: that exactly ONE row is
    //  flagged as not applied. The tag is the discriminator — the notice is a
    //  `<p>`, a plan rejection is an `<li>` — and it keeps the "labels of ANY
    //  kind" property the comment above depends on.
    expect(
      within(card)
        .getAllByText(/^Not applied/)
        .filter((el) => el.tagName === "P"),
    ).toHaveLength(1);
    const boxes = rowBoxes(card);
    expect(boxes[0]).not.toBeChecked(); // landed → cannot be re-applied
    expect(boxes[1]).toBeChecked(); // refused → still offered for retry
  });

  it("labels a refused dependent by its OWN kind, not the conflict wording", async () => {
    // ★★★ THE SECOND HALF OF THE `failedKind` SEAM, and the one that pins the
    //   §381 strings rather than the bare fallback. `makeDispatcher`'s
    //   `createTask` returns undefined, so `createdIdOf` finds no id, the
    //   provisional stays PENDING and the dependent row is refused with
    //   `PENDING_MINT_ERROR` → `failureKindOf` → "dependency". Mutant:
    //   `failedKind: p.failed.get(i)` → `undefined` in `chat-panel.tsx` and this
    //   row wears "changed since you reviewed" — the exact lie §381 removed.
    // ★ Both labels are read through `t`, never copied out: each carries an EM
    //   DASH, and a literal that lost it would fail for the wrong reason.
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
      <ChatPanel {...SCOPE_PROPS}
        lang="en-US"
        ai={AI_WITH_KEY}
        dispatcher={makeDispatcher()}
      />,
    );
    send();

    const card = await screen.findByRole("region", CARD);
    await screen.findByText("ok"); // let the send settle before interacting
    fireEvent.click(within(card).getByRole("button", { name: /^Apply \(/ }));

    await waitFor(() =>
      expect(
        within(card).getByText(t("en-US", "chatProposalFailedDependency")),
      ).toBeInTheDocument(),
    );
    // The create itself LANDED (a create with no usable id stays `ok: true`), so
    // exactly one row wears a failure label — and the conflict wording appears
    // on none of them.
    expect(within(card).getAllByText(/^Not applied/)).toHaveLength(1);
    expect(within(card).queryByText(t("en-US", "chatProposalFailed"))).toBeNull();
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
      <ChatPanel {...SCOPE_PROPS}
        lang="en-US"
        ai={AI_WITH_KEY}
        dispatcher={makeDispatcher()}
      />,
    );
    send();

    const card = await screen.findByRole("region", CARD);
    expect(rowBoxes(card)).toHaveLength(2);
    expect(rowBoxes(card)[1]).toBeChecked();

    fireEvent.click(rowBoxes(card)[0]);

    await waitFor(() =>
      expect(rowBoxes(card)[1]).not.toBeChecked(),
    );
    // Disabled as well as unchecked: re-ticking it alone would send a write at
    // a provisional id (see `isCascadedRow`).
    expect(rowBoxes(card)[1]).toBeDisabled();
  });

  it("select-all re-selects a cascaded row by restoring what it depends on", async () => {
    // ★★★ THE CASE THAT DECIDED THE HANDLER'S SHAPE. Row 1 names the id row 0
    //   will mint, so deselecting the create cascades row 1 off and disables it.
    //   Select-all then selects the WHOLE plan — including the create — so the
    //   dependency is satisfied and row 1 is legitimately selectable again.
    //   Mutant: filter cascaded rows out of `toggleAllProposalRows` (its first
    //   shape) and row 1 stays unticked while its create is back, which is the
    //   half-applied selection a user cannot explain.
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
      <ChatPanel {...SCOPE_PROPS}
        lang="en-US"
        ai={AI_WITH_KEY}
        dispatcher={makeDispatcher()}
      />,
    );
    send();

    const card = await screen.findByRole("region", CARD);
    fireEvent.click(rowBoxes(card)[0]); // cascade row 1 off
    await waitFor(() => expect(rowBoxes(card)[1]).toBeDisabled());

    // Select-all now re-ticks everything it is ALLOWED to.
    fireEvent.click(
      within(card).getByRole("checkbox", { name: t("en-US", "chatProposalSelectAll") }),
    );

    // ★★★ THE DEPENDENT COMES BACK TOO, AND THAT IS THE CORRECT OUTCOME — this
    //   assertion was written the other way round first and the run refuted it.
    //   Selecting the whole plan re-selects the create, so nothing depends on a
    //   refused row any more: the cascade is resolved, not bypassed. The unsafe
    //   state this guards against is a dependent selected while its create is
    //   NOT, which select-all cannot produce.
    await waitFor(() => expect(rowBoxes(card)[0]).toBeChecked());
    expect(rowBoxes(card)[1]).toBeChecked();
    expect(rowBoxes(card)[1]).toBeEnabled();
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

    const { rerender } = render(<ChatPanel {...SCOPE_PROPS} {...base} projectId="p1" />);
    send();
    await screen.findByRole("region", CARD);
    // Let the send settle before switching, so its trailing writes cannot race
    // the reconcile and make this test order-dependent.
    await screen.findByText("ok");

    await act(async () => {
      rerender(<ChatPanel {...SCOPE_PROPS} {...base} projectId="p2" />);
    });
    expect(screen.queryByRole("region", CARD)).toBeNull();

    await act(async () => {
      rerender(<ChatPanel {...SCOPE_PROPS} {...base} projectId="p1" />);
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
      <ChatPanel {...SCOPE_PROPS}
        lang="en-US"
        ai={AI_WITH_KEY}
        dispatcher={makeDispatcher()}
        projectId="p1"
        getChatConversation={() => stored}
      />,
    );
    expect(screen.getByText("This proposal is no longer active.")).toBeInTheDocument();
    expect(screen.queryByRole("region", CARD)).toBeNull();
  });

  // ---------------------------------------------------------------------------
  // AI-02 — the send record: writes are counted across the send, an attachment in the history stages
  // risky writes, and a card already staged in this send is never replaced unseen.

  const waitForIdle = () => waitFor(() => expect(screen.getByRole("button", { name: "Send" })).toBeTruthy());
  const withAttachment: ChatConversation = {
    history: [
      {
        role: "user",
        content: [{ type: "document", source: { type: "text", media_type: "text/plain", data: "Add a task." } }],
      },
      { role: "assistant", content: [{ type: "text", text: "read it" }] },
    ],
    display: [
      { kind: "user", text: "mail" },
      { kind: "assistant", text: "read it" },
    ],
  };

  it("a write after one applied directly earlier in the SAME send stages (AI-02)", async () => {
    // Mutation: never adding to `appliedWrites` turns this red: the second create runs too.
    const dispatcher = makeDispatcher();
    scriptFetch(
      [
        toolTurn([{ type: "tool_use", id: "t1", name: "create_task", input: NEW_TASK }]),
        toolTurn([{ type: "tool_use", id: "t2", name: "create_task", input: { ...NEW_TASK, taskName: "B" } }]),
        doneTurn("ok"),
      ],
      [],
    );
    render(<ChatPanel {...SCOPE_PROPS} lang="en-US" ai={AI_WITH_KEY} dispatcher={dispatcher} />);
    send();
    const card = await screen.findByRole("region", CARD);
    await screen.findByText("ok");
    expect(dispatcher.createTask).toHaveBeenCalledTimes(1);
    expect(rowBoxes(card)).toHaveLength(1);
  });

  it("a refused write does not count: the corrected retry in the same send applies (AI-02)", async () => {
    // Mutation: counting every ATTEMPTED write turns this red: the refused first call counts, so the
    // corrected retry goes to the card instead of applying.
    const row = {
      id: 1, taskName: "Ship it", assignee: "Alice", dueDate: "2030-12-31", lastUpdateDate: "2030-01-01",
      status: "To Do", priority: "Medium", blockers: "", description: "",
    } as Task;
    const dispatcher = makeDispatcher();
    vi.mocked(dispatcher.getTask).mockImplementation(() => row);
    vi.mocked(dispatcher.updateTask).mockImplementation(() => ({ ...row, status: "Done" }));
    scriptFetch(
      [
        toolTurn([{ type: "tool_use", id: "t1", name: "update_task", input: { id: 1, expectedToken: "stale", status: "Done" } }]),
        toolTurn([
          {
            type: "tool_use",
            id: "t2",
            name: "update_task",
            input: { id: 1, expectedToken: entityToken("task", row), status: "Done" },
          },
        ]),
        doneTurn("ok"),
      ],
      [],
    );
    render(<ChatPanel {...SCOPE_PROPS} lang="en-US" ai={AI_WITH_KEY} dispatcher={dispatcher} />);
    send();
    await screen.findByText("ok");
    expect(screen.queryByRole("region", CARD)).toBeNull();
    expect(dispatcher.updateTask).toHaveBeenCalledTimes(1);
  });

  it("an attachment in the history stages a lone create and applies nothing (AI-02)", async () => {
    const dispatcher = makeDispatcher();
    scriptFetch(
      [toolTurn([{ type: "tool_use", id: "t1", name: "create_task", input: NEW_TASK }]), doneTurn("ok")],
      [],
    );
    render(
      <ChatPanel {...SCOPE_PROPS}
        lang="en-US"
        ai={AI_WITH_KEY}
        dispatcher={dispatcher}
        projectId="p1"
        getChatConversation={() => withAttachment}
      />,
    );
    send();
    await screen.findByRole("region", CARD);
    await screen.findByText("ok");
    expect(dispatcher.createTask).not.toHaveBeenCalled();
  });

  // Owner decision: with an attachment in the history every change goes to the card, a version-checked one included.
  // Mutation: restoring the token exemption in `stagesWhenUntrusted` turns this red: the status change applies at once.
  it("a lone version-checked status change in a send with an attachment goes to the card, and Apply writes it (AI-02)", async () => {
    const task = {
      id: 1, taskName: "Ship it", assignee: "Alice", dueDate: "2030-12-31", lastUpdateDate: "2030-01-01",
      status: "To Do", priority: "Medium", blockers: "", description: "",
    } as Task;
    const workspace = { ...emptyWorkspace(), tasks: [task] } as Workspace;
    const dispatcher = makeDispatcher();
    vi.mocked(dispatcher.getTask).mockImplementation(() => task);
    vi.mocked(dispatcher.updateTask).mockImplementation(() => ({ ...task, status: "Done" }));
    scriptFetch(
      [
        toolTurn([
          { type: "tool_use", id: "t1", name: "update_task", input: { id: 1, expectedToken: entityToken("task", task), status: "Done" } },
        ]),
        doneTurn("ok"),
      ],
      [],
    );
    render(
      <ChatPanel {...SCOPE_PROPS}
        lang="en-US"
        ai={AI_WITH_KEY}
        dispatcher={dispatcher}
        workspace={workspace}
        projectId="p1"
        getChatConversation={() => withAttachment}
      />,
    );
    send();
    const card = await screen.findByRole("region", CARD);
    await screen.findByText("ok");
    await waitForIdle();
    expect(dispatcher.updateTask).not.toHaveBeenCalled();
    fireEvent.click(within(card).getByRole("button", { name: /^Apply \(/ }));
    await waitFor(() =>
      expect(within(card).getByText(t("en-US", "chatProposalApplied", 1))).toBeInTheDocument(),
    );
    expect(dispatcher.updateTask).toHaveBeenCalledTimes(1);
  });

  // A read changes nothing, so a staging turn runs it in place and the model gets its real result; only the change
  // goes on the card. Mutation: putting the turn's reads back on the card turns this red: two rows, no listRaid call.
  it("a read in a staging turn runs in place, and the card holds only the change (AI-02)", async () => {
    const raid = { id: 7, category: "I", title: "Vendor down", status: "Open", severity: "High" };
    const dispatcher = makeDispatcher();
    const extra = dispatcher as unknown as { listRaid: unknown; getRaidRow: unknown };
    extra.listRaid = vi.fn(() => [raid]);
    extra.getRaidRow = vi.fn(() => raid);
    const bodies: string[] = [];
    scriptFetch(
      [
        toolTurn([
          { type: "tool_use", id: "t1", name: "list_raid", input: {} },
          { type: "tool_use", id: "t2", name: "update_task", input: { id: 1, status: "Done" } },
        ]),
        doneTurn("ok"),
      ],
      bodies,
    );
    render(
      <ChatPanel {...SCOPE_PROPS}
        lang="en-US"
        ai={AI_WITH_KEY}
        dispatcher={dispatcher}
        projectId="p1"
        getChatConversation={() => withAttachment}
      />,
    );
    send();
    const card = await screen.findByRole("region", CARD);
    await screen.findByText("ok");
    expect(extra.listRaid).toHaveBeenCalledTimes(1);
    expect(dispatcher.updateTask).not.toHaveBeenCalled();
    expect(rowBoxes(card)).toHaveLength(1);
    const read = resultsIn(bodies[1]).find((b) => b.tool_use_id === "t1");
    expect(read?.content).toContain("Vendor down");
    expect(resultsIn(bodies[1]).find((b) => b.tool_use_id === "t2")?.content).toContain("staged");
    // The transcript keeps the turn's order: the read's line comes before the card it was staged beside.
    // Mutation: adding the card before running the reads turns this red.
    const readLine = screen.getByText(/Used list_raid/);
    expect(readLine.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  // §596 — the staging turn checks the scope before each read, as the ordinary loop does before each tool. A read that
  // would run after the scope moved runs nothing, and it and every id after it are answered as interrupted, once each.
  // Mutation: dropping that check turns this red: list_tasks runs in the next project.
  it("a staging turn stops its reads when the scope moves, and still answers every id once (AI-02)", async () => {
    let epoch = 1;
    const dispatcher = makeDispatcher();
    const extra = dispatcher as unknown as { listRaid: unknown; getRaidRow: unknown };
    extra.listRaid = vi.fn(() => {
      epoch = 2;
      return [];
    });
    extra.getRaidRow = vi.fn(() => null);
    const bodies: string[] = [];
    scriptFetch(
      [
        toolTurn([
          { type: "tool_use", id: "t1", name: "list_raid", input: {} },
          { type: "tool_use", id: "t2", name: "list_tasks", input: {} },
          { type: "tool_use", id: "t3", name: "update_task", input: { id: 1, status: "Done" } },
        ]),
        doneTurn("after"),
      ],
      bodies,
    );
    render(
      <ChatPanel {...SCOPE_PROPS}
        getScopeEpoch={() => epoch}
        lang="en-US"
        ai={AI_WITH_KEY}
        dispatcher={dispatcher}
        projectId="p1"
        getChatConversation={() => withAttachment}
      />,
    );
    send();
    await waitFor(() => expect(extra.listRaid).toHaveBeenCalledTimes(1));
    await waitForIdle();
    expect(dispatcher.listTasks).not.toHaveBeenCalled();
    expect(dispatcher.updateTask).not.toHaveBeenCalled();
    // The turn's answers reach the model with the next send.
    send("still there?");
    await waitFor(() => expect(bodies).toHaveLength(2));
    const answers = (JSON.parse(bodies[1]) as { messages: { content: unknown }[] }).messages
      .flatMap((m) => (Array.isArray(m.content) ? (m.content as { type: string; tool_use_id?: string; content?: string }[]) : []))
      .filter((b) => b.type === "tool_result");
    expect(answers.map((b) => b.tool_use_id).sort()).toEqual(["t1", "t2", "t3"]);
    expect(answers.filter((b) => b.tool_use_id !== "t1").map((b) => b.content)).toEqual([
      INTERRUPTED_TOOL_RESULT,
      INTERRUPTED_TOOL_RESULT,
    ]);
  });

  it("an automatic send waits while Apply is running, and the next one carries the applied notice (AI-02)", async () => {
    // Mutation: dropping the applying term from `sendGateRef.blocked` turns this red: the seed goes out mid-apply.
    const dispatcher = makeDispatcher();
    vi.mocked(dispatcher.deleteTask).mockReturnValue(true);
    const bodies: string[] = [];
    scriptFetch(
      [
        toolTurn([{ type: "tool_use", id: "t1", name: "delete_task", input: { id: 1 } }]),
        doneTurn("ok"),
        doneTurn("after"),
      ],
      bodies,
    );
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const runBatched = vi.fn(async (fn: () => unknown) => {
      await held;
      return fn();
    });
    const props = {
      ...SCOPE_PROPS,
      lang: "en-US" as const,
      ai: AI_WITH_KEY,
      dispatcher,
      runBatched: runBatched as unknown as UndoBatch["runBatched"],
      onChatSeedConsumed: vi.fn(),
    };
    const { rerender } = render(<ChatPanel {...props} chatSeed={null} />);
    send();
    const card = await screen.findByRole("region", CARD);
    await screen.findByText("ok");
    await waitForIdle();
    fireEvent.click(within(card).getByRole("button", { name: /^Apply \(/ }));
    await waitFor(() => expect(runBatched).toHaveBeenCalledTimes(1));

    rerender(<ChatPanel {...props} chatSeed={{ prompt: "What's next?", autoSend: true, originView: "dashboard" }} />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(bodies).toHaveLength(2);
    // Held back, the seed is a prefill, not lost.
    expect(screen.getByPlaceholderText("Ask Claude about your tasks…")).toHaveValue("What's next?");

    await act(async () => {
      release();
    });
    await waitFor(() =>
      expect(within(card).getByText(t("en-US", "chatProposalApplied", 1))).toBeInTheDocument(),
    );
    // The held seed is sent as a prefill: unchanged, it still carries the page it was asked from. ★ This is what
    // tells the gate's own term apart from the `submitPrompt` guard behind it: without the term the seed is
    // submitted, refused by that guard, and its origin is dropped, so the send below would come from the chat.
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(bodies).toHaveLength(3));
    expect(bodies[2]).toContain(appliedProposalNotice(1, 0));
    expect(bodies[2]).toContain("What's next?");
    expect(dispatcher.getSnapshot).toHaveBeenLastCalledWith({ originView: "dashboard" });
  });

  it("a send is refused while Apply is running, and the next one carries the applied notice (AI-02)", async () => {
    // Mutation: dropping the applying check from the send guard turns this red: the send goes out mid-apply, and its
    // end rewrites the history without the applied notice.
    const dispatcher = makeDispatcher();
    vi.mocked(dispatcher.deleteTask).mockReturnValue(true);
    const bodies: string[] = [];
    scriptFetch(
      [
        toolTurn([{ type: "tool_use", id: "t1", name: "delete_task", input: { id: 1 } }]),
        doneTurn("ok"),
        doneTurn("after"),
      ],
      bodies,
    );
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const runBatched = vi.fn(async (fn: () => unknown) => {
      await held;
      return fn();
    });
    render(
      <ChatPanel {...SCOPE_PROPS}
        lang="en-US"
        ai={AI_WITH_KEY}
        dispatcher={dispatcher}
        runBatched={runBatched as unknown as UndoBatch["runBatched"]}
      />,
    );
    send();
    const card = await screen.findByRole("region", CARD);
    await screen.findByText("ok");
    await waitForIdle();
    fireEvent.click(within(card).getByRole("button", { name: /^Apply \(/ }));
    await waitFor(() => expect(runBatched).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByPlaceholderText("Ask Claude about your tasks…"), { target: { value: "and then?" } });
    expect(screen.getByRole("button", { name: "Send" })).toBeDisabled();
    // Enter is the path the disabled button does not cover.
    fireEvent.keyDown(screen.getByPlaceholderText("Ask Claude about your tasks…"), { key: "Enter" });
    await act(async () => {
      await Promise.resolve();
    });
    expect(bodies).toHaveLength(2);

    await act(async () => {
      release();
    });
    await waitFor(() =>
      expect(within(card).getByText(t("en-US", "chatProposalApplied", 1))).toBeInTheDocument(),
    );
    send("and then?");
    await waitFor(() => expect(bodies).toHaveLength(3));
    expect(bodies[2]).toContain(appliedProposalNotice(1, 0));
  });

  it("the card cannot be applied or discarded while the send runs, and works once it ends (AI-02)", async () => {
    // Mutation: dropping the send-in-progress condition from the card's busy turns this red: Apply is enabled
    // mid-send, and the applied notice the click adds is overwritten when the send ends.
    const dispatcher = makeDispatcher();
    vi.mocked(dispatcher.deleteTask).mockReturnValue(true);
    const bodies: string[] = [];
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const turns = [
      toolTurn([{ type: "tool_use", id: "t1", name: "delete_task", input: { id: 1 } }]),
      doneTurn("Waiting for you."),
      doneTurn("after"),
    ];
    let call = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init?: RequestInit) => {
      bodies.push(String(init?.body ?? ""));
      const index = call;
      call += 1;
      if (index === 1) await held;
      const body = turns[Math.min(index, turns.length - 1)];
      return { ok: true, text: () => Promise.resolve(""), json: () => Promise.resolve(body) } as unknown as Response;
    });
    render(<ChatPanel {...SCOPE_PROPS} lang="en-US" ai={AI_WITH_KEY} dispatcher={dispatcher} />);
    send();

    const card = await screen.findByRole("region", CARD);
    await waitFor(() => expect(bodies).toHaveLength(2));
    const apply = within(card).getByRole("button", { name: /^Apply \(/ });
    const discard = within(card).getByRole("button", { name: t("en-US", "chatProposalDiscard") });
    expect(apply).toBeDisabled();
    expect(discard).toBeDisabled();
    fireEvent.click(apply);
    expect(dispatcher.deleteTask).not.toHaveBeenCalled();

    await act(async () => {
      release();
    });
    await screen.findByText("Waiting for you.");
    await waitForIdle();
    await waitFor(() => expect(within(card).getByRole("button", { name: /^Apply \(/ })).toBeEnabled());
    expect(within(card).getByRole("button", { name: t("en-US", "chatProposalDiscard") })).toBeEnabled();
    fireEvent.click(within(card).getByRole("button", { name: /^Apply \(/ }));
    await waitFor(() =>
      expect(within(card).getByText(t("en-US", "chatProposalApplied", 1))).toBeInTheDocument(),
    );
    expect(dispatcher.deleteTask).toHaveBeenCalledTimes(1);

    send("and then?");
    await waitFor(() => expect(bodies).toHaveLength(3));
    expect(bodies[2]).toContain(appliedProposalNotice(1, 0));
  });

  it("a write after a staged turn runs nothing and keeps the card, and the model still replies (AI-02)", async () => {
    // Mutation: removing the pending-proposal rule turns this red: the create runs or replaces the card.
    const dispatcher = makeDispatcher();
    const bodies: string[] = [];
    scriptFetch(
      [
        toolTurn([{ type: "tool_use", id: "t1", name: "delete_task", input: { id: 1 } }]),
        toolTurn([
          { type: "text", text: "Adding one more as well." },
          { type: "tool_use", id: "t2", name: "create_task", input: NEW_TASK },
        ]),
        doneTurn("Both wait for your review."),
      ],
      bodies,
    );
    render(<ChatPanel {...SCOPE_PROPS} lang="en-US" ai={AI_WITH_KEY} dispatcher={dispatcher} />);
    send();
    await screen.findByText("Both wait for your review.");
    await waitForIdle();
    expect(bodies).toHaveLength(3);
    expect(dispatcher.createTask).not.toHaveBeenCalled();
    expect(dispatcher.deleteTask).not.toHaveBeenCalled();
    const cards = screen.getAllByRole("region", CARD);
    expect(cards).toHaveLength(1);
    expect(rowBoxes(cards[0])).toHaveLength(1);
    expect(screen.queryByText(t("en-US", "chatTruncatedNote"))).toBeNull();
    const answers = (JSON.parse(bodies[2]) as { messages: { content: unknown }[] }).messages
      .flatMap((m) => (Array.isArray(m.content) ? (m.content as { type: string; tool_use_id?: string; content?: string }[]) : []))
      .filter((b) => b.type === "tool_result" && b.tool_use_id === "t2");
    expect(answers.map((b) => b.content)).toEqual([PROPOSAL_PENDING_RESULT]);
  });

  it("a read after a staged turn runs, a write beside it waits, and the model replies (AI-02)", async () => {
    // Mutation: answering every call of the turn with the pending notice (or ending the send there) turns
    // this red: list_tasks does not run, or the closing text never arrives.
    const dispatcher = makeDispatcher();
    const bodies: string[] = [];
    scriptFetch(
      [
        toolTurn([{ type: "tool_use", id: "t1", name: "delete_task", input: { id: 1 } }]),
        toolTurn([
          { type: "tool_use", id: "t2", name: "list_tasks", input: {} },
          { type: "tool_use", id: "t3", name: "update_task", input: { id: 1, status: "Done" } },
        ]),
        doneTurn("Checked the list; the rest waits for you."),
      ],
      bodies,
    );
    render(<ChatPanel {...SCOPE_PROPS} lang="en-US" ai={AI_WITH_KEY} dispatcher={dispatcher} />);
    send();
    await screen.findByText("Checked the list; the rest waits for you.");
    await waitForIdle();
    expect(bodies).toHaveLength(3);
    expect(dispatcher.listTasks).toHaveBeenCalled();
    expect(dispatcher.updateTask).not.toHaveBeenCalled();
    expect(dispatcher.deleteTask).not.toHaveBeenCalled();
    const cards = screen.getAllByRole("region", CARD);
    expect(cards).toHaveLength(1);
    expect(rowBoxes(cards[0])).toHaveLength(1);
    const results = (JSON.parse(bodies[2]) as { messages: { content: unknown }[] }).messages
      .flatMap((m) => (Array.isArray(m.content) ? (m.content as { type: string; tool_use_id?: string; content?: string }[]) : []))
      .filter((b) => b.type === "tool_result");
    const read = results.find((b) => b.tool_use_id === "t2");
    expect(read?.content).toBeDefined();
    expect(read?.content).not.toBe(PROPOSAL_PENDING_RESULT);
    expect(read?.content).not.toMatch(/proposal/i);
    expect(results.filter((b) => b.tool_use_id === "t3").map((b) => b.content)).toEqual([PROPOSAL_PENDING_RESULT]);
  });

  it("the card describes and applies set_filters, set_language and a plain update_settings (AI-02)", async () => {
    const dispatcher = makeDispatcher();
    const extra = dispatcher as unknown as { updateSettings: unknown; previewSettings: unknown };
    extra.updateSettings = vi.fn(() => ({ showViewHints: false }));
    extra.previewSettings = vi.fn(() => ({ showViewHints: false }));
    scriptFetch(
      [
        toolTurn([
          { type: "tool_use", id: "t1", name: "set_filters", input: { search: "late" } },
          { type: "tool_use", id: "t2", name: "set_language", input: { language: "de" } },
          { type: "tool_use", id: "t3", name: "update_settings", input: { showViewHints: false } },
        ]),
        doneTurn("ok"),
      ],
      [],
    );
    render(
      <ChatPanel {...SCOPE_PROPS}
        lang="en-US"
        ai={AI_WITH_KEY}
        dispatcher={dispatcher}
        projectId="p1"
        getChatConversation={() => withAttachment}
      />,
    );
    send();
    const card = await screen.findByRole("region", CARD);
    await screen.findByText("ok");
    expect(dispatcher.setFilters).not.toHaveBeenCalled();
    const rows = Array.from(card.querySelectorAll("[data-proposal-row]"));
    expect(rows).toHaveLength(3);
    // Mutation: titling these rows with the tool name turns this red.
    expect(rows.map((r) => r.querySelector(".text-sm")?.textContent)).toEqual([
      "Filter the task list: Search = late",
      "Switch the app language to Deutsch",
      "Change settings: showViewHints = false",
    ]);
    fireEvent.click(within(card).getByRole("button", { name: /^Apply \(/ }));
    await waitFor(() => expect(extra.updateSettings).toHaveBeenCalledTimes(1));
    expect(dispatcher.setFilters).toHaveBeenCalledTimes(1);
    expect(dispatcher.setLanguage).toHaveBeenCalledWith("de");
  });
});

// ---------------------------------------------------------------------------
// Cache-write recording (§702): the view-switch counter must be handed the
// cache writes of every turn of a send, not just the last one. Token usage
// itself is recorded by the transport's tap, not by the panel. The
// `recordChatSend` spy on the usage context is the observable here (not the
// request body — this asserts what gets RECORDED, not what gets SENT), per the
// file's own request-body convention for send-side assertions elsewhere.
// ---------------------------------------------------------------------------
describe("cache-token usage recording", () => {
  // ★★ RE-APPLY THE DEFAULT BOTH BEFORE AND AFTER EACH TEST. vi.restoreAllMocks()
  // restores only vi.spyOn spies — it does NOT undo a mockReturnValue() set on
  // a plain vi.fn() created inside a vi.mock factory. Left unguarded, this
  // block's override of useAiUsageContext() would survive into whatever runs
  // next in this file, and unit-tests-shuffled reorders tests WITHIN a file
  // (not just across files) — so under some seed, a later test reading the
  // default stub would inherit this block's captured recordSpy instead. Same
  // hazard this file already documents for call history, not implementation,
  // above the chat-threads-store vi.mock (see its "does NOT clear call
  // history" comment).
  // ★★★ beforeEach ALONE IS NOT ENOUGH — measured, not theorised. It resets
  // the mock only before the NEXT test INSIDE this describe; a sibling
  // describe further down the file (which has no beforeEach of its own) still
  // reads whatever this block's last test left behind. The override must also
  // be undone in afterEach so nothing outside this block can ever observe it.
  beforeEach(() => {
    vi.mocked(useAiUsageContext).mockReturnValue(DEFAULT_AI_USAGE_CONTEXT);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.mocked(useAiUsageContext).mockReturnValue(DEFAULT_AI_USAGE_CONTEXT);
  });

  it("hands the view-switch counter the cache writes of every turn of a send", async () => {
    const recordChatSendSpy = vi.fn();
    vi.mocked(useAiUsageContext).mockReturnValue({
      ...DEFAULT_AI_USAGE_CONTEXT,
      recordChatSend: recordChatSendSpy,
    });

    // A clock that moves on every read, so the two requests' stamps differ.
    let tick = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => ++tick);
    const fetchTimes: number[] = [];
    let call = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      call += 1;
      fetchTimes.push(Date.now());
      // Turn 1: a real (non-destructive) tool call, so the round-trip loop
      // executes it and continues. Turn 2: the final answer. Both turns carry
      // the SAME cache_read figure — a per-turn accumulator that overwrites
      // instead of sums would report 1000, not 2000. The two turns carry
      // DISTINCT non-zero cache_creation_input_tokens (150 / 350, summing to
      // 500) so a totalCacheWrite accumulator that overwrites instead of
      // summing, or drops the field entirely, is caught the same way — 150,
      // 350, 500, 1000 and 2000 are all mutually distinct, so no assertion
      // below can pass by reading the wrong field or the wrong turn.
      const body =
        call === 1
          ? {
              content: [{ type: "tool_use", id: "t1", name: "list_tasks", input: {} }],
              stop_reason: "tool_use",
              usage: {
                input_tokens: 10, output_tokens: 5,
                cache_creation_input_tokens: 150, cache_read_input_tokens: 1000,
              },
            }
          : {
              content: [{ type: "text", text: "done" }],
              stop_reason: "end_turn",
              usage: {
                input_tokens: 10, output_tokens: 5,
                cache_creation_input_tokens: 350, cache_read_input_tokens: 1000,
              },
            };
      return Promise.resolve({
        ok: true,
        text: () => Promise.resolve(""),
        json: () => Promise.resolve(body),
      } as unknown as Response);
    });

    render(
      <ChatPanel {...SCOPE_PROPS} lang="en-US" ai={AI_WITH_KEY} dispatcher={makeDispatcher()} />,
    );
    const ta = screen.getByPlaceholderText("Ask Claude about your tasks…");
    fireEvent.change(ta, { target: { value: "hi" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(screen.getByText("done")).toBeInTheDocument());

    // Token usage is the transport tap's to record (ai-usage-context.test.tsx); the panel reports none.
    // §702: one send, two API requests — the counter is told both numbers.
    expect(recordChatSendSpy).toHaveBeenCalledTimes(1);
    expect(recordChatSendSpy).toHaveBeenCalledWith(expect.anything(), 500, 2);
    // The cache is refreshed when a request goes out, so the window anchors
    // on the LAST request's send time — not the first, and not the arrival
    // of its answer.
    const [fp] = recordChatSendSpy.mock.calls[0] as [{ startedAt: number; lastRequestAt: number }];
    expect(fetchTimes).toHaveLength(2);
    expect(fp.startedAt).toBeLessThan(fetchTimes[0]);
    expect(fp.lastRequestAt).toBeGreaterThan(fetchTimes[0]);
    expect(fp.lastRequestAt).toBeLessThan(fetchTimes[1]);
  });

  // §702: the view-switch counter classifies sends by what each one put in
  // front of the transcript, so the fingerprint must be the system blocks the
  // request ACTUALLY carried, and the thread key must hold steady across sends
  // of one conversation or no send could ever count as a switch.
  it("hands each finished send's system blocks, thread and cache writes to the view-switch counter", async () => {
    const recordChatSendSpy = vi.fn();
    vi.mocked(useAiUsageContext).mockReturnValue({
      ...DEFAULT_AI_USAGE_CONTEXT,
      recordChatSend: recordChatSendSpy,
    });
    // A clock that moves on every read, so "stamped before the request" and
    // "stamped after it" are distinguishable rather than equal.
    let tick = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => ++tick);
    const fetchTimes: number[] = [];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      fetchTimes.push(Date.now());
      return Promise.resolve({
        ok: true,
        text: () => Promise.resolve(""),
        json: () =>
          Promise.resolve({
            content: [{ type: "text", text: "done" }],
            stop_reason: "end_turn",
            usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 700, cache_read_input_tokens: 0 },
          }),
      } as unknown as Response);
    });
    const viewGuide: OperatingGuide = {
      id: "vg", name: "Open points", content: "Sort by due date.", enabled: true, priority: 1,
      scope: { views: ["open-points" as const] }, builtIn: true,
    };

    render(
      <ChatPanel
        {...SCOPE_PROPS}
        lang="en-US"
        ai={{ ...AI_WITH_KEY, groundInGuides: true }}
        guides={[viewGuide]}
        dispatcher={makeDispatcher()}
      />,
    );
    const ta = screen.getByPlaceholderText("Ask Claude about your tasks…");
    fireEvent.change(ta, { target: { value: "first" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(recordChatSendSpy).toHaveBeenCalledTimes(1));
    fireEvent.change(ta, { target: { value: "second" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(recordChatSendSpy).toHaveBeenCalledTimes(2));

    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string) as {
      system: { text: string }[];
      model: string;
      tools: { name: string }[];
    };
    const [firstFp, firstWrite] = recordChatSendSpy.mock.calls[0] as [
      SendFingerprint,
      number,
    ];
    // Model and tools sit in front of `system` in the cache prefix, so they
    // must be the ones the request carried.
    expect(firstFp.model).toBe(body.model);
    expect(body.tools.length).toBeGreaterThan(0);
    expect(firstFp.toolNames).toBe(body.tools.map((d) => d.name).join(","));
    const [secondFp] = recordChatSendSpy.mock.calls[1] as [{ threadKey: string; priorTurns: number }, number];
    expect(firstFp.stableText).toBe(body.system[0].text);
    expect(body.system[1].text).toContain("Sort by due date.");
    expect(firstFp.viewText).toBe(body.system[1].text);
    expect(firstWrite).toBe(700);
    expect(firstFp.priorTurns).toBe(0);
    expect(secondFp.priorTurns).toBeGreaterThan(0);
    expect(secondFp.threadKey).toBe(firstFp.threadKey);
    // Both stamps are taken just before a request goes out: with one request
    // they bracket nothing and both precede it.
    expect(firstFp.startedAt).toBeLessThan(fetchTimes[0]);
    expect(firstFp.lastRequestAt).toBeLessThan(fetchTimes[0]);
    expect(firstFp.lastRequestAt).toBeGreaterThanOrEqual(firstFp.startedAt);
  });

  // A send that goes stale WITHOUT being cancelled — a workspace scope change;
  // a project or thread switch cancels instead. The view-switch counter must
  // get the request together with its cache write, or a switch would be
  // recorded with a write of 0. Token usage is the transport tap's, which counts
  // every response that arrived, a stale one included.
  it("gives the counter the cache write of a response that landed after a scope change", async () => {
    const recordChatSendSpy = vi.fn();
    vi.mocked(useAiUsageContext).mockReturnValue({
      ...DEFAULT_AI_USAGE_CONTEXT,
      recordChatSend: recordChatSendSpy,
    });
    let resolveFetch!: (r: Response) => void;
    vi.spyOn(globalThis, "fetch").mockReturnValue(new Promise<Response>((res) => { resolveFetch = res; }));
    let epoch = 0;
    render(
      <ChatPanel
        {...SCOPE_PROPS}
        getScopeEpoch={() => epoch}
        lang="en-US"
        ai={AI_WITH_KEY}
        dispatcher={makeDispatcher()}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText("Ask Claude about your tasks…"), { target: { value: "q" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalledTimes(1));
    epoch = 1;
    resolveFetch({
      ok: true,
      text: () => Promise.resolve(""),
      json: () =>
        Promise.resolve({
          content: [{ type: "text", text: "late" }],
          stop_reason: "end_turn",
          usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 800, cache_read_input_tokens: 0 },
        }),
    } as unknown as Response);

    await waitFor(() => expect(recordChatSendSpy).toHaveBeenCalledTimes(1));
    expect(recordChatSendSpy).toHaveBeenCalledWith(expect.anything(), 800, 1);
  });

  function renderGuidedPanel() {
    const viewGuide: OperatingGuide = {
      id: "vg", name: "Open points", content: "Sort by due date.", enabled: true, priority: 1,
      scope: { views: ["open-points" as const] }, builtIn: true,
    };
    render(
      <ChatPanel
        {...SCOPE_PROPS}
        lang="en-US"
        ai={{ ...AI_WITH_KEY, groundInGuides: true }}
        guides={[viewGuide]}
        dispatcher={makeDispatcher()}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText("Ask Claude about your tasks…"), { target: { value: "hi" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
  }

  // A send that fails AFTER a response is not counted as a send (the view-switch
  // counter; the tap still counts its usage), but its prefix reached the cache —
  // so the counter must still learn it as the thread's baseline.
  it("notes, without counting, a send that failed after a response", async () => {
    const recordChatSendSpy = vi.fn();
    const noteSpy = vi.fn();
    vi.mocked(useAiUsageContext).mockReturnValue({
      ...DEFAULT_AI_USAGE_CONTEXT,
      recordChatSend: recordChatSendSpy,
      noteUnbilledChatSend: noteSpy,
    });
    let call = 0;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      call += 1;
      if (call > 1) return Promise.reject(new Error("boom"));
      return Promise.resolve({
        ok: true,
        text: () => Promise.resolve(""),
        json: () =>
          Promise.resolve({
            content: [{ type: "tool_use", id: "t1", name: "list_tasks", input: {} }],
            stop_reason: "tool_use",
            usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
          }),
      } as unknown as Response);
    });

    renderGuidedPanel();
    await screen.findByText(t("en-US", "chatError", "boom"));

    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string) as {
      system: { text: string }[];
    };
    expect(recordChatSendSpy).not.toHaveBeenCalled();
    expect(noteSpy).toHaveBeenCalledTimes(1);
    expect(noteSpy.mock.calls[0][0]).toEqual(
      expect.objectContaining({ stableText: body.system[0].text, viewText: body.system[1].text }),
    );
  });

  it("tells the counter nothing about a send whose first request failed", async () => {
    const recordChatSendSpy = vi.fn();
    const noteSpy = vi.fn();
    vi.mocked(useAiUsageContext).mockReturnValue({
      ...DEFAULT_AI_USAGE_CONTEXT,
      recordChatSend: recordChatSendSpy,
      noteUnbilledChatSend: noteSpy,
    });
    vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.reject(new Error("boom")));

    renderGuidedPanel();
    await screen.findByText(t("en-US", "chatError", "boom"));

    expect(recordChatSendSpy).not.toHaveBeenCalled();
    expect(noteSpy).not.toHaveBeenCalled();
  });

  // ★ The mock ignores the abort signal, so the request answers AFTER Stop and
  //   the loop breaks on the cancel without throwing. A real Stop aborts the
  //   fetch and takes the catch instead (the next test); this pins the
  //   defensive cancel-after-response branch.
  it("notes, without counting, a send stopped after its request answered", async () => {
    const recordChatSendSpy = vi.fn();
    const noteSpy = vi.fn();
    vi.mocked(useAiUsageContext).mockReturnValue({
      ...DEFAULT_AI_USAGE_CONTEXT,
      recordChatSend: recordChatSendSpy,
      noteUnbilledChatSend: noteSpy,
    });
    let answer: (r: Response) => void = () => {};
    vi.spyOn(globalThis, "fetch").mockImplementation(
      () => new Promise<Response>((resolve) => { answer = resolve; }),
    );

    renderGuidedPanel();
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Stop" }).length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByRole("button", { name: "Stop" })[0]);
    answer({
      ok: true,
      text: () => Promise.resolve(""),
      json: () =>
        Promise.resolve({
          content: [{ type: "text", text: "late" }],
          stop_reason: "end_turn",
          usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
        }),
    } as unknown as Response);

    await waitFor(() => expect(noteSpy).toHaveBeenCalledTimes(1));
    expect(recordChatSendSpy).not.toHaveBeenCalled();
  });

  // The real Stop after a response: request 1 answered with a tool call, the
  // abort then rejects request 2. The prefix of request 1 is cached, so the
  // send is noted — and dated from request 1, the last one that ANSWERED: an
  // aborted request may or may not have reached the cache, so the stamp errs
  // toward cold.
  it("notes a send whose second request was aborted, dated from the last request that answered", async () => {
    const recordChatSendSpy = vi.fn();
    const noteSpy = vi.fn();
    vi.mocked(useAiUsageContext).mockReturnValue({
      ...DEFAULT_AI_USAGE_CONTEXT,
      recordChatSend: recordChatSendSpy,
      noteUnbilledChatSend: noteSpy,
    });
    let tick = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => ++tick);
    const fetchTimes: number[] = [];
    let call = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(() => {
      call += 1;
      fetchTimes.push(Date.now());
      if (call === 2) return Promise.reject(new DOMException("aborted", "AbortError"));
      return Promise.resolve({
        ok: true,
        text: () => Promise.resolve(""),
        json: () =>
          Promise.resolve({
            content: [{ type: "tool_use", id: "t1", name: "list_tasks", input: {} }],
            stop_reason: "tool_use",
            usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 150, cache_read_input_tokens: 0 },
          }),
      } as unknown as Response);
    });

    renderGuidedPanel();
    await waitFor(() => expect(noteSpy).toHaveBeenCalledTimes(1));
    expect(recordChatSendSpy).not.toHaveBeenCalled();
    expect(fetchTimes).toHaveLength(2);
    const [fp] = noteSpy.mock.calls[0] as [SendFingerprint];
    expect(fp.startedAt).toBeLessThan(fetchTimes[0]);
    expect(fp.lastRequestAt).toBeLessThan(fetchTimes[0]);
  });
});

// ---------------------------------------------------------------------------
// §650 — a refused key reads as a KEY problem, not "Chat failed: 401 — invalid x-api-key".
// ---------------------------------------------------------------------------
describe("§650 a refused key shows the key message", () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([
    [401, "authentication_error", "Claude rejected your Anthropic API key. Enter a new key in Settings → AI."],
    [403, "permission_error", "Your Anthropic API key isn't allowed to make this request."],
  ] as const)("a %i shows the key message instead of the raw failure", async (status, type, copy) => {
    const body = { error: { type, message: "invalid x-api-key" } };
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status,
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
    } as unknown as Response);

    render(
      <ChatPanel {...SCOPE_PROPS} lang="en-US" ai={AI_WITH_KEY} dispatcher={makeDispatcher()} />,
    );
    const ta = screen.getByPlaceholderText("Ask Claude about your tasks…");
    fireEvent.change(ta, { target: { value: "list tasks" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(copy);
    expect(alert).not.toHaveTextContent(/Chat failed/i);
    expect(alert).not.toHaveTextContent(/invalid x-api-key/);
  });
});

// ---------------------------------------------------------------------------
// AI-17 — the transport's own failures are named as what they are, never as a key problem.
// ---------------------------------------------------------------------------
describe("AI-17 a transport failure shows its own message", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    __setAiStatusRequestForTests(answerAiStatusDirect);
  });

  it("an unconfirmed AI setting sends nothing and says so", async () => {
    __setAiStatusRequestForTests(() => Promise.reject(new TypeError("Failed to fetch")));
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    render(<ChatPanel {...SCOPE_PROPS} lang="en-US" ai={AI_WITH_KEY} dispatcher={makeDispatcher()} />);
    fireEvent.change(screen.getByPlaceholderText("Ask Claude about your tasks…"), { target: { value: "list tasks" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Could not confirm this app's AI setting, so nothing was sent. Try again.");
    expect(alert).not.toHaveTextContent(/Chat failed/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// §650 fix round — a passphrase-UNLOCKED key is the live key for the verdict. The settings key reads
// "" for a passphrase-wrapped record, so task-manager syncs "" and, without the panel syncing the
// unlocked key, every report made with it would be dropped as stale.
// ---------------------------------------------------------------------------
describe("§650 a passphrase-unlocked key feeds the key verdict", () => {
  beforeEach(() => __resetAiKeyStatusForTests());
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it("an unlocked key rejected with 401 sets the verdict to rejected", async () => {
    await saveSealed(await sealPassphrase("anthropicApiKey", "sk-ant-api03-UnlockedKey0000000000", "pw"));
    syncAiKey(""); // what task-manager syncs for a passphrase-wrapped key
    const body = { error: { type: "authentication_error", message: "invalid x-api-key" } };
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 401,
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
    } as unknown as Response);
    render(
      <ChatPanel {...SCOPE_PROPS}
        lang="en-US"
        ai={{ ...defaultAiConfig, consent: newConsent(new Date(0)), apiKey: "" }}
        dispatcher={makeDispatcher()}
      />,
    );
    fireEvent.change(screen.getByLabelText(/^passphrase$/i), { target: { value: "pw" } });
    fireEvent.click(screen.getByRole("button", { name: /^unlock$/i }));
    await waitFor(() => expect(screen.queryByRole("button", { name: /^unlock$/i })).toBeNull());
    fireEvent.change(screen.getByPlaceholderText("Ask Claude about your tasks…"), { target: { value: "list tasks" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByRole("alert");
    expect(getAiKeyStatus()).toBe("rejected");
  });
});
