// src/test/sweep-probes.test.ts
import { describe, expect, it } from "vitest";

import { same } from "./inline-sweep-fixtures";
import { declaredProperties, ENTITIES, schemaProperty } from "./offered-surface-axis";
import {
  admitProbe,
  ADMISSION_ORACLE,
  changedInKind,
  type Compare,
  isBlank,
  probeFor,
} from "./sweep-probes";

const sameAt: Compare = (a, b) => same(a, b);

describe("changedInKind", () => {
  it.each([
    [true, false],
    [false, true],
    [4, 5],
    ["2026-01-31", "2026-02-01"],
    ["14:00", "15:00"],
    ["23:30", "00:30"],
    ["2026-07-08T10:00:00.000Z", "2026-07-09T10:00:00.000Z"],
    ["m.Jordan@example.com", "m.Jordan+probed@example.com"],
    ["Room 1", "Room 1 probed"],
    [[1, 2, 3], [2, 3]],
    [[1], []],
  ])("changes %j into %j", (input, expected) => {
    expect(changedInKind(input)).toEqual(expected);
  });

  it.each([[""], [[]], [{}], [null], [undefined]])("has nothing to derive from %j", (input) => {
    expect(changedInKind(input)).toBeUndefined();
  });

  // A regex-valid YYYY-MM-DD can still be calendar-invalid: `Date.parse`
  // rejects an out-of-range month or day (unlike a day that merely overflows
  // its own month, which rolls over silently — `isoDateOrUndefined` in
  // calendar-event.ts). Without a guard the resulting Invalid Date throws a
  // RangeError from `.toISOString()`.
  it("has nothing to derive from a calendar-invalid date", () => {
    expect(changedInKind("2026-01-32")).toBeUndefined();
    expect(changedInKind("2026-13-01")).toBeUndefined();
  });

  // `Infinity + 1 === Infinity` and `NaN` is never "different from it".
  it("has nothing to derive from a non-finite number", () => {
    expect(changedInKind(Infinity)).toBeUndefined();
    expect(changedInKind(NaN)).toBeUndefined();
  });

  // ★★ A free-text leaf is the change most likely to be refused inside a
  //  structured value (a closed vocabulary such as a recurrence `freq`), so
  //  the object branch changes a number, boolean, date or time leaf first.
  it("changes a structured value's numeric leaf before its free text", () => {
    expect(changedInKind({ freq: "weekly", interval: 2, byDay: ["WE"] })).toEqual({
      freq: "weekly",
      interval: 3,
      byDay: ["WE"],
    });
  });

  it("falls back to a string leaf when an object has nothing else", () => {
    expect(changedInKind({ a: "x" })).toEqual({ a: "x probed" });
  });
});

describe("isBlank", () => {
  it.each([[undefined], [null], [""], [[]], [{}]])("%j is blank", (v) => expect(isBlank(v)).toBe(true));
  it.each([[false], [0], ["a"], [[0]], [{ a: 1 }], [{ a: "" }]])("%j is not blank", (v) => expect(isBlank(v)).toBe(false));
});

describe("ADMISSION_ORACLE", () => {
  it("names a writer sanitizer for every inline entity and both arms", () => {
    expect(Object.keys(ADMISSION_ORACLE).sort()).toEqual([...ENTITIES].sort());
  });
});

describe("admitProbe", () => {
  const absence = { id: 1, assignee: "Ada Lovelace", startDate: "2026-06-01", endDate: "2026-06-02" };

  it("admits a probe the writer's sanitizer keeps as sent", () => {
    expect(admitProbe("absence", "create", "startDate", absence, "2026-06-02", sameAt)).toBeUndefined();
  });

  // §459's absence probe: later than the end, so `sanitizeAbsence` orders the pair.
  it("refuses a probe the writer's sanitizer reshapes, and says what it became", () => {
    expect(admitProbe("absence", "create", "startDate", absence, "2026-06-03", sameAt)).toMatch(/reshapes/);
  });

  // §441's recurrence probe: `sanitizeRecurrence` drops a non-object.
  it("refuses a string sent to a structured field", () => {
    const meeting = { id: 2, title: "Sync", startDate: "2026-06-01", startTime: "09:00", durationMinutes: 30 };
    expect(admitProbe("calendarEvent", "create", "recurrence", meeting, "probed", sameAt)).toBeDefined();
  });

  // ★★ THE ONE WEAK ORACLE, PINNED SO NOBODY READS IT AS STRONG. Task has no
  //  row sanitizer, so its oracle is the at-rest store, which keeps a string
  //  that is not an address.
  it("admits nearly anything on task, whose oracle is the at-rest store alone", () => {
    expect(admitProbe("task", "create", "assigneeEmail", { id: 3, taskName: "A task" }, "not-an-address", sameAt)).toBeUndefined();
  });
});

