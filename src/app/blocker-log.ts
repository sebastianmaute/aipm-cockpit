// src/app/blocker-log.ts — the pure, i18n-free, DOM-free blocker log.
//
// A task's blockers are a dated list of plain-text entries. `Task.blockers`
// stays as a DERIVED string (the open entries joined) so every existing reader
// is unchanged; it is written ONLY through `withBlockerLog`, so the pair
// cannot drift.
import { MAX_AUTHOR_NAME, MAX_NOTE_ENTRIES } from "./note-log-policy";
import { resourceDisplayName } from "./resource-foundation";
import { sanitizeBlockers, TEXTAREA_MAX } from "./sanitize-core";
import type { BlockerEntry, Resource, Task } from "./types";

export type BlockerActor = { resourceId?: number; name?: string };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Control chars other than tab and newline; blocker text may span lines. */
const CONTROL_CHARS = /[\x00-\x08\x0b-\x1f\x7f]/g;

function timeOf(iso: string): number {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? 0 : ms;
}

function isOpen(entry: BlockerEntry): boolean {
  return entry.resolvedAt === undefined;
}

/** The ONE text normaliser, used by every write and load path: CRLF/CR → LF,
 *  control characters stripped, trimmed, capped. A shared helper keeps a legacy
 *  CSV cell holding "A\r\nB" and a later "A\nB" save comparing equal. */
function cleanText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(CONTROL_CHARS, "")
    .trim()
    .slice(0, TEXTAREA_MAX)
    // Trim AGAIN after the cap: a cap landing just after a space would leave
    // trailing whitespace that the NEXT pass trims, so one pass would not settle.
    .trimEnd();
}

/** The text a blocker write STORES for `text` (CRLF → LF, control characters
 *  stripped, trimmed, capped) — exported so a preview of a write (the inline
 *  AI card) shows exactly what `setBlockersText` will keep. */
export function normalizeBlockerText(text: string): string {
  return cleanText(text);
}

/** Open entries' text, oldest `createdAt` first (ties by id), joined by "\n". */
export function blockersText(log: readonly BlockerEntry[] | undefined): string {
  if (!log) return "";
  return log
    .filter(isOpen)
    .slice()
    .sort((a, b) => timeOf(a.createdAt) - timeOf(b.createdAt) || a.id - b.id)
    .map((e) => e.text)
    .join("\n");
}

export function openBlockerCount(log: readonly BlockerEntry[] | undefined): number {
  return log ? log.filter(isOpen).length : 0;
}

/** The ONLY way a log write lands: sets the log and the derived text together. */
export function withBlockerLog(task: Task, log: BlockerEntry[]): Task {
  return { ...task, blockerLog: log, blockers: blockersText(log) };
}

export function nextBlockerId(log: readonly BlockerEntry[] | undefined): number {
  if (!log || log.length === 0) return 1;
  return Math.max(...log.map((e) => e.id)) + 1;
}

function newEntry(
  log: readonly BlockerEntry[] | undefined,
  text: string,
  actor: BlockerActor,
  now: string,
): BlockerEntry {
  return {
    id: nextBlockerId(log),
    text,
    createdAt: now,
    ...(actor.resourceId !== undefined ? { authorResourceId: actor.resourceId } : {}),
    ...(actor.name !== undefined ? { authorName: actor.name } : {}),
  };
}

export function addBlocker(task: Task, text: string, actor: BlockerActor, now: string): Task {
  const clean = cleanText(text);
  if (clean === "") return task;
  const log = task.blockerLog ?? [];
  return withBlockerLog(task, [...log, newEntry(log, clean, actor, now)]);
}

/** Apply `change` to the entry with `id`; the task itself when the id is unknown
 *  or `change` returns the entry unchanged. */
function updateEntry(
  task: Task,
  id: number,
  change: (entry: BlockerEntry) => BlockerEntry,
): Task {
  const log = task.blockerLog ?? [];
  const target = log.find((e) => e.id === id);
  if (!target) return task;
  const changed = change(target);
  if (changed === target) return task;
  return withBlockerLog(
    task,
    log.map((e) => (e === target ? changed : e)),
  );
}

/** Unchanged text (after the normaliser) returns the task by reference, so an
 *  edit that changes nothing stamps no `editedAt` and logs no activity. */
