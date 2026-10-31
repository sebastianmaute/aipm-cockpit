// src/app/ai-people-dictionary.ts
//
// AI people protection, R2: "known to the project" is a RULE, not a list. Every
// name-, email- or phone-bearing field of every persisted Workspace slice feeds
// the dictionary the redactor (`ai-people-redact.ts`) matches against. Pure and
// i18n-free.
//
// ★★ A new person field must be added to PERSON_READERS (or, when it is not a
// person, to NOT_PERSON_FIELDS with the reason). `ai-people-dictionary.test.ts`
// walks the sample workspace and a typed fixture and fails on any person-like
// key that is in neither list.

import type { Workspace } from "./workspace";

export type PeopleDictionary = {
  readonly names: readonly string[];
  readonly emails: readonly string[];
  readonly phones: readonly string[];
};

type FieldKind = "name" | "email" | "phone";
/** `identity`: the field IS a record's name (a resource, a stakeholder), so a ROLE_VALUES word there is a person. */
type Reader = { readonly paths: readonly string[]; readonly kind: FieldKind; readonly read: (ws: Workspace) => readonly unknown[]; readonly identity?: true };

const authors = (logs: readonly { authorName?: string }[] | undefined) => (logs ?? []).map((n) => n.authorName);

/** One row per field (or field pair) the extractor reads. `paths` use the
 *  coverage walk's notation: `slice[].field`, nested `slice[].list[].field`. */
const PERSON_READERS: readonly Reader[] = [
  {
    paths: ["resources[].firstName", "resources[].lastName"],
    kind: "name",
    read: (ws) => ws.resources.map((r) => `${r.firstName ?? ""} ${r.lastName ?? ""}`),
    identity: true,
  },
  { paths: ["resources[].email"], kind: "email", read: (ws) => ws.resources.map((r) => r.email) },
  { paths: ["resources[].emails"], kind: "email", read: (ws) => ws.resources.flatMap((r) => r.emails ?? []) },
  { paths: ["resources[].businessPhone"], kind: "phone", read: (ws) => ws.resources.map((r) => r.businessPhone) },
  { paths: ["stakeholders[].name"], kind: "name", read: (ws) => (ws.stakeholders ?? []).map((s) => s.name), identity: true },
  { paths: ["stakeholders[].email"], kind: "email", read: (ws) => (ws.stakeholders ?? []).map((s) => s.email) },
  { paths: ["absences[].assignee"], kind: "name", read: (ws) => ws.absences.map((a) => a.assignee) },
  { paths: ["absences[].assigneeEmail"], kind: "email", read: (ws) => ws.absences.map((a) => a.assigneeEmail) },
  { paths: ["shifts[].assignee"], kind: "name", read: (ws) => ws.shifts.map((s) => s.assignee) },
  { paths: ["shifts[].assigneeEmail"], kind: "email", read: (ws) => ws.shifts.map((s) => s.assigneeEmail) },
  { paths: ["tasks[].assignee"], kind: "name", read: (ws) => ws.tasks.map((t) => t.assignee) },
  { paths: ["tasks[].assigneeEmail"], kind: "email", read: (ws) => ws.tasks.map((t) => t.assigneeEmail) },
  { paths: ["tasks[].noteLog[].authorName"], kind: "name", read: (ws) => ws.tasks.flatMap((t) => authors(t.noteLog)) },
  { paths: ["tasks[].blockerLog[].authorName"], kind: "name", read: (ws) => ws.tasks.flatMap((t) => authors(t.blockerLog)) },
  { paths: ["raid[].owner"], kind: "name", read: (ws) => ws.raid.map((r) => r.owner) },
  { paths: ["raid[].ownerEmail"], kind: "email", read: (ws) => ws.raid.map((r) => r.ownerEmail) },
  { paths: ["raid[].noteLog[].authorName"], kind: "name", read: (ws) => ws.raid.flatMap((r) => authors(r.noteLog)) },
  { paths: ["raid[].escalations[].toName"], kind: "name", read: (ws) => ws.raid.flatMap((r) => (r.escalations ?? []).map((e) => e.toName)) },
  { paths: ["raid[].escalations[].toEmail"], kind: "email", read: (ws) => ws.raid.flatMap((r) => (r.escalations ?? []).map((e) => e.toEmail)) },
  { paths: ["changes[].requestedBy"], kind: "name", read: (ws) => (ws.changes ?? []).map((c) => c.requestedBy) },
  { paths: ["changes[].decisionBy"], kind: "name", read: (ws) => (ws.changes ?? []).map((c) => c.decisionBy) },
  { paths: ["changes[].noteLog[].authorName"], kind: "name", read: (ws) => (ws.changes ?? []).flatMap((c) => authors(c.noteLog)) },
  { paths: ["project.projectManager"], kind: "name", read: (ws) => [ws.project?.projectManager] },
  { paths: ["project.sponsor"], kind: "name", read: (ws) => [ws.project?.sponsor] },
  { paths: ["project.keyStakeholdersInternal"], kind: "name", read: (ws) => ws.project?.keyStakeholdersInternal ?? [] },
  { paths: ["project.keyStakeholdersExternal"], kind: "name", read: (ws) => ws.project?.keyStakeholdersExternal ?? [] },
  { paths: ["project.contactPersons[].name"], kind: "name", read: (ws) => (ws.project?.contactPersons ?? []).map((c) => c.name) },
  { paths: ["project.contactPersons[].email"], kind: "email", read: (ws) => (ws.project?.contactPersons ?? []).map((c) => c.email) },
  // Timelog bookers: the guardrail insights carry the booker's display name
  // (`detect.ts`), or "#<userId>" when the link dangles — dropped as not a name.
  { paths: ["insights[].data.person"], kind: "name", read: (ws) => (ws.insights ?? []).map((i) => i.data?.person) },
];

