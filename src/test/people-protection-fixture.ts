// src/test/people-protection-fixture.ts — the fictional project of the AI people protection wire test
// (`src/app/ai-people-protection.wire.test.ts`, spec "Layer 3" and R2).
//
// One distinct fictional person in EVERY person field the dictionary reads (`PERSON_FIELD_PATHS`), listed in
// `SEEDED_PERSON_FIELDS` by path, so the wire test fails when a new person field is added to the dictionary
// without a seeded value here. Every name is a distinctive full name, so the wire test asserts on full names
// (the redactor's lone-token rule is case-gated and stop-listed, and is not what this fixture probes).
//
// Two people are deliberately NOT in a dictionary-read field:
// - `FORMER_MEMBER` appears only in the activity log, as the previous assignee of a task: someone the project
//   once knew and no longer lists. The redactor cannot know them, which is why `search_history` (the activity
//   log search) is a people tool. A wire test that drives that tool under protection must find no trace of them.
// - the mail attachment (`MAIL_EML`) names a KNOWN person (`MAIL_PERSON`, the stakeholder) and their address.
import type { ActivityEntry } from "../app/activity-log";
import type { Insight } from "../app/insights/insight";
import { withPeopleAllowed } from "../app/ai-people-protection";
import type {
  Absence, ChangeItem, Milestone, NoteLogEntry, ProjectMeta, RaidItem, Resource, Shift, Stakeholder, Task,
} from "../app/types";
import { emptyWorkspace, type Workspace } from "../app/workspace";

export const FIXTURE_TODAY = "2026-10-30";
export const FIXTURE_PROJECT_KEY = "wire-project";

const P = {
  resource: "Rosalind Quenby",
  stakeholder: "Stellan Hargreave",
  absence: "Abigail Thornbury",
  shift: "Shiloh Vantongeren",
  assignee: "Tobias Kranewitter",
  taskNoteAuthor: "Nadia Oberholt",
  blockerAuthor: "Bertram Ellingsworth",
  raidOwner: "Ottilie Marchbanks",
  raidNoteAuthor: "Rufus Pennywhistle",
  escalatedTo: "Esmeralda Gwynfor",
  requestedBy: "Reginald Applethwaite",
  decisionBy: "Desdemona Farquhar",
  changeNoteAuthor: "Cornelius Wetherby",
  projectManager: "Philippa Underhay",
  // Diacritics, so the wire test's fold is exercised on a real body.
  sponsor: "Sébastien Oakenfold",
  internal: "Imogen Blackwater",
  external: "Zoë Brandtmüller",
  contact: "Cordelia Ashdown",
  booker: "Barnaby Quillfeather",
} as const;

const E = {
  resource: "r.quenby@example.test",
  resourceAlt: "rq.alt@example.test",
  stakeholder: "s.hargreave@example.test",
  absence: "a.thornbury@example.test",
  shift: "s.vantongeren@example.test",
  assignee: "t.kranewitter@example.test",
  raidOwner: "o.marchbanks@example.test",
  escalatedTo: "e.gwynfor@example.test",
  contact: "c.ashdown@example.test",
} as const;

export const FIXTURE_PHONE = "+49 30 5550 1187";
/** A phone the project does NOT know, typed into free text: the redactor's pattern must catch it. */
export const UNKNOWN_PHONE = "+49 30 9876543";
/** Both phones, checked with their spacing ignored. */
export const FIXTURE_PHONES: readonly string[] = [FIXTURE_PHONE, UNKNOWN_PHONE];

