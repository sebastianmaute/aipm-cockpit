// src/app/chat-thread-mentions.ts — "find chats mentioning a person": which of the threads already
// in memory mention a name or e-mail address anywhere. Pure and i18n-free; no database read.
import type { ApiMessage, DisplayItem } from "./chat-api";
import type { ChatThread } from "./chat-threads";

/** Every piece of text one history message carries: plain text, text blocks, tool results, and a
 *  tool call's input as JSON. */
function messageTexts(message: ApiMessage): string[] {
  if (typeof message.content === "string") return [message.content];
  const texts: string[] = [];
  for (const block of message.content) {
    if (block.type === "text") texts.push(block.text);
    else if (block.type === "tool_result") texts.push(block.content);
    else if (block.type === "tool_use") texts.push(JSON.stringify(block.input ?? null));
  }
  return texts;
}

function displayTexts(item: DisplayItem): string[] {
  if (item.kind === "tool") return [JSON.stringify(item.input ?? null), item.result];
  if (item.kind === "proposal") return [];
  return [item.text];
}

/** Case- and composition-insensitive form: a decomposed "Mu\u0308ller" matches "M\u00fcller". */
function fold(text: string): string {
  return text.normalize("NFC").toLowerCase();
}

function mentions(th: ChatThread, needle: string): boolean {
  const texts = [th.name, ...th.history.flatMap(messageTexts), ...th.display.flatMap(displayTexts)];
  return texts.some((text) => typeof text === "string" && fold(text).includes(needle));
}

/** The threads of `ownerId` (or legacy owner-less ones) that mention `query`, case-insensitively, in
 *  their name, any message, tool call or tool result, or the transcript shown. A row of another owner
 *  is never returned. A query that is empty after trimming matches nothing. Keeps the input order. */
export function findThreadsMentioning(
  threads: readonly ChatThread[],
  query: string,
  ownerId: string | null,
): ChatThread[] {
  const needle = fold(query.trim());
  if (needle === "") return [];
  return threads.filter((th) => (th.ownerId === null || th.ownerId === ownerId) && mentions(th, needle));
}
