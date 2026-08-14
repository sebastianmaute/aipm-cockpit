import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  ACTIVITY_KIND_TO_KEY,
  activityGroupOf,
  appendActivity,
  appendActivityEntry,
  clearActivityLog,
  diffFields,
  humanizeFieldName,
  loadActivityLog,
  saveActivityLog,
  type ActivityEntry,
  type ActivityKind,
} from "./activity-log";
import { de } from "./i18n.de";
import { t } from "./i18n";

// Mirrors the module-private constants. Kept here so the raw-localStorage
// injection tests (invalid-entry filtering) can target the real key.
const STORAGE_KEY = "aipm-cockpit:activity-log";
const DEVICE_ID_KEY = "aipm-cockpit:device-id";
const MAX = 500;

// Accepts a number for call-site brevity (most callers just need a sequence
// of distinct ids); stored/compared as the string ActivityEntry.id now is.
function entry(id: number | string, kind: ActivityKind = "task.created"): ActivityEntry {
  return { id: String(id), timestamp: "2026-06-02T00:00:00.000Z", kind, args: [] };
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("activityGroupOf", () => {
  test("maps kind prefixes to their group", () => {
    expect(activityGroupOf("task.completed")).toBe("tasks");
    expect(activityGroupOf("raid.autoIssue")).toBe("raid");
    expect(activityGroupOf("bulk.edit")).toBe("bulk");
    expect(activityGroupOf("jira.sync")).toBe("jira");
  });

  test("absence.* / shift.* / milestone.* map to 'general'", () => {
    expect(activityGroupOf("absence.created")).toBe("general");
    expect(activityGroupOf("absence.updated")).toBe("general");
    expect(activityGroupOf("absence.deleted")).toBe("general");
    expect(activityGroupOf("shift.created")).toBe("general");
    expect(activityGroupOf("shift.deleted")).toBe("general");
    expect(activityGroupOf("milestone.created")).toBe("general");
    expect(activityGroupOf("milestone.updated")).toBe("general");
    expect(activityGroupOf("milestone.deleted")).toBe("general");
  });

  test("change.* / stakeholder.* / resource.* / role.* / settings.updated map to 'general'", () => {
    expect(activityGroupOf("change.created")).toBe("general");
    expect(activityGroupOf("change.updated")).toBe("general");
    expect(activityGroupOf("change.deleted")).toBe("general");
    expect(activityGroupOf("stakeholder.created")).toBe("general");
    expect(activityGroupOf("stakeholder.updated")).toBe("general");
    expect(activityGroupOf("stakeholder.deleted")).toBe("general");
    expect(activityGroupOf("resource.created")).toBe("general");
    expect(activityGroupOf("resource.updated")).toBe("general");
    expect(activityGroupOf("resource.deleted")).toBe("general");
    expect(activityGroupOf("role.created")).toBe("general");
    expect(activityGroupOf("role.updated")).toBe("general");
    expect(activityGroupOf("role.deleted")).toBe("general");
    expect(activityGroupOf("settings.updated")).toBe("general");
  });
});

describe("appendActivity", () => {
  test("first entry gets a deviceId-counter id and stores the kind + args", () => {
    const [e] = appendActivity([], "task.created", "Alpha", 7);
    // Not pinned to a literal counter value: `counter` is module-scoped, so the
    // exact suffix depends on how many entries this file has already minted —
    // and this repo's BLOCKING test:shuffle gate reorders tests within a file.
    expect(e.id).toMatch(/^[A-Za-z0-9_-]+-\d+$/);
    expect(e.kind).toBe("task.created");
    expect(e.args).toEqual(["Alpha", 7]);
    expect(typeof e.timestamp).toBe("string");
  });

  test("does not mutate the input array (immutability)", () => {
    const current = [entry(1)];
    const next = appendActivity(current, "task.updated");
    expect(current).toHaveLength(1);
    expect(next).toHaveLength(2);
  });

  test("mints a fresh id independent of the input array's existing ids", () => {
    // Characterization of the CURRENT (deviceId-counter) minting: unlike the
    // retired per-log counter, the new id never derives from the array's
    // contents, so it is unrelated to (and never equal to) any existing id —
    // including a deliberately out-of-order / non-monotonic input.
    const withHighId = [entry(5)];
    const one = appendActivity(withHighId, "task.updated")[1];
    expect(one.id).not.toBe("5");
    expect(one.id).toMatch(/^[A-Za-z0-9_-]+-\d+$/);

    const withOutOfOrderIds = [entry(5), entry(2)];
    const two = appendActivity(withOutOfOrderIds, "task.updated")[2];
    expect(two.id).not.toBe("5");
    expect(two.id).not.toBe("2");
    expect(two.id).toMatch(/^[A-Za-z0-9_-]+-\d+$/);
  });

  test("caps at MAX entries, dropping the oldest", () => {
    const full = Array.from({ length: MAX }, (_, i) => entry(i + 1)); // ids "1".."500"
    const next = appendActivity(full, "task.deleted");
    expect(next).toHaveLength(MAX);
    expect(next[0].id).toBe("2"); // id "1" dropped
    expect(next[MAX - 1].kind).toBe("task.deleted"); // newest appended
    expect(next[MAX - 1].id).toMatch(/^[A-Za-z0-9_-]+-\d+$/);
  });
});

describe("loadActivityLog / saveActivityLog round-trip", () => {
  test("returns [] when nothing is stored", () => {
    expect(loadActivityLog()).toEqual([]);
  });

  test("round-trips saved entries", () => {
    const entries = [entry(1, "task.created"), entry(2, "raid.created")];
    saveActivityLog(entries);
    expect(loadActivityLog()).toEqual(entries);
  });

  test("saveActivityLog caps to the last MAX before writing", () => {
    const entries = Array.from({ length: MAX + 50 }, (_, i) => entry(i + 1)); // "1".."550"
    saveActivityLog(entries);
    const loaded = loadActivityLog();
    expect(loaded).toHaveLength(MAX);
    expect(loaded[0].id).toBe("51"); // "1".."50" dropped
  });

  test("clearActivityLog empties the store", () => {
    saveActivityLog([entry(1)]);
    clearActivityLog();
    expect(loadActivityLog()).toEqual([]);
  });
});

describe("loadActivityLog — defensive parsing", () => {
  test.each([
    ["non-array JSON (string)", '"x"'],
    ["non-array JSON (number)", "5"],
    ["non-array JSON (object)", "{}"],
    ["malformed JSON", "{not json"],
  ])("returns [] for %s", (_label, raw) => {
    window.localStorage.setItem(STORAGE_KEY, raw);
    expect(loadActivityLog()).toEqual([]);
  });

  test("filters out entries that fail validation, keeping valid ones", () => {
    const mixed = [
      entry(1, "task.created"), // valid
      { id: "2", timestamp: "t", kind: "not.a.kind", args: [] }, // bad kind
      { id: "3", kind: "task.created", args: [] }, // missing timestamp
      { id: "4", timestamp: "t", kind: "task.created", args: "nope" }, // args not array
      { timestamp: "t", kind: "task.created", args: [] }, // missing id
      { id: "", timestamp: "t", kind: "task.created", args: [] }, // empty-string id
      entry(9, "jira.sync"), // valid
    ];
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(mixed));
    const loaded = loadActivityLog();
    expect(loaded.map((e) => e.id)).toEqual(["1", "9"]);
  });

  test("caps a too-large stored array to the last MAX", () => {
    const big = Array.from({ length: MAX + 100 }, (_, i) => entry(i + 1)); // "1".."600"
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(big));
    const loaded = loadActivityLog();
    expect(loaded).toHaveLength(MAX);
    expect(loaded[0].id).toBe("101"); // "1".."100" dropped
  });
});

