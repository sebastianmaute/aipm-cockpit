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
  // ★★ ENV-GATED, deliberately. The desktop build needs `standalone` (a
  // traced, self-contained server under .next/standalone), but CI's `build`
  // job feeds `.next/` to prod-smoke's `next start`. Making this the default
  // would change the artifact shape for every job in the pipeline to serve
  // one manual job. Set NEXT_STANDALONE=1 only for desktop packaging.
  ...(process.env.NEXT_STANDALONE === "1" ? { output: "standalone" as const } : {}),
  // ★ ENV-GATED, deliberately. The demo-video recorder (scripts/demo-video)
  // starts its dev server with DEMO_RECORDER=1 so the Next.js dev indicator
  // (the "N" badge, bottom left) stays out of every recorded frame. Normal
  // development keeps the indicator; errors still surface either way.
  ...(process.env.DEMO_RECORDER === "1" ? { devIndicators: false as const } : {}),
  // ★★ ENV-GATED, deliberately. scripts/sbom/bundled-packages.mjs lists the npm
  // packages compiled into the build from the `sources` of its source maps, so
  // the build it reads must emit browser maps (off by default, and they would
  // be served to anyone who asks) and server maps (Turbopack's default today;
  // stated explicitly so a default change cannot shorten the list silently).
  // SBOM_SOURCE_MAPS=1 only for the builds that produce an SBOM. The maps land
  // in .next/static and .next/server — and `.next/static` is copied wholesale
  // into the standalone tree — so such a build must delete every `*.map` after
  // reading them and before anything is packaged or served.
  ...(process.env.SBOM_SOURCE_MAPS === "1"
    ? { productionBrowserSourceMaps: true, experimental: { serverSourceMaps: true } }
    : {}),
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
