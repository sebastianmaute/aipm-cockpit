# Activity Log as Workspace Data (B1) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote the activity log from a per-device `localStorage` blob to a persisted `Workspace.activityLog` meta-blob, so the audit trail is per-project, survives a device change and an app reset, and can be merged across devices without silent history loss.

**Architecture:** `activityLog` becomes an optional `Workspace` field persisted as a JSON meta-blob on all six write paths, mirroring `insights` / `documents` exactly. Entry ids become globally unique (`"<deviceId>-<counter>"`) so two devices reconcile by union rather than last-write-wins. The slice is storage-only (absent from `EXPORT_SECTION_KEYS`) and — unlike `documents` — deliberately **excluded** from `isWorkspaceEmpty`.

**Tech Stack:** TypeScript, React 19, Next 16, vitest, fast-check (property tests), Turso (libSQL), IndexedDB.

**Spec:** `docs/superpowers/specs/2026-08-14-activity-log-workspace-data-design.md`

---

## Read before starting

- `AGENTS.md` → **Hard constraints** → "New persisted `Workspace` field → SIX write paths".
- `docs/AGENTS/documents.md` — `documents` is the meta-blob precedent this mirrors; it records a landmine for exactly this "add a field to the six write paths" task.
- **Never read a gate's exit code through a pipe.** Redirect, check unpiped, then read the file.
- **`docs/superpowers/` is gitignored** — every commit touching this plan or its spec needs `git add -f`.

## File structure

| File | Change | Responsibility |
|---|---|---|
| `src/app/activity-log.ts` | modify | Entry type, `deviceId`, id minting, validation, legacy-key deletion |
| `src/app/activity-log-merge.ts` | **create** | Pure `mergeActivityLogs` — union by id, sort, cap |
| `src/app/activity-log-merge.test.ts` | **create** | Unit + property tests for the merge |
| `src/app/workspace.ts` | modify | `Workspace.activityLog`, JSON in/out, `sanitizeActivityLog`, `isWorkspaceEmpty` exclusion |
| `src/app/browser-backend.ts` | modify | IndexedDB KV key, delete-on-absent |
| `src/app/turso-schema.ts` | modify | `meta` row + dirty check |
| `src/app/csv-codecs-config.ts` | modify | Storage-only `config,<json>` section (encode) |
| `src/app/csv-codecs-decode.ts` | modify | Section marker + decode |
| `src/app/markdown-codecs-core.ts` | modify | Fenced json blob |
| `src/app/use-activity-log.ts` | modify | Owns nothing persistent — state lifts to the workspace |
| `src/app/use-storage-backend.ts` | modify | Slice list (**six occurrences**) + load merge |
| `src/app/activity-log-panel.tsx` | modify | React key is now a string |
| `src/app/dashboard-panel.tsx` | modify | Reads the workspace log, not `loadActivityLog()` |
| `src/app/use-landing-delta.ts` | modify | Same |
| `src/app/i18n.ts` / `i18n.de.ts` | modify | New `versionHighlight*` key |
| `CHANGELOG.md`, `src/app/version.ts`, `package.json`, `package-lock.json`, `README.md`, `docs/CODEMAPS/*.md` | modify | Release bookkeeping |

---

## Task 1: Pure merge engine

**Files:**
- Create: `src/app/activity-log-merge.ts`
- Test: `src/app/activity-log-merge.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { mergeActivityLogs, ACTIVITY_MAX_ENTRIES } from "./activity-log-merge";
import type { ActivityEntry } from "./activity-log";

function entry(id: string, timestamp: string): ActivityEntry {
  return { id, timestamp, kind: "task.created", args: ["T-1"] };
}

describe("mergeActivityLogs", () => {
  it("unions entries from both sides, keeping one copy of a shared id", () => {
    // Arrange
    const a = [entry("dev1-1", "2026-08-01T00:00:00.000Z"), entry("dev1-2", "2026-08-02T00:00:00.000Z")];
    const b = [entry("dev1-2", "2026-08-02T00:00:00.000Z"), entry("dev2-1", "2026-08-03T00:00:00.000Z")];

    // Act
    const merged = mergeActivityLogs(a, b);

    // Assert
    expect(merged.map((e) => e.id)).toEqual(["dev1-1", "dev1-2", "dev2-1"]);
  });

  it("sorts by timestamp ascending regardless of input order", () => {
    const a = [entry("dev1-9", "2026-08-09T00:00:00.000Z")];
    const b = [entry("dev1-1", "2026-08-01T00:00:00.000Z")];
    expect(mergeActivityLogs(a, b).map((e) => e.id)).toEqual(["dev1-1", "dev1-9"]);
  });

  it("caps to the NEWEST entries, dropping the oldest", () => {
    const many = Array.from({ length: ACTIVITY_MAX_ENTRIES + 10 }, (_, i) =>
      entry(`dev1-${i}`, new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString()),
    );
    const merged = mergeActivityLogs(many, []);
    expect(merged).toHaveLength(ACTIVITY_MAX_ENTRIES);
    expect(merged[merged.length - 1].id).toBe(`dev1-${ACTIVITY_MAX_ENTRIES + 9}`);
    expect(merged[0].id).toBe("dev1-10");
  });

  it("treats undefined sides as empty", () => {
    expect(mergeActivityLogs(undefined, undefined)).toEqual([]);
    expect(mergeActivityLogs(undefined, [entry("dev1-1", "2026-08-01T00:00:00.000Z")])).toHaveLength(1);
  });

  it("returns a NEW array even when one side is empty (reference-equality dirty check)", () => {
    const a = [entry("dev1-1", "2026-08-01T00:00:00.000Z")];
    expect(mergeActivityLogs(a, [])).not.toBe(a);
  });

  it("agrees on membership regardless of argument order, and never exceeds the cap", () => {
    fc.assert(
      fc.property(
        fc.array(fc.tuple(fc.string({ minLength: 1 }), fc.integer({ min: 0, max: 10 ** 12 })), { maxLength: 60 }),
        fc.array(fc.tuple(fc.string({ minLength: 1 }), fc.integer({ min: 0, max: 10 ** 12 })), { maxLength: 60 }),
        (rawA, rawB) => {
          const toEntries = (raw: [string, number][]) =>
            raw.map(([id, ms]) => entry(id, new Date(ms).toISOString()));
          const ab = mergeActivityLogs(toEntries(rawA), toEntries(rawB));
          const ba = mergeActivityLogs(toEntries(rawB), toEntries(rawA));
          expect(new Set(ab.map((e) => e.id))).toEqual(new Set(ba.map((e) => e.id)));
          expect(ab.length).toBeLessThanOrEqual(ACTIVITY_MAX_ENTRIES);
        },
      ),
    );
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run src/app/activity-log-merge.test.ts --reporter=dot`
Expected: FAIL — `Failed to resolve import "./activity-log-merge"`.

