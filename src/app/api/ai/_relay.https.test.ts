// @vitest-environment node
//
// The relay's REAL upstream path — `node:https.request` with the options `relay` builds —
// against a local TLS server on 127.0.0.1. The other relay tests use a fake `send`; this
// one proves the headers survive the real client, and that a browser going away mid-stream
// tears the upstream connection down without an unhandled error.
//
// The certificate is self-signed and made in-process for each run (node:crypto has no
// certificate builder, so a minimal X.509 is DER-encoded below); nothing is committed. It
// names 127.0.0.1 and localhost, and the test's `send` passes it as the only trusted CA
// (`ca`) around the production `httpsSend`, so certificate verification stays on.
import { createServer, type Server } from "node:https";
import type { IncomingMessage, RequestOptions, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { generateKeyPairSync, sign } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { httpsSend, relay, type RelaySend } from "./_relay";
import { createKeyChecker } from "./_key-check";

// ── A minimal self-signed X.509 v3 certificate (ECDSA P-256, SHA-256), DER-encoded ──
function derLength(n: number): Buffer {
  if (n < 0x80) return Buffer.from([n]);
  const bytes: number[] = [];
  for (let v = n; v > 0; v = Math.floor(v / 256)) bytes.unshift(v & 0xff);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}
const der = (tag: number, ...parts: Buffer[]): Buffer => {
  const body = Buffer.concat(parts);
  return Buffer.concat([Buffer.from([tag]), derLength(body.length), body]);
};
const seq = (...parts: Buffer[]) => der(0x30, ...parts);
function oid(dotted: string): Buffer {
  const [a, b, ...rest] = dotted.split(".").map(Number);
  const out = [40 * a + b];
  for (const n of rest) {
    const groups: number[] = [];
    for (let v = n; ; v = Math.floor(v / 128)) {
      groups.unshift(v & 0x7f);
      if (v < 128) break;
    }
    for (let i = 0; i < groups.length - 1; i++) groups[i] |= 0x80;
    out.push(...groups);
  }
  return der(0x06, Buffer.from(out));
}
function utcTime(d: Date): Buffer {
  const p = (n: number) => String(n).padStart(2, "0");
  const s = `${p(d.getUTCFullYear() % 100)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}`
    + `${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`;
  return der(0x17, Buffer.from(s, "ascii"));
}

function selfSignedCert(): { key: string; cert: string } {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const ecdsaSha256 = seq(oid("1.2.840.10045.4.3.2"));
  const name = seq(der(0x31, seq(oid("2.5.4.3"), der(0x0c, Buffer.from("localhost")))));
  const day = 24 * 60 * 60 * 1000;
  const tbs = seq(
    der(0xa0, der(0x02, Buffer.from([2]))), // version v3
    der(0x02, Buffer.from([1])), // serial
    ecdsaSha256,
    name,
    seq(utcTime(new Date(Date.now() - day)), utcTime(new Date(Date.now() + day))),
    name,
    publicKey.export({ type: "spki", format: "der" }),
    // extensions [3]: subjectAltName = DNS:localhost, IP:127.0.0.1, so the client verifies the
    // loopback server's identity against this certificate instead of skipping verification.
    der(0xa3, seq(seq(
      oid("2.5.29.17"),
      der(0x04, seq(der(0x82, Buffer.from("localhost", "ascii")), der(0x87, Buffer.from([127, 0, 0, 1])))),
    ))),
  );
  const signature = sign("sha256", tbs, privateKey);
  const cert = seq(tbs, ecdsaSha256, der(0x03, Buffer.from([0]), signature));
  const pem = `-----BEGIN CERTIFICATE-----\n${cert.toString("base64").match(/.{1,64}/g)!.join("\n")}\n-----END CERTIFICATE-----\n`;
  return { key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(), cert: pem };
}

// ── The loopback gateway ──
let server: Server | null = null;
/** The running gateway's certificate, which the test client trusts as its only CA. */
let gatewayCert: string | null = null;

async function startGateway(handler: (req: IncomingMessage, res: ServerResponse) => void): Promise<string> {
  const credentials = selfSignedCert();
  gatewayCert = credentials.cert;
  const s = createServer(credentials, handler);
  server = s;
  await new Promise<void>((resolve) => s.listen(0, "127.0.0.1", resolve));
  return `https://127.0.0.1:${(s.address() as AddressInfo).port}/acct/gw/anthropic`;
}

afterEach(async () => {
  const s = server;
  server = null;
  gatewayCert = null;
  if (!s) return;
  s.closeAllConnections();
  await new Promise<void>((resolve) => s.close(() => resolve()));
});

/** The production send, trusting the loopback gateway's own certificate as its only CA. Verification
 *  stays on: the certificate names 127.0.0.1. Test-only. */
const loopbackSend: RelaySend = (url, options, onResponse) => {
  if (gatewayCert === null) throw new Error("no gateway running");
  // `RelaySend` is typed with node:http's options; node:https reads the TLS one from the same object.
  const withTls: RequestOptions & { ca: string } = { ...options, ca: gatewayCert };
  return httpsSend(url, withTls, onResponse);
};

const TOKEN = "gateway-secret-token";
// Invented organisation ids.
const ORG = "11111111-2222-3333-4444-555555555555";
const OTHER_ORG = "99999999-8888-7777-6666-555555555555";

function browserPost(signal?: AbortSignal): Request {
  return new Request("http://localhost:3000/api/ai/messages", {
    method: "POST",
    headers: {
      "sec-fetch-site": "same-origin",
      "x-api-key": "sk-ant-key",
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "prompt-caching-2024-07-31",
      "content-type": "application/json",
      cookie: "session=must-not-leave",
      "x-other": "must-not-leave",
    },
    body: JSON.stringify({ model: "m", messages: [] }),
    signal,
  });
}

/** Unhandled errors and rejections raised while `run` executes (and shortly after). */
async function collectUnhandled(run: () => Promise<void>): Promise<unknown[]> {
  const seen: unknown[] = [];
  const onError = (e: unknown) => { seen.push(e); };
  process.on("uncaughtException", onError);
  process.on("unhandledRejection", onError);
  try {
    await run();
    await new Promise((r) => setTimeout(r, 50));
  } finally {
    process.off("uncaughtException", onError);
    process.off("unhandledRejection", onError);
  }
  return seen;
}

describe("relay over real https (loopback)", () => {
  // Verification is on: without the test's certificate as a trusted CA the production send refuses the
  // self-signed gateway, and the relay answers with its own gateway error. (Control for `loopbackSend`.)
  it("the production send refuses the untrusted self-signed gateway", async () => {
    let reached = false;
    const base = await startGateway((_req, res) => {
      reached = true;
      res.end();
    });
    const res = await relay(browserPost(), "messages", { AIPM_AI_GATEWAY_URL: base, AIPM_AI_GATEWAY_TOKEN: TOKEN }, httpsSend);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "ai-gateway-error" });
    expect(reached).toBe(false);
  });

  it("forwards only the allowed headers plus the gateway token, and streams the answer back", async () => {
    let received: IncomingMessage["headers"] = {};
    let receivedPath = "";
    let receivedBody = "";
    const base = await startGateway((req, res) => {
      received = req.headers;
      receivedPath = req.url ?? "";
      req.setEncoding("utf8");
      req.on("data", (c: string) => { receivedBody += c; });
      req.on("end", () => {
        res.writeHead(200, { "content-type": "text/event-stream", "set-cookie": "gw=1" });
        res.end("event: done\n\n");
      });
    });

    const res = await relay(browserPost(), "messages", { AIPM_AI_GATEWAY_URL: base, AIPM_AI_GATEWAY_TOKEN: TOKEN }, loopbackSend);

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("event: done\n\n");
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(receivedPath).toBe("/acct/gw/anthropic/v1/messages");
    expect(receivedBody).toBe(JSON.stringify({ model: "m", messages: [] }));
    expect(received).toMatchObject({
      "x-api-key": "sk-ant-key",
      "anthropic-version": "2023-06-01",
      "anthropic-beta": "prompt-caching-2024-07-31",
      "content-type": "application/json",
      "cf-aig-authorization": `Bearer ${TOKEN}`,
      "content-length": String(Buffer.byteLength(JSON.stringify({ model: "m", messages: [] }))),
    });
    expect(received.cookie).toBeUndefined();
    expect(received["x-other"]).toBeUndefined();
    expect(received["sec-fetch-site"]).toBeUndefined();
  });

  // The organisation key check over the real client: the pre-flight is a GET to the gateway's models route,
  // the answer's headers decide, and only a pass lets the Messages call through. A fresh checker per test
  // keeps the process-wide cache out of it.
  describe("organisation key check", () => {
    const restricted = (base: string) => ({
      AIPM_AI_GATEWAY_URL: base, AIPM_AI_GATEWAY_TOKEN: TOKEN, AIPM_AI_ORGANIZATION_ID: ORG,
    });
    /** A gateway answering the pre-flight with `organization` (and a body, which the check drops unread) and the
     *  Messages call with 200; it records every request it sees. */
    const startChecked = (organization: string) => {
      const seen: Array<{ method: string; path: string; skipCache: string | string[] | undefined }> = [];
      const ready = startGateway((req, res) => {
        seen.push({ method: req.method ?? "", path: req.url ?? "", skipCache: req.headers["cf-aig-skip-cache"] });
        req.resume();
        if (req.method === "GET") {
          res.writeHead(200, { "content-type": "application/json", "anthropic-organization-id": organization });
          res.end(JSON.stringify({ data: [{ id: "m" }] }));
          return;
        }
        req.on("end", () => {
          res.writeHead(200, { "content-type": "application/json" });
          res.end("{\"ok\":true}");
        });
      });
      return { ready, seen };
    };

    it("a key of the organisation passes: the pre-flight goes first, then the Messages call reaches the gateway", async () => {
      const { ready, seen } = startChecked(ORG);
      const base = await ready;
      const res = await relay(browserPost(), "messages", restricted(base), loopbackSend, createKeyChecker());
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
      expect(seen).toEqual([
        { method: "GET", path: "/acct/gw/anthropic/v1/models?limit=1", skipCache: "true" },
        { method: "POST", path: "/acct/gw/anthropic/v1/messages", skipCache: undefined },
      ]);
    });

    it("a key of another organisation is refused with 403 and the gateway saw only the pre-flight", async () => {
      const { ready, seen } = startChecked(OTHER_ORG);
      const base = await ready;
      const res = await relay(browserPost(), "messages", restricted(base), loopbackSend, createKeyChecker());
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: "ai-key-wrong-organization" });
      expect(seen.map((r) => r.method)).toEqual(["GET"]);
    });
  });

  // KILLED BY: dropping `upstream?.destroy()` from the relay's abort handler (the gateway keeps streaming to nobody).
  it("a browser that goes away mid-stream closes the upstream connection before it finished, with no unhandled error", async () => {
    let upstreamClosed!: () => void;
    const closed = new Promise<void>((r) => { upstreamClosed = r; });
    let finishedBeforeClose: boolean | null = null;
    const base = await startGateway((req, res) => {
      req.resume();
      req.on("end", () => {
        res.writeHead(200, { "content-type": "text/event-stream" });
        res.write("event: first\n\n"); // ...and never ends on its own
      });
      res.on("close", () => {
        finishedBeforeClose = res.writableFinished;
        upstreamClosed();
      });
    });

    const unhandled = await collectUnhandled(async () => {
      const browser = new AbortController();
      const res = await relay(
        browserPost(browser.signal), "messages", { AIPM_AI_GATEWAY_URL: base, AIPM_AI_GATEWAY_TOKEN: TOKEN }, loopbackSend,
      );
      expect(res.status).toBe(200);
      const reader = res.body!.getReader();
      const first = await reader.read();
      expect(new TextDecoder().decode(first.value)).toBe("event: first\n\n");
      browser.abort();
      await closed;
      // The stream the browser was reading ends in an error, never a hang or a throw elsewhere.
      await reader.read().catch(() => undefined);
    });

    expect(finishedBeforeClose).toBe(false);
    expect(unhandled).toEqual([]);
  });
});
