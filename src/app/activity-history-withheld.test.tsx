// AI-05 — `search_history` must not send the model a logged change to a field it is never sent (an absence's
// type and note, a person's phone, birthday, location and notes, a stakeholder's notes, influence and interest,
// every e-mail field). The redaction is at the MODEL boundary (`renderActivityEntry`); the stored log and the
// Activity panel keep every value.
//
// ★ Each log below is built the way the app's own edit handlers build it: `logUpdate` (use-resource-planner.ts,
//   use-resource-directory.ts) and `use-stakeholders.ts` append `diffFields(previous, next)` through
//   `appendActivityEntry` — the same two calls are made here, so the stored changes are the ones a manual edit
//   stores.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { appendActivityEntry, diffFields, type ActivityEntry, type ActivityKind } from "./activity-log";
import { ActivityLogPanel } from "./activity-log-panel";
import { stringifyResult } from "./chat-api";
import { runTool, type ToolDispatcher } from "./chat-tools";
import { DisplayTimezoneProvider } from "./display-timezone-context";
import { withheldActivityField } from "./ai-withheld-fields";

function manualEdit<T extends object>(kind: ActivityKind, previous: T, next: T, ...args: (string | number)[]): ActivityEntry[] {
  return appendActivityEntry([], kind, args, diffFields(previous, next), "user");
}

const ABSENCE_BEFORE = {
  id: 50, assignee: "Ada Lovelace", assigneeEmail: "ada@old.example", startDate: "2026-07-06", endDate: "2026-07-10",
  type: "vacation", note: "Booked in January",
};
const ABSENCE_AFTER = { ...ABSENCE_BEFORE, assigneeEmail: "ada@new.example", endDate: "2026-07-12", type: "sick", note: "Knee surgery" };

const RESOURCE_BEFORE = { id: 7, firstName: "Ada", lastName: "Lovelace", birthday: "1815-12-10", businessPhone: "+44 1", location: "London", title: "Analyst" };
const RESOURCE_AFTER = { ...RESOURCE_BEFORE, birthday: "1815-12-11", businessPhone: "+44 2", location: "Paris", title: "Lead" };

const STAKEHOLDER_BEFORE = { id: 3, name: "Bo", influence: "Low", interest: "Low", notes: "Hates mornings", role: "Sponsor" };
const STAKEHOLDER_AFTER = { ...STAKEHOLDER_BEFORE, influence: "High", interest: "High", notes: "Prefers e-mail", role: "Owner" };

/** What the model receives from `search_history`, as the chat sends it (`stringifyResult`). */
async function searchHistoryText(log: readonly ActivityEntry[], input: Record<string, unknown> = {}): Promise<string> {
  const d = {
    getActivityLog: () => log,
    isHistorySearchEnabled: () => true,
    isPeopleProtected: () => false,
    getTimezone: () => "UTC",
  } as unknown as ToolDispatcher;
  return stringifyResult(await runTool(d, "search_history", input));
}

