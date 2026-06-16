# Action Center Loop/Learning Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Learn from how the user responds to suggested actions (executable CTA / snooze / dismiss) and feed a bounded, safety-capped bias back into the pure ranking engine, with a configurable store (local/Turso), an insights view + per-row hint, opt-in settings, and a bundled docs repositioning.

**Architecture:** Pure `action-learning.ts` (decay/bias/override) → optional `ActionInput.learnedBias` additive term in the engine with a safety floor → `LearningStore` (local default + Turso fallback) → `use-action-learning` capture hook wired into the scattered CTA handlers → insights view + row hint + settings → release 0.95.0 + docs.

**Tech Stack:** TypeScript, React 19, Next.js (forked), Vitest + Testing Library, Turso (libSQL) via `runTursoPipeline`.

**Spec:** `docs/superpowers/specs/2026-06-16-action-learning-design.md` (committed `b4a0be3`).

**Branch:** `feat-loop-learning` (already checked out).

---

## File Structure

- **Create** `src/app/action-learning.ts` (+ `.test.ts`) — pure decay/bias/override/buildBiasMap.
- **Modify** `src/app/next-actions/score.ts` — add `applyLearnedBias`.
- **Modify** `src/app/next-actions/types.ts` — `ActionInput.learnedBias?`, `SuggestedAction.learning?`.
- **Modify** `src/app/next-actions/engine.ts` — apply bias + annotate (+ engine test).
- **Modify** `src/app/settings-types.ts` — `nextActionsLearning` config + default + coerce.
- **Modify** `src/app/use-settings.ts` — migrate `nextActionsLearning`.
- **Create** `src/app/learning-store.ts` — `LearningStore`/`LearningSnapshot` types + `pickLearningStore`.
- **Create** `src/app/learning-store-local.ts` (+ `.test.ts`) — localStorage impl.
- **Create** `src/app/learning-schema.ts` + `src/app/learning-store-turso.ts` (+ `.test.ts`) — Turso impl, OUT of `TABLE_NAMES`.
- **Create** `src/app/use-action-learning.ts` (+ `.test.tsx`) — capture hook.
- **Modify** `src/app/task-manager.tsx` — thread bias + record from CTA/snooze handlers.
- **Modify** `src/app/i18n.ts` + `src/app/i18n.de.ts` — new keys.
- **Create** `src/app/learning-insights.tsx` (+ `.test.tsx`) — insights view/panel.
- **Modify** `src/app/nav-config.ts` — add `learning-insights` AppView.
- **Modify** `src/app/action-row.tsx` (+ test) — per-row learning hint.
- **Modify** `src/app/settings-sections/*` (the next-actions settings section) — learning controls.
- **Modify** `src/app/version.ts` + `CHANGELOG.md` — release 0.95.0.
- **Modify** `README.md`, `docs/CODEMAPS/*`, `docs/RUNBOOK.md` — docs refresh.

**Engineer context (read once):**
- `Lang = "en-US" | "en-GB" | "de"` (never `"en"`). `t(lang, key, ...params)` → 0-based `{0}`.
- `i18n.de.ts` is CRLF; the Edit tool corrupts umlauts there → node UTF-8 write, match `\r\n`.
- CI `--max-warnings=0`: unused import/var/param = FATAL. `react-hooks/exhaustive-deps` rejects an `obj.member` dep → hoist to a const. Refs are exempt.
- New `ActionInput` fields MUST be **optional** or provider test `input()` helpers break.
- Engine facts: `scoreAction` (intrinsic, unchanged), `TIER_NOW = 60`, `TIER_SOON = 30`, `bandTier`. `SuggestedAction.id = ${source}:${entityId}:${reason}`; learning granule = `${source}:${why.key}`.
- Turso store pattern = `comm-templates-store.ts` + `comm-templates-schema.ts` (DDL + select/upsert + rows helpers, `runTursoPipeline(config, [...ddl, ...stmts])`). New table must stay OUT of `TABLE_NAMES` (`turso-schema.ts:83`) — a guard test enforces it (mirror `comm-templates-store.test.ts`). `SqlArg.value` is string-only → `String(int)`.

---

## Task 1: Pure `action-learning.ts`

**Files:** Create `src/app/action-learning.ts`, `src/app/action-learning.test.ts`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/app/action-learning.test.ts
import { describe, it, expect } from "vitest";
import {
  recordOutcome, decayStats, learnedBias, effectiveBias, buildBiasMap,
  BIAS_CAP, MIN_EVIDENCE, DECAY_HALF_LIFE_MS, type OutcomeStats,
} from "./action-learning";

const empty = (): OutcomeStats => ({ acted: 0, snoozed: 0, dismissed: 0, lastAt: 0 });

describe("recordOutcome", () => {
  it("increments the given type immutably and sets lastAt", () => {
    const s0 = {};
    const s1 = recordOutcome(s0, "raid:why", "acted", 1000);
    expect(s0).toEqual({});
    expect(s1["raid:why"]).toEqual({ acted: 1, snoozed: 0, dismissed: 0, lastAt: 1000 });
  });
  it("accumulates across calls", () => {
    let s = recordOutcome({}, "k", "acted", 1000);
    s = recordOutcome(s, "k", "snoozed", 1000);
    expect(s.k.acted).toBe(1);
    expect(s.k.snoozed).toBe(1);
  });
});

describe("decayStats", () => {
  it("halves counts after one half-life", () => {
    const s = { acted: 4, snoozed: 0, dismissed: 0, lastAt: 0 };
    const d = decayStats(s, DECAY_HALF_LIFE_MS);
    expect(d.acted).toBeCloseTo(2, 5);
    expect(d.lastAt).toBe(DECAY_HALF_LIFE_MS);
  });
  it("no decay when lastAt is 0/now equal", () => {
    expect(decayStats(empty(), 0)).toEqual(empty());
  });
});

describe("learnedBias", () => {
  it("returns 0 below the min-evidence floor", () => {
    expect(learnedBias({ acted: 2, snoozed: 0, dismissed: 0, lastAt: 0 })).toBe(0);
    expect(MIN_EVIDENCE).toBe(3);
  });
  it("positive when acted dominates, clamped to +CAP", () => {
    expect(learnedBias({ acted: 100, snoozed: 0, dismissed: 0, lastAt: 0 })).toBe(BIAS_CAP);
  });
  it("negative when dismissed dominates, clamped to -CAP", () => {
    expect(learnedBias({ acted: 0, snoozed: 0, dismissed: 100, lastAt: 0 })).toBe(-BIAS_CAP);
  });
  it("snooze weighs half a dismiss", () => {
    // net = -0.5*4 = -2 over total 4 => round(CAP * -2/4) = round(-CAP/2)
    expect(learnedBias({ acted: 0, snoozed: 4, dismissed: 0, lastAt: 0 })).toBe(Math.round(-BIAS_CAP / 2));
  });
});

