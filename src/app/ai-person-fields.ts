// src/app/ai-person-fields.ts
//
// AI people protection, layer 1 (spec P4, R4): with protection on, the AI may not set, change or clear a
// person on any record. Pure and i18n-free.
//
// R4 is STRIP AND APPLY, not refuse: the person fields are removed from the AI's call, the rest applies,
// and the model is told which fields were dropped and why. Clearing ("" or null) is acting on a person too,
// so a PRESENT key is removed whatever its value.
//
// ★★ EVERY WRITE TOOL IS CLASSIFIED HERE, an empty list included. `ai-person-fields.test.ts` fails when a
//  tool in `NON_PEOPLE_TOOLS` that is not a pure read has no entry, so a new write tool must be decided
//  before it ships. The PEOPLE tools are not listed: the executor refuses them whole (`PEOPLE_TOOLS`).
// ★ A path segment ending in `[]` walks every element of that array (`changes[].who.resourceId`).

/** The input fields of each write tool that name, link or contact a person. Derived from the tools' own
 *  input schemas (`chat-tool-defs*.ts`), plus the id links a handler derives from them (`resourceId`,
 *  `ownerResourceId`), so a model that sends one anyway is stripped too. */
export const PERSON_FIELDS_BY_TOOL: Readonly<Record<string, readonly string[]>> = {
  // Tasks: the assignee, the address, and the directory link the dispatcher derives from them.
  create_task: ["assignee", "assigneeEmail", "resourceId"],
  update_task: ["assignee", "assigneeEmail", "resourceId"],
  set_task_dependencies: [],
  delete_task: [],
  delete_all_tasks: [],
  // The WBS preview strips its own new-task assignees (`withoutWbsAssignees`); this tool only opens it.
  optimize_wbs: [],
  // A view filter, not a record write (controller ruling, fix round 1): filtering by a person sets no one.
  set_filters: [],
  set_language: [],
  update_settings: [],
  // RAID: the owner, the address, the derived directory link, and the linked stakeholders.
  create_raid_item: ["owner", "ownerEmail", "ownerResourceId", "stakeholderIds"],
  update_raid_item: ["owner", "ownerEmail", "ownerResourceId", "stakeholderIds"],
  delete_raid_item: [],
  // Changes: who requested it, who decides it, and the linked stakeholders.
  create_change: ["requestedBy", "decisionBy", "stakeholderIds"],
  update_change: ["requestedBy", "decisionBy", "stakeholderIds"],
  delete_change: [],
  create_milestone: [],
  update_milestone: [],
  delete_milestone: [],
  // Meetings: the attendees, and the invitation mail to them (nothing is mailed to an AI-chosen person).
  create_calendar_event: ["attendeeResourceIds", "sendInvitations"],
  update_calendar_event: ["attendeeResourceIds", "sendInvitations"],
  delete_calendar_event: [],
  create_document: [],
  update_document: [],
  delete_document: [],
  // Forecast: an `addPeople` row may name a person on the resource list; a placeholder row names nobody.
  // A ROW path (`PERSON_ROW_PATHS`): the row is dropped, not emptied, unless its person is already stored.
  create_forecast_scenario: ["changes[].who.resourceId"],
  update_forecast_scenario: ["changes[].who.resourceId"],
  delete_forecast_scenario: [],
  set_forecast_proposal: [],
  set_forecast_target_confidence: [],
  // The project record: its sponsor and project manager are people.
  update_project: ["sponsor", "projectManager"],
};

/** Paths whose array ROW goes when it names a person the AI chose. A row without its person reference fails
 *  validation and would refuse the whole call (`changes` REPLACES the list); dropping the row lets the rest
 *  apply (R4). A row naming a person in `keepIds` (already stored in that record) passes unchanged: the AI
 *  chose no one. Review 3, R4 — because the list is REPLACED, the AI could also remove a person by leaving
 *  their row out: a stored person row (`storedRows`) the call omits is re-added unchanged. And a list the
 *  strip alone empties is dropped from the call, so nothing is written for it (never an empty list). */
const PERSON_ROW_PATHS: ReadonlySet<string> = new Set(["changes[].who.resourceId"]);

/** What the caller knows about the record the call writes: the person references it ALREADY holds. */
export interface PersonStripContext {
  readonly keepIds?: ReadonlySet<unknown>;
  /** The record's stored rows that name a person, for a ROW path: re-added when the call omits them. */
  readonly storedRows?: readonly unknown[];
}

/** What the model is told when person fields were removed from its call. English and i18n-free: the model
 *  reads it, like every tool error. It names the fields and says why, so the model does not retry. */
export function PERSON_FIELDS_REMOVED_NOTE(removed: readonly string[]): string {
  return (
    `This project protects its people from the AI, so these person fields were removed from the call before it ran and were not applied: ${removed.join(", ")}. ` +
    "Do not retry them and do not assign, move or rate anyone; the user sets people themselves, or can allow it in Settings for this project."
  );
}

