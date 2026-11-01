// @vitest-environment node
//
// The relay and its organisation key check against the REAL Anthropic API and a REAL Cloudflare AI
// Gateway (AI organisation key). Run only by `.github/workflows/ai-live.yml`, started by hand. Every
// proof here SKIPS unless all five AI_LIVE_* values are set AND AI_LIVE_REQUIRED is "1", which only
// that workflow's test step sets: neither the unit job nor a local shell that happens to export the
// AI_LIVE_* values ever makes a paid call.
//
// `relay()` runs in-process with the production `httpsSend`, wrapped by a recorder. The recorder
// keeps, per upstream call, only what the proofs need: which call it was (pre-flight, model list,
// Messages), whether the gateway headers were sent, the status, and whether the organisation and
// workspace headers came back and matched. Never a key, token, id, URL or body, so no assertion
// message and no summary line can print one. "Nothing reached Anthropic" is read off that record.
//
// msw (vitest.setup.ts) is closed for this file: it would otherwise intercept every call and log
// each unhandled one with its URL and body.
import { appendFileSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { server } from "../../../test/msw-server";
import { AI_GATEWAY_TOKEN_ENV, AI_GATEWAY_URL_ENV } from "../../ai-gateway-config";
import { AI_ORGANIZATION_ID_ENV, AI_WORKSPACE_IDS_ENV } from "../../ai-key-restriction-config";
import { AI_KEY_WRONG_ORGANIZATION, AI_KEY_WRONG_WORKSPACE } from "../../ai-errors";
import { createKeyChecker } from "./_key-check";
import { httpsSend, relay, type RelayOp, type RelaySend } from "./_relay";

const SECRET_NAMES = [
  "AI_LIVE_ANTHROPIC_KEY",
  "AI_LIVE_ORGANIZATION_ID",
  "AI_LIVE_WORKSPACE_ID",
  "AI_LIVE_GATEWAY_URL",
  "AI_LIVE_GATEWAY_TOKEN",
] as const;
const value = (name: (typeof SECRET_NAMES)[number]) => process.env[name]?.trim() ?? "";
const missing = SECRET_NAMES.filter((name) => value(name) === "");
const allSecretsSet = missing.length === 0;
const liveRun = allSecretsSet && process.env.AI_LIVE_REQUIRED === "1";

// ai-live.yml sets this on its test step: there a run that skipped every proof must fail.
it.runIf(process.env.AI_LIVE_REQUIRED === "1")("has all five AI_LIVE_* values (the live job sets AI_LIVE_REQUIRED)", () => {
  expect(missing, "names of the missing values").toEqual([]);
});

const LIVE_TIMEOUT_MS = 60_000;
const ANTHROPIC_VERSION = "2023-06-01";
const ORGANIZATION_HEADER = "anthropic-organization-id";
const WORKSPACE_HEADER = "anthropic-workspace-id";
// The rule a gateway must meet to be combined with the restriction: it passes Anthropic's answer headers back.
const GATEWAY_PASSES_HEADERS =
  "the gateway did not pass back both anthropic-organization-id and anthropic-workspace-id, so every check is "
  + "unavailable and AI stays off. docs/RUNBOOK.md, Restricting AI to the organisation's Anthropic keys, "
  + "step 6: such a gateway cannot be combined with the restriction. Fix the gateway; never loosen the check";

type CallKind = "preflight" | "models" | "messages" | "other";
interface UpstreamCall {
  kind: CallKind;
  sentSkipCache: boolean;
  sentGatewayToken: boolean;
  status: number | null;
  organizationHeader: boolean;
  workspaceHeader: boolean;
  organizationMatches: boolean;
  workspaceMatches: boolean;
}

function kindOf(url: URL): CallKind {
  if (url.pathname.endsWith("/v1/messages")) return "messages";
  if (!url.pathname.endsWith("/v1/models")) return "other";
  return url.searchParams.get("limit") === "1" ? "preflight" : "models";
}

// Trimmed, not case-folded: the organisation id (a UUID) is compared in lower case below, a
// workspace id (case-sensitive) exactly, as the key check compares them.
const headerOf = (headers: Record<string, string | string[] | undefined>, name: string): string | null => {
  const v = headers[name];
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
};

/** A random id in a workspace id's shape (`wrkspc_` plus an alphanumeric identifier). */
const randomWorkspaceId = (): string => `wrkspc_${randomBytes(12).toString("hex")}`;

/** The production send, recording each call without keeping any value it carries. */
function recorder(): { send: RelaySend; calls: UpstreamCall[] } {
  const calls: UpstreamCall[] = [];
  const send: RelaySend = (url, options, onResponse) => {
    const sent = (options.headers ?? {}) as Record<string, unknown>;
    const call: UpstreamCall = {
      kind: kindOf(url),
      sentSkipCache: sent["cf-aig-skip-cache"] === "true",
      sentGatewayToken: typeof sent["cf-aig-authorization"] === "string",
      status: null,
      organizationHeader: false,
      workspaceHeader: false,
      organizationMatches: false,
      workspaceMatches: false,
    };
    calls.push(call);
    return httpsSend(url, options, (res) => {
      const org = headerOf(res.headers, ORGANIZATION_HEADER);
      const workspace = headerOf(res.headers, WORKSPACE_HEADER);
      call.status = res.statusCode ?? null;
      call.organizationHeader = org !== null;
      call.workspaceHeader = workspace !== null;
      call.organizationMatches = org?.toLowerCase() === value("AI_LIVE_ORGANIZATION_ID").toLowerCase();
      call.workspaceMatches = workspace === value("AI_LIVE_WORKSPACE_ID");
      onResponse(res);
    });
  };
  return { send, calls };
}

/** A browser call from the app's own page: `isSameOrigin` accepts `sec-fetch-site: same-origin`. */
function browserRequest(op: RelayOp, key: string, body?: unknown): Request {
  const headers: Record<string, string> = {
    "x-api-key": key,
    "anthropic-version": ANTHROPIC_VERSION,
    "sec-fetch-site": "same-origin",
  };
  if (body === undefined) return new Request(`http://localhost:3000/api/ai/${op}`, { headers });
  return new Request(`http://localhost:3000/api/ai/${op}`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** One relayed call with a fresh verdict cache, so no proof reads another's verdict. */
async function relayed(op: RelayOp, env: Record<string, string>, body?: unknown, key = value("AI_LIVE_ANTHROPIC_KEY")) {
  const { send, calls } = recorder();
  const response = await relay(browserRequest(op, key, body), op, env, send, createKeyChecker());
  const text = await response.text();
  return { status: response.status, text, calls };
}

/** The body as JSON, or undefined when it is not JSON. Never throws: a parse error quotes the text it
 *  failed on, and no assertion message may carry an upstream body. Callers assert booleans on it. */
function parsedBody(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

const field = (body: unknown, name: string): unknown =>
  body !== null && typeof body === "object" && name in body ? (body as Record<string, unknown>)[name] : undefined;

// The relay's codes are short lower-case slugs; anything else is not one and is never echoed.
const RELAY_CODE = /^[a-z0-9-]{1,64}$/;

/** The relay's own refusal code, or null when the body is not one. */
function codeOf(text: string): string | null {
  const code = field(parsedBody(text), "error");
  return typeof code === "string" && RELAY_CODE.test(code) ? code : null;
}

const kinds = (calls: UpstreamCall[]) => calls.map((c) => c.kind);
const summary: string[] = [];

describe.skipIf(!liveRun)("relay + key check, live (ai-live.yml)", () => {
  const org = value("AI_LIVE_ORGANIZATION_ID");
  const workspace = value("AI_LIVE_WORKSPACE_ID");
  const direct = (organizationId: string, workspaceId: string): Record<string, string> => ({
    [AI_ORGANIZATION_ID_ENV]: organizationId,
    [AI_WORKSPACE_IDS_ENV]: workspaceId,
  });
  const gateway = (organizationId: string, workspaceId: string): Record<string, string> => ({
    ...direct(organizationId, workspaceId),
    [AI_GATEWAY_URL_ENV]: value("AI_LIVE_GATEWAY_URL"),
    [AI_GATEWAY_TOKEN_ENV]: value("AI_LIVE_GATEWAY_TOKEN"),
  });
  let model = "";
  const messageBody = () => ({ model, max_tokens: 1, messages: [{ role: "user", content: "Hi" }] });

  beforeAll(async () => {
    server.close();
    // The cheapest current model: Haiku is Anthropic's lowest price tier; the newest one listed.
    const { status, text } = await relayed("models", direct(org, workspace));
    expect(status, `model list through the relay (${codeOf(text) ?? "no relay code"})`).toBe(200);
    const body = parsedBody(text);
    expect(body !== undefined, "the model list body is JSON").toBe(true);
    const data = field(body, "data");
    const list: unknown[] = Array.isArray(data) ? data : [];
    const haiku = list
      .filter((m): m is { id: string; created_at?: unknown } => {
        const id = field(m, "id");
        return typeof id === "string" && id.includes("haiku");
      })
      .sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));
    expect(haiku.length, "a Haiku model in the live model list").toBeGreaterThan(0);
    model = haiku[0].id;
    summary.push(`- Model for the Messages calls: \`${model}\``);
  }, LIVE_TIMEOUT_MS);

  afterAll(() => {
    server.listen({ onUnhandledFrame: "error" });
    const text = ["### ai-live: relay and key check", "", ...summary, ""].join("\n");
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
    else process.stdout.write(`${text}\n`);
  });

  it("1. direct, correct organisation and workspace: the pre-flight passes and a small Messages call succeeds", async () => {
    const { status, text, calls } = await relayed("messages", direct(org, workspace), messageBody());
    expect(kinds(calls)).toEqual(["preflight", "messages"]);
    const [preflight, messages] = calls;
    expect(preflight).toMatchObject({ status: 200, organizationMatches: true, workspaceMatches: true, sentSkipCache: false, sentGatewayToken: false });
    expect(messages.status).toBe(200);
    expect({ status, code: codeOf(text) }).toEqual({ status: 200, code: null });
    expect(field(parsedBody(text), "type") === "message", "the answer is a message").toBe(true);
  }, LIVE_TIMEOUT_MS);

  it("2. direct, a random organisation id: refused as wrong organisation, no Messages call reached Anthropic", async () => {
    const { status, text, calls } = await relayed("messages", direct(randomUUID(), workspace), messageBody());
    expect({ status, code: codeOf(text) }).toEqual({ status: 403, code: AI_KEY_WRONG_ORGANIZATION });
    expect(kinds(calls)).toEqual(["preflight"]);
    expect(calls[0]).toMatchObject({ status: 200, organizationHeader: true, organizationMatches: true });
  }, LIVE_TIMEOUT_MS);

  it("3. direct, a random workspace id: refused as wrong workspace, no Messages call reached Anthropic", async () => {
    const { status, text, calls } = await relayed("messages", direct(org, randomWorkspaceId()), messageBody());
    expect({ status, code: codeOf(text) }).toEqual({ status: 403, code: AI_KEY_WRONG_WORKSPACE });
    expect(kinds(calls)).toEqual(["preflight"]);
    expect(calls[0]).toMatchObject({ status: 200, workspaceHeader: true, workspaceMatches: true });
  }, LIVE_TIMEOUT_MS);

  it("4. gateway, correct ids: both headers come back through the gateway and the Messages call succeeds", async () => {
    const { status, text, calls } = await relayed("messages", gateway(org, workspace), messageBody());
    const preflight = calls[0];
    expect(preflight?.kind).toBe("preflight");
    summary.push(
      `- Gateway pre-flight: status ${preflight?.status ?? "none"}, `
        + `organisation header ${preflight?.organizationHeader ? "present" : "ABSENT"}, `
        + `workspace header ${preflight?.workspaceHeader ? "present" : "ABSENT"}`,
    );
    expect(preflight).toMatchObject({ sentSkipCache: true, sentGatewayToken: true });
    expect(preflight.organizationHeader && preflight.workspaceHeader, GATEWAY_PASSES_HEADERS).toBe(true);
    expect(preflight).toMatchObject({ status: 200, organizationMatches: true, workspaceMatches: true });
    expect(kinds(calls)).toEqual(["preflight", "messages"]);
    // The Messages call itself went through the gateway, with its token, and succeeded.
    expect(calls[1]).toMatchObject({ status: 200, sentGatewayToken: true });
    expect({ status, code: codeOf(text) }).toEqual({ status: 200, code: null });
  }, LIVE_TIMEOUT_MS);

  it("5. gateway, a random organisation id: refused before any Messages call", async () => {
    const { status, text, calls } = await relayed("messages", gateway(randomUUID(), workspace), messageBody());
    const preflight = calls[0];
    expect(preflight?.kind).toBe("preflight");
    expect(preflight).toMatchObject({ sentSkipCache: true, sentGatewayToken: true });
    expect(preflight.organizationHeader && preflight.workspaceHeader, GATEWAY_PASSES_HEADERS).toBe(true);
    expect({ status, code: codeOf(text) }).toEqual({ status: 403, code: AI_KEY_WRONG_ORGANIZATION });
    expect(kinds(calls)).toEqual(["preflight"]);
  }, LIVE_TIMEOUT_MS);

  // Recorded, not asserted: whether Anthropic names the organisation on a 401 is not documented.
  it("6. records whether the organisation header comes back on a 401 for an invalid key", async () => {
    const invalidKey = `sk-ant-api03-${randomBytes(24).toString("hex")}`;
    const { status, calls } = await relayed("messages", direct(org, workspace), messageBody(), invalidKey);
    const preflight = calls[0];
    summary.push(
      `- Invalid key, direct pre-flight: status ${preflight?.status ?? "none"}, `
        + `organisation header ${preflight?.organizationHeader ? "PRESENT" : "absent"}`,
    );
    expect(kinds(calls)).toEqual(["preflight"]);
    expect(preflight.status).toBe(401);
    expect(status).toBe(401);
  }, LIVE_TIMEOUT_MS);
});
