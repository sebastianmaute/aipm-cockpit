import { describe, expect, test } from "vitest";
import { pickMatchableResources } from "./timelog-matchable";
import type { Resource } from "./types";

const res = (id: number, firstName: string, isExternal?: boolean): Resource => ({
  id, firstName, lastName: "R", roleId: 3, isExternal, utilizationMode: "percent", utilization: {},
});

describe("pickMatchableResources", () => {
  test("drops externals and keeps everyone else", () => {
    const out = pickMatchableResources([res(1, "Ina"), res(2, "Ext", true), res(3, "Ilse")]);
    expect(out.map((r) => r.firstName)).toEqual(["Ina", "Ilse"]);
  });

  test("keeps a resource whose isExternal is absent (the common shape)", () => {
    // `isExternal` is optional on `Resource`, so an undefined must read as
    // INTERNAL — a truthiness check the other way round would empty the
    // directory and silently withhold every booking from the apply plan.
    expect(pickMatchableResources([res(1, "Ina")])).toHaveLength(1);
  });

  test("keeps an explicit isExternal: false", () => {
    expect(pickMatchableResources([res(1, "Ina", false)])).toHaveLength(1);
  });

  test("does not mutate the input array", () => {
    const input = [res(1, "Ina"), res(2, "Ext", true)];
    pickMatchableResources(input);
    expect(input).toHaveLength(2);
  });

  test("returns an empty list for an empty directory", () => {
    expect(pickMatchableResources([])).toEqual([]);
  });
});
