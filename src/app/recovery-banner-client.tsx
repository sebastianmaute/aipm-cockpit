"use client";
// Client-only mount of the safe-mode banner. `isSafeMode()` reads
// window.location and `readPersistedLang()` reads localStorage during render,
// so SSR'ing the banner produces server HTML (always null — no `window`) that
// differs from the client whenever the page is loaded with ?safe=1 — a
// hydration mismatch on the home route, exactly on the emergency path. Mounting
// it ssr:false keeps it off the server: the banner only ever renders in the
// browser, where the safe-mode flag and lang are real.
import dynamic from "next/dynamic";

const RecoveryBanner = dynamic(
  () => import("./recovery-banner").then((m) => m.RecoveryBanner),
  { ssr: false },
);

export function RecoveryBannerClient() {
  return <RecoveryBanner />;
}
