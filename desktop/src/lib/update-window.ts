// The "Update available" window: a small page showing the release notes in a SCROLLING box, with
// the same three choices the native message box offered. A native box cannot scroll, so a real
// changelog ran off the bottom of the screen. Pure (no Electron) so it is unit-testable; the window
// itself is created in desktop/src/updater.ts.
//
// ★★ HOW A CLICK REACHES THE MAIN PROCESS. The page has no preload and no IPC. A button sets
// `document.title` to `aipm-update:<choice>`, and updater.ts reads it from the window's
// `page-title-updated` event. A link to a custom scheme was the other candidate and was rejected:
// every WebContents in this shell gets main.ts's `will-navigate` guard, and an unknown-scheme link
// is not guaranteed to reach `will-navigate` at all.
// ★ The one inline script is allowed by its SHA-256 hash, not by 'unsafe-inline', under
// `default-src 'none'`. The notes arrive as `SafeNotesHtml` from release-notes-html.ts, which writes
// only its own attribute-free tags and escapes every text run, so nothing in a release body can add
// markup, attributes or script.
import { createHash } from "node:crypto";
import { escapeHtml, type SafeNotesHtml } from "./release-notes-html";

export { escapeHtml };

export type UpdateChoice = "download" | "later" | "skip";

const CHOICE_PREFIX = "aipm-update:";
const CHOICES: readonly UpdateChoice[] = ["download", "later", "skip"];

const SCRIPT =
  'document.querySelectorAll("button[data-choice]").forEach(function (b) {' +
  ' b.addEventListener("click", function () { document.title = "' + CHOICE_PREFIX + '" + b.getAttribute("data-choice"); });' +
  " });" +
  ' document.addEventListener("keydown", function (e) { if (e.key === "Escape") document.title = "' + CHOICE_PREFIX + 'later"; });';

const SCRIPT_HASH = createHash("sha256").update(SCRIPT, "utf8").digest("base64");

/** Shown above the buttons: installing replaces the running app, and nothing is visible meanwhile. */
export const UPDATE_DURATION_HINT =
  "Downloading and installing takes a few minutes. The download runs in the background, with its progress on the taskbar icon. While the update installs, the app closes and nothing is visible for a while, so it may seem frozen: please wait, and do not start it again.";

/** The whole page. `notesHtml` is inserted as is, which is why it must come from notesToSafeHtml. */
export function buildUpdatePromptHtml({ version, notesHtml }: { version: string; notesHtml: SafeNotesHtml }): string {
  const v = escapeHtml(version);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'sha256-${SCRIPT_HASH}'">
<title>Update available</title>
<style>
:root { color-scheme: light dark; font-family: "Segoe UI", system-ui, sans-serif; }
html, body { height: 100%; margin: 0; background: Canvas; color: CanvasText; }
main { box-sizing: border-box; display: flex; flex-direction: column; gap: 12px; height: 100%; padding: 16px 20px; }
h1 { margin: 0; font-size: 15px; font-weight: 600; }
h2 { margin: 0; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: GrayText; }
.notes { flex: 1; min-height: 0; overflow-y: auto; margin: 0; padding: 10px 12px; border: 1px solid GrayText; border-radius: 6px; overflow-wrap: anywhere; font-size: 13px; line-height: 1.45; }
.notes > :first-child { margin-top: 0; }
.notes h3 { margin: 14px 0 6px; font-size: 14px; font-weight: 600; }
.notes h4 { margin: 12px 0 4px; font-size: 13px; font-weight: 600; }
.notes p { margin: 0 0 8px; }
.notes ul, .notes ol { margin: 0 0 8px; padding-left: 20px; }
.notes li { margin: 0 0 6px; }
.notes li > p { margin: 0 0 4px; }
.notes code, .notes pre { font-family: Consolas, "Cascadia Mono", monospace; font-size: 12px; }
.notes pre { margin: 0 0 8px; white-space: pre-wrap; }
.notes blockquote { margin: 0 0 8px; padding-left: 10px; border-left: 3px solid GrayText; }
.notes hr { border: 0; border-top: 1px solid GrayText; margin: 12px 0; }
.notes .plain { white-space: pre-wrap; }
.hint { margin: 0; font-size: 12px; line-height: 1.4; }
.buttons { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
button { font: inherit; font-size: 13px; padding: 6px 14px; }
</style>
</head>
<body>
<main>
<h1>AI PM Cockpit ${v} is available.</h1>
<h2 id="notes-title">Release notes</h2>
<div class="notes" tabindex="0" role="region" aria-labelledby="notes-title">${notesHtml}</div>
<p class="hint">${escapeHtml(UPDATE_DURATION_HINT)}</p>
<div class="buttons">
<button type="button" data-choice="download" autofocus>Download and install</button>
<button type="button" data-choice="later">Later</button>
<button type="button" data-choice="skip">Skip this version</button>
</div>
</main>
<script>${SCRIPT}</script>
</body>
</html>`;
}

/** The page as a URL `BrowserWindow.loadURL` accepts. Base64 so no character in the notes can end
 *  the URL early. */
export function updatePromptUrl(html: string): string {
  return `data:text/html;charset=utf-8;base64,${Buffer.from(html, "utf8").toString("base64")}`;
}

/** The choice a page title carries, or null for any other title (the page's own initial one). */
export function parseChoiceTitle(title: string): UpdateChoice | null {
  if (!title.startsWith(CHOICE_PREFIX)) return null;
  const choice = title.slice(CHOICE_PREFIX.length);
  return (CHOICES as readonly string[]).includes(choice) ? (choice as UpdateChoice) : null;
}

/** Exposed for the test that pins the CSP to the script actually on the page. */
export const UPDATE_PROMPT_SCRIPT = SCRIPT;