- [ ] **Step 3: Write the implementation**

```ts
// src/app/activity-log-merge.ts
//
// Pure, i18n-free, DOM-free. Reconciles two activity logs that were appended
// independently — the multi-device case created by promoting the log to
// workspace data (before, each device kept its own localStorage copy and there
// was nothing to collide).
//
// ★★ This NARROWS the lose-window; it does not close it. An entry appended on
// device A between device B's load and B's save is still lost. Closing it fully
// needs append-level writes, which the meta-blob shape cannot express. Accepted
// deliberately — do not record this as solved.
// ★ ACTIVITY_MAX_ENTRIES is imported, NOT redeclared. `activity-log.ts` already
// holds it as a private const — EXPORT it there and import it here. Two
// declarations of the same cap drift the moment one is changed, and the merge
// and the append path disagreeing about the cap is silent history loss.
import { ACTIVITY_MAX_ENTRIES, type ActivityEntry } from "./activity-log";

export { ACTIVITY_MAX_ENTRIES };

/**
 * Union by `id`, sorted by `timestamp` ascending, capped to the newest
 * ACTIVITY_MAX_ENTRIES. `b` wins on a duplicate id — arbitrary but total, and
 * duplicate ids carry identical payloads by construction (the id encodes the
 * minting device and its counter).
 *
 * ALWAYS returns a new array: the workspace dirty check is reference equality
 * (`prev.activityLog !== next.activityLog`), so returning an input unchanged
 * would silently skip the save.
 */
export function mergeActivityLogs(
  a: readonly ActivityEntry[] | undefined,
  b: readonly ActivityEntry[] | undefined,
): ActivityEntry[] {
  const byId = new Map<string, ActivityEntry>();
  for (const e of a ?? []) byId.set(e.id, e);
  for (const e of b ?? []) byId.set(e.id, e);
  const all = [...byId.values()].sort((x, y) => (x.timestamp < y.timestamp ? -1 : x.timestamp > y.timestamp ? 1 : 0));
  return all.length > ACTIVITY_MAX_ENTRIES ? all.slice(-ACTIVITY_MAX_ENTRIES) : all;
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npx vitest run src/app/activity-log-merge.test.ts --reporter=dot`
Expected: PASS, 6 tests.

- [ ] **Step 5: Mutation-check the cap direction**

Change `all.slice(-ACTIVITY_MAX_ENTRIES)` to `all.slice(0, ACTIVITY_MAX_ENTRIES)` and re-run.
Expected: the "caps to the NEWEST entries" test goes RED. **Revert the mutation before continuing** — a live mutant in the tree at report time has happened in this repo before.

- [ ] **Step 6: Commit**

```bash
git add src/app/activity-log-merge.ts src/app/activity-log-merge.test.ts
git commit -m "feat: pure activity-log merge engine (union by id, newest-capped)"
```

---

## Task 2: Globally unique entry ids

**Files:**
- Modify: `src/app/activity-log.ts`
- Test: `src/app/activity-log.test.ts` (existing — extend)

