import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createWebSpeechEngine } from "./web-speech-engine";
import { __setAiStatusRequestForTests } from "./ai-status-request";
import { DICTATION_PEOPLE_FORCED, DICTATION_PEOPLE_LOCK_UNCONFIRMED } from "./dictation-engine";
import { isIntegrationDisabled, setDisabledIntegrations } from "./integration-switches";
import { aiStatusResponse, DIRECT_AI_STATUS } from "../test/ai-status-fetch";

const stop = vi.fn();
let lastOpts: Record<string, unknown> | null = null;
let returnNull = false;
let startCallCount = 0;
let noCtor = false;
vi.mock("./voice", () => ({
  getCtor: () => (noCtor ? null : function Recognition() {}),
  startRecognition: (opts: Record<string, unknown>) => {
    startCallCount += 1;
    lastOpts = opts;
    return returnNull ? null : stop;
  },
}));

beforeEach(() => { stop.mockClear(); lastOpts = null; returnNull = false; noCtor = false; startCallCount = 0; });
afterEach(() => setDisabledIntegrations([]));

/** §789: the start-time lock check resolves on a microtask; let it land. */
const settle = () => new Promise<void>((r) => setTimeout(r, 0));

describe("web-speech-engine", () => {
  it("starts continuous and routes handlers", async () => {
    const h = { onInterim: vi.fn(), onFinal: vi.fn(), onError: vi.fn() };
    const eng = createWebSpeechEngine("en-US");
    expect(eng.start(h)).toBe(true);
    await settle();
    expect(lastOpts!.continuous).toBe(true);
    (lastOpts!.onFinal as (t: string) => void)("hi");
    expect(h.onFinal).toHaveBeenCalledWith("hi");
  });
  it("maps service-not-allowed to not-allowed", async () => {
    const h = { onInterim: vi.fn(), onFinal: vi.fn(), onError: vi.fn() };
    createWebSpeechEngine("en-US").start(h);
    await settle();
    (lastOpts!.onError as (e: string) => void)("service-not-allowed");
    expect(h.onError).toHaveBeenCalledWith("not-allowed");
  });
  it("restart on onEnd only while active", async () => {
    const h = { onInterim: vi.fn(), onFinal: vi.fn(), onError: vi.fn() };
    const eng = createWebSpeechEngine("en-US");
    eng.start(h);
    await settle();
    (lastOpts!.onEnd as () => void)(); // active → restarts
    eng.stop();
    const stopCalls = stop.mock.calls.length;
    (lastOpts!.onEnd as () => void)(); // after stop → no restart
    expect(stop.mock.calls.length).toBe(stopCalls);
  });
  it("does NOT restart after a terminal not-allowed error", async () => {
    const h = { onInterim: vi.fn(), onFinal: vi.fn(), onError: vi.fn() };
    const eng = createWebSpeechEngine("en-US");
    eng.start(h);
    await settle();
    expect(startCallCount).toBe(1);
    (lastOpts!.onError as (e: string) => void)("not-allowed");
    expect(h.onError).toHaveBeenCalledWith("not-allowed");
    (lastOpts!.onEnd as () => void)(); // must NOT call begin() again
    expect(startCallCount).toBe(1);
  });
  it("does NOT restart after a terminal audio-capture error", async () => {
    const h = { onInterim: vi.fn(), onFinal: vi.fn(), onError: vi.fn() };
    const eng = createWebSpeechEngine("en-US");
    eng.start(h);
    await settle();
    expect(startCallCount).toBe(1);
    (lastOpts!.onError as (e: string) => void)("audio-capture");
    (lastOpts!.onEnd as () => void)();
    expect(startCallCount).toBe(1);
  });
  it("still restarts after a non-terminal error (e.g. network)", async () => {
    const h = { onInterim: vi.fn(), onFinal: vi.fn(), onError: vi.fn() };
    const eng = createWebSpeechEngine("en-US");
    eng.start(h);
    await settle();
    expect(startCallCount).toBe(1);
    (lastOpts!.onError as (e: string) => void)("network");
    (lastOpts!.onEnd as () => void)();
    expect(startCallCount).toBe(2);
  });
  it("reports not-supported, synchronously, when the browser has no recogniser", async () => {
    noCtor = true;
    const request = vi.fn(() => Promise.resolve(aiStatusResponse(DIRECT_AI_STATUS)));
    __setAiStatusRequestForTests(request);
    const h = { onInterim: vi.fn(), onFinal: vi.fn(), onError: vi.fn() };
    expect(createWebSpeechEngine("en-US").start(h)).toBe(false);
    expect(h.onError).toHaveBeenCalledWith("not-supported");
    expect(request).not.toHaveBeenCalled();
  });
  it("reports not-supported when startRecognition returns null after a clear check", async () => {
    returnNull = true;
    const h = { onInterim: vi.fn(), onFinal: vi.fn(), onError: vi.fn() };
    createWebSpeechEngine("en-US").start(h);
    await settle();
    expect(h.onError).toHaveBeenCalledWith("not-supported");
  });
});

