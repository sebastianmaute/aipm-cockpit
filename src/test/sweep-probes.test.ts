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
  it.each([[false], [0], ["a"], [[0]], [{ a: 1 }]])("%j is not blank", (v) => expect(isBlank(v)).toBe(false));
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

  // §459's task probe: the create reference holds no email, so the SEEDED address is sent as is.
  it("sends the seeded value as is when the reference carries none", () => {
    const outcome = probeFor({
      entity: "task", arm: "create", field: "assigneeEmail", declared: true,
      reference: { id: 1, taskName: "A task" }, seedRow: { assigneeEmail: "m.Jordan@example.com" }, compare: sameAt,
    });
    expect(outcome).toEqual({ kind: "probe", value: "m.Jordan@example.com" });
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
});
