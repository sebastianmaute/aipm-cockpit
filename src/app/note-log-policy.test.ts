// src/app/note-log-policy.test.ts
//
// Pins the six behaviours that used to diverge between `sanitizeNoteLog`
// (note-log.ts) and `sanitizeSeedNoteLog` (templates.ts) before both adopt
// this shared core (open-followups §286), plus the DOM-free contract itself.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { stripComments } from "../test/strip-comments";
import {
  sanitizeNoteLogWith,
  MAX_NOTE_ENTRIES,
  MAX_AUTHOR_NAME,
  type NoteLogHtmlOps,
} from "./note-log-policy";

/** A DOM-free stand-in: strips <script> tags the way an allow-list would,
 *  without a DOM. The point of these tests is the POLICY (caps, id minting,
 *  timestamp validation, control-char stripping), not the html step — the
 *  real DOM-dependent steps are exercised where each caller lives. */
const OPS: NoteLogHtmlOps = {
  sanitizeHtml: (raw) => raw.replace(/<script[\s\S]*?<\/script>/gi, ""),
  toText: (html) => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(),
};

const ts = "2026-08-30T00:00:00.000Z";

describe("sanitizeNoteLogWith — the six behaviours that used to diverge (§286)", () => {
  it("caps the entry count", () => {
    const raw = Array.from({ length: MAX_NOTE_ENTRIES + 10 }, (_, i) => ({
      id: i + 1,
      timestamp: ts,
      text: "t",
    }));
    expect(sanitizeNoteLogWith(raw, OPS)).toHaveLength(MAX_NOTE_ENTRIES);
  });

  it("MINTS an id when one is missing, instead of dropping the entry", () => {
    // ★★★ THE ROW THAT BITES. The seed validator used to drop these, so §168
    // was fixed except for exactly the legacy entries the canonical repair
    // was written for.
    const out = sanitizeNoteLogWith([{ timestamp: ts, text: "kept" }], OPS);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBeGreaterThan(0);
  });

  it("de-dupes two entries sharing one id", () => {
    const out = sanitizeNoteLogWith(
      [
        { id: 1, timestamp: ts, text: "a" },
        { id: 1, timestamp: ts, text: "b" },
      ],
      OPS,
    );
    expect(out).toHaveLength(2);
    expect(out[0].id).not.toBe(out[1].id);
  });

  it("rejects a timestamp that does not parse as a date", () => {
    expect(sanitizeNoteLogWith([{ id: 1, timestamp: "not-a-date", text: "t" }], OPS)).toHaveLength(0);
  });

  it("accepts a timestamp that does parse (positive control)", () => {
    // ★★ Without this, a validator that rejected EVERY timestamp would
    // satisfy the assertion above.
    expect(sanitizeNoteLogWith([{ id: 1, timestamp: ts, text: "t" }], OPS)).toHaveLength(1);
  });

  it("strips control characters from text", () => {
    // ★★★ A REAL control character, not a plain ASCII string — a fixture
    // like `text: "ab"` asserting `toBe("ab")` contains no control character
    // at all and would be vacuously green against a validator that strips
    // nothing. Build the input with an explicit code point (U+0001, SOH) and
    // assert both that the control char is GONE and that the input genuinely
    // differed from the output, so the test cannot pass on a no-op.
    const dirty = "a" + String.fromCharCode(1) + "b";
    expect(dirty).not.toBe("ab"); // sanity: the fixture really is dirty
    const out = sanitizeNoteLogWith([{ id: 1, timestamp: ts, text: dirty }], OPS);
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe("ab");
  });

  it("strips control characters from authorName", () => {
    const dirty = "Al" + String.fromCharCode(2) + "ice";
    expect(dirty).not.toBe("Alice"); // sanity: the fixture really is dirty
    const out = sanitizeNoteLogWith(
      [{ id: 1, timestamp: ts, text: "t", authorName: dirty }],
      OPS,
    );
    expect(out).toHaveLength(1);
    expect(out[0].authorName).toBe("Alice");
  });

  it("caps a long authorName", () => {
    const out = sanitizeNoteLogWith(
      [{ id: 1, timestamp: ts, text: "t", authorName: "a".repeat(500) }],
      OPS,
    );
    expect(out[0].authorName!.length).toBeLessThanOrEqual(MAX_AUTHOR_NAME);
  });

  it("re-derives text from html even when a captured text is present", () => {
    // ★★★ THE SEVENTH DIVERGENCE, and the one row where the SEED validator's
    // rule wins rather than the canonical one. Canonical derived text only when
    // the captured one was empty; the seed always re-projected, because a
    // captured `text` can disagree with its `html` after a hand-edited template
    // or a sink change that narrowed the html since capture. A stale projection
    // must not outlive the html it describes.
    const out = sanitizeNoteLogWith(
      [{ id: 1, timestamp: ts, html: "<p>real</p>", text: "STALE" }],
      OPS,
    );
    expect(out[0].text).toBe("real");
  });

  it("and the two candidate values really are distinguishable (anti-vacuity)", () => {
    // ★★ Separate it() — vitest aborts at the first failing hard assertion.
    // Without this, an `OPS.toText` that happened to yield "STALE" would make
    // the assertion above pass while proving the OPPOSITE rule. Pin that the
    // projection and the captured text are different strings, so the test
    // above genuinely discriminates between the two rules.
    expect(OPS.toText("<p>real</p>")).toBe("real");
    expect(OPS.toText("<p>real</p>")).not.toBe("STALE");
  });
});

describe("note-log-policy.ts is DOM-free", () => {
  const PATH = "src/app/note-log-policy.ts";
  const src = readFileSync(PATH, "utf8");
  const codeOnly = stripComments(src, PATH);

  it("still contains the function body after stripping (anti-vacuity)", () => {
    // ★★ A stripper that ate everything would make the scan below vacuously
    // green. Anchor on something the scan must be able to see.
    expect(codeOnly).toContain("sanitizeNoteLogWith");
  });

  it("imports nothing that reaches DOMPurify", () => {
    expect(codeOnly).not.toContain("sanitize-html");
    expect(codeOnly).not.toContain("dompurify");
  });
});
