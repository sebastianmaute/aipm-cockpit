// src/app/chat-tools-updates.ts
// The AI update path's input helpers: the coercions, the two patch builders and
// the optimistic-concurrency guard. Pure — no React, no DOM, no i18n.
//
// ★ EXTRACTED FROM `chat-tools.ts` FOR THE 800-LINE RATCHET, not for a design
// reason. That file crossed the limit while this slice was being built, so the
// helpers the update cases call moved here rather than the baseline being
// raised. `asString`/`asPriority` are generic coercions and travel with
// `buildPatch` only because it calls them — keeping them in `chat-tools.ts`
// would make this module import from its own importer.
import { entityToken, TOKEN_EXCLUDED, type TokenEntity } from "./ai-entity-token";
import { sanitizeGroup, sanitizeLabels } from "./sanitize";
import { PRIORITIES, type Priority, type Task } from "./types";

export function asString(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

export function asPriority(v: unknown): Priority | undefined {
  if (typeof v === "string" && (PRIORITIES as unknown as string[]).includes(v))
    return v as Priority;
  return undefined;
}

export function buildPatch(input: Record<string, unknown>): Partial<Task> {
  const patch: Partial<Task> = {};
  if (input.taskName !== undefined) patch.taskName = asString(input.taskName) ?? "";
  if (input.assignee !== undefined) patch.assignee = asString(input.assignee) ?? "";
  if (input.assigneeEmail !== undefined)
    patch.assigneeEmail = asString(input.assigneeEmail) ?? "";
  if (input.dueDate !== undefined) patch.dueDate = asString(input.dueDate) ?? "";
  if (input.lastUpdateDate !== undefined)
    patch.lastUpdateDate = asString(input.lastUpdateDate) ?? "";
  if (input.priority !== undefined) {
    const p = asPriority(input.priority);
    if (p) patch.priority = p;
  }
  if (input.status !== undefined) {
    const s = asString(input.status);
    // Carry the raw value through; the dispatcher validates against
    // TASK_STATUSES and routes it through applyStatusChange, which keeps the
    // Done/completedDate invariant. A non-string is ignored.
    if (s !== undefined) patch.status = s as Task["status"];
  }
  if (input.blockers !== undefined) patch.blockers = asString(input.blockers) ?? "";
  // Plain text from the model; wrapped to HTML at the dispatcher (single write
  // boundary — see use-chat-dispatcher updateTask).
  //
  // `description` is the field, and the only one the tool SCHEMA advertises
  // (chat-tool-defs taskFields); `notes` is its pre-0.196.0 name, kept as a
  // WRITE ALIAS deliberately.
  //
  // ★★ Do NOT retire it. A persisted insight recommendation stores its
  // proposedCalls verbatim and replays them through runTool at apply time, so a
  // proposal generated before the rename can still carry a `notes` key. Dropping
  // the alias would break replay of an already-stored recommendation.
  if (input.description !== undefined || input.notes !== undefined)
    patch.description = asString(input.description ?? input.notes) ?? "";
  if (input.group !== undefined) patch.group = sanitizeGroup(input.group);
  if (input.labels !== undefined) patch.labels = sanitizeLabels(input.labels);
  return patch;
}

/** A shallow copy of the tool input with `id`, `expectedToken` and every
 *  token-excluded field removed — the update patch.
 *
 *  ★★★ THE EXCLUSION STRIP IS LOAD-BEARING. Unlike `buildPatch` (tasks), this
 *  helper has no whitelist: whatever the model emits is forwarded, and
 *  `use-register-tools` spreads it straight over the stored entity, where
 *  `sanitizeRaidItem` / `sanitizeChangeItem` / `sanitizeMilestone` PRESERVE
 *  `outlookEventId` and `inquiriesSent`. Those fields are excluded from
 *  `entityToken`, so without this strip the model could change them with the
 *  concurrency token blind to the change by construction — a false PERMIT for
 *  exactly those fields, which is the failure the token exists to prevent.
 *  The strip closes it by making the ACCEPTED surface match the ADVERTISED
 *  one: `chat-tool-defs` documents none of these fields, so nothing legitimate
 *  is lost.
 *
 *  ★★ THIS COMPLETES AN EXISTING PATTERN RATHER THAN INVENTING ONE. The other
 *  two excluded fields were already protected downstream — `localModifiedAt`
 *  is re-stamped after the spread and `noteLog` is re-applied from the stored
 *  row (`use-register-tools`, `withStoredNoteLog`). Those two survive a
 *  forwarded value by overwriting it; `outlookEventId` and `inquiriesSent` had
 *  no such backstop.
 *
 *  ★★★ `expectedToken` IS STRIPPED FOR A DIFFERENT REASON AND THE TWO MUST NOT
 *  BE CONFLATED. It is not an excluded field — it is not a field of any entity
 *  at all — it is the CONTROL value `requireToken` consumes. `chat-tool-defs`
 *  advertises it on all six update tools, so a cooperating model sends it to
 *  every one of them, and this helper is the pass-through path: without the
 *  delete, `update_raid_item` would spread a junk `expectedToken` property onto
 *  the stored RAID row and persist it across all six write paths. `update_task`
 *  never had this exposure — it goes through `buildPatch`, a whitelist, which
 *  drops any key it does not name.
 *
 *  ★ `ai-entity-token.test.ts` drives the real dispatch path per tool, so
 *  reverting this strip — or adding a seventh pass-through tool that skips it
 *  — turns that suite red. */
export function patchWithoutId<T>(
  input: Record<string, unknown>,
  kind: TokenEntity,
): Partial<T> {
  const patch = { ...input };
  delete patch.id;
  delete patch.expectedToken;
  for (const field of TOKEN_EXCLUDED[kind]) delete patch[field];
  return patch as Partial<T>;
}

/** The optimistic-concurrency token as the six entity `update_*` schemas
 *  advertise it. Spread into `input_schema.properties` by `chat-tool-defs.ts`.
 *
 *  ★★ IT LIVES BESIDE `requireToken` RATHER THAN IN THE SCHEMA FILE so the
 *  advertised surface and the enforcing one cannot drift apart, and so one
 *  constant serves all six — six hand-written copies is six chances for a
 *  wording to diverge, or for a seventh update tool to be added without one.
 *
 *  ★★ `required: ["id", "expectedToken"]` IS ADVISORY, NOT ENFORCEMENT. It
 *  tells the model to send the field; nothing in the API rejects a call that
 *  omits it. `requireToken` below is the refusal, on the ACCEPTED surface —
 *  which is exactly why absence is refused there rather than read as "skip the
 *  check".
 *
 *  ★ Deliberately NOT advertised on `update_settings` (settings are not a
 *  token-bearing entity) or `update_document` (a meta-blob with no CSV
 *  projection, so `entityToken` structurally cannot cover it; it carries its
 *  own per-block concurrency via `DocOp.expect`). Both are named in
 *  `NOT_TOKEN_GUARDED` in `ai-entity-token.test.ts`, whose exhaustiveness case
 *  turns red if this is spread onto either. */
export const expectedTokenField = {
  expectedToken: {
    type: "string" as const,
    description:
      "REQUIRED. The token returned when you read this record. The write is refused if the record changed since then — re-read and retry with the new token.",
  },
};

/** The refusal `requireToken` throws, as its own type.
 *
 *  ★★★ IT EXISTS SO A CALLER CAN TELL "REFUSED, NOTHING WAS WRITTEN" APART FROM
 *  EVERY OTHER TOOL FAILURE, and that distinction is load-bearing rather than
 *  cosmetic. `use-insight-recommendations` replays a stored recommendation
 *  inside a `try/catch` that advances the insight to `applied` even when a call
 *  failed — correct for a failure that MAY have committed (re-running it would
 *  duplicate `create_*` entities), and wrong for this one, which is refused
 *  BEFORE the dispatcher is reached. Without a type the two are one bucket, and
 *  a legitimately-stale recommendation becomes a silent, unretryable drop.
 *
 *  ★★ MATCH ON THE TYPE, NEVER THE MESSAGE. Both messages are model-facing
 *  recovery instructions (see below) and may be reworded for the model at any
 *  time; a caller sniffing them would break silently, in the permissive
 *  direction.
 *
 *  ★ `extends Error` is safe at this repo's `target: ES2017` — native classes,
 *  so `instanceof` holds. It would NOT be under a downlevel ES5 target, where
 *  TypeScript's subclass emit breaks the prototype chain. */
export class ConcurrencyTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConcurrencyTokenError";
  }
}

