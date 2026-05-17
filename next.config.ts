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
  // Restrict powerful features to explicit opt-in.
  // Note: microphone is intentionally omitted — the app uses the Web Speech API
  // for voice commands. Camera and geolocation are not used.
  { key: "Permissions-Policy", value: "camera=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
