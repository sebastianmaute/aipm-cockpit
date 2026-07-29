import { describe, it, expect } from "vitest";
import { nextNoteId, addNote, editNote, deleteNote, canEditNote, sanitizeNoteLog, sanitizeNoteFields, sanitizeRaidRichFields, sanitizeChangeRichFields, sanitizeMilestoneRichFields, encodeNoteLog, decodeNoteLog } from "./note-log";
import type { NoteLogEntry } from "./types";

describe("note-log codec", () => {
  const good = {
    authorResourceId: 7,
    authorName: "Ann",
    timestamp: "2026-07-16T10:00:00.000Z",
    text: "Called the vendor",
  };

  it("round-trips a valid entry through encode/decode (id minted, html derived from text)", () => {
    const back = decodeNoteLog(encodeNoteLog([good] as unknown as NoteLogEntry[]));
    expect(back).toEqual([{ ...good, id: 1, html: "<p>Called the vendor</p>" }]);
  });

  it("encodes empty/undefined to '' (byte-stable, legacy rows untouched)", () => {
    expect(encodeNoteLog(undefined)).toBe("");
    expect(encodeNoteLog([])).toBe("");
  });

  it("decodes an empty cell to []", () => {
    expect(decodeNoteLog("")).toEqual([]);
    expect(decodeNoteLog(null)).toEqual([]);
    expect(decodeNoteLog("not json")).toEqual([]);
  });

  it("drops an entry with empty/whitespace text", () => {
    expect(sanitizeNoteLog([{ timestamp: good.timestamp, text: "   " }])).toEqual([]);
    expect(sanitizeNoteLog([{ timestamp: good.timestamp, text: "" }])).toEqual([]);
  });

  it("drops an entry with a non-ISO timestamp", () => {
    expect(sanitizeNoteLog([{ timestamp: "not-a-date", text: "hi" }])).toEqual([]);
    expect(sanitizeNoteLog([{ text: "hi" }])).toEqual([]);
  });

  it("strips residual control chars but degrades the newline to a space", () => {
    const out = sanitizeNoteLog([{ timestamp: good.timestamp, text: "a\u0000b\u0007c\ndone" }]);
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe("abc done");
  });

  it("degrades newlines/tabs to a single space (readable single line)", () => {
    const nl = String.fromCharCode(10);
    const crlf = String.fromCharCode(13, 10);
    const tab = String.fromCharCode(9);
    expect(sanitizeNoteLog([{ timestamp: good.timestamp, text: "line1" + nl + "line2" }])[0].text).toBe("line1 line2");
    expect(sanitizeNoteLog([{ timestamp: good.timestamp, text: "a" + crlf + "b" + tab + "c" }])[0].text).toBe("a b c");
  });

  it("drops a non-positive authorResourceId but keeps the entry", () => {
    const out = sanitizeNoteLog([{ timestamp: good.timestamp, text: "hi", authorResourceId: -3 }]);
    expect(out).toHaveLength(1);
    expect(out[0].authorResourceId).toBeUndefined();
  });

  it("returns [] for non-array input", () => {
    expect(sanitizeNoteLog(undefined)).toEqual([]);
    expect(sanitizeNoteLog("x")).toEqual([]);
    expect(sanitizeNoteLog({})).toEqual([]);
  });
});

const base: NoteLogEntry = { id: 1, timestamp: "2026-01-01T00:00:00.000Z", html: "<p>a</p>", text: "a", authorResourceId: 7, authorName: "Sam" };

describe("nextNoteId", () => {
  it("is max+1", () => expect(nextNoteId([base, { ...base, id: 4 }])).toBe(5));
  it("is 1 for empty", () => expect(nextNoteId([])).toBe(1));
});

describe("addNote", () => {
  it("appends a stamped entry with self as author", () => {
    const out = addNote([base], { html: "<p>b</p>", text: "b", timestamp: "2026-02-02T00:00:00.000Z", self: 9, authorName: "Alex" });
    expect(out).toHaveLength(2);
    expect(out[1]).toMatchObject({ id: 2, html: "<p>b</p>", text: "b", authorResourceId: 9, authorName: "Alex" });
  });
  it("is authorless when self is null", () => {
    const out = addNote([], { html: "<p>x</p>", text: "x", timestamp: "2026-02-02T00:00:00.000Z", self: null });
    expect(out[0].authorResourceId).toBeUndefined();
  });
});

