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
type Reader = { readonly paths: readonly string[]; readonly kind: FieldKind; readonly read: (ws: Workspace) => readonly unknown[] };

const authors = (logs: readonly { authorName?: string }[] | undefined) => (logs ?? []).map((n) => n.authorName);

/** One row per field (or field pair) the extractor reads. `paths` use the
 *  coverage walk's notation: `slice[].field`, nested `slice[].list[].field`. */
const PERSON_READERS: readonly Reader[] = [
  {
    paths: ["resources[].firstName", "resources[].lastName"],
    kind: "name",
    read: (ws) => ws.resources.map((r) => `${r.firstName ?? ""} ${r.lastName ?? ""}`),
  },
  { paths: ["resources[].email"], kind: "email", read: (ws) => ws.resources.map((r) => r.email) },
  { paths: ["resources[].emails"], kind: "email", read: (ws) => ws.resources.flatMap((r) => r.emails ?? []) },
  { paths: ["resources[].businessPhone"], kind: "phone", read: (ws) => ws.resources.map((r) => r.businessPhone) },
  { paths: ["stakeholders[].name"], kind: "name", read: (ws) => (ws.stakeholders ?? []).map((s) => s.name) },
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
  "raid[].escalations[].toResourceId": "a resource id; the name is read from resources[]",
  "changes[].noteLog[].authorResourceId": "a resource id; the name is read from resources[]",
  "disciplines[].name": "a discipline label (Developer, Architect, ...)",
  "grades[].name": "a grade label (Junior, Senior, ...)",
  "budgets[].name": "a budget bucket title",
  "milestones[].name": "a milestone title",
  "milestones[].knowledgeLinks[].name": "a linked file name",
  "stakeholders[].knowledgeLinks[].name": "a linked file name",
  "project.name": "the project title",
  "project.contactPersons[].id": "a contact's list id",
  "project.contactPersons[].resourceId": "a resource id; the name is read from resources[]",
  "steeringCommittee.name": "the committee's title",
  "knowledgeItems[].name": "a library item title",
  "insights[].data.name": "a milestone, budget or RAID title the insight is about",
  "activityLog[].actor": "an actor KIND: user, ai or integration — never a person's name",
  "calendarEvents[].attendeeResourceIds": "resource ids; the names are read from resources[]",
};

const dedupeKey: Record<FieldKind, (s: string) => string> = {
  name: (s) => s.toLowerCase().replace(/\s+/g, " "),
  email: (s) => s.toLowerCase(),
  phone: (s) => (s.trim().startsWith("+") ? "+" : "") + s.replace(/\D/g, ""),
};

const usable: Record<FieldKind, (s: string) => boolean> = {
  name: (s) => /\p{L}/u.test(s),
  email: (s) => s.includes("@"),
  phone: (s) => /\d/.test(s),
};

/** Build the people dictionary of one project. First spelling wins; blanks,
 *  ids and case-duplicates are dropped. */
export function buildPeopleDictionary(ws: Workspace): PeopleDictionary {
  const out: Record<FieldKind, Map<string, string>> = { name: new Map(), email: new Map(), phone: new Map() };
  for (const reader of PERSON_READERS) {
    for (const raw of reader.read(ws)) {
      if (typeof raw !== "string") continue;
      const value = raw.trim().replace(/\s+/g, " ");
      if (!usable[reader.kind](value)) continue;
      const key = dedupeKey[reader.kind](value);
      if (!out[reader.kind].has(key)) out[reader.kind].set(key, value);
    }
  }
  return { names: [...out.name.values()], emails: [...out.email.values()], phones: [...out.phone.values()] };
}
