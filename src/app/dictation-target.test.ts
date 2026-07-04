import { describe, it, expect, beforeEach } from "vitest";
import { setActiveDictationTarget, getActiveDictationTarget, clearDictationTargetIf } from "./dictation-target";

beforeEach(() => setActiveDictationTarget(null));

describe("dictation-target", () => {
  it("set/get the active target", () => {
    const t = { press: () => {}, release: () => {}, label: "Notes" };
    setActiveDictationTarget(t);
    expect(getActiveDictationTarget()).toBe(t);
  });
  it("clearDictationTargetIf clears only when it is the active one", () => {
    const a = { press: () => {}, release: () => {}, label: "A" };
    const b = { press: () => {}, release: () => {}, label: "B" };
    setActiveDictationTarget(a);
    clearDictationTargetIf(b);
    expect(getActiveDictationTarget()).toBe(a);
    clearDictationTargetIf(a);
    expect(getActiveDictationTarget()).toBeNull();
  });
});
