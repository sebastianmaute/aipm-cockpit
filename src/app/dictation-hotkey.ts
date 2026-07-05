/** A hotkey combo string like "F4" or "Ctrl+Shift+D". Serialize from a KeyboardEvent. */
export function eventToCombo(e: Pick<KeyboardEvent, "key" | "ctrlKey" | "shiftKey" | "altKey" | "metaKey">): string {
  const parts: string[] = [];
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.metaKey) parts.push("Meta");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  const k = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  if (!["Control", "Meta", "Alt", "Shift"].includes(k)) parts.push(k);
  return parts.join("+");
}

/** Maps a DOM `MouseEvent.button` to a combo token, or null when that button isn't
 *  capturable as a hotkey. Only the middle button (1→"Mouse3") and the Back/Forward
 *  side-buttons (3→"Mouse4", 4→"Mouse5") are capturable — left(0)/right(2) always
 *  keep their native click/context-menu behavior. */
export function mouseButtonToToken(button: number): string | null {
  if (button === 1) return "Mouse3";
  if (button === 3) return "Mouse4";
  if (button === 4) return "Mouse5";
  return null;
}

/** Serializes a mouse-button press (+ modifiers) into a combo string, mirroring
 *  `eventToCombo`'s Ctrl/Meta/Alt/Shift ordering. Null when the button isn't capturable. */
export function eventComboFromMouse(
  e: Pick<MouseEvent, "button" | "ctrlKey" | "shiftKey" | "altKey" | "metaKey">,
): string | null {
  const token = mouseButtonToToken(e.button);
  if (!token) return null;
  const parts: string[] = [];
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.metaKey) parts.push("Meta");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  parts.push(token);
  return parts.join("+");
}

/** True when a combo's final segment is a mouse token (i.e. it was captured off a mouse button). */
export function isMouseCombo(combo: string): boolean {
  const last = combo.split("+").pop() ?? "";
  return last.startsWith("Mouse");
}

export function matchesHotkey(
  e:
    | Pick<KeyboardEvent, "key" | "ctrlKey" | "shiftKey" | "altKey" | "metaKey">
    | Pick<MouseEvent, "button" | "ctrlKey" | "shiftKey" | "altKey" | "metaKey">,
  combo: string,
): boolean {
  if (!combo) return false;
  if (!("key" in e) && "button" in e && typeof e.button === "number") {
    return eventComboFromMouse(e) === combo;
  }
  return eventToCombo(e as Pick<KeyboardEvent, "key" | "ctrlKey" | "shiftKey" | "altKey" | "metaKey">) === combo;
}
