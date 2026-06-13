// src/app/recovery/page.tsx
import { connection } from "next/server";
import { RecoveryPanel } from "../recovery-panel";

export default async function RecoveryRoute() {
  // Match the home route: opt into dynamic rendering so the per-request CSP
  // nonce in src/proxy.ts is consistent. The panel itself reads localStorage
  // on the client only.
  await connection();
  return (
    <div className="flex flex-1 flex-col bg-surface-muted dark:bg-black">
      <RecoveryPanel />
    </div>
  );
}
