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
//                    px math). Low risk because every untrusted-HTML sink
//                    SANITIZES — not because no sink exists. ★★ This said
//                    "no dangerouslySetInnerHTML anywhere" until 2026-08-09
//                    and `docs/security/threat-model.md` cited that wording
//                    as its mitigation. `grep -rn "dangerouslySetInnerHTML={{"
//                    src` returns the SIX real JSX sinks: rich-text-view,
//                    comm-send-preview-modal and meeting-report-panel wrap
//                    the value in a sanitizer at the sink; document-preview
//                    and documents-history-modal render doc-render-html
//                    output; layout injects an app-authored constant.
//                    ★ The `={{` filter is load-bearing: the unfiltered grep
//                    returns 13 rows, seven of them prose — and two of those
//                    are THIS comment, so the count grows each time someone
//                    restates it. A
//                    security note that overstates the mitigation is the
//                    kind that stops a reviewer checking the real one.
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
    // Service worker (/sw.js, PWA installability). Explicit so it is not subject
    // to script-src's 'strict-dynamic' (which ignores 'self' for script loads).
    "worker-src 'self'",
    styleElem,
    "style-src-attr 'unsafe-inline'",
    // ★★ blob: is LOAD-BEARING, not tidy-away-able. Document asset images are
    // rendered from object URLs — `document-asset-images.ts` attachAssetImages
    // mints URL.createObjectURL(blob) and assigns it to img.src — and CSP
    // 'self' does NOT match a blob: URL. Without this every document image is
    // blocked ("Loading the image 'blob:http://…' violates … img-src"), in dev
    // and prod alike (IS_DEV branches only script/style, never img-src).
    // Nothing automated catches a regression here: jsdom enforces no CSP and no
    // e2e spec touches document assets — the proxy unit test is the only guard.
    // ★ object-src 'none' below remains the guard against the usual blob:
    // escalation (a blob: <object>/<embed> executing as a document); img-src
    // can only ever decode an image.
    "img-src 'self' data: blob:",
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
