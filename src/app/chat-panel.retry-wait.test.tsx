// §798 — the chat shows a rate-limit retry wait as a countdown in its busy row, Stop ends the wait and sends
// nothing more, and a timed-out request is named as a timeout (never "Stopped"). The real transport runs over a
// stubbed fetch: a 429 with `retry-after` is what makes it wait. Fake timers throughout: no wait is real.
import "fake-indexeddb/auto";
import "../test/ai-consent-live";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("./ai-privacy-context", () => import("../test/ai-privacy-unprotected"));
vi.mock("./chat-threads-store", () => ({
  loadThreads: vi.fn(async () => []),
  saveThread: vi.fn(async () => undefined),
  deleteThread: vi.fn(async () => undefined),
  expireThreads: vi.fn(async () => undefined),
}));
import { ChatPanel } from "./chat-panel";
import { newConsent } from "./ai-consent";
import { defaultAiConfig } from "./settings-types";
import { setAiDeploymentState } from "./ai-deployment";
import { __setAiStatusRequestForTests } from "./ai-status-request";
import { AI_REQUEST_TIMEOUT_MS } from "./ai-retry";
import { aiStatusResponse, DIRECT_AI_STATUS } from "../test/ai-status-fetch";
import { loadI18n, t, type Lang } from "./i18n";
import type { ToolDispatcher } from "./chat-tools";

const AI = { ...defaultAiConfig, enabled: true, consent: newConsent(new Date(0)), apiKey: "sk-ant-api03-test" };
const SCOPE_PROPS = { getScopeEpoch: () => 0, isSwapInFlight: () => false };
const MESSAGES_URL = "https://api.anthropic.com/v1/messages";

function makeDispatcher(): ToolDispatcher {
  return {
    getSnapshot: vi.fn(() => ({
      today: "2026-06-04", language: "en-US", holidayCountries: [], storageKind: "memory", taskCount: 0,
      knownGroups: [], knownLabels: [], mode: "advanced" as const, enabledModules: [] as string[],
      currentView: "open-points" as const,
    })),
  } as unknown as ToolDispatcher;
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
const limited = (retryAfterS: number) =>
  json({ type: "error", error: { type: "rate_limit_error", message: "slow down" } }, 429, { "retry-after": String(retryAfterS) });
const done = () => json({ content: [{ type: "text", text: "Done." }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } });

/** The status request answers the direct route; each message send answers the next reply (the last repeats). */
function stubFetch(replies: Array<() => Response | Promise<Response>>) {
  let n = 0;
  const mock = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    if (url === "/api/ai/status") return aiStatusResponse(DIRECT_AI_STATUS);
    if (url !== MESSAGES_URL) return new Response("", { status: 404 });
    return replies[Math.min(n++, replies.length - 1)]();
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}
const sends = (m: ReturnType<typeof stubFetch>) => m.mock.calls.filter((c) => String(c[0]) === MESSAGES_URL);

function renderChat(lang: Lang = "en-US") {
  return render(<ChatPanel {...SCOPE_PROPS} lang={lang} ai={AI} dispatcher={makeDispatcher()} projectId="p1" />);
}

function send(lang: Lang, text: string) {
  fireEvent.change(screen.getByPlaceholderText(t(lang, "chatPlaceholder")), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: t(lang, "chatSend") }));
}

/** Let pending promises and zero-delay timers run (RTL's `findBy*` cannot poll under fake timers). */
async function flush(rounds = 20) {
  for (let i = 0; i < rounds; i++) {
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  }
}

async function advance(ms: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
  await flush();
}

