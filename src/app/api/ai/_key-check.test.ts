// @vitest-environment node
//
// The key check the relay runs before forwarding when the deployment restricts keys to an
// organisation (AI organisation key). Every upstream call goes through a recording fake `send`,
// so no test reaches the network.
import { Readable } from "node:stream";
import type { RequestOptions } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createKeyChecker, KEY_CHECK_TIMEOUT_MS, type KeyVerdict } from "./_key-check";
import type { RelaySend, UpstreamResponse } from "./_relay";
import type { AiKeyRestriction } from "../../ai-key-restriction-config";

type Restricted = Extract<AiKeyRestriction, { kind: "restricted" }>;

const KEY = "sk-ant-key-check-secret";
const OTHER_KEY = "sk-ant-key-check-other";
const ORG = "11111111-2222-3333-4444-555555555555";
const OTHER_ORG = "99999999-8888-7777-6666-555555555555";
// Invented workspace ids in Anthropic's shape: `wrkspc_` plus a case-sensitive identifier.
const WS = "wrkspc_01InventedAlphaQ7x";
const OTHER_WS = "wrkspc_01InventedOmegaR2m";
const ANTHROPIC = { baseUrl: "https://api.anthropic.com", token: null };
const GATEWAY = { baseUrl: "https://gateway.example.com/acct/gw/anthropic", token: "gw-secret-token" };

const ORG_ONLY: Restricted = { kind: "restricted", organizationId: ORG, workspaceIds: null, signature: `${ORG}|` };
const WITH_WS: Restricted = { kind: "restricted", organizationId: ORG, workspaceIds: [WS], signature: `${ORG}|${WS}` };

type Call = {
  url: URL;
  options: RequestOptions;
  destroyed: boolean;
  fire: (event: "error" | "timeout", err?: Error) => void;
  respond: (res: UpstreamResponse) => void;
};

/** A recording fake `https.request`; `onEnd` decides what upstream does. */
function fakeSend(onEnd: (call: Call) => void = () => {}): { send: RelaySend; calls: Call[] } {
  const calls: Call[] = [];
  const send: RelaySend = (url, options, onResponse) => {
    const listeners = new Map<string, (err?: Error) => void>();
    const call: Call = {
      url,
      options,
      destroyed: false,
      fire: (event, err) => listeners.get(event)?.(err),
      respond: onResponse,
    };
    calls.push(call);
    return {
      on(event, cb) {
        listeners.set(event, cb);
        return this;
      },
      end() {
        queueMicrotask(() => onEnd(call));
        return this;
      },
      destroy() {
        call.destroyed = true;
        return this;
      },
    };
  };
  return { send, calls };
}

function answer(status: number, headers: Record<string, string>, body = '{"data":[]}'): UpstreamResponse {
  return Object.assign(Readable.from([Buffer.from(body)]), { statusCode: status, headers });
}

const respond = (status: number, headers: Record<string, string>, body?: string) => (call: Call) =>
  call.respond(answer(status, { "content-type": "application/json", ...headers }, body));

/** A 2xx carrying the organisation (and optional workspace) headers, in node's lower case. */
const org = (orgId: string, ws?: string) =>
  respond(200, ws ? { "anthropic-organization-id": orgId, "anthropic-workspace-id": ws } : { "anthropic-organization-id": orgId });

const ANTHROPIC_401 = JSON.stringify({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } });

