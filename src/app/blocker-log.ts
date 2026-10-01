// src/app/blocker-log.ts — the pure, i18n-free, DOM-free blocker log.
//
// A task's blockers are a dated list of plain-text entries. `Task.blockers`
// stays as a DERIVED string (the open entries joined) so every existing reader
// is unchanged; it is written ONLY through `withBlockerLog`, so the pair
// cannot drift.
import { MAX_AUTHOR_NAME, MAX_NOTE_ENTRIES } from "./note-log-policy";
import { TEXTAREA_MAX } from "./sanitize-core";
import type { BlockerEntry, Task } from "./types";

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

function cleanText(text: string): string {
  return text.trim().slice(0, TEXTAREA_MAX);
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

export function editBlocker(task: Task, id: number, text: string, now: string): Task {
  const clean = cleanText(text);
  if (clean === "") return task;
  return updateEntry(task, id, (e) => ({ ...e, text: clean, editedAt: now }));
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

/** Replace the open blockers with `text`: same text is a no-op, empty resolves
 *  them all, anything else resolves them and adds one new open entry. */
export function setBlockersText(
  task: Task,
  text: string,
  actor: BlockerActor,
  now: string,
): Task {
  const clean = cleanText(text);
  const base = migrateBlockers(task);
  if (clean === blockersText(base.blockerLog)) return task;
  const log = base.blockerLog ?? [];
  const resolved = log.map((e) => (isOpen(e) ? { ...e, resolvedAt: now } : e));
  return withBlockerLog(
    base,
    clean === "" ? resolved : [...resolved, newEntry(log, clean, actor, now)],
  );
}

/** Load migration: the log wins; legacy text becomes one open entry. Returns the
 *  SAME reference when nothing changes; idempotent. */
export function migrateBlockers(task: Task): Task {
  if (task.blockerLog) {
    return task.blockers === blockersText(task.blockerLog)
      ? task
      : withBlockerLog(task, task.blockerLog);
  }
  const legacy = typeof task.blockers === "string" ? task.blockers.trim() : "";
  if (legacy === "") return task;
  const createdAt = ISO_DATE.test(task.lastUpdateDate ?? "")
    ? `${task.lastUpdateDate}T00:00:00.000Z`
    : new Date().toISOString();
  return withBlockerLog(task, [{ id: 1, text: legacy.slice(0, TEXTAREA_MAX), createdAt }]);
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
  const text = cleanText(raw.text.replace(/\r\n?/g, "\n").replace(CONTROL_CHARS, ""));
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
