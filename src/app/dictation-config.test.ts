import { describe, it, expect, vi } from "vitest";
vi.mock("./web-speech-engine", () => ({ createWebSpeechEngine: vi.fn(() => ({ start: () => true, stop: () => {}, _kind: "ws" })) }));
vi.mock("./stt-engine", () => ({ createSttEngine: vi.fn(() => ({ start: () => true, stop: () => {}, _kind: "stt" })) }));
import { resolveDictationEngine } from "./dictation-config";

describe("resolveDictationEngine", () => {
  it("uses web-speech by default", () => {
    expect((resolveDictationEngine({ engine: "web-speech" }, "en-US") as unknown as { _kind: string })._kind).toBe("ws");
  });
  it("uses stt when fully configured", () => {
    expect((resolveDictationEngine({ engine: "stt", sttBaseUrl: "https://x/v1", sttApiKey: "k" }, "en-US") as unknown as { _kind: string })._kind).toBe("stt");
  });
  it("falls back to web-speech when stt is unconfigured", () => {
    expect((resolveDictationEngine({ engine: "stt" }, "en-US") as unknown as { _kind: string })._kind).toBe("ws");
  });
});
