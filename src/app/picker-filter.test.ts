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

describe("filterPickerOptions — # id queries", () => {
  const HASH_ROWS: readonly Row[] = [
    { id: 1, name: "Draft the API spec" },
    { id: 2, name: "Review the API docs" },
    { id: 4, name: "Fix #42 crash" },
    // Carries the bare digits with no `#` — discriminates the stripped id
    // query from the raw query in the text matcher (see the "#42" test).
    { id: 5, name: "Meeting 42 notes" },
  ];

  it("matches an id written with a leading #", () => {
    const out = filterPickerOptions(HASH_ROWS, { ...base, query: "#2" });
    expect(out.map((r) => r.id)).toEqual([2]);
  });

  it("does not treat a bare # as an empty query", () => {
    // The strip leaves "" for the id compare, which must match no id. The row
    // that comes back does so via the TEXT matcher, not the id one.
    const out = filterPickerOptions(HASH_ROWS, { ...base, query: "#" });
    expect(out.map((r) => r.id)).toEqual([4]);
  });

  it("falls through to the text matcher when the stripped id matches nothing, using the RAW query", () => {
    // Row 5 carries "42" (no #) — it must NOT match, which proves the text
    // matcher runs against the raw "#42" query and not the stripped "42".
    const out = filterPickerOptions(HASH_ROWS, { ...base, query: "#42" });
    expect(out.map((r) => r.id)).toEqual([4]);
  });
});