/** Re-derive the token for `current` and compare it with what the model sent.
 *  Throws on absence and on mismatch; returns nothing when the write may
 *  proceed.
 *
 *  ★★ ABSENCE IS REFUSED DELIBERATELY. If a missing token meant "skip the
 *  check", a model could bypass the guard entirely by omitting one field — the
 *  guard would then protect only the callers that already cooperate.
 *
 *  ★★ THE CALLER MUST RESOLVE NOT-FOUND FIRST, and that is structural rather
 *  than stylistic: the token can only be derived from the stored row, so there
 *  is nothing to compare against until the row is in hand. It also keeps the
 *  more informative error — a deleted entity reports "not found", not "changed
 *  since you read it", which would send the model re-reading a row that is
 *  gone.
 *
 *  ★★ BOTH MESSAGES ARE MODEL-FACING INSTRUCTIONS, NOT UI COPY. They come back
 *  as a `tool_result` and are the only channel telling the model how to
 *  recover, so each names the remedy (re-read, then retry with the new token).
 *  Unlocalized on purpose, like every other `throw` in `runTool`. */
export function requireToken(
  kind: TokenEntity,
  current: object,
  input: Record<string, unknown>,
  label: string,
): void {
  const sent = input.expectedToken;
  if (typeof sent !== "string" || sent.length === 0) {
    throw new ConcurrencyTokenError(
      `expectedToken is required for ${label}. Read the ${label} first and pass the token it returns.`,
    );
  }
  const now = entityToken(kind, current);
  if (sent !== now) {
    throw new ConcurrencyTokenError(
      `${label} changed since you read it — re-read it and retry with the new expectedToken.`,
    );
  }
}

