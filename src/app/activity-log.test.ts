import { beforeEach, describe, expect, test } from "vitest";
import {
  ACTIVITY_KIND_TO_KEY,
  activityGroupOf,
  appendActivity,
  clearActivityLog,
  loadActivityLog,
  saveActivityLog,
  type ActivityEntry,
  type ActivityKind,
} from "./activity-log";
import { de } from "./i18n.de";
import { t } from "./i18n";

// Mirrors the module-private constants. Kept here so the raw-localStorage
// injection tests (invalid-entry filtering) can target the real key.
const STORAGE_KEY = "lop-app:activity-log";
const MAX = 500;

function entry(id: number, kind: ActivityKind = "task.created"): ActivityEntry {
  return { id, timestamp: "2026-06-02T00:00:00.000Z", kind, args: [] };
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
  test("first entry gets id 1 and stores the kind + args", () => {
    const [e] = appendActivity([], "task.created", "Alpha", 7);
    expect(e.id).toBe(1);
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

  test("derives the next id from the LAST entry, not the max", () => {
    // Characterization: with monotonic ids this is max+1, but with out-of-order
    // ids it follows the tail. Pins the actual (last-id+1) behavior.
    expect(appendActivity([entry(5)], "task.updated")[1].id).toBe(6);
    expect(appendActivity([entry(5), entry(2)], "task.updated")[2].id).toBe(3);
  });

  test("caps at MAX entries, dropping the oldest", () => {
    const full = Array.from({ length: MAX }, (_, i) => entry(i + 1)); // ids 1..500
    const next = appendActivity(full, "task.deleted");
    expect(next).toHaveLength(MAX);
    expect(next[0].id).toBe(2); // id 1 dropped
    expect(next[MAX - 1].id).toBe(MAX + 1); // newest appended (501)
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
    const entries = Array.from({ length: MAX + 50 }, (_, i) => entry(i + 1)); // 1..550
    saveActivityLog(entries);
    const loaded = loadActivityLog();
    expect(loaded).toHaveLength(MAX);
    expect(loaded[0].id).toBe(51); // 1..50 dropped
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
      { id: 2, timestamp: "t", kind: "not.a.kind", args: [] }, // bad kind
      { id: 3, kind: "task.created", args: [] }, // missing timestamp
      { id: 4, timestamp: "t", kind: "task.created", args: "nope" }, // args not array
      { timestamp: "t", kind: "task.created", args: [] }, // missing id
      entry(9, "jira.sync"), // valid
    ];
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(mixed));
    const loaded = loadActivityLog();
    expect(loaded.map((e) => e.id)).toEqual([1, 9]);
  });

  test("caps a too-large stored array to the last MAX", () => {
    const big = Array.from({ length: MAX + 100 }, (_, i) => entry(i + 1)); // 1..600
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(big));
    const loaded = loadActivityLog();
    expect(loaded).toHaveLength(MAX);
    expect(loaded[0].id).toBe(101); // 1..100 dropped
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
