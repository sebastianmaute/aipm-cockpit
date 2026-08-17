import { beforeEach, describe, expect, test, vi } from "vitest";
import {
  ACTIVITY_KIND_TO_KEY,
  activityGroupOf,
  appendActivity,
  appendActivityEntry,
  diffFields,
  dropLegacyActivityLog,
  humanizeFieldName,
  sanitizeActivityEntry,
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
    // ★ Asserted as "the counter advanced by exactly 1", NOT as "the id differs
    //   from some literal". A `.not.toBe("5")` here is a TAUTOLOGY — a minted id
    //   is `<deviceId>-<session>-<counter>` and can never equal a bare digit
    //   string — so an earlier version of this test stayed GREEN under a
    //   mutation deriving the id ENTIRELY from the input array's length, which
    //   is the exact property this test is named for. The counter is always
    //   the LAST `-`-delimited segment, regardless of how many segments (id
    //   format subject to change) precede it.
    const counterOf = (id: string) => Number(id.split("-").pop());
    const first = appendActivity([], "task.created", "T-1");
    const second = appendActivity([entry(5), entry(9)], "task.created", "T-2");
    expect(counterOf(second[second.length - 1].id) - counterOf(first[0].id)).toBe(1);
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

describe("dropLegacyActivityLog", () => {
  test("deletes the pre-upgrade local log on first use and never imports it", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([{ id: 1, timestamp: "2026-08-01T00:00:00.000Z", kind: "task.created", args: ["OLD"] }]),
    );
    dropLegacyActivityLog();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  test("is a no-op when nothing was stored", () => {
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(() => dropLegacyActivityLog()).not.toThrow();
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  test("swallows a localStorage failure (non-fatal)", () => {
    window.localStorage.setItem(STORAGE_KEY, "[]");
    const removeSpy = vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("disabled");
    });
    try {
      expect(() => dropLegacyActivityLog()).not.toThrow();
    } finally {
      removeSpy.mockRestore();
    }
  });
});

// ★★★ loadActivityLog/saveActivityLog/clearActivityLog were REMOVED — the
// activity log is workspace data now (persisted via the six write paths),
// not a per-device localStorage blob. The properties these tests used to pin
// were moved to workspace.test.ts's "activityLog sanitize-and-cap on load"
// describe, which exercises the same validation/capping through
// `sanitizeActivityLog` (called from `jsonToWorkspace`) — which now delegates
// the per-entry rules to `sanitizeActivityEntry` in this module, the successor
// to the retired `isActivityEntry`/`normalizeEntryChanges`. ONE property was
// deliberately inverted rather than carried over: an unknown-but-well-formed
// `kind` is KEPT, because dropping it from SHARED workspace data propagates
// the deletion on the next autosave. See that function's landmine.

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
    "bulk.delete",
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

  // "a changes-bearing entry survives a save/load round-trip" and "drops a
  // malformed changes payload on load" (localStorage-specific) moved to
  // workspace.test.ts's "activityLog sanitize-and-cap on load" describe. Both
  // still hold through `jsonToWorkspace`/`workspaceToJson`: `sanitizeChanges`
  // moved here beside `sanitizeActivityEntry`, so a malformed payload is
  // stripped on the workspace load boundary exactly as `normalizeEntryChanges`
  // stripped it on the localStorage one.
});

describe("appendActivityEntry + actor", () => {
  test("stamps the actor and omits the key when absent", () => {
    const withActor = appendActivityEntry([], "task.created", [1, "x"], undefined, "ai");
    expect(withActor[0].actor).toBe("ai");

    // ★ `"actor" in entry` rather than `toBeUndefined()`: the key must be
    // OMITTED, not present-and-undefined, so an actor-less entry stays
    // byte-identical through JSON.stringify on all six storage paths. A plain
    // `actor` property would put `actor: undefined` on every entry — invisible
    // to a `toBeUndefined()` assertion and visible to the byte-stability
    // fixtures.
    const without = appendActivityEntry([], "task.created", [1, "x"]);
    expect("actor" in without[0]).toBe(false);
  });

  test("carries both changes and actor when given both", () => {
    const changes = [{ field: "status", from: "Open", to: "Closed" }];
    const [e] = appendActivityEntry([], "raid.updated", [5, "R", "Risk"], changes, "ai");
    expect(e.changes).toEqual(changes);
    expect(e.actor).toBe("ai");
  });

  test("appendActivity produces an actor-less entry", () => {
    const [e] = appendActivity([], "task.created", 1, "T");
    expect("actor" in e).toBe(false);
  });
});