describe("probeFor", () => {
  it("never derives a probe for a mail-unsafe field", () => {
    for (const arm of ["create", "update"] as const) {
      for (const sendInvitations of [undefined, false, true]) {
        const outcome = probeFor({
          entity: "calendarEvent",
          arm,
          field: "sendInvitations",
          declared: true,
          reference: { sendInvitations },
          seedRow: { sendInvitations: true },
          compare: sameAt,
        });
        expect(outcome.kind).toBe("dead");
      }
    }
  });

  it("takes a declared enum member that differs from the reference", () => {
    const found = ENTITIES.flatMap((entity) =>
      declaredProperties(entity, "create").map((field) => ({ entity, field, prop: schemaProperty(entity, "create", field) })),
    ).find((x) => (x.prop.enum?.length ?? 0) >= 2);
    expect(found, "no declared field carries a 2+ member enum, so this case is vacuous").toBeDefined();
    const { entity, field, prop } = found!;
    const outcome = probeFor({
      entity, arm: "create", field, declared: true,
      reference: { [field]: prop.enum![0] }, seedRow: {}, compare: sameAt,
    });
    // Admission may still refuse it on this bare reference row; the DERIVATION is what is pinned.
    if (outcome.kind === "probe") expect(outcome.value).not.toEqual(prop.enum![0]);
    else expect(outcome.kind).not.toBe("dead");
  });

  // Pins the premise the `probeFor` docstring relies on: a declared enum
  // short enough for every member to already equal the reference (1 distinct
  // member, or all members duplicates of one another) would make the enum
  // branch's "every member already equals the reference" dead case reachable
  // — and that case would then need its own test, which this file does not
  // have. A prose count rots; this recomputes it.
  it("has no declared enum with fewer than two distinct members", () => {
    const enums = ENTITIES.flatMap((entity) =>
      (["create", "update"] as const).flatMap((op) =>
        declaredProperties(entity, op)
          .map((field) => schemaProperty(entity, op, field).enum)
          .filter((e): e is readonly string[] => e !== undefined),
      ),
    );
    expect(enums.length, "no declared enum was found at all — the scan itself is broken").toBeGreaterThan(0);
    for (const e of enums) {
      expect(
        new Set(e).size,
        `enum ${JSON.stringify(e)} has fewer than two distinct members — the "every member already equals the reference" dead case is now reachable and needs its own test`,
      ).toBeGreaterThanOrEqual(2);
    }
  });

  // The enum source is EXCLUSIVE of the other two, even when one of them also
  // carries a usable value — `task.priority` is a real 4-member enum. No
  // declared field has a 1-member (or all-duplicate) enum today — pinned by
  // "has no declared enum with fewer than two distinct members" above — so
  // the "every member already equals the reference" dead case cannot be
  // exercised through the real schema and is not faked here.
  it("keeps the enum source exclusive of the seed, even when the seed carries a usable value", () => {
    const outcome = probeFor({
      entity: "task", arm: "create", field: "priority", declared: true,
      reference: { priority: "Low" }, seedRow: { priority: "NotAMember" }, compare: sameAt,
    });
    expect(outcome).toEqual({ kind: "probe", value: "Medium" });
  });

  // §459's task probe: the create reference holds no email, so the SEEDED address is sent as is.
  it("sends the seeded value as is when the reference carries none", () => {
    const outcome = probeFor({
      entity: "task", arm: "create", field: "assigneeEmail", declared: true,
      reference: { id: 1, taskName: "A task" }, seedRow: { assigneeEmail: "m.Jordan@example.com" }, compare: sameAt,
    });
    expect(outcome).toEqual({ kind: "probe", value: "m.Jordan@example.com" });
  });

  // `raci` is undeclared on both stakeholder tools (AGENTS.md's own §438 list),
  // so `declared: false` here is realistic, not a shortcut. The reference's
  // raci map is a non-blank object (isBlank only checks key COUNT) whose one
  // entry is an invalid leaf — `coerceRaciMap` (sanitize-records.ts) drops a
  // value outside RACI_SET — so `changedInKind` derives nothing from it. The
  // seed's entry is one `coerceRaciMap` keeps unchanged.
  it("falls through to the seed when the reference is a thin object with only blank leaves", () => {
    const outcome = probeFor({
      entity: "stakeholder", arm: "create", field: "raci", declared: false,
      reference: { id: 1, name: "Ada Lovelace", raci: { "1": "" } },
      seedRow: { raci: { "3": "R" } },
      compare: sameAt,
    });
    expect(outcome).toEqual({ kind: "probe", value: { "3": "R" } });
  });

  it("is dead when there is nothing to derive from", () => {
    const outcome = probeFor({
      entity: "absence", arm: "update", field: "note", declared: false,
      reference: { id: 1 }, seedRow: { id: 1 }, compare: sameAt,
    });
    expect(outcome.kind).toBe("dead");
  });

  it("is unmeasured when the writer's sanitizer will not hold the derived probe", () => {
    const outcome = probeFor({
      entity: "absence", arm: "create", field: "startDate", declared: false,
      reference: { id: 1, assignee: "Ada Lovelace", startDate: "2026-06-02", endDate: "2026-06-02" },
      seedRow: {}, compare: sameAt,
    });
    // 2026-06-02 + 1 day is later than the end date, so `sanitizeAbsence` swaps the pair.
    expect(outcome.kind).toBe("unmeasured");
  });

  // The declared `status` enum is the UNION of all four RAID categories'
  // vocabularies (`ALL_RAID_STATUSES`, chat-tool-defs.ts), but `sanitizeRaidItem`
  // (sanitize-records.ts) accepts only the row's OWN category's subset
  // (`statusSetForCategory`) and falls back to that subset's first member on a
  // mismatch. The union's first member, "Open", is a RISK status — refused for
  // an Assumption row. A derivation that stopped at the first DIFFERING member
  // would land on "Open", which the writer reshapes to "Pending"; walking past
  // it to the next differing member the writer actually admits ("Pending"
  // itself, the first member of `ASSUMPTION_STATUSES`) keeps the probe live.
  it("walks past an enum member the writer refuses to the next differing one it admits", () => {
    const outcome = probeFor({
      entity: "raid", arm: "update", field: "status", declared: true,
      reference: { id: 10, category: "A", title: "R", status: "Validated" },
      seedRow: { id: 10, category: "A", title: "R", status: "Validated" },
      compare: sameAt,
    });
    expect(outcome).toEqual({ kind: "probe", value: "Pending" });
  });
});
