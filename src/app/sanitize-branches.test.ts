// src/app/sanitize-branches.test.ts — targeted validator-branch coverage for the
// sanitize* modules (TD-4). Each case asserts a real reject / fallback / clamp
// path (malformed or partial untrusted input → the documented safe result), the
// branches unit tests most often skip. Complements the per-entity happy-path
// suites (sanitize.test, sanitize-raid/change/stakeholder/budget, sanitize.project).
import { describe, it, expect } from "vitest";
import {
  sanitizeVoiceTranscript,
  sanitizeLabels,
  sanitizeDependencies,
  wouldCreateDependencyCycle,
  dropDanglingDependencies,
  parseDependenciesString,
  serializeDependencies,
  sanitizeAbsence,
  sanitizeShift,
  encodePeriodMap,
  decodePeriodMap,
  sanitizeResource,
  sanitizeRole,
  sanitizeDiscipline,
  sanitizeGrade,
  sanitizePlan,
  sanitizeIdList,
  decodeAllocations,
  decodeDisciplineAllocations,
  sanitizeBudgetBucket,
  sanitizeFxRates,
  sanitizeBirthday,
  sanitizeMilestone,
  sanitizeChangeItem,
  sanitizeRaidItem,
  encodeRaciMap,
  decodeRaciMap,
  sanitizeStakeholder,
  sanitizeProjectMeta,
  sanitizeSteeringCommittee,
  sanitizeTimezone,
} from "./sanitize";
import { describeTextCap, describeClamp, describeLabelStrip } from "./sanitize-report";
import type { Task, TaskDependency } from "./types";

// --- sanitize-core: primitives & dependency helpers ------------------------

describe("sanitize-core primitives — reject/fallback arms", () => {
  it("sanitizeVoiceTranscript returns '' for a non-string (clipText guard)", () => {
    expect(sanitizeVoiceTranscript(undefined as unknown as string)).toBe("");
    expect(sanitizeVoiceTranscript(42 as unknown as string)).toBe("");
  });

  it("sanitizeLabels caps at LABELS_MAX_COUNT (20) and de-dupes case-insensitively", () => {
    const many = Array.from({ length: 30 }, (_, i) => `L${i}`);
    expect(sanitizeLabels(many)).toHaveLength(20);
    expect(sanitizeLabels(["A", "a", "  A  "])).toEqual(["A"]);
    expect(sanitizeLabels(123)).toEqual([]); // non-array, non-string
    expect(sanitizeLabels("x|y|x")).toEqual(["x", "y"]); // string split path
  });
});

describe("sanitizeDependencies — every drop arm", () => {
  const known = new Set([1, 2, 3]);
  it("returns [] for a non-array input", () => {
    expect(sanitizeDependencies("nope", known, null)).toEqual([]);
  });
  it("drops non-object, bad-taskId, bad-type, self-loop, unknown, and duplicate entries", () => {
    const out = sanitizeDependencies(
      [
        "str", // not an object
        { taskId: "x", type: "FS" }, // taskId not a number
        { taskId: Infinity, type: "FS" }, // not finite
        { taskId: 1, type: "NOPE" }, // bad type
        { taskId: 9, type: "FS" }, // self-loop (ownTaskId 9)
        { taskId: 99, type: "FS" }, // unknown id
        { taskId: 1, type: "FS" }, // kept
        { taskId: 1, type: "FS" }, // duplicate → dropped
      ],
      known,
      9,
    );
    expect(out).toEqual([{ taskId: 1, type: "FS" }]);
  });
  it("caps the list at DEPENDENCIES_MAX_COUNT (20)", () => {
    const big = new Set(Array.from({ length: 40 }, (_, i) => i + 1));
    const input = Array.from({ length: 40 }, (_, i) => ({ taskId: i + 1, type: "FS" }));
    expect(sanitizeDependencies(input, big, null)).toHaveLength(20);
  });
});

