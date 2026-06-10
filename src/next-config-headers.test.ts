import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";

/** Resolve the security headers next.config attaches to every route. */
async function securityHeaders(): Promise<Map<string, string>> {
  const rules = await nextConfig.headers!();
  const catchAll = rules.find((r) => r.source === "/(.*)");
  if (!catchAll) throw new Error("catch-all route not found in next.config headers");
  return new Map(catchAll.headers.map((h) => [h.key, h.value]));
}

describe("next.config security headers", () => {
  it("sends HSTS with a one-year max-age covering subdomains", async () => {
    const headers = await securityHeaders();
    expect(headers.get("Strict-Transport-Security")).toBe(
      "max-age=31536000; includeSubDomains",
    );
  });

  it("restricts microphone to same-origin (voice feature) without dropping prior directives", async () => {
    const headers = await securityHeaders();
    const policy = headers.get("Permissions-Policy") ?? "";
    // (self) keeps the top-level Web Speech API voice feature working while
    // denying microphone access to any embedded subframe.
    expect(policy).toContain("microphone=(self)");
    // Prior directives must survive the change.
    expect(policy).toContain("camera=()");
    expect(policy).toContain("geolocation=()");
  });

  it("keeps the other static security headers unchanged", async () => {
    const headers = await securityHeaders();
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("X-Frame-Options")).toBe("DENY");
    expect(headers.get("Referrer-Policy")).toBe(
      "strict-origin-when-cross-origin",
    );
  });
});