describe("sanitizeActivityEntry — forward compatibility", () => {
  // ★★★ THE STRIP PATH IS A SPREAD-AND-DELETE, NEVER A REBUILD, and only this
  // test can tell the two apart: rebuilding `{id, timestamp, kind, args}` from
  // the known-field list passes every other assertion in the suite while
  // silently DROPPING any field a newer release added. Concretely — release N+1
  // adds a field; an N client loads a shared project whose entry carries it AND
  // a malformed `changes`; the rebuild drops the field and the next autosave
  // writes the truncated entry back over everyone's copy. That is not
  // hypothetical: `actor` shipped exactly this way, and this test is what made
  // an older client keep it. Same reasoning as the unknown-`kind` rule on the
  // same function: an older client must never delete what it does not
  // understand.
  //
  // ★★ The probe field must be one NO release knows. It used to be `actor`,
  // which stopped proving anything the moment `actor` joined `ActivityEntry`:
  // a rebuild-from-field-list would then have listed it, and the test would
  // have passed against the very mutant it exists to kill.
  test("keeps an unknown field while stripping a malformed `changes`", () => {
    const stored = {
      id: "e1",
      timestamp: "2026-06-02T00:00:00.000Z",
      kind: "task.updated",
      args: ["T"],
      futureField: "a-future-field",
      changes: "not-an-array",
    };
    const out = sanitizeActivityEntry(stored) as ActivityEntry & { futureField?: string };
    expect(out).not.toBeNull();
    // The forward-compat half: the unknown field survives the repair.
    expect(out.futureField).toBe("a-future-field");
    // The repair half: the malformed payload is gone, not merely falsy.
    expect("changes" in out).toBe(false);
    // The known fields are untouched by the spread.
    expect(out.id).toBe("e1");
    expect(out.kind).toBe("task.updated");
    expect(out.args).toEqual(["T"]);
  });
});

describe("sanitizeActivityEntry — actor", () => {
  const base = { id: "d-1-1", timestamp: "2026-08-16T10:00:00.000Z", kind: "task.created", args: [1, "x"] };

  test("round-trips a known actor", () => {
    const out = sanitizeActivityEntry({ ...base, actor: "ai" });
    expect(out?.actor).toBe("ai");
  });

  // ★ The forward-compat rule: the log is SHARED workspace data and autosave
  //   writes loaded state straight back, so an older client that dropped an
  //   actor a newer release wrote would strip it from the shared project.
  test("KEEPS an unknown-but-string actor", () => {
    const out = sanitizeActivityEntry({ ...base, actor: "reviewer" });
    expect((out as { actor?: string } | null)?.actor).toBe("reviewer");
  });

  // ★★★ `"actor" in out`, NOT `toBeUndefined()` — STRIPPED means the KEY IS
  //   GONE, and the two are not the same assertion. A mutant that writes
  //   `repaired.actor = undefined` satisfies `toBeUndefined()` while leaving the
  //   key present, and a present-but-undefined key is not free here: the entry
  //   is serialised as JSON on the meta-blob write paths, so it changes the
  //   stored bytes (and, on the paths that hand-build, can round-trip as a
  //   literal `null`). Same shape the rest of this branch's absence assertions
  //   use.
  test("strips a non-string actor but keeps the entry", () => {
    const out = sanitizeActivityEntry({ ...base, actor: { evil: true } });
    expect(out).not.toBeNull();
    expect("actor" in (out as object)).toBe(false);
    expect(out?.kind).toBe("task.created");
  });

  // ★★ Absence is NOT "user". Pre-field entries have a genuinely unknown
  //    actor; defaulting them would assert the AI's past writes were the
  //    user's, in the one record the model is told to trust.
  test("leaves an absent actor absent, never defaulting it to user", () => {
    const out = sanitizeActivityEntry(base);
    expect(out).not.toBeNull();
    expect("actor" in (out as object)).toBe(false);
  });

  test("strips a malformed actor while ALSO stripping malformed changes", () => {
    const out = sanitizeActivityEntry({ ...base, actor: 7, changes: "nope" });
    expect(out).not.toBeNull();
    expect("actor" in (out as object)).toBe(false);
    expect(out?.changes).toBeUndefined();
  });
});

