import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isJsonFile, parseNativeWorkspace } from "./native-workspace-import";

const sample = readFileSync(join(import.meta.dirname, "..", "..", "sample-workspace-small.json"), "utf8");

describe("parseNativeWorkspace", () => {
  it("recognises the repo sample as a workspace", () => {
    const r = parseNativeWorkspace(sample);
    expect(r.kind).toBe("workspace");
    if (r.kind === "workspace") expect(r.workspace.tasks.length).toBeGreaterThan(0);
  });
  it("calls arbitrary JSON not-a-workspace (it goes to Claude)", () => {
    expect(parseNativeWorkspace('{"invoice": 42}').kind).toBe("not-workspace");
    expect(parseNativeWorkspace("[1,2,3]").kind).toBe("not-workspace");
  });
  it("calls a `tasks`-only object (no `raid`) not-a-workspace, not invalid", () => {
    // Mutation record: dropping the `"raid" in parsed` conjunct still leaves
    // the two arbitrary-JSON cases above green (neither carries a `tasks`
    // key), so this case is what actually kills that mutant — without it,
    // `{"tasks": []}` would reach the strict decoder, which throws on the
    // missing `raid` array and turns this into `invalid`/"shape" instead.
    expect(parseNativeWorkspace('{"tasks": []}').kind).toBe("not-workspace");
  });
  it("calls unparseable text invalid", () => {
    expect(parseNativeWorkspace("{not json")).toEqual({ kind: "invalid", reason: "parse" });
  });
  it("calls a workspace-shaped object with a broken slice invalid", () => {
    expect(parseNativeWorkspace('{"tasks": [], "raid": 7}')).toEqual({ kind: "invalid", reason: "shape" });
  });
});

describe("isJsonFile", () => {
  it("matches by extension or MIME", () => {
    expect(isJsonFile({ name: "a.JSON", type: "" })).toBe(true);
    expect(isJsonFile({ name: "noext", type: "application/json" })).toBe(true);
    expect(isJsonFile({ name: "a.txt", type: "text/plain" })).toBe(false);
  });
});
