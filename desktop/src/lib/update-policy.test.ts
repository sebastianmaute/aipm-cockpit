import { describe, expect, it } from "vitest";
import {
  STARTUP_CHECK_DELAY_MS, decideOnAvailable, decideOnError, decideOnNotAvailable,
  notesToPlainText, parseSkipped, serializeSkipped, shouldStartCheck,
} from "./update-policy";

describe("update policy", () => {
  it("waits 10 s after start", () => expect(STARTUP_CHECK_DELAY_MS).toBe(10_000));

  it("never starts a second check while one is running", () => {
    expect(shouldStartCheck(false)).toBe(true);
    expect(shouldStartCheck(true)).toBe(false);
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
    expect(decideOnError("startup", new Error("404"))).toEqual({ kind: "silent" });
    expect(decideOnError("manual", new Error("net::ERR_INTERNET_DISCONNECTED"))).toEqual({
      kind: "error", message: "net::ERR_INTERNET_DISCONNECTED",
    });
    expect(decideOnError("manual", "x".repeat(500))).toMatchObject({ kind: "error", message: expect.stringMatching(/…$/) });
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

  it("reads and writes the skipped version, tolerating junk", () => {
    expect(parseSkipped(serializeSkipped("1.14.1"))).toBe("1.14.1");
    expect(parseSkipped(null)).toBeNull();
    expect(parseSkipped("{not json")).toBeNull();
    expect(parseSkipped('{"skippedVersion":42}')).toBeNull();
  });
});