/** Every `PERSON_FIELD_PATHS` entry, with the value seeded into it. The wire test pins the key set. */
export const SEEDED_PERSON_FIELDS: Readonly<Record<string, string>> = {
  "resources[].firstName": P.resource,
  "resources[].lastName": P.resource,
  "resources[].email": E.resource,
  "resources[].emails": E.resourceAlt,
  "resources[].businessPhone": FIXTURE_PHONE,
  "stakeholders[].name": P.stakeholder,
  "stakeholders[].email": E.stakeholder,
  "absences[].assignee": P.absence,
  "absences[].assigneeEmail": E.absence,
  "shifts[].assignee": P.shift,
  "shifts[].assigneeEmail": E.shift,
  "tasks[].assignee": P.assignee,
  "tasks[].assigneeEmail": E.assignee,
  "tasks[].noteLog[].authorName": P.taskNoteAuthor,
  "tasks[].blockerLog[].authorName": P.blockerAuthor,
  "raid[].owner": P.raidOwner,
  "raid[].ownerEmail": E.raidOwner,
  "raid[].noteLog[].authorName": P.raidNoteAuthor,
  "raid[].escalations[].toName": P.escalatedTo,
  "raid[].escalations[].toEmail": E.escalatedTo,
  "changes[].requestedBy": P.requestedBy,
  "changes[].decisionBy": P.decisionBy,
  "changes[].noteLog[].authorName": P.changeNoteAuthor,
  "project.projectManager": P.projectManager,
  "project.sponsor": P.sponsor,
  "project.keyStakeholdersInternal": P.internal,
  "project.keyStakeholdersExternal": P.external,
  "project.contactPersons[].name": P.contact,
  "project.contactPersons[].email": E.contact,
  "insights[].data.person": P.booker,
};

/** The resource's name as the directory stores it, in two fields: a tool result carries the tokens apart, so the
 *  full name never appears there. The redactor matches a capitalised lone token of a known name, so the wire test
 *  checks these case-sensitively, as whole words. */
export const RESOURCE_NAME_TOKENS: readonly string[] = ["Rosalind", "Quenby"];

/** Someone the project once had: named only in the activity log (see the header). */
export const FORMER_MEMBER = "Ludovica Pemberton";

/** The known person the mail attachment names. */
export const MAIL_PERSON = P.stakeholder;

export const KNOWN_NAMES: readonly string[] = Object.values(P);
export const KNOWN_EMAILS: readonly string[] = Object.values(E);
/** Everything the wire test must never find in a protected body. */
export const FIXTURE_PEOPLE_TERMS: readonly string[] = [...KNOWN_NAMES, ...KNOWN_EMAILS, ...FIXTURE_PHONES, FORMER_MEMBER];

const note = (id: number, authorName: string, text: string): NoteLogEntry => ({
  id, authorName, timestamp: "2026-10-12T09:00:00.000Z", html: `<p>${text}</p>`, text,
});

export const TASK_ID = 1;
export const RESOURCE_ID = 1;
export const STAKEHOLDER_ID = 1;

const tasks: Task[] = [
  {
    id: TASK_ID, taskName: "Configure the staging cluster", assignee: P.assignee, assigneeEmail: E.assignee,
    dueDate: "2026-10-20", lastUpdateDate: "2026-10-10", priority: "Medium", status: "In Progress",
    blockers: "Waiting for firewall rules", description: `Bring the staging cluster up to the production layout. Questions to ${P.projectManager} (${E.contact}), ` +
      `on call ${FIXTURE_PHONE}, vendor hotline ${UNKNOWN_PHONE}.`,
    group: "Platform",
    noteLog: [note(1, P.taskNoteAuthor, `Firewall ticket raised; ${P.internal} approves it.`)],
    blockerLog: [{ id: 1, text: "Firewall rules", createdAt: "2026-10-11T08:00:00.000Z", authorName: P.blockerAuthor }],
  },
  {
    id: 2, taskName: "Set up the staging cluster", assignee: P.assignee, assigneeEmail: E.assignee,
    dueDate: "2026-11-15", lastUpdateDate: "2026-10-25", priority: "Low", status: "To Do",
    blockers: "", description: "Probably the same work as task 1.", group: "Platform",
  },
];

const raid: RaidItem[] = [
  {
    id: 1, category: "R", title: "Vendor delivers the licence keys late", status: "Open", severity: "High",
    linkedTaskIds: [TASK_ID], raisedDate: "2026-10-01", causedByRaidIds: [], stakeholderIds: [STAKEHOLDER_ID],
    owner: P.raidOwner, ownerEmail: E.raidOwner,
    description: `Keys promised by ${P.external} (${E.absence}) for Friday.`,
    noteLog: [note(1, P.raidNoteAuthor, "Chased the vendor.")],
    escalations: [{ at: "2026-10-15T10:00:00.000Z", toName: P.escalatedTo, toEmail: E.escalatedTo }],
  } as RaidItem,
];

