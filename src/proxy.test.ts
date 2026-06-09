import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "./proxy";

function cspFor(url = "http://localhost:3000/"): string {
  const res = proxy(new NextRequest(new Request(url)));
  return res.headers.get("Content-Security-Policy") ?? "";
}

/** Extract a single directive's value from a CSP string. */
function directive(csp: string, name: string): string {
  const part = csp.split(";").map((p) => p.trim()).find((p) => p.startsWith(`${name} `));
  return part ?? "";
}

describe("proxy CSP — connect-src", () => {
  it("allowlists the Turso libSQL host so the browser can reach the backend", () => {
    // Regression: connect-src once only allowed 'self' + Anthropic, which
    // blocked every Turso fetch with a TypeError that surfaced as
    // "storage-unreachable". The Turso backend AND snapshot store both POST to
    // https://<db>-<org>.aws-<region>.turso.io/v2/pipeline from the browser.
    const connect = directive(cspFor(), "connect-src");
    expect(connect).toContain("https://*.turso.io");
  });

  it("allows a local/self-hosted tursodb over loopback http", () => {
    const connect = directive(cspFor(), "connect-src");
    expect(connect).toContain("http://localhost:*");
    expect(connect).toContain("http://127.0.0.1:*");
  });

  it("keeps the existing self + Anthropic sources", () => {
    const connect = directive(cspFor(), "connect-src");
    expect(connect).toContain("'self'");
    expect(connect).toContain("https://api.anthropic.com");
  });

  it("allowlists Microsoft Graph + login for the M365 integrations", () => {
    // SharePoint backend + Outlook calendar/contacts call graph.microsoft.com;
    // MSAL's PKCE token exchange calls login.microsoftonline.com. Both are
    // browser fetches and were blocked by the original connect-src.
    const connect = directive(cspFor(), "connect-src");
    expect(connect).toContain("https://graph.microsoft.com");
    expect(connect).toContain("https://login.microsoftonline.com");
  });
});

describe("proxy CSP — frame-src", () => {
  it("allows the MSAL silent-token-renewal iframe to load the login host", () => {
    // acquireTokenSilent renews tokens via a hidden iframe pointed at
    // login.microsoftonline.com — frame-src 'none' blocked it.
    const frame = directive(cspFor(), "frame-src");
    expect(frame).toContain("https://login.microsoftonline.com");
    expect(frame).not.toContain("'none'");
  });
});
