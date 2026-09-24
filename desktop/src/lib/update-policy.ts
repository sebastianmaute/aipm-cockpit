// What the updater does, decided without Electron so it is unit-testable (the wiring is
// desktop/src/updater.ts). Spec: docs/superpowers/specs/2026-09-24-releases-and-updates-design.md §2.
export const STARTUP_CHECK_DELAY_MS = 10_000;
const NOTES_MAX = 1500;
const ERROR_MAX = 300;

export type UpdateTrigger = "startup" | "manual";
export type UpdateDecision =
  | { kind: "silent" }
  | { kind: "prompt"; version: string; notes: string }
  | { kind: "up-to-date" }
  | { kind: "error"; message: string };

export function shouldStartCheck(inFlight: boolean): boolean {
  return !inFlight;
}

export function decideOnAvailable(
  trigger: UpdateTrigger,
  available: { version: string; releaseNotes?: unknown },
  skipped: string | null,
): UpdateDecision {
  if (trigger === "startup" && skipped === available.version) return { kind: "silent" };
  return { kind: "prompt", version: available.version, notes: notesToPlainText(available.releaseNotes) };
}

export function decideOnNotAvailable(trigger: UpdateTrigger): UpdateDecision {
  return trigger === "manual" ? { kind: "up-to-date" } : { kind: "silent" };
}

export function decideOnError(trigger: UpdateTrigger, err: unknown): UpdateDecision {
  if (trigger !== "manual") return { kind: "silent" };
  return { kind: "error", message: clip(err instanceof Error ? err.message : String(err), ERROR_MAX) };
}

function clip(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

export function notesToPlainText(notes: unknown, max = NOTES_MAX): string {
  const raw = Array.isArray(notes)
    ? notes.map((n) => (n && typeof n === "object" && "note" in n ? String((n as { note: unknown }).note ?? "") : "")).join("\n")
    : typeof notes === "string"
      ? notes
      : "";
  const text = raw
    .replace(/<\/(p|li|h[1-6]|div)>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .split("\n").map((l) => l.trim()).join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text === "" ? "No release notes." : clip(text, max);
}

export function parseSkipped(text: string | null): string | null {
  if (text === null) return null;
  try {
    const v = (JSON.parse(text) as { skippedVersion?: unknown }).skippedVersion;
    return typeof v === "string" ? v : null;
  } catch {
    return null;
  }
}

export function serializeSkipped(version: string): string {
  return JSON.stringify({ skippedVersion: version });
}
