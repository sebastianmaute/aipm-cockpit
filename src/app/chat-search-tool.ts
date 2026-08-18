// The `search_chats` executor.
//
// ★ Extracted rather than inlined in `chat-tools.ts` (34 lines of headroom) or
//   `use-chat-dispatcher.ts` (2), following the `chat-task-patch.ts` precedent.
//   Being its own module also makes it directly testable.
import { searchChats, type ChatSearchResult } from "./chat-search";
import type { PublishedThreads } from "./chat-threads-registry";

/** Model-supplied tool input, before coercion. */
type RawInput = Record<string, unknown>;

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

export function runChatSearch(
  input: RawInput,
  published: PublishedThreads,
  tz: string,
  enabled: boolean,
): ChatSearchResult {
  // ★ ENGLISH ON PURPOSE: every throw in this layer is unlocalized, because
  //   these strings are primarily MODEL-facing — they come back as a
  //   `tool_result` for the model to act on, and only incidentally render in the
  //   tool block. Translating one of ~20 would be the inconsistency.
  if (!enabled) {
    throw new Error(
      "search_chats is switched off for this project (Settings → AI).",
    );
  }
  // ★★★ `coverage` derives from the registry's `available` flag, NEVER from
  //   `published.threads.length`. "Turso with no chats yet" and "file mode,
  //   cannot look" both arrive as an empty array, and collapsing them makes the
  //   assistant tell a file-mode user it searched their past conversations and
  //   found nothing — when it could not look at all.
  // ★ Every field is coerced-or-dropped rather than validated-and-rejected: the
  //   engine reads an absent field as "no filter", which is the honest reading
  //   of garbage from a model that cannot be asked to try again. `limit` is
  //   passed as a raw number and clamped inside the engine by `resolveLimit` —
  //   re-deriving the cap here would give the tool a second, drifting spelling.
  return searchChats(
    published.threads,
    published.activeThreadId,
    {
      query: str(input.query),
      since: str(input.since),
      until: str(input.until),
      limit: typeof input.limit === "number" ? input.limit : undefined,
    },
    tz,
    published.available,
  );
}
