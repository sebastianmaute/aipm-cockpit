# Timelog Booking Review TL1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Read each Timelog booking's comment, poll for bookings on a configurable interval, and report what changed since the previous pull — broken out per person, grouped by role.

**Architecture:** Three pure i18n-free engines (interval cadence arithmetic, comment fingerprinting, the delta) plus a job-handler registry that decouples the scheduled-job runner from Anthropic. The device-local actuals cache gains a per-booking fingerprint list beside its aggregates. No new workspace field, no new Turso table, no write to TimeLog.

**Tech Stack:** TypeScript, React 19, Next 16.2.11, vitest 4 (+ fast-check), Playwright.

**Spec:** `docs/superpowers/specs/2026-08-23-timelog-booking-review-tl1-design.md` (commit `a1fb35ff`)

---

## Read this before Task 1

Repo landmines that WILL bite this slice. Each is measured, not folklore.

- ★★★ **Never read a gate's exit code through a pipe.** `npm run test:run | tail -8` exits `0` while tests fail — that is `tail`'s status. Redirect, check unpiped, then read the file:
  `npm run test:run > /tmp/suite.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/suite.log`
- ★★ **`npx tsc --noEmit` after editing ANY test.** `next build` does not typecheck test files and vitest never typechecks, so a test-only type error passes locally and fails CI.
- ★★ **`fc.date()` can emit an Invalid Date.** Pass `{noInvalidDate:true}` or map an integer ms range through `new Date(ms)`. The regex `/s` (dotAll) flag fails tsc here (target below es2018) — use `[\s\S]`.
- ★★ **Never run two vitest processes at once.** Machine saturation is this repo's load-sensitive-flake condition.
- ★★ **`--reporter=basic` does not exist in vitest 4.** Use `--reporter=dot`.
- ★★ **The file-size gate counts `wc -l` + 1.** Read the gate's own number with
  `node -e "console.log(require('fs').readFileSync('<file>','utf8').split('\n').length)"`
- ★★ **`i18n.de.ts` is CRLF and the Edit tool corrupts umlauts in it.** Patch it with a node utf8 write and match `\r\n`, never `\n`. The `i18n-encoding` test BANS ASCII substitutes (`fuer`, `druecken`) and `\u00XX` escapes — write real umlauts.
- ★ New pure `.ts` files are **coverage-gated**. `src/app/**/*.tsx` and the listed render-scope hooks are excluded; the engines this plan adds are not, and are expected to carry full tests.
- ★ Before creating `<name>.ts`, check for an existing `<name>.tsx`. A bare `./<name>` import resolves `.ts` ahead of `.tsx`.

---

## File structure

**Create:**

| File | Responsibility |
|---|---|
| `src/app/timelog-fingerprint.ts` | Pure. `BookingFingerprint`, `hashComment`, `toFingerprints`. DOM-free, no clock. |
| `src/app/timelog-fingerprint.test.ts` | Unit tests for the above. |
| `src/app/timelog-delta.ts` | Pure. `diffBookings`, `groupDelta`, the `DeltaResult` union. No clock, no i18n. |
| `src/app/timelog-delta.test.ts` | Unit tests, one per named state. |
| `src/app/timelog-delta.property.test.ts` | fast-check properties for the diff. |
| `src/app/scheduled-jobs/job-handlers.ts` | Pure types for the handler registry. |
| `src/app/use-timelog-quiet-pull.ts` | The modal-free fetch entry point. |
| `src/app/use-timelog-quiet-pull.test.tsx` | Proves it raises no modal and never applies. |

**Modify:**

| File | Change |
|---|---|
| `src/app/timelog-types.ts` | `comment?: string` on `TimelogTimeItem` |
| `src/app/timelog-api.ts` | both mappers read the comment |
| `src/app/scheduled-jobs/types.ts` | interval cadence; `ScheduledJobType`; `MIN_INTERVAL_MINUTES` |
| `src/app/scheduled-jobs/schedule.ts` | interval branches in `isDue` / `nextRunAt` |
| `src/app/scheduled-jobs-store.ts` | sanitize the interval cadence; degrade-not-drop unknown `type` |
| `src/app/use-scheduled-job-runner.ts` | handler registry replaces the hardcoded `runJobAnalysis` |
| `src/app/use-ai-orchestration.ts` | registers the `portfolioAnalysis` handler |
| `src/app/timelog-actuals-store.ts` | `bookings?: BookingFingerprint[]` on the cache entry |
| `src/app/timelog-panel.tsx` | per-booking drill-down + delta section |
| `src/app/i18n.ts`, `src/app/i18n.de.ts` | new keys, EN + DE |

---

## Task 1: Probe the v2 endpoint for a comment field

**No code.** This is the one fact the design could not settle from the repo or the public docs.

**Files:**
- Modify: `docs/superpowers/specs/2026-08-23-timelog-booking-review-tl1-design.md`

- [ ] **Step 1: Capture a real v2 response**

At a workstation with a Timelog login, open the app, go to Time bookings, choose a customer and projects, and click Fetch bookings. In devtools → Network, open the `/api/timelog` request whose upstream path contains `/v2/projects/` and `time-registrations`. Record the **key names** of one row's `Properties` object.

- [ ] **Step 2: Decide the branch**

- If a comment-like key exists (`Comment`, `Description`, `Note`, `AdditionalTextField`), record its **exact spelling** in the spec under "The v1/v2 split" and continue to Task 2 unchanged.
- If none exists, record that, and Task 2's `mapV2TimeItem` change becomes a no-op that leaves `comment` absent. The spec's pre-decided fallback then applies: comment-bearing fetches route through v1 and clamp by project. **Do not** add per-registration enrichment — it is N+1 against an endpoint that already returns a project's whole history unpaged.

- [ ] **Step 3: Commit the recorded finding**

```bash
git add docs/superpowers/specs/2026-08-23-timelog-booking-review-tl1-design.md
git commit -m "docs: record the measured v2 time-registration field names"
```

★ If the probe cannot be run yet, implement Tasks 2–13 with `mapV2TimeItem` leaving `comment` absent, and keep this task open. Every other task is independent of the answer.

---

## Task 2: `comment` on the wire

**Files:**
- Modify: `src/app/timelog-types.ts`
- Modify: `src/app/timelog-api.ts`
- Test: `src/app/timelog-api.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `src/app/timelog-api.test.ts`:

```ts
it("v1 maps the booking comment", async () => {
  fetchMock.mockResolvedValueOnce(jsonResponse([
    { Properties: { TimeRegistrationID: 1, UserID: 7, ProjectID: 3, ProjectName: "Alpha",
      ProjectNo: "A-1", TaskID: 0, Date: "2026-08-01T00:00:00+00:00", Hours: 2,
      BillableHours: 2, IsBillable: true, Comment: "Reviewed the migration plan" } },
  ]));
  const [item] = await listTimeItemsSelf(creds, "2026-08-01", "2026-08-31");
  expect(item.comment).toBe("Reviewed the migration plan");
});

it("leaves comment ABSENT, not empty, when the row carries none", async () => {
  fetchMock.mockResolvedValueOnce(jsonResponse([
    { Properties: { TimeRegistrationID: 2, UserID: 7, ProjectID: 3, ProjectName: "Alpha",
      ProjectNo: "A-1", TaskID: 0, Date: "2026-08-01T00:00:00+00:00", Hours: 1,
      BillableHours: 1, IsBillable: true } },
  ]));
  const [item] = await listTimeItemsSelf(creds, "2026-08-01", "2026-08-31");
  expect("comment" in item).toBe(false);
});

it("treats an all-whitespace comment as absent", async () => {
  fetchMock.mockResolvedValueOnce(jsonResponse([
    { Properties: { TimeRegistrationID: 3, UserID: 7, ProjectID: 3, ProjectName: "Alpha",
      ProjectNo: "A-1", TaskID: 0, Date: "2026-08-01T00:00:00+00:00", Hours: 1,
      BillableHours: 1, IsBillable: true, Comment: "   " } },
  ]));
  const [item] = await listTimeItemsSelf(creds, "2026-08-01", "2026-08-31");
  expect("comment" in item).toBe(false);
});
```

★ Match the existing mock helpers in that file — read its top 40 lines and reuse whatever it already uses for `fetchMock` / `jsonResponse` rather than inventing new ones.

- [ ] **Step 2: Run and watch them fail**

```bash
npx vitest run src/app/timelog-api.test.ts --reporter=dot > /tmp/t2.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t2.log
```
Expected: FAIL — `item.comment` is `undefined` and `"comment" in item` is already `false` for the wrong reason (the first test fails, the second passes vacuously). That vacuous pass is expected here; test 1 is the one driving the change.

- [ ] **Step 3: Add the field**

In `src/app/timelog-types.ts`, inside `TimelogTimeItem`, after `isBillable`:

```ts
  /** The booking's free-text comment. ABSENT (never "") when the source row
   *  carries none, so "this endpoint does not supply comments" stays
   *  distinguishable from "the person left it blank" — the delta and the future
   *  review surface mean different things by those two. */
  comment?: string;
```

- [ ] **Step 4: Read it in both mappers**

In `src/app/timelog-api.ts`, add above `mapTimeItem`:

```ts
/** A comment is optional at the source. Trim, and DROP an all-whitespace value
 *  so it does not masquerade as a real one. Never returns "". */
