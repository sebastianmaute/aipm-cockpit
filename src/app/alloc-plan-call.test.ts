import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runAllocProposal } from "./alloc-plan-call";

const ok = (body: unknown) => ({ ok: true, json: async () => body }) as unknown as Response;

describe("runAllocProposal", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("returns the raw parsed cells from a forced tool_use response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      ok({
        content: [
          {
            type: "tool_use",
            name: "propose_allocations",
            input: { cells: [{ resourceId: 1, periodKey: "2026-08", hours: 40 }] },
          },
        ],
      }),
    );
    const result = await runAllocProposal("ctx", { apiKey: "k", model: "m" }, "spread the work");
    expect(result).toEqual([{ resourceId: 1, periodKey: "2026-08", hours: 40 }]);
  });

  it("sends the forced tool_choice and the propose tool", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      ok({ content: [{ type: "tool_use", name: "propose_allocations", input: { cells: [] } }] }),
    );
    await runAllocProposal("ctx", { apiKey: "k", model: "m" }, "spread the work");
    const body = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.tool_choice).toEqual({ type: "tool", name: "propose_allocations" });
    expect(body.tools[0].name).toBe("propose_allocations");
  });

  it("sends a user message containing both the context digest and the instruction", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      ok({ content: [{ type: "tool_use", name: "propose_allocations", input: { cells: [] } }] }),
    );
    const context = "PLAN: 2026-08-01 .. 2026-09-30\n#1 Jane Doe :: 2026-08=0/160";
    const instruction = "put 40 hours on Jane in August";
    await runAllocProposal(context, { apiKey: "k", model: "m" }, instruction);
    const body = JSON.parse((spy.mock.calls[0][1] as RequestInit).body as string);
    expect(body.messages).toHaveLength(1);
    const userContent = body.messages[0].content as string;
    expect(userContent).toContain(context);
    expect(userContent).toContain(instruction);
  });

  it("throws the HTTP status on a non-OK response, leaking neither key nor body message anywhere on the error", async () => {
    const secret = "sk-ant-SECRET";
    const bodyMsg = "internal-error-body-detail";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      {
        ok: false,
        status: 429,
        json: async () => ({ error: { type: "rate_limit_error", message: bodyMsg } }),
      } as unknown as Response,
    );
    try {
      await runAllocProposal("ctx", { apiKey: secret, model: "m" }, "do something");
      expect.unreachable("should have thrown");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      expect(msg).toBe("429");
      expect(msg).not.toContain(secret);

      // Stringify every enumerable property of the thrown error (status,
      // errorType, safeMessage, name, message, stack) — none of them may carry
      // the api key. The key lives ONLY in the request header, never read back.
      const dump = JSON.stringify(e, Object.getOwnPropertyNames(e));
      expect(dump).not.toContain(secret);
      expect(dump).toBeDefined();
    }
  });

  it("throws 'parse' on malformed tool output (no cells array)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      ok({ content: [{ type: "tool_use", name: "propose_allocations", input: { nope: true } }] }),
    );
    await expect(
      runAllocProposal("ctx", { apiKey: "k", model: "m" }, "do something"),
    ).rejects.toThrow("parse");
  });

  it("forwards the abort signal to the underlying fetch call", async () => {
    const controller = new AbortController();
    controller.abort();
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation((_url, init) => {
      const signal = (init as RequestInit | undefined)?.signal;
      if (signal?.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
      return Promise.resolve(ok({ content: [] }));
    });
    await expect(
      runAllocProposal("ctx", { apiKey: "k", model: "m" }, "do something", controller.signal),
    ).rejects.toThrow();
    expect(spy).toHaveBeenCalledTimes(1);
    const passedSignal = (spy.mock.calls[0][1] as RequestInit).signal;
    expect(passedSignal).toBe(controller.signal);
  });
});
