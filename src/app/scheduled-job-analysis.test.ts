import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runJobAnalysis } from "./scheduled-job-analysis";

const ok = (body: unknown) => ({ ok: true, json: async () => body }) as unknown as Response;

describe("runJobAnalysis", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("returns the parsed analysis from a tool_use response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      ok({ content: [{ type: "tool_use", name: "report_analysis", input: { summary: "s", actions: [] } }] }),
    );
    const result = await runJobAnalysis("ctx", { apiKey: "k", model: "m" });
    expect(result).toEqual({ summary: "s", actions: [] });
  });

  it("throws the HTTP status on a non-OK response, leaking neither key nor body", async () => {
    const secret = "secret-key";
    const body = "internal-error-body-detail";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      { ok: false, status: 500, json: async () => ({ error: body }) } as unknown as Response,
    );
    await expect(runJobAnalysis("ctx", { apiKey: secret, model: "m" })).rejects.toThrow("500");
    try {
      await runJobAnalysis("ctx", { apiKey: secret, model: "m" });
      expect.unreachable("should have thrown");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      expect(msg).toBe("500");
      expect(msg).not.toContain(secret);
      expect(msg).not.toContain(body);
    }
  });

  it("throws 'parse' on malformed tool output", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(ok({ content: [{ type: "text", text: "nope" }] }));
    await expect(runJobAnalysis("ctx", { apiKey: "k", model: "m" })).rejects.toThrow("parse");
  });
});
