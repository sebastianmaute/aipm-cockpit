import { describe, expect, it } from "vitest";
import {
  decodeRaidEscalations,
  encodeRaidEscalations,
  isEscalationEmail,
  isEscalationWriteEmail,
  lastEscalation,
  RAID_ESCALATION_NAME_MAX,
  RAID_ESCALATIONS_MAX,
  requireEscalationRecipient,
  sanitizeRaidEscalations,
  stripBreakTags,
} from "./raid-escalation";
import type { RaidEscalation } from "./types";

const RAISED: RaidEscalation = {
  at: "2026-05-20T09:30:00.000Z", toName: "Sam Placeholder", toEmail: "Fictional.Jordan@example.com",
  toResourceId: 2, fromSeverity: "Medium", toSeverity: "High",
};
const NOTIFY: RaidEscalation = { at: "2026-05-22T14:00:00.000Z", toEmail: "ops@example.com" };

describe("sanitizeRaidEscalations", () => {
  it("keeps well-formed entries in order", () => {
    expect(sanitizeRaidEscalations([RAISED, NOTIFY])).toEqual([RAISED, NOTIFY]);
  });
  it("returns [] for anything that is not an array", () => {
    for (const v of [undefined, null, "x", 3, {}]) expect(sanitizeRaidEscalations(v)).toEqual([]);
  });
  it("drops an entry with no parseable timestamp or no e-mail address", () => {
    expect(sanitizeRaidEscalations([{ ...RAISED, at: "yesterday" }, { ...RAISED, toEmail: "nobody" }, NOTIFY])).toEqual([NOTIFY]);
  });
  it("drops an unknown severity together with its other half", () => {
    expect(sanitizeRaidEscalations([{ ...RAISED, toSeverity: "Apocalyptic" }])).toEqual([
      { at: RAISED.at, toName: "Sam Placeholder", toEmail: "Fictional.Jordan@example.com", toResourceId: 2 },
    ]);
  });
  it("drops a non-positive or fractional resource id", () => {
    expect(sanitizeRaidEscalations([{ ...NOTIFY, toResourceId: 0 }, { ...NOTIFY, toResourceId: 1.5 }])).toEqual([NOTIFY, NOTIFY]);
  });
  it("strips a <br> tag from the recipient name, whatever its case, slash or attributes", () => {
    const names = ["Jane<br>Doe", "Jane<BR/>Doe", "Jane<br >Doe", "Jane <br class=\"x\"/> Doe", "Jane<br<br>>Doe"];
    const out = sanitizeRaidEscalations(names.map((toName) => ({ ...NOTIFY, toName })));
    expect(out.slice(0, 4).map((e) => e.toName)).toEqual(["Jane Doe", "Jane Doe", "Jane Doe", "Jane Doe"]);
    // A nested tag leaves stray brackets, but nothing `mdUnescape` would turn into a newline.
    expect(out[4].toName).not.toMatch(/<br\s*\/?>/i);
    // Positive control: a name with no tag is kept verbatim, and a name that was ONLY a tag is dropped.
    expect(sanitizeRaidEscalations([RAISED, { ...NOTIFY, toName: "<br>" }])).toEqual([RAISED, NOTIFY]);
  });
  it("does not blow up on a huge stored toName full of unclosed <br opens", () => {
    // BREAK_TAG's `\s*` and `[^>]*` backtrack to the end of the value from
    // every start, so stripping BEFORE the length cap measured ~15.6 s here
    // (the bare regex, ~4x per doubling, took ~23 s at 80k). The ceiling is deliberately loose — it fails
    // on the pattern class, not on a machine's speed.
    const toName = "<br ".repeat(80_000);
    const start = performance.now();
    const [entry] = sanitizeRaidEscalations([{ ...NOTIFY, toName }]);
    expect(performance.now() - start).toBeLessThan(1000);
    expect(entry.toName!.length).toBeLessThanOrEqual(RAID_ESCALATION_NAME_MAX);
  });
  it("strips a within-cap name exactly as stripBreakTags does", () => {
    const names = ["Ada Lovelace", "  Ada <br/> Lovelace  ", "Ada<BR class=\"x\">Lovelace", "a".repeat(RAID_ESCALATION_NAME_MAX)];
    const out = sanitizeRaidEscalations(names.map((toName) => ({ ...NOTIFY, toName })));
    expect(out.map((e) => e.toName)).toEqual(names.map(stripBreakTags));
  });
  it("drops a <br> tag the length cap cuts in half, but keeps a '<b' that was never one", () => {
    const pad = "a".repeat(RAID_ESCALATION_NAME_MAX - 2);
    const out = sanitizeRaidEscalations(
      [`${pad}<br>tail`, `${pad.slice(3)} <br class="x"/>tail`, `${pad}<bob>`, `${pad}<brx>`].map((toName) => ({ ...NOTIFY, toName })),
    );
    expect(out.map((e) => e.toName)).toEqual([pad, pad.slice(3), `${pad}<b`, `${pad}<b`]);
  });
  it("keeps only the newest RAID_ESCALATIONS_MAX entries", () => {
    const many = Array.from({ length: RAID_ESCALATIONS_MAX + 5 }, (_, i) => ({ ...NOTIFY, toEmail: `p${i}@example.com` }));
    const out = sanitizeRaidEscalations(many);
    expect(out).toHaveLength(RAID_ESCALATIONS_MAX);
    expect(out[0].toEmail).toBe("p5@example.com");
  });
});

