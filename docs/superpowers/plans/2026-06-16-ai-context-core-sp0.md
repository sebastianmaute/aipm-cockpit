# SP0 — Context-aware Claude Core — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ground the existing AI Assistant in user-managed, scoped operating guides and inject app mode/modules/current-view into every Claude call so it adapts and advises as a senior project/program manager.

**Architecture:** A pure i18n-free `operating-guide.ts` engine (model + scope selection + block assembly) feeds a global dual-backend store (localStorage always; global Turso table `operating_guides` kept OUT of `TABLE_NAMES`, gated on `tursoConfig`). A `useOperatingGuides` hook (mirrors `useCommTemplates`/action-learning dual-backend) surfaces guides to `task-manager`, which threads them + a new `ai.groundInGuides` toggle into `ChatPanel`. `buildSystemPrompt` gains an app-context block (mode/modules/view) and a priority-ordered guide block; `callClaude` sends `system` as a content-block array with `cache_control` on the stable guide block.

**Tech Stack:** TypeScript, React 19, forked Next.js, vitest, Playwright (axe gate), Anthropic Messages API, Turso (libsql) via `turso-pipeline`.

**Spec:** `docs/superpowers/specs/2026-06-16-ai-context-core-sp0-design.md`

**Repo landmines (read before coding):** `--max-warnings=0` (unused import/var or `_`-prefixed param is FATAL); i18n EN/DE key parity is tsc-enforced and `i18n.de.ts` is CRLF + must be byte-patched via node UTF-8 write (Edit corrupts umlauts/quotes); a new global Turso table MUST stay OUT of `TABLE_NAMES`; `SqlArg.value` is string-only (`String(n)`); axe gate scans Settings and needs `aria-label`/`<label>` on every control; `Date.now()`/`Math.random()` banned in React render bodies (use in callbacks/effects only); before creating `foo.ts` check no `foo.tsx` exists (`.ts` resolves first).

---

## File Structure

| File | Responsibility | New/Modify |
|---|---|---|
| `src/app/operating-guide.ts` | Pure model: types, `selectActiveGuides`, `assembleGuideBlock`, `guidesCharCount`, constants | Create |
| `src/app/operating-guide.test.ts` | Unit tests for the pure engine | Create |
| `scripts/gen-operating-guide.mjs` | Prebuild: read `lib/*.md` → generate builtin constant | Create |
| `src/app/operating-guide-builtin.generated.ts` | Generated: `BUILTIN_GUIDE_ID`, `BUILTIN_GUIDE_NAME`, `BUILTIN_GUIDE_CONTENT` | Create (generated, committed) |
| `src/app/operating-guide-builtin.test.ts` | Sync guard: generated content matches `lib/*.md` | Create |
| `src/app/operating-guide-schema.ts` | Pure SQL builders + row decode for global `operating_guides` | Create |
| `src/app/operating-guide-store.ts` | Dual-backend load/upsert/delete (localStorage ↔ Turso) | Create |
| `src/app/operating-guide-store.test.ts` | Store tests (localStorage path + Turso path) | Create |
| `src/app/use-operating-guides.ts` | Turso-gated hook + localStorage fallback + seed-on-empty | Create |
| `src/app/use-operating-guides.test.tsx` | Hook tests | Create |
| `src/app/turso-schema.ts` | Guard: `operating_guides` stays OUT of `TABLE_NAMES` (test only) | (verify) |
| `src/app/settings-types.ts` | `AiConfig.groundInGuides` field + default + sanitize | Modify |
| `src/app/use-chat-dispatcher.ts` | Snapshot gains `mode`/`enabledModules`/`currentView`; args gain `currentView` | Modify |
| `src/app/chat-panel.tsx` | `buildSystemPrompt` extension; `callClaude` cache blocks; new props | Modify |
| `src/app/chat-panel.test.tsx` | System-prompt + cache-block tests | Modify |
| `src/app/task-manager.tsx` | Call `useOperatingGuides`; thread guides + toggle + currentView | Modify |
| `src/app/settings-sections/ai-section.tsx` | Descriptive text, master toggle, guide list, editor, scope editor, budget warning | Modify |
| `src/app/settings-sections/ai-section.test.tsx` | Settings UI tests | Modify |
| `src/app/i18n.ts` / `i18n.de.ts` | New EN+DE keys | Modify |
| `src/app/version.ts` / `CHANGELOG.md` | Release | Modify |
| `package.json` | `gen-operating-guide` wired into `prebuild` | Modify |

---

## Task 1: Pure operating-guide engine

