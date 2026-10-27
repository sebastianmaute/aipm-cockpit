import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../test/ai-consent-live";
import { AiConsentRevokedError, newConsent, publishAiConsentState } from "./ai-consent";
import { defaultAiConfig } from "./settings-types";
import { __resetToolChoiceFallbackForTests, runForcedToolCall, runForcedToolCallWithStop } from "./ai-forced-call";
import { AiHttpError } from "./ai-errors";
import { __resetAiKeyStatusForTests, getAiKeyStatus } from "./ai-key-status";
import { RECOMMEND_TOOL } from "./insights/recommend";

const KEY = "sk-ant-api03-ForcedCallKey000000000";

function args() {
  return {
    apiKey: KEY,
    model: "claude-sonnet-5",
    tools: [],
    toolName: "t",
    messages: [],
    maxTokens: 10,
  };
}

function stubReply(stopReason: string | undefined) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => ({ stop_reason: stopReason, content: [{ type: "tool_use", name: "t", input: { a: 1 } }] }),
  }));
}

function stubStatus(status: number) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => (status === 200
      ? { content: [{ type: "tool_use", name: "t", input: { a: 1 } }] }
      : { error: { type: "authentication_error", message: "invalid x-api-key" } }),
  }));
}

beforeEach(() => __resetAiKeyStatusForTests());
afterEach(() => vi.unstubAllGlobals());

describe("runForcedToolCallWithStop — the reply's stop reason beside the input", () => {
  it("returns the input and the stop reason", async () => {
    stubReply("max_tokens");
    await expect(runForcedToolCallWithStop(args())).resolves.toEqual({ input: { a: 1 }, stopReason: "max_tokens" });
    stubReply("tool_use");
    await expect(runForcedToolCallWithStop(args())).resolves.toEqual({ input: { a: 1 }, stopReason: "tool_use" });
  });

  it("reports an absent stop reason as undefined, and runForcedToolCall still returns the input alone", async () => {
    stubReply(undefined);
    await expect(runForcedToolCallWithStop(args())).resolves.toEqual({ input: { a: 1 }, stopReason: undefined });
    stubReply("max_tokens");
    await expect(runForcedToolCall(args())).resolves.toEqual({ a: 1 });
  });
});

describe("runForcedToolCall — §650 reports the key verdict at the envelope", () => {
  it.each([
    [401, "rejected"],
    [403, "forbidden"],
  ] as const)("a %i reports %s", async (status, expected) => {
    stubStatus(status);
    await expect(runForcedToolCall(args())).rejects.toBeInstanceOf(AiHttpError);
    expect(getAiKeyStatus()).toBe(expected);
  });

  it("a 200 reports ok", async () => {
    stubStatus(403);
    await expect(runForcedToolCall(args())).rejects.toBeInstanceOf(AiHttpError);
    stubStatus(200);
    await expect(runForcedToolCall(args())).resolves.toEqual({ a: 1 });
    expect(getAiKeyStatus()).toBe("ok");
  });

  it("a 500 or a network failure leaves the verdict unchanged", async () => {
    stubStatus(401);
    await expect(runForcedToolCall(args())).rejects.toBeInstanceOf(AiHttpError);
    stubStatus(500);
    await expect(runForcedToolCall(args())).rejects.toBeInstanceOf(AiHttpError);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(runForcedToolCall(args())).rejects.toBeInstanceOf(TypeError);
    expect(getAiKeyStatus()).toBe("rejected");
  });
});

