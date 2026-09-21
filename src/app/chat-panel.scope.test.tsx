// src/app/chat-panel.scope.test.tsx
//
// Scope/lifetime guards for the chat panel's in-flight send. Kept OUT of
// chat-panel.test.tsx on purpose — this file owns the question "whose project
// does a turn that is still in flight belong to?".
//
// ★★★ WHY THE PANEL UNMOUNTING IS NOT ENOUGH ON ITS OWN. `submitPrompt`'s
// `stale()` reads FOUR things (`grep -n "const stale = ()" -A 2
// src/app/chat-panel.tsx` — read the hits): `cancelledRef`, `projectIdRef` vs
// the send's project, the thread ref, and `isScopeStale(getScopeEpoch,
// sendEpoch)`. Under the §548 load hold `task-manager.tsx` swaps the whole
// main-window tree for `PanelSkeleton` WITHOUT a projectId prop change, so the
// dying instance's projectId effect never fires and the first THREE keep
// reading not-stale — while the dispatcher it closed over is still live,
// because `useStorageBackend` sits in `TaskManager`, which does not unmount.
// ★★★ THE FOURTH IS NOT OPTIONAL AND THIS HEADER USED TO OMIT IT, describing
// pre-§596 code as current. That is not a tidy-up: read as a complete list it
// licenses deleting the `isScopeStale` clause as "not one of the three" — and
// a mutant doing exactly that SURVIVED every other test in this file, which is
// why "makes no further API call once the scope has moved mid-turn" exists. A
// stale census of a guard is a licence to remove the part it forgot.

import "fake-indexeddb/auto";
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { ChatPanel } from "./chat-panel";
import { isValidAnthropicApiKey } from "./chat-models";
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

/** ★★★ `"sk-test"` IS LOAD-BEARING AND READS AS ARBITRARY. It deliberately FAILS
 *  `isValidAnthropicApiKey` (`/^sk-ant-[A-Za-z0-9_-]{16,}$/`), which is what keeps
 *  `useChatModels` from firing its own `GET /v1/models` on mount. Every test here
 *  asserts `fetch` call COUNTS and several park the first call's promise, so a
 *  second, unrelated request would break the preconditions and the parking alike.
 *  Tidy this into a realistic-looking `sk-ant-…` and the whole file changes
 *  meaning — the guard test in the first describe fails first and says so. */
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

/** The epoch reader every test that does not care about the epoch passes: a
 *  frozen scope.
 *
 *  ★ SHARING ONE CONST IS SAFE HERE ONLY BECAUSE IT CLOSES OVER NOTHING. It
 *   returns a literal, so no test can move what another test reads. A reader that
 *   closes over a mutable `let` must NEVER be hoisted like this — that is how one
 *   test's epoch bump leaks into the next. The tests that DO move the epoch
 *   (`sendAcrossEpoch` and the two multi-tool cases) therefore each declare their
 *   own `let epoch` and their own inline `() => epoch`. */
const FROZEN_EPOCH = () => 0;

/** A `fetch` reply carrying `body` as its JSON. Only the three members
 *  `callClaude` touches are present — `ok`, `text` (the error path) and `json`. */
function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    text: () => Promise.resolve(""),
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

function send(text = "add a task") {
  fireEvent.change(screen.getByPlaceholderText("Ask Claude about your tasks…"), {
    target: { value: text },
  });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
}

