import { describe, expect, it } from "vitest";
import { matchesSchema, withStrictTool } from "./ai-tool-schema";

describe("matchesSchema", () => {
  it.each([
    ["a string", { type: "string" }, "x", true],
    ["a number for a string", { type: "string" }, 4, false],
    ["a finite number", { type: "number" }, 1.5, true],
    ["NaN for a number", { type: "number" }, Number.NaN, false],
    ["an integer", { type: "integer" }, 3, true],
    ["a fraction for an integer", { type: "integer" }, 3.5, false],
    ["a boolean", { type: "boolean" }, false, true],
    ["a string for a boolean", { type: "boolean" }, "false", false],
    ["an array for an object", { type: "object" }, [], false],
    ["null for an object", { type: "object" }, null, false],
    ["a string for an array", { type: "array", items: { type: "string" } }, "a", false],
    ["an array without an items schema", { type: "array" }, [1, "a"], true],
    ["a value in the enum", { type: "string", enum: ["a", "b"] }, "b", true],
    ["a value outside the enum", { type: "string", enum: ["a", "b"] }, "c", false],
    ["any value for a type it does not check", { type: "null" }, 7, true],
    ["any value for no schema", undefined, 7, true],
  ])("%s → %s", (_label, schema, value, expected) => {
    expect(matchesSchema(value, schema)).toBe(expected);
  });

  it("allows keys the schema does not list, and an optional key left out", () => {
    const schema = { type: "object", properties: { a: { type: "string" }, b: { type: "integer" } }, required: ["a"] };
    expect(matchesSchema({ a: "x", extra: 1 }, schema)).toBe(true);
    expect(matchesSchema({ a: "x", b: "2" }, schema)).toBe(false);
  });
});

// §782 — `propose_insight_actions` offers one `anyOf` branch per tool, and both
// helpers used to skip the keyword: a per-tool mismatch matched, and the strict
// form left every branch object open, which the API refuses.
describe("anyOf", () => {
  const union = {
    anyOf: [
      { type: "object", properties: { name: { type: "string", enum: ["a"] }, n: { type: "number" } }, required: ["name", "n"] },
      { type: "object", properties: { name: { type: "string", enum: ["b"] }, s: { type: "string" } }, required: ["name", "s"] },
    ],
  };

  it("matches a value that fits one branch, and refuses one that fits none", () => {
    expect(matchesSchema({ name: "a", n: 1 }, union)).toBe(true);
    expect(matchesSchema({ name: "b", s: "x" }, union)).toBe(true);
    expect(matchesSchema({ name: "a", s: "x" }, union)).toBe(false);
    expect(matchesSchema("a", union)).toBe(false);
  });

  it("closes every branch object in the strict form", () => {
    const [out] = withStrictTool([{ name: "t", input_schema: { type: "object", properties: { c: { type: "array", items: union } } } }], "t") as [
      { input_schema: { properties: { c: { items: { anyOf: { additionalProperties?: unknown }[] } } } } },
    ];
    expect(out.input_schema.properties.c.items.anyOf.map((b) => b.additionalProperties)).toEqual([false, false]);
    expect(union.anyOf[0]).not.toHaveProperty("additionalProperties"); // the source is not edited
  });
});

describe("withStrictTool", () => {
  it("closes every object of the named tool, nested in properties and items, and keeps the other entries", () => {
    const named = {
      name: "t",
      input_schema: { type: "object", properties: { list: { type: "array", items: { type: "object", properties: { n: { type: "string" } } } } } },
    };
    const other = { name: "u", input_schema: { type: "object" } };
    const out = withStrictTool([named, other, "not a tool"], "t");
    expect(out).toEqual([
      {
        name: "t",
        strict: true,
        input_schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            list: { type: "array", items: { type: "object", additionalProperties: false, properties: { n: { type: "string" } } } },
          },
        },
      },
      other,
      "not a tool",
    ]);
    expect(named.input_schema).not.toHaveProperty("additionalProperties");
  });
});