function optionalComment(raw: unknown): string | undefined {
  const text = s(raw).trim();
  return text.length > 0 ? text : undefined;
}
```

In `mapTimeItem`, build the object then attach conditionally:

```ts
function mapTimeItem(p: Record<string, unknown>): TimelogTimeItem {
  const item: TimelogTimeItem = {
    timeRegistrationId: num(p.TimeRegistrationID), userId: num(p.UserID),
    projectId: num(p.ProjectID), projectName: s(p.ProjectName), projectNo: s(p.ProjectNo),
    taskId: num(p.TaskID), date: dateOnly(p.Date), hours: num(p.Hours),
    // Default-false: a registration without an explicit flag is non-billable,
    // so we never over-count billable hours.
    billableHours: num(p.BillableHours), isBillable: p.IsBillable === true,
  };
  const comment = optionalComment(p.Comment);
  if (comment !== undefined) item.comment = comment;
  return item;
}
```

Apply the same two lines at the end of `mapV2TimeItem`, reading the key Task 1 measured. If Task 1 found none, read `p.Comment` anyway — it costs nothing and starts working the day TimeLog adds it.

- [ ] **Step 5: Run tests and typecheck**

```bash
npx vitest run src/app/timelog-api.test.ts --reporter=dot > /tmp/t2.log 2>&1; echo "EXIT=$?"; tail -6 /tmp/t2.log
npx tsc --noEmit; echo "TSC=$?"
```
Expected: PASS, `TSC=0`.

- [ ] **Step 6: Commit**

```bash
git add src/app/timelog-types.ts src/app/timelog-api.ts src/app/timelog-api.test.ts
git commit -m "feat(timelog): read the booking comment, absent-not-empty"
```

---

## Task 3: The interval cadence

**Files:**
- Modify: `src/app/scheduled-jobs/types.ts`
- Modify: `src/app/scheduled-jobs/schedule.ts`
- Test: `src/app/scheduled-jobs/schedule.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/app/scheduled-jobs/schedule.test.ts`:

```ts
describe("interval cadence", () => {
  const job = (over: Partial<ScheduledJob> = {}): ScheduledJob => ({
    id: 1, name: "pull", type: "timelogPull",
    cadence: { kind: "interval", everyMinutes: 30 },
    enabled: true, lastRunAt: null, history: [], ...over,
  });

  it("is due when it has never run", () => {
    expect(isDue(job(), new Date("2026-08-23T10:00:00Z"))).toBe(true);
  });

  it("is not due before the interval has elapsed", () => {
    const j = job({ lastRunAt: "2026-08-23T10:00:00.000Z" });
    expect(isDue(j, new Date("2026-08-23T10:29:00Z"))).toBe(false);
  });

  it("is due once the interval has elapsed", () => {
    const j = job({ lastRunAt: "2026-08-23T10:00:00.000Z" });
    expect(isDue(j, new Date("2026-08-23T10:30:00Z"))).toBe(true);
  });

  it("fires ONCE after a long shutdown, not once per missed window", () => {
    // Six hours closed at a 30-minute interval is twelve missed windows.
    // isDue is a boolean, so the runner fires exactly one catch-up run and
    // recordRun then moves lastRunAt forward.
    const j = job({ lastRunAt: "2026-08-23T04:00:00.000Z" });
    expect(isDue(j, new Date("2026-08-23T10:00:00Z"))).toBe(true);
    const after = { ...j, lastRunAt: "2026-08-23T10:00:00.000Z" };
    expect(isDue(after, new Date("2026-08-23T10:00:01Z"))).toBe(false);
  });

  it("is never due while disabled", () => {
    expect(isDue(job({ enabled: false }), new Date("2026-08-23T10:00:00Z"))).toBe(false);
  });

  it("floors a sub-tick interval at MIN_INTERVAL_MINUTES", () => {
    const j = job({ cadence: { kind: "interval", everyMinutes: 1 },
                    lastRunAt: "2026-08-23T10:00:00.000Z" });
    expect(isDue(j, new Date("2026-08-23T10:04:00Z"))).toBe(false);
    expect(isDue(j, new Date("2026-08-23T10:05:00Z"))).toBe(true);
  });

  it("nextRunAt is lastRunAt plus the interval", () => {
    const j = job({ lastRunAt: "2026-08-23T10:00:00.000Z" });
    expect(nextRunAt(j.cadence, new Date("2026-08-23T10:10:00Z"), j.lastRunAt).toISOString())
      .toBe("2026-08-23T10:30:00.000Z");
  });

  it("nextRunAt is now plus the interval when it has never run", () => {
    expect(nextRunAt({ kind: "interval", everyMinutes: 30 },
                     new Date("2026-08-23T10:10:00Z"), null).toISOString())
      .toBe("2026-08-23T10:40:00.000Z");
  });
});
```

★ `nextRunAt` gains a third parameter. Existing callers pass two — Step 4 makes it optional so they keep compiling, and Step 5 checks that.

- [ ] **Step 2: Run and watch them fail**

```bash
npx vitest run src/app/scheduled-jobs/schedule.test.ts --reporter=dot > /tmp/t3.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t3.log
```
Expected: FAIL — the cadence type does not accept `kind: "interval"` and `isDue` returns `false` for it.

- [ ] **Step 3: Widen the types**

In `src/app/scheduled-jobs/types.ts`:

```ts
export type JobCadence =
  | { kind: "daily"; timeOfDay: string } // "HH:MM" local 24h
  | { kind: "weekly"; dayOfWeek: number; timeOfDay: string } // 0=Sun..6=Sat
  // ★★ NOT a wall-clock slot. Every OTHER cadence is a slot, and the
  // catch-up-on-next-open property is a property OF slots — `currentSlot` has no
  // meaning here, so `isDue` branches rather than inheriting.
  | { kind: "interval"; everyMinutes: number };

/** ★★ The runner ticks every 5 minutes, so a shorter configured interval is a
 *  lie the UI would be telling. Floored in `isDue` itself, not only in the
 *  picker, so a hand-edited or imported job cannot beat it. */
export const MIN_INTERVAL_MINUTES = 5;

export type ScheduledJobType = "portfolioAnalysis" | "timelogPull";
```

and change `ScheduledJob.type` to `type: ScheduledJobType;`.

- [ ] **Step 4: Branch the schedule engine**

In `src/app/scheduled-jobs/schedule.ts`, import `MIN_INTERVAL_MINUTES`, then:

```ts
function intervalMs(cadence: { everyMinutes: number }): number {
  const mins = Number.isFinite(cadence.everyMinutes) ? cadence.everyMinutes : MIN_INTERVAL_MINUTES;
  return Math.max(mins, MIN_INTERVAL_MINUTES) * 60_000;
}
```

Replace `isDue` with:

```ts
export function isDue(job: ScheduledJob, now: Date): boolean {
  if (!job.enabled) return false;
  if (job.cadence.kind === "interval") {
    // Elapsed-based, so a window missed while the app was closed fires exactly
    // ONCE on next open — `recordRun` then moves `lastRunAt` forward.
    if (job.lastRunAt === null) return true;
    return now.getTime() - new Date(job.lastRunAt).getTime() >= intervalMs(job.cadence);
  }
  const slot = currentSlot(job.cadence, now);
  if (slot === null) return false;
  if (job.lastRunAt === null) return true;
  return new Date(job.lastRunAt) < slot;
}
```

and extend `nextRunAt`:

```ts
export function nextRunAt(cadence: JobCadence, from: Date, lastRunAt?: string | null): Date {
  if (cadence.kind === "interval") {
    const base = lastRunAt ? new Date(lastRunAt).getTime() : from.getTime();
    return new Date(base + intervalMs(cadence));
  }
  const { h, m } = parseHM(cadence.timeOfDay);
  const next = new Date(from);
  next.setHours(h, m, 0, 0);
  if (cadence.kind === "daily") {
    if (next <= from) next.setDate(next.getDate() + 1);
    return next;
  }
  let delta = (cadence.dayOfWeek - next.getDay() + 7) % 7;
  if (delta === 0 && next <= from) delta = 7;
  next.setDate(next.getDate() + delta);
  return next;
}
```

★ `currentSlot` keeps its `JobCadence` parameter but is now only reached for slot cadences. Narrow its parameter type to the two slot members so tsc proves the interval case cannot reach it.

- [ ] **Step 5: Run tests, typecheck, and check every existing caller still compiles**

```bash
npx vitest run src/app/scheduled-jobs/ --reporter=dot > /tmp/t3.log 2>&1; echo "EXIT=$?"; tail -6 /tmp/t3.log
npx tsc --noEmit; echo "TSC=$?"
grep -rn "nextRunAt(" src/app --include=*.ts --include=*.tsx | grep -v "\.test\."
```
Expected: PASS, `TSC=0`. Every listed `nextRunAt` caller must either pass the third argument or be a slot cadence.

- [ ] **Step 6: Mutation-check the floor**

```bash
node -e "const f='src/app/scheduled-jobs/schedule.ts';const fs=require('fs');const s=fs.readFileSync(f,'utf8');const m=s.replace('Math.max(mins, MIN_INTERVAL_MINUTES)','mins');if(m===s)throw new Error('MUTANT DID NOT LAND');fs.writeFileSync(f,m)"
npx vitest run src/app/scheduled-jobs/schedule.test.ts --reporter=dot > /tmp/mut.log 2>&1; echo "EXIT=$?"
git checkout -- src/app/scheduled-jobs/schedule.ts
```
Expected: `EXIT=1` — the floor test kills the mutant. ★ The `throw` proves the mutant actually landed; a silent no-op replace would give a green run that reads as vacuity. **Revert immediately** — a live mutant left in the tree is worse than no test.

- [ ] **Step 7: Commit**

```bash
git add src/app/scheduled-jobs/types.ts src/app/scheduled-jobs/schedule.ts src/app/scheduled-jobs/schedule.test.ts
git commit -m "feat(jobs): add an elapsed-based interval cadence, floored at the tick"
```

---

## Task 4: Sanitize the interval cadence, and degrade rather than drop an unknown type

**Files:**
- Modify: `src/app/scheduled-jobs-store.ts`
- Test: `src/app/scheduled-jobs-store.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
it("round-trips an interval cadence", () => {
  const jobs = sanitizeJobsForTest([{ id: 1, name: "pull", type: "timelogPull",
    cadence: { kind: "interval", everyMinutes: 30 }, enabled: true,
    lastRunAt: null, history: [] }]);
  expect(jobs[0].cadence).toEqual({ kind: "interval", everyMinutes: 30 });
});

