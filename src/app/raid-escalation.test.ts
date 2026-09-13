import { describe, expect, it } from "vitest";
import {
  decodeRaidEscalations,
  encodeRaidEscalations,
  lastEscalation,
  RAID_ESCALATIONS_MAX,
  sanitizeRaidEscalations,
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
