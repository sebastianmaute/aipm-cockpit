// src/app/recovery/page.tsx
import { connection } from "next/server";
import { RecoveryClient } from "../recovery-client";

export default async function RecoveryRoute() {
  // Match the home route: opt into dynamic rendering so the per-request CSP
  // nonce in src/proxy.ts is consistent. The panel is mounted client-only
  // (ssr:false) because it reads localStorage in its render — SSR'ing it would
  // diverge from the client and trip a hydration mismatch.
  await connection();
  return (
    <div className="flex flex-1 flex-col bg-surface-muted dark:bg-black">
      <RecoveryClient />
    </div>
  );
}