describe("wouldCreateDependencyCycle — graph walk arms", () => {
  const mk = (deps: TaskDependency[]): Task =>
    ({ dependencies: deps } as unknown as Task);
  it("true when own === candidate (trivial self)", () => {
    expect(wouldCreateDependencyCycle(5, 5, new Map())).toBe(true);
  });
  it("true when the candidate's chain reaches ownTaskId", () => {
    const map = new Map<number, Task>([
      [2, mk([{ taskId: 3, type: "FS" }])],
      [3, mk([{ taskId: 1, type: "FS" }])], // 2 → 3 → 1(own)
    ]);
    expect(wouldCreateDependencyCycle(1, 2, map)).toBe(true);
  });
  it("false, and tolerates visited revisits + dep-less nodes (diamond, no cycle)", () => {
    const map = new Map<number, Task>([
      [2, mk([{ taskId: 4, type: "FS" }, { taskId: 5, type: "FS" }])],
      [4, mk([{ taskId: 6, type: "FS" }])],
      [5, mk([{ taskId: 6, type: "FS" }])], // 6 reached twice → visited-skip
      [6, mk([])], // dep-less
    ]);
    expect(wouldCreateDependencyCycle(1, 2, map)).toBe(false);
  });
});

describe("dropDanglingDependencies — reference-equality arms", () => {
  const mk = (id: number, deps?: TaskDependency[]): Task =>
    ({ id, dependencies: deps } as unknown as Task);
  it("returns each task by reference when nothing is dangling", () => {
    const a = mk(1, [{ taskId: 2, type: "FS" }]);
    const b = mk(2); // no dependencies → untouched
    const out = dropDanglingDependencies([a, b]);
    expect(out[0]).toBe(a);
    expect(out[1]).toBe(b);
  });
  it("returns a NEW task with dangling + self refs filtered out", () => {
    const a = mk(1, [
      { taskId: 1, type: "FS" }, // self → dropped
      { taskId: 2, type: "FS" }, // kept
      { taskId: 99, type: "FS" }, // dangling → dropped
    ]);
    const [cleaned] = dropDanglingDependencies([a, mk(2)]);
    expect(cleaned).not.toBe(a);
    expect(cleaned.dependencies).toEqual([{ taskId: 2, type: "FS" }]);
  });
});

describe("dependency string codec — parse/serialize arms", () => {
  it("parseDependenciesString drops empty parts, bad types, non-positive ids, and dupes; caps at 20", () => {
    expect(parseDependenciesString(123)).toEqual([]); // non-string
    expect(parseDependenciesString("|FS:2|NOPE:3|FS:0|FS:-1|FS:2|SS:2")).toEqual([
      { taskId: 2, type: "FS" },
      { taskId: 2, type: "SS" },
    ]);
    const many = Array.from({ length: 40 }, (_, i) => `FS:${i + 1}`).join("|");
    expect(parseDependenciesString(many)).toHaveLength(20);
  });
  it("serializeDependencies encodes valid entries and skips malformed ones", () => {
    expect(serializeDependencies(undefined)).toBe("");
    expect(
      serializeDependencies([
        { taskId: 2, type: "FS" },
        { taskId: Infinity, type: "SS" } as unknown as TaskDependency, // dropped
      ]),
    ).toBe("FS:2");
  });
});

// --- sanitize-report: describe* adjustment reporters ------------------------

describe("sanitize-report — reporter branches", () => {
  it("describeTextCap: non-string → '', no adjustment; under cap → unchanged; over cap → truncated", () => {
    expect(describeTextCap(5 as unknown as string, 3)).toEqual({ value: "", adjustment: null });
    expect(describeTextCap("hi", 3)).toEqual({ value: "hi", adjustment: null });
    expect(describeTextCap("hello", 3)).toEqual({
      value: "hel",
      adjustment: { kind: "truncated", max: 3, removed: 2 },
    });
  });
  it("describeClamp: blank → undefined; NaN → min; below min / above max clamp with rounding", () => {
    expect(describeClamp("  ", { min: 0 })).toEqual({ value: undefined, adjustment: null });
    expect(describeClamp("abc", { min: 2 })).toEqual({
      value: 2,
      adjustment: { kind: "clamped", bound: "min", to: 2 },
    });
    expect(describeClamp("1", { min: 5 }).value).toBe(5);
    expect(describeClamp("9", { max: 4 }).adjustment).toEqual({ kind: "clamped", bound: "max", to: 4 });
    expect(describeClamp("3.14159", { round: 2 })).toEqual({ value: 3.14, adjustment: null });
  });
  it("describeLabelStrip: non-string → ''; clean → no adjustment; separators → stripped chars", () => {
    expect(describeLabelStrip(1 as unknown as string)).toEqual({ value: "", adjustment: null });
    expect(describeLabelStrip("clean")).toEqual({ value: "clean", adjustment: null });
    const r = describeLabelStrip("a|b,c\td\ne");
    expect(r.value).toBe("a b c d e");
    expect(r.adjustment).toEqual({ kind: "stripped", chars: ["|", ",", "\\t", "\\n"] });
  });
});