describe("web-speech-engine — §789 people lock checked at each start", () => {
  it("asks the status route before listening, and listens on a clear answer", async () => {
    const request = vi.fn(() => Promise.resolve(aiStatusResponse(DIRECT_AI_STATUS)));
    __setAiStatusRequestForTests(request);
    const h = { onInterim: vi.fn(), onFinal: vi.fn(), onError: vi.fn() };
    createWebSpeechEngine("en-US").start(h);
    expect(request).toHaveBeenCalledTimes(1);
    expect(startCallCount).toBe(0); // nothing listens before the answer
    await settle();
    expect(startCallCount).toBe(1);
    expect(h.onError).not.toHaveBeenCalled();
  });
  it("a lock the organisation added since page load starts nothing and reports people-forced", async () => {
    __setAiStatusRequestForTests(() => Promise.resolve(aiStatusResponse({ ...DIRECT_AI_STATUS, peopleForced: true })));
    const h = { onInterim: vi.fn(), onFinal: vi.fn(), onError: vi.fn() };
    createWebSpeechEngine("en-US").start(h);
    await settle();
    expect(startCallCount).toBe(0);
    expect(h.onError).toHaveBeenCalledWith(DICTATION_PEOPLE_FORCED);
    expect(isIntegrationDisabled("ai-people")).toBe(true);
  });
  it("fails closed: no answer starts nothing and reports people-lock-unconfirmed", async () => {
    __setAiStatusRequestForTests(() => Promise.reject(new TypeError("Failed to fetch")));
    const h = { onInterim: vi.fn(), onFinal: vi.fn(), onError: vi.fn() };
    createWebSpeechEngine("en-US").start(h);
    await settle();
    expect(startCallCount).toBe(0);
    expect(h.onError).toHaveBeenCalledWith(DICTATION_PEOPLE_LOCK_UNCONFIRMED);
  });
  it("a stop while the check is out wins: no recogniser is ever created", async () => {
    const h = { onInterim: vi.fn(), onFinal: vi.fn(), onError: vi.fn() };
    const eng = createWebSpeechEngine("en-US");
    eng.start(h);
    eng.stop();
    await settle();
    expect(startCallCount).toBe(0);
    expect(h.onError).not.toHaveBeenCalled();
  });
  it("a stop and a new start while the first check is out listen once, for the new hold", async () => {
    const first = { onInterim: vi.fn(), onFinal: vi.fn(), onError: vi.fn() };
    const second = { onInterim: vi.fn(), onFinal: vi.fn(), onError: vi.fn() };
    const eng = createWebSpeechEngine("en-US");
    eng.start(first);
    eng.stop();
    eng.start(second);
    await settle();
    expect(startCallCount).toBe(1);
    (lastOpts!.onFinal as (t: string) => void)("hi");
    expect(second.onFinal).toHaveBeenCalledWith("hi");
    expect(first.onFinal).not.toHaveBeenCalled();
  });
  it("silence-gap restarts within one hold are not checked again", async () => {
    const request = vi.fn(() => Promise.resolve(aiStatusResponse(DIRECT_AI_STATUS)));
    __setAiStatusRequestForTests(request);
    const h = { onInterim: vi.fn(), onFinal: vi.fn(), onError: vi.fn() };
    createWebSpeechEngine("en-US").start(h);
    await settle();
    (lastOpts!.onEnd as () => void)();
    expect(startCallCount).toBe(2);
    expect(request).toHaveBeenCalledTimes(1);
  });
});