describe("createKeyChecker — the pre-flight", () => {
  it("sends GET <base>/v1/models?limit=1 with the caller's key and version; a matching org passes", async () => {
    const { send, calls } = fakeSend(org(ORG));
    const checker = createKeyChecker();
    const verdict = await checker.check(KEY, ORG_ONLY, ANTHROPIC, send, "2023-06-01");
    expect(verdict).toEqual({ kind: "pass" });
    expect(calls).toHaveLength(1);
    expect(calls[0].url.href).toBe("https://api.anthropic.com/v1/models?limit=1");
    expect(calls[0].options.method).toBe("GET");
    const headers = calls[0].options.headers as Record<string, string>;
    expect(headers).toEqual({ "x-api-key": KEY, "anthropic-version": "2023-06-01" });
    expect(calls[0].options.timeout).toBe(KEY_CHECK_TIMEOUT_MS);
  });

  it("goes through the gateway with its token when there is one, like the real request", async () => {
    const { send, calls } = fakeSend(org(ORG));
    const verdict = await createKeyChecker().check(KEY, ORG_ONLY, GATEWAY, send, "2023-06-01");
    expect(verdict).toEqual({ kind: "pass" });
    expect(calls[0].url.href).toBe(`${GATEWAY.baseUrl}/v1/models?limit=1`);
    expect((calls[0].options.headers as Record<string, string>)["cf-aig-authorization"]).toBe(`Bearer ${GATEWAY.token}`);
  });

  it("a gateway pre-flight skips the gateway's response cache; a direct one sends no such header", async () => {
    const { send, calls } = fakeSend(org(ORG));
    const checker = createKeyChecker();
    await checker.check(KEY, ORG_ONLY, GATEWAY, send);
    await checker.check(OTHER_KEY, ORG_ONLY, { baseUrl: GATEWAY.baseUrl, token: null }, send);
    await checker.check("sk-ant-direct", ORG_ONLY, ANTHROPIC, send);
    const sent = calls.map((c) => (c.options.headers as Record<string, string>)["cf-aig-skip-cache"]);
    expect(sent).toEqual(["true", "true", undefined]);
  });

  it("a pass is cached: a second check with the same key makes no upstream call", async () => {
    const { send, calls } = fakeSend(org(ORG));
    const checker = createKeyChecker();
    await checker.check(KEY, ORG_ONLY, ANTHROPIC, send);
    expect(await checker.check(KEY, ORG_ONLY, ANTHROPIC, send)).toEqual({ kind: "pass" });
    expect(calls).toHaveLength(1);
    expect(checker.size()).toBe(1);
  });

  it("the cache is by key: another key is checked on its own", async () => {
    const { send, calls } = fakeSend(org(ORG));
    const checker = createKeyChecker();
    await checker.check(KEY, ORG_ONLY, ANTHROPIC, send);
    await checker.check(OTHER_KEY, ORG_ONLY, ANTHROPIC, send);
    expect(calls).toHaveLength(2);
  });

  it("header names and the organisation id are matched case-insensitively", async () => {
    const { send } = fakeSend(
      respond(200, { "Anthropic-Organization-Id": ORG.toUpperCase(), "ANTHROPIC-WORKSPACE-ID": WS }),
    );
    expect(await createKeyChecker().check(KEY, WITH_WS, ANTHROPIC, send)).toEqual({ kind: "pass" });
  });

  it("a workspace id is matched exactly: one differing only in case is another workspace", async () => {
    const { send } = fakeSend(org(ORG, WS.toLowerCase()));
    expect(await createKeyChecker().check(KEY, WITH_WS, ANTHROPIC, send)).toEqual({ kind: "wrong-workspace" });
  });

  it("drops the pre-flight's body (the request is destroyed once the headers are read)", async () => {
    const { send, calls } = fakeSend(org(ORG));
    await createKeyChecker().check(KEY, ORG_ONLY, ANTHROPIC, send);
    expect(calls[0].destroyed).toBe(true);
  });
});

