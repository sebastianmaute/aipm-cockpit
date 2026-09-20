// src/app/chat-panel.scope.test.tsx
//
// Scope/lifetime guards for the chat panel's in-flight send. Kept OUT of
// chat-panel.test.tsx (3022 lines) on purpose — this file owns the question
// "whose project does a turn that is still in flight belong to?".
//
// ★★★ WHY THE PANEL UNMOUNTING IS NOT ENOUGH ON ITS OWN. `submitPrompt`'s
// `stale()` reads three things (`grep -n "const stale = ()" -A 2
// src/app/chat-panel.tsx`): `cancelledRef`, `projectIdRef` vs the send's
// project, and the thread ref. Under the §548 load hold `task-manager.tsx`
// swaps the whole main-window tree for `PanelSkeleton` WITHOUT a projectId
// prop change, so the dying instance's projectId effect never fires and all
// three keep reading not-stale — while the dispatcher it closed over is still
// live, because `useStorageBackend` sits in `TaskManager`, which does not
// unmount.

import "fake-indexeddb/auto";
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { ChatPanel } from "./chat-panel";
import type { ToolDispatcher } from "./chat-tools";
import { defaultAiConfig as baseAiConfig } from "./settings-types";

// Same double chat-panel.test.tsx installs: the real store would hit IndexedDB
// and these tests never exercise Turso threads.
vi.mock("./chat-threads-store", () => ({
  loadThreads: vi.fn(async () => []),
  saveThread: vi.fn(async () => undefined),
  deleteThread: vi.fn(async () => undefined),
}));

vi.mock("./ai-usage-context", () => ({
  useAiUsageContext: vi.fn(() => ({
    sessionTotal: 0,
    sessionUsage: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 },
    weekTotal: 0,
    nextReset: new Date(),
    record: vi.fn(),
  })),
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

const AI_WITH_KEY = {
  ...baseAiConfig,
  enabled: true,
  consentAccepted: true,
  apiKey: "sk-test",
};

/** Minimal dispatcher double. `createTask` is THE observable of these tests:
 *  `runTool`'s `create_task` case calls it and nothing else does
 *  (`grep -n "d.createTask(" src/app/chat-tools.ts` — one hit). */
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

const usage = { input_tokens: 1, output_tokens: 1 };

/** ONE `create_task` call. Deliberately a single non-destructive entity write:
 *  `shouldStage` returns true only on `writes > 1` (or a destructive /
 *  invitation-sending call), so this turn takes the IMMEDIATE path that calls
 *  `runTool` — a second write tool here would stage instead, and the test
 *  would silently be exercising the review card rather than the tool loop.
 *  (`grep -n "return writes > 1" src/app/chat-proposal.ts`) */
const TOOL_TURN = {
  content: [
    {
      type: "tool_use",
      id: "t1",
      name: "create_task",
      input: { taskName: "A", assignee: "me", dueDate: "2026-06-10" },
    },
  ],
  stop_reason: "tool_use",
  usage,
};

function send(text = "add a task") {
  fireEvent.change(screen.getByPlaceholderText("Ask Claude about your tasks…"), {
    target: { value: text },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
}

describe("in-flight send vs. the panel's lifetime", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("cancels an in-flight send when the panel unmounts", async () => {
    // OBSERVABLE: `dispatcher.createTask`.
    //   WITHOUT the unmount cleanup — 1 call. The orphaned closure resumes
    //   after the release, `stale()` reads not-stale (nothing bumped any of
    //   its three refs), and the immediate path runs `create_task`.
    //   WITH it — 0 calls. The cleanup sets `cancelledRef`, so the `stale()`
    //   check between `await callClaude(...)` and the tool loop breaks out.
    let releaseFetch!: (r: Response) => void;
    // ★ Spied, and asserted below, as the POSITIVE CONTROL that the awaited
    //   continuation actually resumed after the release. Without it a run in
    //   which nothing ever resolved would report zero createTask calls too,
    //   and read as a pass.
    const jsonSpy = vi.fn(() => Promise.resolve(TOOL_TURN));
    const released = {
      ok: true,
      text: () => Promise.resolve(""),
      json: jsonSpy,
    } as unknown as Response;

    // The send's own AbortSignal, so the cleanup's second line (the
    // `abortRef.current?.abort()`) has an observable of its own — releasing
    // the HTTP request is a separate effect from breaking the loop, and a
    // mutant deleting it survives every other assertion here.
    const signals: AbortSignal[] = [];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
      (_url, init?: RequestInit) => {
        if (init?.signal) signals.push(init.signal);
        return new Promise<Response>((res) => { releaseFetch = res; });
      },
    );
    const dispatcher = makeDispatcher();

    const { unmount } = render(
      <ChatPanel lang="en-US" ai={AI_WITH_KEY} dispatcher={dispatcher} onAcceptConsent={vi.fn()} />,
    );
    send();

    // PRECONDITION, asserted rather than assumed: the send really left the
    // panel and is parked mid-await. A send that never started would make the
    // assertion below vacuous.
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    // Two-way pin: not-yet-aborted here is what makes the post-unmount read
    // below mean something. A one-sided `toBe(true)` would also pass against a
    // signal that had been aborted by something entirely unrelated.
    expect(signals).toHaveLength(1);
    expect(signals[0].aborted).toBe(false);

    unmount();

    expect(signals[0].aborted).toBe(true);

    await act(async () => {
      releaseFetch(released);
      // A macrotask turn drains every microtask the resumed chain queues —
      // res.json(), callClaude's return, and the awaited runTool.
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(jsonSpy).toHaveBeenCalledTimes(1);
    expect(dispatcher.createTask).not.toHaveBeenCalled();
  });

  it("still sends after a StrictMode double-invoked mount", async () => {
    // Review focus 4: the new cleanup runs on StrictMode's DISCARDED first
    // mount, which leaves `cancelledRef` true on the surviving instance. That
    // is only harmless because `submitPrompt` resets it at its own start
    // (`grep -n "cancelledRef.current = false" src/app/chat-panel.tsx` — one
    // hit, inside submitPrompt); delete that line and this test goes red
    // because `stale()` short-circuits BEFORE the first `callClaude`.
    //
    // OBSERVABLE: `fetch`. Wedged — 0 calls. Working — 1.
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(""),
      json: () => Promise.resolve({
        content: [{ type: "text", text: "hello" }],
        stop_reason: "end_turn",
        usage,
      }),
    } as unknown as Response);
    // PRECONDITION WITNESS: this prop is called from a mount effect with no
    // cleanup (`grep -n "saveChatConversation?.(" src/app/chat-panel.tsx`), so
    // TWO calls means the effect pass ran twice — and the cleanup pass React
    // runs BETWEEN those two passes is the one that fires the new unmount
    // cleanup. One call would mean StrictMode did not double-invoke here and
    // the test proves nothing.
    const saveChatConversation = vi.fn();

    render(
      <ChatPanel
        lang="en-US"
        ai={AI_WITH_KEY}
        dispatcher={makeDispatcher()}
        onAcceptConsent={vi.fn()}
        saveChatConversation={saveChatConversation}
      />,
      // ★★★ RTL's own option — NEVER a composed
      // `({children}) => <StrictMode>{children}</StrictMode>` wrapper, which
      // single-invokes the mount and makes this vacuous-but-green. See
      // `src/app/strictmode.meta.test.tsx`.
      { reactStrictMode: true },
    );
    expect(saveChatConversation.mock.calls.length).toBeGreaterThanOrEqual(2);

    send("hi");

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText("hello")).toBeInTheDocument());
  });
});
