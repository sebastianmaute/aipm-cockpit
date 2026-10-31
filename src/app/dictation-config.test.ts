import { describe, it, expect, vi, afterEach } from "vitest";
vi.mock("./web-speech-engine", () => ({ createWebSpeechEngine: vi.fn(() => ({ start: () => true, stop: () => {}, _kind: "ws" })) }));
vi.mock("./stt-engine", () => ({ createSttEngine: vi.fn(() => ({ start: () => true, stop: () => {}, _kind: "stt" })) }));
import { dictationUnavailableReason, resolveDictationEngine } from "./dictation-config";
import {
  DICTATION_AI_DEPLOYMENT_INVALID,
  DICTATION_AI_DEPLOYMENT_OFF,
  DICTATION_NEEDS_AI_CONSENT,
  DICTATION_STT_NOT_SET_UP,
} from "./dictation-engine";
import { setDisabledIntegrations } from "./integration-switches";
import { defaultAiConfig, isAiConsentedForDictation } from "./settings-types";
import { newConsent } from "./ai-consent";
import { setAiDeploymentState } from "./ai-deployment";
import { DIRECT_AI_STATUS } from "../test/ai-status-fetch";

describe("resolveDictationEngine", () => {
  it("uses web-speech by default", () => {
    expect((resolveDictationEngine({ engine: "web-speech" }, "en-US", true) as unknown as { _kind: string })._kind).toBe("ws");
  });
  it("uses stt when fully configured", () => {
    expect((resolveDictationEngine({ engine: "stt", sttBaseUrl: "https://x/v1", sttApiKey: "k" }, "en-US", true) as unknown as { _kind: string })._kind).toBe("stt");
  });
});

// AI-01 — speech-to-text chosen and consented to but not usable is unavailable, never a silent switch to the
// browser's engine (which in some browsers sends the audio to the browser maker's service).
describe("AI-01 — resolveDictationEngine with speech-to-text not fully set up", () => {
  afterEach(() => setDisabledIntegrations([]));
  const cases = [
    ["no address and no key", { engine: "stt" }],
    ["no key (missing, or not in memory: unreadable or locked)", { engine: "stt", sttBaseUrl: "https://x/v1", sttApiKey: "" }],
    ["no address", { engine: "stt", sttApiKey: "k" }],
    ["a blank address", { engine: "stt", sttBaseUrl: "  ", sttApiKey: "k" }],
  ] as const;
  for (const [what, d] of cases) {
    it(`${what}: unavailable, with the reason`, () => {
      expect(resolveDictationEngine(d, "en-US", true)).toBeNull();
      expect(dictationUnavailableReason(d, true)).toBe(DICTATION_STT_NOT_SET_UP);
    });
  }
  it("without the consent too, the consent is the reason given", () => {
    expect(dictationUnavailableReason({ engine: "stt" }, false)).toBe(DICTATION_NEEDS_AI_CONSENT);
  });
  it("§762 — with speech-to-text switched off by this deployment, the browser's engine is used, as before", () => {
    setDisabledIntegrations(["stt"]);
    expect((resolveDictationEngine({ engine: "stt" }, "en-US", true) as unknown as { _kind: string })._kind).toBe("ws");
    expect(dictationUnavailableReason({ engine: "stt" }, true)).toBeNull();
  });
  it("fully set up and consented: available (control)", () => {
    expect(dictationUnavailableReason({ engine: "stt", sttBaseUrl: "https://x/v1", sttApiKey: "k" }, true)).toBeNull();
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
    expect(dictationUnavailableReason(full, false)).toBe(DICTATION_NEEDS_AI_CONSENT);
  });
  it("AI-01 — a chosen but unconfigured stt engine without consent is unavailable too", () => {
    expect(resolveDictationEngine({ engine: "stt" }, "en-US", false)).toBeNull();
  });
  it("AI-01 — browser dictation is unaffected by the AI consent", () => {
    expect((resolveDictationEngine({ engine: "web-speech" }, "en-US", false) as unknown as { _kind: string })._kind).toBe("ws");
    expect(dictationUnavailableReason({ engine: "web-speech" }, false)).toBeNull();
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

describe("dictation when the deployment has AI off", () => {
  afterEach(() => setAiDeploymentState(DIRECT_AI_STATUS));
  it("resolves no speech-to-text engine", () => {
    setAiDeploymentState({ off: true, route: "direct", invalid: false, keyRestricted: false });
    const d = { engine: "stt", sttBaseUrl: "https://x/v1", sttApiKey: "k" } as const;
    expect(dictationUnavailableReason(d, true)).toBe(DICTATION_AI_DEPLOYMENT_OFF);
    expect(resolveDictationEngine(d, "en-US", true)).toBeNull();
  });
  // The organisation's setting comes first: no consent the user could give would make dictation available.
  it("names the switched-off deployment even without a consent", () => {
    setAiDeploymentState({ off: true, route: "direct", invalid: false, keyRestricted: false });
    expect(dictationUnavailableReason({ engine: "stt" }, false)).toBe(DICTATION_AI_DEPLOYMENT_OFF);
  });
  it("names an invalid gateway setting", () => {
    setAiDeploymentState({ off: false, route: "gateway", invalid: true, keyRestricted: false });
    const d = { engine: "stt", sttBaseUrl: "https://x/v1", sttApiKey: "k" } as const;
    expect(dictationUnavailableReason(d, true)).toBe(DICTATION_AI_DEPLOYMENT_INVALID);
    expect(resolveDictationEngine(d, "en-US", true)).toBeNull();
  });
  it("the browser's engine is unaffected by the deployment (control)", () => {
    setAiDeploymentState({ off: true, route: "direct", invalid: false, keyRestricted: false });
    expect(dictationUnavailableReason({ engine: "web-speech" }, true)).toBeNull();
  });
});
