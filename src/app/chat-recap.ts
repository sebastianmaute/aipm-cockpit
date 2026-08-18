// The ambient chat-pointer sentence.
//
// ★ Kept out of `use-chat-dispatcher.ts` so it is testable: that hook is
//   coverage-excluded UI glue. Mirrors `activity-recap.ts`.
//
// ★★ `offeredTools` IS THE SET THE WIRE WILL ACTUALLY SEND (`toolsFor`), and the
//   closing sentence naming the tool is emitted ONLY when it holds that name.
//   `chatSearch` gates the pointer AND the tool together today, but they are
//   read at different points and nothing structurally prevents them diverging —
//   the activity recap shipped exactly that bug, naming `search_history` on
//   every turn of every conversation while the request did not carry it.
//
// ★ Deliberately a plain `ReadonlySet`, not an import from `chat-api.ts`: that
//   module imports this one, and a value import back would close a runtime cycle.
import type { ChatPointer } from "./chat-search";

export function buildChatPointerBlock(
  pointer: ChatPointer | null,
  offeredTools: ReadonlySet<string>,
): string {
  if (!pointer) return "";

  const named = pointer.recent
    .filter((r) => r.title.trim() !== "")
    .map((r) => `"${r.title}" (${r.at})`);

  const head =
    pointer.count === 1
      ? "There is 1 earlier conversation in this project"
      : `There are ${pointer.count} earlier conversations in this project`;

  const recent = named.length > 0 ? `; most recent: ${named.join(", ")}` : "";
  const tool = offeredTools.has("search_chats")
    ? " Use search_chats to read them."
    : "";

  return `${head}${recent}.${tool}`;
}
