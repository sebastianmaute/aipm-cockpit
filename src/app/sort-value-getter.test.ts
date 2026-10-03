import { describe, expect, it } from "vitest";
import { sortValueGetter } from "./sort-value-getter";

type Row = { title: string; age: number };

describe("sortValueGetter", () => {
  it("answers each key with that key's accessor", () => {
    const get = sortValueGetter<Row, "name" | "age">({ name: (r) => r.title, age: (r) => r.age });
    const row = { title: "Alpha", age: 7 };
    expect(get(row, "name")).toBe("Alpha");
    expect(get(row, "age")).toBe(7);
  });

  it("requires an accessor for every key", () => {
    // @ts-expect-error — "age" has no accessor, which is the point of the factory.
    sortValueGetter<Row, "name" | "age">({ name: (r) => r.title });
  });
});