describe("effectiveBias", () => {
  const s = { acted: 100, snoozed: 0, dismissed: 0, lastAt: 0 };
  it("override surface/suppress/off pin the value", () => {
    expect(effectiveBias(s, "surface")).toBe(BIAS_CAP);
    expect(effectiveBias(s, "suppress")).toBe(-BIAS_CAP);
    expect(effectiveBias(s, "off")).toBe(0);
  });
  it("auto delegates to learnedBias", () => {
    expect(effectiveBias(s, "auto")).toBe(learnedBias(s));
  });
});

describe("buildBiasMap", () => {
  it("omits zero entries and applies overrides", () => {
    const state = { hot: { acted: 100, snoozed: 0, dismissed: 0, lastAt: 0 }, cold: { acted: 1, snoozed: 0, dismissed: 0, lastAt: 0 } };
    const map = buildBiasMap(state, { forced: "surface" }, 0);
    expect(map.hot).toBe(BIAS_CAP);
    expect(map.cold).toBeUndefined();       // below evidence => 0 => omitted
    expect(map.forced).toBe(BIAS_CAP);      // override-only kind included
  });
});
```

- [ ] **Step 2: Run to verify fail** — `npm run test:run -- src/app/action-learning.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement**

```ts
// src/app/action-learning.ts — pure, i18n-free learning model for the Action Center.
export type OutcomeType = "acted" | "snoozed" | "dismissed";
export type OutcomeStats = { acted: number; snoozed: number; dismissed: number; lastAt: number };
export type LearningState = Record<string, OutcomeStats>; // key = `${source}:${why.key}`
export type LearningOverride = "auto" | "surface" | "suppress" | "off";
export type LearningOverrides = Record<string, LearningOverride>;

export const BIAS_CAP = 20;
export const MIN_EVIDENCE = 3;
export const DECAY_HALF_LIFE_MS = 30 * 24 * 60 * 60 * 1000;
const W_ACTED = 1, W_SNOOZED = 0.5, W_DISMISSED = 1;

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export function decayStats(s: OutcomeStats, now: number): OutcomeStats {
  if (!s.lastAt || now <= s.lastAt) return s;
  const f = 0.5 ** ((now - s.lastAt) / DECAY_HALF_LIFE_MS);
  return { acted: s.acted * f, snoozed: s.snoozed * f, dismissed: s.dismissed * f, lastAt: now };
}

export function recordOutcome(state: LearningState, kind: string, type: OutcomeType, now: number): LearningState {
  const prev = state[kind] ?? { acted: 0, snoozed: 0, dismissed: 0, lastAt: 0 };
  const decayed = decayStats(prev, now);
  return { ...state, [kind]: { ...decayed, [type]: decayed[type] + 1, lastAt: now } };
}

export function learnedBias(s: OutcomeStats): number {
  const total = s.acted + s.snoozed + s.dismissed;
  if (total < MIN_EVIDENCE) return 0;
  const net = W_ACTED * s.acted - W_SNOOZED * s.snoozed - W_DISMISSED * s.dismissed;
  return clamp(Math.round(BIAS_CAP * (net / total)), -BIAS_CAP, BIAS_CAP);
}

export function effectiveBias(s: OutcomeStats, override: LearningOverride): number {
  switch (override) {
    case "surface": return BIAS_CAP;
    case "suppress": return -BIAS_CAP;
    case "off": return 0;
    default: return learnedBias(s);
  }
}

export function buildBiasMap(state: LearningState, overrides: LearningOverrides, now: number): Record<string, number> {
  const kinds = new Set<string>([...Object.keys(state), ...Object.keys(overrides)]);
  const out: Record<string, number> = {};
  const zero: OutcomeStats = { acted: 0, snoozed: 0, dismissed: 0, lastAt: 0 };
  for (const k of kinds) {
    const bias = effectiveBias(decayStats(state[k] ?? zero, now), overrides[k] ?? "auto");
    if (bias !== 0) out[k] = bias;
  }
  return out;
}
```

- [ ] **Step 4: Run to verify pass** — `npm run test:run -- src/app/action-learning.test.ts` → all PASS.
- [ ] **Step 5: Lint + typecheck** — `npm run lint && npx tsc --noEmit` → clean.
- [ ] **Step 6: Commit** — `git add src/app/action-learning.ts src/app/action-learning.test.ts && git commit -m "feat: pure action-learning model (decay, bias, override)"`

---

## Task 2: Engine bias term + safety floor

**Files:** Modify `src/app/next-actions/score.ts`, `src/app/next-actions/types.ts`, `src/app/next-actions/engine.ts`. Test: `src/app/next-actions/engine.test.ts` (exists — add cases).

- [ ] **Step 1: Add types** — in `types.ts`:
  - Add to `SuggestedAction`: `learning?: { bias: number; moved: "up" | "down" };` (after `cta`).
  - Add to `ActionInput` (optional block): `/** Learned per-kind bias (`${source}:${why.key}` → points). Off when undefined. */ learnedBias?: Record<string, number>;`

- [ ] **Step 2: Write the failing engine test** — append to `src/app/next-actions/engine.test.ts`:

```ts
import { computeNextActions } from "./engine";
import { TIER_NOW } from "./score";
import type { ActionInput, ActionProvider, SuggestedAction } from "./types";

function stubAction(id: string, source: SuggestedAction["source"], whyKey: string, score: number): SuggestedAction {
  return { id, source, title: { key: "x" as never }, why: { key: whyKey as never }, score, tier: "monitor", cta: { kind: "snooze", actionId: id } };
}
function providerOf(actions: SuggestedAction[]): ActionProvider { return { provide: () => actions }; }
function baseInput(over: Partial<ActionInput> = {}): ActionInput {
  return { tasks: [], raid: [], changes: [], milestones: [], stakeholders: [], commsReminders: [], dashboard: {} as never, features: [], today: "2026-06-16", projectName: "P", now: new Date("2026-06-16T00:00:00Z"), reminderLeadDays: 7, dueSoonWorkdays: 3, raidReviewIntervalDays: 14, dismissed: new Set<string>(), ...over };
}

describe("learnedBias in the engine", () => {
  it("adds positive bias and annotates moved:up", () => {
    const a = stubAction("raid:1:x", "raid", "wk", 40); // monitor-ish/soon
    const out = computeNextActions(baseInput({ learnedBias: { "raid:wk": 15 } }), [providerOf([a])]);
    expect(out[0].score).toBe(55);
    expect(out[0].learning).toEqual({ bias: 15, moved: "up" });
  });
  it("safety floor: an intrinsically-now item is never demoted out of now", () => {
    const a = stubAction("raid:2:x", "raid", "wk", 65); // intrinsic now
    const out = computeNextActions(baseInput({ learnedBias: { "raid:wk": -20 } }), [providerOf([a])]);
    expect(out[0].score).toBeGreaterThanOrEqual(TIER_NOW);
    expect(out[0].tier).toBe("now");
  });
  it("no learnedBias = unchanged score, no annotation", () => {
    const a = stubAction("raid:3:x", "raid", "wk", 40);
    const out = computeNextActions(baseInput(), [providerOf([a])]);
    expect(out[0].score).toBe(40);
    expect(out[0].learning).toBeUndefined();
  });
});
```

