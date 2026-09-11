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
import { rendersAsClear } from "./sanitize-records";
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
  // ★★★ A MALFORMED VALUE MUST NOT COLLAPSE INTO A CLEAR, and the `?? ""` this
  //  replaces did exactly that. `buildTaskCleanPatch` classifies this field into
  //  THREE outcomes — blank is an intended clear stored as "", malformed is
  //  refused with the stored value kept, valid is stored — but it can only see
  //  what arrives here. Collapsing every non-string to "" destroyed that
  //  distinction one layer early: `lastUpdateDate: 42` reached it as "", read as
  //  an intended clear, and WIPED a stored date the user never asked to clear.
  //  ★★ The preview refused the same input, so the card said "rejected" while
  //  the write cleared the field — a refusal in the card that is not a refusal
  //  in the write, which is this defect class's original shape. Measured by
  //  `plan.write-path-sweep.test.ts`; it was that sweep's only relation-2
  //  violation.
  //  ★ `rendersAsClear` rather than a `=== null` test: the preview renders
  //  `null`, `undefined`, `""` and `[]` all as "" and discloses each as a clear,
  //  so all four must still clear here or the guard inverts the defect. It is
  //  the SAME predicate the four merge-site guards use, imported rather than
  //  re-spelled so they cannot drift on what counts as a clear.
  if (input.lastUpdateDate !== undefined) {
    const raw = input.lastUpdateDate;
    const s = asString(raw);
    if (s !== undefined) patch.lastUpdateDate = s;
    else if (rendersAsClear(raw)) patch.lastUpdateDate = "";
    // else: a malformed non-string. The key is DROPPED, so the stored value
    // survives the merge — the outcome the card promised.
  }
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

