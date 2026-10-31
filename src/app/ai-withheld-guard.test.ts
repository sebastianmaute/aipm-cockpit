// AI-05 / AI-07 / AI-08 — one seeded workspace through every model-facing serializer this test can reach without
// mounting the chat: the chat's list and get tools (`runTool` over the same summary projections the real
// dispatcher wires — `use-chat-dispatcher.ts`, `use-register-tools.ts`), `search_history` over a log of edits to
// every withheld field, and the inline editor's scope projection. Every withheld field holds a value found nowhere
// else, and none may appear in what the model is sent.
//
// ★ NOT COVERED HERE: the real dispatcher hooks themselves (a list method wired to a different projection would
//   pass this test), `get_app_state`, the dashboard snapshot and the inline create path (R8).
import { describe, expect, it } from "vitest";
import { appendActivityEntry, diffFields, type ActivityEntry, type ActivityKind } from "./activity-log";
import { AI_WITHHELD_FIELDS } from "./ai-withheld-fields";
import { stringifyResult } from "./chat-api";
import {
  runTool,
  toAbsenceSummary,
  toCalendarEventSummary,
  toChangeSummary,
  toMilestoneSummary,
  toRaidSummary,
  toResourceSummary,
  toStakeholderSummary,
  type ToolDispatcher,
} from "./chat-tools";
import { INLINE_DESCRIPTORS, type InlineEntity } from "./inline-ai-edit/entity-descriptor";
import { projectForInlineEdit } from "./inline-ai-edit/projection";

/** A value found nowhere else in the workspace. An e-mail field holds an address-shaped one. */
function secret(entity: string, field: string, version = "a"): string {
  return /email/i.test(field) ? `${entity}-${field}-${version}@withheld.example` : `W-${entity}-${field}-${version}`;
}

/** The base row of each entity, without its withheld fields. */
const BASE: Record<InlineEntity, Record<string, unknown>> = {
  task: { id: 1, taskName: "Deck", assignee: "Ada", dueDate: "2026-07-01", status: "To Do", priority: "Medium", description: "", blockers: [], labels: [], dependencies: [] },
  raid: { id: 2, category: "Risk", title: "Vendor", status: "Open", owner: "Ada", escalations: [{ at: "2026-07-01", toName: "Eve", toEmail: "raid-toEmail-a@withheld.example" }] },
  change: { id: 3, title: "Scope", status: "Pending" },
  milestone: { id: 4, title: "Go-live", dueDate: "2026-08-01", status: "Planned" },
  stakeholder: { id: 5, name: "Bo", organization: "ACME", raci: {} },
  resource: { id: 6, firstName: "Cy", lastName: "Do", title: "Analyst" },
  absence: { id: 7, assignee: "Ada", startDate: "2026-07-06", endDate: "2026-07-10" },
  calendarEvent: { id: 8, title: "Steering", startDate: "2026-07-08", startTime: "09:00", durationMinutes: 60, attendeeResourceIds: [6] },
};

/** `version` picks the value; an absence's type is a real type ("vacation" before an edit, "sick" after). */
function seeded(entity: InlineEntity, version = "a"): Record<string, unknown> {
  const row: Record<string, unknown> = { ...BASE[entity] };
  for (const f of AI_WITHHELD_FIELDS[entity]) {
    row[f] = f === "emails" ? [secret(entity, f, version)] : secret(entity, f, version);
  }
  if (entity === "absence") row.type = version === "a" ? "vacation" : "sick";
  row.noteLog = [{ date: "2026-07-01", text: secret(entity, "noteLog", version) }];
  return row;
}

/** ★ The chat's list tools SEND a stakeholder's influence and interest (`toStakeholderSummary`; the RACI
 *  suggestion uses them too), so only the inline scope and `search_history` withhold them. */
const SENT_BY_CHAT_LISTS: ReadonlySet<string> = new Set(["stakeholder.influence", "stakeholder.interest"]);

/** Every withheld value the seeded rows hold (both versions), plus the absence types; `chatList` leaves out what
 *  the chat's list tools send by design. */
