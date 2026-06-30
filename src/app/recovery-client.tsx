"use client";
// Client-only mount of the recovery panel. The panel reads localStorage
// (storage probe, config summary, persisted lang) in its useState initializers,
// which would run during SSR with no `window` and produce server HTML that
// differs from the client (hydration mismatch). It is also provider-light on
// purpose so it works when the main app is bricked. Rendering it ssr:false
// keeps it off the server entirely — no mismatch, and the localStorage reads
// only ever run in the browser.
import dynamic from "next/dynamic";

const RecoveryPanel = dynamic(
  () => import("./recovery-panel").then((m) => m.RecoveryPanel),
  { ssr: false },
);

export function RecoveryClient() {
  return <RecoveryPanel />;
}
