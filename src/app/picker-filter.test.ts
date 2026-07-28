import { describe, expect, it } from "vitest";
import { filterPickerOptions } from "./picker-filter";

interface Row {
  id: number;
  name: string;
}
const ROWS: readonly Row[] = [
  { id: 1, name: "Draft the API spec" },
  { id: 2, name: "Review the API docs" },
  { id: 3, name: "Ship the release" },
];
const base = {
  excludeIds: new Set<number>(),
  getId: (r: Row) => r.id,
  getText: (r: Row) => r.name,
};

describe("filterPickerOptions", () => {
  it("matches a * wildcard across the text", () => {
    const out = filterPickerOptions(ROWS, { ...base, query: "api*docs" });
    expect(out.map((r) => r.id)).toEqual([2]);
  });

  it("leaves a query without * as a plain substring match", () => {
    const out = filterPickerOptions(ROWS, { ...base, query: "api" });
    expect(out.map((r) => r.id)).toEqual([1, 2]);
  });

  it("still short-circuits on an exact id and still drops excluded ids", () => {
    expect(filterPickerOptions(ROWS, { ...base, query: "3" }).map((r) => r.id)).toEqual([3]);
    const out = filterPickerOptions(ROWS, { ...base, query: "api", excludeIds: new Set([1]) });
    expect(out.map((r) => r.id)).toEqual([2]);
  });
});
