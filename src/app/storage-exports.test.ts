import { describe, it, expect } from "vitest";
import {
  CSV_COLUMNS, RAID_CSV_COLUMNS, RESOURCES_CSV_COLUMNS, BUDGETS_CSV_COLUMNS,
  ROLES_CSV_COLUMNS, REF_CSV_COLUMNS, ABSENCES_CSV_COLUMNS, SHIFTS_CSV_COLUMNS,
  resourceFieldToString, buildTaskFromObj, buildRaidItemFromObj,
} from "./storage";

describe("storage CSV building blocks are exported", () => {
  it("exposes non-empty column arrays", () => {
    for (const cols of [CSV_COLUMNS, RAID_CSV_COLUMNS, RESOURCES_CSV_COLUMNS, BUDGETS_CSV_COLUMNS, ROLES_CSV_COLUMNS, REF_CSV_COLUMNS, ABSENCES_CSV_COLUMNS, SHIFTS_CSV_COLUMNS]) {
      expect(Array.isArray(cols) && cols.length > 0).toBe(true);
    }
    expect(REF_CSV_COLUMNS).toEqual(["id", "name", "localModifiedAt"]);
  });
  it("resourceFieldToString encodes utilization via the period-map encoder", () => {
    const r = { id: 1, firstName: "A", lastName: "B", roleId: null, utilizationMode: "percent" as const, utilization: { "2026-02": 100 } };
    expect(resourceFieldToString(r as never, "utilization")).toBe("2026-02=100");
  });
  it("row builders accept Record<string,string> and round-trip ids", () => {
    expect(buildTaskFromObj({ id: "1", taskName: "T", assignee: "", assigneeEmail: "", dueDate: "2026-06-01", lastUpdateDate: "2026-06-01", priority: "Medium", blockers: "", notes: "" })?.id).toBe(1);
    expect(buildRaidItemFromObj({ id: "1", category: "R", title: "X", status: "Open", raisedDate: "2026-06-01" })?.id).toBe(1);
  });
});