describe("escalations cell codec", () => {
  it("encodes empty or absent to an empty cell so legacy rows stay byte-identical", () => {
    expect(encodeRaidEscalations(undefined)).toBe("");
    expect(encodeRaidEscalations([])).toBe("");
  });
  it("round-trips", () => {
    expect(decodeRaidEscalations(encodeRaidEscalations([RAISED, NOTIFY]))).toEqual([RAISED, NOTIFY]);
  });
  it("tolerates an empty or malformed cell", () => {
    expect(decodeRaidEscalations("")).toEqual([]);
    expect(decodeRaidEscalations("{not json")).toEqual([]);
  });
});

describe("isEscalationEmail", () => {
  it("accepts a well-formed address with no brackets", () => {
    expect(isEscalationEmail("jane@example.com")).toBe(true);
  });
  it("rejects a malformed address (delegates to isValidEmail)", () => {
    expect(isEscalationEmail("nobody")).toBe(false);
    expect(isEscalationEmail("")).toBe(false);
  });
  it("rejects an otherwise-valid-looking address carrying \"<\" or \">\"", () => {
    expect(isEscalationEmail("a<br>@b.co")).toBe(false);
    expect(isEscalationEmail("a@b.co>")).toBe(false);
    expect(isEscalationEmail("<a@b.co")).toBe(false);
  });
});

describe("requireEscalationRecipient — toEmail rejects \"<\"/\">\" too (fix-all-1)", () => {
  it("throws for a <br>-bearing address that would otherwise pass isValidEmail", () => {
    expect(() => requireEscalationRecipient({ toEmail: "a<br>@b.co" })).toThrow(/toEmail must be a valid email/);
  });
  it("throws for a delimiter-bearing address", () => {
    expect(() => requireEscalationRecipient({ toEmail: "a,b@x.com" })).toThrow(/toEmail must be a valid email/);
  });
});

describe("isEscalationWriteEmail — the WRITE leg (spec Part 1 dual-use split)", () => {
  it("refuses a delimiter-bearing address the load leg still accepts", () => {
    expect(isEscalationWriteEmail("a,b@x.com")).toBe(false);
    expect(isEscalationWriteEmail("a;b@x.com")).toBe(false);
    // Load leg unchanged: a stored escalation carrying it is not dropped.
    expect(isEscalationEmail("a,b@x.com")).toBe(true);
  });
  it("keeps the bracket refusal and accepts a plain address", () => {
    expect(isEscalationWriteEmail("a<br>@b.co")).toBe(false);
    expect(isEscalationWriteEmail("jane@example.com")).toBe(true);
  });
  it("requireEscalationRecipient refuses a delimiter-bearing address", () => {
    expect(() => requireEscalationRecipient({ toEmail: "a,b@x.com" })).toThrow(/toEmail must be a valid email/);
  });
});

describe("sanitizeRaidEscalations — drops an entry whose toEmail carries \"<\"/\">\" (fix-all-1)", () => {
  it("drops the entry rather than storing a bracket-bearing address verbatim", () => {
    const withBadEmail: RaidEscalation = { ...NOTIFY, toEmail: "a<br>@b.co" };
    expect(sanitizeRaidEscalations([withBadEmail, NOTIFY])).toEqual([NOTIFY]);
  });
});

describe("sanitizeRaidEscalations — unwraps Name <addr> before judging it (spec Part 2, Ruling Q5)", () => {
  it("keeps the entry carrying the bare address", () => {
    expect(sanitizeRaidEscalations([{ ...NOTIFY, toEmail: "Ops Team <ops@example.com>" }])).toEqual([NOTIFY]);
  });
  it("still drops a Name <addr> whose inner address is not write-safe", () => {
    expect(sanitizeRaidEscalations([{ ...NOTIFY, toEmail: "Ops <nope>" }, NOTIFY])).toEqual([NOTIFY]);
  });
});

describe("lastEscalation", () => {
  it("returns the newest (last) entry", () => {
    expect(lastEscalation({ escalations: [RAISED, NOTIFY] })).toEqual(NOTIFY);
  });
  it("returns undefined for none, a non-array, or a malformed last entry", () => {
    expect(lastEscalation({})).toBeUndefined();
    expect(lastEscalation({ escalations: [] })).toBeUndefined();
    expect(lastEscalation({ escalations: "oops" as unknown as RaidEscalation[] })).toBeUndefined();
    expect(lastEscalation({ escalations: [{ at: 7 } as unknown as RaidEscalation] })).toBeUndefined();
  });
});