describe("in-flight send vs. the panel's lifetime", () => {
  // ★ ONE restore, not two. `vitest.config.ts` sets no `restoreMocks`, so this is
  //   doing real work — but a `beforeEach` doing the same thing cannot add any:
  //   nothing in this file spies outside a test body, so after this hook has run
  //   once there is never anything left over for a `beforeEach` to clean up.
  afterEach(() => vi.restoreAllMocks());

  it("fixture guard: the test API key is deliberately NOT a well-formed Anthropic key", () => {
    // Executable form of the comment at `AI_WITH_KEY`. A key that passed this
    // would make `useChatModels` issue a second `fetch` on every mount here, and
    // every call-count assertion in this file would start failing for a reason
    // that has nothing to do with what it is testing.
    expect(isValidAnthropicApiKey(AI_WITH_KEY.apiKey)).toBe(false);
  });

  /** The shared body of the unmount PAIR below. Renders, parks the send
   *  mid-await, unmounts, releases the response, and hands back what both
   *  branches assert on.
   *
   *  ★★★ ONE BODY, ONE PARAMETER, AND THAT IS THE POINT. The discriminator under
   *   test is `isSwapInFlight` and nothing else; two hand-copied bodies would let
   *   some other difference creep in and still read as a pair. A single-sided
   *   version of this pair is literally how the regression got in — Task 6 pinned
   *   the cancel and nothing pinned the not-cancel, so an UNCONDITIONAL cleanup
   *   was green while it silently killed every turn a user left by navigating to
   *   Open Points (`modern-shell.tsx`'s view ternary unmounts this subtree). */
  async function unmountMidSend(swapInFlight: boolean) {
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
      <ChatPanel
        lang="en-US"
        ai={AI_WITH_KEY}
        dispatcher={dispatcher}
        onAcceptConsent={vi.fn()}
        getScopeEpoch={FROZEN_EPOCH}
        isSwapInFlight={() => swapInFlight}
      />,
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
    // Read BEFORE the release, because the abort is the cleanup's own effect and
    // must be attributed to the unmount rather than to anything downstream.
    const abortedAtUnmount = signals[0].aborted;

    await act(async () => {
      releaseFetch(released);
      // A macrotask turn drains every microtask the resumed chain queues —
      // res.json(), callClaude's return, and the awaited runTool.
      await new Promise((r) => setTimeout(r, 0));
    });

    return { dispatcher, jsonSpy, abortedAtUnmount };
  }

  it("cancels an in-flight send when the panel unmounts under a swap", async () => {
    // The §548 case: `task-manager.tsx` swapped the whole main-window tree for
    // `PanelSkeleton` because a project op is in flight, so this teardown IS the
    // swap. OBSERVABLE: `dispatcher.createTask`.
    //   WITHOUT the unmount cleanup — 1 call. The orphaned closure resumes after
    //   the release, `stale()` reads not-stale (nothing bumped any of its three
    //   refs — the epoch has not moved yet either, it bumps only when the
    //   incoming workspace is applied), and the immediate path runs `create_task`.
    //   WITH it — 0 calls. The cleanup sets `cancelledRef`, so the `stale()`
    //   check between `await callClaude(...)` and the tool loop breaks out.
    const { dispatcher, jsonSpy, abortedAtUnmount } = await unmountMidSend(true);

    // ★★ A PRESENCE PIN, NOT A BEHAVIOURAL ONE, and it should be read as exactly
    //   that: it observes the MUTATED LINE itself. Delete `abortRef.current
    //   ?.abort()` and of course the signal is not aborted — the assertion cannot
    //   fail for any other reason, so it proves the call happens and nothing about
    //   what the call achieves. The CONSEQUENCE — the HTTP request actually being
    //   released — is not observed anywhere in this file.
    // ★★ THAT IS A TRADE, not an oversight. Observing the consequence means a
    //   `fetch` double that REJECTS on abort, and then the awaited `callClaude`
    //   throws before `stale()` is ever consulted — which would silently delete
    //   this test's other half, the `cancelledRef` loop break that the release
    //   path below is what pins. Keeping the release shape keeps both lines under
    //   test, one behaviourally and one by presence. A consequence test needs its
    //   own case with its own double; it is not a stronger version of this one.
    expect(abortedAtUnmount).toBe(true);
    // POSITIVE CONTROL: the awaited continuation really did resume after the
    // release. Without it a run in which nothing ever resolved would report zero
    // createTask calls too, and read as a pass.
    expect(jsonSpy).toHaveBeenCalledTimes(1);
    expect(dispatcher.createTask).not.toHaveBeenCalled();
  });

  it("lets an in-flight send finish when the panel unmounts with no swap in flight", async () => {
    // ★★★ THE OPEN POINTS CASE, and a live regression against Task 6's
    //  UNCONDITIONAL cleanup. `modern-shell.tsx`'s content ternary renders
    //  `open-points`, `settings` and `learning-insights` as their own subtrees and
    //  everything else as `workspace`, so navigating to any of the three unmounts
    //  this panel on an ORDINARY click. A user who asks the assistant to create
    //  tasks and then clicks Open Points to watch them appear must still get them.
    //  ★★ Do not read AGENTS.md's "the chat panel NEVER remounts" as covering
    //  this: that is about TAB switches inside `workspace-section`, which keep
    //  `panel-chat` mounted and merely `hidden`. Both claims are true and they are
    //  about different things.
    // OBSERVABLE: `dispatcher.createTask` — ONE call, not zero.
    const { dispatcher, jsonSpy, abortedAtUnmount } = await unmountMidSend(false);

    // Two-way with the branch above: the request must NOT have been aborted, or
    // "the turn finished" would be true for a reason the condition did not cause.
    expect(abortedAtUnmount).toBe(false);
    expect(jsonSpy).toHaveBeenCalledTimes(1);
    expect(dispatcher.createTask).toHaveBeenCalledTimes(1);
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
        getScopeEpoch={FROZEN_EPOCH}
        // ★★ TRUE on purpose: StrictMode's DISCARDED first mount must fire the
        //   cleanup for this test to be about anything, and after this task the
        //   cleanup only fires under a swap. With `false` the test still passes —
        //   and proves nothing, because no `cancelledRef` was ever left set for
        //   `submitPrompt`'s reset to clear.
        isSwapInFlight={() => true}
      />,
      // ★★★ RTL's own option — NEVER a composed
      // `({children}) => <StrictMode>{children}</StrictMode>` wrapper, which
      // single-invokes the mount and makes this vacuous-but-green. See
      // `src/app/strictmode.meta.test.tsx`.
      { reactStrictMode: true },
    );
    // ★★ EXACTLY 2, not `>= 2`. The claim this witness exists to make is
    //   "StrictMode DOUBLE-invoked the mount", and `>= 2` cannot tell that from
    //   three mounts or from an effect re-firing on a dependency change — it
    //   proves "at least double", which is a different and weaker claim than the
    //   one the non-vacuity argument below rests on. If this ever goes red at 3,
    //   the right response is to find out what mounted a third time, not to
    //   loosen the comparison back.
    expect(saveChatConversation).toHaveBeenCalledTimes(2);

    send("hi");

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText("hello")).toBeInTheDocument());
  });
});

