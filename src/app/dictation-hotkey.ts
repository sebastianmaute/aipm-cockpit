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

export function matchesHotkey(
  e: Pick<KeyboardEvent, "key" | "ctrlKey" | "shiftKey" | "altKey" | "metaKey">,
  combo: string,
): boolean {
  if (!combo) return false;
  return eventToCombo(e) === combo;
}