describe("ACTIVITY_KIND_TO_KEY — new kinds have non-empty labels in both locales", () => {
  const NEW_KINDS: ActivityKind[] = [
    "change.created",
    "change.updated",
    "change.deleted",
    "stakeholder.created",
    "stakeholder.updated",
    "stakeholder.deleted",
    "resource.created",
    "resource.updated",
    "resource.deleted",
    "role.created",
    "role.updated",
    "role.deleted",
    "settings.updated",
    "calendar.autoPulled",
    "ai.documentWrite",
  ];

  test.each(NEW_KINDS)("%s has a non-empty en-US label", (kind) => {
    const key = ACTIVITY_KIND_TO_KEY[kind];
    const label = t("en-US", key);
    expect(label).toBeTruthy();
  });

  test.each(NEW_KINDS)("%s has a non-empty de-DE label", (kind) => {
    const key = ACTIVITY_KIND_TO_KEY[kind];
    const label = de[key];
    expect(label).toBeTruthy();
  });
});

describe("diffFields (#22 per-field audit diff)", () => {
  test("reports only changed primitive fields as {field,from,to}", () => {
    const prev = { title: "A", status: "Open", owner: "Ada" };
    const next = { title: "A", status: "Closed", owner: "Grace" };
    expect(diffFields(prev, next)).toEqual([
      { field: "owner", from: "Ada", to: "Grace" },
      { field: "status", from: "Open", to: "Closed" },
    ]);
  });

  test("sorts changes by field name for stable output", () => {
    const prev = { zeta: "1", alpha: "1" };
    const next = { zeta: "2", alpha: "2" };
    expect(diffFields(prev, next).map((c) => c.field)).toEqual(["alpha", "zeta"]);
  });

  test("stringifies numbers and booleans and renders nullish as empty", () => {
    const prev = { count: 1, flag: false, note: undefined as string | undefined };
    const next = { count: 2, flag: true, note: "hi" };
    expect(diffFields(prev, next)).toEqual([
      { field: "count", from: "1", to: "2" },
      { field: "flag", from: "false", to: "true" },
      { field: "note", from: "", to: "hi" },
    ]);
  });

  test("skips id / localModifiedAt / outlookEventId and array/object fields", () => {
    const prev = {
      id: 1,
      localModifiedAt: "x",
      outlookEventId: "a",
      labels: ["p"],
      raci: { a: "R" },
      name: "one",
    };
    const next = {
      id: 2,
      localModifiedAt: "y",
      outlookEventId: "b",
      labels: ["p", "q"],
      raci: { a: "A" },
      name: "two",
    };
    expect(diffFields(prev, next)).toEqual([{ field: "name", from: "one", to: "two" }]);
  });

  test("caps a changed value's length and the number of changes", () => {
    const long = "x".repeat(500);
    expect(diffFields({ a: "" }, { a: long })[0].to.length).toBeLessThanOrEqual(140);
    const prev: Record<string, string> = {};
    const next: Record<string, string> = {};
    for (let i = 0; i < 30; i++) {
      prev[`f${i}`] = "0";
      next[`f${i}`] = "1";
    }
    expect(diffFields(prev, next).length).toBeLessThanOrEqual(12);
  });

  test("returns [] when nothing changed", () => {
    expect(diffFields({ a: "1", b: "2" }, { a: "1", b: "2" })).toEqual([]);
  });
});