describe("createKeyChecker — refusals", () => {
  let now = 0;
  const clock = () => now;
  beforeEach(() => {
    now = 1_000_000;
  });

  it("another organisation → wrong-organization", async () => {
    const { send } = fakeSend(org(OTHER_ORG));
    expect(await createKeyChecker().check(KEY, ORG_ONLY, ANTHROPIC, send)).toEqual({ kind: "wrong-organization" });
  });

  it("a workspace not on the list → wrong-workspace", async () => {
    const { send } = fakeSend(org(ORG, OTHER_WS));
    expect(await createKeyChecker().check(KEY, WITH_WS, ANTHROPIC, send)).toEqual({ kind: "wrong-workspace" });
  });

  it("a listed workspace passes", async () => {
    const { send } = fakeSend(org(ORG, WS));
    expect(await createKeyChecker().check(KEY, WITH_WS, ANTHROPIC, send)).toEqual({ kind: "pass" });
  });

  it("workspaces listed, a 2xx with no workspace header (a key not tied to a workspace) → wrong-workspace, cached", async () => {
    const { send, calls } = fakeSend(org(ORG));
    const checker = createKeyChecker({ now: clock });
    expect(await checker.check(KEY, WITH_WS, ANTHROPIC, send)).toEqual({ kind: "wrong-workspace" });
    expect(await checker.check(KEY, WITH_WS, ANTHROPIC, send)).toEqual({ kind: "wrong-workspace" });
    expect(calls).toHaveLength(1);
    expect(checker.size()).toBe(1);
  });

  it("no workspace list: a 2xx with no workspace header passes on the organisation alone", async () => {
    const { send } = fakeSend(org(ORG));
    expect(await createKeyChecker().check(KEY, ORG_ONLY, ANTHROPIC, send)).toEqual({ kind: "pass" });
  });

  it("a wrong organisation wins over a listed workspace", async () => {
    const { send } = fakeSend(org(OTHER_ORG, WS));
    expect(await createKeyChecker().check(KEY, WITH_WS, ANTHROPIC, send)).toEqual({ kind: "wrong-organization" });
  });

  it("a refusal is cached for refusalTtlMs, then checked again", async () => {
    const { send, calls } = fakeSend(org(OTHER_ORG));
    const checker = createKeyChecker({ refusalTtlMs: 60_000, now: clock });
    await checker.check(KEY, ORG_ONLY, ANTHROPIC, send);
    now += 59_999;
    expect(await checker.check(KEY, ORG_ONLY, ANTHROPIC, send)).toEqual({ kind: "wrong-organization" });
    expect(calls).toHaveLength(1);
    now += 1;
    expect(await checker.check(KEY, ORG_ONLY, ANTHROPIC, send)).toEqual({ kind: "wrong-organization" });
    expect(calls).toHaveLength(2);
  });

  it("the default refusal lifetime is five minutes", async () => {
    const { send, calls } = fakeSend(org(OTHER_ORG, WS));
    const checker = createKeyChecker({ now: clock });
    await checker.check(KEY, WITH_WS, ANTHROPIC, send);
    now += 5 * 60 * 1000 - 1;
    await checker.check(KEY, WITH_WS, ANTHROPIC, send);
    expect(calls).toHaveLength(1);
    now += 1;
    await checker.check(KEY, WITH_WS, ANTHROPIC, send);
    expect(calls).toHaveLength(2);
  });

  it("a pass outlives the refusal lifetime", async () => {
    const { send, calls } = fakeSend(org(ORG));
    const checker = createKeyChecker({ refusalTtlMs: 1000, now: clock });
    await checker.check(KEY, ORG_ONLY, ANTHROPIC, send);
    now += 10 * 24 * 60 * 60 * 1000;
    expect(await checker.check(KEY, ORG_ONLY, ANTHROPIC, send)).toEqual({ kind: "pass" });
    expect(calls).toHaveLength(1);
  });
});

describe("createKeyChecker — fails closed: unavailable, never cached", () => {
  const cases: Array<[string, (call: Call) => void, Restricted]> = [
    ["a 2xx without the organisation header", respond(200, {}), ORG_ONLY],
    ["a 2xx with only the workspace header", respond(200, { "anthropic-workspace-id": WS }), WITH_WS],
    ["an empty organisation header", respond(200, { "anthropic-organization-id": "" }), ORG_ONLY],
    // Node folds a repeated non-standard header into one comma-joined value.
    ["a folded (repeated) organisation header", respond(200, { "anthropic-organization-id": `${ORG}, ${OTHER_ORG}` }), ORG_ONLY],
    ["a folded organisation header repeating the right id", respond(200, { "anthropic-organization-id": `${ORG}, ${ORG}` }), ORG_ONLY],
    ["a folded workspace header", org(ORG, `${WS}, ${OTHER_WS}`), WITH_WS],
    ["a folded workspace header repeating the listed id", org(ORG, `${WS}, ${WS}`), WITH_WS],
    ["an empty workspace header", respond(200, { "anthropic-organization-id": ORG, "anthropic-workspace-id": "" }), WITH_WS],
    ["a network error", (call) => call.fire("error", new Error(`boom ${KEY}`)), ORG_ONLY],
    ["a timeout", (call) => call.fire("timeout"), ORG_ONLY],
    ["a 500", respond(500, { "anthropic-organization-id": ORG }), ORG_ONLY],
    ["a 503 Anthropic-shaped", respond(503, {}, JSON.stringify({ type: "error", error: { type: "overloaded_error" } })), ORG_ONLY],
    ["a 429", respond(429, { "anthropic-organization-id": ORG }, JSON.stringify({ type: "error", error: { type: "rate_limit_error" } })), ORG_ONLY],
    ["a 3xx", respond(302, { location: "https://elsewhere.example.com" }), ORG_ONLY],
    ["a 404", respond(404, {}), ORG_ONLY],
    ["a 401 that is not Anthropic-shaped on the direct route", respond(401, {}, "<html>no</html>"), ORG_ONLY],
  ];
  for (const [name, onEnd, restriction] of cases) {
    it(`${name} → unavailable, and the next check goes upstream again`, async () => {
      const { send, calls } = fakeSend(onEnd);
      const checker = createKeyChecker();
      expect(await checker.check(KEY, restriction, ANTHROPIC, send)).toEqual({ kind: "unavailable" });
      expect(await checker.check(KEY, restriction, ANTHROPIC, send)).toEqual({ kind: "unavailable" });
      expect(calls).toHaveLength(2);
      expect(checker.size()).toBe(0);
    });
  }

  it("a send that throws → unavailable", async () => {
    const send: RelaySend = () => {
      throw new Error(`bad header ${KEY}`);
    };
    expect(await createKeyChecker().check(KEY, ORG_ONLY, ANTHROPIC, send)).toEqual({ kind: "unavailable" });
  });

  it("a timeout destroys the pre-flight", async () => {
    const { send, calls } = fakeSend((call) => call.fire("timeout"));
    await createKeyChecker().check(KEY, ORG_ONLY, ANTHROPIC, send);
    expect(calls[0].destroyed).toBe(true);
  });
});