it("floors a persisted sub-tick interval", () => {
  const jobs = sanitizeJobsForTest([{ id: 1, name: "pull", type: "timelogPull",
    cadence: { kind: "interval", everyMinutes: 1 }, enabled: true,
    lastRunAt: null, history: [] }]);
  expect(jobs[0].cadence).toEqual({ kind: "interval", everyMinutes: 5 });
});

it("DEGRADES an unknown type to disabled-and-visible instead of dropping it", () => {
  const jobs = sanitizeJobsForTest([{ id: 9, name: "from a newer build",
    type: "somethingFuture", cadence: { kind: "daily", timeOfDay: "09:00" },
    enabled: true, lastRunAt: null, history: [] }]);
  expect(jobs).toHaveLength(1);
  expect(jobs[0].id).toBe(9);
  expect(jobs[0].enabled).toBe(false);
  expect(jobs[0].unknownType).toBe("somethingFuture");
});

it("still drops a row with no usable id", () => {
  expect(sanitizeJobsForTest([{ name: "x", type: "timelogPull",
    cadence: { kind: "daily", timeOfDay: "09:00" }, enabled: true,
    lastRunAt: null, history: [] }])).toHaveLength(0);
});
```

★ `sanitizeJobs` is module-private. Export it under a test-visible name, or drive it through the existing `loadScheduledJobs(null)` localStorage path the way the file's current tests do — read them first and match that style rather than adding a new export if one is not already there.

- [ ] **Step 2: Run and watch them fail**

```bash
npx vitest run src/app/scheduled-jobs-store.test.ts --reporter=dot > /tmp/t4.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t4.log
```
Expected: FAIL — the interval cadence sanitizes to `null` (dropping the job), and the unknown type is dropped outright.

- [ ] **Step 3: Add the degraded-job field**

In `src/app/scheduled-jobs/types.ts`, on `ScheduledJob`:

```ts
  /** ★★ Set ONLY when a persisted `type` did not parse — the job came from a
   *  newer build, or was hand-edited. The job is kept, forced disabled, and
   *  surfaced so the user can see and delete it. Dropping it silently loses a
   *  configuration the user made and can neither see nor recover. */
  unknownType?: string;
```

- [ ] **Step 4: Sanitize both**

In `src/app/scheduled-jobs-store.ts`, extend `sanitizeCadence`:

```ts
  if (kind === "interval") {
    const every = Number(raw.everyMinutes);
    return {
      kind: "interval",
      everyMinutes: Number.isFinite(every)
        ? Math.max(every, MIN_INTERVAL_MINUTES)
        : MIN_INTERVAL_MINUTES,
    };
  }
```

and replace the type rejection in `sanitizeJob`:

```ts
  const rawType = raw.type;
  const known = rawType === "portfolioAnalysis" || rawType === "timelogPull";
  // ...
  return {
    id,
    name: typeof raw.name === "string" ? raw.name : "",
    type: known ? (rawType as ScheduledJobType) : "portfolioAnalysis",
    cadence,
    enabled: known ? raw.enabled === true : false,
    lastRunAt,
    history,
    ...(known ? {} : { unknownType: typeof rawType === "string" ? rawType : "unknown" }),
  };
```

- [ ] **Step 5: Run tests and typecheck**

```bash
npx vitest run src/app/scheduled-jobs-store.test.ts --reporter=dot > /tmp/t4.log 2>&1; echo "EXIT=$?"; tail -6 /tmp/t4.log
npx tsc --noEmit; echo "TSC=$?"
```
Expected: PASS, `TSC=0`.

- [ ] **Step 6: Commit**

```bash
git add src/app/scheduled-jobs-store.ts src/app/scheduled-jobs/types.ts src/app/scheduled-jobs-store.test.ts
git commit -m "feat(jobs): sanitize the interval cadence; degrade an unknown job type instead of dropping it"
```

---

## Task 5: A job-handler registry, so a non-AI job does not need an API key

**Files:**
- Create: `src/app/scheduled-jobs/job-handlers.ts`
- Modify: `src/app/use-scheduled-job-runner.ts`
- Modify: `src/app/use-ai-orchestration.ts`
- Test: `src/app/use-scheduled-job-runner.test.tsx`

★★★ **Why this task exists.** The runner is wired `enabled: !isPopout && isAiEnabled(settings.ai) && settings.ai?.scheduledJobs === true` and its tick body calls `runJobAnalysis` directly. Hanging a Timelog pull on that makes booking sync silently depend on an Anthropic key being present — a dependency no user could ever guess.

- [ ] **Step 1: Write the failing tests**

```tsx
it("runs a due job whose handler needs no AI, with AI switched off", async () => {
  const run = vi.fn(async () => ({ summary: "3 new bookings", actionCount: 3 }));
  renderHook(() => useScheduledJobRunner({
    enabled: true,
    jobs: [intervalJob("timelogPull")],
    handlers: { timelogPull: { canRun: () => true, run } },
    recordRun: vi.fn(), notify: vi.fn(), now: () => new Date("2026-08-23T10:00:00Z"),
  }));
  await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
});

it("SKIPS a due job whose handler reports it cannot run, and records why", async () => {
  const recordRun = vi.fn();
  const run = vi.fn();
  renderHook(() => useScheduledJobRunner({
    enabled: true,
    jobs: [intervalJob("timelogPull")],
    handlers: { timelogPull: { canRun: () => false, skipReason: () => "notConfigured", run } },
    recordRun, notify: vi.fn(), now: () => new Date("2026-08-23T10:00:00Z"),
  }));
  await waitFor(() => expect(recordRun).toHaveBeenCalled());
  expect(run).not.toHaveBeenCalled();
  expect(recordRun.mock.calls[0][1]).toMatchObject({ ok: false, error: "notConfigured" });
});

it("skips a job with no registered handler without throwing", async () => {
  const recordRun = vi.fn();
  renderHook(() => useScheduledJobRunner({
    enabled: true, jobs: [intervalJob("timelogPull")], handlers: {},
    recordRun, notify: vi.fn(), now: () => new Date("2026-08-23T10:00:00Z"),
  }));
  await waitFor(() => expect(recordRun).toHaveBeenCalled());
  expect(recordRun.mock.calls[0][1]).toMatchObject({ ok: false });
});

it("notifies on success and NOT on failure", async () => {
  const notify = vi.fn();
  renderHook(() => useScheduledJobRunner({
    enabled: true, jobs: [intervalJob("timelogPull")],
    handlers: { timelogPull: { canRun: () => true,
      run: async () => { throw new Error("boom"); } } },
    recordRun: vi.fn(), notify, now: () => new Date("2026-08-23T10:00:00Z"),
  }));
  await waitFor(() => expect(notify).not.toHaveBeenCalled());
});
```

with a local helper in the test file:

```tsx
const intervalJob = (type: ScheduledJobType): ScheduledJob => ({
  id: 1, name: "pull", type, cadence: { kind: "interval", everyMinutes: 30 },
  enabled: true, lastRunAt: null, history: [],
});
```

- [ ] **Step 2: Run and watch them fail**

```bash
npx vitest run src/app/use-scheduled-job-runner.test.tsx --reporter=dot > /tmp/t5.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t5.log
```
Expected: FAIL — `handlers` is not a known arg and the hook still calls `runJobAnalysis`.

- [ ] **Step 3: Define the registry**

Create `src/app/scheduled-jobs/job-handlers.ts`:

```ts
// scheduled-jobs/job-handlers.ts — pure types, i18n-free, no React.
// One handler per ScheduledJob type. The runner owns WHEN a job runs; a handler
// owns WHETHER it CAN run and WHAT running means. Keeping `canRun` on the
// handler is what lets a non-AI job (a Timelog pull) coexist with an AI job
// under one runner without inheriting the AI gate.
import type { ScheduledJobType } from "./types";

export interface JobHandlerResult {
  summary: string;
  actionCount: number;
}

export interface JobHandler {
  /** False when the job's integration is unconfigured or degraded. A handler
   *  that cannot run must SKIP, never throw — a skip is a normal state. */
  canRun: () => boolean;
  /** Short machine-readable reason recorded when `canRun` is false. Never a
   *  token, key, URL or body — run history is user-visible. */
  skipReason?: () => string;
  run: () => Promise<JobHandlerResult>;
}