**Files:**
- Create: `src/app/operating-guide.ts`
- Test: `src/app/operating-guide.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/app/operating-guide.test.ts
import { describe, it, expect } from "vitest";
import {
  selectActiveGuides, assembleGuideBlock, guidesCharCount,
  GUIDE_CHAR_BUDGET, type OperatingGuide, type GuideContext,
} from "./operating-guide";

const base = (over: Partial<OperatingGuide>): OperatingGuide => ({
  id: "g", name: "G", content: "body", enabled: true, priority: 10,
  scope: {}, builtIn: false, ...over,
});
const ctx: GuideContext = { mode: "advanced", modules: ["raid", "milestones"], view: "milestones" };

describe("selectActiveGuides", () => {
  it("keeps an always-on enabled guide (empty scope = wildcard)", () => {
    const r = selectActiveGuides([base({ id: "a" })], ctx);
    expect(r.map((g) => g.id)).toEqual(["a"]);
  });
  it("drops a disabled guide", () => {
    expect(selectActiveGuides([base({ id: "a", enabled: false })], ctx)).toEqual([]);
  });
  it("drops a guide whose mode scope excludes the current mode", () => {
    const r = selectActiveGuides([base({ id: "a", scope: { modes: ["simple"] } })], ctx);
    expect(r).toEqual([]);
  });
  it("keeps a guide whose module scope includes a current module", () => {
    const r = selectActiveGuides([base({ id: "a", scope: { modules: ["raid"] } })], ctx);
    expect(r.map((g) => g.id)).toEqual(["a"]);
  });
  it("drops a guide whose view scope excludes the current view", () => {
    const r = selectActiveGuides([base({ id: "a", scope: { views: ["budget"] } })], ctx);
    expect(r).toEqual([]);
  });
  it("sorts by ascending priority then id", () => {
    const r = selectActiveGuides(
      [base({ id: "b", priority: 5 }), base({ id: "a", priority: 5 }), base({ id: "c", priority: 1 })],
      ctx,
    );
    expect(r.map((g) => g.id)).toEqual(["c", "a", "b"]);
  });
});

describe("assembleGuideBlock", () => {
  it("returns empty string for no guides", () => {
    expect(assembleGuideBlock([])).toBe("");
  });
  it("emits a precedence header and delimited guides in order", () => {
    const block = assembleGuideBlock([base({ id: "a", name: "First", content: "AAA", priority: 1 })]);
    expect(block).toContain("priority order");
    expect(block).toContain("On conflict the earlier one wins");
    expect(block).toContain('GUIDE 1 (priority 1) — "First"');
    expect(block).toContain("AAA");
  });
});

describe("guidesCharCount", () => {
  it("sums content length", () => {
    expect(guidesCharCount([base({ content: "abc" }), base({ content: "de" })])).toBe(5);
  });
  it("exposes a positive budget", () => {
    expect(GUIDE_CHAR_BUDGET).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/operating-guide.test.ts`
Expected: FAIL — `Cannot find module './operating-guide'`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/app/operating-guide.ts
// Pure, i18n-free engine for AI operating guides. No React, no i18n imports.
import type { AppMode, FeatureModuleId } from "./feature-modules";
import type { AppView } from "./nav-config";

export interface GuideScope {
  modes?: AppMode[];
  modules?: FeatureModuleId[];
  views?: AppView[];
}

export interface OperatingGuide {
  id: string;
  name: string;
  content: string;
  enabled: boolean;
  priority: number; // lower = higher precedence, injected first
  scope: GuideScope;
  builtIn: boolean;
}

export interface GuideContext {
  mode: AppMode;
  modules: FeatureModuleId[];
  view: AppView;
}

/** Soft cap; above this the Settings UI warns. ~10k tokens. */
export const GUIDE_CHAR_BUDGET = 40_000;

function dimensionMatches<T>(allowed: T[] | undefined, current: T | T[]): boolean {
  if (!allowed || allowed.length === 0) return true; // wildcard
  const have = Array.isArray(current) ? current : [current];
  return allowed.some((a) => have.includes(a));
}

export function selectActiveGuides(
  guides: readonly OperatingGuide[],
  ctx: GuideContext,
): OperatingGuide[] {
  return guides
    .filter((g) => g.enabled)
    .filter((g) => dimensionMatches(g.scope.modes, ctx.mode))
    .filter((g) => dimensionMatches(g.scope.modules, ctx.modules))
    .filter((g) => dimensionMatches(g.scope.views, ctx.view))
    .slice()
    .sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
}

export function assembleGuideBlock(active: readonly OperatingGuide[]): string {
  if (active.length === 0) return "";
  const header = [
    `You have ${active.length} operating guide${active.length === 1 ? "" : "s"}, in priority order.`,
    "On conflict the earlier one wins; later guides refine but do not override unless they say so explicitly.",
  ].join(" ");
  const parts = active.map(
    (g, i) => `=== GUIDE ${i + 1} (priority ${g.priority}) — "${g.name}" ===\n${g.content}`,
  );
  return [header, ...parts].join("\n\n");
}

