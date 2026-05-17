import type { NextConfig } from "next";

// Content-Security-Policy notes:
//   script-src:  'unsafe-inline' is required because Next.js App Router injects
//                inline hydration scripts. A nonce-based strict CSP would remove
//                this but requires middleware — acceptable future improvement.
//   style-src:   'unsafe-inline' is required by Tailwind's utility classes which
//                Next.js may inline during SSR.
//   connect-src: api.anthropic.com — the AI chat calls Anthropic directly from
//                the browser (by design; the user supplies the key). All Jira
//                calls go through /api/jira/* (self).
//   font-src:    'self' only — next/font/google self-hosts fonts at build time,
//                so no runtime call to fonts.gstatic.com is needed.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self' https://api.anthropic.com",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
]
  .join("; ")
  .trim();

const securityHeaders = [
  // Prevent MIME-type sniffing.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Disallow framing (clickjacking protection).
  { key: "X-Frame-Options", value: "DENY" },
  // Send only origin on cross-origin requests; full URL on same-origin.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Restrict powerful features to explicit opt-in.
  // Note: microphone is intentionally omitted — the app uses the Web Speech API
  // for voice commands. Camera and geolocation are not used.
  { key: "Permissions-Policy", value: "camera=(), geolocation=()" },
  { key: "Content-Security-Policy", value: CSP },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