describe("humanizeFieldName", () => {
  test.each([
    ["dueDate", "due date"],
    ["assigneeEmail", "assignee email"],
    ["poNumber", "po number"],
    ["status", "status"],
    ["start_date", "start date"],
  ])("%s → %s", (input, expected) => {
    expect(humanizeFieldName(input)).toBe(expected);
  });
});

describe("appendActivityEntry + changes round-trip (#22)", () => {
  test("attaches a non-empty changes list to the entry", () => {
    const changes = [{ field: "status", from: "Open", to: "Closed" }];
    const [e] = appendActivityEntry([], "raid.updated", [5, "R", "Risk"], changes);
    expect(e.changes).toEqual(changes);
    expect(e.args).toEqual([5, "R", "Risk"]);
  });

  test("omits the changes key entirely when the diff is empty", () => {
    const [e] = appendActivityEntry([], "task.updated", [1, "T"], []);
    expect("changes" in e).toBe(false);
  });

  test("appendActivity (no changes) still produces a changes-less entry", () => {
    const [e] = appendActivity([], "task.created", 1, "T");
    expect("changes" in e).toBe(false);
  });

  test("a changes-bearing entry survives a save/load round-trip", () => {
    const changes = [{ field: "owner", from: "Ada", to: "Grace" }];
    const log = appendActivityEntry([], "raid.updated", [5], changes);
    saveActivityLog(log);
    const loaded = loadActivityLog();
    expect(loaded[0].changes).toEqual(changes);
  });

  test("drops a malformed changes payload on load (validation)", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        { id: "1", timestamp: "2026-01-01T00:00:00.000Z", kind: "task.updated", args: [], changes: "nope" },
      ]),
    );
    const loaded = loadActivityLog();
    // Entry is still valid (changes is optional) but the bad payload is dropped.
    expect(loaded).toHaveLength(1);
    expect(loaded[0].changes).toBeUndefined();
  });
});