Run: `npm run test:run -- src/app/next-actions/engine.test.ts` → FAIL.

- [ ] **Step 3: Implement `applyLearnedBias`** — in `score.ts` (after `bandTier`):

```ts
/** Apply a bounded learned bias to an intrinsic score, never demoting an
 *  intrinsically-now item out of the now tier (safety floor). */
export function applyLearnedBias(intrinsic: number, kind: string, learnedBias?: Record<string, number>): number {
  const bias = learnedBias?.[kind] ?? 0;
  const biased = Math.max(0, intrinsic + bias);
  return intrinsic >= TIER_NOW ? Math.max(biased, TIER_NOW) : biased;
}
```

- [ ] **Step 4: Wire into `engine.ts`** — replace the dedup loop body so each kept action gets bias-applied + annotated:

```ts
import { applyLearnedBias, bandTier } from "./score";
// ...
      if (!byId.has(a.id)) {
        const kind = `${a.source}:${a.why.key}`;
        const final = applyLearnedBias(a.score, kind, input.learnedBias);
        const bias = final - a.score;
        byId.set(a.id, {
          ...a,
          score: final,
          tier: bandTier(final),
          learning: bias === 0 ? undefined : { bias, moved: bias > 0 ? "up" : "down" },
        });
      }
```
(Keep the rest of `computeNextActions` identical. Note: `bias = final - a.score` correctly reflects the post-floor delta — when the floor clamps a negative bias to 0 net change, `learning` is omitted, which is the honest annotation.)

- [ ] **Step 5: Run** — `npm run test:run -- src/app/next-actions/engine.test.ts` → PASS. Then `npm run test:run -- src/app/next-actions` → all existing provider tests still green (back-compat: no `learnedBias` = unchanged).
- [ ] **Step 6: Lint + typecheck** — clean.
- [ ] **Step 7: Commit** — `git add src/app/next-actions && git commit -m "feat: learned-bias term in the next-actions engine (safety-floored)"`

---

## Task 3: Settings `nextActionsLearning` config

**Files:** Modify `src/app/settings-types.ts`, `src/app/use-settings.ts`, test `src/app/use-settings.test.ts`.

- [ ] **Step 1: Add the type + default** — in `settings-types.ts`:
  - New type near `NextActionsConfig`:
    ```ts
    export type LearningStoreKind = "local" | "turso";
    export type NextActionsLearningConfig = { enabled: boolean; store: LearningStoreKind };
    export const defaultNextActionsLearning: NextActionsLearningConfig = { enabled: false, store: "local" };
    ```
  - Add to the `Settings` type (after `nextActions?`): `/** Action Center learning layer (opt-in). */ nextActionsLearning?: NextActionsLearningConfig;`

- [ ] **Step 2: Failing test** — add to `use-settings.test.ts`:

```ts
import { migrateNextActionsLearning } from "./use-settings";
describe("migrateNextActionsLearning", () => {
  it("defaults to disabled + local when absent", () => {
    expect(migrateNextActionsLearning(undefined)).toEqual({ enabled: false, store: "local" });
  });
  it("coerces store to the union, else local", () => {
    expect(migrateNextActionsLearning({ enabled: true, store: "turso" })).toEqual({ enabled: true, store: "turso" });
    expect(migrateNextActionsLearning({ enabled: "yes", store: "cloud" })).toEqual({ enabled: false, store: "local" });
  });
});
```
Run → FAIL.

- [ ] **Step 3: Implement** — in `use-settings.ts` add + export:

```ts
import { defaultNextActionsLearning, type NextActionsLearningConfig } from "./settings-types";
export function migrateNextActionsLearning(raw: unknown): NextActionsLearningConfig {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    enabled: o.enabled === true,
    store: o.store === "turso" ? "turso" : "local",
  };
}
```
Wire it into the settings load/parse path where the other sections are migrated (find where `nextActions`/`notifications` are assigned from `parsed.*`, add `nextActionsLearning: migrateNextActionsLearning(parsed.nextActionsLearning)`).