/** Every field path the extractor reads (exported for the coverage pin). */
export const PERSON_FIELD_PATHS: readonly string[] = PERSON_READERS.flatMap((r) => r.paths);

/** Person-LIKE keys that are not people, each with the reason. Ids referencing a
 *  Resource are not names: the name is read from `resources[]` itself. */
export const NOT_PERSON_FIELDS: Readonly<Record<string, string>> = {
  "tasks[].taskName": "a task title",
  "tasks[].knowledgeLinks[].name": "a linked file name",
  "tasks[].noteLog[].authorResourceId": "a resource id; the name is read from resources[]",
  "tasks[].blockerLog[].authorResourceId": "a resource id; the name is read from resources[]",
  "raid[].ownerResourceId": "a resource id; the name is read from resources[]",
  "raid[].knowledgeLinks[].name": "a linked file name",
  "raid[].noteLog[].authorResourceId": "a resource id; the name is read from resources[]",
  "changes[].noteLog[].authorResourceId": "a resource id; the name is read from resources[]",
  "changes[].knowledgeLinks[].name": "a linked file name",
  "disciplines[].name": "a discipline label (Developer, Architect, ...)",
  "grades[].name": "a grade label (Junior, Senior, ...)",
  "budgets[].name": "a budget bucket title",
  "milestones[].name": "a milestone title",
  "milestones[].knowledgeLinks[].name": "a linked file name",
  "stakeholders[].knowledgeLinks[].name": "a linked file name",
  "project.name": "the project title",
  "project.knowledgeLinks[].name": "a linked file name",
  "steeringCommittee.name": "the committee's title",
  "steeringCommittee.memberResourceIds": "resource ids; the names are read from resources[]",
  "timelogLinks.userLinks[].timelogUserId": "a Timelog user id (number)",
  "settingsOverrides.notifications.raidReviewIntervalDays": "a number of days",
  "knowledgeItems[].name": "a library item title",
  "insights[].data.name": "a milestone, budget or RAID title the insight is about",
  "activityLog[].actor": "an actor KIND: user, ai or integration — never a person's name",
  "calendarEvents[].attendeeResourceIds": "resource ids; the names are read from resources[]",
  "insights[].recommendation.proposedCalls[].name": "an AI tool's name (e.g. create_task)",
  "budgetHistory[].bucketName": "a budget bucket title",
  "forecastScenarios[].name": "a forecast scenario title",
  "documentAssets[].name": "an uploaded image's file name",
};

/** Values typed into a person field that mean "nobody yet" (EN + DE), and pronouns and quantifiers that name nobody
 *  in particular ("me", "ich", "alle"). Compared lower-cased against the WHOLE value, before and after cleaning, so
 *  "Alle Bauer" stays a name. Review 5, S2: without the second group, an assignee "me" became a lower-case one-word
 *  name, which the redactor matches in any case, so the word was redacted wherever it appeared. */
