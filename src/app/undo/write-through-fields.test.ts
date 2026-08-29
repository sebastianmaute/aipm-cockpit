import { describe, it, expect } from "vitest";
import { WRITE_THROUGH_FIELDS, WRITE_THROUGH_KEYS } from "./write-through-fields";

describe("write-through fields", () => {
  it("names the two fields a concurrent writer can set without an undo entry", () => {
    expect(WRITE_THROUGH_FIELDS).toEqual(["noteLog", "outlookEventId"]);
  });

  // The whole point of the module: the Set is DERIVED, so the two views cannot
  // drift the way the two hand-maintained copies could. Mutation that proves it:
  // hardcode the Set to a different literal — this goes red, and nothing else does.
  it("derives the key set from the tuple rather than restating it", () => {
    expect([...WRITE_THROUGH_KEYS].sort()).toEqual([...WRITE_THROUGH_FIELDS].sort());
    expect(WRITE_THROUGH_KEYS.size).toBe(WRITE_THROUGH_FIELDS.length);
  });
});