describe("createKeyChecker — Anthropic's own 403 is passed through, not cached", () => {
  for (const status of [403]) {
    it(`${status} Anthropic-shaped → upstream-error carrying that answer unchanged`, async () => {
      const { send, calls } = fakeSend(respond(status, {}, ANTHROPIC_401));
      const checker = createKeyChecker();
      const verdict = await checker.check(KEY, ORG_ONLY, ANTHROPIC, send);
      expect(verdict.kind).toBe("upstream-error");
      const response = (verdict as Extract<KeyVerdict, { kind: "upstream-error" }>).response;
      expect(response.status).toBe(status);
      expect(response.headers.get("content-type")).toBe("application/json");
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.text()).toBe(ANTHROPIC_401);
      await checker.check(KEY, ORG_ONLY, ANTHROPIC, send);
      expect(calls).toHaveLength(2);
      expect(checker.size()).toBe(0);
    });
  }

  it("through a gateway, a 401 that is not Anthropic-shaped is the gateway's refusal (502 ai-gateway-rejected)", async () => {
    const { send } = fakeSend(respond(401, {}, "<html>no</html>"));
    const verdict = await createKeyChecker().check(KEY, ORG_ONLY, GATEWAY, send);
    expect(verdict.kind).toBe("upstream-error");
    const response = (verdict as Extract<KeyVerdict, { kind: "upstream-error" }>).response;
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "ai-gateway-rejected" });
  });
});