const NON_PERSON_VALUES: ReadonlySet<string> = new Set([
  "tbd", "tbc", "tba", "n/a", "na", "none", "unassigned", "unknown", "n.n.", "n.n", "-", "?",
  "offen", "keine", "niemand",
  "me", "myself", "self", "i", "you", "we", "us", "all", "everyone", "everybody", "nobody", "anyone", "someone",
  "ich", "mich", "mir", "du", "wir", "uns", "alle", "jeder", "jede", "jemand", "selbst", "selber",
]);

/** One-word roles and teams typed into a person field (EN + DE): "QA" as an assignee, "Kunde" as an owner.
 *  Matched lower-cased against the WHOLE cleaned value, so "QA Lead" or "Max" are never touched. Review 2, D:
 *  without this, a team word became a "full known name" and was redacted everywhere it appeared. A value that
 *  is the name of a known resource or stakeholder (an `identity` reader) stays a person — someone may really
 *  be called "Sales" in the directory. Kept short: a missing word only over-redacts, never leaks. */
const ROLE_VALUES: ReadonlySet<string> = new Set([
  "qa", "dev", "devs", "ops", "devops", "pm", "pmo", "po", "it", "hr",
  "vendor", "supplier", "client", "customer", "team", "support", "sales", "legal", "finance", "management",
  "marketing", "procurement", "external", "internal",
  "extern", "intern", "lieferant", "kunde", "vertrieb", "einkauf", "geschäftsführung", "buchhaltung", "rechtsabteilung",
]);

/** A name as the redactor should match it, or null when it is not a person:
 *  bracketed segments ("(CFO)", "[ext]") are removed, punctuation around each
 *  token is stripped, tokens without a letter are dropped, and the
 *  NON_PERSON_VALUES are rejected. */
export function cleanPersonName(raw: string): string | null {
  const trimmed = raw.trim().replace(/\s+/g, " ");
  if (NON_PERSON_VALUES.has(trimmed.toLowerCase())) return null;
  const name = trimmed
    .replace(/[([{][^)\]}]*[)\]}]/g, " ")
    .split(/\s+/)
    .map((t) => t.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter((t) => /\p{L}/u.test(t))
    .join(" ");
  return name && !NON_PERSON_VALUES.has(name.toLowerCase()) ? name : null;
}

const dedupeKey: Record<FieldKind, (s: string) => string> = {
  name: (s) => s.toLowerCase().replace(/\s+/g, " "),
  email: (s) => s.toLowerCase(),
  phone: (s) => (s.trim().startsWith("+") ? "+" : "") + s.replace(/\D/g, ""),
};

const clean: Record<FieldKind, (s: string) => string | null> = {
  name: cleanPersonName,
  email: (s) => (s.includes("@") ? s : null),
  phone: (s) => (/\d/.test(s) ? s : null),
};

const isRoleValue = (name: string): boolean => ROLE_VALUES.has(name.toLowerCase());

/** The lower-cased cleaned names of the project's resources and stakeholders (the `identity` readers). */
function identityNames(ws: Workspace): ReadonlySet<string> {
  const out = new Set<string>();
  for (const reader of PERSON_READERS) {
    if (!reader.identity) continue;
    for (const raw of reader.read(ws)) {
      const name = typeof raw === "string" ? cleanPersonName(raw) : null;
      if (name !== null) out.add(name.toLowerCase());
    }
  }
  return out;
}

/** Build the people dictionary of one project. First spelling wins; blanks,
 *  ids, "nobody" values and case-duplicates are dropped (see cleanPersonName). */
export function buildPeopleDictionary(ws: Workspace): PeopleDictionary {
  const out: Record<FieldKind, Map<string, string>> = { name: new Map(), email: new Map(), phone: new Map() };
  const identities = identityNames(ws);
  for (const reader of PERSON_READERS) {
    for (const raw of reader.read(ws)) {
      if (typeof raw !== "string") continue;
      const value = clean[reader.kind](raw.trim().replace(/\s+/g, " "));
      if (value === null) continue;
      if (reader.kind === "name" && isRoleValue(value) && !identities.has(value.toLowerCase())) continue;
      const key = dedupeKey[reader.kind](value);
      if (!out[reader.kind].has(key)) out[reader.kind].set(key, value);
    }
  }
  return { names: [...out.name.values()], emails: [...out.email.values()], phones: [...out.phone.values()] };
}