describe("runForcedToolCall — a model that refuses a forced tool_choice", () => {
  const REFUSAL = {
    ok: false,
    status: 400,
    json: async () => ({ error: { type: "invalid_request_error", message: 'tool_choice: type "tool" and "any" are not supported for this model.' } }),
  };
  const TOOL_REPLY = {
    ok: true,
    status: 200,
    json: async () => ({ stop_reason: "tool_use", content: [{ type: "tool_use", name: "t", input: { a: 1 } }] }),
  };
  const choices = (fetchMock: ReturnType<typeof vi.fn>) =>
    fetchMock.mock.calls.map((c: unknown[]) => (JSON.parse((c[1] as { body: string }).body) as { tool_choice: unknown }).tool_choice);

  beforeEach(() => __resetToolChoiceFallbackForTests());

  it("resends once with tool_choice auto and returns the tool input", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(REFUSAL).mockResolvedValueOnce(TOOL_REPLY);
    vi.stubGlobal("fetch", fetchMock);
    await expect(runForcedToolCall({ ...args(), model: "claude-sonnet-5-5" })).resolves.toEqual({ a: 1 });
    expect(choices(fetchMock)).toEqual([{ type: "tool", name: "t" }, { type: "auto" }]);
  });

  describe("the auto reply is checked against the tool's schema", () => {
    const TOOL = {
      name: "t",
      description: "d",
      input_schema: {
        type: "object",
        properties: {
          summary: { type: "string" },
          actions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                title: { type: "string" },
                severity: { type: "string", enum: ["now", "soon"] },
                entity: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
              },
              required: ["title"],
            },
          },
        },
        required: ["summary", "actions"],
      },
    };
    const OTHER = { name: "other", description: "o", input_schema: { type: "object", properties: {} } };
    const reply = (input: unknown) => ({
      ok: true,
      status: 200,
      json: async () => ({ stop_reason: "tool_use", content: [{ type: "tool_use", name: "t", input }] }),
    });
    const GOOD = { summary: "s", actions: [{ title: "a", severity: "now", entity: { id: "4" } }] };
    // What Sonnet 5.5 sent for the next-actions analysis with plain auto (2026-10-19): `actions` as a string
    // holding tool markup. With strict, 8 of 8 replays were valid.
    const MALFORMED = { summary: "s", actions: '<parameter name="title">a' };
    const call = () => ({ ...args(), model: "claude-sonnet-5-5", tools: [TOOL, OTHER] });
    const sentBodies = (fetchMock: ReturnType<typeof vi.fn>) =>
      fetchMock.mock.calls.map((c: unknown[]) => JSON.parse((c[1] as { body: string }).body) as { tool_choice: { type: string }; tools: { strict?: boolean }[] });
    const shape = (fetchMock: ReturnType<typeof vi.fn>) => sentBodies(fetchMock).map((b) => [b.tool_choice.type, b.tools[0]?.strict === true]);

    it("returns a matching plain auto reply with no strict request", async () => {
      const fetchMock = vi.fn().mockResolvedValueOnce(REFUSAL).mockResolvedValueOnce(reply(GOOD));
      vi.stubGlobal("fetch", fetchMock);
      await expect(runForcedToolCall(call())).resolves.toEqual(GOOD);
      expect(shape(fetchMock)).toEqual([["tool", false], ["auto", false]]);
    });

    it("asks again in strict form, every object closed, when the plain reply does not match, and uses strict for that tool afterwards", async () => {
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(REFUSAL)
        .mockResolvedValueOnce(reply(MALFORMED))
        .mockResolvedValue(reply(GOOD));
      vi.stubGlobal("fetch", fetchMock);
      await expect(runForcedToolCall(call())).resolves.toEqual(GOOD);
      await runForcedToolCall(call());
      expect(shape(fetchMock)).toEqual([["tool", false], ["auto", false], ["auto", true], ["auto", true]]);
      const strictTools = sentBodies(fetchMock)[2].tools;
      expect(strictTools).toEqual([
        {
          ...TOOL,
          strict: true,
          input_schema: {
            ...TOOL.input_schema,
            additionalProperties: false,
            properties: {
              summary: { type: "string" },
              actions: {
                type: "array",
                items: {
                  ...TOOL.input_schema.properties.actions.items,
                  additionalProperties: false,
                  properties: {
                    ...TOOL.input_schema.properties.actions.items.properties,
                    entity: { ...TOOL.input_schema.properties.actions.items.properties.entity, additionalProperties: false },
                  },
                },
              },
            },
          },
        },
        OTHER,
      ]);
    });

    it.each([
      ["a missing required key", { actions: [] }],
      ["a wrong type", { summary: "s", actions: [{ title: 3 }] }],
      ["a value outside the enum", { summary: "s", actions: [{ title: "a", severity: "later" }] }],
      ["a nested missing required key", { summary: "s", actions: [{ title: "a", entity: {} }] }],
    ])("treats %s as not matching", async (_label, input) => {
      const fetchMock = vi.fn().mockResolvedValueOnce(REFUSAL).mockResolvedValueOnce(reply(input)).mockResolvedValueOnce(reply(GOOD));
      vi.stubGlobal("fetch", fetchMock);
      await expect(runForcedToolCall(call())).resolves.toEqual(GOOD);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it("keeps the plain reply when the API refuses the strict form, and skips strict for that tool afterwards", async () => {
      // propose_project ("'minimum' is not supported") and propose_wbs_changes ("Schema is too complex.",
      // after 108 s) were refused in strict form on 2026-10-19.
      const STRICT_REFUSAL = {
        ok: false,
        status: 400,
        json: async () => ({ error: { type: "invalid_request_error", message: "tools.0.custom: For 'integer' type, property 'minimum' is not supported" } }),
      };
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(REFUSAL)
        .mockResolvedValueOnce(reply(MALFORMED))
        .mockResolvedValueOnce(STRICT_REFUSAL)
        .mockResolvedValue(reply(MALFORMED));
      vi.stubGlobal("fetch", fetchMock);
      await expect(runForcedToolCall(call())).resolves.toEqual(MALFORMED);
      await expect(runForcedToolCall(call())).resolves.toEqual(MALFORMED);
      expect(shape(fetchMock)).toEqual([["tool", false], ["auto", false], ["auto", true], ["auto", false]]);
    });

    it("leaves the forced request as it was", async () => {
      const fetchMock = vi.fn().mockResolvedValue(reply(MALFORMED));
      vi.stubGlobal("fetch", fetchMock);
      await expect(runForcedToolCall({ ...call(), model: "claude-sonnet-5" })).resolves.toEqual(MALFORMED);
      expect(sentBodies(fetchMock)[0].tools).toEqual([TOOL, OTHER]);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    // §782 round 3 (Minor 5) — the same retry, driven by the real
    // `propose_insight_actions` tool, whose calls are an `anyOf` of one branch
    // per tool. A plain reply whose create_task lacks `taskName` and `assignee`
    // must count as a mismatch and be re-asked strict, every branch closed.
    it("re-asks propose_insight_actions strict when a create_task lacks its required arguments", async () => {
      const recReply = (calls: unknown[]) => ({
        ok: true,
        status: 200,
        json: async () => ({ stop_reason: "tool_use", content: [{ type: "tool_use", name: RECOMMEND_TOOL.name, input: { summary: "s", calls } }] }),
      });
      const valid = [{ name: "create_task", input: { taskName: "Review T&M burn", assignee: "Dana Ortiz", dueDate: "2026-09-25" } }];
      const fetchMock = vi.fn()
        .mockResolvedValueOnce(REFUSAL)
        .mockResolvedValueOnce(recReply([{ name: "create_task", input: { title: "Review T&M burn", dueDate: "2026-09-25" } }]))
        .mockResolvedValueOnce(recReply(valid));
      vi.stubGlobal("fetch", fetchMock);
      const out = await runForcedToolCall({ ...args(), model: "claude-sonnet-5-5", tools: [RECOMMEND_TOOL], toolName: RECOMMEND_TOOL.name });
      expect(out).toEqual({ summary: "s", calls: valid });
      expect(shape(fetchMock)).toEqual([["tool", false], ["auto", false], ["auto", true]]);
      type Branch = { additionalProperties?: boolean; properties: { name: { enum: string[] }; input: { additionalProperties?: boolean; required: string[] } } };
      const strictTool = sentBodies(fetchMock)[2].tools[0] as unknown as { input_schema: { properties: { calls: { items: { anyOf: Branch[] } } } } };
      const branches = strictTool.input_schema.properties.calls.items.anyOf;
      const create = branches.find((b) => b.properties.name.enum[0] === "create_task");
      expect(create?.properties.input.required).toEqual(["taskName", "assignee", "dueDate"]);
      expect(branches.length).toBeGreaterThan(1);
      expect(branches.every((b) => b.additionalProperties === false && b.properties.input.additionalProperties === false)).toBe(true);
    });
  });

  it("sends auto straight away for that model afterwards, and still forces the tool for other models", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(REFUSAL).mockResolvedValue(TOOL_REPLY);
    vi.stubGlobal("fetch", fetchMock);
    await runForcedToolCall({ ...args(), model: "claude-sonnet-5-5" });
    await runForcedToolCall({ ...args(), model: "claude-sonnet-5-5" });
    await runForcedToolCall({ ...args(), model: "claude-sonnet-5" });
    expect(choices(fetchMock)).toEqual([
      { type: "tool", name: "t" },
      { type: "auto" },
      { type: "auto" },
      { type: "tool", name: "t" },
    ]);
  });

  it("does not resend on any other 400", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: { type: "invalid_request_error", message: "prompt is too long: 300000 tokens > 200000 maximum" } }),
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(runForcedToolCall(args())).rejects.toBeInstanceOf(AiHttpError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws parse when the auto reply carries no tool call", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(REFUSAL).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ stop_reason: "end_turn", content: [{ type: "text", text: "hello" }] }),
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(runForcedToolCall({ ...args(), model: "claude-sonnet-5-5" })).rejects.toThrow("parse");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

// The file-wide live consent comes from ../test/ai-consent-live; put it back after a test revokes it.
function restoreLiveConsent() {
  publishAiConsentState(LIVE);
}

const LIVE = {
  ...defaultAiConfig,
  enabled: true,
  consent: newConsent(new Date(0)),
  backgroundConsent: newConsent(new Date(0)),
};

/** Request 1 is refused over tool_choice, which sends the call down the fallback path; `during` runs while it is
 *  in flight. Request 2 (if it goes out) answers with the tool. */
function stubFallbackWith(during: () => void) {
  let n = 0;
  const fetchMock = vi.fn().mockImplementation(async () => {
    n += 1;
    if (n > 1) {
      return { ok: true, status: 200, json: async () => ({ content: [{ type: "tool_use", name: "t", input: { a: 1 } }] }) };
    }
    during();
    return {
      ok: false,
      status: 400,
      json: async () => ({ error: { type: "invalid_request_error", message: "tool_choice is not supported" } }),
    };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("runForcedToolCall — the consent gate (AI-01)", () => {
  beforeEach(() => __resetToolChoiceFallbackForTests());
  afterEach(() => {
    restoreLiveConsent();
    vi.unstubAllGlobals();
  });

  it("rejects with AiConsentRevokedError and sends nothing when no consent is published", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    publishAiConsentState({ ...defaultAiConfig, consent: undefined });
    await expect(runForcedToolCall(args())).rejects.toBeInstanceOf(AiConsentRevokedError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not send the fallback request when consent is revoked between the two", async () => {
    // Request 1 is refused over tool_choice, which sends the call down the fallback path; the user revokes
    // consent while it is in flight, so the second request must not go out.
    const fetchMock = vi.fn().mockImplementation(async () => {
      publishAiConsentState({ ...defaultAiConfig, consent: undefined });
      return {
        ok: false,
        status: 400,
        json: async () => ({ error: { type: "invalid_request_error", message: "tool_choice is not supported" } }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(runForcedToolCall(args())).rejects.toBeInstanceOf(AiConsentRevokedError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not send the fallback request when AI is switched off between the two, the consent kept (AI-01)", async () => {
    const fetchMock = stubFallbackWith(() => publishAiConsentState({ ...LIVE, enabled: false }));
    await expect(runForcedToolCall(args())).rejects.toBeInstanceOf(AiConsentRevokedError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a background call does not send its fallback request once the background consent is withdrawn (AI-01)", async () => {
    const fetchMock = stubFallbackWith(() => publishAiConsentState({ ...LIVE, backgroundConsent: undefined }));
    await expect(runForcedToolCall({ ...args(), level: "background" })).rejects.toBeInstanceOf(AiConsentRevokedError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("an interactive call is unaffected by a withdrawn background consent (AI-01)", async () => {
    const fetchMock = stubFallbackWith(() => publishAiConsentState({ ...LIVE, backgroundConsent: undefined }));
    await expect(runForcedToolCall(args())).resolves.toEqual({ a: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("a background call sends nothing without a background consent (AI-01)", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    publishAiConsentState({ ...LIVE, backgroundConsent: undefined });
    await expect(runForcedToolCallWithStop({ ...args(), level: "background" })).rejects.toBeInstanceOf(AiConsentRevokedError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
