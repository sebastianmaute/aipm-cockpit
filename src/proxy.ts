import { type NextRequest, NextResponse } from "next/server";

// Per-request nonce-based Content-Security-Policy.
//
// Why this lives in proxy.ts (not next.config.ts):
//   The nonce must be unique per request; next.config.ts `headers()` only
//   supports static values. Next.js 16 reads the CSP from the incoming
//   request header, extracts `nonce-{value}` from script-src, and attaches
//   that nonce to all framework scripts, page bundles, and SSR-injected
//   <style> blocks (including next/font and Tailwind). See
//   node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md.
//
// Directive notes:
//   script-src       'nonce-X' 'strict-dynamic' — no 'unsafe-inline'.
//                    'strict-dynamic' lets nonce-trusted scripts load
//                    additional bundles without each one carrying a nonce.
//   style-src-elem   covers <link rel="stylesheet"> and <style> blocks.
//                    Nonce-protected so injected <style> tags (next/font,
//                    SSR critical CSS) are trusted, arbitrary ones are not.
//   style-src-attr   'unsafe-inline' — the only remaining unsafe-inline.
//                    Required because React renders style={{...}} props as
//                    style="..." HTML attributes (Gantt/table use dynamic
//                    px math). Low risk: the app never renders untrusted
//                    HTML — no dangerouslySetInnerHTML anywhere.
//   connect-src      api.anthropic.com — chat panel calls Anthropic from
//                    the browser. Jira goes through /api/jira/* (self).
//                    *.turso.io — the Turso storage backend and snapshot
//                    store call the libSQL HTTP /v2/pipeline API directly
//                    from the browser. http://localhost|127.0.0.1 cover a
//                    local/self-hosted tursodb (see turso-config.ts
//                    toHttpUrl, which allows loopback over plaintext http).
//                    graph.microsoft.com — SharePoint backend + Outlook
//                    calendar/contacts. login.microsoftonline.com — MSAL
//                    PKCE token exchange (acquireTokenSilent).
//   frame-src        login.microsoftonline.com — MSAL acquireTokenSilent
//                    renews tokens in a hidden iframe pointed at the login
//                    host. (Sign-in/out + interactive consent use popups,
//                    which are window.open and not governed by frame-src.)
//   font-src 'self'  next/font/google self-hosts at build time.
//   'unsafe-eval'    dev only — React DevTools / error reconstruction.

const IS_DEV = process.env.NODE_ENV !== "production";

function buildCsp(nonce: string): string {
  const scriptExtras = IS_DEV ? " 'unsafe-eval'" : "";
  // Dev: omit the nonce from style-src-elem so 'unsafe-inline' actually works.
  // When a nonce is present the browser ignores 'unsafe-inline' (CSP Level 2),
  // which blocks Next.js HMR and next/dynamic CSS injections in the dev server.
  // Prod keeps strict nonce-only; scripts are still nonce-gated in both modes.
  const styleElem = IS_DEV
    ? "style-src-elem 'self' 'unsafe-inline'"
    : `style-src-elem 'self' 'nonce-${nonce}'`;
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${scriptExtras}`,
    styleElem,
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self' https://api.anthropic.com https://*.turso.io https://graph.microsoft.com https://login.microsoftonline.com http://localhost:* http://127.0.0.1:*",
    "frame-src https://login.microsoftonline.com",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}

export function proxy(request: NextRequest): NextResponse {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = buildCsp(nonce);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

// Skip static assets, image optimization, API routes, the favicon, and
// router prefetches — none of them render HTML, so they don't need a CSP
// and re-running this for every prefetch wastes work.
export const config = {
  matcher: [
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
