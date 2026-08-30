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

// ★★★ THE §137 REGRESSION TEST. This load boundary had NO test at all over a
// value carrying markup outside the retired 8-tag note list, which is exactly how
// it broke: `sanitizeRichFields` ran `sanitizeNoteHtml` at `KEEP_CONTENT: false`,
// so an element it did not allow was deleted TOGETHER WITH ITS TEXT — on every
// JSON and IndexedDB load, with no human and no save involved, and with no undo.
//
// Measured at the defect (2026-08-11, through these exact exported functions):
//   RAID description "<h1>Escalation</h1><p>ok</p>"    -> "<p>ok</p>"   "Escalation" DELETED
//   RAID mitigation  "<blockquote>plan B</blockquote>" -> ""            field EMPTIED
//   Task description "<h1>Title</h1><p>body</p>"       -> "<p>body</p>" "Title" DELETED
// Twelve of the 21 rich tags lost their words that way: u s code mark sub sup pre
// blockquote h1 h2 h3 h4.
//
// ★★ ASSERT THE MARKUP, NOT JUST THE WORD. Before the sink merge these values were
// ESCAPED rather than deleted, so `toContain("Escalation")` was ALREADY true under
// the older, milder version of this bug — a word-only assertion cannot tell the
// fixed state from the escaped one. The `toBe` byte assertions below separate all
// three: deleted, escaped, and passed through as real markup.
describe("§137: the load boundary keeps markup outside the retired lean list", () => {
  it("keeps a RAID heading and a RAID blockquote as live markup", () => {
    const out = sanitizeRaidRichFields({
      description: "<h1>Escalation</h1><p>ok</p>",
      mitigation: "<blockquote>plan B</blockquote>",
    });
    expect(out.description).toBe("<h1>Escalation</h1><p>ok</p>");
    expect(out.mitigation).toBe("<blockquote>plan B</blockquote>");
  });

  it("keeps a task heading as live markup", () => {
    expect(sanitizeNoteFields({ description: "<h1>Title</h1><p>body</p>" }).description)
      .toBe("<h1>Title</h1><p>body</p>");
  });

  it("keeps the words of every tag the merge added, on both entity paths", () => {
    // The full set the old note list omitted. A per-tag loop rather than one
    // fixture: the defect was per-tag, and a single combined value would go green
    // as soon as ANY tag survived.
    for (const tag of ["u", "s", "code", "mark", "sub", "sup", "pre", "blockquote", "h1", "h2", "h3", "h4"]) {
      const html = `<${tag}>kept</${tag}>`;
      expect(sanitizeNoteFields({ description: html }).description, `task <${tag}>`).toBe(html);
      expect(sanitizeRaidRichFields({ mitigation: html }).mitigation, `raid <${tag}>`).toBe(html);
    }
  });

  it("still strips a script from the same boundary — the merge widened markup, not attack surface", () => {
    // Anti-regression in the other direction: the fix must not be "stop
    // sanitizing". <div> is on no list and must still unwrap (words kept).
    const out = sanitizeRaidRichFields({
      description: "<h1>ok</h1><script>alert(1)</script>",
      mitigation: "<p>a</p><div>b</div>",
    });
    expect(out.description).toBe("<h1>ok</h1>");
    expect(out.mitigation).toBe("<p>a</p>b");
  });
});

// ★★★ THESE RUN THE REAL `sanitizeRichHtml` + `htmlToText` PAIR, and that is the
// whole point of putting them here rather than in `note-log-policy.test.ts`. That file
// injects a MOCK `NoteLogHtmlOps` (a regex tag-strip) to test the policy in isolation,
// so it is structurally incapable of seeing an html body that the REAL sanitizer or the
// REAL projection empties. A deletion bug that did exactly that shipped green past the
// mocked suite; see the ★★★ block on the re-derivation in `note-log-policy.ts`.
describe("note-log text re-derivation against the real sanitizer (§286, seventh divergence)", () => {
  const at = "2026-07-16T10:00:00.000Z";
  const one = (html: string, text: string) =>
    sanitizeNoteLog([{ id: 1, timestamp: at, html, text }]);

  it("re-derives a captured text from the html when the two disagree", () => {
    // The seventh divergence itself: html wins over a stale captured projection.
    expect(one("<p>real</p>", "STALE")[0].text).toBe("real");
  });

  it("and the two candidate values are distinguishable (anti-vacuity)", () => {
    // ★★ Separate it(): vitest aborts at the first failing hard assertion, so an
    // assertion sharing the block above would be unproved whenever that one failed.
    // Without this, a projection that happened to yield "STALE" would satisfy the test
    // above while proving the OPPOSITE rule.
    expect(one("<p>real</p>", "STALE")[0].text).not.toBe("STALE");
  });

  // ★★★ THE REGRESSION PIN. Each of these three bodies survives or fails sanitising
  // in a different way and ALL of them project to the empty string, so an unconditional
  // re-derivation overwrites a good captured text with "" and the `if (!text) continue`
  // below it then DROPS the entry entirely — losing its timestamp and author too. One
  // it() each, because they are three independent claims about three different shapes:
  // a mutant that only fixes one must not be able to hide behind the other two.
  const EMPTY_PROJECTIONS: ReadonlyArray<readonly [string, string]> = [
    ["a bare horizontal rule (survives sanitising, projects to nothing)", "<hr>"],
    ["a paragraph holding only a line break", "<p><br></p>"],
    ["an image-only body (img is not in RICH_ALLOWED_TAGS, so it sanitises away)", "<p><img src=x.png></p>"],
  ];

  for (const [label, html] of EMPTY_PROJECTIONS) {
    it(`keeps the entry and its captured text when the html is ${label}`, () => {
      const out = one(html, "Screenshot of the risk register");
      expect(out).toHaveLength(1);
      expect(out[0].text).toBe("Screenshot of the risk register");
    });
  }

  it("still drops an entry when BOTH the captured text and the projection are empty", () => {
    // ★★ The positive control for the three above. Without it, a validator that
    // simply never dropped anything would satisfy every one of them, and the guard
    // being pinned (re-derive only when the projection says something) would be
    // indistinguishable from having no drop rule at all.
    expect(one("<hr>", "")).toHaveLength(0);
  });
});
