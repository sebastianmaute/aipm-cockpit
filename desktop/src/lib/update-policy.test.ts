import { describe, expect, it } from "vitest";
import {
  STARTUP_CHECK_DELAY_MS, decideCheckRequest, decideOnAvailable, decideOnError, decideOnNotAvailable,
  notesToPlainText, parseSkipped, serializeSkipped, summarizeError,
} from "./update-policy";

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

  it("prompts for an available version, with plain-text notes", () => {
    expect(decideOnAvailable("startup", { version: "1.14.1", releaseNotes: "<p>Fixes <b>x</b></p>" }, null)).toEqual({
      kind: "prompt", version: "1.14.1", notes: "Fixes x",
    });
  });

  it("stays silent at startup for a skipped version, but a manual check still offers it", () => {
    expect(decideOnAvailable("startup", { version: "1.14.1" }, "1.14.1")).toEqual({ kind: "silent" });
    expect(decideOnAvailable("manual", { version: "1.14.1" }, "1.14.1").kind).toBe("prompt");
    expect(decideOnAvailable("startup", { version: "1.14.2" }, "1.14.1").kind).toBe("prompt");
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
    // Fix round 1 (review R11 Important 2): a download only ever starts because the user clicked
    // "Download and install", so silence is never right here regardless of what triggered the CHECK
    // that preceded it.
    expect(decideOnError("startup", "downloading", new Error("ENOSPC"))).toEqual({
      kind: "error", phase: "downloading", message: "ENOSPC",
    });
    expect(decideOnError("manual", "downloading", new Error("ENOSPC"))).toEqual({
      kind: "error", phase: "downloading", message: "ENOSPC",
    });
  });

  it("shows only the first line of an error, never headers or a stack trailing after it", () => {
    // Fix round 3: electron-updater's own HttpError builds `.message` as
    // "{status} {statusText}\n{description}\nHeaders: {...}" -- and a REAL 404 from a private GitHub
    // repo's releases feed put response set-cookie values in that Headers block (task-6-report.md's
    // fix-round-2 evidence). Neither a log line nor a dialog should ever show that.
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
    // Reused by updater.ts's raw logger.warn/error wrappers too (fix round 3), so an internal
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
    const long = notesToPlainText("y".repeat(5000));
    expect(long.length).toBe(1500);
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
    // U+1F600 (😀) is a surrogate PAIR in UTF-16 -- two code units. Repeating it past the 1500-char
    // limit puts a pair boundary near the cut on roughly half of all lengths; this fixture lands
    // exactly on one.
    const long = notesToPlainText("😀".repeat(800));
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
