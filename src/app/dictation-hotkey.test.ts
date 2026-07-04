import { describe, it, expect } from "vitest";
import { eventToCombo, matchesHotkey } from "./dictation-hotkey";

const ev = (o: Partial<KeyboardEvent>) =>
  ({ key: "", ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...o }) as KeyboardEvent;

describe("dictation-hotkey", () => {
  it("serializes F4", () => {
    expect(eventToCombo(ev({ key: "F4" }))).toBe("F4");
  });
  it("serializes a chord", () => {
    expect(eventToCombo(ev({ key: "d", ctrlKey: true, shiftKey: true }))).toBe("Ctrl+Shift+D");
  });
  it("ignores a bare modifier key", () => {
    expect(eventToCombo(ev({ key: "Shift", shiftKey: true }))).toBe("Shift");
  });
  it("matches", () => {
    expect(matchesHotkey(ev({ key: "F4" }), "F4")).toBe(true);
    expect(matchesHotkey(ev({ key: "F5" }), "F4")).toBe(false);
  });
});