// --- sanitize-entities -----------------------------------------------------

describe("sanitizeAbsence — reject + swap arms", () => {
  it("returns null for non-object, missing id, missing assignee, or bad dates", () => {
    expect(sanitizeAbsence(null)).toBeNull();
    expect(sanitizeAbsence({ id: 0, assignee: "A", startDate: "2026-01-01", endDate: "2026-01-02" })).toBeNull();
    expect(sanitizeAbsence({ id: 1, assignee: "", startDate: "2026-01-01", endDate: "2026-01-02" })).toBeNull();
    expect(sanitizeAbsence({ id: 1, assignee: "A", startDate: "bad", endDate: "2026-01-02" })).toBeNull();
  });
  it("swaps reversed dates and defaults an unknown type to 'other'", () => {
    const a = sanitizeAbsence({ id: 1, assignee: "A", startDate: "2026-02-10", endDate: "2026-02-01", type: "??" });
    expect(a?.startDate).toBe("2026-02-01");
    expect(a?.endDate).toBe("2026-02-10");
    expect(a?.type).toBe("other");
  });
});

describe("sanitizeShift — hours-input variants + clampHour bounds", () => {
  it("returns null for non-object or missing assignee", () => {
    expect(sanitizeShift(5)).toBeNull();
    expect(sanitizeShift({ id: 1, assignee: "" })).toBeNull();
  });
  it("accepts the 7 individual weekday fields and clamps negatives→0, over-max→MAX", () => {
    const s = sanitizeShift({
      id: 1, assignee: "A",
      sunHours: -3, monHours: 999, tueHours: 8, wedHours: "", thuHours: 7.049, friHours: 8, satHours: 0,
    });
    expect(s?.hoursPerWeekday[0]).toBe(0); // negative clamped
    expect(s?.hoursPerWeekday[1]).toBe(24); // MAX_HOURS_PER_DAY
    expect(s?.hoursPerWeekday[4]).toBe(7); // rounded to 1 decimal
  });
  it("accepts a pipe-joined string and an object keyed by full weekday names", () => {
    const fromStr = sanitizeShift({ id: 1, assignee: "A", hoursPerWeekday: "0|8|8|8|8|8|0" });
    expect(fromStr?.hoursPerWeekday).toEqual([0, 8, 8, 8, 8, 8, 0]);
    const fromObj = sanitizeShift({ id: 1, assignee: "A", hoursPerWeekday: { monday: 6, friday: 6 } });
    expect(fromObj?.hoursPerWeekday[1]).toBe(6);
    expect(fromObj?.hoursPerWeekday[5]).toBe(6);
  });
});

describe("period-map codec — drop arms", () => {
  it("encodePeriodMap drops non-period keys and non-finite values", () => {
    expect(encodePeriodMap(undefined)).toBe("");
    expect(encodePeriodMap({ "2026-01": 5, "bad": 9, "2026-02": Infinity })).toBe("2026-01=5");
  });
  it("decodePeriodMap ignores non-string, key-less parts, and malformed keys/values", () => {
    expect(decodePeriodMap(9)).toEqual({});
    expect(decodePeriodMap("2026-01=5|noeq|=7|bad=1|2026-13=2")).toEqual({ "2026-01": 5 });
  });
});

