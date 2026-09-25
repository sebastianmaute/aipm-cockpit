// What the updater does, decided without Electron so it is unit-testable (the wiring is
// desktop/src/updater.ts). Spec: docs/superpowers/specs/2026-09-24-releases-and-updates-design.md §2.
export const STARTUP_CHECK_DELAY_MS = 10_000;
const NOTES_MAX = 1500;
const ERROR_MAX = 300;

export type UpdateTrigger = "startup" | "manual";
// The updater has exactly two long-running operations that can fail: asking the feed whether an
// update exists, and pulling the installer bytes down. Fix round 1 (review R11): a download failure
// was reported using whatever `trigger` the CHECK started with, so a startup-triggered download (the
// user clicked "Download and install" after a silent startup prompt) failed in total silence. The
// phase, not the trigger, decides whether a download error is shown -- see decideOnError.
export type UpdatePhase = "checking" | "downloading";
export type UpdateDecision =
  | { kind: "silent" }
  | { kind: "prompt"; version: string; notes: string }
  | { kind: "up-to-date" }
  | { kind: "error"; phase: UpdatePhase; message: string };

// What a new check request should do given what the updater is already doing. Replaces the old
// `shouldStartCheck(inFlight: boolean): boolean`, which only ever dropped a redundant request with a
// log line -- silently, even for a MANUAL request, which is the request a user is actively waiting on
// (fix round 1, review R11 Important 3 and Minor 1).
export interface UpdaterActivity {
  checking: boolean;
  downloading: boolean;
  // Whether one of the updater's OWN dialogs (available/ready/error/up-to-date/busy) is on screen
  // right now. Deliberately not scoped to just the "Update available" prompt Minor 1 named -- any of
  // updater.ts's dialogs being open makes a second one redundant for the same reason.
  prompting: boolean;
}
export type CheckRequestDecision = "start" | "promote" | "downloading" | "prompting";

export function decideCheckRequest(activity: UpdaterActivity): CheckRequestDecision {
  // Order matters: a dialog on screen already reflects the most recent outcome (including a
  // "downloading" one), so it wins over the "downloading" state below.
  if (activity.prompting) return "prompting";
  if (activity.downloading) return "downloading";
  if (activity.checking) return "promote";
  return "start";
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

// A CHECKING-phase error stays silent for a startup trigger, same as before. A DOWNLOADING-phase
// error is shown regardless of trigger: the user already clicked "Download and install" to get here,
// so silence is never correct once bytes were meant to move -- see the UpdatePhase doc comment above.
export function decideOnError(trigger: UpdateTrigger, phase: UpdatePhase, err: unknown): UpdateDecision {
  if (phase === "checking" && trigger !== "manual") return { kind: "silent" };
  return { kind: "error", phase, message: summarizeError(err) };
}

// One readable line, bounded, from whatever an error-ish value actually is -- never the raw thing.
// Fix round 3: electron-updater's own `HttpError` (builder-util-runtime's httpExecutor.js
// `createHttpError`) builds its `.message` as `"{status} {statusText}\n{description}\nHeaders:
// {...}"`, and that headers dump includes response `set-cookie` values verbatim (measured against a
// real 404 from a private GitHub repo's releases feed -- see task-6-report.md's fix-round-2 evidence,
// which is exactly the multi-line dump this function now trims away). The FIRST LINE is always the
// short, human status summary; everything after it is diagnostic detail nobody asked to see in a
// dialog or a log line, and in electron-updater's own case sometimes third-party response headers.
// Used both for `decideOnError`'s dialog-facing message and by updater.ts's raw logger.warn/error
// wrappers, so the same trimming applies wherever an error-ish value might otherwise print its own
// headers/stack into launch.log.
export function summarizeError(err: unknown, max = ERROR_MAX): string {
  const raw = err instanceof Error ? err.message : String(err);
  return clip(firstLine(raw), max);
}

function firstLine(s: string): string {
  const nl = s.indexOf("\n");
  return (nl === -1 ? s : s.slice(0, nl)).trim();
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  let end = max - 1; // room for the trailing ellipsis
  // Don't cut a surrogate pair in half: back off one more code unit when the character just before
  // the cut is a high surrogate, or the pair's low half would be dropped and a lone high surrogate
  // would be left dangling at the end of the clipped string (fix round 1, review R11 Minor 3).
  if (end > 0 && isHighSurrogate(s.charCodeAt(end - 1))) end -= 1;
  return `${s.slice(0, end)}…`;
}

function decodeNumericEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec: string) => String.fromCodePoint(Number(dec)));
}

export function notesToPlainText(notes: unknown, max = NOTES_MAX): string {
  const raw = Array.isArray(notes)
    ? notes.map((n) => (n && typeof n === "object" && "note" in n ? String((n as { note: unknown }).note ?? "") : "")).join("\n")
    : typeof notes === "string"
      ? notes
      : "";
  const text = decodeNumericEntities(
    raw
      // Drop <script>/<style> blocks WITH their contents -- the generic tag-strip below only removes
      // the TAGS, which would otherwise leave a script body's text (e.g. `alert(1)`) sitting in the
      // "plain text" output (fix round 1, review R11 Minor 3).
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<\/(p|li|h[1-6]|div)>|<br\s*\/?>/gi, "\n")
      .replace(/<[^>]*>/g, "")
      .replace(/&nbsp;/gi, " ")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"'),
  )
    // &amp; decodes LAST, after every other named/numeric entity: a source string genuinely meaning
    // the literal text "&lt;" is escaped upstream as "&amp;lt;", and decoding &amp; first would turn
    // that into "&lt;" in time to be caught by the &lt; replace above and double-decoded into "<"
    // (fix round 1, review R11 Minor 3).
    .replace(/&amp;/g, "&")
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
