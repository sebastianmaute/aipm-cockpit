import { connection } from "next/server";
import TaskManager from "./task-manager";
import { ErrorBoundary } from "./error-boundary";
import { RecoveryBannerClient } from "./recovery-banner-client";

export default async function Home() {
  // Opt into dynamic rendering so the per-request CSP nonce in `src/proxy.ts`
  // matches the nonce Next.js attaches to SSR'd scripts and <style> blocks.
  await connection();
  // Plain wrapper — NOT a <main> landmark. Each layout renders its own single
  // <main> around its content region, so wrapping here too would nest a second
  // main landmark (a WCAG "no duplicate main" violation).
  return (
    <div className="flex flex-1 flex-col bg-surface-muted dark:bg-black">
      <RecoveryBannerClient />
      <ErrorBoundary>
        <TaskManager />
      </ErrorBoundary>
    </div>
  );
}