describe("createKeyChecker — Anthropic's own 401 is passed through and remembered briefly", () => {
  let now = 0;
  const clock = () => now;
  beforeEach(() => {
    now = 1_000_000;
  });

  async function expectOwn401(verdict: KeyVerdict): Promise<void> {
    expect(verdict.kind).toBe("upstream-error");
    const response = (verdict as Extract<KeyVerdict, { kind: "upstream-error" }>).response;
    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toBe(ANTHROPIC_401);
  }

  // KILLED BY: dropping the 401 entry from the cache (every call with a junk key sends its own pre-flight).
  it("two calls with one invalid key send one pre-flight and both get Anthropic's answer unchanged", async () => {
    const { send, calls } = fakeSend(respond(401, {}, ANTHROPIC_401));
    const checker = createKeyChecker({ now: clock });
    await expectOwn401(await checker.check(KEY, ORG_ONLY, ANTHROPIC, send));
    await expectOwn401(await checker.check(KEY, ORG_ONLY, ANTHROPIC, send));
    expect(calls).toHaveLength(1);
    expect(checker.size()).toBe(1);
  });

  // KILLED BY: a TTL that never expires, or one that applies the 5-minute refusal TTL.
  it("remembers the 401 for 60 seconds, then sends a second pre-flight", async () => {
    const { send, calls } = fakeSend(respond(401, {}, ANTHROPIC_401));
    const checker = createKeyChecker({ now: clock });
    await checker.check(KEY, ORG_ONLY, ANTHROPIC, send);
    now += 59_999;
    await checker.check(KEY, ORG_ONLY, ANTHROPIC, send);
    expect(calls).toHaveLength(1);
    now += 1;
    await expectOwn401(await checker.check(KEY, ORG_ONLY, ANTHROPIC, send));
    expect(calls).toHaveLength(2);
  });

  it("a different key is checked on its own", async () => {
    const { send, calls } = fakeSend(respond(401, {}, ANTHROPIC_401));
    const checker = createKeyChecker({ now: clock });
    await checker.check(KEY, ORG_ONLY, ANTHROPIC, send);
    await checker.check(OTHER_KEY, ORG_ONLY, ANTHROPIC, send);
    expect(calls).toHaveLength(2);
  });

  it("a key that was invalid and is now valid passes once the 60 seconds are over", async () => {
    let valid = false;
    const { send, calls } = fakeSend((call) => (valid ? org(ORG)(call) : respond(401, {}, ANTHROPIC_401)(call)));
    const checker = createKeyChecker({ now: clock });
    await checker.check(KEY, ORG_ONLY, ANTHROPIC, send);
    valid = true;
    now += 60_000;
    expect((await checker.check(KEY, ORG_ONLY, ANTHROPIC, send)).kind).toBe("pass");
    expect(calls).toHaveLength(2);
  });

  it("a gateway's own 401 (not Anthropic-shaped) is not remembered", async () => {
    const { send, calls } = fakeSend(respond(401, {}, "<html>no</html>"));
    const checker = createKeyChecker({ now: clock });
    await checker.check(KEY, ORG_ONLY, GATEWAY, send);
    await checker.check(KEY, ORG_ONLY, GATEWAY, send);
    expect(calls).toHaveLength(2);
    expect(checker.size()).toBe(0);
  });

  it("a change of the restriction forgets the remembered 401", async () => {
    const { send, calls } = fakeSend(respond(401, {}, ANTHROPIC_401));
    const checker = createKeyChecker({ now: clock });
    await checker.check(KEY, ORG_ONLY, ANTHROPIC, send);
    await checker.check(KEY, WITH_WS, ANTHROPIC, send);
    expect(calls).toHaveLength(2);
  });
});

describe("createKeyChecker — coalescing: concurrent checks of one new key share one pre-flight", () => {
  it("three concurrent checks with one new key → one upstream call, three equal verdicts", async () => {
    const { send, calls } = fakeSend(org(ORG));
    const checker = createKeyChecker();
    const verdicts = await Promise.all([
      checker.check(KEY, ORG_ONLY, ANTHROPIC, send),
      checker.check(KEY, ORG_ONLY, ANTHROPIC, send),
      checker.check(KEY, ORG_ONLY, ANTHROPIC, send),
    ]);
    expect(calls).toHaveLength(1);
    expect(verdicts).toEqual([{ kind: "pass" }, { kind: "pass" }, { kind: "pass" }]);
  });

  it("concurrent checks with different anthropic-version headers do not share one pre-flight", async () => {
    const { send, calls } = fakeSend(org(ORG));
    const checker = createKeyChecker();
    const verdicts = await Promise.all([
      checker.check(KEY, ORG_ONLY, ANTHROPIC, send, "2023-06-01"),
      checker.check(KEY, ORG_ONLY, ANTHROPIC, send, "2099-01-01"),
    ]);
    expect(verdicts).toEqual([{ kind: "pass" }, { kind: "pass" }]);
    const versions = calls.map((c) => (c.options.headers as Record<string, string>)["anthropic-version"]);
    expect(versions.sort()).toEqual(["2023-06-01", "2099-01-01"]);
  });

  it("concurrent checks share an unavailable verdict, and the next one tries again", async () => {
    const { send, calls } = fakeSend(respond(503, {}));
    const checker = createKeyChecker();
    const verdicts = await Promise.all([checker.check(KEY, ORG_ONLY, ANTHROPIC, send), checker.check(KEY, ORG_ONLY, ANTHROPIC, send)]);
    expect(calls).toHaveLength(1);
    expect(verdicts).toEqual([{ kind: "unavailable" }, { kind: "unavailable" }]);
    await checker.check(KEY, ORG_ONLY, ANTHROPIC, send);
    expect(calls).toHaveLength(2);
  });

  it("concurrent callers of an upstream-error each get a readable answer of their own", async () => {
    const { send, calls } = fakeSend(respond(401, {}, ANTHROPIC_401));
    const checker = createKeyChecker();
    const verdicts = await Promise.all([checker.check(KEY, ORG_ONLY, ANTHROPIC, send), checker.check(KEY, ORG_ONLY, ANTHROPIC, send)]);
    expect(calls).toHaveLength(1);
    for (const v of verdicts) {
      expect(await (v as Extract<KeyVerdict, { kind: "upstream-error" }>).response.text()).toBe(ANTHROPIC_401);
    }
  });
});