describe("globally unique ids", () => {
  test("mints ids carrying the device prefix and a monotonic counter", () => {
    const one = appendActivity([], "task.created", "T-1");
    const two = appendActivity(one, "task.created", "T-2");
    expect(one[0].id).toMatch(/^[A-Za-z0-9_-]+-\d+$/);
    expect(two[1].id).not.toBe(two[0].id);
  });

  test("does not collide across two independently-grown logs from different devices", () => {
    // Two logs each grown from empty: with per-log numeric ids both would be 1.
    const a = appendActivity([], "task.created", "T-1");
    const b = appendActivity([], "task.created", "T-2");
    expect(a[0].id).not.toBe(b[0].id);
  });

  test("rejects a legacy numeric-id entry on load", () => {
    window.localStorage.setItem(
      "aipm-cockpit:activity-log",
      JSON.stringify([{ id: 1, timestamp: "2026-08-01T00:00:00.000Z", kind: "task.created", args: ["T-1"] }]),
    );
    expect(loadActivityLog()).toEqual([]);
  });

  test("does not re-mint the same id after a module reload", async () => {
    // ★ A reload resets module scope (counter, sessionNonce) but NOT localStorage
    //   (deviceId). Without the session nonce both sessions mint `<dev>-1`.
    // ★★ Deliberately reset BEFORE the first import too, not only before the
    // second: by the time this test runs, earlier tests in this file have
    // already driven the shared static-import module's `counter` well past 0.
    // Without this leading reset, `first`'s counter differs from `second`'s
    // fresh-module counter (1) purely from that pollution, so the assertion
    // stays green even with the session nonce removed from the mint — i.e. it
    // pins nothing. Measured: with the leading `vi.resetModules()` omitted,
    // `M-reload` (removing `getSessionNonce()` from the id template) does NOT
    // turn this test red.
    vi.resetModules();
    const first = (await import("./activity-log")).appendActivity([], "task.created", "T-1");
    vi.resetModules();
    const second = (await import("./activity-log")).appendActivity([], "task.created", "T-2");
    expect(second[0].id).not.toBe(first[0].id);
  });
});

describe("getDeviceId", () => {
  test("first call writes the device id key; a second call returns the same value", async () => {
    // A fresh module instance so `deviceIdCache` isn't already warm from an
    // earlier test — otherwise the cached-return branch short-circuits before
    // ever touching localStorage and this assertion would be vacuous.
    vi.resetModules();
    const fresh = await import("./activity-log");
    expect(window.localStorage.getItem(DEVICE_ID_KEY)).toBeNull();
    const first = fresh.getDeviceId();
    expect(window.localStorage.getItem(DEVICE_ID_KEY)).toBe(first);
    const second = fresh.getDeviceId();
    expect(second).toBe(first);
  });

  test("reuses a pre-seeded localStorage value verbatim", async () => {
    window.localStorage.setItem(DEVICE_ID_KEY, "seeded-device-id");
    // A fresh module instance so `deviceIdCache` isn't already warm from an
    // earlier test/call in this file — forces the read-from-storage path.
    vi.resetModules();
    const fresh = await import("./activity-log");
    expect(fresh.getDeviceId()).toBe("seeded-device-id");
  });

  test("still returns a stable non-empty id when localStorage throws", async () => {
    const getItemSpy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("disabled");
    });
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("disabled");
    });
    try {
      vi.resetModules();
      const fresh = await import("./activity-log");
      const first = fresh.getDeviceId();
      expect(first).toBeTruthy();
      expect(typeof first).toBe("string");
      // Stable within the session: the in-memory cache still serves it even
      // though every localStorage read/write throws.
      expect(fresh.getDeviceId()).toBe(first);
    } finally {
      getItemSpy.mockRestore();
      setItemSpy.mockRestore();
    }
  });
});