describe("canEditNote", () => {
  it("true for matching author", () => expect(canEditNote(base, 7)).toBe(true));
  it("false for other author", () => expect(canEditNote(base, 8)).toBe(false));
  it("true for authorless", () => expect(canEditNote({ ...base, authorResourceId: undefined }, 8)).toBe(true));
});

describe("editNote", () => {
  it("updates body + editedAt for the author", () => {
    const out = editNote([base], 1, { html: "<p>z</p>", text: "z", editedAt: "2026-03-03T00:00:00.000Z", self: 7, authorName: "Sam" });
    expect(out[0]).toMatchObject({ html: "<p>z</p>", text: "z", editedAt: "2026-03-03T00:00:00.000Z", authorResourceId: 7 });
  });
  it("claims an authorless note on edit", () => {
    const authorless: NoteLogEntry = { id: 1, timestamp: "2026-01-01T00:00:00.000Z", html: "<p>a</p>", text: "a" };
    const out = editNote([authorless], 1, { html: "<p>z</p>", text: "z", editedAt: "2026-03-03T00:00:00.000Z", self: 5, authorName: "Kim" });
    expect(out[0]).toMatchObject({ authorResourceId: 5, authorName: "Kim" });
  });
});

describe("deleteNote", () => {
  it("removes by id", () => expect(deleteNote([base, { ...base, id: 2 }], 1)).toEqual([{ ...base, id: 2 }]));
});

describe("sanitizeNoteLog legacy upgrade", () => {
  it("mints ids and derives html from text for legacy entries", () => {
    const legacy = [{ timestamp: "2026-01-01T00:00:00.000Z", text: "hello" }] as unknown as NoteLogEntry[];
    const out = sanitizeNoteLog(legacy);
    expect(out[0].id).toBe(1);
    expect(out[0].text).toBe("hello");
    expect(out[0].html).toContain("hello");
  });
});

describe("sanitizeNoteFields upgrades before sanitizing (slice B)", () => {
  // ★ headline claim: text inside a non-allow-listed tag must SURVIVE, because
  // a legacy plain description is escaped before DOMPurify ever sees it.
  it("keeps the text of a legacy plain description containing tag-shaped input", () => {
    const out = sanitizeNoteFields({ description: "risk: <b>vendor</b> delay" });
    expect(out.description).toContain("vendor");
    expect(out.description).toBe("<p>risk: &lt;b&gt;vendor&lt;/b&gt; delay</p>");
  });

  it("wraps an ordinary legacy plain description", () => {
    expect(sanitizeNoteFields({ description: "cost < 5k & rising" }).description).toBe(
      "<p>cost &lt; 5k &amp; rising</p>",
    );
  });

  it("leaves an already-rich description untouched", () => {
    const html = "<p>already <strong>rich</strong></p>";
    expect(sanitizeNoteFields({ description: html }).description).toBe(html);
  });

  it("still strips genuinely dangerous markup from a rich value", () => {
    const out = sanitizeNoteFields({ description: "<p>ok</p><script>alert(1)</script>" });
    expect(out.description).not.toContain("script");
    expect(out.description).toContain("ok");
  });

  it("is idempotent", () => {
    const once = sanitizeNoteFields({ description: "a < b" }).description;
    expect(sanitizeNoteFields({ description: once }).description).toBe(once);
  });

  it("returns the entity unchanged when it carries neither field", () => {
    const e = { id: 1 } as { id: number; description?: string };
    expect(sanitizeNoteFields(e)).toBe(e);
  });

  // ★ The task normalizer owns `description` ALONE — widening it would move the
  // task path's bytes, which is exactly what the sibling split avoids.
  it("leaves a register-only rich field alone on the task normalizer", () => {
    const out = sanitizeNoteFields({ description: "d", mitigation: "escalate <b>now</b>" });
    expect(out.mitigation).toBe("escalate <b>now</b>");
  });
});

