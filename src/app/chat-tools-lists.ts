// src/app/chat-tools-lists.ts — projections for the AI *read* path.
//
// `list_tasks` is the highest-volume tool call the assistant makes, and it used
// to return `d.listTasks()` verbatim: the whole array, no total, no page size,
// and every rich-HTML field serialized in full. Two costs came out of that —
// "how many tasks exist?" needed a second call, and the model paid for markup
// it cannot reason about (it reasons about a description's TEXT).
//
// ★ ONLY THE LIST PATH IS SLIMMED. `get_task` keeps full fidelity on purpose:
// an assistant about to EDIT a description needs the markup it is editing, and
// the volume that justifies the projection is all on the list side. That split
// is pinned by the "get_task keeps the full markup that the list projection
// strips" control in `chat-tools.test.ts` — without it, slimming BOTH paths
// would satisfy every other assertion in that block.
//
// ★ Pure and DOM-free. `htmlToPlainText` is regex-only (it never reaches
// DOMPurify), so this module is safe to import from the tool layer, which runs
// in both the browser and bare node under vitest.
import { htmlToPlainText } from "./html-to-text";
import type { NoteLogEntry, Task } from "./types";

/** A `noteLog` entry as the list path reports it: the entry minus its `html`
 *  body. Dropping the markup is not a truncation — `NoteLogEntry.text` is the
 *  CANONICAL plain projection of that html (`sanitizeNoteLogWith` re-derives
 *  it on every load whenever the html projects to anything, and drops an entry
 *  that would end up with no text at all), so the reader loses nothing it could
 *  have read. Timestamp, author and id survive: the model still knows when and
 *  by whom a note was written. */
export type NoteLogListEntry = Omit<NoteLogEntry, "html">;

/** A task as `list_tasks` reports it: every field of `Task`, with the two rich
 *  HTML carriers projected to text. ★ `description` and `noteLog` are the
 *  ENTIRE slimming target on this path — the other five list tools already
 *  project to `*Summary` types that carry no rich HTML at all. */
export type TaskListItem = Omit<Task, "description" | "noteLog"> & {
  description: string;
  noteLog?: NoteLogListEntry[];
};

export type ListEnvelope<T> = {
  items: T[];
  /** The count BEFORE `limit` was applied, so "how many tasks exist?" is
   *  answerable from ONE call even when the caller asked for a page. */
  total: number;
  /** Echoed back ONLY when the caller passed a usable one. ★ Omitting it must
   *  leave today's return-everything behaviour untouched, key for key, so no
   *  existing prompt sees a shape it was not written against. */
  limit?: number;
};

function slimNoteEntry(entry: NoteLogEntry): NoteLogListEntry {
  const { html, ...rest } = entry;
  // `text` is guaranteed non-empty by the load sanitizer, but this projection
  // also runs over rows minted in-session, so fall back rather than emit an
  // entry whose body is gone in both spellings.
  return { ...rest, text: entry.text || (html ? htmlToPlainText(html) : "") };
}

export function slimTaskForList(task: Task): TaskListItem {
  const { description, noteLog, ...rest } = task;
  return {
    ...rest,
    description: description ? htmlToPlainText(description) : "",
    ...(noteLog === undefined ? {} : { noteLog: noteLog.map(slimNoteEntry) }),
  };
}

/**
 * Wrap `tasks` in the paginated envelope `list_tasks` returns.
 *
 * `rawLimit` is untrusted model output: anything that is not a positive finite
 * number is treated as "no limit", which is also what an absent one means.
 */
export function listTasksEnvelope(
  tasks: readonly Task[],
  rawLimit: unknown,
): ListEnvelope<TaskListItem> {
  const limit =
    typeof rawLimit === "number" && Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.floor(rawLimit)
      : undefined;
  const page = limit === undefined ? tasks : tasks.slice(0, limit);
  return {
    items: page.map(slimTaskForList),
    total: tasks.length,
    ...(limit === undefined ? {} : { limit }),
  };
}