describe("sanitizeActivityEntry — args elements (§158)", () => {
  const base = { id: "d-1-1", timestamp: "2026-08-16T10:00:00.000Z", kind: "task.created" };
  /** A non-callable own `toString` makes ToPrimitive fall through to
   *  `Object.prototype.valueOf`, which hands the object back — so `String(x)`
   *  THROWS rather than producing "[object Object]". */
  const HOSTILE = { toString: 1 };

  // ★★★ The CONTROL. Without it this whole block is unfalsifiable: if the
  //   fixture were merely an ordinary object, `String()` would return
  //   "[object Object]" and every assertion below would pass against code that
  //   fixed nothing. Assert the fixture is actually lethal FIRST.
  test("the fixture really is unstringifiable (control)", () => {
    expect(() => String(HOSTILE)).toThrow(/convert object to primitive/i);
  });

  test("coerces a hostile element to \"\" and KEEPS the entry", () => {
    const out = sanitizeActivityEntry({ ...base, args: [HOSTILE] });
    expect(out).not.toBeNull();
    expect(out?.args).toEqual([""]);
    expect(() => out?.args.map(String)).not.toThrow();
  });

  // ★★★ THE LOAD-BEARING ONE. `args` is positional — renderers spread it into
  //   `t(lang, key, ...args)` against `{0}`/`{1}` placeholders. A `filter`-based
  //   fix passes the "no longer throws" assertion above while shifting "after"
  //   into slot 0, turning a crash into silently wrong audit text.
  test("preserves ARITY and position, never filtering the bad element out", () => {
    const out = sanitizeActivityEntry({ ...base, args: ["before", HOSTILE, "after"] });
    expect(out?.args).toEqual(["before", "", "after"]);
  });

  test("leaves a clean args array untouched", () => {
    const args = [1, "x"];
    const out = sanitizeActivityEntry({ ...base, args });
    expect(out?.args).toEqual([1, "x"]);
  });

  // ★★★ The early-return trap, identical in shape to the `actorBad` one above:
  //   the fast path returns the ORIGINAL object BY REFERENCE, and
  //   `changes === undefined` is the overwhelmingly common case. A repair added
  //   to the repair block but left out of that condition therefore does nothing
  //   in practice while every fixture carrying `changes` still passes.
  test("repairs args on the changes-absent fast path", () => {
    const stored = { ...base, args: [HOSTILE] };
    const out = sanitizeActivityEntry(stored);
    expect(out?.args).toEqual([""]);
    expect(out).not.toBe(stored);
  });

  // ★★★ HOLES ARE INVISIBLE TO `some`/`map`, so a sparse `args` was reported
  //   clean, returned BY REFERENCE through the fast path, and rendered
  //   "undefined" in the row — the exact silent-wrongness the coercion exists to
  //   prevent, through the one shape neither method can see. The fix densifies
  //   with `Array.from` first. Written with `new Array(2)` deliberately: a
  //   literal `[undefined, undefined]` is DENSE and passes without the fix.
  test("coerces HOLES in a sparse args array, not just bad values", () => {
    const sparse = new Array(2);
    sparse[1] = "tail";
    const out = sanitizeActivityEntry({ ...base, args: sparse });
    expect(out?.args).toEqual(["", "tail"]);
  });

  test("repairs args together with a malformed actor and changes", () => {
    const out = sanitizeActivityEntry({ ...base, args: [HOSTILE], actor: 7, changes: "nope" });
    expect(out?.args).toEqual([""]);
    expect("actor" in (out as object)).toBe(false);
    expect(out?.changes).toBeUndefined();
  });

  test("still rejects a non-array args outright", () => {
    expect(sanitizeActivityEntry({ ...base, args: "nope" })).toBeNull();
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

  // "rejects a legacy numeric-id entry on load" moved to workspace.test.ts's
  // "activityLog sanitize-and-cap on load" describe — `sanitizeActivityLog`
  // holds the same `typeof id === "string"` check the retired
  // `isActivityEntry` did.

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