const changes: ChangeItem[] = [
  {
    id: 1, title: "Add a second data centre", description: "Scope extension for resilience.", type: "Scope",
    status: "Under Review", raisedDate: "2026-10-05", linkedTaskIds: [], linkedRaidIds: [], stakeholderIds: [],
    requestedBy: P.requestedBy, decisionBy: P.decisionBy, noteLog: [note(1, P.changeNoteAuthor, "Costed.")],
  } as ChangeItem,
];

// The second milestone is overdue, so the digest (which carries milestone names and nothing else people-shaped)
// names a person: free text, matched only because the name is known to the project.
const milestones: Milestone[] = [
  { id: 1, name: "Staging ready", date: "2026-11-20", linkedTaskIds: [TASK_ID] },
  { id: 2, name: `Go/no-go sign-off by ${P.sponsor}`, date: "2026-10-25", linkedTaskIds: [] },
];

const resources: Resource[] = [
  {
    id: RESOURCE_ID, firstName: "Rosalind", lastName: "Quenby", email: E.resource, emails: [E.resourceAlt],
    businessPhone: FIXTURE_PHONE, roleId: null, utilizationMode: "hours", utilization: { "2026-11": 80 },
    title: "Platform engineer",
  } as Resource,
];

const stakeholders: Stakeholder[] = [
  {
    id: STAKEHOLDER_ID, name: P.stakeholder, email: E.stakeholder, title: "Head of Operations", category: "Sponsor",
    influence: "High", interest: "High", raci: { "1": "A" },
  } as Stakeholder,
];

const absences: Absence[] = [
  { id: 1, assignee: P.absence, assigneeEmail: E.absence, startDate: "2026-11-02", endDate: "2026-11-06", type: "vacation" } as Absence,
];

const shifts: Shift[] = [
  { id: 1, assignee: P.shift, assigneeEmail: E.shift, hoursPerWeekday: [0, 8, 8, 8, 8, 8, 0] } as Shift,
];

const project: ProjectMeta = {
  name: "Project Lighthouse", code: "LH-1", projectManager: P.projectManager, sponsor: P.sponsor,
  keyStakeholdersInternal: [P.internal], keyStakeholdersExternal: [P.external], customer: "Acme Logistics",
  naceSection: "H", identityTypes: [], products: "Warehouse platform", deployment: "", startDate: "2026-10-01",
  endDate: "2026-12-31", profitCenter: "PC-7",
  contactPersons: [{ id: 1, name: P.contact, email: E.contact, synced: false }], regulatory: [],
};

export const FIXTURE_INSIGHT: Insight = {
  id: 1, key: "timelog:wire:1", type: "stalledWork", severity: "high",
  data: { person: P.booker, count: 3 }, status: "active",
  firstSeenAt: "2026-10-20T08:00:00.000Z", lastSeenAt: "2026-10-29T08:00:00.000Z", occurrences: 3,
};

const activityLog: ActivityEntry[] = [
  {
    id: "wire-1", timestamp: "2026-10-28T09:00:00.000Z", kind: "task.updated", args: ["Configure the staging cluster"],
    actor: "user", changes: [{ field: "assignee", from: FORMER_MEMBER, to: P.assignee }],
  },
];

/** The fixture project. `peopleAllowed` stores the project's own choice; protected is the default (absent). */
export function peopleFixture(peopleAllowed = false): Workspace {
  return {
    ...emptyWorkspace(),
    tasks, raid, changes, milestones, resources, stakeholders, absences, shifts, project,
    plan: { startDate: "2026-10-01", endDate: "2026-12-31", granularity: "month", currency: "EUR" },
    insights: [FIXTURE_INSIGHT],
    activityLog,
    settingsOverrides: withPeopleAllowed(undefined, peopleAllowed),
  };
}

/** A mail (.eml) that names the stakeholder and their address, with a text attachment naming them again. */
export const MAIL_EML = [
  'Content-Type: multipart/mixed; boundary="B"',
  `From: ${P.stakeholder} <${E.stakeholder}>`,
  "Subject: Licence keys",
  "",
  "--B",
  "Content-Type: text/plain",
  "",
  `Hi team, ${P.stakeholder} here: the vendor confirmed the keys for Friday.`,
  "--B",
  'Content-Type: text/plain; name="minutes.txt"',
  'Content-Disposition: attachment; filename="minutes.txt"',
  "",
  `Action: ${P.stakeholder} (${E.stakeholder}) to confirm the delivery date.`,
  "--B--",
  "",
].join("\r\n");