**Context:** `appendActivityEntry` currently mints `id: current[current.length - 1].id + 1` (a number, monotonic within one device's log) and `isActivityEntry` requires `typeof e.id === "number"`. Both must change, and old entries must stop validating — the spec drops them.

- [ ] **Step 1: Write the failing test**

Append to `src/app/activity-log.test.ts`:

```ts
describe("globally unique ids", () => {
  it("mints ids carrying the device prefix and a monotonic counter", () => {
    const one = appendActivity([], "task.created", "T-1");
    const two = appendActivity(one, "task.created", "T-2");
    expect(one[0].id).toMatch(/^[A-Za-z0-9_-]+-1$/);
    expect(two[1].id).not.toBe(two[0].id);
  });

  it("does not collide across two independently-grown logs from different devices", () => {
    // Two logs each grown from empty: with per-log numeric ids both would be 1.
    const a = appendActivity([], "task.created", "T-1");
    const b = appendActivity([], "task.created", "T-2");
    // Same device here, so the COUNTER must still advance across calls.
    expect(a[0].id).not.toBe(b[0].id);
  });

  it("rejects a legacy numeric-id entry on load", () => {
    window.localStorage.setItem(
      "aipm-cockpit:activity-log",
      JSON.stringify([{ id: 1, timestamp: "2026-08-01T00:00:00.000Z", kind: "task.created", args: ["T-1"] }]),
    );
    expect(loadActivityLog()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run src/app/activity-log.test.ts --reporter=dot`
Expected: FAIL — ids are numbers, and the legacy entry still validates.

- [ ] **Step 3: Write the implementation**

In `src/app/activity-log.ts`, change the interface:

```ts
export interface ActivityEntry {
  /** Globally unique: `"<deviceId>-<counter>"`. Was a number, monotonic only
   *  within ONE device's log — which is exactly why two devices collided once
   *  the log became shared workspace data. */
  id: string;
  /** ISO 8601 UTC timestamp captured at append time. */
  timestamp: string;
  kind: ActivityKind;
  /** Positional args interpolated into the i18n message at render time. */
  args: (string | number)[];
  /** Optional per-field diff for UPDATE events (audit detail). Omitted when the
   *  update produced no field changes. */
  changes?: readonly FieldChange[];
}
```

Add the device id and counter above `loadActivityLog`:

```ts
const DEVICE_ID_KEY = "aipm-cockpit:device-id";

let deviceIdCache: string | null = null;
let counter = 0;

/**
 * Per-device identifier, minted once and reused. NOT a secret — it must never
 * join the `SecretId` union. `clearAppConfig()` wipes it; a regenerated id is
 * harmless, because the only property required of it is non-collision with
 * other devices.
 *
 * ★ Called from event handlers only, never a component render body — the
 * react-hooks purity rule makes `Date.now()` / `Math.random()` there fatal.
 */
export function getDeviceId(): string {
  if (deviceIdCache) return deviceIdCache;
  let id: string | null = null;
  try {
    id = window.localStorage.getItem(DEVICE_ID_KEY);
  } catch {
    // localStorage disabled — fall through and mint an ephemeral id.
  }
  if (!id) {
    id =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID().slice(0, 8)
        : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    try {
      window.localStorage.setItem(DEVICE_ID_KEY, id);
    } catch {
      // non-fatal: an ephemeral id still cannot collide with another device.
    }
  }
  deviceIdCache = id;
  return id;
}
```

Replace the id mint in `appendActivityEntry`:

```ts
  const entry: ActivityEntry = {
    id: `${getDeviceId()}-${++counter}`,
    timestamp: new Date().toISOString(),
    kind,
    args,
    ...(changes && changes.length > 0 ? { changes } : {}),
  };
```

Tighten validation so legacy numeric-id entries are rejected:

```ts
function isActivityEntry(v: unknown): v is ActivityEntry {
  if (!v || typeof v !== "object") return false;
  const e = v as Partial<ActivityEntry>;
  return (
    typeof e.id === "string" &&
    e.id.length > 0 &&
    typeof e.timestamp === "string" &&
    isActivityKind(e.kind) &&
    Array.isArray(e.args)
  );
}
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npx vitest run src/app/activity-log.test.ts --reporter=dot`
Expected: PASS.

- [ ] **Step 5: Fix the React key type**

`src/app/activity-log-panel.tsx` renders `<tr key={entry.id}>` — a string key is valid, so no change is required, but run tsc to confirm nothing else did arithmetic on the id:

Run: `npx tsc --noEmit; echo "EXIT=$?"`
Expected: EXIT=0. Any error naming `entry.id` is a real site that assumed a number — fix it there.

- [ ] **Step 6: Commit**

```bash
git add src/app/activity-log.ts src/app/activity-log.test.ts
git commit -m "feat: globally unique activity-log entry ids (deviceId-counter)"
```

---

## Task 3: `isWorkspaceEmpty` must EXCLUDE activityLog

**Files:**
- Modify: `src/app/workspace.ts`
- Test: `src/app/workspace.test.ts` (existing — extend)

**Context — read this before writing code.** `documents` was deliberately **added** to `isWorkspaceEmpty` because "only a charter drafted, no tasks yet" is an ordinary state that must not be wiped. `activityLog` is the **inverse**: it is auto-appended by ordinary use, so counting it would make a workspace holding log entries and no user records read as non-empty, slip past the load guard, and let a transient empty backend read replace a populated project. Write this test FIRST — it is what stops a later contributor "completing" the documents precedent.

- [ ] **Step 1: Write the failing test**

```ts
it("a workspace holding ONLY activity entries is still EMPTY (inverse of documents)", () => {
  // ★ documents deliberately COUNT toward non-empty; activityLog must NOT.
  // The log is auto-appended by ordinary use, so counting it would let a
  // transient empty backend read replace a populated project.
  const ws = {
    tasks: [],
    activityLog: [{ id: "dev1-1", timestamp: "2026-08-01T00:00:00.000Z", kind: "task.created" as const, args: ["T-1"] }],
  } as unknown as Workspace;
  expect(isWorkspaceEmpty(ws)).toBe(true);
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run src/app/workspace.test.ts -t "ONLY activity entries" --reporter=dot`
Expected: FAIL — `activityLog` is not yet on the `Workspace` type, so this is a compile-time failure under tsc and a runtime pass under vitest. Confirm with `npx tsc --noEmit`. It becomes a *meaningful* guard once Task 4 adds the field; keep it now so the field cannot land without it.

- [ ] **Step 3: Add the exclusion comment (no logic change)**

In `src/app/workspace.ts`, immediately after the `documents` / `documentVersions` lines inside `isWorkspaceEmpty`:

```ts
    && (ws.documents?.length ?? 0) === 0
    && (ws.documentVersions?.length ?? 0) === 0;
    // ★★★ activityLog is deliberately ABSENT here, INVERTING the documents rule
    //     directly above. The log is auto-appended by ordinary use, so counting
    //     it would make a workspace with log entries and NO user records read as
    //     non-empty — slipping past this guard and letting a transient empty
    //     backend read replace a populated project. That converts a data-loss
    //     guard into a data-loss vector. Pinned by workspace.test.ts
    //     ("ONLY activity entries is still EMPTY"). Do not "complete" the
    //     documents precedent by adding it.
    //     Same reasoning keeps it out of nonEmptyCollectionCount /
    //     workspaceRecordCount (SAVE-time mass-deletion thresholds, §98).
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npx vitest run src/app/workspace.test.ts -t "ONLY activity entries" --reporter=dot`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/workspace.ts src/app/workspace.test.ts
git commit -m "test: pin activityLog OUT of isWorkspaceEmpty (inverts the documents rule)"
```

---

## Task 4: Workspace type + JSON write path (1 of 6)

**Files:**
- Modify: `src/app/workspace.ts`
- Test: `src/app/workspace.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it("round-trips activityLog through JSON", () => {
  const log = [{ id: "dev1-1", timestamp: "2026-08-01T00:00:00.000Z", kind: "task.created" as const, args: ["T-1"] }];
  const ws = { tasks: [], activityLog: log } as unknown as Workspace;
  const back = jsonToWorkspace(workspaceToJson(ws));
  expect(back.activityLog).toEqual(log);
});

it("omits the activityLog key entirely when the log is empty", () => {
  const ws = { tasks: [], activityLog: [] } as unknown as Workspace;
  expect(JSON.parse(workspaceToJson(ws))).not.toHaveProperty("activityLog");
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run src/app/workspace.test.ts -t activityLog --reporter=dot`
Expected: FAIL — `back.activityLog` is `undefined`.

- [ ] **Step 3: Write the implementation**

Add to the `Workspace` type, beside `insights`:

```ts
  /** Per-project audit trail. Meta-blob (like insights/documents), storage-only
   *  — deliberately absent from EXPORT_SECTION_KEYS. */
  activityLog?: readonly ActivityEntry[];
```

Add the sanitizer:

```ts
/** DOM-free. Drops malformed entries; caps to the newest ACTIVITY_MAX_ENTRIES. */
export function sanitizeActivityLog(v: unknown): ActivityEntry[] {
  if (!Array.isArray(v)) return [];
  const valid = v.filter(
    (e): e is ActivityEntry =>
      !!e &&
      typeof e === "object" &&
      typeof (e as ActivityEntry).id === "string" &&
      (e as ActivityEntry).id.length > 0 &&
      typeof (e as ActivityEntry).timestamp === "string" &&
      Array.isArray((e as ActivityEntry).args),
  );
  return valid.length > ACTIVITY_MAX_ENTRIES ? valid.slice(-ACTIVITY_MAX_ENTRIES) : valid;
}
```

In `workspaceToJson`, mirroring the `insights` line:

```ts
    ...(ws.activityLog && ws.activityLog.length ? { activityLog: ws.activityLog } : {}),
```

In `jsonToWorkspace`, mirroring the insights sanitize:

```ts
    const log = sanitizeActivityLog((raw as { activityLog?: unknown }).activityLog);
    if (log.length) ws.activityLog = log;
```

★ **Do NOT bump `SCHEMA_VERSION`.** Measured: `git log --oneline -S "SCHEMA_VERSION = " -- src/app/workspace.ts` returns a single commit (the original extraction from `storage.ts`), and `2ef2adf0` — which added `documents` to this same JSON path — did not touch it. An additive optional field does not move it.

- [ ] **Step 4: Run the test and verify it passes**

Run: `npx vitest run src/app/workspace.test.ts -t activityLog --reporter=dot`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add src/app/workspace.ts src/app/workspace.test.ts
git commit -m "feat: persist activityLog on the JSON workspace path (1 of 6)"
```

---

## Task 5: IndexedDB write path (2 of 6)

**Files:**
- Modify: `src/app/browser-backend.ts`
- Test: `src/app/browser-backend.test.ts`

**Context:** `insights` uses `KV_INSIGHTS_KEY` with **delete-on-absent** so a cleared slice does not reload stale. Mirror that exactly.

- [ ] **Step 1: Write the failing test**

```ts
it("round-trips activityLog through IndexedDB", async () => {
  const log = [{ id: "dev1-1", timestamp: "2026-08-01T00:00:00.000Z", kind: "task.created" as const, args: ["T-1"] }];
  const backend = new BrowserBackend();
  await backend.save({ ...emptyWorkspace(), activityLog: log } as Workspace);
  expect((await backend.load()).activityLog).toEqual(log);
});

it("deletes the stored log when it is cleared, so it cannot reload stale", async () => {
  const backend = new BrowserBackend();
  await backend.save({ ...emptyWorkspace(), activityLog: [{ id: "dev1-1", timestamp: "2026-08-01T00:00:00.000Z", kind: "task.created" as const, args: ["T-1"] }] } as Workspace);
  await backend.save({ ...emptyWorkspace(), activityLog: [] } as Workspace);
  expect((await backend.load()).activityLog).toBeUndefined();
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run src/app/browser-backend.test.ts -t activityLog --reporter=dot`
Expected: FAIL — `activityLog` is `undefined` after the round-trip.

- [ ] **Step 3: Write the implementation**

Add the key beside `KV_INSIGHTS_KEY`:

```ts
const KV_ACTIVITY_LOG_KEY = "activityLog";
```

In the load path, mirroring the insights two-pass shape:

```ts
    let activityLog: Workspace["activityLog"] | undefined;
    // …inside the kv loop, beside the insights case:
      // Optional list: junk/empty entries sanitize to [] → keep undefined.
      const log = sanitizeActivityLog(value);
      activityLog = log.length ? log : undefined;
    // …and in the assembly:
    if (activityLog) raw.activityLog = activityLog;
```

In the save path, mirroring the insights delete-on-absent:

```ts
      // Delete-on-absent so a cleared log doesn't linger and reload stale.
      ws.activityLog && ws.activityLog.length
        ? idbSet(KV_ACTIVITY_LOG_KEY, ws.activityLog)
        : idbDelete(KV_ACTIVITY_LOG_KEY),
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npx vitest run src/app/browser-backend.test.ts -t activityLog --reporter=dot`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add src/app/browser-backend.ts src/app/browser-backend.test.ts
git commit -m "feat: persist activityLog on the IndexedDB path (2 of 6)"
```

---

## Task 6: Turso write path, single + tenant (3 and 4 of 6)

**Files:**
- Modify: `src/app/turso-schema.ts`
- Test: `src/app/turso-schema.test.ts`

**Context:** `meta` is a `key`/`value` table and is already per-project, so the single-DB and multi-tenant paths are both served by one `meta` row — that is why this task closes two of the six. The slice must **not** join `TABLE_NAMES` (it has no table of its own; a guard test enforces the list).

- [ ] **Step 1: Write the failing test**

```ts
it("writes activityLog as a meta row and reads it back", () => {
  const log = [{ id: "dev1-1", timestamp: "2026-08-01T00:00:00.000Z", kind: "task.created" as const, args: ["T-1"] }];
  const stmts = buildSaveStatements({ ...emptyWorkspace(), activityLog: log } as Workspace);
  const metaInsert = stmts.find((s) => s.sql.includes("meta") && s.args?.some((a) => a.value === "activityLog"));
  expect(metaInsert).toBeDefined();
  expect(metaInsert!.args!.some((a) => a.value === JSON.stringify(log))).toBe(true);
});

it("marks meta dirty when activityLog changes by reference", () => {
  const prev = { ...emptyWorkspace(), activityLog: [] } as Workspace;
  const next = { ...prev, activityLog: [{ id: "dev1-1", timestamp: "2026-08-01T00:00:00.000Z", kind: "task.created" as const, args: ["T-1"] }] } as Workspace;
  expect(dirtyTables(prev, next)).toContain("meta");
});

it("keeps activityLog OUT of TABLE_NAMES (it rides meta, no table of its own)", () => {
  expect(TABLE_NAMES).not.toContain("activityLog");
  expect(TABLE_NAMES).not.toContain("activity_log");
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run src/app/turso-schema.test.ts -t activityLog --reporter=dot`
Expected: FAIL — no meta row is emitted and `meta` is not marked dirty.

- [ ] **Step 3: Write the implementation**

In the load path, beside the `insights` meta row lookup:

```ts
  const logRow = rowObjects(byTable.get("meta")).find((r) => r.key === "activityLog");
  if (logRow) {
    const log = sanitizeActivityLog(JSON.parse(String(logRow.value)));
    if (log.length) ws.activityLog = log;
  }
```

In the dirty check, beside the insights/documents lines:

```ts
  if (prev.activityLog !== next.activityLog) dirty.add("meta");
```

In the save path, **read the existing insights insert first and copy its exact statement shape** — this plan deliberately does not reproduce it, because an invented `SqlArg` shape that merely looks right is worse than none:

```bash
grep -n -A 8 '{ type: "text", value: "insights" }' src/app/turso-schema.ts
```

Duplicate that block with `"insights"` → `"activityLog"` and `ws.insights` → `ws.activityLog`, keeping the same non-empty guard. ★ `SqlArg.value` is string-only even for numbers, so every value goes through `String(...)` / `JSON.stringify(...)` exactly as the insights block does.

- [ ] **Step 4: Run the test and verify it passes**

Run: `npx vitest run src/app/turso-schema.test.ts -t activityLog --reporter=dot`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/app/turso-schema.ts src/app/turso-schema.test.ts
git commit -m "feat: persist activityLog as a Turso meta row (3 and 4 of 6)"
```

---

## Task 7: CSV write path (5 of 6), storage-only

**Files:**
- Modify: `src/app/csv-codecs-config.ts`, `src/app/csv-codecs-decode.ts`
- Test: `src/app/csv-codecs.test.ts`

**Context:** `workspaceToCsv(ws, config?)` — **no `config` (storage) emits every section; a `config` (document export) emits only enabled ones.** `documents` is the storage-only precedent: no `documents` key in `EXPORT_SECTION_KEYS`, emission gated purely on the array being non-empty. Do the same. Adding an `EXPORT_SECTION_KEYS` entry would put the audit trail into client-facing exports, which the spec rejects.

- [ ] **Step 1: Write the failing test**

```ts
it("round-trips activityLog through CSV storage", () => {
  const log = [{ id: "dev1-1", timestamp: "2026-08-01T00:00:00.000Z", kind: "task.created" as const, args: ["T-1"] }];
  const ws = { ...emptyWorkspace(), activityLog: log } as Workspace;
  expect(csvToWorkspace(workspaceToCsv(ws)).activityLog).toEqual(log);
});

it("is STORAGE-ONLY: present without a config, absent with one", () => {
  const log = [{ id: "dev1-1", timestamp: "2026-08-01T00:00:00.000Z", kind: "task.created" as const, args: ["T-1"] }];
  const ws = { ...emptyWorkspace(), activityLog: log } as Workspace;
  expect(workspaceToCsv(ws)).toContain(CSV_SECTION_ACTIVITY);
  // A document export must never carry the audit trail.
  expect(workspaceToCsv(ws, { sections: [...EXPORT_SECTION_KEYS] } as ExportConfig)).not.toContain(CSV_SECTION_ACTIVITY);
});

it("keeps activityLog out of EXPORT_SECTION_KEYS", () => {
  expect(EXPORT_SECTION_KEYS).not.toContain("activityLog");
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run src/app/csv-codecs.test.ts -t activityLog --reporter=dot`
Expected: FAIL — `CSV_SECTION_ACTIVITY` is not exported.

- [ ] **Step 3: Write the implementation**

In `csv-codecs-config.ts`, mirroring the documents encoder:

```ts
// --- Activity log encoder / decoder ------------------------------------------
//
// Same single `config,<json>` row shape as documents, and STORAGE-ONLY for the
// same reason: there is no `activityLog` key in EXPORT_SECTION_KEYS, so emission
// is gated purely on the array being non-empty rather than routed through the
// export `enabled(...)` allowlist.
//
// ★ Deliberate asymmetry: the log IS stored on every backend and is NEVER
// exported. An export carries `changes` — old and new values for up to 12 fields
// per update — which does not belong in a document handed to a client.
export function activityLogToCsv(log: readonly ActivityEntry[], neutralize = false): string {
  return ["config", csvCellEscape(JSON.stringify(log), neutralize)].join(",");
}
```

Emit it in `workspaceToCsv` gated on non-empty only (NOT on `enabled(...)`):

```ts
  if (ws.activityLog && ws.activityLog.length)
    csvPush(CSV_SECTION_ACTIVITY, activityLogToCsv(ws.activityLog, neutralize));
```

In `csv-codecs-decode.ts`, add `"activityLog"` to the `mode` union, add `activityLogLines`, the marker branch, the accumulate branch, the section text on the returned object, and the decode:

```ts
  if (s.activityLogText.trim()) {
    const log = csvToActivityLog(s.activityLogText);
    if (log) ws.activityLog = log;
  }
```

- [ ] **Step 4: Run the test and verify it passes**

Run: `npx vitest run src/app/csv-codecs.test.ts -t activityLog --reporter=dot`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/app/csv-codecs-config.ts src/app/csv-codecs-decode.ts src/app/csv-codecs.test.ts
git commit -m "feat: persist activityLog as a storage-only CSV section (5 of 6)"
```

---

## Task 8: Markdown write path (6 of 6)

**Files:**
- Modify: `src/app/markdown-codecs-core.ts`
- Test: `src/app/markdown-codecs.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it("round-trips activityLog through Markdown storage", () => {
  const log = [{ id: "dev1-1", timestamp: "2026-08-01T00:00:00.000Z", kind: "task.created" as const, args: ["T-1"] }];
  const ws = { ...emptyWorkspace(), activityLog: log } as Workspace;
  expect(markdownToWorkspace(workspaceToMarkdown(ws)).activityLog).toEqual(log);
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run src/app/markdown-codecs.test.ts -t activityLog --reporter=dot`
Expected: FAIL — `activityLog` is `undefined`.

- [ ] **Step 3: Write the implementation**

Read the documents blob encoder/decoder and duplicate it:

```bash
grep -n -B 4 -A 20 "Documents persist as a fenced json blob" src/app/markdown-codecs-core.ts
```

Duplicate that pair with `documents` → `activityLog`, gated on the array being non-empty (storage-only, same as CSV). ★ Markdown is **LF** while CSV is **CRLF** — copy the surrounding block's line endings rather than typing them; a stray `\r` here is a golden-fixture byte diff.

- [ ] **Step 4: Run the test and verify it passes**

Run: `npx vitest run src/app/markdown-codecs.test.ts -t activityLog --reporter=dot`
Expected: PASS.

- [ ] **Step 5: Verify all six paths at once**

Run: `npx vitest run src/app/entity-persistence-registry.test.ts --reporter=dot`
Expected: PASS. If this suite enumerates persisted slices, add `activityLog` to its registry so a future field cannot skip a path.

- [ ] **Step 6: Commit**

```bash
git add src/app/markdown-codecs-core.ts src/app/markdown-codecs.test.ts
git commit -m "feat: persist activityLog on the Markdown path (6 of 6)"
```

---

## Task 9: Regenerate golden fixtures

**Files:**
- Modify: `src/app/__fixtures__/golden-*`

**Context:** A new CSV/Markdown section is a legitimate format change. `golden-workspace.test` pins exact bytes. Regenerate from the serializers — **never** hand-edit to silence a diff. The sample workspace carries no activity entries, so the sections should be ABSENT from the goldens (emission is gated on non-empty); if the goldens change at all, stop and find out why.

- [ ] **Step 1: Run the golden suite and read the diff**

Run: `npx vitest run src/app/golden-workspace.test.ts --reporter=dot > /tmp/golden.log 2>&1; echo "EXIT=$?"; cat /tmp/golden.log`
Expected: PASS with no fixture change, because `sample-workspace-small.json` has no `activityLog`.

- [ ] **Step 2: If it failed, regenerate and inspect**

Regenerate via the serializers, then `git diff src/app/__fixtures__/` and confirm every changed byte is the new section and nothing else.

- [ ] **Step 3: Commit (only if fixtures actually changed)**

```bash
git add src/app/__fixtures__/
git commit -m "chore: regenerate golden fixtures for the activityLog section"
```

---

## Task 10: Lift the state into the workspace

**Files:**
- Modify: `src/app/use-activity-log.ts`, `src/app/use-storage-backend.ts`, `src/app/workspace-context.tsx`
- Test: `src/app/use-activity-log.test.tsx`

**Context — the highest-risk task.** `use-storage-backend.ts` spells the full slice list **six times**: the `outgoing` object, the `backend.save(...)` call, the save effect's dependency array, a second save call, the `truncationOps.guardedWrite(...)` backstop, and the returned bag. Enumerate them before editing, and again after:

```bash
grep -n "documentVersions" src/app/use-storage-backend.ts
```

Every hit that lists slices needs `activityLog` too. **Missing the dependency array is the silent one** — the field persists on the first save and never again.

- [ ] **Step 1: Write the failing test**

```ts
it("appending an activity entry produces a NEW array (reference-equality dirty check)", () => {
  const { result } = renderHook(() => useActivityLog());
  const before = result.current.activityLog;
  act(() => result.current.logActivity("task.created", "T-1"));
  expect(result.current.activityLog).not.toBe(before);
  expect(result.current.activityLog).toHaveLength(before.length + 1);
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run src/app/use-activity-log.test.tsx --reporter=dot`
Expected: PASS already (the hook is functional-setter based). **This test is a regression guard, not a red-first test** — say so in a comment above it, and mutation-check it in Step 5 rather than pretending it drove the change.

- [ ] **Step 3: Write the implementation**

In `use-activity-log.ts`, delete the two `localStorage` effects (the hydrate effect with its `set-state-in-effect` eslint-disable, and the save effect) and the `clearActivityLogStorage` call. The hook now takes the log and its setter from the workspace instead of owning them.

In `use-storage-backend.ts`:
- Destructure `activityLog, setActivityLog` beside `insights, setInsights, documents, setDocuments`.
- In the load handler, **merge rather than replace**:
  ```ts
  setActivityLog((prev) => mergeActivityLogs(prev, workspace.activityLog));
  ```
  ★ Not `setActivityLog(workspace.activityLog ?? [])` — a replace drops entries appended locally while the load was in flight, which is the exact loss this slice exists to prevent.
- Add `activityLog` to all six slice lists.

In `workspace-context.tsx`, add the `activityLog` / `setActivityLog` state beside `documents` / `setDocuments` and expose both.

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npx vitest run src/app/use-activity-log.test.tsx src/app/use-storage-backend.test.tsx --reporter=dot`
Expected: PASS.

- [ ] **Step 5: Mutation-check the dependency array**

Remove `activityLog` from the save effect's dependency array and re-run the storage-backend suite.
Expected: a test goes RED. **If nothing goes red, the suite does not cover re-save on change — write that test before continuing.** A silent-stale-save is the failure mode this whole task is about. **Revert the mutation.**

- [ ] **Step 6: Commit**

```bash
git add src/app/use-activity-log.ts src/app/use-storage-backend.ts src/app/workspace-context.tsx src/app/use-activity-log.test.tsx
git commit -m "feat: lift activityLog into workspace state, merging on load"
```

---

## Task 11: Point the readers at the workspace

**Files:**
- Modify: `src/app/dashboard-panel.tsx`, `src/app/use-landing-delta.ts`
- Test: existing suites for both

**Context:** Both currently call `loadActivityLog()` directly. `dashboard-panel.tsx` does it in a lazy `useState` initializer, so it reads once at mount and never updates — moving to the workspace fixes that incidentally.

- [ ] **Step 1: Write the failing test**

```ts
it("reads the activity log from the workspace, not localStorage", () => {
  window.localStorage.setItem("aipm-cockpit:activity-log", JSON.stringify([{ id: "legacy-1", timestamp: "2026-08-01T00:00:00.000Z", kind: "task.created", args: ["OLD"] }]));
  render(<DashboardPanel {...makeProps({ activityLog: [{ id: "dev1-1", timestamp: "2026-08-02T00:00:00.000Z", kind: "task.created", args: ["NEW"] }] })} />);
  expect(screen.queryByText(/OLD/)).toBeNull();
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run src/app/dashboard-panel.test.tsx -t "not localStorage" --reporter=dot`
Expected: FAIL — the legacy entry renders.

- [ ] **Step 3: Write the implementation**

Replace `useState<ActivityEntry[]>(() => loadActivityLog())` with the threaded prop / `useWorkspace()` value, matching how the panel receives its other workspace slices. Do the same in `use-landing-delta.ts`, taking the log as an argument rather than reading storage.

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npx vitest run src/app/dashboard-panel.test.tsx src/app/use-landing-delta.test.ts --reporter=dot`
Expected: PASS.

- [ ] **Step 5: Confirm no reader is left**

Run: `grep -rn "loadActivityLog\|saveActivityLog" src/app --include="*.ts" --include="*.tsx" | grep -v "\.test\."`
Expected: hits only inside `activity-log.ts` itself (and none at all once Task 12 removes them).

- [ ] **Step 6: Commit**

```bash
git add src/app/dashboard-panel.tsx src/app/use-landing-delta.ts src/app/dashboard-panel.test.tsx
git commit -m "refactor: read the activity log from the workspace, not localStorage"
```

---

## Task 12: Drop the legacy local log

**Files:**
- Modify: `src/app/activity-log.ts`
- Test: `src/app/activity-log.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
it("deletes the pre-upgrade local log on first use and never imports it", () => {
  window.localStorage.setItem("aipm-cockpit:activity-log", JSON.stringify([{ id: 1, timestamp: "2026-08-01T00:00:00.000Z", kind: "task.created", args: ["OLD"] }]));
  dropLegacyActivityLog();
  expect(window.localStorage.getItem("aipm-cockpit:activity-log")).toBeNull();
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run src/app/activity-log.test.ts -t "pre-upgrade" --reporter=dot`
Expected: FAIL — `dropLegacyActivityLog` is not defined.

- [ ] **Step 3: Write the implementation**

```ts
/**
 * Removes the pre-upgrade device-local log. The entries are NOT imported: the
 * old key was a single global stream with no project id, so on a device that
 * had opened several projects every entry would be mis-attributed to whichever
 * project happened to be open. Dropping is the only honest option — recorded in
 * CHANGELOG.md and surfaced as a version highlight.
 */
export function dropLegacyActivityLog(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(ACTIVITY_STORAGE_KEY);
  } catch {
    // non-fatal
  }
}
```

Delete `loadActivityLog` and `saveActivityLog`, and call `dropLegacyActivityLog()` once from the app's existing client-side boot path. Keep `clearActivityLog` only if the Clear button still needs it — otherwise delete it too.

- [ ] **Step 4: Run the test and verify it passes**

Run: `npx vitest run src/app/activity-log.test.ts --reporter=dot`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/activity-log.ts src/app/activity-log.test.ts
git commit -m "feat: drop the pre-upgrade device-local activity log"
```

---

## Task 13: Release bookkeeping

**Files:**
- Modify: `src/app/version.ts`, `CHANGELOG.md`, `src/app/i18n.ts`, `src/app/i18n.de.ts`, `package.json`, `package-lock.json`, `README.md`, `docs/CODEMAPS/*.md`

**Context:** This is user-visible (history from before the upgrade disappears), so it needs a version bump and a highlight. **Five more places carry the version and no gate checks any of them.**

- [ ] **Step 1: Bump the version**

Edit `src/app/version.ts`: `APP_VERSION`, `APP_BUILD_DATE`, milestone/codename. Pick an unused codename.

- [ ] **Step 2: Add the highlight key**

Append the new `versionHighlight*` key to `APP_HIGHLIGHT_KEYS` and add EN + DE strings.

★★ `i18n.de.ts` is CRLF and the Edit tool corrupts umlauts and curls double quotes there. Patch it with a node utf8 write matching `\r\n`, then verify:

```bash
node -e "const s=require('fs').readFileSync('src/app/i18n.de.ts','utf8');console.log(/ä|ö|ü|ß/.test(s), s.includes('“')||s.includes('”'))"
```
Expected: `true false`.

- [ ] **Step 3: Write the CHANGELOG entry**

State plainly that pre-upgrade activity history is not carried forward, and why.

- [ ] **Step 4: Update the five ungated version sites**

`package.json` `version`; `package-lock.json` (**two** occurrences — root `version` and `packages[""]`); the README shields badge (version **and** codename); the `<!-- Generated: … -->` header on all five `docs/CODEMAPS/*.md`.

★ **No session URL in `CHANGELOG.md` or an MR description** — commit trailers are fine.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: release bookkeeping for the activity-log workspace slice"
```

---

## Task 14: Full gate run

- [ ] **Step 1: Typecheck and lint (no pipes)**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app; echo "EXIT=$?"
```
Expected: both EXIT=0. `npm run lint` alone does NOT reproduce the CI gate.

- [ ] **Step 2: Full suite, sharded, foreground**

The full suite exceeds the 10-minute tool cap. Run three shards **foreground, one at a time** — never two vitest processes at once, and never in the background:

```bash
npx vitest run --shard=1/3 --reporter=dot > /tmp/s1.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/s1.log
npx vitest run --shard=2/3 --reporter=dot > /tmp/s2.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/s2.log
npx vitest run --shard=3/3 --reporter=dot > /tmp/s3.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/s3.log
```
Reconcile the three totals **in a tool, not in your head**.

- [ ] **Step 3: Shuffled suite (BLOCKING gate)**

```bash
npm run test:shuffle > /tmp/shuffle.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/shuffle.log
```

- [ ] **Step 4: Coverage, size, duplication, docs**

```bash
npm run test:coverage > /tmp/cov.log 2>&1; echo "EXIT=$?"; grep "All files" /tmp/cov.log
npm run size:check; echo "EXIT=$?"
npm run dup:check; echo "EXIT=$?"
npm run docs:symbols:check; echo "EXIT=$?"
npm run docs:claims:check; echo "EXIT=$?"
```

★ `activity-log-merge.ts` is a pure engine and therefore **coverage-gated** — it must carry its own tests (Task 1 does). Do not add it to `coverage.exclude`.

- [ ] **Step 5: Sweep for live mutants**

```bash
git status --porcelain
git diff HEAD
grep -rn "if (false)\|if (true)" src/app --include="*.ts" --include="*.tsx"
```

★ The grep has **known false positives** — comment text describing a mutation in `use-chat-threads.test.tsx` and `use-snapshots.test.tsx`. **Read every hit and confirm it is a comment; never count them.**

- [ ] **Step 6: Update AGENTS.md**

Add `activityLog` to the meta-blob description beside `documents`, and record the `isWorkspaceEmpty` inversion. Every backticked name must exist in `src` — `docs:symbols:check` gates that, and it only checks mixed-case names, so a `SCREAMING_CASE` constant is ungated. **Grep any claim before writing it.**

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "docs: record the activityLog meta-blob and its isWorkspaceEmpty inversion"
```

---

## Definition of done

- All six write paths round-trip `activityLog`, each with its own test.
- `isWorkspaceEmpty` excludes it, pinned by a test and a comment naming the inversion.
- Storage-only: present in `workspaceToCsv(ws)`, absent from `workspaceToCsv(ws, config)`, absent from `EXPORT_SECTION_KEYS`.
- Merge is pure, property-tested, and runs on load **and** before save.
- Every gate in Task 14 exits 0, with the exit code read unpiped.
- No live mutants in the tree.
