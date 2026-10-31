// @vitest-environment node
//
// The relay (server) and the transport (browser) agree on the relay's own error codes only
// through the wire. Each case builds the relay's REAL answer and hands it to the client's
// `postAiMessages`, so a code renamed on one side and not the other fails here.
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { relay, type RelaySend, type UpstreamResponse } from "./_relay";
import { AiDeploymentError, AiGatewayError, postAiMessages } from "../../ai-transport";
import { AiKeyCheckUnavailableError, AiKeyRefusedError } from "../../ai-errors";
import { createKeyChecker } from "./_key-check";
import { setAiDeploymentState, type AiDeploymentState } from "../../ai-deployment";
import { __setAiStatusRequestForTests } from "../../ai-status-request";
import { aiStatusResponse, DIRECT_AI_STATUS } from "../../../test/ai-status-fetch";

const GATEWAY: AiDeploymentState = { off: false, route: "gateway", invalid: false, keyRestricted: false };
const GATEWAY_ENV = { AIPM_AI_GATEWAY_URL: "https://gateway.example.com/acct/gw/anthropic" };
const KEY = "sk-ant-wire-test";

/** A send that answers every upstream call with `status` and a non-Anthropic body. */
function upstreamAnswers(status: number): RelaySend {
  return (_url, _options, onResponse) => ({
    on() {
      return this;
    },
    end() {
      const res: UpstreamResponse = Object.assign(Readable.from([Buffer.from("<html>no</html>")]), {
        statusCode: status,
        headers: { "content-type": "text/html" },
      });
      queueMicrotask(() => onResponse(res));
      return this;
    },
    destroy() {
      return this;
    },
  });
}

function browserRequest(headers: Record<string, string> = { "x-api-key": KEY }): Request {
  return new Request("http://localhost:3000/api/ai/messages", {
    method: "POST",
    headers: { "sec-fetch-site": "same-origin", "content-type": "application/json", ...headers },
    body: "{}",
  });
}

/** The client's reading of `relayAnswer`: the thrown error, or the Response it returned. */
async function clientReads(relayAnswer: Response): Promise<unknown> {
  vi.stubGlobal("fetch", vi.fn(async () => relayAnswer));
  return postAiMessages({ privacy: { protected: false }, apiKey: KEY, body: "{}", path: "chat" }).catch((e: unknown) => e);
}

beforeEach(() => {
  setAiDeploymentState(GATEWAY);
  __setAiStatusRequestForTests(async () => aiStatusResponse(GATEWAY));
});

afterEach(() => {
  vi.unstubAllGlobals();
  setAiDeploymentState(DIRECT_AI_STATUS);
});

describe("relay ⇄ transport wire codes", () => {
  it.each([
    ["switched off", { ...GATEWAY_ENV, AIPM_DISABLED_INTEGRATIONS: "ai" }, "off"],
    ["an invalid gateway setting", { AIPM_AI_GATEWAY_URL: "http://not-https.example.net" }, "invalid"],
    ["a direct deployment", {}, "route-changed"],
  ] as const)("%s → AiDeploymentError %s", async (_label, env, reason) => {
    const err = await clientReads(await relay(browserRequest(), "messages", env));
    expect(err).toBeInstanceOf(AiDeploymentError);
    expect((err as AiDeploymentError).reason).toBe(reason);
  });

  it.each([
    [401, "ai-gateway-rejected"],
    [403, "ai-gateway-rejected"],
    [429, "ai-gateway-rate-limited"],
    [500, "ai-gateway-error"],
  ] as const)("upstream %i → AiGatewayError %s", async (status, code) => {
    const err = await clientReads(await relay(browserRequest(), "messages", GATEWAY_ENV, upstreamAnswers(status)));
    expect(err).toBeInstanceOf(AiGatewayError);
    expect((err as AiGatewayError).code).toBe(code);
  });

  it("not same-origin → AiGatewayError ai-gateway-error, never a key verdict", async () => {
    const answer = await relay(browserRequest({ "x-api-key": KEY, "sec-fetch-site": "cross-site" }), "messages", GATEWAY_ENV);
    const err = await clientReads(answer);
    expect((err as AiGatewayError).code).toBe("ai-gateway-error");
  });

  it("missing api key → the relay's 400 reaches the caller as a plain 400", async () => {
    const res = await clientReads(await relay(browserRequest({}), "messages", GATEWAY_ENV));
    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(400);
    expect(await (res as Response).json()).toEqual({ error: "missing-api-key" });
  });
});

describe("relay <-> transport wire codes for a refused key (AI organisation key)", () => {
  const ORG = "11111111-2222-3333-4444-555555555555";
  const OTHER_ORG = "99999999-8888-7777-6666-555555555555";
  const WS = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  const OTHER_WS = "ffffffff-bbbb-cccc-dddd-eeeeeeeeeeee";
  const RESTRICTED: AiDeploymentState = { off: false, route: "relay", invalid: false, keyRestricted: true };

  /** Answers the pre-flight with a 2xx carrying the given organisation (and workspace) headers. */
  function preflightAs(headers: Record<string, string>): RelaySend {
    return (_url, _options, onResponse) => ({
      on() {
        return this;
      },
      end() {
        const res: UpstreamResponse = Object.assign(Readable.from([Buffer.from('{"data":[]}')]), {
          statusCode: 200,
          headers: { "content-type": "application/json", ...headers },
        });
        queueMicrotask(() => onResponse(res));
        return this;
      },
      destroy() {
        return this;
      },
    });
  }

  beforeEach(() => {
    setAiDeploymentState(RESTRICTED);
    __setAiStatusRequestForTests(async () => aiStatusResponse(RESTRICTED));
  });

  it("another organisation -> AiKeyRefusedError organization", async () => {
    const send = preflightAs({ "anthropic-organization-id": OTHER_ORG });
    const answer = await relay(browserRequest(), "messages", { AIPM_AI_ORGANIZATION_ID: ORG }, send, createKeyChecker());
    const err = await clientReads(answer);
    expect(err).toBeInstanceOf(AiKeyRefusedError);
    expect((err as AiKeyRefusedError).reason).toBe("organization");
  });

  it("a workspace not on the list -> AiKeyRefusedError workspace", async () => {
    const env = { AIPM_AI_ORGANIZATION_ID: ORG, AIPM_AI_WORKSPACE_IDS: WS };
    const send = preflightAs({ "anthropic-organization-id": ORG, "anthropic-workspace-id": OTHER_WS });
    const err = await clientReads(await relay(browserRequest(), "messages", env, send, createKeyChecker()));
    expect(err).toBeInstanceOf(AiKeyRefusedError);
    expect((err as AiKeyRefusedError).reason).toBe("workspace");
  });

  it("a check that cannot be made -> AiKeyCheckUnavailableError, not an unconfirmed deployment", async () => {
    const env = { AIPM_AI_ORGANIZATION_ID: ORG };
    const err = await clientReads(await relay(browserRequest(), "messages", env, upstreamAnswers(500), createKeyChecker()));
    expect(err).toBeInstanceOf(AiKeyCheckUnavailableError);
  });
});
