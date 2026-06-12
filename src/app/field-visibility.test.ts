// src/app/field-visibility.test.ts
import { describe, expect, it } from "vitest";
import {
  applyTier, sanitizeFieldVisibility, tierFields, tierOf, toggleField, visibleFields,
} from "./field-visibility";

describe("tierFields", () => {
  it("nests: advanced includes simple, full includes advanced", () => {
    const s = new Set(tierFields("milestone", "simple"));
    const a = new Set(tierFields("milestone", "advanced"));
    const f = new Set(tierFields("milestone", "full"));
    for (const x of s) expect(a.has(x)).toBe(true);
    for (const x of a) expect(f.has(x)).toBe(true);
    expect(s.has("name")).toBe(true);
    expect(s.has("description")).toBe(false);
    expect(a.has("description")).toBe(true);
    expect(f.has("documentLinks")).toBe(true);
  });
});

describe("visibleFields", () => {
  it("defaults to Advanced when config is undefined", () => {
    const vis = visibleFields("milestone", undefined);
    expect(vis.has("description")).toBe(true);
    expect(vis.has("documentLinks")).toBe(false);
  });
  it("uses the stored field set and drops unknown ids", () => {
    const vis = visibleFields("milestone", { fields: ["name", "ghost"] });
    expect(vis.has("name")).toBe(true);
    expect(vis.has("ghost")).toBe(false);
    expect(vis.has("targetDate")).toBe(false);
  });
});

describe("applyTier / tierOf", () => {
  it("applyTier produces a config whose tierOf is that tier", () => {
    const cfg = applyTier("milestone", "simple");
    expect(tierOf("milestone", cfg)).toBe("simple");
  });
  it("tierOf(undefined) is advanced (the default)", () => {
    expect(tierOf("milestone", undefined)).toBe("advanced");
  });
});

describe("toggleField", () => {
  it("removing a field from advanced yields custom", () => {
    const adv = applyTier("milestone", "advanced");
    const cfg = toggleField("milestone", adv, "description");
    expect(cfg.fields).not.toContain("description");
    expect(tierOf("milestone", cfg)).toBe("custom");
  });
  it("required fields cannot be toggled off", () => {
    const cfg = toggleField("milestone", applyTier("milestone", "simple"), "name");
    expect(cfg.fields).toContain("name");
  });
  it("re-adding a removed field snaps back to the named tier", () => {
    const adv = applyTier("milestone", "advanced");
    const removed = toggleField("milestone", adv, "description");
    const restored = toggleField("milestone", removed, "description");
    expect(tierOf("milestone", restored)).toBe("advanced");
  });
});

describe("sanitizeFieldVisibility", () => {
  it("returns undefined for junk / empty (byte-stability)", () => {
    expect(sanitizeFieldVisibility(undefined)).toBeUndefined();
    expect(sanitizeFieldVisibility(null)).toBeUndefined();
    expect(sanitizeFieldVisibility("x")).toBeUndefined();
    expect(sanitizeFieldVisibility({})).toBeUndefined();
  });
  it("keeps known modals/fields, drops unknown, always re-adds required", () => {
    const out = sanitizeFieldVisibility({
      milestone: { fields: ["targetDate", "ghost"] },
      nope: { fields: ["x"] },
    });
    expect(out).toBeDefined();
    expect(out!.milestone.fields).toContain("name");
    expect(out!.milestone.fields).toContain("targetDate");
    expect(out!.milestone.fields).not.toContain("ghost");
    expect(out!.nope).toBeUndefined();
  });
});