beforeEach(() => {
  __setAiStatusRequestForTests(null);
  setAiDeploymentState(DIRECT_AI_STATUS);
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("the chat's retry wait", () => {
  it("the chat shows the wait and counts down", async () => {
    let answer: (r: Response) => void = () => {};
    const second = new Promise<Response>((resolve) => { answer = resolve; });
    const f = stubFetch([() => limited(12), () => second]);
    renderChat();
    send("en-US", "Status?");
    await flush();
    expect(sends(f)).toHaveLength(1);
    expect(screen.getByText(t("en-US", "chatRetryWait", 12))).toBeTruthy();
    expect(t("en-US", "chatRetryWait", 12)).toBe("Claude is busy, trying again in 12 s…");
    expect(screen.queryByText(t("en-US", "chatThinking"))).toBeNull();

    await advance(5000);
    expect(screen.getByText(t("en-US", "chatRetryWait", 7))).toBeTruthy();
    expect(screen.queryByText(t("en-US", "chatRetryWait", 12))).toBeNull();

    // The wait is over: the next attempt is out and the row says Thinking again.
    await advance(7000);
    expect(sends(f)).toHaveLength(2);
    expect(screen.getByText(t("en-US", "chatThinking"))).toBeTruthy();
    expect(screen.queryByText(/trying again in/)).toBeNull();

    answer(done());
    await flush();
    expect(screen.getByText("Done.")).toBeTruthy();
  });

  // Review Focus 5.
  it("Stop during the wait ends it, says Stopped and sends nothing more", async () => {
    const f = stubFetch([() => limited(12), () => done()]);
    renderChat();
    send("en-US", "Status?");
    await flush();
    expect(screen.getByText(t("en-US", "chatRetryWait", 12))).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: t("en-US", "chatStopGenerating") }));
    await flush();
    expect(screen.queryByText(/trying again in/)).toBeNull();
    expect(screen.getByText(t("en-US", "chatStopped"))).toBeTruthy();

    await advance(60_000);
    expect(sends(f)).toHaveLength(1);
    expect(screen.queryByText("Done.")).toBeNull();
  });

  // A send that a project switch cancels during its wait ends (its `finally` runs) before the next send
  // can start: the composer stays locked while it is in flight, and `submitPrompt` bails while
  // `abortRef` is set. So the old send clears its own wait line, and the next send starts clean.
  it("a project switch during the wait ends that send first; the next send's row is its own", async () => {
    let answer: (r: Response) => void = () => {};
    const second = new Promise<Response>((resolve) => { answer = resolve; });
    const f = stubFetch([() => limited(12), () => second]);
    const view = renderChat();
    send("en-US", "Status?");
    await flush();
    expect(screen.getByText(t("en-US", "chatRetryWait", 12))).toBeTruthy();
    // While the first send is in flight there is no Send button to start another one.
    expect(screen.queryByRole("button", { name: t("en-US", "chatSend") })).toBeNull();
    // Nor does Enter in the composer: the second submit bails and nothing more goes out.
    const composer = screen.getByPlaceholderText(t("en-US", "chatPlaceholder"));
    fireEvent.change(composer, { target: { value: "Again?" } });
    fireEvent.keyDown(composer, { key: "Enter" });
    await flush();
    expect(sends(f)).toHaveLength(1);
    expect(screen.getByText(t("en-US", "chatRetryWait", 12))).toBeTruthy();

    view.rerender(<ChatPanel {...SCOPE_PROPS} lang="en-US" ai={AI} dispatcher={makeDispatcher()} projectId="p2" />);
    await flush();
    expect(screen.queryByText(/trying again in/)).toBeNull();

    send("en-US", "And now?");
    await flush();
    expect(sends(f)).toHaveLength(2);
    expect(screen.getByText(t("en-US", "chatThinking"))).toBeTruthy();
    expect(screen.queryByText(/trying again in/)).toBeNull();

    // The cancelled send's wait is gone for good: nothing more goes out when it would have ended.
    await advance(12_000);
    expect(sends(f)).toHaveLength(2);
    expect(screen.queryByText(/trying again in/)).toBeNull();

    answer(done());
    await flush();
    expect(screen.getByText("Done.")).toBeTruthy();
  });

  it("a timeout shows the timeout message, not Stopped", async () => {
    const f = stubFetch([() => new Promise<Response>(() => {})]);
    renderChat();
    send("en-US", "Status?");
    await flush();
    await advance(AI_REQUEST_TIMEOUT_MS);
    expect(sends(f)).toHaveLength(1);
    expect(screen.getByText(t("en-US", "aiRequestTimedOut"))).toBeTruthy();
    expect(screen.queryByText(t("en-US", "chatStopped"))).toBeNull();
  });
});

describe("the chat's retry wait in German", () => {
  beforeAll(async () => {
    await loadI18n("de");
  });

  it("the DE wait line", async () => {
    stubFetch([() => limited(12), () => new Promise<Response>(() => {})]);
    renderChat("de");
    send("de", "Stand?");
    await flush();
    expect(screen.getByText("Claude ist ausgelastet, neuer Versuch in 12 s…")).toBeTruthy();
  });

  it("a timeout shows the DE timeout message", async () => {
    stubFetch([() => new Promise<Response>(() => {})]);
    renderChat("de");
    send("de", "Stand?");
    await flush();
    await advance(AI_REQUEST_TIMEOUT_MS);
    expect(screen.getByText("Claude hat nicht innerhalb von 5 Minuten geantwortet. Versuchen Sie es erneut.")).toBeTruthy();
    expect(screen.queryByText(t("de", "chatStopped"))).toBeNull();
  });
});
