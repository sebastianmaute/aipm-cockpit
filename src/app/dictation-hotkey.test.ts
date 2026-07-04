import { describe, it, expect } from "vitest";
import {
  eventToCombo,
  matchesHotkey,
  mouseButtonToToken,
  eventComboFromMouse,
  isMouseCombo,
} from "./dictation-hotkey";

const ev = (o: Partial<KeyboardEvent>) =>
  ({ key: "", ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...o }) as KeyboardEvent;

const mouseEv = (o: Partial<MouseEvent>) =>
  ({ button: 0, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...o }) as MouseEvent;

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

  describe("mouseButtonToToken", () => {
    it("maps back/forward/middle side-buttons", () => {
      expect(mouseButtonToToken(3)).toBe("Mouse4");
      expect(mouseButtonToToken(4)).toBe("Mouse5");
      expect(mouseButtonToToken(1)).toBe("Mouse3");
    });
    it("rejects left/right (never steals native click/context-menu)", () => {
      expect(mouseButtonToToken(0)).toBeNull();
      expect(mouseButtonToToken(2)).toBeNull();
    });
  });

  describe("eventComboFromMouse", () => {
    it("serializes a bare Back button press", () => {
      expect(eventComboFromMouse(mouseEv({ button: 3 }))).toBe("Mouse4");
    });
    it("prefixes modifiers in Ctrl/Meta/Alt/Shift order", () => {
      expect(eventComboFromMouse(mouseEv({ button: 3, ctrlKey: true }))).toBe("Ctrl+Mouse4");
    });
    it("returns null for a non-capturable button", () => {
      expect(eventComboFromMouse(mouseEv({ button: 0 }))).toBeNull();
      expect(eventComboFromMouse(mouseEv({ button: 2 }))).toBeNull();
    });
  });

  describe("isMouseCombo", () => {
    it("recognizes a mouse combo", () => {
      expect(isMouseCombo("Mouse4")).toBe(true);
      expect(isMouseCombo("Ctrl+Mouse5")).toBe(true);
    });
    it("rejects a keyboard combo", () => {
      expect(isMouseCombo("F4")).toBe(false);
      expect(isMouseCombo("Ctrl+Shift+D")).toBe(false);
    });
  });

  describe("matchesHotkey with mouse events", () => {
    it("matches the configured mouse button", () => {
      expect(matchesHotkey(mouseEv({ button: 3 }), "Mouse4")).toBe(true);
    });
    it("rejects a different mouse button", () => {
      expect(matchesHotkey(mouseEv({ button: 4 }), "Mouse4")).toBe(false);
    });
  });
});