- [ ] **Step 4: Run** test → PASS; `npx tsc --noEmit` → clean (if any test builds a full `Settings` literal missing `nextActionsLearning`, it's optional so no break).
- [ ] **Step 5: Lint** → clean.
- [ ] **Step 6: Commit** — `git add src/app/settings-types.ts src/app/use-settings.ts src/app/use-settings.test.ts && git commit -m "feat: nextActionsLearning settings (opt-in, store choice)"`

---

## Task 4: Local learning store

**Files:** Create `src/app/learning-store.ts`, `src/app/learning-store-local.ts`, `src/app/learning-store-local.test.ts`.

- [ ] **Step 1: Interface** — `src/app/learning-store.ts`:

```ts
import type { LearningState, LearningOverrides } from "./action-learning";
export interface LearningSnapshot { state: LearningState; overrides: LearningOverrides }
export const EMPTY_SNAPSHOT: LearningSnapshot = { state: {}, overrides: {} };
export interface LearningStore {
  load(): Promise<LearningSnapshot>;
  save(snap: LearningSnapshot): Promise<void>;
}
```

- [ ] **Step 2: Failing test** — `learning-store-local.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { localLearningStore } from "./learning-store-local";

beforeEach(() => localStorage.clear());

describe("localLearningStore", () => {
  it("round-trips a snapshot", async () => {
    const store = localLearningStore();
    await store.save({ state: { k: { acted: 2, snoozed: 1, dismissed: 0, lastAt: 5 } }, overrides: { k: "surface" } });
    expect(await store.load()).toEqual({ state: { k: { acted: 2, snoozed: 1, dismissed: 0, lastAt: 5 } }, overrides: { k: "surface" } });
  });
  it("returns empty on missing/malformed data", async () => {
    expect(await localLearningStore().load()).toEqual({ state: {}, overrides: {} });
    localStorage.setItem("lop-app:action-learning", "{not json");
    expect(await localLearningStore().load()).toEqual({ state: {}, overrides: {} });
  });
});
```
Run → FAIL.

- [ ] **Step 3: Implement** — `learning-store-local.ts`:

```ts
import { EMPTY_SNAPSHOT, type LearningSnapshot, type LearningStore } from "./learning-store";

const KEY = "lop-app:action-learning";

export function localLearningStore(): LearningStore {
  return {
    async load(): Promise<LearningSnapshot> {
      if (typeof localStorage === "undefined") return { ...EMPTY_SNAPSHOT };
      try {
        const raw = localStorage.getItem(KEY);
        if (!raw) return { ...EMPTY_SNAPSHOT };
        const p = JSON.parse(raw);
        if (!p || typeof p !== "object") return { ...EMPTY_SNAPSHOT };
        return { state: p.state ?? {}, overrides: p.overrides ?? {} };
      } catch { return { ...EMPTY_SNAPSHOT }; }
    },
    async save(snap: LearningSnapshot): Promise<void> {
      if (typeof localStorage === "undefined") return;
      try { localStorage.setItem(KEY, JSON.stringify(snap)); } catch { /* quota — non-fatal */ }
    },
  };
}
```

- [ ] **Step 4–6:** test PASS; lint+tsc clean; commit `git add src/app/learning-store.ts src/app/learning-store-local.ts src/app/learning-store-local.test.ts && git commit -m "feat: local learning store (localStorage)"`

---

## Task 5: Turso learning store (OUT of TABLE_NAMES) + pickLearningStore

**Files:** Create `src/app/learning-schema.ts`, `src/app/learning-store-turso.ts`, `src/app/learning-store-turso.test.ts`. Modify `src/app/learning-store.ts` (add `pickLearningStore`).

**Context:** Mirror `comm-templates-schema.ts` + `comm-templates-store.ts`. Read both first. The table is **global** (no `project_id`). `SqlArg.value` is string-only → `String(n)`. Table name `action_learning` must NOT be added to `TABLE_NAMES` (`turso-schema.ts`).

- [ ] **Step 1: Failing guard + store test** — `learning-store-turso.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { TABLE_NAMES } from "./turso-schema";
import { LEARNING_DDL, learningSelect, learningUpsert, rowsToSnapshot } from "./learning-schema";

describe("learning-schema", () => {
  it("keeps action_learning OUT of TABLE_NAMES (workspace save must not wipe it)", () => {
    expect(TABLE_NAMES).not.toContain("action_learning");
  });
  it("DDL creates the table; upsert binds ints as strings", () => {
    expect(LEARNING_DDL.join(" ")).toMatch(/CREATE TABLE IF NOT EXISTS action_learning/);
    const stmts = learningUpsert("raid:wk", { acted: 2, snoozed: 0, dismissed: 1, lastAt: 9 }, "auto");
    const flat = JSON.stringify(stmts);
    expect(flat).toContain("\"2\""); // int bound as string
  });
  it("rowsToSnapshot rebuilds state + overrides", () => {
    const rows = { rows: [["raid:wk", "2", "0", "1", "9", "surface"]], cols: ["kind","acted","snoozed","dismissed","last_at","override"] };
    const snap = rowsToSnapshot(rows as never);
    expect(snap.state["raid:wk"]).toEqual({ acted: 2, snoozed: 0, dismissed: 1, lastAt: 9 });
    expect(snap.overrides["raid:wk"]).toBe("surface");
  });
});
```
(Adapt `rowsToSnapshot`'s expected row shape to the actual `runTursoPipeline` result shape — read `comm-templates-schema.ts` `rowsToTemplates` to match how rows/cols come back.)
Run → FAIL.

- [ ] **Step 2: Implement `learning-schema.ts`** — mirror comm-templates-schema:

```ts
import type { SqlStmt } from "./turso-schema";
import type { LearningSnapshot } from "./learning-store";
import type { LearningOverride, OutcomeStats } from "./action-learning";

export const LEARNING_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS action_learning (
     kind TEXT PRIMARY KEY, acted TEXT, snoozed TEXT, dismissed TEXT, last_at TEXT, override TEXT
   )`,
];

export function learningSelect(): SqlStmt[] {
  return [{ sql: "SELECT kind, acted, snoozed, dismissed, last_at, override FROM action_learning" }];
}

export function learningUpsert(kind: string, s: OutcomeStats, override: LearningOverride): SqlStmt[] {
  return [{
    sql: `INSERT INTO action_learning (kind, acted, snoozed, dismissed, last_at, override)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(kind) DO UPDATE SET acted=excluded.acted, snoozed=excluded.snoozed,
            dismissed=excluded.dismissed, last_at=excluded.last_at, override=excluded.override`,
    args: [kind, String(s.acted), String(s.snoozed), String(s.dismissed), String(s.lastAt), override].map((value) => ({ type: "text", value })),
  }];
}

export function learningDeleteAll(): SqlStmt[] { return [{ sql: "DELETE FROM action_learning" }]; }

// Adapt the row access to match runTursoPipeline's result shape (see comm-templates-schema rowsToTemplates).
export function rowsToSnapshot(result: { rows: unknown[][] }): LearningSnapshot {
  const snap: LearningSnapshot = { state: {}, overrides: {} };
  for (const r of result.rows ?? []) {
    const [kind, acted, snoozed, dismissed, lastAt, override] = r as string[];
    snap.state[kind] = { acted: Number(acted) || 0, snoozed: Number(snoozed) || 0, dismissed: Number(dismissed) || 0, lastAt: Number(lastAt) || 0 };
    if (override && override !== "auto") snap.overrides[kind] = override as LearningOverride;
  }
  return snap;
}
```
(Fix the `SqlStmt`/`SqlArg` shape + the result row access to the EXACT types used by `turso-schema.ts`/`comm-templates-schema.ts` — read them and match. The test's row shape must match too.)

- [ ] **Step 3: Implement `learning-store-turso.ts`** (mirror comm-templates-store):

```ts
import { runTursoPipeline } from "./turso-pipeline";
import { LEARNING_DDL, learningSelect, learningUpsert, learningDeleteAll, rowsToSnapshot } from "./learning-schema";
import type { SqlStmt } from "./turso-schema";
import type { TursoConfig } from "./turso-config";
import type { LearningSnapshot, LearningStore } from "./learning-store";

const ddl = (): SqlStmt[] => LEARNING_DDL.map((sql) => ({ sql }));

export function tursoLearningStore(config: TursoConfig): LearningStore {
  return {
    async load(): Promise<LearningSnapshot> {
      const results = await runTursoPipeline(config, [...ddl(), ...learningSelect()]);
      return rowsToSnapshot(results[LEARNING_DDL.length] as never);
    },
    async save(snap: LearningSnapshot): Promise<void> {
      const upserts = Object.entries(snap.state).flatMap(([kind, s]) =>
        learningUpsert(kind, s, snap.overrides[kind] ?? "auto"));
      // overrides on kinds with no stats row:
      const extra = Object.entries(snap.overrides)
        .filter(([k]) => !snap.state[k])
        .flatMap(([k, ov]) => learningUpsert(k, { acted: 0, snoozed: 0, dismissed: 0, lastAt: 0 }, ov));
      await runTursoPipeline(config, [...ddl(), ...learningDeleteAll(), ...upserts, ...extra]);
    },
  };
}
```

- [ ] **Step 4: `pickLearningStore`** — append to `learning-store.ts`:

```ts
import type { TursoConfig } from "./turso-config";
import type { NextActionsLearningConfig } from "./settings-types";
import { localLearningStore } from "./learning-store-local";
import { tursoLearningStore } from "./learning-store-turso";

export function pickLearningStore(cfg: NextActionsLearningConfig, tursoConfig: TursoConfig | null): LearningStore {
  if (cfg.store === "turso" && tursoConfig !== null) return tursoLearningStore(tursoConfig);
  return localLearningStore();
}
```
(Watch for an import cycle: `learning-store.ts` importing the two impls which import `learning-store.ts` for types — types-only imports are erased, so no runtime cycle, but if tsc complains, split the `LearningStore`/`LearningSnapshot` types into a `learning-store-types.ts` and have all three import that.)

- [ ] **Step 5:** test PASS; lint+tsc clean. **Run the Turso guard test suite** `npm run test:run -- turso-schema learning-store-turso` to confirm `action_learning` stays out of TABLE_NAMES.
- [ ] **Step 6: Commit** — `git add src/app/learning-schema.ts src/app/learning-store-turso.ts src/app/learning-store-turso.test.ts src/app/learning-store.ts && git commit -m "feat: Turso learning store (global table, out of TABLE_NAMES) + pickLearningStore"`

---

## Task 6: `use-action-learning` hook

**Files:** Create `src/app/use-action-learning.ts`, `src/app/use-action-learning.test.tsx`.

**Context:** Loads a snapshot via `pickLearningStore`, captures outcomes (no-op when disabled), exposes a memoized bias map + overrides + reset. Debounce-persists. `now` must come from `Date.now()` at record time — but `Date.now()` is banned inside `useMemo` (engine-purity rule); it is fine inside event callbacks/effects. The bias map is recomputed when state changes; pass a stable `now` captured once per recompute is acceptable (decay across a session is negligible) — compute the map in the hook via `buildBiasMap(state, overrides, Date.now())` inside a `useMemo` keyed on `[state, overrides]` is NOT allowed (Date.now in useMemo). Instead compute it in an effect that writes to a `useState` bias map, or compute lazily in a `useCallback`-wrapped getter. Plan: keep a `biasRef`/state recomputed in a `useEffect([state, overrides])` using `Date.now()` there.

- [ ] **Step 1: Failing test** — `use-action-learning.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useActionLearning } from "./use-action-learning";
import type { SuggestedAction } from "./next-actions/types";

