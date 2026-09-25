import { describe, expect, it } from "vitest";
import { pickAutoUpdater } from "./electron-updater-loader";

describe("pickAutoUpdater", () => {
  it("returns a named autoUpdater export directly", () => {
    const fake = {};
    expect(pickAutoUpdater({ autoUpdater: fake })).toBe(fake);
  });

  it("falls back to .default.autoUpdater when there is no named export", () => {
    // The real electron-updater shape today -- see electron-updater-loader.ts's doc comment and
    // updater-module-shape.test.ts, which pins it against the actual installed package.
    const fake = {};
    expect(pickAutoUpdater({ default: { autoUpdater: fake } })).toBe(fake);
  });

  it("prefers a named export over .default when somehow both exist", () => {
    const named = {};
    const fromDefault = {};
    expect(pickAutoUpdater({ autoUpdater: named, default: { autoUpdater: fromDefault } })).toBe(named);
  });

  it("throws a clear, actionable error when neither shape has it", () => {
    expect(() => pickAutoUpdater({})).toThrow(/electron-updater/);
    expect(() => pickAutoUpdater({ default: {} })).toThrow(/electron-updater/);
    expect(() => pickAutoUpdater(null)).toThrow(/electron-updater/);
    expect(() => pickAutoUpdater(undefined)).toThrow(/electron-updater/);
    expect(() => pickAutoUpdater("not an object")).toThrow(/electron-updater/);
  });
});
