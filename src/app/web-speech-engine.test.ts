import { describe, it, expect, vi, beforeEach } from "vitest";
import { createWebSpeechEngine } from "./web-speech-engine";

const stop = vi.fn();
let lastOpts: Record<string, unknown> | null = null;
let returnNull = false;
vi.mock("./voice", () => ({
  startRecognition: (opts: Record<string, unknown>) => { lastOpts = opts; return returnNull ? null : stop; },
}));

beforeEach(() => { stop.mockClear(); lastOpts = null; returnNull = false; });

describe("web-speech-engine", () => {
  it("starts continuous and routes handlers", () => {
    const h = { onInterim: vi.fn(), onFinal: vi.fn(), onError: vi.fn() };
    const eng = createWebSpeechEngine("en-US");
    expect(eng.start(h)).toBe(true);
    expect(lastOpts!.continuous).toBe(true);
    (lastOpts!.onFinal as (t: string) => void)("hi");
    expect(h.onFinal).toHaveBeenCalledWith("hi");
  });
  it("maps service-not-allowed to not-allowed", () => {
    const h = { onInterim: vi.fn(), onFinal: vi.fn(), onError: vi.fn() };
    createWebSpeechEngine("en-US").start(h);
    (lastOpts!.onError as (e: string) => void)("service-not-allowed");
    expect(h.onError).toHaveBeenCalledWith("not-allowed");
  });
  it("restart on onEnd only while active", () => {
    const h = { onInterim: vi.fn(), onFinal: vi.fn(), onError: vi.fn() };
    const eng = createWebSpeechEngine("en-US");
    eng.start(h);
    (lastOpts!.onEnd as () => void)(); // active → restarts
    eng.stop();
    const stopCalls = stop.mock.calls.length;
    (lastOpts!.onEnd as () => void)(); // after stop → no restart
    expect(stop.mock.calls.length).toBe(stopCalls);
  });
  it("reports not-supported when startRecognition returns null", () => {
    returnNull = true;
    const h = { onInterim: vi.fn(), onFinal: vi.fn(), onError: vi.fn() };
    expect(createWebSpeechEngine("en-US").start(h)).toBe(false);
    expect(h.onError).toHaveBeenCalledWith("not-supported");
  });
});
