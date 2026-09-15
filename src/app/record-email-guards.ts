// Write-boundary email guards shared by every AI/tool writer (spec Part 1).
// Kept out of sanitize-records.ts, which sits at the file-size LIMIT, and
// re-exported through the `./sanitize` barrel like absence-email.ts.
import { EMAIL_MAX, emailWriteRefusal, isWriteSafeEmail, normalizeEmailShape, sanitizeText, type EmailRefusal } from "./sanitize-core";
import type { Absence, ProjectMeta, RaidItem, Resource, Shift, Stakeholder, Task } from "./types";
import type { Workspace } from "./workspace";

/** The model-facing refusal text, one shape per reason. Unlocalized on purpose,
 *  like every other throw a tool writer surfaces. */
export function emailRefusalMessage(field: string, refusal: EmailRefusal): string {
  return refusal === "invalid" ? `${field} is invalid` : `${field} must not contain "," or ";"`;
}

/** Throws when `incoming` would store a CHANGED email that is not write-safe
 *  (`emailWriteRefusal`, judged against the row's `stored` value; a create
 *  passes undefined). A non-string `incoming` is not this guard's business —
 *  the record sanitizer blanks it — and a blank one is a legal clear.
 *  ★★ Fix round 1: `cap` is the FIELD'S OWN storage cap, defaulting to
 *  EMAIL_MAX (320) — what plain `sanitizeEmail` applies, and what every
 *  caller but one wants. The guard must judge the value the sanitizer will
 *  actually STORE, never a looser one: `sanitizeStakeholder` caps `email` at
 *  BUDGET_NAME_MAX (200) via `sanitizeText`, not `sanitizeEmail`, so
 *  `use-register-tools.ts`'s stakeholder writers pass that cap explicitly —
 *  else a >200-char address could pass THIS guard capped at 320 and then be
 *  re-cut to 200 by the sanitizer into something invalid it stores anyway.
 *  ★★★ M1: and the value judged is UNWRAPPED first — `Name <addr>` → `addr`
 *  (`normalizeEmailShape`), THEN capped, the order `sanitizeLoadedEmail` uses —
 *  because every AI email writer now STORES that unwrapped value. Judging the raw
 *  string refused "Ann Lee <ann@x.com>" (it holds a space) while the sanitizer
 *  would have stored the valid "ann@x.com". */
export function refuseEmailWrite(field: string, incoming: unknown, stored: string | undefined, cap: number = EMAIL_MAX): void {
  if (typeof incoming !== "string") return;
  const refusal = emailWriteRefusal(sanitizeText(normalizeEmailShape(incoming), cap), stored);
  if (refusal !== null) throw new Error(emailRefusalMessage(field, refusal));
}

export interface UnsafeEmailScope {
  tasks?: readonly Task[];
  raid?: readonly RaidItem[];
  absences?: readonly Absence[];
  shifts?: readonly Shift[];
  resources?: readonly Resource[];
  stakeholders?: readonly Stakeholder[];
  project?: ProjectMeta;
}

const NOTICE_NAMES_MAX = 5;

/** The explicit-import notice's content (spec Part 2, decision 4): how many
 *  records still hold a present email that is not write-safe, and the first
 *  few of their names. Null when none. i18n-free; callers render
 *  `importUnsafeEmailsNotice`. Never names an address. */
export function summarizeUnsafeEmailRecords(ws: UnsafeEmailScope): { count: number; names: string } | null {
  const unsafe = (v: unknown): boolean => typeof v === "string" && v.trim() !== "" && !isWriteSafeEmail(v);
  const names: string[] = [];
  for (const row of ws.tasks ?? []) if (unsafe(row.assigneeEmail)) names.push(row.taskName);
  for (const row of ws.raid ?? []) if (unsafe(row.ownerEmail)) names.push(row.title);
  for (const row of ws.absences ?? []) if (unsafe(row.assigneeEmail)) names.push(row.assignee);
  for (const row of ws.shifts ?? []) if (unsafe(row.assigneeEmail)) names.push(row.assignee);
  for (const row of ws.resources ?? []) {
    if (unsafe(row.email) || (row.emails ?? []).some(unsafe)) names.push(`${row.firstName} ${row.lastName}`.trim());
  }
  for (const row of ws.stakeholders ?? []) if (unsafe(row.email)) names.push(row.name);
  for (const person of ws.project?.contactPersons ?? []) if (unsafe(person.email)) names.push(person.name);
  if (names.length === 0) return null;
  const shown = names.slice(0, NOTICE_NAMES_MAX).join(", ");
  return { count: names.length, names: names.length > NOTICE_NAMES_MAX ? `${shown}, …` : shown };
}

/** The rows `handleApplyTemplate` (task-manager.tsx) actually brings in: the
 *  rows `appendSeed` ADDED to the three slices that handler applies (`tasks`,
 *  `raid`, `stakeholders`) — ids present in `after` but not in `before`. Never
 *  the current project's existing rows. Exact because `remapSeed` gives every
 *  seed row a fresh id. `resources` is left out: `handleApplyTemplate` does not
 *  apply the seed's resources. */
export function templateSeedEmailScope(
  before: Pick<Workspace, "tasks" | "raid" | "stakeholders">,
  after: Pick<Workspace, "tasks" | "raid" | "stakeholders">,
): UnsafeEmailScope {
  const added = <T extends { id: number }>(prev: readonly T[] | undefined, next: readonly T[] | undefined): T[] => {
    const known = new Set((prev ?? []).map((row) => row.id));
    return (next ?? []).filter((row) => !known.has(row.id));
  };
  return {
    tasks: added(before.tasks, after.tasks),
    raid: added(before.raid, after.raid),
    stakeholders: added(before.stakeholders, after.stakeholders),
  };
}
