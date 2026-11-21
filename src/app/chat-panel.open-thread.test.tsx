// src/app/chat-panel.open-thread.test.tsx — §799: an Activity entry's link asks the chat to open a thread.
// The request is consumed once; while an answer runs the thread does NOT switch and the send is NOT aborted.
import "fake-indexeddb/auto";
import "../test/ai-consent-live";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { spyAiFetch } from "../test/fetch-real-response";
import { DIRECT_AI_STATUS } from "../test/ai-status-fetch";
import { setAiDeploymentState } from "./ai-deployment";
import { clearSessionAiKey } from "./session-ai-key";
import { ChatPanel } from "./chat-panel";
import { loadThreads } from "./chat-threads-store";
import type { ChatThread } from "./chat-threads";
import { newConsent } from "./ai-consent";
import { defaultAiConfig } from "./settings-types";
import { t } from "./i18n";
import type { ToolDispatcher } from "./chat-tools";
import type { OpenThreadRequest } from "./use-chat-open-thread-request";

vi.mock("./ai-privacy-context", () => import("../test/ai-privacy-unprotected"));

vi.mock("./chat-threads-store", () => ({
  loadThreads: vi.fn(async () => []),
  saveThread: vi.fn(async () => undefined),
  deleteThread: vi.fn(async () => undefined),
  expireThreads: vi.fn(async () => undefined),
}));

vi.mock("./chat-key-vault", () => ({
  chatVaultAvailable: () => true,
  readChatIdentity: vi.fn(async () => ({ kind: "absent" })),
  getChatIdentity: vi.fn(async () => null),
  ensureChatIdentity: vi.fn(async () => ({ ownerId: "owner-test", chatKey: new Uint8Array(32) })),
  storedChatOwnerId: () => "owner-test",
  storedChatOwnerIds: () => ["owner-test"],
}));

const CHAT_ON = { retentionDays: 30, retentionInvalid: false, recoveryKey: "recovery-spki", recoveryKeyInvalid: false };
const now = new Date().toISOString();
const older = new Date(Date.now() - 60_000).toISOString();
const THREADS: ChatThread[] = [
  { id: "t1", projectId: "default", ownerId: null, name: "First", createdAt: "c", updatedAt: now, history: [],
    display: [{ kind: "user", text: "message in t1", requestId: "r1" }] },
  { id: "t2", projectId: "default", ownerId: null, name: "Second", createdAt: "c", updatedAt: older, history: [],
    display: [{ kind: "user", text: "message in t2", requestId: "r2" }] },
];

beforeEach(() => {
  setAiDeploymentState({ ...DIRECT_AI_STATUS, chat: CHAT_ON });
  vi.mocked(loadThreads).mockReset();
  vi.mocked(loadThreads).mockResolvedValue(THREADS.map((th) => ({ ...th })));
});
afterEach(() => {
  clearSessionAiKey();
  vi.restoreAllMocks();
});

const SCOPE_PROPS = { getScopeEpoch: () => 0, isSwapInFlight: () => false };
const AI = { ...defaultAiConfig, enabled: true, consent: newConsent(new Date(0)), apiKey: "sk-test" };
const TURSO_CONFIG = {} as never;
const dispatcher = {
  getSnapshot: () => ({
    today: "2026-06-04", language: "en-US", holidayCountries: [], storageKind: "memory", taskCount: 0,
    knownGroups: [], knownLabels: [], mode: "advanced" as const, enabledModules: [] as string[], currentView: "open-points" as const,
  }),
  isPeopleProtected: () => false, isResourcesHidden: () => false, isStakeholdersHidden: () => false,
} as unknown as ToolDispatcher;
const BUSY_NOTICE = t("en-US", "chatOpenThreadBusy");

function panel(request: OpenThreadRequest | null, onConsumed: () => void) {
  return (
    <ChatPanel {...SCOPE_PROPS} lang="en-US" ai={AI} dispatcher={dispatcher} tursoMode tursoConfig={TURSO_CONFIG}
      openThreadRequest={request} onOpenThreadRequestConsumed={onConsumed} />
  );
}

describe("ChatPanel — open a thread from the Activity view (§799)", () => {
  it("switches to the requested thread and consumes the request once", async () => {
    const consumed = vi.fn();
    const { rerender } = render(panel(null, consumed));
    await screen.findByText("message in t1");
    const req = { threadId: "t2", nonce: 1 };
    rerender(panel(req, consumed));
    await screen.findByText("message in t2");
    expect(screen.queryByText("message in t1")).toBeNull();
    expect(consumed).toHaveBeenCalledTimes(1);
    // A re-render with the same (not yet cleared) request does not fire it again.
    rerender(panel(req, consumed));
    rerender(panel(null, consumed));
    expect(consumed).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(BUSY_NOTICE)).toBeNull();
  });

  it("while an answer runs: does not switch, does not abort the send, shows the notice, and still consumes", async () => {
    const signals: (AbortSignal | null | undefined)[] = [];
    spyAiFetch().mockImplementation((_url: unknown, init?: RequestInit) => {
      signals.push(init?.signal);
      return new Promise(() => {}); // an answer that never arrives
    });
    const consumed = vi.fn();
    const { rerender } = render(panel(null, consumed));
    await screen.findByText("message in t1");
    fireEvent.change(screen.getByPlaceholderText("Ask Claude about your tasks…"), { target: { value: "still thinking" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await waitFor(() => expect(signals.length).toBeGreaterThan(0));
    rerender(panel({ threadId: "t2", nonce: 1 }, consumed));
    expect(await screen.findByText(BUSY_NOTICE)).toBeInTheDocument();
    expect(consumed).toHaveBeenCalledTimes(1);
    rerender(panel(null, consumed));
    expect(screen.getByText("message in t1")).toBeInTheDocument();
    expect(screen.queryByText("message in t2")).toBeNull();
    expect(signals.every((s) => s?.aborted !== true)).toBe(true);
    expect(screen.getByText(BUSY_NOTICE)).toBeInTheDocument();
  });
});
