import { describe, expect, it } from "vitest";
import {
  emptyWorkspace,
  workspaceToCsv,
  csvToWorkspace,
  workspaceToMarkdown,
  markdownToWorkspace,
} from "./storage";
import { ABSENCES_CSV_COLUMNS } from "./csv-codecs-core";
import type { Absence } from "./types";

const absence: Absence = {
  id: 1,
  assignee: "Jane Doe",
  startDate: "2026-01-05",
  endDate: "2026-01-09",
  type: "vacation",
  outlookEventId: "evt-abc",
};

describe("absence outlookEventId round-trip", () => {
  it("survives CSV round-trip", () => {
    const ws = { ...emptyWorkspace(), absences: [absence] };
    const back = csvToWorkspace(workspaceToCsv(ws));
    expect(back.absences).toHaveLength(1);
    expect(back.absences?.[0]?.outlookEventId).toBe("evt-abc");
  });

  it("survives Markdown round-trip", () => {
    const ws = { ...emptyWorkspace(), absences: [absence] };
    const back = markdownToWorkspace(workspaceToMarkdown(ws));
    expect(back.absences).toHaveLength(1);
    expect(back.absences?.[0]?.outlookEventId).toBe("evt-abc");
  });

  it("ABSENCES_CSV_COLUMNS ends with outlookEventId", () => {
    expect(ABSENCES_CSV_COLUMNS[ABSENCES_CSV_COLUMNS.length - 1]).toBe("outlookEventId");
  });
});
