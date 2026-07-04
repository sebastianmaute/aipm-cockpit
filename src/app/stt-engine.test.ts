import { describe, it, expect, vi, beforeEach } from "vitest";
import { createSttEngine } from "./stt-engine";

class FakeRecorder {
  state = "inactive"; mimeType = "audio/webm";
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor(public stream: unknown) {}
  start() { this.state = "recording"; this.ondataavailable?.({ data: new Blob(["x"], { type: "audio/webm" }) }); }
  stop() { this.state = "inactive"; this.onstop?.(); }
}
const track = { stop: vi.fn() };
const getUserMedia = vi.fn(async () => ({ getTracks: () => [track] }));

beforeEach(() => {
  track.stop.mockClear();
  (globalThis as unknown as { MediaRecorder: unknown }).MediaRecorder = FakeRecorder;
  (globalThis.navigator as unknown as { mediaDevices: unknown }).mediaDevices = { getUserMedia };
  getUserMedia.mockResolvedValue({ getTracks: () => [track] });
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ text: "hello" }) })));
});

const cfg = { lang: "en-US" as const, baseUrl: "https://api.openai.com/v1", model: "whisper-1", apiKey: "sk-test" };

describe("stt-engine", () => {
  it("records, transcribes on stop, emits final + status", async () => {
    const h = { onInterim: vi.fn(), onFinal: vi.fn(), onError: vi.fn(), onStatus: vi.fn() };
    const eng = createSttEngine(cfg);
    expect(eng.start(h)).toBe(true);
    await Promise.resolve(); await Promise.resolve();
    eng.stop();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(h.onStatus).toHaveBeenCalledWith("transcribing");
    expect(h.onFinal).toHaveBeenCalledWith("hello");
    expect(h.onStatus).toHaveBeenLastCalledWith("idle");
    expect(track.stop).toHaveBeenCalled();
  });
  it("reports not-allowed on getUserMedia reject", async () => {
    getUserMedia.mockRejectedValueOnce(new Error("denied"));
    const h = { onInterim: vi.fn(), onFinal: vi.fn(), onError: vi.fn(), onStatus: vi.fn() };
    createSttEngine(cfg).start(h);
    await Promise.resolve(); await Promise.resolve();
    expect(h.onError).toHaveBeenCalledWith("not-allowed");
  });
  it("reports not-supported when MediaRecorder is absent", () => {
    delete (globalThis as unknown as { MediaRecorder?: unknown }).MediaRecorder;
    const h = { onInterim: vi.fn(), onFinal: vi.fn(), onError: vi.fn(), onStatus: vi.fn() };
    expect(createSttEngine(cfg).start(h)).toBe(false);
    expect(h.onError).toHaveBeenCalledWith("not-supported");
  });
  it("emits onError on a non-ok transcription response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 401, json: async () => ({}) })));
    const h = { onInterim: vi.fn(), onFinal: vi.fn(), onError: vi.fn(), onStatus: vi.fn() };
    const eng = createSttEngine(cfg); eng.start(h);
    await Promise.resolve(); await Promise.resolve();
    eng.stop();
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(h.onError).toHaveBeenCalledWith("stt-401");
  });
});
