import type { Metadata } from "next";
import { headers } from "next/headers";
import { Titillium_Web } from "next/font/google";
import "./globals.css";
import { ThemeProvider } from "./use-theme";

const titillium = Titillium_Web({
  subsets: ["latin"],
  weight: ["300", "400", "600", "700"],
  variable: "--font-titillium",
  display: "swap",
});

const NO_FLASH_THEME_SCRIPT = `(function(){try{var t=localStorage.getItem("lop-theme")||"system";var d=t==="dark"||(t==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d);}catch(e){}})();`;

export const metadata: Metadata = {
  title: "List of Open Points Tracker",
  description:
    "Draft status-inquiry emails for delayed items in a project's List of Open Points.",
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
  return (
    <html
      lang="en"
      className={`${titillium.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col font-[var(--font-titillium)]">
        <script
          nonce={nonce}
          dangerouslySetInnerHTML={{ __html: NO_FLASH_THEME_SCRIPT }}
        />
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