describe("sanitizeResource — name-fallback + null arms", () => {
  it("returns null for non-object and for a record with no usable name", () => {
    expect(sanitizeResource(3)).toBeNull();
    expect(sanitizeResource({ id: 1 })).toBeNull();
  });
  it("splits a legacy `name` when firstName/lastName are absent", () => {
    const r = sanitizeResource({ id: 1, name: "Ada Lovelace" });
    expect(r?.firstName).toBe("Ada");
    expect(r?.lastName).toBe("Lovelace");
  });
  it("clamps utilization to 100 in percent mode and keeps roleId only when > 0", () => {
    const r = sanitizeResource({ id: 1, firstName: "A", utilizationMode: "percent", roleId: 0, utilization: { "2026-01": 250 } });
    expect(r?.roleId).toBeNull();
    expect(r?.utilization["2026-01"]).toBe(100);
  });
});

describe("sanitizeBirthday", () => {
  it("keeps MM-DD and YYYY-MM-DD, drops non-strings and malformed", () => {
    expect(sanitizeBirthday("02-29")).toBe("02-29");
    expect(sanitizeBirthday("1990-12-31")).toBe("1990-12-31");
    expect(sanitizeBirthday(5)).toBeUndefined();
    expect(sanitizeBirthday("13-40")).toBeUndefined();
  });
});

describe("sanitizeRole / named refs — reject + optional arms", () => {
  it("sanitizeRole returns null unless id, disciplineId, gradeId are all positive", () => {
    expect(sanitizeRole({ id: 1, disciplineId: 0, gradeId: 2 })).toBeNull();
    const r = sanitizeRole({ id: 1, disciplineId: 2, gradeId: 3, internalRate: -5, externalRate: 12.005, localModifiedAt: "t" });
    expect(r?.internalRate).toBe(0); // negative → 0
    expect(r?.externalRate).toBe(12.01); // rounded to cents
    expect(r?.localModifiedAt).toBe("t");
  });
  it("sanitizeDiscipline / sanitizeGrade reject non-objects and empty names", () => {
    expect(sanitizeDiscipline(null)).toBeNull();
    expect(sanitizeDiscipline({ id: 0, name: "X" })).toBeNull();
    expect(sanitizeGrade({ id: 1, name: "" })).toBeNull();
    expect(sanitizeGrade({ id: 1, name: "Senior", localModifiedAt: "t" })?.localModifiedAt).toBe("t");
  });
});

describe("sanitizePlan — fallback + swap arms", () => {
  it("replaces the window with the default when either date is missing, honouring granularity+currency", () => {
    const p = sanitizePlan({ granularity: "week", currency: " USD " }, "2026-01-01");
    expect(p.granularity).toBe("week");
    expect(p.currency).toBe("USD");
    expect(p.startDate).toBe("2026-01-01"); // default window start = today
  });
  it("swaps reversed dates and defaults granularity to month for a non-object", () => {
    const p = sanitizePlan({ startDate: "2026-06-01", endDate: "2026-01-01" }, "2026-01-01");
    expect([p.startDate, p.endDate]).toEqual(["2026-01-01", "2026-06-01"]);
    expect(sanitizePlan(42, "2026-01-01").granularity).toBe("month");
  });
});

describe("id-list + allocation codecs — drop arms", () => {
  it("sanitizeIdList accepts arrays and dot-joined strings, de-dupes, drops non-positive", () => {
    expect(sanitizeIdList(5)).toEqual([]);
    expect(sanitizeIdList("1.2.2.0.-3.4")).toEqual([1, 2, 4]);
  });
  it("decodeAllocations / decodeDisciplineAllocations skip blank + bad-id parts", () => {
    expect(decodeAllocations(9)).toEqual([]);
    const a = decodeAllocations("~0;1.2;;~3;4;2026-01=5;");
    expect(a).toHaveLength(1);
    expect(a[0].roleId).toBe(3);
    const d = decodeDisciplineAllocations("bad;;;~7;1;;");
    expect(d[0].disciplineId).toBe(7);
  });
});