export type JobHandlers = Partial<Record<ScheduledJobType, JobHandler>>;
```

- [ ] **Step 4: Rewrite the runner's tick body**

In `src/app/use-scheduled-job-runner.ts`, replace `buildContext`/`ai` in `ScheduledJobRunnerArgs` with `handlers: JobHandlers`, mirror it into a ref exactly like the others, and replace the per-job body:

```ts
        for (const job of due) {
          const handler = handlersRef.current[job.type];
          if (!handler) {
            recordRunRef.current(job.id, { ranAt, summary: "", actionCount: 0,
              ok: false, error: "noHandler" });
            continue;
          }
          if (!handler.canRun()) {
            recordRunRef.current(job.id, { ranAt, summary: "", actionCount: 0,
              ok: false, error: handler.skipReason?.() ?? "unavailable" });
            continue;
          }
          try {
            const result = await handler.run();
            recordRunRef.current(job.id, { ranAt, summary: result.summary,
              actionCount: result.actionCount, ok: true });
            notifyRef.current(job.name, result.summary);
          } catch (e) {
            // Record the failure but do NOT notify — avoid failure-notification spam.
            recordRunRef.current(job.id, { ranAt, summary: "", actionCount: 0, ok: false,
              error: e instanceof AiHttpError && classifyAiError(e.status, e.errorType) === "limit"
                ? "limit"
                : e instanceof Error ? e.message : "error" });
          }
        }
```

★ Keep the existing `recordRun`-on-failure behaviour and its comment verbatim. It sets `lastRunAt` for failures too, so a persistently failing job cannot re-spam a billed API call every tick.

- [ ] **Step 5: Move the AI gate onto the AI handler**

In `src/app/use-ai-orchestration.ts`:

```ts
  useScheduledJobRunner({
    enabled: !isPopout,
    jobs: scheduledJobs.jobs,
    recordRun: scheduledJobs.recordRun,
    handlers: {
      portfolioAnalysis: {
        canRun: () => isAiEnabled(settings.ai) && settings.ai?.scheduledJobs === true,
        skipReason: () => "aiDisabled",
        run: async () => {
          const analysis = await runJobAnalysis(buildAiContext(), {
            apiKey: aiKeyIfEnabled(settings.ai),
            model: settings.ai?.model ?? "claude-sonnet-4-6",
          });
          return { summary: analysis.summary, actionCount: analysis.actions.length };
        },
      },
    },
    notify: notifyScheduledJob,
  });
```

★ Behaviour is preserved exactly: the AI job still runs only under the same three conditions. What changed is that those conditions no longer gate the *runner*.

- [ ] **Step 6: Run tests and typecheck**

```bash
npx vitest run src/app/use-scheduled-job-runner.test.tsx src/app/use-scheduled-jobs.test.ts --reporter=dot > /tmp/t5.log 2>&1; echo "EXIT=$?"; tail -8 /tmp/t5.log
npx tsc --noEmit; echo "TSC=$?"
```
Expected: PASS, `TSC=0`.

- [ ] **Step 7: Commit**

```bash
git add src/app/scheduled-jobs/job-handlers.ts src/app/use-scheduled-job-runner.ts src/app/use-ai-orchestration.ts src/app/use-scheduled-job-runner.test.tsx
git commit -m "refactor(jobs): dispatch through a handler registry so a non-AI job needs no API key"
```

---

## Task 6: Booking fingerprints

**Files:**
- Create: `src/app/timelog-fingerprint.ts`
- Test: `src/app/timelog-fingerprint.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { hashComment, toFingerprints } from "./timelog-fingerprint";
import type { TimelogTimeItem } from "./timelog-types";

const item = (over: Partial<TimelogTimeItem> = {}): TimelogTimeItem => ({
  timeRegistrationId: 1, userId: 7, projectId: 3, projectName: "Alpha",
  projectNo: "A-1", taskId: 0, date: "2026-08-01", hours: 2,
  billableHours: 2, isBillable: true, ...over,
});

describe("hashComment", () => {
  it("is stable for the same text", () => {
    expect(hashComment("Reviewed the plan")).toBe(hashComment("Reviewed the plan"));
  });
  it("differs for different text", () => {
    expect(hashComment("a")).not.toBe(hashComment("b"));
  });
  it("maps absent and empty to the SAME sentinel", () => {
    // Both mean "no comment to compare"; the mapper already guarantees an
    // absent field rather than "", so this is belt-and-braces.
    expect(hashComment(undefined)).toBe(hashComment(""));
  });
  it("is not the identity — it must not carry the text", () => {
    const text = "a very identifying sentence about a named person";
    expect(hashComment(text)).not.toContain("named");
    expect(hashComment(text).length).toBeLessThanOrEqual(8);
  });
});

