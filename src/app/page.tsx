import { connection } from "next/server";
import TaskManager from "./task-manager";

export default async function Home() {
  // Opt into dynamic rendering so the per-request CSP nonce in `src/proxy.ts`
  // matches the nonce Next.js attaches to SSR'd scripts and <style> blocks.
  // Without this the page could be statically prerendered with a stale nonce
  // at build time, and every script/style would fail the CSP check at runtime.
  await connection();
  return (
    <main className="flex flex-1 flex-col bg-zinc-50 dark:bg-black">
      <TaskManager />
    </main>
  );
}
