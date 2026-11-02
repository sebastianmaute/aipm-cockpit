// Next.js calls `register()` once per server instance, before the server takes requests.
// The chat sweep is Node-only, so it is imported only in the Node.js runtime and never reaches the
// Edge bundle. The first sweep is started, not awaited: it must not hold up the server.

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startChatSweepSchedule } = await import("./app/api/ai/_chat-sweep");
  startChatSweepSchedule(process.env);
}