describe("toFingerprints", () => {
  it("keeps id, user, date, hours and the comment HASH — never the text", () => {
    const [fp] = toFingerprints([item({ comment: "secret sentence" })]);
    expect(fp).toEqual({ id: 1, u: 7, d: "2026-08-01", h: 2, bh: 2,
                         c: hashComment("secret sentence") });
    expect(JSON.stringify(fp)).not.toContain("secret");
  });
  it("is order-independent by id", () => {
    const a = toFingerprints([item({ timeRegistrationId: 1 }), item({ timeRegistrationId: 2 })]);
    const b = toFingerprints([item({ timeRegistrationId: 2 }), item({ timeRegistrationId: 1 })]);
    expect([...a].sort((x, y) => x.id - y.id)).toEqual([...b].sort((x, y) => x.id - y.id));
  });
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
npx vitest run src/app/timelog-fingerprint.test.ts --reporter=dot > /tmp/t6.log 2>&1; echo "EXIT=$?"; tail -12 /tmp/t6.log
```
Expected: FAIL — `Cannot find module './timelog-fingerprint'`.

- [ ] **Step 3: Implement**

Create `src/app/timelog-fingerprint.ts`:

```ts
// Pure, i18n-free, clock-free, DOM-free. The per-booking baseline the delta
// diffs against.
//
// ★★★ THE COMMENT TEXT IS DELIBERATELY NOT STORED. Two reasons, and the second
// is the load-bearing one:
//   1. Full text for every booking across the cached projects would put
//      megabytes of free-text into localStorage, which has no eviction and a
//      hard per-origin ceiling.
//   2. It would be the one copy of employee free-text living OUTSIDE Turso,
//      unredacted, on every device — and it would survive every code path the
//      redaction slice (TL3) later adds, because TL3 governs what LEAVES for
//      the model, not what a cache wrote months earlier.
// Consequence, accepted: the delta can report "comment changed" and show the
// NEW text (it is in hand from the fetch) but can never show a before/after
// diff. Do not "improve" this by storing the text.
import type { TimelogTimeItem } from "./timelog-types";

/** Keys are short because this is written once per booking per project and the
 *  whole map shares one localStorage entry with the aggregates. */
export type BookingFingerprint = {
  id: number;  // timeRegistrationId
  u: number;   // userId (0 = unresolved, aggregated as unattributed)
  d: string;   // ISO date, day precision
  h: number;   // hours
  bh: number;  // billable hours
  c: string;   // comment hash, never the comment
};

const NO_COMMENT = "0";

/** FNV-1a, 32-bit, hex. Not cryptographic and does not need to be — it answers
 *  "did this text change", never "what was this text". Chosen over SubtleCrypto
 *  because that is async and browser-only, and this module must stay callable
 *  from a pure test with no DOM. */
export function hashComment(text: string | undefined): string {
  if (!text) return NO_COMMENT;
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16);
}

export function toFingerprints(items: readonly TimelogTimeItem[]): BookingFingerprint[] {
  return items.map((it) => ({
    id: it.timeRegistrationId,
    u: it.userId,
    d: it.date,
    h: it.hours,
    bh: it.billableHours,
    c: hashComment(it.comment),
  }));
}
```

- [ ] **Step 4: Run tests and typecheck**

```bash
npx vitest run src/app/timelog-fingerprint.test.ts --reporter=dot > /tmp/t6.log 2>&1; echo "EXIT=$?"; tail -6 /tmp/t6.log
npx tsc --noEmit; echo "TSC=$?"
```
Expected: PASS, `TSC=0`.

- [ ] **Step 5: Commit**

```bash
git add src/app/timelog-fingerprint.ts src/app/timelog-fingerprint.test.ts
git commit -m "feat(timelog): fingerprint bookings, hashing the comment rather than storing it"
```

---

## Task 7: The delta engine

**Files:**
- Create: `src/app/timelog-delta.ts`
- Test: `src/app/timelog-delta.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import { computeDelta } from "./timelog-delta";
import type { BookingFingerprint } from "./timelog-fingerprint";
import type { Resource } from "./types";
import type { TimelogLinks } from "./timelog-types";

const fp = (over: Partial<BookingFingerprint> = {}): BookingFingerprint =>
  ({ id: 1, u: 7, d: "2026-08-01", h: 2, bh: 2, c: "abc", ...over });

const links: TimelogLinks = {
  userLinks: [{ timelogUserId: 7, resourceId: 70, manual: false }],
  projectLinks: [],
};
const resources = [
  { id: 70, firstName: "A", lastName: "B", roleId: 5, utilizationMode: "percent",
    utilization: {} },
  { id: 71, firstName: "C", lastName: "D", roleId: null, utilizationMode: "percent",
    utilization: {} },
] as unknown as Resource[];

describe("computeDelta", () => {
  it("reports FIRST PULL when there is no baseline, never 'everything is new'", () => {
    const r = computeDelta(undefined, [fp(), fp({ id: 2 })], links, resources, false);
    expect(r.kind).toBe("first-pull");
    if (r.kind === "first-pull") expect(r.bookingCount).toBe(2);
  });

  it("distinguishes an EMPTY baseline from a MISSING one", () => {
    // An empty array is a real prior state: last pull genuinely found nothing.
    const r = computeDelta([], [fp()], links, resources, false);
    expect(r.kind).toBe("delta");
  });

  it("classifies added, removed and changed", () => {
    const base = [fp({ id: 1 }), fp({ id: 2 })];
    const now = [fp({ id: 1, h: 3 }), fp({ id: 3 })];
    const r = computeDelta(base, now, links, resources, false);
    if (r.kind !== "delta") throw new Error("expected a delta");
    const all = r.groups.flatMap((g) => g.people).flatMap((p) => p.deltas);
    expect(all.find((d) => d.fp.id === 3)?.kind).toBe("added");
    expect(all.find((d) => d.fp.id === 2)?.kind).toBe("removed");
    const changed = all.find((d) => d.fp.id === 1);
    expect(changed?.kind).toBe("changed");
    if (changed?.kind === "changed") expect(changed.changed).toEqual(["hours"]);
  });

  it("names a comment change without carrying any text", () => {
    const r = computeDelta([fp({ c: "aaa" })], [fp({ c: "bbb" })], links, resources, false);
    if (r.kind !== "delta") throw new Error("expected a delta");
    const d = r.groups[0].people[0].deltas[0];
    if (d.kind !== "changed") throw new Error("expected a change");
    expect(d.changed).toEqual(["comment"]);
    expect(JSON.stringify(r)).not.toContain("aaa");
  });

  it("groups an unassigned role under a null roleId rather than folding it in", () => {
    const l: TimelogLinks = { userLinks: [{ timelogUserId: 8, resourceId: 71, manual: false }],
      projectLinks: [] };
    const r = computeDelta([], [fp({ id: 4, u: 8 })], l, resources, false);
    if (r.kind !== "delta") throw new Error("expected a delta");
    expect(r.groups.map((g) => g.roleId)).toEqual([null]);
  });

  it("puts an unlinked Timelog user in the unattributed group", () => {
    const r = computeDelta([], [fp({ id: 5, u: 999 })], links, resources, false);
    if (r.kind !== "delta") throw new Error("expected a delta");
    const people = r.groups.flatMap((g) => g.people);
    expect(people.some((p) => p.resourceId === null)).toBe(true);
  });

  it("marks a PARTIAL result so the caller cannot store it as the baseline", () => {
    const r = computeDelta([fp()], [fp({ h: 9 })], links, resources, true);
    if (r.kind !== "delta") throw new Error("expected a delta");
    expect(r.partial).toBe(true);
  });

  it("reports no change as an empty delta, not as first-pull", () => {
    const r = computeDelta([fp()], [fp()], links, resources, false);
    if (r.kind !== "delta") throw new Error("expected a delta");
    expect(r.total).toBe(0);
  });
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
npx vitest run src/app/timelog-delta.test.ts --reporter=dot > /tmp/t7.log 2>&1; echo "EXIT=$?"; tail -12 /tmp/t7.log
```
Expected: FAIL — `Cannot find module './timelog-delta'`.

- [ ] **Step 3: Implement**

Create `src/app/timelog-delta.ts`:

```ts
// Pure, i18n-free, CLOCK-FREE. What changed between the previous pull's
// fingerprints and this one's, grouped person-then-role.
//
// Four states are NAMED rather than smothered, because each was a real defect
// waiting to happen:
//   - no baseline        -> "first pull", never "everything is new"
//   - a null roleId      -> its own group; never folded into another role
//   - an unlinked user   -> the unattributed group, matching aggregateActuals
//   - a partial fetch    -> FLAGGED. ★★★ The caller must not store a partial
//     result as the new baseline: a short aggregate erases the missing
//     project's real booked hours on apply, and a partial baseline would make
//     the NEXT delta wrong in both directions with nothing to report it.
import type { BookingFingerprint } from "./timelog-fingerprint";
import type { TimelogLinks } from "./timelog-types";
import type { Resource } from "./types";

export type BookingChangeKind = "hours" | "billableHours" | "date" | "comment";

export type BookingDelta =
  | { kind: "added"; fp: BookingFingerprint }
  | { kind: "removed"; fp: BookingFingerprint }
  | { kind: "changed"; fp: BookingFingerprint; changed: BookingChangeKind[] };

/** `resourceId: null` = the Timelog user is not linked to a resource. */
export type DeltaPersonGroup = { resourceId: number | null; deltas: BookingDelta[] };
/** `roleId: null` = the person exists but carries no role, OR is unlinked. */
export type DeltaRoleGroup = { roleId: number | null; people: DeltaPersonGroup[] };

export type DeltaResult =
  | { kind: "first-pull"; bookingCount: number; partial: boolean }
  | { kind: "delta"; groups: DeltaRoleGroup[]; total: number; partial: boolean };

function changesBetween(a: BookingFingerprint, b: BookingFingerprint): BookingChangeKind[] {
  const out: BookingChangeKind[] = [];
  if (a.h !== b.h) out.push("hours");
  if (a.bh !== b.bh) out.push("billableHours");
  if (a.d !== b.d) out.push("date");
  if (a.c !== b.c) out.push("comment");
  return out;
}

export function computeDelta(
  // ★ `undefined` (no baseline) and `[]` (a prior pull that found nothing) are
  // DIFFERENT states and must stay distinguishable — hence the optional type
  // rather than a defaulted empty array.
  baseline: readonly BookingFingerprint[] | undefined,
  current: readonly BookingFingerprint[],
  links: TimelogLinks,
  resources: readonly Resource[],
  partial: boolean,
): DeltaResult {
  if (baseline === undefined) {
    return { kind: "first-pull", bookingCount: current.length, partial };
  }

  const before = new Map(baseline.map((fp) => [fp.id, fp]));
  const after = new Map(current.map((fp) => [fp.id, fp]));
  const deltas: BookingDelta[] = [];

  for (const fp of current) {
    const prior = before.get(fp.id);
    if (!prior) { deltas.push({ kind: "added", fp }); continue; }
    const changed = changesBetween(prior, fp);
    if (changed.length > 0) deltas.push({ kind: "changed", fp, changed });
  }
  for (const fp of baseline) {
    if (!after.has(fp.id)) deltas.push({ kind: "removed", fp });
  }

  const userToRes = new Map(links.userLinks.map((l) => [l.timelogUserId, l.resourceId]));
  const resById = new Map(resources.map((r) => [r.id, r]));

  // roleId -> resourceId -> deltas. A Map preserves insertion order, so the
  // output is deterministic for a given input order (the tests rely on it).
  const byRole = new Map<number | null, Map<number | null, BookingDelta[]>>();
  for (const d of deltas) {
    const resourceId = userToRes.get(d.fp.u) ?? null;
    const roleId = resourceId === null ? null : (resById.get(resourceId)?.roleId ?? null);
    let people = byRole.get(roleId);
    if (!people) { people = new Map(); byRole.set(roleId, people); }
    const list = people.get(resourceId);
    if (list) list.push(d); else people.set(resourceId, [d]);
  }

  const groups: DeltaRoleGroup[] = [...byRole.entries()].map(([roleId, people]) => ({
    roleId,
    people: [...people.entries()].map(([resourceId, ds]) => ({ resourceId, deltas: ds })),
  }));

  return { kind: "delta", groups, total: deltas.length, partial };
}
```

- [ ] **Step 4: Run tests and typecheck**

```bash
npx vitest run src/app/timelog-delta.test.ts --reporter=dot > /tmp/t7.log 2>&1; echo "EXIT=$?"; tail -6 /tmp/t7.log
npx tsc --noEmit; echo "TSC=$?"
```
Expected: PASS, `TSC=0`.

- [ ] **Step 5: Commit**

```bash
git add src/app/timelog-delta.ts src/app/timelog-delta.test.ts
git commit -m "feat(timelog): compute the booking delta, grouped person-then-role"
```

---

## Task 8: Property tests for the delta

**Files:**
- Create: `src/app/timelog-delta.property.test.ts`

- [ ] **Step 1: Write the properties**

```ts
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { computeDelta } from "./timelog-delta";
import type { BookingFingerprint } from "./timelog-fingerprint";
import type { TimelogLinks } from "./timelog-types";
import type { Resource } from "./types";

const links: TimelogLinks = { userLinks: [], projectLinks: [] };
const resources: readonly Resource[] = [];

const fpArb = fc.record({
  id: fc.integer({ min: 1, max: 200 }),
  u: fc.integer({ min: 0, max: 20 }),
  // ★ fc.date() can emit an Invalid Date whose toISOString() THROWS. Map an
  // integer ms range instead.
  d: fc.integer({ min: 0, max: 3_000 })
      .map((n) => new Date(1_750_000_000_000 + n * 86_400_000).toISOString().slice(0, 10)),
  h: fc.integer({ min: 0, max: 24 }),
  bh: fc.integer({ min: 0, max: 24 }),
  c: fc.hexaString({ minLength: 1, maxLength: 8 }),
});
const uniqueById = fc.uniqueArray(fpArb, { maxLength: 40, selector: (f) => f.id });

describe("delta properties", () => {
  it("a baseline diffed against itself yields zero changes", () => {
    fc.assert(fc.property(uniqueById, (fps: BookingFingerprint[]) => {
      const r = computeDelta(fps, fps, links, resources, false);
      expect(r.kind).toBe("delta");
      if (r.kind === "delta") expect(r.total).toBe(0);
    }), { numRuns: 200 });
  });

  it("every booking is classified exactly once", () => {
    fc.assert(fc.property(uniqueById, uniqueById, (a, b) => {
      const r = computeDelta(a, b, links, resources, false);
      if (r.kind !== "delta") throw new Error("expected a delta");
      const ids = r.groups.flatMap((g) => g.people).flatMap((p) => p.deltas).map((d) => d.fp.id);
      expect(new Set(ids).size).toBe(ids.length);
    }), { numRuns: 200 });
  });

  it("an absent baseline is ALWAYS first-pull, whatever the current set", () => {
    fc.assert(fc.property(uniqueById, (fps) => {
      expect(computeDelta(undefined, fps, links, resources, false).kind).toBe("first-pull");
    }), { numRuns: 100 });
  });

  it("partial is carried through untouched", () => {
    fc.assert(fc.property(uniqueById, uniqueById, fc.boolean(), (a, b, partial) => {
      expect(computeDelta(a, b, links, resources, partial).partial).toBe(partial);
    }), { numRuns: 100 });
  });
});
```

- [ ] **Step 2: Run and typecheck**

```bash
npx vitest run src/app/timelog-delta.property.test.ts --reporter=dot > /tmp/t8.log 2>&1; echo "EXIT=$?"; tail -8 /tmp/t8.log
npx tsc --noEmit; echo "TSC=$?"
```
Expected: PASS, `TSC=0`.

- [ ] **Step 3: Mutation-check that the properties bite**

```bash
node -e "const f='src/app/timelog-delta.ts';const fs=require('fs');const s=fs.readFileSync(f,'utf8');const m=s.replace('if (a.c !== b.c) out.push(\"comment\");','');if(m===s)throw new Error('MUTANT DID NOT LAND');fs.writeFileSync(f,m)"
npx vitest run src/app/timelog-delta.test.ts --reporter=dot > /tmp/mut.log 2>&1; echo "EXIT=$?"
git checkout -- src/app/timelog-delta.ts
```
Expected: `EXIT=1` — the comment-change test kills it. **Revert immediately.**

- [ ] **Step 4: Commit**

```bash
git add src/app/timelog-delta.property.test.ts
git commit -m "test(timelog): property-test the booking delta"
```

---

## Task 9: Persist fingerprints in the actuals cache

**Files:**
- Modify: `src/app/timelog-actuals-store.ts`
- Test: `src/app/timelog-actuals-store.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
it("round-trips booking fingerprints", () => {
  saveActualsCache("p1", { fetchedAt: "2026-08-23T10:00:00Z",
    bookings: [{ id: 1, u: 7, d: "2026-08-01", h: 2, bh: 2, c: "abc" }] });
  expect(loadActualsCache("p1")?.bookings).toEqual([
    { id: 1, u: 7, d: "2026-08-01", h: 2, bh: 2, c: "abc" },
  ]);
});

it("keeps an entry whose bookings are malformed, dropping only that field", () => {
  // Failing OPEN matches how `partial` is treated: losing good aggregates over
  // one bad field is the worse outcome.
  localStorage.setItem(TIMELOG_ACTUALS_KEY, JSON.stringify({
    p1: { fetchedAt: "2026-08-23T10:00:00Z", bookings: "not an array" },
  }));
  const entry = loadActualsCache("p1");
  expect(entry?.fetchedAt).toBe("2026-08-23T10:00:00Z");
  expect(entry?.bookings).toBeUndefined();
});

it("distinguishes an absent bookings field from an empty one", () => {
  saveActualsCache("p1", { fetchedAt: "2026-08-23T10:00:00Z", bookings: [] });
  expect(loadActualsCache("p1")?.bookings).toEqual([]);
  saveActualsCache("p2", { fetchedAt: "2026-08-23T10:00:00Z" });
  expect(loadActualsCache("p2")?.bookings).toBeUndefined();
});
```

- [ ] **Step 2: Run and watch them fail**

```bash
npx vitest run src/app/timelog-actuals-store.test.ts --reporter=dot > /tmp/t9.log 2>&1; echo "EXIT=$?"; tail -12 /tmp/t9.log
```
Expected: FAIL — `bookings` is not on the entry type.

- [ ] **Step 3: Add the field and its guard**

In `src/app/timelog-actuals-store.ts`, import the type and extend `ActualsCacheEntry`:

```ts
  /** Per-booking baseline for the delta. Optional for back-compat with entries
   *  written before this field existed, and absent-vs-empty is meaningful:
   *  ABSENT means "no baseline, report a first pull"; EMPTY means "the previous
   *  pull genuinely found nothing".
   *  ★★★ Fingerprints only — the comment is hashed, never stored. See
   *  timelog-fingerprint.ts for why that is not an optimisation to undo. */
  bookings?: BookingFingerprint[];
```

and in `isEntry`, mirroring the existing optional-field checks:

```ts
  if (e.bookings !== undefined && !Array.isArray(e.bookings)) return false;
```

★ That rejects the whole entry on a malformed `bookings`, which contradicts the second test. Instead, normalise inside `readMap` after `isEntry` passes:

```ts
    if (isEntry(v)) {
      const entry = { ...v } as ActualsCacheEntry;
      // Fail OPEN on a malformed bookings list: drop the field, keep the entry.
      // Losing good aggregates over one bad field is the worse outcome, and it
      // is the same call `partial` makes.
      if (entry.bookings !== undefined && !Array.isArray(entry.bookings)) {
        delete entry.bookings;
      }
      out[k] = entry;
    }
```

and leave `isEntry` **without** a `bookings` clause, so a malformed value cannot reject the entry.

- [ ] **Step 4: Run tests and typecheck**

```bash
npx vitest run src/app/timelog-actuals-store.test.ts --reporter=dot > /tmp/t9.log 2>&1; echo "EXIT=$?"; tail -6 /tmp/t9.log
npx tsc --noEmit; echo "TSC=$?"
```
Expected: PASS, `TSC=0`.

- [ ] **Step 5: Commit**

```bash
git add src/app/timelog-actuals-store.ts src/app/timelog-actuals-store.test.ts
git commit -m "feat(timelog): persist booking fingerprints beside the aggregates"
```

---

## Task 10: The quiet pull

**Files:**
- Create: `src/app/use-timelog-quiet-pull.ts`
- Test: `src/app/use-timelog-quiet-pull.test.tsx`

★★★ **Why a separate entry point.** `useTimelogSync` is on-demand by contract — every fetch runs under `runGuarded` and raises a BLOCKING modal with a Cancel button. Correct for a gesture, unacceptable on a timer: a modal appearing every 30 minutes over whatever the user is doing is worse than no polling at all.

- [ ] **Step 1: Write the failing tests**

```tsx
it("fetches without raising the loading modal", async () => {
  const { result } = renderHook(() => useTimelogQuietPull(deps()));
  await act(async () => { await result.current.pull(); });
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("NEVER applies to the budget", async () => {
  const applyToBudget = vi.fn();
  const { result } = renderHook(() => useTimelogQuietPull(deps({ applyToBudget })));
  await act(async () => { await result.current.pull(); });
  expect(applyToBudget).not.toHaveBeenCalled();
});

it("does NOT overwrite the baseline when the fetch came back partial", async () => {
  // Seed a NON-EMPTY prior baseline: with an empty one this passes for the
  // wrong reason, because "unchanged" and "empty" look identical.
  saveActualsCache("p1", { fetchedAt: "2026-08-01T00:00:00Z",
    bookings: [{ id: 1, u: 7, d: "2026-08-01", h: 2, bh: 2, c: "abc" }] });
  const { result } = renderHook(() => useTimelogQuietPull(deps({ partial: true })));
  await act(async () => { await result.current.pull(); });
  expect(loadActualsCache("p1")?.bookings).toEqual([
    { id: 1, u: 7, d: "2026-08-01", h: 2, bh: 2, c: "abc" },
  ]);
});

it("DOES store the baseline on a clean fetch", async () => {
  saveActualsCache("p1", { fetchedAt: "2026-08-01T00:00:00Z", bookings: [] });
  const { result } = renderHook(() => useTimelogQuietPull(deps({ partial: false })));
  await act(async () => { await result.current.pull(); });
  expect(loadActualsCache("p1")?.bookings?.length).toBeGreaterThan(0);
});

it("skips with a reason when the integration is unconfigured", async () => {
  const { result } = renderHook(() => useTimelogQuietPull(deps({ configured: false })));
  const outcome = await result.current.pull();
  expect(outcome).toMatchObject({ ok: false, reason: "notConfigured" });
});
```

★ `deps()` is a local factory in the test file returning the hook's dependency object with sensible defaults, overridable per test. Write it to match the deps object Step 3 defines.

- [ ] **Step 2: Run and watch it fail**

```bash
npx vitest run src/app/use-timelog-quiet-pull.test.tsx --reporter=dot > /tmp/t10.log 2>&1; echo "EXIT=$?"; tail -12 /tmp/t10.log
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/app/use-timelog-quiet-pull.ts`:

```ts
"use client";
// The BACKGROUND booking pull. Deliberately NOT part of useTimelogSync:
// ★★★ every fetch there runs under `runGuarded` and raises a BLOCKING modal
// with a Cancel button. That is right for a user gesture and wrong on a timer —
// a modal appearing every 30 minutes over whatever the user is doing is worse
// than no polling at all.
//
// ★★★ THIS PATH NEVER APPLIES. Applying writes actuals onto the plan and is
// confirm-gated; a timer that applies is silent data mutation. The job
// notifies; the human applies.
import { useCallback } from "react";
import { computeDelta, type DeltaResult } from "./timelog-delta";
import { toFingerprints } from "./timelog-fingerprint";
import { loadActualsCache, saveActualsCache } from "./timelog-actuals-store";
import type { TimelogLinks, TimelogTimeItem } from "./timelog-types";
import type { Resource } from "./types";

export type QuietPullOutcome =
  | { ok: true; delta: DeltaResult }
  | { ok: false; reason: "notConfigured" | "tokenInvalid" | "error" };

export interface QuietPullDeps {
  projectId: string;
  configured: boolean;
  links: TimelogLinks;
  resources: readonly Resource[];
  /** Resolves to the fetched rows plus whether any project/employee was LOST to
   *  an error. Injected so this hook stays testable without the network. */
  fetchItems: () => Promise<{ items: TimelogTimeItem[]; partial: boolean }>;
}

export function useTimelogQuietPull(deps: QuietPullDeps): {
  pull: () => Promise<QuietPullOutcome>;
} {
  const pull = useCallback(async (): Promise<QuietPullOutcome> => {
    if (!deps.configured) return { ok: false, reason: "notConfigured" };
    let fetched: { items: TimelogTimeItem[]; partial: boolean };
    try {
      fetched = await deps.fetchItems();
    } catch {
      return { ok: false, reason: "error" };
    }

    const prior = loadActualsCache(deps.projectId);
    const current = toFingerprints(fetched.items);
    const delta = computeDelta(prior?.bookings, current, deps.links, deps.resources,
                               fetched.partial);

    // ★★★ A PARTIAL RESULT MUST NEVER BECOME THE BASELINE. A short aggregate
    // erases the missing project's real booked hours on apply, and a partial
    // baseline makes the NEXT delta wrong in BOTH directions with nothing to
    // report it. Report it; do not store it.
    if (!fetched.partial) {
      saveActualsCache(deps.projectId, {
        ...(prior ?? { fetchedAt: "" }),
        fetchedAt: new Date().toISOString(),
        bookings: current,
      });
    }
    return { ok: true, delta };
  }, [deps]);

  return { pull };
}
```

- [ ] **Step 4: Run tests and typecheck**

```bash
npx vitest run src/app/use-timelog-quiet-pull.test.tsx --reporter=dot > /tmp/t10.log 2>&1; echo "EXIT=$?"; tail -6 /tmp/t10.log
npx tsc --noEmit; echo "TSC=$?"
```
Expected: PASS, `TSC=0`.

- [ ] **Step 5: Mutation-check the partial guard**

```bash
node -e "const f='src/app/use-timelog-quiet-pull.ts';const fs=require('fs');const s=fs.readFileSync(f,'utf8');const m=s.replace('if (!fetched.partial) {','if (true) {');if(m===s)throw new Error('MUTANT DID NOT LAND');fs.writeFileSync(f,m)"
npx vitest run src/app/use-timelog-quiet-pull.test.tsx --reporter=dot > /tmp/mut.log 2>&1; echo "EXIT=$?"
git checkout -- src/app/use-timelog-quiet-pull.ts
```
Expected: `EXIT=1`. **Revert immediately.**

- [ ] **Step 6: Commit**

```bash
git add src/app/use-timelog-quiet-pull.ts src/app/use-timelog-quiet-pull.test.tsx
git commit -m "feat(timelog): add the modal-free background pull that never applies"
```

---

## Task 11: i18n keys, EN and DE

**Files:**
- Modify: `src/app/i18n.ts`
- Modify: `src/app/i18n.de.ts`

- [ ] **Step 1: Add the EN keys**

In `src/app/i18n.ts`, beside the other `timelog*` keys:

```ts
  timelogJobName: "Timelog booking pull",
  timelogJobInterval: "Check every",
  timelogJobIntervalMinutes: "{0} minutes",
  timelogJobNextRun: "Next check: {0}",
  timelogDeltaFirstPull: "First pull — {0} bookings recorded as the baseline.",
  timelogDeltaNone: "No changes since the last check.",
  timelogDeltaSummary: "{0} changes since the last check.",
  timelogDeltaAdded: "New",
  timelogDeltaRemoved: "Removed",
  timelogDeltaChanged: "Changed",
  timelogDeltaChangeHours: "hours",
  timelogDeltaChangeBillable: "billable hours",
  timelogDeltaChangeDate: "date",
  timelogDeltaChangeComment: "comment",
  timelogDeltaPartial: "Some projects could not be read, so this delta is incomplete and was not saved as the new baseline.",
  timelogDeltaUnassignedRole: "No role assigned",
  timelogDeltaUnlinked: "Not linked to a resource",
  timelogBookingComment: "Comment",
  timelogBookingNoComment: "No comment",
  timelogJobSkippedNotConfigured: "Skipped — Timelog is not configured.",
```

- [ ] **Step 2: Add the DE keys with a node utf8 write**

★★ **Do NOT use the Edit tool on `i18n.de.ts`** — it corrupts umlauts and curls double quotes. The file is CRLF, so a `\n` anchor silently no-ops.

```bash
node -e "
const fs=require('fs');const p='src/app/i18n.de.ts';
let s=fs.readFileSync(p,'utf8');
const anchor='  timelogTitle:';           // verified present in i18n.de.ts
if(!s.includes(anchor)) throw new Error('ANCHOR MISS — find a real neighbouring key');
const add=[
'  timelogJobName: \"Timelog-Buchungsabruf\",',
'  timelogJobInterval: \"Prüfen alle\",',
'  timelogJobIntervalMinutes: \"{0} Minuten\",',
'  timelogJobNextRun: \"Nächste Prüfung: {0}\",',
'  timelogDeltaFirstPull: \"Erster Abruf — {0} Buchungen als Ausgangsstand gespeichert.\",',
'  timelogDeltaNone: \"Keine Änderungen seit der letzten Prüfung.\",',
'  timelogDeltaSummary: \"{0} Änderungen seit der letzten Prüfung.\",',
'  timelogDeltaAdded: \"Neu\",',
'  timelogDeltaRemoved: \"Entfernt\",',
'  timelogDeltaChanged: \"Geändert\",',
'  timelogDeltaChangeHours: \"Stunden\",',
'  timelogDeltaChangeBillable: \"Fakturierbare Stunden\",',
'  timelogDeltaChangeDate: \"Datum\",',
'  timelogDeltaChangeComment: \"Kommentar\",',
'  timelogDeltaPartial: \"Einige Projekte konnten nicht gelesen werden. Diese Übersicht ist unvollständig und wurde nicht als neuer Ausgangsstand gespeichert.\",',
'  timelogDeltaUnassignedRole: \"Keine Rolle zugewiesen\",',
'  timelogDeltaUnlinked: \"Keiner Ressource zugeordnet\",',
'  timelogBookingComment: \"Kommentar\",',
'  timelogBookingNoComment: \"Kein Kommentar\",',
'  timelogJobSkippedNotConfigured: \"Übersprungen — Timelog ist nicht konfiguriert.\",',
''].join('\r\n');
s=s.replace(anchor, add+anchor);
fs.writeFileSync(p,s,'utf8');
console.log('OK');
"
```

- [ ] **Step 3: Verify parity and encoding**

```bash
npx tsc --noEmit; echo "TSC=$?"
npx vitest run src/app/i18n-encoding.test.ts --reporter=dot > /tmp/t11.log 2>&1; echo "EXIT=$?"; tail -6 /tmp/t11.log
node -e "const s=require('fs').readFileSync('src/app/i18n.de.ts','utf8');console.log('umlauts present:', /[äöüÄÖÜß]/.test(s));console.log('ascii subs:', /fuer|druecken|Aenderung/.test(s))"
```
Expected: `TSC=0` (tsc enforces EN/DE key parity), encoding test PASS, umlauts `true`, ascii subs `false`.

- [ ] **Step 4: Commit**

```bash
git add src/app/i18n.ts src/app/i18n.de.ts
git commit -m "i18n: add the timelog delta and interval-job strings"
```

---

## Task 12: Wire the job handler and the Settings row

**Files:**
- Modify: `src/app/task-manager.tsx` (or the timelog-owning hook it delegates to)
- Modify: the scheduled-jobs settings section
- Test: `src/app/timelog-panel.test.tsx`

- [ ] **Step 1: Register the handler**

Where the Timelog state lives, build the handler and pass it into the runner's `handlers` map alongside `portfolioAnalysis`:

```ts
  timelogPull: {
    canRun: () => timelogConfigured,
    skipReason: () => "notConfigured",
    run: async () => {
      const outcome = await quietPull.pull();
      if (!outcome.ok) throw new Error(outcome.reason);
      const d = outcome.delta;
      const summary = d.kind === "first-pull"
        ? t(lang, "timelogDeltaFirstPull", String(d.bookingCount))
        : d.total === 0
          ? t(lang, "timelogDeltaNone")
          : t(lang, "timelogDeltaSummary", String(d.total));
      return { summary, actionCount: d.kind === "delta" ? d.total : 0 };
    },
  },
```

★ The handler is the ONLY place the delta becomes a translated string — `timelog-delta.ts` stays i18n-free.

- [ ] **Step 2: Add the interval option to the cadence picker**

In the scheduled-jobs settings section, add "interval" to the cadence selector with a minutes input whose `min` is `MIN_INTERVAL_MINUTES`. The `<select>` and the number input each need an `aria-label` — a visible `<span>` label is not an accessible name, and Settings is axe-scanned.

- [ ] **Step 3: Verify accessibility on the scanned view**

```bash
npx playwright test e2e/a11y.spec.ts --project=chromium -g "Settings" --workers=1 > /tmp/axe.log 2>&1; echo "EXIT=$?"; tail -12 /tmp/axe.log
```
Expected: PASS. ★ `--workers=1` is mandatory whenever more than one view matches — locally Playwright runs at CPU count while CI runs serially, and over-subscription produces `Test timeout` failures that name no rule and are NOT violations.

- [ ] **Step 4: Commit**

```bash
git add -A src/app
git commit -m "feat(timelog): register the pull job and its interval cadence in settings"
```

---

## Task 13: The panel — per-booking drill-down and the delta section

**Files:**
- Create: `src/app/timelog-delta-section.tsx`
- Create: `src/app/timelog-booking-rows.tsx`
- Modify: `src/app/timelog-panel.tsx` (wiring only)
- Test: `src/app/timelog-panel.test.tsx`

★★★ **THE NEW UI MUST NOT LAND IN `timelog-panel.tsx`.** Measured 2026-08-23: the file is at
**795 lines with NO entry in `docs/baselines/file-sizes.json`**, so the gate treats it as a new
file against the hard 800 cap — **five lines of headroom**, and the gate counts `wc -l` **+ 1**, so
budgeting from `wc -l` overstates that by one more. Both new surfaces are therefore separate
presentational files taking data and handlers as props (the gantt/reports/raid split precedent),
and the panel gains only the two mounts.

Re-measure before starting rather than trusting this number — the panel may have moved:

```bash
node -e "console.log(require('fs').readFileSync('src/app/timelog-panel.tsx','utf8').split('\n').length)"
node -e "const b=require('./docs/baselines/file-sizes.json');console.log(b['src/app/timelog-panel.tsx'] ?? '(no baseline — the 800 cap applies)')"
npm run size:check > /tmp/size.log 2>&1; echo "SIZE=$?"
```

- [ ] **Step 1: Write the failing tests**

```tsx
it("renders each person's bookings with their comments", async () => {
  renderPanel({ items: [booking({ comment: "Reviewed the migration plan" })] });
  await userEvent.click(screen.getByRole("button", { name: /bookings – A B/i }));
  expect(screen.getByText("Reviewed the migration plan")).toBeInTheDocument();
});

it("gives every per-row control a row-UNIQUE accessible name", () => {
  // ★★★ axe CANNOT catch a duplicate accessible name — measured against
  // axe-core 4.12.1, none of the 69 rules under the gate's four tags flags it,
  // at ANY seed size. A unit test rendering >= 2 rows is the ONLY detector.
  renderPanel({ items: [booking({ userId: 7 }), booking({ userId: 8, timeRegistrationId: 2 })] });
  const names = screen.getAllByRole("button", { name: /bookings –/i })
    .map((b) => b.getAttribute("aria-label"));
  expect(new Set(names).size).toBe(names.length);
});

it("says FIRST PULL rather than listing everything as new", () => {
  renderPanel({ delta: { kind: "first-pull", bookingCount: 12, partial: false } });
  expect(screen.getByText(/first pull/i)).toBeInTheDocument();
});

it("warns that a partial delta was not saved as the baseline", () => {
  renderPanel({ delta: { kind: "delta", groups: [], total: 0, partial: true } });
  expect(screen.getByText(/incomplete and was not saved/i)).toBeInTheDocument();
});

it("labels an unassigned role and an unlinked person explicitly", () => {
  renderPanel({ delta: { kind: "delta", total: 1, partial: false, groups: [
    { roleId: null, people: [{ resourceId: null, deltas: [
      { kind: "added", fp: { id: 1, u: 9, d: "2026-08-01", h: 1, bh: 1, c: "x" } }] }] }] } });
  expect(screen.getByText(/no role assigned/i)).toBeInTheDocument();
  expect(screen.getByText(/not linked to a resource/i)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run and watch them fail**

```bash
npx vitest run src/app/timelog-panel.test.tsx --reporter=dot > /tmp/t13.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t13.log
```
Expected: FAIL — no drill-down control, no delta section.

- [ ] **Step 3: Implement the drill-down and the delta section**

Render, under each person row, a disclosure button whose accessible name includes the person, and a list of that person's bookings showing date, hours, billable hours and the comment (or the `timelogBookingNoComment` placeholder). Render the delta section above the tables, branching on `delta.kind` and rendering the partial warning when `delta.partial` is true.

★ Row-unique naming pattern, matching the rest of the app:
```tsx
aria-label={`${t(lang, "timelogBookingsFor")} – ${resourceName}`}
```

- [ ] **Step 4: Run tests, typecheck, lint**

```bash
npx vitest run src/app/timelog-panel.test.tsx --reporter=dot > /tmp/t13.log 2>&1; echo "EXIT=$?"; tail -6 /tmp/t13.log
npx tsc --noEmit; echo "TSC=$?"
npx eslint src/app/timelog-panel.tsx; echo "ESLINT=$?"
```
Expected: PASS, `TSC=0`, `ESLINT=0`. ★ There is no `--max-warnings` gate in CI, so an unused import ships green — check the eslint output by eye, not just its exit code.

- [ ] **Step 5: Commit**

```bash
git add src/app/timelog-panel.tsx src/app/timelog-panel.test.tsx
git commit -m "feat(timelog): show per-booking comments and the delta since the last check"
```

---

## Task 14: Docs, changelog, and closing 224

**Files:**
- Modify: `docs/AGENTS/integrations.md`
- Modify: `docs/open-followups.md`
- Modify: `CHANGELOG.md`, `src/app/version.ts`, `package.json`, `package-lock.json`, `README.md`, `docs/CODEMAPS/*.md`

- [ ] **Step 1: Document the subsystem**

Add a Timelog section to `docs/AGENTS/integrations.md` covering: the interval cadence being elapsed-based rather than a slot (and why catch-up is one run, not N); the fingerprint-not-text decision and its consequence; the two hard rules (never apply, never baseline a partial); and the handler registry. **Cite symbols, never line numbers** — the doc-claims ratchet fails on a new `path:LINE` citation, and a line number rots on the next insertion.

- [ ] **Step 2: Close 224**

Mark §224 CLOSED with the shipping version, and leave §616 open.

- [ ] **Step 3: Bump every version carrier**

★★ Eight places carry the version and **no gate checks five of them**:

```bash
grep -n "APP_VERSION\|APP_BUILD_DATE\|APP_MILESTONE" src/app/version.ts
grep -n "\"version\"" package.json
grep -n "\"version\"" package-lock.json | head -3   # root AND packages[""]
grep -n "img.shields.io" README.md
grep -n "^<!-- Generated:" docs/CODEMAPS/*.md
```
Bump them in the SAME commit or the drift restarts. Pick an unused codename — `grep` `CHANGELOG.md` first, ~230 are taken.

- [ ] **Step 4: Run the full gate set, unpiped**

```bash
npx tsc --noEmit; echo "TSC=$?"
npx eslint --max-warnings=0 src/app; echo "ESLINT=$?"
npm run size:check > /tmp/g1.log 2>&1; echo "SIZE=$?"
npm run dup:check > /tmp/g2.log 2>&1; echo "DUP=$?"
npm run docs:symbols:check > /tmp/g3.log 2>&1; echo "SYMBOLS=$?"
npm run docs:claims:check > /tmp/g4.log 2>&1; echo "CLAIMS=$?"
npm run test:coverage > /tmp/g5.log 2>&1; echo "COVERAGE=$?"
npm run test:shuffle > /tmp/g6.log 2>&1; echo "SHUFFLE=$?"
```
★★★ Every one is unpiped. Reading any of these through `| tail` gives you the pipe's status, not the gate's.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(release): <version> <codename>"
```

---

## Self-review

**Spec coverage.** Comment on the wire → Tasks 1–2. Fingerprint baseline → Tasks 6, 9. Interval cadence + floor + degrade-not-drop → Tasks 3–4. Delta with all four named states → Tasks 7–8. Never-apply + no-modal → Task 10. Surfaces → Tasks 12–13. i18n → Task 11. Docs and 224 → Task 14. The runner's AI coupling was not in the spec and is covered by Task 5 — it was found while writing this plan and is a prerequisite, not scope creep.

**Type consistency.** `BookingFingerprint` (`id`/`u`/`d`/`h`/`bh`/`c`) is defined in Task 6 and used unchanged in 7, 9 and 10. `DeltaResult` is defined in Task 7 and consumed in 10, 12, 13. `JobHandler`/`JobHandlers` are defined in Task 5 and used in 5 and 12. `MIN_INTERVAL_MINUTES` is defined in Task 3 and used in 3, 4, 12. `computeDelta` keeps one signature throughout.

**Known gaps, deliberately left.** Task 1 may be blocked away from a workstation; every other task is independent of its answer. Task 12's Settings edits and Task 13's panel edits name behaviour and accessible-name patterns rather than quoting full JSX, because both files must be read first — Task 13 opens with the size-headroom check that decides whether the code lands in the panel or in a new file.