/** THE CREATE-PATH TWIN OF `patchWithoutId` ABOVE — same three deletes, same
 *  reason, opposite half of the write surface. Read the two together; the
 *  matching `WithoutId` names exist so that a `grep -n "WithoutId"` returns
 *  both, because finding one and not the other is how this defect shipped.
 *
 *  ★★★ THE ASYMMETRY THIS CLOSES. `patchWithoutId` is on every `update_*` case
 *  in `chat-tools.ts`; the seven pass-through `create_*` cases had NOTHING, and
 *  forwarded the model's raw `input` straight into the handler, which spreads it
 *  into the sanitizer. That is not caught downstream: five of the seven create
 *  handlers guard with a DENYLIST (`dropUnacceptedRaidFields` and its four
 *  peers iterate their own refusal table and delete only the fields they name,
 *  so a field with NO row is untouched — `sanitize-records.ts` states the split
 *  against the two ALLOWLIST guards, `dropUnacceptedAbsenceFields` and
 *  `dropUnacceptedCalendarEventFields`). No excluded field has a row in any of
 *  the five, and each entity's sanitizer PRESERVES its own excluded fields BAR
 *  `noteLog`, which no register sanitizer touches at all (the ★★ note below) — so
 *  a model-supplied value landed verbatim in the stored row on create, for
 *  fields no create schema in `chat-tool-defs.ts` offers it. The update path was
 *  clean only because of the strip above, never because the handlers refuse
 *  these fields.
 *
 *  ★★ PER ENTITY, NOT UNIFORMLY — an earlier revision said the sanitizers
 *  "PRESERVE both `localModifiedAt` and `outlookEventId`", which two of the five
 *  cannot do: `Stakeholder` and `Resource` HAVE NO `outlookEventId` FIELD
 *  (`types.ts`), and their `TOKEN_EXCLUDED` rows are `["localModifiedAt"]`
 *  alone, so the conclusion holds for each entity only over ITS OWN row. What
 *  each sanitizer keeps (`grep -n "localModifiedAt\|outlookEventId\|inquiriesSent"
 *  src/app/sanitize-records.ts src/app/sanitize-entities.ts`): milestone and
 *  change keep both; raid keeps both plus `inquiriesSent`; stakeholder and
 *  resource keep `localModifiedAt` only.
 *  ★★ `noteLog` is the exception in the other direction and makes the
 *  call-site claim below narrower than it reads: NO register sanitizer preserves
 *  it (`grep -c noteLog src/app/sanitize-records.ts` → 0 — not even a comment),
 *  because each builds an explicit object literal, so the `noteLog` members of
 *  the raid and change exclusion rows were ALREADY inert on this path before
 *  this helper existed. It is `localModifiedAt` (and `outlookEventId` where the
 *  entity has one) that the five would otherwise have stored verbatim.
 *
 *  ★★ TWO OF THE SEVEN CALL SITES ARE DEFENCE IN DEPTH, NOT LOAD-BEARING —
 *  do not read that as licence to delete them. `create_absence` and
 *  `create_calendar_event` guard with an ALLOWLIST
 *  (`dropUnacceptedAbsenceFields` / `dropUnacceptedCalendarEventFields`)
 *  that already drops both fields, so reverting the strip at either one
 *  changes no stored row; the same revert at any of the other five does — but
 *  ★ per FIELD, not per row: it is `localModifiedAt`, plus `outlookEventId` on
 *  the three entities that have one, that would then land. A revert of the
 *  `noteLog` member alone changes no STORED ROW (see the sanitizer note above),
 *  so do not read this as "every excluded field is load-bearing at five call
 *  sites".
 *  ★★ "No stored row" is the whole of that claim and an earlier revision
 *  overstated it as "changes nothing anywhere", which is false: `entityToken`
 *  covers `PROJECTORS[kind].columns` MINUS `TOKEN_EXCLUDED[kind]`, those columns
 *  ARE the CSV column lists, and `noteLog` is a member of the task, raid and
 *  change lists (`grep -n noteLog src/app/csv-codecs-core.ts`) — so dropping the
 *  member widens the TOKEN and every stored note-log edit starts invalidating
 *  it. Storage-inert, concurrency-relevant. The uniform rule — every pass-through
 *  `create_*` strips — is what is worth keeping: `ai-entity-token.ts` says in
 *  as many words that the `absence`/`calendarEvent` exclusion rows are
 *  legitimate ONLY because those two allowlists hold, so this is the backstop
 *  for the day one of them is widened, and "five of the seven" is a rule nobody
 *  can keep straight.
 *  ★ Measured 2026-09-11, one call site at a time, against
 *  `plan.offered-surface-sweep.test.ts` (clean: 0 failed / 74 passed): reverting
 *  the strip at `create_absence` or `create_calendar_event` leaves it UNCHANGED;
 *  reverting it at any of the other five takes it to 1 failed / 73, the failure
 *  being that entity's Relation A create case.
 *
 *  ★★ `create_task` is deliberately NOT routed through this helper and that is
 *  not an oversight. Its case reads named fields off `input` one at a time into
 *  an object literal — an ALLOWLIST, structurally the same guarantee
 *  `buildPatch` gives `update_task` — so no undeclared key can reach the
 *  handler and a strip there would be unreachable code that READS as a guard.
 *  Route a create through here the moment it spreads `input`.
 *
 *  ★★★ THE ARITHMETIC DOES NOT CLOSE FROM `chat-tools.ts` ALONE, so state the
 *  ninth: there are NINE create tools, not eight. `create_document` is declared
 *  in `chat-tool-defs-documents.ts` and dispatched in `chat-tools-documents.ts`,
 *  never in `chat-tools.ts`, so a reader counting cases there gets 7 + 1 and
 *  cannot reconcile it. It needs no strip — it is not a `TokenEntity` and takes
 *  no token — but a grep that misses it also misses the reason `TOOL_DEFS` is
 *  COMPOSED (`chat-tool-defs.ts` spreads `DOCUMENT_TOOL_DEFS`), which is the
 *  same trap twice. Enumerate across BOTH def files, never one — the leading
 *  anchor is what keeps this line out of its own result set (9 today):
 *    grep -rnE '^\s+name: "create_' src/app --include=*.ts | grep -v test
 *
 *  ★ `id` goes for the same reason on both sides, stated differently: an update
 *  takes it as the address rather than a field, and a create MINTS it (every
 *  handler assigns its own `id` after the spread), so a model-supplied one is
 *  never the row's id and must not ride along as a stray property.
 *
 *  ★ `expectedToken` is stripped here too even though no `create_*` schema
 *  advertises it — a create has no row to compare against, so the field is
 *  meaningless rather than refused, and a model that sends it anyway (having
 *  learnt it from the six update schemas) must not have it spread onto the new
 *  row. Keeping the three deletes identical is the point: a reader deriving one
 *  helper from the other cannot get a narrower strip than the code has.
 *
 *  ★★ THE `id` AND `expectedToken` DELETES ARE KEPT FOR SYMMETRY, NOT FOR
 *  REACHABILITY, and both are in fact already unreachable here: a create MINTS
 *  its `id` after the spread, and every sanitizer downstream builds an explicit
 *  object literal a stray `expectedToken` cannot survive. So do not justify
 *  EITHER strip by reachability — the reason to keep them is that three
 *  identical deletes cannot be misread, and the reason `create_task` is excluded
 *  is SHAPE (routing an allowlist handler through a spread-based helper), never
 *  that its strip would be unreachable. */
export function createInputWithoutId<T>(
  input: Record<string, unknown>,
  kind: TokenEntity,
): T {
  const create = { ...input };
  delete create.id;
  delete create.expectedToken;
  for (const field of TOKEN_EXCLUDED[kind]) delete create[field];
  return create as T;
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
 *  hand. See `requireToken` for the full reasoning.
 *
 *  ★★ THE CAPITAL `T` IS DELIBERATE AND IS THE ODD ONE OUT. The six `update_*`
 *  tools throw lowercase (`task #N not found`); this tool has always thrown
 *  `Task #N not found` from its post-write check, and moving the check EARLIER
 *  must not also change what it says. Aligning the casing is a separate,
 *  defensible change — but it would be an unrelated behaviour change smuggled
 *  into a security fix, and these strings are model-facing `tool_result` text
 *  that a stored insight recommendation could in principle be replaying
 *  against. So: same string, earlier. ★ Nothing used to be able to SEE a
 *  change either way — `chat-tools.test.ts` asserted only the substring
 *  `"#9 not found"` — so the case now asserts the full message, which is what
 *  makes this choice enforceable rather than merely stated. Note the token
 *  LABEL below stays lowercase (`task #N`), matching the other six, so a user
 *  who hits both branches sees `Task #7 not found` and `task #7 changed since
 *  you read it`. That inconsistency is inherited, now visible, and worth fixing
 *  in a commit that does nothing else. */
export function requireTaskWriteToken(
  current: Task | null | undefined,
  id: number,
  input: Record<string, unknown>,
): void {
  if (!current) throw new Error(`Task #${id} not found`);
  requireToken("task", current, input, `task #${id}`);
}