export function guidesCharCount(active: readonly OperatingGuide[]): number {
  return active.reduce((sum, g) => sum + g.content.length, 0);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/operating-guide.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Lint + commit**

Run: `npm run lint` → expect 0 warnings.
```bash
git add src/app/operating-guide.ts src/app/operating-guide.test.ts
git commit -m "feat: pure operating-guide engine (scope selection + block assembly)"
```

---

## Task 2: Built-in guide seed (prebuild generator)

**Files:**
- Create: `scripts/gen-operating-guide.mjs`
- Create: `src/app/operating-guide-builtin.generated.ts` (via the script)
- Create: `src/app/operating-guide-builtin.test.ts`
- Modify: `package.json` (`prebuild`)

- [ ] **Step 1: Write the generator script**

```js
// scripts/gen-operating-guide.mjs
// Reads the shipped /lib leadership guide and emits a TS constant so the client
// can seed it without a runtime fetch. Mirrors the repo's "prebuild keeps
// generated docs in sync" convention. Committed output + a sync-guard test.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SRC = join(process.cwd(), "lib", "project-leadership-operating-guide.md");
const OUT = join(process.cwd(), "src", "app", "operating-guide-builtin.generated.ts");

const content = readFileSync(SRC, "utf8");
const json = JSON.stringify(content); // safe escaping incl. backticks/newlines

const body = `// AUTO-GENERATED by scripts/gen-operating-guide.mjs — do not edit by hand.
// Source: lib/project-leadership-operating-guide.md
export const BUILTIN_GUIDE_ID = "builtin-leadership";
export const BUILTIN_GUIDE_NAME = "Project Leadership Operating Guide";
export const BUILTIN_GUIDE_CONTENT = ${json};
`;

writeFileSync(OUT, body, "utf8");
console.log(\`gen-operating-guide: wrote \${OUT} (\${content.length} chars)\`);
```

- [ ] **Step 2: Run the generator**

Run: `node scripts/gen-operating-guide.mjs`
Expected: writes `src/app/operating-guide-builtin.generated.ts`; prints char count (~18k).

- [ ] **Step 3: Write the sync-guard test**

```ts
// src/app/operating-guide-builtin.test.ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BUILTIN_GUIDE_CONTENT, BUILTIN_GUIDE_ID } from "./operating-guide-builtin.generated";

describe("builtin operating guide", () => {
  it("matches the source markdown (run `node scripts/gen-operating-guide.mjs` if this fails)", () => {
    const src = readFileSync(
      join(process.cwd(), "lib", "project-leadership-operating-guide.md"),
      "utf8",
    );
    expect(BUILTIN_GUIDE_CONTENT).toBe(src);
  });
  it("has a stable id", () => {
    expect(BUILTIN_GUIDE_ID).toBe("builtin-leadership");
  });
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/operating-guide-builtin.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire prebuild + commit**

In `package.json`, find the existing `"prebuild"` script and append the generator (chain with `&&`). If no `prebuild` exists, add `"prebuild": "node scripts/gen-operating-guide.mjs"`. Verify the existing prebuild command first with `grep '"prebuild"' package.json`.

Run: `npm run lint` → 0 warnings.
```bash
git add scripts/gen-operating-guide.mjs src/app/operating-guide-builtin.generated.ts src/app/operating-guide-builtin.test.ts package.json
git commit -m "feat: generate builtin operating guide from /lib at prebuild"
```

---

## Task 3: Turso schema for global operating_guides table

**Files:**
- Create: `src/app/operating-guide-schema.ts`
- Test: add a case to `src/app/operating-guide-store.test.ts` (created in Task 4 — here add a standalone schema test file instead)
- Create: `src/app/operating-guide-schema.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/app/operating-guide-schema.test.ts
import { describe, it, expect } from "vitest";
import {
  OPERATING_GUIDE_DDL, upsertStatements, deleteStatements, rowsToGuides,
} from "./operating-guide-schema";
import { TABLE_NAMES } from "./turso-schema";
import type { OperatingGuide } from "./operating-guide";

const g: OperatingGuide = {
  id: "x", name: "N", content: "C", enabled: true, priority: 3,
  scope: { modes: ["advanced"] }, builtIn: false,
};

describe("operating_guides schema", () => {
  it("is OUT of TABLE_NAMES (workspace save must never wipe it)", () => {
    expect(TABLE_NAMES).not.toContain("operating_guides");
  });
  it("DDL creates the table if not exists", () => {
    expect(OPERATING_GUIDE_DDL[0]).toMatch(/CREATE TABLE IF NOT EXISTS operating_guides/);
  });
  it("upsert serializes scope as JSON and booleans/ints as strings", () => {
    const [stmt] = upsertStatements(g);
    const vals = (stmt.args ?? []).map((a) => a.value);
    expect(vals).toContain(JSON.stringify(g.scope));
    expect(vals).toContain("1"); // enabled -> "1"
    expect(vals).toContain("3"); // priority -> "3"
  });
  it("delete targets by id", () => {
    expect(deleteStatements("x")[0].sql).toMatch(/DELETE FROM operating_guides WHERE id = \?/);
  });
  it("rowsToGuides round-trips a stored row", () => {
    const res = {
      response: { result: {
        cols: [{ name: "id" }, { name: "name" }, { name: "content" }, { name: "enabled" },
                { name: "priority" }, { name: "scope" }, { name: "built_in" }],
        rows: [[{ value: "x" }, { value: "N" }, { value: "C" }, { value: "1" },
                { value: "3" }, { value: JSON.stringify({ modes: ["advanced"] }) }, { value: "0" }]],
      } },
    };
    const out = rowsToGuides(res);
    expect(out[0]).toMatchObject({ id: "x", name: "N", content: "C", enabled: true, priority: 3, builtIn: false });
    expect(out[0].scope).toEqual({ modes: ["advanced"] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/operating-guide-schema.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/app/operating-guide-schema.ts — pure SQL builders + row decode for the
// GLOBAL operating_guides table. Cross-project; MUST stay out of TABLE_NAMES so
// the workspace overwrite never touches it (mirrors comm-templates-schema).
import type { PipelineResultLike, SqlStmt } from "./turso-schema";
import type { GuideScope, OperatingGuide } from "./operating-guide";

export const OPERATING_GUIDE_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS operating_guides (id TEXT PRIMARY KEY, name TEXT, content TEXT, enabled INTEGER, priority INTEGER, scope TEXT, built_in INTEGER, created_at TEXT, updated_at TEXT)`,
];

const txt = (value: string) => ({ type: "text" as const, value });
const int = (value: number) => ({ type: "integer" as const, value: String(value) });

export const guideSelect = (): SqlStmt[] => [{ sql: `SELECT * FROM operating_guides` }];

export function upsertStatements(g: OperatingGuide, now = ""): SqlStmt[] {
  return [{
    sql: `INSERT INTO operating_guides (id,name,content,enabled,priority,scope,built_in,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,content=excluded.content,enabled=excluded.enabled,priority=excluded.priority,scope=excluded.scope,built_in=excluded.built_in,updated_at=excluded.updated_at`,
    args: [
      txt(g.id), txt(g.name), txt(g.content), int(g.enabled ? 1 : 0),
      int(g.priority), txt(JSON.stringify(g.scope)), int(g.builtIn ? 1 : 0),
      txt(now), txt(now),
    ],
  }];
}

export function deleteStatements(id: string): SqlStmt[] {
  return [{ sql: `DELETE FROM operating_guides WHERE id = ?`, args: [txt(id)] }];
}

function rowObjects(res: PipelineResultLike | undefined): Record<string, string>[] {
  const names = (res?.response?.result?.cols ?? []).map((c) => c?.name ?? "");
  const rows = res?.response?.result?.rows ?? [];
  return rows.map((row) => {
    const obj: Record<string, string> = {};
    names.forEach((n, i) => {
      const cell = row[i];
      obj[n] = cell == null || cell.value == null ? "" : String(cell.value);
    });
    return obj;
  });
}

function parseScope(raw: string): GuideScope {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? (v as GuideScope) : {};
  } catch {
    return {};
  }
}

export function rowsToGuides(res: PipelineResultLike | undefined): OperatingGuide[] {
  return rowObjects(res)
    .filter((r) => r.id)
    .map((r): OperatingGuide => ({
      id: r.id,
      name: r.name ?? "",
      content: r.content ?? "",
      enabled: r.enabled === "1",
      priority: Number(r.priority) || 0,
      scope: parseScope(r.scope),
      builtIn: r.built_in === "1",
    }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/operating-guide-schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Lint + commit**

```bash
npm run lint
git add src/app/operating-guide-schema.ts src/app/operating-guide-schema.test.ts
git commit -m "feat: operating_guides Turso schema (global table, out of TABLE_NAMES)"
```

---

## Task 4: Dual-backend store (localStorage ↔ Turso)

**Files:**
- Create: `src/app/operating-guide-store.ts`
- Test: `src/app/operating-guide-store.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/app/operating-guide-store.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { loadGuides, saveGuide, removeGuide, LOCAL_KEY } from "./operating-guide-store";
import type { OperatingGuide } from "./operating-guide";

const g: OperatingGuide = {
  id: "a", name: "N", content: "C", enabled: true, priority: 2, scope: {}, builtIn: false,
};

describe("operating-guide-store (localStorage path, config=null)", () => {
  beforeEach(() => localStorage.clear());
  it("returns [] when empty", async () => {
    expect(await loadGuides(null)).toEqual([]);
  });
  it("saves then loads a guide", async () => {
    await saveGuide(null, g);
    const out = await loadGuides(null);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ id: "a", priority: 2 });
  });
  it("upsert replaces by id", async () => {
    await saveGuide(null, g);
    await saveGuide(null, { ...g, name: "N2" });
    const out = await loadGuides(null);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("N2");
  });
  it("remove deletes by id", async () => {
    await saveGuide(null, g);
    await removeGuide(null, "a");
    expect(await loadGuides(null)).toEqual([]);
  });
  it("uses the namespaced localStorage key", async () => {
    await saveGuide(null, g);
    expect(localStorage.getItem(LOCAL_KEY)).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/operating-guide-store.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/app/operating-guide-store.ts — dual-backend CRUD for operating guides.
// config === null  -> localStorage (always-available default)
// config !== null  -> global Turso table (cross-device), out of TABLE_NAMES.
import { runTursoPipeline } from "./turso-pipeline";
import {
  OPERATING_GUIDE_DDL, guideSelect, upsertStatements, deleteStatements, rowsToGuides,
} from "./operating-guide-schema";
import type { SqlStmt } from "./turso-schema";
import type { TursoConfig } from "./turso-config";
import type { OperatingGuide } from "./operating-guide";

export const LOCAL_KEY = "lop-app:operating-guides";

const ddl = (): SqlStmt[] => OPERATING_GUIDE_DDL.map((sql) => ({ sql }));

function readLocal(): OperatingGuide[] {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (!raw) return [];
    const v = JSON.parse(raw);
    return Array.isArray(v) ? (v as OperatingGuide[]) : [];
  } catch {
    return [];
  }
}
function writeLocal(list: OperatingGuide[]): void {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(list));
}

export async function loadGuides(config: TursoConfig | null): Promise<OperatingGuide[]> {
  if (!config) return readLocal();
  const results = await runTursoPipeline(config, [...ddl(), ...guideSelect()]);
  return rowsToGuides(results[OPERATING_GUIDE_DDL.length]);
}

export async function saveGuide(config: TursoConfig | null, g: OperatingGuide): Promise<void> {
  if (!config) {
    const list = readLocal().filter((x) => x.id !== g.id);
    writeLocal([...list, g]);
    return;
  }
  const now = new Date().toISOString();
  await runTursoPipeline(config, [...ddl(), ...upsertStatements(g, now)]);
}

export async function removeGuide(config: TursoConfig | null, id: string): Promise<void> {
  if (!config) {
    writeLocal(readLocal().filter((x) => x.id !== id));
    return;
  }
  await runTursoPipeline(config, [...ddl(), ...deleteStatements(id)]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/operating-guide-store.test.ts`
Expected: PASS.

- [ ] **Step 5: Lint + commit**

```bash
npm run lint
git add src/app/operating-guide-store.ts src/app/operating-guide-store.test.ts
git commit -m "feat: dual-backend operating-guide store (localStorage + Turso)"
```

---

## Task 5: useOperatingGuides hook (gated + seed-on-empty)

**Files:**
- Create: `src/app/use-operating-guides.ts`
- Test: `src/app/use-operating-guides.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/app/use-operating-guides.test.tsx
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { useOperatingGuides } from "./use-operating-guides";
import { BUILTIN_GUIDE_ID } from "./operating-guide-builtin.generated";

describe("useOperatingGuides (localStorage backend)", () => {
  beforeEach(() => localStorage.clear());

  it("seeds the built-in guide on first load", async () => {
    const { result } = renderHook(() => useOperatingGuides({ config: null }));
    await waitFor(() => expect(result.current.guides.length).toBeGreaterThan(0));
    expect(result.current.guides.some((g) => g.id === BUILTIN_GUIDE_ID)).toBe(true);
  });

  it("does not re-seed once seeded (built-in edits persist)", async () => {
    const first = renderHook(() => useOperatingGuides({ config: null }));
    await waitFor(() => expect(first.result.current.guides.length).toBe(1));
    await act(async () => {
      await first.result.current.update({ ...first.result.current.guides[0], enabled: false });
    });
    const second = renderHook(() => useOperatingGuides({ config: null }));
    await waitFor(() => expect(second.result.current.guides.length).toBe(1));
    expect(second.result.current.guides[0].enabled).toBe(false);
  });

  it("create adds a user guide", async () => {
    const { result } = renderHook(() => useOperatingGuides({ config: null }));
    await waitFor(() => expect(result.current.guides.length).toBe(1));
    await act(async () => {
      await result.current.create("My Guide", "body");
    });
    expect(result.current.guides.some((g) => g.name === "My Guide" && !g.builtIn)).toBe(true);
  });

  it("remove refuses to delete the built-in", async () => {
    const { result } = renderHook(() => useOperatingGuides({ config: null }));
    await waitFor(() => expect(result.current.guides.length).toBe(1));
    await act(async () => {
      await result.current.remove(BUILTIN_GUIDE_ID);
    });
    expect(result.current.guides.some((g) => g.id === BUILTIN_GUIDE_ID)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/use-operating-guides.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/app/use-operating-guides.ts — global operating-guide library hook.
// Dual-backend via the store: config=null -> localStorage, else Turso (gated).
// Seeds the built-in guide exactly once when the store is empty. Optional
// feature: load/mutation failures are swallowed so chat still works ungrounded.
"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { loadGuides, saveGuide, removeGuide } from "./operating-guide-store";
import type { OperatingGuide } from "./operating-guide";
import type { TursoConfig } from "./turso-config";
import {
  BUILTIN_GUIDE_ID, BUILTIN_GUIDE_NAME, BUILTIN_GUIDE_CONTENT,
} from "./operating-guide-builtin.generated";

export interface UseOperatingGuidesArgs {
  config: TursoConfig | null; // null = localStorage backend
}
export interface UseOperatingGuidesResult {
  guides: OperatingGuide[];
  busy: boolean;
  create: (name: string, content: string) => Promise<void>;
  update: (g: OperatingGuide) => Promise<void>;
  remove: (id: string) => Promise<void>;
  refresh: () => Promise<void>;
}

function builtinGuide(): OperatingGuide {
  return {
    id: BUILTIN_GUIDE_ID, name: BUILTIN_GUIDE_NAME, content: BUILTIN_GUIDE_CONTENT,
    enabled: true, priority: 1, scope: {}, builtIn: true,
  };
}

export function useOperatingGuides({ config }: UseOperatingGuidesArgs): UseOperatingGuidesResult {
  const [guides, setGuides] = useState<OperatingGuide[]>([]);
  const [busy, setBusy] = useState(false);
  const cfgRef = useRef(config);
  const opSeqRef = useRef(0);
  useEffect(() => { cfgRef.current = config; }, [config]);

  const refresh = useCallback(async () => {
    const startSeq = opSeqRef.current;
    try {
      let list = await loadGuides(cfgRef.current);
      if (list.length === 0) {
        await saveGuide(cfgRef.current, builtinGuide());
        list = await loadGuides(cfgRef.current);
      }
      if (opSeqRef.current !== startSeq) return;
      setGuides(list);
    } catch {
      // optional feature — leave guides as-is
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh, config]);

  const create = useCallback(async (name: string, content: string) => {
    opSeqRef.current += 1;
    setBusy(true);
    try {
      const maxP = guides.reduce((m, g) => Math.max(m, g.priority), 0);
      const suffix = Math.random().toString(36).slice(2, 8);
      const g: OperatingGuide = {
        id: `guide-${suffix}`, name, content, enabled: true,
        priority: maxP + 1, scope: {}, builtIn: false,
      };
      await saveGuide(cfgRef.current, g);
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [guides, refresh]);

  const update = useCallback(async (g: OperatingGuide) => {
    opSeqRef.current += 1;
    setBusy(true);
    try {
      await saveGuide(cfgRef.current, g);
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  const remove = useCallback(async (id: string) => {
    if (id === BUILTIN_GUIDE_ID) return; // built-in is undeletable
    opSeqRef.current += 1;
    setBusy(true);
    try {
      await removeGuide(cfgRef.current, id);
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  return { guides, busy, create, update, remove, refresh };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/use-operating-guides.test.tsx`
Expected: PASS. (If `create`'s `guides`-dependency causes a stale list in a rapid test, the test only asserts presence after `refresh`, so it holds.)

- [ ] **Step 5: Lint + commit**

```bash
npm run lint
git add src/app/use-operating-guides.ts src/app/use-operating-guides.test.tsx
git commit -m "feat: useOperatingGuides hook (gated, seed-on-empty, builtin undeletable)"
```

---

## Task 6: AiConfig.groundInGuides field

**Files:**
- Modify: `src/app/settings-types.ts:23-60`
- Test: `src/app/settings-types.test.ts` (add cases; create if absent)

- [ ] **Step 1: Write the failing test**

```ts
// add to src/app/settings-types.test.ts (create file if missing with imports below)
import { describe, it, expect } from "vitest";
import { sanitizeAiConfig, defaultAiConfig } from "./settings-types";

describe("sanitizeAiConfig groundInGuides", () => {
  it("defaults groundInGuides to true", () => {
    expect(defaultAiConfig.groundInGuides).toBe(true);
    expect(sanitizeAiConfig({}).groundInGuides).toBe(true);
  });
  it("respects an explicit false", () => {
    expect(sanitizeAiConfig({ groundInGuides: false }).groundInGuides).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/settings-types.test.ts -t groundInGuides`
Expected: FAIL — `groundInGuides` is `undefined`.

- [ ] **Step 3: Write minimal implementation**

In `src/app/settings-types.ts`:
- Add to the `AiConfig` type (after `weeklyTokenCap?`): `groundInGuides: boolean;`
- Add to `defaultAiConfig`: `groundInGuides: true,`
- Add to the `sanitizeAiConfig` return object: `groundInGuides: obj.groundInGuides !== false,` (default-true: only an explicit `false` disables).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/settings-types.test.ts -t groundInGuides`
Expected: PASS.

- [ ] **Step 5: Lint + typecheck + commit**

```bash
npm run lint && npx tsc --noEmit
git add src/app/settings-types.ts src/app/settings-types.test.ts
git commit -m "feat: AiConfig.groundInGuides toggle (default on)"
```

---

## Task 7: Snapshot gains mode/modules/currentView

**Files:**
- Modify: `src/app/use-chat-dispatcher.ts:33-43` (args), `:305-325` (snapshot)
- Test: `src/app/use-chat-dispatcher.test.tsx` (add cases)

- [ ] **Step 1: Write the failing test**

```tsx
// add to src/app/use-chat-dispatcher.test.tsx
// Render the hook with a known settings.features set + currentView, assert snapshot.
import { deriveMode } from "./feature-modules";
// inside a test:
it("snapshot exposes mode, enabledModules, and currentView", () => {
  // Arrange: render useChatDispatcher with settings.features = ["raid"], currentView "milestones".
  // (Follow the file's existing render helper; pass currentView: "milestones".)
  const snap = dispatcher.getSnapshot();
  expect(snap.enabledModules).toEqual(["raid"]);
  expect(snap.mode).toBe(deriveMode(["raid"]));
  expect(snap.currentView).toBe("milestones");
});
```

(Match the test file's existing harness for constructing `dispatcher`; reuse its `args` builder and add `currentView`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/use-chat-dispatcher.test.tsx -t snapshot`
Expected: FAIL — `enabledModules`/`mode`/`currentView` undefined.

- [ ] **Step 3: Write minimal implementation**

In `src/app/use-chat-dispatcher.ts`:
- Import: `import { deriveMode, type FeatureModuleId, type AppMode } from "./feature-modules";` and `import type { AppView } from "./nav-config";`
- Extend `ChatDispatcherArgs` (around line 33) with: `currentView: AppView;`
- Add a ref mirror near `todayRef`: `const viewRef = useRef(args.currentView);` and an effect `useEffect(() => { viewRef.current = args.currentView; }, [args.currentView]);`
- In `getSnapshot()` return object (line ~316) add:
```ts
mode: deriveMode(settingsRef.current.features) as AppMode,
enabledModules: settingsRef.current.features as FeatureModuleId[],
currentView: viewRef.current,
```

In `src/app/task-manager.tsx:1276`, add `currentView: activeTab,` to the `useChatDispatcher({ ... })` args (`activeTab` from `useWorkspaceTab()` at line 160 is the current `AppView`).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/use-chat-dispatcher.test.tsx -t snapshot`
Expected: PASS.

- [ ] **Step 5: Lint + typecheck + commit**

```bash
npm run lint && npx tsc --noEmit
git add src/app/use-chat-dispatcher.ts src/app/use-chat-dispatcher.test.tsx src/app/task-manager.tsx
git commit -m "feat: chat snapshot exposes app mode, modules, and current view"
```

---

## Task 8: buildSystemPrompt extension + cache blocks

**Files:**
- Modify: `src/app/chat-panel.tsx:55-113` (`buildSystemPrompt`, `callClaude`, `sendMessage` call site ~199)
- Test: `src/app/chat-panel.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// add to src/app/chat-panel.test.tsx — buildSystemPrompt is module-private, so
// export it for testing via a re-export, OR test through a thin exported wrapper.
// Add `export { buildSystemPrompt }` to chat-panel.tsx if not already exported.
import { buildSystemPrompt } from "./chat-panel";
import type { OperatingGuide } from "./operating-guide";

const snap = {
  today: "2026-06-16", language: "en-US", holidayCountries: [], storageKind: "browser",
  taskCount: 0, knownGroups: [], knownLabels: [],
  mode: "advanced" as const, enabledModules: ["raid", "milestones"], currentView: "milestones" as const,
};
const guide: OperatingGuide = {
  id: "g", name: "Lead", content: "Be decisive.", enabled: true, priority: 1, scope: {}, builtIn: true,
};

it("includes an APP CONTEXT block with mode/modules/view", () => {
  const s = buildSystemPrompt("en-US", snap, [], true);
  expect(s).toContain("APP CONTEXT");
  expect(s).toContain("Mode: advanced");
  expect(s).toContain("Current view: milestones");
  expect(s).toContain("senior project");
});
it("includes in-scope guides when grounding is ON", () => {
  const s = buildSystemPrompt("en-US", snap, [guide], true);
  expect(s).toContain("Be decisive.");
  expect(s).toContain("priority order");
});
it("omits the guide block when grounding is OFF", () => {
  const s = buildSystemPrompt("en-US", snap, [guide], false);
  expect(s).not.toContain("Be decisive.");
});
it("omits the guide block when no guide is in scope", () => {
  const off = { ...guide, scope: { views: ["budget" as const] } };
  const s = buildSystemPrompt("en-US", snap, [off], true);
  expect(s).not.toContain("Be decisive.");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/chat-panel.test.tsx -t "APP CONTEXT"`
Expected: FAIL — signature mismatch / no APP CONTEXT.

- [ ] **Step 3: Write minimal implementation**

In `src/app/chat-panel.tsx`:
- Imports: `import { selectActiveGuides, assembleGuideBlock, type OperatingGuide } from "./operating-guide";`
- Replace `buildSystemPrompt` (and `export` it):
```ts
export function buildSystemPrompt(
  lang: Lang,
  snapshot: ReturnType<ToolDispatcher["getSnapshot"]>,
  guides: readonly OperatingGuide[],
  groundInGuides: boolean,
): string {
  const groups = (snapshot.knownGroups ?? []).join(", ") || "(none)";
  const labels = (snapshot.knownLabels ?? []).join(", ") || "(none)";
  const baseLines = [
    "You are an assistant embedded in the List of Open Points Tracker app, a list-of-open-points task manager.",
    "The user is a project lead tracking open tasks. Each task has: id, taskName, assignee, assigneeEmail, dueDate (YYYY-MM-DD), lastUpdateDate, priority (Low/Medium/High/Urgent), blockers, notes, group (single optional category), labels (zero or more tags).",
    "Use the provided tools to read and modify the app's state. Prefer calling tools over guessing. After modifying state, briefly confirm what changed.",
    "Before deleting tasks (delete_task or delete_all_tasks) confirm with the user in chat unless they were already explicit.",
    `Today is ${snapshot.today}. UI language is ${snapshot.language}. Respond in the user's language. Storage backend: ${snapshot.storageKind}. Current task count: ${snapshot.taskCount}.`,
    `Known groups: ${groups}. Known labels: ${labels}. When the user mentions a category, prefer reusing an existing group or label rather than creating near-duplicates.`,
    "When the user references a task by name or fragment, call list_tasks to find its ID first.",
    `Active language code: ${lang}.`,
  ];
  const appContext = [
    "APP CONTEXT — adapt your behavior to this.",
    `Mode: ${snapshot.mode}. Enabled modules: ${snapshot.enabledModules.join(", ") || "(none)"}.`,
    `Current view: ${snapshot.currentView}.`,
    "In simple mode keep actions minimal and never reference disabled modules.",
    "You are acting as a senior project & program manager.",
  ].join("\n");
  const guideBlock = groundInGuides
    ? assembleGuideBlock(selectActiveGuides(guides, {
        mode: snapshot.mode, modules: snapshot.enabledModules, view: snapshot.currentView,
      }))
    : "";
  return [baseLines.join("\n"), appContext, guideBlock].filter(Boolean).join("\n\n");
}
```
- Update the call site (~line 199):
```ts
const system = buildSystemPrompt(lang, dispatcher.getSnapshot(), guides, ai.groundInGuides);
```
(`guides` and `ai.groundInGuides` come from new props — wired in Task 9. For now add `guides: readonly OperatingGuide[]` to `ChatPanelInner`/`ChatPanelImpl` props and pass through; `ai.groundInGuides` already exists on `AiConfig` from Task 6.)

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/chat-panel.test.tsx -t "APP CONTEXT"`
Expected: PASS.

- [ ] **Step 5: Add prompt-caching (system as content blocks)**

Change `callClaude` to send `system` as an array so the stable guide text is cached. Replace the `system` param type and body:
```ts
async function callClaude(
  apiKey: string, model: string, system: string, messages: ApiMessage[], signal?: AbortSignal,
): Promise<{ content: ContentBlock[]; stop_reason: string; usage: ApiUsage }> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey.trim(),
      "anthropic-version": ANTHROPIC_VERSION,
      "anthropic-dangerous-direct-browser-access": "true",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model, max_tokens: 4096,
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages, tools: TOOL_DEFS,
    }),
    signal,
  });
  // ...unchanged below
}
```
Add a test asserting the request body shape (mock `fetch`, assert `JSON.parse(body).system[0].cache_control.type === "ephemeral"`). Follow the existing fetch-mock pattern already in `chat-panel.test.tsx`.

- [ ] **Step 6: Run tests + lint + typecheck + commit**

Run: `npx vitest run src/app/chat-panel.test.tsx` → PASS. Then `npm run lint && npx tsc --noEmit`.
```bash
git add src/app/chat-panel.tsx src/app/chat-panel.test.tsx
git commit -m "feat: system prompt app-context + operating-guide block with prompt caching"
```

---

## Task 9: Thread guides into ChatPanel from task-manager

**Files:**
- Modify: `src/app/task-manager.tsx` (call `useOperatingGuides`, pass `guides` to `<ChatPanel>`)
- Modify: `src/app/chat-panel.tsx` (props already added in Task 8 — confirm `guides` flows to `ChatPanelInner`)

- [ ] **Step 1: Wire the hook in task-manager**

Near the other hooks in `task-manager.tsx` (after `useChatDispatcher`, ~line 1282), add:
```ts
const tursoConfigForGuides = settings.storageConfig.kind === "turso" ? tursoConfig : null;
const { guides: operatingGuides } = useOperatingGuides({ config: tursoConfigForGuides });
```
Import: `import { useOperatingGuides } from "./use-operating-guides";`
(Confirm the local name of the resolved Turso config — search `tursoConfig` in task-manager; it is the same value used to gate Snapshots/version-history. If it is derived elsewhere, reuse that exact expression. Guides must check `tursoConfig !== null`, not just `kind === "turso"`.)

- [ ] **Step 2: Pass guides to ChatPanel**

Find the `<ChatPanel ... />` render in `task-manager.tsx` and add `guides={operatingGuides}`. In `chat-panel.tsx`, ensure `ChatPanelImpl` and `ChatPanelInner` accept `guides: readonly OperatingGuide[]` and `ChatPanelInner` uses it in the `buildSystemPrompt` call (done in Task 8). Update the `memo` prop type.

- [ ] **Step 3: Verify build + existing chat tests**

Run: `npx tsc --noEmit && npx vitest run src/app/chat-panel.test.tsx`
Expected: PASS (no type errors; chat still renders).

- [ ] **Step 4: Lint + commit**

```bash
npm run lint
git add src/app/task-manager.tsx src/app/chat-panel.tsx
git commit -m "feat: thread operating guides from task-manager into ChatPanel"
```

---

## Task 10: Settings AI section — guides UI

**Files:**
- Modify: `src/app/settings-sections/ai-section.tsx`
- Test: `src/app/settings-sections/ai-section.test.tsx`
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts`

- [ ] **Step 1: Add i18n keys (EN + DE)**

Add to `i18n.ts` (EN) — pick a stable block, e.g. near `aiAssistant*`:
```ts
aiGuidesHeading: "Operating guides",
aiGuidesDesc: "Operating guides are markdown documents that steer how Claude behaves as your senior project manager. Add your own, scope them to a mode, module, or view, and order them by priority. When grounding is on, Claude reads every enabled, in-scope guide.",
aiGroundInGuides: "Ground Claude in operating guides",
aiGuideAdd: "Add guide",
aiGuideName: "Name",
aiGuideContent: "Content (markdown)",
aiGuidePriority: "Priority",
aiGuideScope: "Scope",
aiGuideScopeAny: "Always on",
aiGuideEnabled: "Enabled",
aiGuideEdit: "Edit",
aiGuideDelete: "Delete",
aiGuideBudgetWarning: "Enabled guides exceed the recommended size and may raise token cost.",
aiGuideBuiltInBadge: "Built-in",
```
Mirror EXACTLY the same keys in `i18n.de.ts` with German values + real umlauts. **`i18n.de.ts` is CRLF and the Edit tool corrupts umlauts** — patch it with a node UTF-8 write script and re-verify with `npx tsc --noEmit` (key parity) and the `i18n-encoding` test. Example DE values: `aiGuidesHeading: "Betriebsleitfäden"`, `aiGroundInGuides: "Claude an Betriebsleitfäden binden"`, `aiGuideScopeAny: "Immer aktiv"`, etc.

- [ ] **Step 2: Write the failing UI test**

```tsx
// add to src/app/settings-sections/ai-section.test.tsx
it("renders the guides heading, description, and master toggle with a label", () => {
  // render <AiSection ...> with the existing test harness + guides hook stub
  expect(screen.getByText(/Operating guides/i)).toBeInTheDocument();
  const toggle = screen.getByLabelText(/Ground Claude in operating guides/i);
  expect(toggle).toBeInTheDocument();
});
it("lists the built-in guide with a Built-in badge and no Delete", () => {
  // built-in guide present
  expect(screen.getByText(/Built-in/i)).toBeInTheDocument();
  // Delete button absent for built-in row
});
```
(Use the test file's existing render helper for `AiSection`; stub `useOperatingGuides` to return one built-in guide, or pass guides via props per the section's wiring.)

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run src/app/settings-sections/ai-section.test.tsx -t "Operating guides"`
Expected: FAIL — heading/toggle not rendered.

- [ ] **Step 4: Implement the UI**

In `ai-section.tsx`, below the usage-cap fields, add a guides block. The section must receive the guides API — thread it the way SP3 threaded comm-template config (a `config`/hook-result prop from `task-manager → SettingsView → AiSection`), or instantiate `useOperatingGuides` inside the section if it already has `tursoConfig`. Render:
- `<h_>{t(lang,"aiGuidesHeading")}</h_>` + `<p>{t(lang,"aiGuidesDesc")}</p>`
- Master toggle: a labeled checkbox bound to `ai.groundInGuides` calling `onChange({ ...ai, groundInGuides: !ai.groundInGuides })`. **MUST have `<label>`/`aria-label`** (axe).
- Guide list: each row → name, `aria-label`'d enabled checkbox, priority number `<input aria-label={t(lang,"aiGuidePriority")}>`, scope summary, Edit button, Delete button (omit Delete when `guide.builtIn`, show `aiGuideBuiltInBadge`).
- Add-guide button → opens an inline editor (name input, autogrow `<textarea aria-label={t(lang,"aiGuideContent")}>`, scope multi-selects each with `aria-label`, priority). Save calls `create`/`update`.
- Budget warning: when `guidesCharCount(selectActiveGuides(guides, currentCtx)) > GUIDE_CHAR_BUDGET` show `<p>{t(lang,"aiGuideBudgetWarning")}</p>`. (Use a representative ctx, e.g. the always-on set; computing for `{mode:"advanced",modules:ALL,view:"dashboard"}` is acceptable.)
- Every control: palette tokens only, no off-palette shadows.

- [ ] **Step 5: Run UI test + a11y**

Run: `npx vitest run src/app/settings-sections/ai-section.test.tsx` → PASS.
Run the axe gate for Settings (the AI section lives under Settings):
`npx playwright test e2e/a11y.spec.ts --project=chromium -g "Settings"`
Expected: 1 passed (~16s). Fix any unlabeled control before proceeding.

- [ ] **Step 6: Lint + typecheck + commit**

```bash
npm run lint && npx tsc --noEmit
git add src/app/settings-sections/ai-section.tsx src/app/settings-sections/ai-section.test.tsx src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat: AI settings — operating-guide library (toggle, list, editor, scope, budget warning)"
```

---

## Task 11: Release

**Files:**
- Modify: `src/app/version.ts`, `CHANGELOG.md`, `src/app/i18n.ts`, `src/app/i18n.de.ts`

- [ ] **Step 1: Bump version + highlight**

In `src/app/version.ts`: bump `APP_VERSION` to the next minor (e.g. `0.97.0`), update `APP_BUILD_DATE` to `2026-06-16`, set a new `APP_MILESTONE` codename (next sci-fi author after "VanderMeer"), and append `"versionHighlightAiContextCore"` to `APP_HIGHLIGHT_KEYS`.

- [ ] **Step 2: Add highlight strings (EN + DE)**

`i18n.ts`: `versionHighlightAiContextCore: "Claude now reads your operating guides and adapts to your app mode and current view, advising as a senior project manager."` Mirror in `i18n.de.ts` (node UTF-8 write, real umlauts).

- [ ] **Step 3: CHANGELOG entry**

Add a `## <version> "<codename>"` section to `CHANGELOG.md` describing: operating-guide library (global store, per-file toggle, priority + scope), app-context injection (mode/modules/view), master grounding toggle, prompt caching.

- [ ] **Step 4: Verify parity + commit**

Run: `npx tsc --noEmit` (i18n key parity) and `npx vitest run` (full unit suite).
```bash
git add src/app/version.ts CHANGELOG.md src/app/i18n.ts src/app/i18n.de.ts
git commit -m "chore: release SP0 — context-aware Claude core"
```

---

## Final verification (after all tasks)

- [ ] `npm run lint` → 0 warnings
- [ ] `npx tsc --noEmit` → clean (i18n parity holds)
- [ ] `npm run test:run` → all green
- [ ] `npx playwright test e2e/a11y.spec.ts --project=chromium -g "Settings"` → passes
- [ ] `npm run build` → succeeds (prebuild regenerates the builtin guide; sync-guard test green)
- [ ] Manual smoke: open AI Assistant, confirm answers reflect the operating guide; toggle grounding off → behavior reverts; change app mode → system prompt reflects it.
- [ ] Dispatch a final code-reviewer subagent over the whole branch.
- [ ] Use superpowers:finishing-a-development-branch.
```
