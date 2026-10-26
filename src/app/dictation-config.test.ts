import { describe, it, expect, vi, afterEach } from "vitest";
vi.mock("./web-speech-engine", () => ({ createWebSpeechEngine: vi.fn(() => ({ start: () => true, stop: () => {}, _kind: "ws" })) }));
vi.mock("./stt-engine", () => ({ createSttEngine: vi.fn(() => ({ start: () => true, stop: () => {}, _kind: "stt" })) }));
import { resolveDictationEngine } from "./dictation-config";
import { setDisabledIntegrations } from "./integration-switches";

describe("resolveDictationEngine", () => {
  it("uses web-speech by default", () => {
    expect((resolveDictationEngine({ engine: "web-speech" }, "en-US", true) as unknown as { _kind: string })._kind).toBe("ws");
  });
  it("uses stt when fully configured", () => {
    expect((resolveDictationEngine({ engine: "stt", sttBaseUrl: "https://x/v1", sttApiKey: "k" }, "en-US", true) as unknown as { _kind: string })._kind).toBe("stt");
  });
  it("falls back to web-speech when stt is unconfigured", () => {
    expect((resolveDictationEngine({ engine: "stt" }, "en-US", true) as unknown as { _kind: string })._kind).toBe("ws");
  });
});

describe("§762 — resolveDictationEngine with stt switched off", () => {
  afterEach(() => setDisabledIntegrations([]));
  const full = { engine: "stt", sttBaseUrl: "https://x/v1", sttApiKey: "k" } as const;
  const kind = () => (resolveDictationEngine(full, "en-US", true) as unknown as { _kind: string })._kind;
  it("§762 — still picks stt when fully configured and on (positive control)", () => {
    expect(kind()).toBe("stt");
  });
  it("§762 — gives web-speech for a fully configured stt engine when stt is switched off", () => {
    setDisabledIntegrations(["stt"]);
    expect(kind()).toBe("ws");
  });
});

describe("D9 — resolveDictationEngine requires AI consent for stt", () => {
  const full = { engine: "stt", sttBaseUrl: "https://x/v1", sttApiKey: "k" } as const;
  const kind = (consented: boolean) => (resolveDictationEngine(full, "en-US", consented) as unknown as { _kind: string })._kind;
  it("D9 — a fully configured stt engine falls back to web-speech without consent", () => {
    expect(kind(false)).toBe("ws");
  });
  it("D9 — the same configuration picks stt once consent is current (positive control)", () => {
    expect(kind(true)).toBe("stt");
  });
});