describe("sanitizeRaidRichFields normalises mitigation as well as description", () => {
  // ★ headline claim, and the fixture is TAG-SHAPED on purpose: "a < b" proves
  // nothing here, because a `<` followed by a space never opens a tag, so a
  // reversed order (sanitize-then-escape) would pass it. `<b>now</b>` is a real
  // element, and DOMPurify's KEEP_CONTENT:false deletes it TOGETHER WITH "now"
  // unless the escape ran first.
  it("upgrades and escapes a legacy plain mitigation containing tag-shaped input", () => {
    const out = sanitizeRaidRichFields({ mitigation: "escalate <b>now</b>" });
    expect(out.mitigation).toBe("<p>escalate &lt;b&gt;now&lt;/b&gt;</p>");
  });

  it("leaves an already-rich mitigation untouched", () => {
    const html = "<p>escalate <strong>now</strong></p>";
    expect(sanitizeRaidRichFields({ mitigation: html }).mitigation).toBe(html);
  });

  it("still strips genuinely dangerous markup from a rich mitigation", () => {
    const out = sanitizeRaidRichFields({ mitigation: "<p>ok</p><script>alert(1)</script>" });
    expect(out.mitigation).toContain("ok");
    expect(out.mitigation).not.toContain("<script");
  });

  it("normalises description and mitigation in the same pass", () => {
    const out = sanitizeRaidRichFields({ description: "risk <i>x</i>", mitigation: "plan <i>y</i>" });
    expect(out.description).toBe("<p>risk &lt;i&gt;x&lt;/i&gt;</p>");
    expect(out.mitigation).toBe("<p>plan &lt;i&gt;y&lt;/i&gt;</p>");
  });

  it("is idempotent", () => {
    const once = sanitizeRaidRichFields({ mitigation: "escalate <b>now</b>" }).mitigation;
    expect(sanitizeRaidRichFields({ mitigation: once }).mitigation).toBe(once);
  });

  it("returns the entity by reference when it carries none of the fields", () => {
    const e = { id: 1 } as { id: number; mitigation?: string };
    expect(sanitizeRaidRichFields(e)).toBe(e);
  });
});

describe("sanitizeChangeRichFields normalises all three change rich fields", () => {
  it("upgrades and escapes each legacy plain field containing tag-shaped input", () => {
    const out = sanitizeChangeRichFields({
      description: "scope <b>creep</b>",
      impactDescription: "cost <b>up</b>",
      resolutionNotes: "approved <b>fully</b>",
    });
    expect(out.description).toBe("<p>scope &lt;b&gt;creep&lt;/b&gt;</p>");
    expect(out.impactDescription).toBe("<p>cost &lt;b&gt;up&lt;/b&gt;</p>");
    expect(out.resolutionNotes).toBe("<p>approved &lt;b&gt;fully&lt;/b&gt;</p>");
  });

  it("leaves already-rich values untouched", () => {
    const html = "<p>already <em>rich</em></p>";
    const out = sanitizeChangeRichFields({ description: html, impactDescription: html, resolutionNotes: html });
    expect(out.description).toBe(html);
    expect(out.impactDescription).toBe(html);
    expect(out.resolutionNotes).toBe(html);
  });

  it("strips a dangerous element from every field", () => {
    const bad = "<p>ok</p><script>alert(1)</script>";
    const out = sanitizeChangeRichFields({ description: bad, impactDescription: bad, resolutionNotes: bad });
    for (const v of [out.description, out.impactDescription, out.resolutionNotes]) {
      expect(v).toContain("ok");
      expect(v).not.toContain("<script");
    }
  });

  it("is idempotent", () => {
    const once = sanitizeChangeRichFields({ impactDescription: "cost <b>up</b>" }).impactDescription;
    expect(sanitizeChangeRichFields({ impactDescription: once }).impactDescription).toBe(once);
  });

  it("returns the entity by reference when it carries none of the fields", () => {
    const e = { id: 1 } as { id: number; impactDescription?: string };
    expect(sanitizeChangeRichFields(e)).toBe(e);
  });
});

describe("sanitizeMilestoneRichFields normalises the milestone description", () => {
  it("upgrades and escapes a legacy plain description containing tag-shaped input", () => {
    expect(sanitizeMilestoneRichFields({ description: "gate <b>2</b>" }).description).toBe(
      "<p>gate &lt;b&gt;2&lt;/b&gt;</p>",
    );
  });

  it("strips a dangerous element from a rich description", () => {
    const out = sanitizeMilestoneRichFields({ description: "<p>ok</p><script>alert(1)</script>" });
    expect(out.description).toContain("ok");
    expect(out.description).not.toContain("<script");
  });

  it("is idempotent", () => {
    const once = sanitizeMilestoneRichFields({ description: "gate <b>2</b>" }).description;
    expect(sanitizeMilestoneRichFields({ description: once }).description).toBe(once);
  });

  it("returns the entity by reference when it carries none of the fields", () => {
    const e = { id: 1 } as { id: number; description?: string };
    expect(sanitizeMilestoneRichFields(e)).toBe(e);
  });
});