/** The key a result carries the note under. */
export const PERSON_FIELDS_NOTE_KEY = "peopleProtection";

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** One path, NEW objects only. `hit` is true when the path's last key was present anywhere. */
function stripPath(value: unknown, segs: readonly string[]): { value: unknown; hit: boolean } {
  if (!isRecord(value) || segs.length === 0) return { value, hit: false };
  const [seg, ...rest] = segs as [string, ...string[]];
  const isArray = seg.endsWith("[]");
  const key = isArray ? seg.slice(0, -2) : seg;
  if (!Object.hasOwn(value, key)) return { value, hit: false };
  if (rest.length === 0 && !isArray) {
    const kept = { ...value };
    delete kept[key]; // a fresh copy: `input` itself is never touched
    return { value: kept, hit: true };
  }
  const child = value[key];
  if (isArray) {
    if (!Array.isArray(child)) return { value, hit: false };
    let hit = false;
    const next = child.map((el) => {
      const r = stripPath(el, rest);
      hit ||= r.hit;
      return r.value;
    });
    return hit ? { value: { ...value, [key]: next }, hit } : { value, hit: false };
  }
  const r = stripPath(child, rest);
  return r.hit ? { value: { ...value, [key]: r.value }, hit: true } : { value, hit: false };
}

/** `value` without the rows of its first `[]` array whose leaf names a person not in `keep`, plus every stored
 *  person row the call omitted; without the array at all when the drop alone emptied it. */
function dropPersonRows(
  value: Record<string, unknown>,
  path: string,
  keep: ReadonlySet<unknown>,
  stored: readonly unknown[],
): { value: Record<string, unknown>; hit: boolean } {
  const [head, ...rest] = path.split(".") as [string, ...string[]];
  const key = head.slice(0, -2);
  const rows = value[key];
  if (!Array.isArray(rows)) return { value, hit: false };
  const named = (row: unknown): { present: boolean; id: unknown } => {
    let node: unknown = row;
    for (const seg of rest.slice(0, -1)) node = isRecord(node) ? node[seg] : undefined;
    const leaf = rest[rest.length - 1]!;
    return isRecord(node) && Object.hasOwn(node, leaf) ? { present: true, id: node[leaf] } : { present: false, id: undefined };
  };
  const kept = rows.filter((row) => {
    const n = named(row);
    return !n.present || keep.has(n.id);
  });
  if (rows.length > 0 && kept.length === 0) {
    const without = { ...value };
    delete without[key]; // a fresh copy: `input` itself is never touched
    return { value: without, hit: true };
  }
  const sent = new Set(kept.map(named).filter((n) => n.present).map((n) => n.id));
  const omitted = stored.filter((row) => {
    const n = named(row);
    return n.present && !sent.has(n.id);
  });
  if (kept.length === rows.length && omitted.length === 0) return { value, hit: false };
  return { value: { ...value, [key]: [...kept, ...omitted] }, hit: true };
}

/** The tool's input with every person field removed, and the fields (paths) that were present. A tool with
 *  no entry, or an empty one, comes back unchanged. Never mutates `input`. `ctx.keepIds` names the person
 *  references the written record already holds, which a ROW path keeps (`PERSON_ROW_PATHS`). */
export function stripPersonFields(
  toolName: string,
  input: Readonly<Record<string, unknown>>,
  ctx: PersonStripContext = {},
): { input: Record<string, unknown>; removed: string[] } {
  const fields = Object.hasOwn(PERSON_FIELDS_BY_TOOL, toolName) ? PERSON_FIELDS_BY_TOOL[toolName]! : [];
  let current: Record<string, unknown> = { ...input };
  const removed: string[] = [];
  for (const path of fields) {
    const r = PERSON_ROW_PATHS.has(path)
      ? dropPersonRows(current, path, ctx.keepIds ?? new Set(), ctx.storedRows ?? [])
      : stripPath(current, path.split("."));
    if (r.hit) {
      current = r.value as Record<string, unknown>;
      removed.push(path);
    }
  }
  return { input: current, removed };
}

/** A list of calls with every person field removed (only when protected), and every field removed, once
 *  per call that carried it. For the paths that turn a batch of AI calls into a review card and a write. */
export function stripPersonFieldsFromCalls<C extends { readonly name?: string; readonly input?: unknown }>(
  calls: readonly C[],
  peopleProtected: boolean,
): { calls: C[]; removed: string[] } {
  if (!peopleProtected) return { calls: [...calls], removed: [] };
  const removed: string[] = [];
  const out = calls.map((c) => {
    if (typeof c.name !== "string" || !isRecord(c.input)) return c;
    const s = stripPersonFields(c.name, c.input);
    if (s.removed.length === 0) return c;
    removed.push(...s.removed);
    return { ...c, input: s.input };
  });
  return { calls: out, removed };
}

/** A tool result with the note attached, so the model learns what was not applied. Unchanged when nothing
 *  was removed. An object result keeps every key it had (a create's `id` stays where callers read it). */
export function withPersonFieldsNote(result: unknown, removed: readonly string[]): unknown {
  if (removed.length === 0) return result;
  const note = PERSON_FIELDS_REMOVED_NOTE(removed);
  return isRecord(result) ? { ...result, [PERSON_FIELDS_NOTE_KEY]: note } : { result, [PERSON_FIELDS_NOTE_KEY]: note };
}