describe("sanitizeBudgetBucket / sanitizeFxRates — reject arms", () => {
  it("bucket returns null for non-object, missing id, or empty name", () => {
    expect(sanitizeBudgetBucket(1)).toBeNull();
    expect(sanitizeBudgetBucket({ id: 0, name: "X" })).toBeNull();
    expect(sanitizeBudgetBucket({ id: 1, name: "" })).toBeNull();
  });
  it("bucket keeps optional fields (fixed price, order, localModifiedAt) via their guards", () => {
    const b = sanitizeBudgetBucket({
      id: 1, name: "B", type: "fixed", fixedPriceAmount: 1000, order: 3, localModifiedAt: "t",
      status: "closed", closedDate: "2026-02-01",
    });
    expect(b?.fixedPriceAmount).toBe(1000);
    expect(b?.order).toBe(3);
    expect(b?.status).toBe("closed");
    expect(b?.localModifiedAt).toBe("t");
  });
  it("fxRates returns null unless base is EUR with a valid date and fetchedAt", () => {
    expect(sanitizeFxRates(null)).toBeNull();
    expect(sanitizeFxRates({ base: "USD", date: "2026-01-01", fetchedAt: "t" })).toBeNull();
    expect(sanitizeFxRates({ base: "EUR", date: "bad", fetchedAt: "t" })).toBeNull();
    expect(sanitizeFxRates({ base: "EUR", date: "2026-01-01", fetchedAt: "" })).toBeNull();
    const fx = sanitizeFxRates({ base: "EUR", date: "2026-01-01", fetchedAt: "t", rates: { USD: 1.1, JUNK: 2 } });
    expect(fx?.rates.EUR).toBe(1);
    expect(fx?.rates.USD).toBe(1.1);
  });
});

// --- sanitize-records ------------------------------------------------------

describe("sanitizeMilestone / sanitizeChangeItem / sanitizeRaidItem — arms", () => {
  it("milestone keeps a string outlookEventId and rejects non-objects", () => {
    expect(sanitizeMilestone(3)).toBeNull();
    const m = sanitizeMilestone({ id: 1, name: "M", date: "2026-01-01", outlookEventId: "EV" });
    expect(m?.outlookEventId).toBe("EV");
    expect(sanitizeMilestone({ id: 1, name: "M", date: "2026-01-01", outlookEventId: 5 })?.outlookEventId).toBeUndefined();
  });
  it("changeItem rejects non-objects and defaults unknown type/status", () => {
    expect(sanitizeChangeItem(null)).toBeNull();
    const c = sanitizeChangeItem({ id: 1, title: "T", type: "??", status: "??" });
    expect(c?.type).toBe("Other");
    expect(c?.status).toBe("Proposed");
  });
  it("raidItem defaults category→R and status→first-of-category, keeps closedDate", () => {
    expect(sanitizeRaidItem(1)).toBeNull();
    const r = sanitizeRaidItem({ id: 1, title: "T", category: "??", status: "??", closedDate: "2026-03-01" });
    expect(r?.category).toBe("R");
    expect(r?.closedDate).toBe("2026-03-01");
    // category "A" uses the assumption status set for its default
    const a = sanitizeRaidItem({ id: 1, title: "T", category: "A", status: "??" });
    expect(a?.category).toBe("A");
  });
});

describe("RACI map codec — drop arms", () => {
  it("encodeRaciMap handles undefined and filters bad keys/roles", () => {
    expect(encodeRaciMap(undefined)).toBe("");
    expect(encodeRaciMap({ "5": "R", bad: "R", "6": "Z" as never })).toBe("5=R");
  });
  it("decodeRaciMap ignores key-less parts and unknown roles", () => {
    expect(decodeRaciMap(9)).toEqual({});
    expect(decodeRaciMap("5=R|noeq|6=Z|7=A")).toEqual({ "5": "R", "7": "A" });
  });
});

describe("sanitizeStakeholder — reject + coerce arms", () => {
  it("returns null for non-object / missing id / empty name", () => {
    expect(sanitizeStakeholder(2)).toBeNull();
    expect(sanitizeStakeholder({ id: 1, name: "" })).toBeNull();
  });
  it("defaults unknown category/influence/interest and coerces a raci string map", () => {
    const s = sanitizeStakeholder({ id: 1, name: "S", category: "??", influence: "??", interest: "??", raci: "5=R|6=A" });
    expect(s?.category).toBe("Other");
    expect(s?.influence).toBe("Medium");
    expect(s?.raci).toEqual({ "5": "R", "6": "A" });
  });
});

