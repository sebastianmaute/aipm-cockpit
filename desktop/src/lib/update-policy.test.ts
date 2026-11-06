import { describe, expect, it } from "vitest";
import {
  BOX_NOTES_MAX, NOTES_MAX, STARTUP_CHECK_DELAY_MS, decideCheckRequest, decideOnAvailable, decideOnError, decideOnNotAvailable,
  notesToPlainText, parseSkipped, serializeSkipped, summarizeError,
} from "./update-policy";
import { CANNOT_RUN_PREFIX } from "../update-signature";

describe("update policy", () => {
  it("waits 10 s after start", () => expect(STARTUP_CHECK_DELAY_MS).toBe(10_000));

  describe("decideCheckRequest", () => {
    const IDLE = { checking: false, downloading: false, prompting: false };

    it("starts a check when the updater is idle", () => {
      expect(decideCheckRequest(IDLE)).toBe("start");
    });

    it("promotes rather than starting a second check while one is already running", () => {
      expect(decideCheckRequest({ ...IDLE, checking: true })).toBe("promote");
    });

    it("reports a download already in progress instead of starting a second check", () => {
      expect(decideCheckRequest({ ...IDLE, downloading: true })).toBe("downloading");
    });

    it("defers to an open dialog over every other state", () => {
      expect(decideCheckRequest({ ...IDLE, prompting: true })).toBe("prompting");
      expect(decideCheckRequest({ checking: true, downloading: true, prompting: true })).toBe("prompting");
    });
  });

  it("prompts for an available version, with plain-text notes for the native box and safe HTML for the window", () => {
    expect(decideOnAvailable("startup", { version: "1.14.1", releaseNotes: "<p>Fixes <b>x</b></p>" }, null)).toEqual({
      kind: "prompt", version: "1.14.1", notes: "Fixes x", notesHtml: "<p>Fixes <strong>x</strong></p>",
    });
  });

  it("caps the native box's notes small, since it cannot scroll, while the window keeps the large cap", () => {
    const long = `<p>${"y".repeat(BOX_NOTES_MAX * 3)}</p>`;
    const d = decideOnAvailable("manual", { version: "2.0.0", releaseNotes: long }, null);
    if (d.kind !== "prompt") throw new Error("expected a prompt");
    expect(d.notes.length).toBe(BOX_NOTES_MAX);
    expect(d.notesHtml.length).toBeGreaterThan(BOX_NOTES_MAX * 3);
    expect(BOX_NOTES_MAX).toBeLessThan(NOTES_MAX);
  });

  it("stays silent at startup for a skipped version, but a manual check still offers it", () => {
    expect(decideOnAvailable("startup", { version: "1.14.1" }, "1.14.1")).toEqual({ kind: "silent" });
    expect(decideOnAvailable("manual", { version: "1.14.1" }, "1.14.1").kind).toBe("prompt");
    expect(decideOnAvailable("startup", { version: "1.14.2" }, "1.14.1").kind).toBe("prompt");
  });

  // A version whose installer was refused this session is the same file again: never offered, a
  // manual check says why; a newer version is offered as usual.
  it("never offers a version refused this session again, but offers a newer one", () => {
    const refused = { version: "1.14.1", refusal: "mismatch" } as const;
    expect(decideOnAvailable("startup", { version: "1.14.1" }, null, refused)).toEqual({ kind: "silent" });
    const manual = decideOnAvailable("manual", { version: "1.14.1" }, null, refused);
    expect(manual).toEqual({ kind: "unverified", message: expect.stringContaining("1.14.1 was refused earlier"), refusal: "mismatch" });
    expect(decideOnAvailable("startup", { version: "1.14.2" }, null, refused).kind).toBe("prompt");
    expect(decideOnAvailable("manual", { version: "1.14.2" }, null, refused).kind).toBe("prompt");
    expect(decideOnAvailable("startup", { version: "1.14.1" }, null, null).kind).toBe("prompt");
  });

  // A manual re-check repeats the refusal in its own words: a signature that did not verify, or a
  // check that could not run on this computer, which says nothing about the update itself.
  it("repeats a refusal in the words of its kind on a manual re-check", () => {
    const mismatch = decideOnAvailable("manual", { version: "1.14.1" }, null, { version: "1.14.1", refusal: "mismatch" });
    expect(mismatch).toEqual({
      kind: "unverified", refusal: "mismatch",
      message: "AI PM Cockpit 1.14.1 was refused earlier in this session: its signature could not be verified.",
    });
    const cannotRun = decideOnAvailable("manual", { version: "1.14.1" }, null, { version: "1.14.1", refusal: "cannot-run" });
    expect(cannotRun).toEqual({
      kind: "unverified", refusal: "cannot-run",
      message: "AI PM Cockpit 1.14.1 was refused earlier in this session: its signature check could not run on this computer.",
    });
  });

  it("reports up to date and errors only for a manual check", () => {
    expect(decideOnNotAvailable("startup")).toEqual({ kind: "silent" });
    expect(decideOnNotAvailable("manual")).toEqual({ kind: "up-to-date" });
    expect(decideOnError("startup", "checking", new Error("404"))).toEqual({ kind: "silent" });
    expect(decideOnError("manual", "checking", new Error("net::ERR_INTERNET_DISCONNECTED"))).toEqual({
      kind: "error", phase: "checking", message: "net::ERR_INTERNET_DISCONNECTED",
    });
    expect(decideOnError("manual", "checking", "x".repeat(500))).toMatchObject({ kind: "error", message: expect.stringMatching(/…$/) });
  });

  it("always reports a download error, even one that started from a silent startup check", () => {
    // A download only ever starts because the user clicked
    // "Download and install", so silence is never right here regardless of what triggered the CHECK
    // that preceded it.
    expect(decideOnError("startup", "downloading", new Error("ENOSPC"))).toEqual({
      kind: "error", phase: "downloading", message: "ENOSPC",
    });
    expect(decideOnError("manual", "downloading", new Error("ENOSPC"))).toEqual({
      kind: "error", phase: "downloading", message: "ENOSPC",
    });
  });

  // A signed build refuses an installer whose signature it cannot verify; electron-updater reports
  // that as an error carrying this code (NsisUpdater.js, ERR_UPDATER_INVALID_SIGNATURE).
  it("names a refused signature as its own decision, whatever the trigger or phase", () => {
    const refused = Object.assign(new Error("New version 9.9.9 is not signed by the application owner: the installer's signature is NotSigned"), {
      code: "ERR_UPDATER_INVALID_SIGNATURE",
    });
    const want = { kind: "unverified", message: refused.message, refusal: "mismatch" };
    expect(decideOnError("startup", "downloading", refused)).toEqual(want);
    expect(decideOnError("manual", "downloading", refused)).toEqual(want);
    expect(decideOnError("startup", "checking", refused)).toEqual(want);
    // Any other code, or none, stays an ordinary error.
    const other = Object.assign(new Error("ENOSPC"), { code: "ENOSPC" });
    expect(decideOnError("manual", "downloading", other)).toEqual({ kind: "error", phase: "downloading", message: "ENOSPC" });
  });

  // The kind of a refusal is read from the WHOLE message, so a prefix past the dialog line's clip
  // still counts.
  it("names a refusal whose check could not run as cannot-run, even past the clipped line", () => {
    const cannotRun = Object.assign(new Error(`New version 9.9.9 is not signed by the application owner: ${CANNOT_RUN_PREFIX}PowerShell exited with 1`), {
      code: "ERR_UPDATER_INVALID_SIGNATURE",
    });
    expect(decideOnError("manual", "downloading", cannotRun)).toMatchObject({ kind: "unverified", refusal: "cannot-run" });
    const late = Object.assign(new Error(`${"x".repeat(400)}: ${CANNOT_RUN_PREFIX}timed out`), { code: "ERR_UPDATER_INVALID_SIGNATURE" });
    const d = decideOnError("manual", "downloading", late);
    expect(d).toMatchObject({ kind: "unverified", refusal: "cannot-run" });
    expect(d.kind === "unverified" && d.message.includes(CANNOT_RUN_PREFIX)).toBe(false);
  });

  it("shows only the first line of an error, never headers or a stack trailing after it", () => {
    // electron-updater's own HttpError builds `.message` as
    // "{status} {statusText}\n{description}\nHeaders: {...}" -- and a REAL 404 from a private GitHub
    // repo's releases feed put response set-cookie values in that Headers block. Neither a log line nor a dialog should ever show that.
    const httpLike = new Error(
      '404 Not Found\n"method: GET url: https://example.invalid/releases.atom"\n' +
        'Headers: {"set-cookie":["_gh_sess=verysecret; path=/; HttpOnly"]}',
    );
    const decision = decideOnError("manual", "checking", httpLike);
    expect(decision).toEqual({ kind: "error", phase: "checking", message: "404 Not Found" });
    expect((decision as { message: string }).message).not.toContain("set-cookie");
    expect((decision as { message: string }).message).not.toContain("_gh_sess");
  });

  it("summarizeError trims to one bounded line for any error-ish value, not just decideOnError's callers", () => {
    // Reused by updater.ts's raw logger.warn/error wrappers too, so an internal
    // electron-updater log call with a multi-line payload gets the same treatment as a dialog error.
    expect(summarizeError(new Error("one\ntwo\nthree"))).toBe("one");
    expect(summarizeError("plain string\nwith a second line")).toBe("plain string");
    expect(summarizeError(new Error("  padded line  \nrest"))).toBe("padded line");
    expect(summarizeError(new Error("y".repeat(5000)))).toMatch(/…$/);
  });

  it("turns any notes shape into bounded plain text", () => {
    expect(notesToPlainText(undefined)).toBe("No release notes.");
    expect(notesToPlainText("")).toBe("No release notes.");
    expect(notesToPlainText([{ version: "1.14.1", note: "<ul><li>A</li><li>B &amp; C</li></ul>" }])).toBe("A\nB & C");
    expect(notesToPlainText("<h2>T</h2>\n\n\n\n<p>x</p>")).toBe("T\n\nx");
    const long = notesToPlainText("y".repeat(NOTES_MAX * 2));
    expect(long.length).toBe(NOTES_MAX);
    expect(long.endsWith("…")).toBe(true);
  });

  it("drops <script>/<style> blocks WITH their contents, not just the tags", () => {
    const html = "<p>keep</p><script>alert(document.cookie)</script><style>.x{color:red}</style><p>more</p>";
    const out = notesToPlainText(html);
    expect(out).not.toContain("alert");
    expect(out).not.toContain("color:red");
    expect(out).toBe("keep\nmore");
  });

  it("decodes &amp; LAST so a doubly-escaped entity does not decode twice", () => {
    // "&amp;lt;" in the source means the literal text "&lt;". Decoding &amp; first would turn it into
    // "&lt;" in time to be caught by the &lt; replace and wrongly produce "<".
    expect(notesToPlainText("&amp;lt;")).toBe("&lt;");
  });

  it("decodes &nbsp; and numeric character references, decimal and hex", () => {
    expect(notesToPlainText("a&nbsp;b")).toBe("a b");
    expect(notesToPlainText("it&#39;s &#x27;quoted&#x27;")).toBe("it's 'quoted'");
  });

  it("never leaves a lone surrogate half dangling at the clip boundary", () => {
    // U+1F600 (😀) is a surrogate PAIR in UTF-16 -- two code units. Repeating it past the NOTES_MAX
    // limit puts a pair boundary near the cut on roughly half of all lengths; this fixture lands
    // exactly on one (NOTES_MAX is even, so the cut before the ellipsis falls mid-pair).
    const long = notesToPlainText("😀".repeat(NOTES_MAX / 2 + 400));
    expect(long.endsWith("…")).toBe(true);
    const withoutEllipsis = long.slice(0, -1);
    // A string built entirely from 2-code-unit pairs has no lone surrogate iff its length is even.
    expect(withoutEllipsis.length % 2).toBe(0);
    expect([...withoutEllipsis].every((ch) => ch === "😀")).toBe(true);
  });

  it("reads and writes the skipped version, tolerating junk", () => {
    expect(parseSkipped(serializeSkipped("1.14.1"))).toBe("1.14.1");
    expect(parseSkipped(null)).toBeNull();
    expect(parseSkipped("{not json")).toBeNull();
    expect(parseSkipped('{"skippedVersion":42}')).toBeNull();
  });
});