function allSecrets(entities: readonly InlineEntity[], withNoteLog: boolean, chatList = false): string[] {
  const out = ["vacation", "sick", "raid-toEmail-a@withheld.example"];
  for (const e of entities) {
    for (const v of ["a", "b"]) {
      for (const f of AI_WITHHELD_FIELDS[e]) {
        if (e === "absence" && f === "type") continue;
        if (chatList && SENT_BY_CHAT_LISTS.has(`${e}.${f}`)) continue;
        out.push(secret(e, f, v));
      }
      if (withNoteLog) out.push(secret(e, "noteLog", v));
    }
  }
  return out;
}

const ENTITIES = Object.keys(INLINE_DESCRIPTORS) as InlineEntity[];
const rowOf = (entity: InlineEntity) => (id: number) => (seeded(entity).id === id ? seeded(entity) : null);

function dispatcher(log: readonly ActivityEntry[]): ToolDispatcher {
  return {
    isPeopleProtected: () => false,
    listTasks: () => [seeded("task")],
    getTask: (id: number) => rowOf("task")(id),
    listRaid: () => [toRaidSummary(seeded("raid") as never)],
    getRaidRow: rowOf("raid"),
    listChanges: () => [toChangeSummary(seeded("change") as never)],
    getChangeRow: rowOf("change"),
    listMilestones: () => [toMilestoneSummary(seeded("milestone") as never)],
    getMilestoneRow: rowOf("milestone"),
    listStakeholders: () => [toStakeholderSummary(seeded("stakeholder") as never)],
    getStakeholderRow: rowOf("stakeholder"),
    listResources: () => [toResourceSummary(seeded("resource") as never)],
    getResource: (id: number) => (id === 6 ? toResourceSummary(seeded("resource") as never) : null),
    getResourceRow: rowOf("resource"),
    listAbsences: () => [toAbsenceSummary(seeded("absence") as never)],
    getAbsenceRow: rowOf("absence"),
    listCalendarEvents: () => [toCalendarEventSummary(seeded("calendarEvent") as never)],
    getCalendarEventRow: rowOf("calendarEvent"),
    getActivityLog: () => log,
    isHistorySearchEnabled: () => true,
    getTimezone: () => "UTC",
  } as unknown as ToolDispatcher;
}

/** One manual edit per entity changing every withheld field (a → b), as `logUpdate` stores it. */
function editLog(): ActivityEntry[] {
  let log: ActivityEntry[] = [];
  for (const e of ENTITIES) {
    log = appendActivityEntry(log, `${e}.updated` as ActivityKind, [e], diffFields(seeded(e, "a"), seeded(e, "b")), "user");
  }
  return log;
}

const CHAT_CALLS: [string, Record<string, unknown>][] = [
  ["list_tasks", {}], ["get_task", { id: 1 }], ["list_raid", {}], ["list_changes", {}], ["list_milestones", {}],
  ["list_stakeholders", {}], ["list_resources", {}], ["get_resource", { id: 6 }], ["list_absences", {}],
  ["list_calendar_events", {}], ["search_history", {}],
];

describe("no withheld value reaches the model (guard)", () => {
  it("the edit log really holds every withheld value (control: the log is not vacuous)", () => {
    const stored = JSON.stringify(editLog());
    for (const s of allSecrets(ENTITIES, false)) {
      // Nested in an array (escalations, a resource's `emails`), which `diffFields` never records.
      if (s.startsWith("raid-toEmail") || s.startsWith("resource-emails")) continue;
      expect(stored, s).toContain(s);
    }
  });

  it.each(CHAT_CALLS)("chat tool %s", async (name, input) => {
    const text = stringifyResult(await runTool(dispatcher(editLog()), name, input));
    expect(text.length).toBeGreaterThan(20); // control: the tool answered
    for (const s of allSecrets(ENTITIES, false, name !== "search_history")) expect(text, `${name} sent ${s}`).not.toContain(s);
  });

  it.each(ENTITIES)("inline scope of a %s", (entity) => {
    const text = JSON.stringify(projectForInlineEdit(entity, seeded(entity)));
    expect(text).toContain(String(BASE[entity].id)); // control
    for (const s of allSecrets([entity], true)) expect(text, `${entity} sent ${s}`).not.toContain(s);
  });
});