export function editBlocker(task: Task, id: number, text: string, now: string): Task {
  const clean = cleanText(text);
  if (clean === "") return task;
  return updateEntry(task, id, (e) => (e.text === clean ? e : { ...e, text: clean, editedAt: now }));
}

export function resolveBlocker(task: Task, id: number, now: string): Task {
  return updateEntry(task, id, (e) => (isOpen(e) ? { ...e, resolvedAt: now } : e));
}

export function reopenBlocker(task: Task, id: number): Task {
  return updateEntry(task, id, (e) => {
    if (isOpen(e)) return e;
    const open: BlockerEntry = { ...e };
    delete open.resolvedAt;
    return open;
  });
}

export function deleteBlocker(task: Task, id: number): Task {
  const log = task.blockerLog ?? [];
  if (!log.some((e) => e.id === id)) return task;
  return withBlockerLog(
    task,
    log.filter((e) => e.id !== id),
  );
}

/** A text's comparison form: normalised, each line trimmed. */
function lineKey(text: string): string {
  return cleanText(text)
    .split("\n")
    .map((l) => l.trim())
    .join("\n");
}

/** Does `text` say the same as the log's open entries? Besides equality (CRLF
 *  and edge whitespace ignored), the derived text CUT at the text cap agrees:
 *  several open entries can join to more than TEXTAREA_MAX, and a path that
 *  caps `blockers` (`sanitizeBlockers`, `cleanText`) stores only a prefix —
 *  without this, that prefix would read as a disagreement on every load. */
function agreesWithLog(text: string, log: readonly BlockerEntry[]): boolean {
  const key = lineKey(text);
  const derived = blockersText(log);
  return key === lineKey(derived) || key === lineKey(sanitizeBlockers(derived));
}

/** The replace rule, shared by a write (`setBlockersText`) and a load whose
 *  text disagrees with the log (`migrateBlockers`). The new text is split into
 *  lines; an open entry whose (possibly multi-line) text appears as a contiguous
 *  block of whole, not-yet-consumed lines stays open, untouched, and consumes
 *  them — entries are tried oldest first (the derived text's order), each
 *  matching at most once, at its first match. Open entries not found are
 *  resolved at `now`. The unconsumed lines, joined and cleaned, become ONE new
 *  open entry when non-empty. Returns `log` itself when nothing changes. */
function replaceOpen(
  log: readonly BlockerEntry[],
  clean: string,
  actor: BlockerActor,
  now: string,
): readonly BlockerEntry[] {
  const rawLines = clean === "" ? [] : clean.split("\n");
  const lines = rawLines.map((l) => l.trim());
  const consumed = lines.map(() => false);
  const kept = new Set<BlockerEntry>();
  const open = log
    .filter(isOpen)
    .slice()
    .sort((a, b) => timeOf(a.createdAt) - timeOf(b.createdAt) || a.id - b.id);
  for (const entry of open) {
    const block = entry.text.split("\n").map((l) => l.trim());
    const at = findBlock(lines, consumed, block);
    if (at < 0) continue;
    block.forEach((_, i) => {
      consumed[at + i] = true;
    });
    kept.add(entry);
  }
  // Compare on trimmed lines, but build the new entry from the UNTRIMMED ones
  // so its indentation survives (as `addBlocker` keeps it).
  const rest = cleanText(rawLines.filter((_, i) => !consumed[i]).join("\n"));
  const resolvesAny = open.some((e) => !kept.has(e));
  if (!resolvesAny && rest === "") return log;
  const next = log.map((e) => (isOpen(e) && !kept.has(e) ? { ...e, resolvedAt: now } : e));
  return rest === "" ? next : [...next, newEntry(log, rest, actor, now)];
}

/** First index where `block` sits on unconsumed lines of `lines`; -1 if none. */
function findBlock(lines: readonly string[], consumed: readonly boolean[], block: readonly string[]): number {
  for (let at = 0; at + block.length <= lines.length; at++) {
    if (block.every((l, i) => !consumed[at + i] && lines[at + i] === l)) return at;
  }
  return -1;
}

/** Replace the open blockers with `text` (the replace rule, `replaceOpen`):
 *  lines matching an open entry keep it open, open entries left out are
 *  resolved, any other text becomes one new open entry. The same text (or a
 *  reordering of the open entries) is a no-op; empty resolves them all. */