describe("in-flight send vs. the storage scope", () => {
  afterEach(() => vi.restoreAllMocks()); // see the note on the sibling describe's hook

  /** Parks a send mid-await, moves the epoch to `epochAtRelease`, then releases a
   *  one-`create_task` turn. The pair below differ in THAT NUMBER ALONE.
   *
   *  ★★★ THE PANEL STAYS MOUNTED AND THE PROJECT ID NEVER CHANGES, which is the
   *   whole case: a Turso URL/token change, a SharePoint target swap and a
   *   same-project reload all replace the workspace while `projectId` holds, so
   *   `stale()`'s three original reads are STRUCTURALLY blind to them. Only the
   *   epoch moves. (It is also why this is not folded into the unmount pair
   *   above — that one tests a lifetime, this one tests a target.) */
  async function sendAcrossEpoch(epochAtRelease: number) {
    let epoch = 1;
    let releaseFetch!: (r: Response) => void;
    const jsonSpy = vi.fn(() => Promise.resolve(TOOL_TURN));
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
      () => new Promise<Response>((res) => { releaseFetch = res; }),
    );
    const dispatcher = makeDispatcher();

    render(
      <ChatPanel
        lang="en-US"
        ai={AI_WITH_KEY}
        dispatcher={dispatcher}
        onAcceptConsent={vi.fn()}
        getScopeEpoch={() => epoch}
        // FALSE throughout: no unmount happens here, and a true would only
        // muddy which guard the result is attributable to.
        isSwapInFlight={() => false}
      />,
    );
    send("add a task");

    // PRECONDITION, asserted not assumed: the send really left the panel and is
    // parked mid-await. Task 6 learned this the hard way — a send that never
    // started makes the final assertion vacuous.
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));

    epoch = epochAtRelease;
    await act(async () => {
      releaseFetch({
        ok: true,
        text: () => Promise.resolve(""),
        json: jsonSpy,
      } as unknown as Response);
      await new Promise((r) => setTimeout(r, 0));
    });
    return { dispatcher, jsonSpy };
  }

  it("drops a tool write when the storage target changed but the project id did not", async () => {
    // OBSERVABLE: `dispatcher.createTask`. Unguarded — 1 call, into whatever
    // workspace the new target just installed. Guarded — 0.
    const { dispatcher, jsonSpy } = await sendAcrossEpoch(2);

    // POSITIVE CONTROL: the awaited continuation resumed. A run in which nothing
    // ever resolved would also report zero createTask calls.
    expect(jsonSpy).toHaveBeenCalledTimes(1);
    expect(dispatcher.createTask).not.toHaveBeenCalled();
  });

  it("still runs the tool when the scope never moved", async () => {
    // ★★ THE ANTI-VACUITY HALF, and it is not optional: without it "0 calls"
    //  above is satisfied by a fixture that could never have written at all —
    //  a staged turn, a wedged send, a dispatcher never reached. Same helper,
    //  same release, epoch left where it started.
    const { dispatcher } = await sendAcrossEpoch(1);
    expect(dispatcher.createTask).toHaveBeenCalledTimes(1);
  });

  it("stops a multi-tool turn at the tool where the scope changed", async () => {
    // ★★★ THE CASE `stale()` STRUCTURALLY CANNOT REACH. All three of its call
    //  sites run BEFORE the `for (const block of response.content)` loop, so an
    //  epoch that moves BETWEEN two tools of the SAME turn is invisible to every
    //  one of them and the remaining tools write into the next project. A fixture
    //  that moved the epoch before the send started would be caught by the
    //  loop-top check and would pass with the per-tool guard DELETED — the
    //  vacuous shape. Here the FIRST TOOL moves it, mid-turn.
    let epoch = 1;
    const dispatcher = makeDispatcher();
    // The swap lands during the first tool — a READ, so `writes` stays 1 and the
    // turn takes the immediate path. ★★ Two ENTITY WRITE tools here would make
    // `shouldStage` (`writes > 1`) route the turn to the REVIEW CARD, which never
    // reaches this loop at all: the test would then be green or red for reasons
    // having nothing to do with the guard.
    vi.mocked(dispatcher.listTasks).mockImplementation(() => { epoch = 2; return []; });

    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      text: () => Promise.resolve(""),
      json: () => Promise.resolve({
        content: [
          { type: "tool_use", id: "t1", name: "list_tasks", input: {} },
          {
            type: "tool_use", id: "t2", name: "create_task",
            input: { taskName: "A", assignee: "me", dueDate: "2026-06-10" },
          },
        ],
        stop_reason: "tool_use",
        usage,
      }),
    } as unknown as Response);

    render(
      <ChatPanel
        lang="en-US"
        ai={AI_WITH_KEY}
        dispatcher={dispatcher}
        onAcceptConsent={vi.fn()}
        getScopeEpoch={() => epoch}
        isSwapInFlight={() => false}
      />,
    );
    send("list them then add a task");

    // POSITIVE CONTROL: the first tool really ran, so a zero on the second means
    // "dropped", not "the turn never got there".
    await waitFor(() => expect(dispatcher.listTasks).toHaveBeenCalledTimes(1));
    // ★★ AND THEN DRAIN. `waitFor` resolves the instant the FIRST tool has run,
    //  which is one `await` before the second would — asserting straight off it
    //  reads a moment at which an UNGUARDED loop has not reached `create_task`
    //  either, and passes against the deleted guard. A macrotask turn lets the
    //  whole chain finish first.
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(dispatcher.createTask).not.toHaveBeenCalled();
  });

  it("makes no further API call once the scope has moved mid-turn", async () => {
    // ★★★ THIS TEST EXISTS BECAUSE A MUTANT SURVIVED. Deleting the epoch clause
    //  from `stale()` left the whole suite green: for a TOOL WRITE the per-tool
    //  guard fires first, so the two guards are indistinguishable on
    //  `createTask`. The clause earns its place on a DIFFERENT observable — the
    //  NEXT round trip. Without it an orphaned send keeps calling (and billing)
    //  the API and keeps appending the model's text to a transcript that now
    //  belongs to another storage target; the per-tool guard cannot see that,
    //  because it only ever guards a tool.
    // OBSERVABLE: `fetch` call count. Guarded — 1. Unguarded — 2.
    let epoch = 1;
    const dispatcher = makeDispatcher();
    vi.mocked(dispatcher.listTasks).mockImplementation(() => { epoch = 2; return []; });

    const fetchSpy = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(jsonResponse({
        content: [{ type: "tool_use", id: "t1", name: "list_tasks", input: {} }],
        stop_reason: "tool_use",
        usage,
      }))
      // A plain `list_tasks` is not an entity write, so `shouldStage` stays false
      // and this turn takes the immediate path — the tool runs, moves the epoch,
      // and the loop comes back around for a second round trip it must not make.
      .mockResolvedValue(jsonResponse({
        content: [{ type: "text", text: "second round trip" }],
        stop_reason: "end_turn",
        usage,
      }));

    render(
      <ChatPanel
        lang="en-US"
        ai={AI_WITH_KEY}
        dispatcher={dispatcher}
        onAcceptConsent={vi.fn()}
        getScopeEpoch={() => epoch}
        isSwapInFlight={() => false}
      />,
    );
    send("list them");

    await waitFor(() => expect(dispatcher.listTasks).toHaveBeenCalledTimes(1));
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    // The second turn's text is the same claim seen from the transcript side —
    // an absence assertion, so it rides ALONGSIDE the count, never instead of it.
    expect(screen.queryByText("second round trip")).toBeNull();
  });
});
