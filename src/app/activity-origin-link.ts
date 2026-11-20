// src/app/activity-origin-link.ts — whether an AI activity entry can link to its chat (§799). Pure and i18n-free.
//
// Kept apart from `activity-origin.ts`, which imports nothing: this one needs the chat thread types.
//
// ★★ A link needs the REQUEST, not only the thread. "Clear chat" empties a thread's display and the thread
//   then takes new requests under the same id, so a thread-only match would send an entry written before the
//   clear to a conversation that no longer holds it. The request id is minted once per send, so an entry
//   resolves only while its own user item is still in the thread.
// ★ Only the threads published for THIS project are searched (`readChatThreads(projectId)`), and only while
//   they are `available`: another project's thread, or a list that has not loaded, never links.
import type { AiOrigin } from "./activity-origin";
import type { PublishedThreads } from "./chat-threads-registry";

export function resolveOriginLink(
  origin: AiOrigin | undefined,
  published: PublishedThreads | null,
): { threadId: string } | null {
  if (!origin || !published || !published.available) return null;
  const { threadId, requestId } = origin;
  // `typeof`, not truthiness alone: the panel also renders entries that never passed the load boundary.
  if (typeof threadId !== "string" || typeof requestId !== "string" || !threadId || !requestId) return null;
  const thread = published.threads.find((th) => th.id === threadId);
  if (!thread) return null;
  return thread.display.some((d) => d.kind === "user" && d.requestId === requestId) ? { threadId } : null;
}