describe("sanitizeProjectMeta — remaining required + array arms", () => {
  const valid = {
    name: "Apollo", code: "APL-1", projectManager: "Jane",
    keyStakeholdersInternal: ["Bob"], keyStakeholdersExternal: ["Cara"],
    customer: "Acme", naceSection: "C", identityTypes: ["B2B"],
    products: "Widget", deployment: "Cloud",
    startDate: "2026-01-01", endDate: "2026-12-31", profitCenter: "PC-9",
    contactPersons: [{ name: "Dee", email: "dee@acme.test", synced: true }],
    regulatory: ["NIS2"],
  };
  it("returns null when code / projectManager / products / profitCenter is blank", () => {
    expect(sanitizeProjectMeta({ ...valid, code: "" })).toBeNull();
    expect(sanitizeProjectMeta({ ...valid, projectManager: "" })).toBeNull();
    expect(sanitizeProjectMeta({ ...valid, products: "" })).toBeNull();
    expect(sanitizeProjectMeta({ ...valid, profitCenter: "" })).toBeNull();
  });
  it("treats a missing/blank endDate as '' and tolerates non-array regulatory/identity/contacts", () => {
    expect(sanitizeProjectMeta({ ...valid, endDate: "bad" })?.endDate).toBe("");
    // regulatory not an array → empty → null (required unless lenient)
    expect(sanitizeProjectMeta({ ...valid, regulatory: "NIS2" })).toBeNull();
    // lenient mode keeps an empty regulatory array
    expect(sanitizeProjectMeta({ ...valid, regulatory: [] }, { lenientRequiredArrays: true })?.regulatory).toEqual([]);
    // non-string + duplicate regulatory members are skipped
    expect(sanitizeProjectMeta({ ...valid, regulatory: [5, "NIS2", "NIS2"] })?.regulatory).toEqual(["NIS2"]);
    // non-array identityTypes / contactPersons → []
    const m = sanitizeProjectMeta({ ...valid, identityTypes: "B2B", contactPersons: "nope" });
    expect(m?.identityTypes).toEqual([]);
    expect(m?.contactPersons).toEqual([]);
  });
});

describe("sanitizeTimezone", () => {
  it("keeps a valid IANA zone and drops junk/non-string", () => {
    expect(sanitizeTimezone("Europe/Berlin")).toBe("Europe/Berlin");
    expect(sanitizeTimezone("Mars/Phobos")).toBeUndefined();
    expect(sanitizeTimezone(5)).toBeUndefined();
  });
});

describe("sanitizeSteeringCommittee — defensive decode arms", () => {
  it("returns undefined for absent/garbage input", () => {
    expect(sanitizeSteeringCommittee(null)).toBeUndefined();
    expect(sanitizeSteeringCommittee("x")).toBeUndefined();
  });
  it("caps strings, drops bad members/meetings/schedules, keeps optional maps", () => {
    const c = sanitizeSteeringCommittee({
      name: 5, // non-string → ""
      memberResourceIds: [1, 2, "x", 2], // keep numbers, de-dupe
      meetings: [
        "bad", // non-object → dropped
        { id: "x", date: "2026-01-01" }, // non-number id → dropped
        { id: 1, date: "nope" }, // bad date → dropped
        { id: 2, date: "2026-01-01", title: "Kickoff", agenda: "A", location: "Room", outlookEventId: "EV" },
      ],
      infoSchedules: [
        { nope: true }, // no id → dropped
        { id: 7, label: "Weekly", leadDays: -4 }, // negative → 0
      ],
      infoReminderEventIds: { "2:1": "EID", bad: 9 },
      pendingDeleteEventIds: ["a", "a", 5],
    });
    expect(c?.name).toBe("");
    expect(c?.memberResourceIds).toEqual([1, 2]);
    expect(c?.meetings).toHaveLength(1);
    expect(c?.meetings[0]).toMatchObject({ id: 2, agenda: "A", location: "Room", outlookEventId: "EV" });
    expect(c?.infoSchedules[0].leadDays).toBe(0);
    expect(c?.infoReminderEventIds).toEqual({ "2:1": "EID" });
    expect(c?.pendingDeleteEventIds).toEqual(["a"]);
  });
});