export function setBlockersText(
  task: Task,
  text: string,
  actor: BlockerActor,
  now: string,
): Task {
  const clean = cleanText(text);
  const base = migrateBlockers(task);
  const log = base.blockerLog ?? [];
  if (agreesWithLog(clean, log)) return task;
  const next = replaceOpen(log, clean, actor, now);
  return next === log ? base : withBlockerLog(base, [...next]);
}

/** A far-future stamp for `previewBlockersText`'s new entry, so it sorts after
 *  every stored one exactly as a real write's `now` does. */
const PREVIEW_NOW = "9999-12-31T23:59:59.999Z";

/** The `blockers` text `setBlockersText` would store for `text` on `stored` —
 *  the inline AI card previews this, so a reordering or a partly-matching text
 *  shows what will land rather than what was typed. `stored` absent (a create)
 *  previews the normalised text. */
export function previewBlockersText(
  stored: Partial<Pick<Task, "blockers" | "blockerLog" | "lastUpdateDate">> | undefined,
  text: string,
): string {
  if (!stored) return cleanText(text);
  const log = sanitizeBlockerLog(stored.blockerLog);
  const row = {
    blockers: typeof stored.blockers === "string" ? stored.blockers : "",
    lastUpdateDate: stored.lastUpdateDate,
    ...(log ? { blockerLog: log } : {}),
  } as Task;
  return setBlockersText(row, text, {}, PREVIEW_NOW).blockers;
}

/** Spread a task `patch` over the STORED `row`, routing `blockers` through
 *  `setBlockersText` against the row's own log. Every writer that applies a
 *  patch carrying blocker TEXT goes through here, so the log is never dropped
 *  and the text never drifts from it. A `blockerLog` key in the patch is
 *  IGNORED: the log is owned by the mutators above, and a patch's copy of it is
 *  stale by construction. */
export function applyTaskPatch(
  row: Task,
  patch: Partial<Task>,
  actor: BlockerActor,
  now: string,
): Task {
  const rest: Partial<Task> = { ...patch };
  delete rest.blockers;
  delete rest.blockerLog;
  const merged: Task = { ...row, ...rest };
  return patch.blockers === undefined
    ? merged
    : setBlockersText(merged, patch.blockers, actor, now);
}

/** The user's own attribution for a new entry — the same the notes window
 *  uses: the self resource id whenever one is set, its display name when that
 *  id names a live resource. */
export function selfBlockerActor(
  selfResourceId: number | null | undefined,
  resources: readonly Pick<Resource, "id" | "firstName" | "lastName">[],
): BlockerActor {
  if (selfResourceId === null || selfResourceId === undefined) return {};
  const self = resources.find((r) => r.id === selfResourceId);
  const name = self ? resourceDisplayName(self) : "";
  return name !== "" ? { resourceId: selfResourceId, name } : { resourceId: selfResourceId };
}

const EPOCH = "1970-01-01T00:00:00.000Z";

/** The stamp a load-time disagreement writes. Load stays pure and deterministic
 *  (the same input loads to the same output, every time), so no clock: the
 *  LATER of the task's `lastUpdateDate` at midnight UTC (when it is a valid
 *  date) and the newest timestamp already in the log, so a minted entry never
 *  sorts before existing ones. The epoch when neither exists. */
function loadStamp(task: Task, log: readonly BlockerEntry[]): string {
  const day = task.lastUpdateDate ?? "";
  const times = log.flatMap((e) => [e.createdAt, e.editedAt, e.resolvedAt]);
  let newest = EPOCH;
  for (const t of times) {
    if (t !== undefined && timeOf(t) > timeOf(newest)) newest = t;
  }
  if (!ISO_DATE.test(day) || Number.isNaN(Date.parse(day))) return newest;
  const dayStamp = `${day}T00:00:00.000Z`;
  // Never earlier than the log's newest time: a minted entry must not sort
  // before existing ones, nor a `resolvedAt` predate its entry's `createdAt`.
  return timeOf(dayStamp) >= timeOf(newest) ? dayStamp : newest;
}

/** Load migration. Legacy text with no log becomes one open entry. With a log,
 *  a text that agrees with it (`agreesWithLog`) is re-derived; one that
 *  DISAGREES was written by something unaware of the log (an older build, a
 *  hand-edited Markdown/CSV file), so the replace rule (`replaceOpen`) runs
 *  against the log and nothing is lost: still-present open entries stay open,
 *  vanished ones are resolved, the remainder becomes one new open entry with no
 *  author, stamped by `loadStamp`. Returns the SAME reference when nothing
 *  changes; idempotent (the result's text is derived, so it agrees). */