function action(source: SuggestedAction["source"], whyKey: string): SuggestedAction {
  return { id: `${source}:1:x`, source, title: { key: "x" as never }, why: { key: whyKey as never }, score: 40, tier: "soon", cta: { kind: "snooze", actionId: "x" } };
}
const cfg = (enabled: boolean) => ({ enabled, store: "local" as const });

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("useActionLearning", () => {
  it("records nothing when disabled", async () => {
    const { result } = renderHook(() => useActionLearning({ config: cfg(false), tursoConfig: null, isPopout: false }));
    await act(async () => { await result.current.record(action("raid", "wk"), "dismissed"); });
    expect(result.current.bias).toEqual({});
  });
  it("records when enabled and surfaces bias after enough evidence", async () => {
    const { result } = renderHook(() => useActionLearning({ config: cfg(true), tursoConfig: null, isPopout: false }));
    await act(async () => {
      for (let i = 0; i < 3; i++) await result.current.record(action("raid", "wk"), "dismissed");
    });
    await waitFor(() => expect(result.current.bias["raid:wk"]).toBeLessThan(0));
  });
  it("setOverride pins bias; reset clears", async () => {
    const { result } = renderHook(() => useActionLearning({ config: cfg(true), tursoConfig: null, isPopout: false }));
    await act(async () => { await result.current.setOverride("raid:wk", "surface"); });
    await waitFor(() => expect(result.current.bias["raid:wk"]).toBeGreaterThan(0));
    await act(async () => { await result.current.reset(); });
    await waitFor(() => expect(result.current.bias).toEqual({}));
  });
  it("does not record in a popout", async () => {
    const { result } = renderHook(() => useActionLearning({ config: cfg(true), tursoConfig: null, isPopout: true }));
    await act(async () => { await result.current.record(action("raid", "wk"), "dismissed"); });
    expect(result.current.bias).toEqual({});
  });
});
```
Run → FAIL.

- [ ] **Step 2: Implement** `use-action-learning.ts`:

```ts
"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { buildBiasMap, recordOutcome, type LearningOverride, type LearningOverrides, type LearningState, type OutcomeType } from "./action-learning";
import { EMPTY_SNAPSHOT, pickLearningStore, type LearningSnapshot } from "./learning-store";
import type { SuggestedAction } from "./next-actions/types";
import type { NextActionsLearningConfig } from "./settings-types";
import type { TursoConfig } from "./turso-config";

interface Args { config: NextActionsLearningConfig; tursoConfig: TursoConfig | null; isPopout: boolean; }
interface Result {
  bias: Record<string, number>;
  state: LearningState;
  overrides: LearningOverrides;
  record(action: SuggestedAction, type: OutcomeType): Promise<void>;
  setOverride(kind: string, override: LearningOverride): Promise<void>;
  reset(): Promise<void>;
}

const kindOf = (a: SuggestedAction) => `${a.source}:${a.why.key}`;

