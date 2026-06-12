import { connection } from "next/server";
import TaskManager from "./task-manager";

export default async function Home() {
  // Opt into dynamic rendering so the per-request CSP nonce in `src/proxy.ts`
  // matches the nonce Next.js attaches to SSR'd scripts and <style> blocks.
  // Without this the page could be statically prerendered with a stale nonce
  // at build time, and every script/style would fail the CSP check at runtime.
  await connection();
  // Plain wrapper — NOT a <main> landmark. Each layout renders its own single
  // <main> around its content region (ModernShell for modern; the classic/
  // popout trees in task-manager.tsx), so wrapping here too would nest a second
  // main landmark (a WCAG "no duplicate main" violation).
  return (
    <div className="flex flex-1 flex-col bg-surface-muted dark:bg-black">
      <TaskManager />
    </div>
  );
}