describe("createKeyChecker — cache bounds and restriction changes", () => {
  it("a different signature (the restriction changed) clears the cache", async () => {
    const { send, calls } = fakeSend(org(ORG, WS));
    const checker = createKeyChecker();
    await checker.check(KEY, ORG_ONLY, ANTHROPIC, send);
    expect(checker.size()).toBe(1);
    expect(await checker.check(KEY, WITH_WS, ANTHROPIC, send)).toEqual({ kind: "pass" });
    expect(calls).toHaveLength(2);
    expect(checker.size()).toBe(1);
  });

  it("a verdict reached under the old restriction is never cached under the new one", async () => {
    const pending: Call[] = [];
    const { send, calls } = fakeSend((call) => pending.push(call));
    const checker = createKeyChecker();
    const old = checker.check(KEY, ORG_ONLY, ANTHROPIC, send);
    await vi.waitFor(() => expect(pending).toHaveLength(1));
    // The restriction changes (a workspace list is added) while the old check is in flight:
    // the new one is not coalesced onto it.
    const fresh = checker.check(KEY, WITH_WS, ANTHROPIC, send);
    await vi.waitFor(() => expect(pending).toHaveLength(2));
    // The new check refuses first; the old one passes (org only) afterwards and must not
    // overwrite the refusal.
    org(ORG, OTHER_WS)(pending[1]);
    expect(await fresh).toEqual({ kind: "wrong-workspace" });
    org(ORG)(pending[0]);
    expect(await old).toEqual({ kind: "pass" });
    expect(await checker.check(KEY, WITH_WS, ANTHROPIC, send)).toEqual({ kind: "wrong-workspace" });
    expect(calls).toHaveLength(2);
    expect(checker.size()).toBe(1);
  });

  it("eviction keeps size() <= maxEntries, oldest first", async () => {
    const { send, calls } = fakeSend(org(ORG));
    const checker = createKeyChecker({ maxEntries: 3 });
    for (const k of ["k1", "k2", "k3", "k4"]) await checker.check(k, ORG_ONLY, ANTHROPIC, send);
    expect(checker.size()).toBe(3);
    expect(calls).toHaveLength(4);
    // k2..k4 are still cached; k1 (the oldest) was evicted.
    for (const k of ["k2", "k3", "k4"]) await checker.check(k, ORG_ONLY, ANTHROPIC, send);
    expect(calls).toHaveLength(4);
    await checker.check("k1", ORG_ONLY, ANTHROPIC, send);
    expect(calls).toHaveLength(5);
    expect(checker.size()).toBe(3);
  });

  it("the default cap is 1000 entries", async () => {
    const { send } = fakeSend(org(ORG));
    const checker = createKeyChecker();
    for (let i = 0; i < 1001; i++) await checker.check(`key-${i}`, ORG_ONLY, ANTHROPIC, send);
    expect(checker.size()).toBe(1000);
  });
});

describe("createKeyChecker — never logs, returns or keeps the key", () => {
  const spies: Array<ReturnType<typeof vi.spyOn>> = [];
  beforeEach(() => {
    for (const m of ["log", "info", "warn", "error", "debug"] as const) {
      spies.push(vi.spyOn(console, m).mockImplementation(() => {}));
    }
  });
  afterEach(() => {
    spies.splice(0).forEach((s) => s.mockRestore());
  });

  it("no console output or verdict carries the key, in any outcome", async () => {
    const scenarios: Array<(call: Call) => void> = [
      org(ORG),
      org(OTHER_ORG),
      respond(500, {}),
      respond(401, {}, ANTHROPIC_401),
      (call) => call.fire("error", new Error(`boom ${KEY}`)),
      (call) => call.fire("timeout"),
    ];
    const seen: string[] = [];
    for (const onEnd of scenarios) {
      const { send } = fakeSend(onEnd);
      const v = await createKeyChecker().check(KEY, ORG_ONLY, ANTHROPIC, send);
      seen.push(v.kind === "upstream-error" ? await v.response.text() : JSON.stringify(v));
    }
    const logged = JSON.stringify([...spies.map((s) => s.mock.calls), seen]);
    expect(logged).not.toContain(KEY);
  });
});