/** Resolve-then-guard for a task write that is NOT an `update_*` tool. Throws
 *  not-found first, then delegates to `requireToken`.
 *
 *  ★★★ IT EXISTS BECAUSE `set_task_dependencies` IS A TOKEN-COVERED,
 *  MODEL-SUPPLIED WRITE THAT THE `update_*` NAMING HIDES. `dependencies` is in
 *  `CSV_COLUMNS` and is NOT in `TOKEN_EXCLUDED.task`, so the token already
 *  covers the field — the guard was simply never applied to the one tool that
 *  writes it. And it is the worst shape to leave open: a WHOLE-LIST REPLACE
 *  whose own schema tells the model to `list_tasks` first, i.e. to perform
 *  exactly the read-reason-write sequence this guard exists to make safe. A
 *  human adding a link in the interval had it silently dropped, and the tool
 *  reports success.
 *
 *  ★★ ENUMERATE THE GUARDED SET BY WHAT A SCHEMA ADVERTISES, NEVER BY THE TOOL
 *  NAME. `ai-entity-token.test.ts`'s anti-vacuity case reads
 *  `TOOL_DEFS.filter(name.startsWith("update_"))`, which is blind to this tool
 *  by construction; the companion case there enumerates every tool carrying
 *  `expectedTokenField` instead, so a future guarded tool outside the naming
 *  convention cannot slip past either.
 *
 *  ★ NOT-FOUND FIRST is structural, not stylistic — the token is derived from
 *  the stored row, so there is nothing to compare against until the row is in
 *  hand. See `requireToken` for the full reasoning. The message spelling
 *  (`Task #N not found`) is the one this tool already threw post-write; it is
 *  preserved so the existing not-found contract is unchanged. */
export function requireTaskWriteToken(
  current: Task | null | undefined,
  id: number,
  input: Record<string, unknown>,
): void {
  if (!current) throw new Error(`Task #${id} not found`);
  requireToken("task", current, input, `task #${id}`);
}