describe("search_history leaves out logged changes to withheld fields (AI-05)", () => {
  it("an absence edit changing its type, note and assignee e-mail: none of the old or new values is sent", async () => {
    const log = manualEdit("absence.updated", ABSENCE_BEFORE, ABSENCE_AFTER, 50, "Ada Lovelace", "2026-07-06", "2026-07-12");
    // The stored entry still carries all four changes (the panel and the audit download read it).
    expect(log[0].changes?.map((c) => c.field)).toEqual(["assigneeEmail", "endDate", "note", "type"]);

    const text = await searchHistoryText(log);
    for (const v of ["vacation", "sick", "Booked in January", "Knee surgery", "ada@old.example", "ada@new.example"]) {
      expect(text).not.toContain(v);
    }
    expect(text).not.toMatch(/\b(type|note|assigneeEmail):/);
    // The change that is not withheld, and the summary line, still reach the model.
    expect(text).toContain("endDate: 2026-07-10 → 2026-07-12");
    expect(text).toContain("Absence #50 updated for Ada Lovelace");
  });

  it("a query for a withheld value finds nothing, so the search cannot reveal it either", async () => {
    const log = manualEdit("absence.updated", ABSENCE_BEFORE, ABSENCE_AFTER, 50, "Ada Lovelace", "2026-07-06", "2026-07-12");
    for (const query of ["sick", "surgery", "ada@new"]) {
      expect(JSON.parse(await searchHistoryText(log, { query })).events).toEqual([]);
    }
    expect(JSON.parse(await searchHistoryText(log, { query: "2026-07-12" })).events).toHaveLength(1);
  });

  it("a resource edit changing birthday, phone and location sends only the job title change", async () => {
    const log = manualEdit("resource.updated", RESOURCE_BEFORE, RESOURCE_AFTER, 7, "Ada Lovelace");
    const text = await searchHistoryText(log);
    for (const v of ["1815-12-10", "1815-12-11", "+44 1", "+44 2", "London", "Paris"]) expect(text).not.toContain(v);
    expect(text).toContain("title: Analyst → Lead");
  });

  it("a stakeholder edit changing influence, interest and notes sends only the role change", async () => {
    const log = manualEdit("stakeholder.updated", STAKEHOLDER_BEFORE, STAKEHOLDER_AFTER, 3, "Bo");
    const text = await searchHistoryText(log);
    expect(text).not.toMatch(/\b(influence|interest|notes):/);
    for (const v of ["Hates mornings", "Prefers e-mail", "High"]) expect(text).not.toContain(v);
    expect(text).toContain("role: Sponsor → Owner");
  });

  it("an entry whose only changes are withheld is sent without a detail", async () => {
    const log = manualEdit("absence.updated", ABSENCE_BEFORE, { ...ABSENCE_BEFORE, type: "sick" }, 50, "Ada Lovelace", "2026-07-06", "2026-07-10");
    const [event] = JSON.parse(await searchHistoryText(log)).events;
    expect(event.detail).toBeUndefined();
    expect(event.summary).toBe("Absence #50 updated for Ada Lovelace: 2026-07-06 – 2026-07-10");
  });
});

describe("withheldActivityField — the entity is the kind's prefix", () => {
  it("withholds an entity's own fields and keeps another entity's field of the same name", () => {
    expect(withheldActivityField("absence.updated", "type")).toBe(true);
    expect(withheldActivityField("raid.updated", "type")).toBe(false);
    expect(withheldActivityField("resource.updated", "location")).toBe(true);
    expect(withheldActivityField("calendarEvent.updated", "location")).toBe(false);
  });

  it("withholds e-mail fields and the note log under every kind", () => {
    for (const kind of ["task.updated", "raid.updated", "milestone.updated", "shift.updated", "settings.updated"]) {
      expect(withheldActivityField(kind, "assigneeEmail")).toBe(true);
      expect(withheldActivityField(kind, "toEmail")).toBe(true);
      expect(withheldActivityField(kind, "noteLog")).toBe(true);
    }
  });

  it("withholds every listed field under a kind that names no entity, a prototype name included", () => {
    for (const kind of ["bulk.edit", "shift.updated", "toString.updated", "future", 7]) {
      for (const f of ["note", "notes", "type", "birthday", "influence"]) expect(withheldActivityField(kind, f)).toBe(true);
      expect(withheldActivityField(kind, "status")).toBe(false);
    }
  });
});

describe("the Activity panel still shows the withheld values (storage and the panel are not redacted)", () => {
  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});
  });

  it("renders the absence's old and new type and note", () => {
    const log = manualEdit("absence.updated", ABSENCE_BEFORE, ABSENCE_AFTER, 50, "Ada Lovelace", "2026-07-06", "2026-07-12");
    render(
      <DisplayTimezoneProvider effectiveTz="UTC">
        <ActivityLogPanel lang="en-US" entries={log} onClear={() => {}} />
      </DisplayTimezoneProvider>,
    );
    for (const v of ["vacation", "sick", "Booked in January", "Knee surgery"]) {
      expect(screen.getByText(v)).toBeInTheDocument();
    }
  });
});