export function useActionLearning({ config, tursoConfig, isPopout }: Args): Result {
  const [snap, setSnap] = useState<LearningSnapshot>(EMPTY_SNAPSHOT);
  const [bias, setBias] = useState<Record<string, number>>({});
  const storeRef = useRef(pickLearningStore(config, tursoConfig));
  storeRef.current = pickLearningStore(config, tursoConfig);
  const enabled = config.enabled && !isPopout;

  // Load once on mount.
  useEffect(() => {
    let live = true;
    storeRef.current.load().then((s) => { if (live) setSnap(s); }).catch(() => {});
    return () => { live = false; };
  }, []);

  // Recompute bias when snapshot changes (Date.now allowed in an effect).
  useEffect(() => {
    setBias(config.enabled ? buildBiasMap(snap.state, snap.overrides, Date.now()) : {});
  }, [snap, config.enabled]);

  const persist = useCallback((next: LearningSnapshot) => {
    setSnap(next);
    storeRef.current.save(next).catch(() => {});
  }, []);

  const record = useCallback(async (action: SuggestedAction, type: OutcomeType) => {
    if (!enabled) return;
    persist({ ...snapRef.current, state: recordOutcome(snapRef.current.state, kindOf(action), type, Date.now()) });
  }, [enabled, persist]);

  const setOverride = useCallback(async (kind: string, override: LearningOverride) => {
    persist({ ...snapRef.current, overrides: { ...snapRef.current.overrides, [kind]: override } });
  }, [persist]);

  const reset = useCallback(async () => {
    persist({ state: {}, overrides: {} });
  }, [persist]);

  // snapRef mirror so callbacks read the latest snapshot without being in deps.
  const snapRef = useRef(snap); snapRef.current = snap;

  return { bias, state: snap.state, overrides: snap.overrides, record, setOverride, reset };
}
```
NOTE: declare `const snapRef = useRef(snap); snapRef.current = snap;` ABOVE the callbacks that read it (move it up). Ensure no `Date.now()` sits inside a `useMemo` (it's only in effects/callbacks here). Lint: the `storeRef.current = ...` reassignment during render may trip "no refs during render" — if so, recompute the store inside `record`/`load` via a `useCallback` of `(config, tursoConfig)` instead of a ref reassign (mirror the notifications-hook ref pattern). Resolve whatever eslint flags without disabling rules.

- [ ] **Step 3:** test PASS.
- [ ] **Step 4: Lint + typecheck** clean.
- [ ] **Step 5: Commit** — `git add src/app/use-action-learning.ts src/app/use-action-learning.test.tsx && git commit -m "feat: useActionLearning capture hook (gated, debounce-persist)"`

---

## Task 7: Wire learning into `task-manager.tsx`

**Files:** Modify `src/app/task-manager.tsx`.

**Context:** Call the hook once; thread `bias` into the `nextActions` memo; call `record(...)` from each executable-CTA handler + the snooze handler. The CTA handlers were added across earlier slices — locate them (`handleCreateTask`/create-task seed, `assignOwner`, `onDraftMessage`/draft, `handleEscalate`, rebaseline handlers, and `snoozeAction` at ~line 691). **Dismiss check:** search for a distinct permanent-dismiss path; if only snooze exists, record `"snoozed"` from `snoozeAction` and leave `"dismissed"` uncaptured (type/store stay for forward-compat).

- [ ] **Step 1: Instantiate the hook** — near the other hooks:
```ts
import { useActionLearning } from "./use-action-learning";
// ...inside component, after settings/tursoConfig/isPopout are in scope:
const learning = useActionLearning({ config: settings.nextActionsLearning ?? { enabled: false, store: "local" }, tursoConfig, isPopout });
const learningBias = learning.bias; // hoisted const for the memo dep (exhaustive-deps rejects obj.member)
```

- [ ] **Step 2: Thread bias into the engine** — in the `nextActions` useMemo, add `learnedBias: learningBias,` to the `buildActionInput({...})` arg (it's an optional `ActionInput` field), and add `learningBias` to the memo dep array.

- [ ] **Step 3: Record outcomes** — at each executable CTA dispatch, add `learning.record(action, "acted")`. Wrap the existing handlers minimally, e.g. for create-task:
```ts
// inside onCreateTask(action): existing seed logic, then:
void learning.record(action, "acted");
```
Do the same (`"acted"`) in assign-owner, draft-message, escalate, rebaseline confirm handlers — at the point the user confirms/dispatches the action (each handler already receives the `action`/row). In `snoozeAction(a, ms)` add `void learning.record(a, "snoozed");`. Use the `learning.record` reference via a hoisted const if exhaustive-deps complains in any `useCallback`.

- [ ] **Step 4: Typecheck + lint** — `npx tsc --noEmit && npm run lint` → clean.
- [ ] **Step 5: Full unit suite** — `npm run test:run` → all green. If a task-manager-touching test breaks because `settings.nextActionsLearning` is read, ensure the `?? {enabled:false,store:"local"}` fallback covers undefined; patch any test settings literal only if it builds a non-default `Settings` that tsc rejects (optional field → unlikely).
- [ ] **Step 6: Commit** — `git add src/app/task-manager.tsx && git commit -m "feat: wire learning capture + bias into the Action Center"`

---

## Task 8: i18n keys (EN + DE)

**Files:** Modify `src/app/i18n.ts`, `src/app/i18n.de.ts` (CRLF, node write).

- [ ] **Step 1: EN keys** — add to `i18n.ts` (near the action/version keys):
```
learningSurfacedHint: "You usually act on these — surfaced",
learningDemotedHint: "Often dismissed — demoted",
settingsLearningEnable: "Learn from my Action Center responses",
settingsLearningEnableHint: "Adapts ranking from which suggested actions you act on, snooze, or dismiss. Never hides an urgent item.",
settingsLearningStore: "Learning data storage",
settingsLearningStoreLocal: "This browser only",
settingsLearningStoreTurso: "Turso (shared across devices)",
settingsLearningReset: "Reset learned data",
settingsLearningResetConfirm: "Clear all learned Action Center data?",
settingsLearningInsights: "View learning insights",
learningInsightsTitle: "Action Center learning",
learningInsightsEmpty: "No learning data yet. Act on, snooze, or dismiss suggested actions to build it.",
learningColKind: "Action kind",
learningColActed: "Acted",
learningColSnoozed: "Snoozed",
learningColDismissed: "Dismissed",
learningColBias: "Adjustment",
learningColOverride: "Override",
learningOverrideAuto: "Auto",
learningOverrideSurface: "Always surface",
learningOverrideSuppress: "Always suppress",
learningOverrideOff: "Off",
versionHighlightLearning: "The Action Center learns from how you respond and surfaces fewer, higher-value next-best-actions.",
```

- [ ] **Step 2: DE keys** — via a temporary node UTF-8 CRLF script (the Edit tool corrupts umlauts), inserting after an existing DE anchor key (e.g. `versionHighlightDesktopNotify:`). German values (real umlauts):
```
learningSurfacedHint: "Diese bearbeiten Sie meist — hervorgehoben"
learningDemotedHint: "Häufig verworfen — herabgestuft"
settingsLearningEnable: "Aus meinen Aktionscenter-Reaktionen lernen"
settingsLearningEnableHint: "Passt das Ranking daran an, welche Vorschläge Sie bearbeiten, verschieben oder verwerfen. Dringende Einträge werden nie ausgeblendet."
settingsLearningStore: "Speicherort der Lerndaten"
settingsLearningStoreLocal: "Nur dieser Browser"
settingsLearningStoreTurso: "Turso (geräteübergreifend)"
settingsLearningReset: "Lerndaten zurücksetzen"
settingsLearningResetConfirm: "Alle gelernten Aktionscenter-Daten löschen?"
settingsLearningInsights: "Lern-Einblicke anzeigen"
learningInsightsTitle: "Aktionscenter-Lernen"
learningInsightsEmpty: "Noch keine Lerndaten. Bearbeiten, verschieben oder verwerfen Sie Vorschläge, um sie aufzubauen."
learningColKind: "Aktionsart"
learningColActed: "Bearbeitet"
learningColSnoozed: "Verschoben"
learningColDismissed: "Verworfen"
learningColBias: "Anpassung"
learningColOverride: "Übersteuerung"
learningOverrideAuto: "Automatisch"
learningOverrideSurface: "Immer hervorheben"
learningOverrideSuppress: "Immer unterdrücken"
learningOverrideOff: "Aus"
versionHighlightLearning: "Das Aktionscenter lernt aus Ihren Reaktionen und zeigt weniger, dafür wertvollere nächste Aktionen."
```
Delete the temp script after running.

- [ ] **Step 3: Verify** — `npx tsc --noEmit` (EN/DE parity) + `npm run test:run -- i18n-encoding` (real umlauts) → green. Visually confirm umlauts in `i18n.de.ts`.
- [ ] **Step 4: Commit** — `git add src/app/i18n.ts src/app/i18n.de.ts && git commit -m "feat: i18n keys for the learning layer (EN/DE)"`

---

## Task 9: Insights view (`learning-insights`)

**Files:** Create `src/app/learning-insights.tsx`, `src/app/learning-insights.test.tsx`. Modify `src/app/nav-config.ts` (add the AppView).

- [ ] **Step 1: Add the AppView** — in `nav-config.ts`, add `"learning-insights"` to the `AppView` union. (It has no nav-rail entry; it's opened from settings — so do NOT add it to the visible nav lists, just the type. Confirm how views are listed; if the union and the nav array are coupled, add it in a way that doesn't surface a broken rail item — follow how `recovery`/non-rail views are handled.)

- [ ] **Step 2: Failing test** — `learning-insights.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { LearningInsights } from "./learning-insights";
import { loadI18n } from "./i18n";

