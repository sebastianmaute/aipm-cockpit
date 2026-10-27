import { describe, it, expect, vi, afterEach } from "vitest";
vi.mock("./web-speech-engine", () => ({ createWebSpeechEngine: vi.fn(() => ({ start: () => true, stop: () => {}, _kind: "ws" })) }));
vi.mock("./stt-engine", () => ({ createSttEngine: vi.fn(() => ({ start: () => true, stop: () => {}, _kind: "stt" })) }));
import { dictationBlockedByConsent, resolveDictationEngine } from "./dictation-config";
import { setDisabledIntegrations } from "./integration-switches";
import { defaultAiConfig, isAiConsentedForDictation } from "./settings-types";
import { newConsent } from "./ai-consent";

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
  const kind = (consented: boolean) => (resolveDictationEngine(full, "en-US", consented) as unknown as { _kind: string } | null)?._kind ?? null;
  afterEach(() => setDisabledIntegrations([]));
  it("AI-01 — a fully configured stt engine without consent is unavailable, not web-speech", () => {
    expect(kind(false)).toBeNull();
    expect(dictationBlockedByConsent(full, false)).toBe(true);
  });
  it("AI-01 — a chosen but unconfigured stt engine without consent is unavailable too", () => {
    expect(resolveDictationEngine({ engine: "stt" }, "en-US", false)).toBeNull();
  });
  it("AI-01 — browser dictation is unaffected by the AI consent", () => {
    expect((resolveDictationEngine({ engine: "web-speech" }, "en-US", false) as unknown as { _kind: string })._kind).toBe("ws");
    expect(dictationBlockedByConsent({ engine: "web-speech" }, false)).toBe(false);
  });
  it("AI-01 — with stt switched off by this deployment (§762), dictation stays on web-speech without consent", () => {
    setDisabledIntegrations(["stt"]);
    expect(kind(false)).toBe("ws");
  });
  it("D9 — the same configuration picks stt once consent is current (positive control)", () => {
    expect(kind(true)).toBe("stt");
  });
});

describe("R9 — isAiConsentedForDictation needs the AI switch AND a current consent, not a key", () => {
  const full = { engine: "stt", sttBaseUrl: "https://x/v1", sttApiKey: "k" } as const;
  const consent = newConsent(new Date("2026-10-27T00:00:00Z"));
  const kind = (ai: Parameters<typeof isAiConsentedForDictation>[0]) =>
    (resolveDictationEngine(full, "en-US", isAiConsentedForDictation(ai)) as unknown as { _kind: string } | null)?._kind ?? null;
  it("R9 — switch off with a current consent makes stt dictation unavailable", () => {
    expect(kind({ ...defaultAiConfig, enabled: false, consent })).toBeNull();
  });
  it("R9 — switch on with no consent makes stt dictation unavailable", () => {
    expect(kind({ ...defaultAiConfig, enabled: true, consent: undefined })).toBeNull();
  });
  it("R9 — switch on with a current consent and NO Anthropic key picks stt (positive control)", () => {
    expect(kind({ ...defaultAiConfig, enabled: true, apiKey: "", consent })).toBe("stt");
  });
});
