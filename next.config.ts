import type { NextConfig } from "next";

// Security headers attached to every response.
//
// Content-Security-Policy is NOT set here — it lives in `src/proxy.ts`
// because it needs a per-request nonce (see that file for directive
// rationale). Static headers below stay here because they don't vary
// per request.
const securityHeaders = [
  // Prevent MIME-type sniffing.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Disallow framing (clickjacking protection).
  { key: "X-Frame-Options", value: "DENY" },
  // Send only origin on cross-origin requests; full URL on same-origin.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Force HTTPS for a year, subdomains included. Sent unconditionally (no
  // NODE_ENV gate): browsers only honor HSTS over HTTPS, so it is inert on
  // plain-HTTP dev localhost and a conditional would just complicate the array.
  // preload is intentionally omitted — HSTS preload list submission is a
  // separate one-way opt-in step outside source control.
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  // Restrict powerful features to explicit opt-in.
  // Note: microphone=(self) — the top-level same-origin document needs the mic
  // for the Web Speech API voice feature; subframes are denied. Camera and
  // geolocation are not used.
  { key: "Permissions-Policy", value: "camera=(), geolocation=(), microphone=(self)" },
];

const nextConfig: NextConfig = {
  // Suppress the `X-Powered-By: Next.js` response header — it discloses the
  // tech stack for no functional benefit (ZAP baseline alert 10037).
  poweredByHeader: false,
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
