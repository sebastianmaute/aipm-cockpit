import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { buildDigestNarrativePrompt, parseDigestNarrative, runDigestNarrative } from "./digest-narrative";
import { AiConsentRevokedError, newConsent, publishAiConsentState } from "../ai-consent";
import { defaultAiConfig } from "../settings-types";
import type { DigestModel } from "./digest-model";

const MODEL: DigestModel = {
  rag: "R", ragPrev: "A",
  overdue: { count: 2, delta: 1 },
  milestonesDueSoon: [{ id: 1, name: "M1", date: "2026-07-15" }],
  openRaid: { count: 4, high: 2, delta: 3 },
  generatedAt: "2026-07-10T09:00:00.000Z",
};

describe("digest narrative", () => {
  it("prompt summarizes the facts without leaking a key", () => {
    const p = buildDigestNarrativePrompt(MODEL, "en-US");
    expect(p).toContain("Red");
    expect(p).toContain("2");
    expect(p).not.toMatch(/sk-ant/);
  });
  it("parseDigestNarrative strips control chars and caps length", () => {
    expect(parseDigestNarrative("Project slipped. ")).toBe("Project slipped.");
    const long = "x".repeat(5000);
    expect(parseDigestNarrative(long).length).toBeLessThanOrEqual(2000);
  });
  it("parseDigestNarrative returns '' for non-string", () => {
    expect(parseDigestNarrative(undefined as unknown as string)).toBe("");
  });
});

// AI-01 — the scheduled auto-run's `level` reaches the forced call: with an interactive consent only, a
// background narrative is refused before any request, while an interactive one (no level) is sent.
describe("runDigestNarrative — the consent level", () => {
  const both = { ...defaultAiConfig, enabled: true, consent: newConsent(new Date(0)), backgroundConsent: newConsent(new Date(0)) };
  const reply = () => ({
    ok: true,
    json: async () => ({ content: [{ type: "tool_use", name: "write_digest_narrative", input: { narrative: "On track." } }] }),
  }) as unknown as Response;
  beforeEach(() => publishAiConsentState({ ...both, backgroundConsent: undefined }));
  afterEach(() => {
    vi.restoreAllMocks();
    publishAiConsentState(undefined);
  });

  it("a background narrative needs the background consent", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(reply());
    const ctx = { apiKey: "k", model: "m", lang: "en-US" as const };
    await expect(runDigestNarrative(MODEL, { ...ctx, level: "background" })).rejects.toBeInstanceOf(AiConsentRevokedError);
    expect(fetchSpy).not.toHaveBeenCalled();
    // control: the same consent lets an interactive narrative through
    await expect(runDigestNarrative(MODEL, ctx)).resolves.toBe("On track.");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
