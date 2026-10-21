import type { Metadata } from "next";
import { headers } from "next/headers";
import { Titillium_Web } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "./use-theme";
import { CiStyleProvider } from "./use-style";
import { ServiceWorkerRegistrar } from "./service-worker-registrar";
import { NO_FLASH_THEME_SCRIPT } from "./boot-theme-script";
import { APP_VERSION } from "./version";
import { bootNonce, checkoutToken } from "./checkout-token";
import { DISABLED_INTEGRATIONS_ENV, parseDisabledIntegrations } from "./integration-switches";
import { IntegrationSwitchesSync } from "./integration-switches-sync";

const titillium = Titillium_Web({
  subsets: ["latin"],
  weight: ["300", "400", "600", "700"],
  variable: "--font-titillium",
  display: "swap",
});

export const metadata: Metadata = {
  title: "AI PM Cockpit",
  description:
    "AI-assisted project cockpit — task, RAID, budget and milestone tracking that plugs into M365, Jira and Timelog. Local-first, no backend.",
  manifest: "/manifest.webmanifest",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Next.js auto-nonces its own framework/page scripts, but NOT a hand-authored
  // <script>. Read the per-request nonce that src/proxy.ts sets on x-nonce (same
  // value as the CSP script-src nonce) so this inline script passes the strict
  // CSP. Reading headers() also opts the layout into dynamic rendering, which
  // nonce-based CSP already requires (see page.tsx connection()).
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  // §762 — read per request (this layout is dynamic), so one image serves every
  // deployment: the integrations it switched off reach the client from here.
  const disabledIntegrations = parseDisabledIntegrations(process.env[DISABLED_INTEGRATIONS_ENV]);
  return (
    <html
      lang="en"
      className={`${titillium.variable} h-full antialiased`}
      // Lets e2e assert the server it is talking to IS this checkout.
      // playwright.config.ts reuses an existing dev server outside CI, so a run
      // can otherwise scan another worktree's code and pass (open-followups §58).
      // Rendered once, server-side (RootLayout is an async Server Component); nothing
      // on the client recomputes or rewrites this attribute, so it is always the
      // serving process's own version.
      data-app-version={APP_VERSION}
      // Names the CHECKOUT serving this page, so the same e2e guard can tell two
      // worktrees on the same version apart: a 12-hex sha-256 of this process's
      // cwd. Dev only — undefined in production, so React omits the attribute
      // and no path-derived value ships (open-followups §58).
      data-checkout={checkoutToken(process.env.NODE_ENV, () => process.cwd())}
      // The per-run nonce a Playwright run boots its dev server with, so the guard can
      // also refuse a leftover server from THIS checkout, which data-checkout cannot.
      // Dev only, and absent when the server was not booted with one (§58 (b)).
      data-boot-nonce={bootNonce(process.env.NODE_ENV, process.env)}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col font-[var(--font-titillium)]">
        <script
          nonce={nonce}
          // React strips the nonce from the client DOM (security), so the
          // client property is "" while the SSR'd HTML carries the nonce —
          // a benign mismatch. Suppress it on this element specifically;
          // suppressHydrationWarning on <html> does not reach children.
          suppressHydrationWarning
          dangerouslySetInnerHTML={{ __html: NO_FLASH_THEME_SCRIPT }}
        />
        <ServiceWorkerRegistrar />
        <IntegrationSwitchesSync disabled={disabledIntegrations}>
          <ThemeProvider><CiStyleProvider>{children}</CiStyleProvider></ThemeProvider>
        </IntegrationSwitchesSync>
      </body>
    </html>
  );
}
