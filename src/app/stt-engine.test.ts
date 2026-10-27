import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import "../test/ai-consent-live";
import { createSttEngine } from "./stt-engine";
import { newConsent, publishAiConsentState } from "./ai-consent";
import { defaultAiConfig } from "./settings-types";
import { __setAiStatusRequestForTests } from "./ai-status-request";
import { aiStatusResponse, answerAiStatusDirect } from "../test/ai-status-fetch";

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

describe("stt-engine — the send-time consent check (AI-01)", () => {
  const live = { ...defaultAiConfig, enabled: true, consent: newConsent(new Date(0)), backgroundConsent: newConsent(new Date(0)) };
  it.each([
    ["the consent withdrawn", { ...live, consent: undefined }],
    ["AI switched off", { ...live, enabled: false }],
  ])("discards a recording stopped after %s: nothing is uploaded", async (_name, after) => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ text: "hello" }) }));
    vi.stubGlobal("fetch", fetchMock);
    const h = { onInterim: vi.fn(), onFinal: vi.fn(), onError: vi.fn(), onStatus: vi.fn() };
    const eng = createSttEngine(cfg);
    try {
      eng.start(h);
      await Promise.resolve(); await Promise.resolve();
      publishAiConsentState(after); // withdrawn while recording
      eng.stop();
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(h.onFinal).not.toHaveBeenCalled();
      expect(h.onError).toHaveBeenCalledWith("needs-ai-consent");
      expect(h.onStatus).toHaveBeenLastCalledWith("idle");
      expect(track.stop).toHaveBeenCalled(); // the microphone is released
    } finally {
      publishAiConsentState(live);
    }
  });
});

describe("stt-engine — the deployment status check before the upload", () => {
  afterEach(() => __setAiStatusRequestForTests(answerAiStatusDirect));

  it.each([
    ["AI switched off for the deployment", () => Promise.resolve(aiStatusResponse({ off: true, route: "direct", invalid: false })), "needs-ai-consent"],
    ["an invalid AI setting", () => Promise.resolve(aiStatusResponse({ off: false, route: "direct", invalid: true })), "needs-ai-consent"],
    ["the server down", () => Promise.reject(new TypeError("Failed to fetch")), "stt-unconfirmed"],
  ] as const)("uploads nothing with %s", async (_name, status, code) => {
    __setAiStatusRequestForTests(status);
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ text: "hello" }) }));
    vi.stubGlobal("fetch", fetchMock);
    const h = { onInterim: vi.fn(), onFinal: vi.fn(), onError: vi.fn(), onStatus: vi.fn() };
    const eng = createSttEngine(cfg);
    eng.start(h);
    await Promise.resolve(); await Promise.resolve();
    eng.stop();
    await vi.waitFor(() => expect(h.onError).toHaveBeenCalledWith(code));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(h.onFinal).not.toHaveBeenCalled();
    expect(h.onStatus).toHaveBeenLastCalledWith("idle");
  });
});

describe("stt-engine", () => {
  it("records, transcribes on stop, emits final + status", async () => {
    const h = { onInterim: vi.fn(), onFinal: vi.fn(), onError: vi.fn(), onStatus: vi.fn() };
    const eng = createSttEngine(cfg);
    expect(eng.start(h)).toBe(true);
    await Promise.resolve(); await Promise.resolve();
    eng.stop();
    await vi.waitFor(() => expect(h.onFinal).toHaveBeenCalledWith("hello"));
    expect(h.onStatus).toHaveBeenCalledWith("transcribing");
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
    await vi.waitFor(() => expect(h.onError).toHaveBeenCalledWith("stt-401"));
  });
  it("ignores a re-entrant start while already capturing", async () => {
    const h = { onInterim: vi.fn(), onFinal: vi.fn(), onError: vi.fn(), onStatus: vi.fn() };
    const eng = createSttEngine(cfg);
    getUserMedia.mockClear();
    eng.start(h); eng.start(h);
    await Promise.resolve();
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });
  it("releases the mic if stopped while getUserMedia is still pending", async () => {
    let resolveGum: (v: Awaited<ReturnType<typeof getUserMedia>>) => void = () => {};
    getUserMedia.mockReturnValueOnce(new Promise((r) => { resolveGum = r; }));
    const h = { onInterim: vi.fn(), onFinal: vi.fn(), onError: vi.fn(), onStatus: vi.fn() };
    const eng = createSttEngine(cfg);
    eng.start(h);
    eng.stop(); // stop BEFORE getUserMedia resolves
    resolveGum({ getTracks: () => [track] }); // now the mic arrives
    await Promise.resolve(); await Promise.resolve();
    expect(track.stop).toHaveBeenCalled(); // the late-arriving mic was released
  });
});