export function migrateBlockers(task: Task): Task {
  if (task.blockerLog) {
    const log = task.blockerLog;
    const derived = blockersText(log);
    if (task.blockers === derived) return task;
    if (typeof task.blockers !== "string" || agreesWithLog(task.blockers, log)) {
      return withBlockerLog(task, log);
    }
    const next = replaceOpen(log, cleanText(task.blockers), {}, loadStamp(task, log));
    return withBlockerLog(task, next === log ? log : [...next]);
  }
  const legacy = typeof task.blockers === "string" ? cleanText(task.blockers) : "";
  if (legacy === "") return task;
  const createdAt = ISO_DATE.test(task.lastUpdateDate ?? "")
    ? `${task.lastUpdateDate}T00:00:00.000Z`
    : new Date().toISOString();
  return withBlockerLog(task, [{ id: 1, text: legacy, createdAt }]);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isValidTimestamp(v: unknown): v is string {
  return typeof v === "string" && v.trim() !== "" && !Number.isNaN(Date.parse(v));
}

function sanitizeEntry(raw: unknown): BlockerEntry | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.id !== "number" || !Number.isFinite(raw.id)) return null;
  if (typeof raw.text !== "string") return null;
  const text = cleanText(raw.text);
  if (text === "" || !isValidTimestamp(raw.createdAt)) return null;
  const authorName =
    typeof raw.authorName === "string"
      ? raw.authorName.replace(CONTROL_CHARS, "").trim().slice(0, MAX_AUTHOR_NAME)
      : "";
  return {
    id: raw.id,
    text,
    createdAt: raw.createdAt,
    ...(typeof raw.authorResourceId === "number" && Number.isFinite(raw.authorResourceId)
      ? { authorResourceId: raw.authorResourceId }
      : {}),
    ...(authorName !== "" ? { authorName } : {}),
    ...(isValidTimestamp(raw.editedAt) ? { editedAt: raw.editedAt } : {}),
    ...(isValidTimestamp(raw.resolvedAt) ? { resolvedAt: raw.resolvedAt } : {}),
  };
}

/** Accept only well-formed entries from untrusted JSON. `undefined` for a
 *  non-array or when nothing survives. DOM-free: the text is plain. */
export function sanitizeBlockerLog(raw: unknown): BlockerEntry[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: BlockerEntry[] = [];
  const seen = new Set<number>();
  for (const item of raw) {
    if (out.length >= MAX_NOTE_ENTRIES) break;
    const entry = sanitizeEntry(item);
    if (!entry || seen.has(entry.id)) continue;
    seen.add(entry.id);
    out.push(entry);
  }
  return out.length > 0 ? out : undefined;
}

/** CSV / Markdown / Turso cell: the log as JSON, "" when there is none. */
export function encodeBlockerLog(log: readonly BlockerEntry[] | undefined): string {
  return log && log.length > 0 ? JSON.stringify(log) : "";
}

/** Inverse of `encodeBlockerLog`: an empty, malformed or all-invalid cell is
 *  `undefined`, never a throw. */
export function decodeBlockerLog(cell: string | null | undefined): BlockerEntry[] | undefined {
  if (!cell || cell.trim() === "") return undefined;
  try {
    return sanitizeBlockerLog(JSON.parse(cell));
  } catch {
    return undefined;
  }
}

/** Load-time blocker repair for a task from ANY backend: sanitise whatever
 *  `blockerLog` arrived (the JSON and IndexedDB loads cast whole objects, so it
 *  is untrusted there), then `migrateBlockers`. Returns the SAME reference when
 *  the log was already clean and the text already derived from it. */
export function migrateLoadedBlockers(task: Task): Task {
  const raw: unknown = task.blockerLog;
  if (raw === undefined) return migrateBlockers(task);
  const clean = sanitizeBlockerLog(raw);
  if (clean === undefined) {
    const withoutLog: Task = { ...task };
    delete withoutLog.blockerLog;
    return migrateBlockers(withoutLog);
  }
  const unchanged = JSON.stringify(clean) === JSON.stringify(raw);
  return migrateBlockers(unchanged ? task : { ...task, blockerLog: clean });
}