beforeAll(async () => { await loadI18n("de"); });

const baseProps = () => ({
  lang: "en-US" as const,
  state: { "raid:actionRaidWhySeverity": { acted: 5, snoozed: 1, dismissed: 0, lastAt: 0 } },
  overrides: {} as Record<string, "auto" | "surface" | "suppress" | "off">,
  onSetOverride: vi.fn(),
  onReset: vi.fn(),
});

describe("LearningInsights", () => {
  it("renders a row per kind with counts", () => {
    render(<LearningInsights {...baseProps()} />);
    expect(screen.getByText(/raid/i)).toBeTruthy();
    expect(screen.getByText("5")).toBeTruthy(); // acted
  });
  it("changing the override select calls onSetOverride", () => {
    const p = baseProps();
    render(<LearningInsights {...p} />);
    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "suppress" } });
    expect(p.onSetOverride).toHaveBeenCalledWith("raid:actionRaidWhySeverity", "suppress");
  });
  it("shows the empty state with no data", () => {
    render(<LearningInsights {...baseProps()} state={{}} />);
    expect(screen.getByText(/No learning data yet/i)).toBeTruthy();
  });
});
```
Run → FAIL.

- [ ] **Step 3: Implement** `learning-insights.tsx` — a presentational component (no hook inside; it takes `state`/`overrides`/callbacks as props so the canonical task-manager owns the hook). For each kind, parse `source` = `kind.split(":")[0]`, show `t(lang, ACTION_SOURCE_LABEL[source])` + the raw kind, rounded counts, `learnedBias(decayStats(stats, Date.now()))` as the Adjustment, and a labeled `<select>` (Auto/Surface/Suppress/Off) → `onSetOverride(kind, value)`. A "Reset all" button (confirm via `window.confirm(t(lang,"settingsLearningResetConfirm"))`) → `onReset()`. Empty-state when `Object.keys(state).length === 0`. Use `TABLE_HEAD_CLASS` for the table header (shared dark-blue). Every `<select>` needs `aria-label={t(lang,"learningColOverride")}` (axe). Import `learnedBias`, `decayStats` from `./action-learning`, `ACTION_SOURCE_LABEL` from `./action-source-label`.

- [ ] **Step 4: Render the view** — wire `learning-insights` into wherever AppView panels are switched (find the big view switch in `task-manager.tsx`/`workspace-section.tsx`; render `<LearningInsights lang state={learning.state} overrides={learning.overrides} onSetOverride={learning.setOverride} onReset={learning.reset} />` when `activeTab === "learning-insights"`). Provide a back/return affordance consistent with other settings-launched views.

- [ ] **Step 5:** test PASS; lint+tsc clean.
- [ ] **Step 6: Commit** — `git add src/app/learning-insights.tsx src/app/learning-insights.test.tsx src/app/nav-config.ts src/app/task-manager.tsx && git commit -m "feat: Action Center learning insights view"`

---

## Task 10: Per-row hint + settings controls

**Files:** Modify `src/app/action-row.tsx` (+ its test), the next-actions settings section component (find via `grep -rn "nextActions" src/app/settings-sections`), and `task-manager`/settings wiring to pass the learning props + open the insights view.

- [ ] **Step 1: Per-row hint test** — add to `action-row.test.tsx`:
```tsx
it("shows the surfaced hint when learning moved the action up", () => {
  const action = { /* a SuggestedAction with */ learning: { bias: 12, moved: "up" } /* ...rest */ };
  // render ActionRow with this action
  expect(screen.getByText(/surfaced/i)).toBeTruthy();
});
```
(Fill in a complete `SuggestedAction` per the existing action-row test helpers.)

- [ ] **Step 2: Implement the hint** — in `action-row.tsx`, when `action.learning?.moved` is set, render a small chip after the why-text: `moved === "up" ? t(lang,"learningSurfacedHint") : t(lang,"learningDemotedHint")`. Palette-token styling only (e.g. `text-xs text-muted-foreground`); NO `shadow-*`.

- [ ] **Step 3: Settings controls** — in the next-actions settings section, add (props threaded from task-manager: `learningConfig`, `onChangeLearningConfig`, `onResetLearning`, `onOpenInsights`):
  - enable checkbox → `onChangeLearningConfig({ ...cfg, enabled })` (labeled).
  - store `<select>` Local/Turso → `onChangeLearningConfig({ ...cfg, store })` (the Turso option label notes it needs Turso; labeled).
  - "Reset learned data" button → confirm → `onResetLearning()`.
  - "View learning insights" button → `onOpenInsights()` (sets activeTab to `learning-insights`).
  Mirror the existing toggle/select markup in that section. Persist config via the existing settings `onChange` path (set `settings.nextActionsLearning`).

- [ ] **Step 4: Wire in task-manager** — pass `learning.reset`, an `onOpenInsights = () => setActiveTab("learning-insights")`, and the `settings.nextActionsLearning` get/set into the settings section. Ensure the config write goes through `setSettings`.

- [ ] **Step 5:** tests PASS (`action-row`, settings section); lint+tsc clean.
- [ ] **Step 6: Commit** — `git add -A && git commit -m "feat: learning per-row hint + settings controls"`

---

## Task 11: Release 0.95.0

**Files:** `src/app/version.ts`, `CHANGELOG.md`.

- [ ] **Step 1: version.ts** — `APP_VERSION="0.95.0"`; `APP_BUILD_DATE="2026-06-16"` (comment `// 0.95.0 learning layer`); `APP_MILESTONE` = next unused sci-fi/fantasy author surname (controller picks, e.g. "Le Guin" is taken — use e.g. "Hopkinson", "VanderMeer", "Jemisin"-taken; pick a fresh one and update the codename doc-comment); append `"versionHighlightLearning"` to `APP_HIGHLIGHT_KEYS`.
- [ ] **Step 2: CHANGELOG.md** — prepend:
```markdown
## [0.95.0] - 2026-06-16 "<codename>"

### Added
- **Action Center learning layer** — the Action Center now learns from how you respond to suggested
  actions (act / snooze / dismiss) and applies a bounded, safety-capped bias to ranking so it surfaces
  fewer, higher-value next-best-actions. Opt-in (Settings → Next actions); a per-row hint explains any
  adjustment; a learning-insights view shows per-kind stats with manual Auto/Surface/Suppress/Off
  overrides. Learning data lives in this browser or, optionally, in Turso (shared across devices).
  Urgent items are never hidden.
```
- [ ] **Step 3: Verify** — `npx tsc --noEmit && npm run test:run -- version` → green.
- [ ] **Step 4: Commit** — `git add src/app/version.ts CHANGELOG.md && git commit -m "chore: release 0.95.0 learning layer"`

---

## Task 12: Docs refresh (README repositioning + codemaps + runbook)

**Files:** `README.md`, `docs/CODEMAPS/architecture.md`, `docs/CODEMAPS/frontend.md`, `docs/CODEMAPS/data.md`, `docs/RUNBOOK.md`. (DESIGN-TOKENS only if a new token was added — none expected; verify and skip if so.)

- [ ] **Step 1: README version badge** — replace the stale badge `version-v0.60.0_%22Stephenson%22` with `version-v0.95.0_%22<codename>%22` (line ~5).

- [ ] **Step 2: README repositioning** — rework the Overview tagline + intro (lines ~8–26) to lead with the enabler/accelerator narrative WITHOUT deleting accurate facts. Concretely:
  - Tagline (line ~8): change to emphasize "works with your stack, not instead of it": e.g.
    `> An AI-assisted project-command surface for project leads — it plugs into Microsoft 365 (Outlook contacts & calendar, SharePoint documents) and syncs bidirectionally with Jira, so it accelerates your work instead of becoming another place to maintain data.`
  - Add a short **"Not another data silo"** paragraph after the Overview list: the app pulls people from Outlook, documents from SharePoint, and keeps tasks in lockstep with Jira (bidirectional sync); the **Action Center** turns your live project data into a ranked list of next-best-actions that now **learns** from how you respond — so the tool tells you what to do next rather than asking you to keep yet another list current.
  - Keep every existing feature/integration table and the Security model intact (they are accurate).

- [ ] **Step 3: README — surface the learning + Action Center** — add a Features-table row (or extend the existing next-actions wording if present) for the **Action Center + learning layer**: ranked next-best-actions with executable CTAs (create task, assign owner, draft message, escalate, re-baseline) + desktop notifications + a learning layer that adapts ranking from your responses (opt-in; never hides urgent items).

- [ ] **Step 4: Codemaps** — add the learning layer to the relevant maps:
  - `architecture.md`: a line for the learning loop (capture → `action-learning` → engine bias term → insights).
  - `frontend.md`: `use-action-learning`, `learning-insights.tsx`, the action-row hint, the settings controls.
  - `data.md`: the `lop-app:action-learning` localStorage key + the global `action_learning` Turso table (OUT of TABLE_NAMES).
  Match each file's existing format/headings; keep entries one line where the file does.

- [ ] **Step 5: RUNBOOK** — add a "Disable / reset learning" entry: Settings → Next actions → toggle off or "Reset learned data"; manual reset = clear `lop-app:action-learning` (local) or `DELETE FROM action_learning` (Turso); note learning never blocks boot and is ignored in safe-mode.

- [ ] **Step 6: docs:scripts check** — if any AUTO-GENERATED block exists in touched docs, run `npm run docs:scripts:check` (should pass — we didn't change scripts).

- [ ] **Step 7: Commit** — `git add README.md docs/ && git commit -m "docs: reposition README (M365 + Jira sync, accelerator) + codemaps/runbook for the learning layer"`

---

## Task 13: Full green gate

- [ ] **Step 1:** `npm run lint && npx tsc --noEmit && npm run test:run` → all green.
- [ ] **Step 2:** `npm run build` → success.
- [ ] **Step 3:** Confirm `src/proxy.ts` unchanged (`git diff --stat main...HEAD -- src/proxy.ts` empty — no CSP host needed; learning has no new browser-called host) and `action_learning` is NOT in `TABLE_NAMES` (`git grep -n "action_learning" src/app/turso-schema.ts` → no match).

---

## Self-Review (plan author)

**Spec coverage:** symmetric bounded bias (Task 1 `learnedBias` + Task 2 engine) ✓; safety floor (Task 2) ✓; both stores configurable + Turso fallback (Tasks 4-5) ✓; tiered-intent capture (Task 6-7) ✓; opt-in/global/decay/CAP/min-evidence (Tasks 1,3,6) ✓; insights view + override (Task 9) ✓; per-row hint (Task 10) ✓; settings (Tasks 3,10) ✓; i18n (Task 8) ✓; release + docs repositioning incl. version badge + M365/Jira emphasis (Tasks 11-12) ✓; out-of-scope honored (no per-project/cross-user/impression/weight-tuning) ✓.

**Placeholder scan:** `<codename>` (Task 11/12) is deliberately chosen at execution. The "dismiss vs snooze" capture is flagged with a concrete resolution (verify a distinct dismiss; else snooze-only). Turso row-shape adaptation (Task 5) is flagged to match the exact `turso-schema`/`comm-templates-schema` types. No other placeholders.

**Type consistency:** `OutcomeType`/`OutcomeStats`/`LearningState`/`LearningOverride`/`LearningOverrides`, `LearningSnapshot`/`LearningStore`/`pickLearningStore`, `applyLearnedBias(intrinsic, kind, learnedBias?)`, `SuggestedAction.learning`, `ActionInput.learnedBias`, `NextActionsLearningConfig { enabled; store }`, settings path `settings.nextActionsLearning`, the `lop-app:action-learning` key, and the `action_learning` table name are consistent across tasks. `BIAS_CAP`/`MIN_EVIDENCE`/`DECAY_HALF_LIFE_MS` exported from `action-learning.ts` and reused in tests/insights.

**Ordering caveat:** Task 8 (i18n) must run before Tasks 9-10 (views assert real strings). Task 5's exact Turso row/SqlArg shape must be matched to `turso-schema.ts` (read it during implementation).
