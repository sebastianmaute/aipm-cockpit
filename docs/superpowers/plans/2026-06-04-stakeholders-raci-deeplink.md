# Stakeholder Register + RACI, and RAID Deep-Linking — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Stakeholder register with a RACI matrix (over milestones) and an influence/interest grid, plus true `#raid/<id>` deep-linking that opens a specific RAID item.

**Architecture:** One new workspace entity `Stakeholder` (optional `resourceId` link) with RACI embedded as a per-milestone `Record<string, RaciRole>` map — serialized the same way `Resource.utilization` is (`key=value|…`). Three new views (register / RACI matrix / power-grid) live under a new "Stakeholders" register in the Registers nav group, mirroring the Change-log register end-to-end. Deep-linking extends the hash grammar to `#<view>[/<id>]` via pure `parseHash`/`buildHash` helpers and a `pendingOpen` channel on the workspace-tab context that the RAID panel consumes once.

**Tech Stack:** Next.js (app dir), React, TypeScript, Tailwind (AIPM 9-colour brand palette only), Vitest 4 + Testing Library, fake-indexeddb. Commands: `npm run test:run`, `npm run lint`, `npx tsc --noEmit`.

**Conventions (read before starting):**
- AIPM palette only (tokens already in `globals.css`); no new colours, gradients, or shadows. Chips reuse existing `Health`/RAG classes.
- Immutable updates everywhere (spread); stamp `localModifiedAt` on save.
- `i18n.de.ts` must stay **ASCII-only** — the Edit tool corrupts `"` into curly quotes there. After editing it, grep-verify (`rg '[“”„]' src/app/i18n.de.ts` must return nothing).
- Commit via the Bash tool heredoc: `git commit -F - <<'EOF' … EOF` (not PowerShell here-strings).
- `eslint.config.mjs` is hook-blocked — do not edit it.
- Run the full suite with `npm run test:run`. A couple of property/storage tests can time out under full-suite contention but pass standalone; re-run the specific file to confirm green.

---

## File Structure

**Workstream A — Stakeholders + RACI**

- Create `src/app/stakeholders.ts` — pure helpers (id, quadrant, matrix pivot, accountable count/warning, comparator, immutable `setRaciRole`). + `stakeholders.test.ts`.
- Modify `src/app/types.ts` — `Stakeholder`, `RaciRole`, `StakeholderCategory`, `InfluenceInterest` + constant arrays.
- Modify `src/app/sanitize.ts` — `sanitizeStakeholder`, `encodeRaciMap`, `decodeRaciMap`. + `sanitize-stakeholder.test.ts`.
- Modify `src/app/storage.ts` — `Workspace.stakeholders`, `emptyWorkspace`, `SCHEMA_VERSION` 7→8, `migrateWorkspaceV8`, JSON/CSV/MD serialize+parse, column lists + field encoders + `buildStakeholderFromObj`.
- Modify `src/app/turso-schema.ts` — one `spec<Stakeholder>` registry entry + imports.
- Modify `src/app/use-storage-backend.ts`, `src/app/sharepoint-backend.ts`, `src/app/export.ts` — include `stakeholders` in save/load/broadcast/export.
- Modify `src/app/workspace-context.tsx` — `stakeholders`/`setStakeholders` state.
- Create `src/app/use-stakeholders.ts` — CRUD hook (mirrors `use-change-log.ts`). + `use-stakeholders.test.ts`.
- Create `src/app/stakeholder-edit-modal.tsx` — create/edit/delete modal (mirrors `change-edit-modal.tsx`). + test.
- Create `src/app/stakeholders-panel.tsx` — register table. + test.
- Create `src/app/raci-panel.tsx` — RACI matrix. + test.
- Create `src/app/stakeholder-map-panel.tsx` — influence/interest grid. + test.
- Modify `src/app/nav-config.ts` — three new `AppView`s + nav group entry + labels.
- Modify `src/app/workspace-section.tsx`, the modern shell view switch, and `src/app/task-manager.tsx` — wire the three panels + the CRUD hook.
- Modify `src/app/i18n.ts` + `src/app/i18n.de.ts` — new keys.

**Workstream B — RAID deep-linking**

- Modify `src/app/nav-config.ts` — `parseHash`/`buildHash`. (tests in `nav-config.test.ts`)
- Modify `src/app/workspace-tab-context.tsx` — `pendingOpen` / `requestOpen` / `clearPendingOpen`. (+ test)
- Modify `src/app/use-hash-view.ts` — parse id on mount/hashchange; base-view-only writer. (+ `use-hash-view.test.tsx`)
- Modify `src/app/raid-panel.tsx` — consume-once open-by-id.
- Modify `src/app/notifications.tsx` + `src/app/task-manager.tsx` — `onSelectRaid: (id: number) => void` → `requestOpen("raid", id)`.

**Finalize**

- Modify `src/app/version.ts`, `package.json`, `CHANGELOG.md`, `README.md`, `docs/CODEMAPS/*`.

---

# Workstream A — Stakeholder register + RACI

## Task A1: Stakeholder types

**Files:**
- Modify: `src/app/types.ts` (append a new section after the Change-control register block, ~line 224)

- [ ] **Step 1: Add the types**

Append to `src/app/types.ts`:

```ts
// ----------------------------------------------------------------------------
// Stakeholder register + RACI.
//
// A first-class workspace entity (sibling to RaidItem / ChangeItem). Optional
// `resourceId` links an internal stakeholder to a Resource. RACI assignments
// are embedded as a per-milestone map (milestoneId -> letter), serialized the
// same way Resource.utilization is (no second entity).

export const RACI_ROLES = ["R", "A", "C", "I"] as const; // Responsible / Accountable / Consulted / Informed
export type RaciRole = (typeof RACI_ROLES)[number];

export const STAKEHOLDER_CATEGORIES = [
  "Internal", "Customer", "Vendor", "Sponsor", "Regulator", "Other",
] as const;
export type StakeholderCategory = (typeof STAKEHOLDER_CATEGORIES)[number];

export type InfluenceInterest = "Low" | "Medium" | "High";
export const INFLUENCE_INTEREST_LEVELS: InfluenceInterest[] = ["Low", "Medium", "High"];

export type Stakeholder = {
  id: number;
  name: string;
  organization?: string;
  title?: string;
  email?: string;
  category: StakeholderCategory;
  influence: InfluenceInterest;
  interest: InfluenceInterest;
  notes?: string;
  /** Optional FK -> Resource.id; null/absent for purely-external stakeholders. */
  resourceId?: number | null;
  /** milestoneId (string key) -> RACI letter. Sparse; orphan keys filtered at render. */
  raci: Record<string, RaciRole>;
  localModifiedAt?: string;
};
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (no consumers yet).

- [ ] **Step 3: Commit**

```bash
git add src/app/types.ts
git commit -F - <<'EOF'
feat: add Stakeholder + RACI types
EOF
```

---

## Task A2: Pure helpers — `stakeholders.ts`

**Files:**
- Create: `src/app/stakeholders.ts`
- Test: `src/app/stakeholders.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/app/stakeholders.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  nextStakeholderId, quadrantFor, buildRaciMatrix, accountableCountByMilestone,
  raciWarningFor, compareStakeholder, setRaciRole,
} from "./stakeholders";
import type { Milestone, Stakeholder } from "./types";

function mkS(over: Partial<Stakeholder> = {}): Stakeholder {
  return {
    id: 1, name: "Alex", category: "Internal", influence: "High", interest: "High",
    raci: {}, ...over,
  };
}
function mkM(id: number, name = `M${id}`): Milestone {
  return { id, name, date: "2026-01-01", linkedTaskIds: [] };
}

describe("nextStakeholderId", () => {
  it("returns 1 for empty and max+1 otherwise", () => {
    expect(nextStakeholderId([])).toBe(1);
    expect(nextStakeholderId([mkS({ id: 3 }), mkS({ id: 7 })])).toBe(8);
  });
});

describe("quadrantFor", () => {
  it("maps only High to the high bucket; Medium folds to Low", () => {
    expect(quadrantFor({ influence: "High", interest: "High" })).toBe("manage-closely");
    expect(quadrantFor({ influence: "High", interest: "Medium" })).toBe("keep-satisfied");
    expect(quadrantFor({ influence: "Medium", interest: "High" })).toBe("keep-informed");
    expect(quadrantFor({ influence: "Low", interest: "Low" })).toBe("monitor");
  });
});

describe("buildRaciMatrix", () => {
  it("rows are milestones, cells pull each stakeholder's letter (null when unset)", () => {
    const s1 = mkS({ id: 1, raci: { "10": "A" } });
    const s2 = mkS({ id: 2, raci: { "10": "R", "99": "C" } });
    const rows = buildRaciMatrix([s1, s2], [mkM(10)]);
    expect(rows).toHaveLength(1);
    expect(rows[0].cells).toEqual([
      { stakeholderId: 1, role: "A" },
      { stakeholderId: 2, role: "R" },
    ]);
  });
});

describe("accountableCountByMilestone + raciWarningFor", () => {
  it("counts A's and classifies the warning", () => {
    const s = [mkS({ id: 1, raci: { "10": "A" } }), mkS({ id: 2, raci: { "10": "A" } })];
    expect(accountableCountByMilestone(s, 10)).toBe(2);
    expect(raciWarningFor(0)).toBe("missing");
    expect(raciWarningFor(1)).toBe("none");
    expect(raciWarningFor(2)).toBe("multiple");
  });
});

describe("setRaciRole", () => {
  it("sets and clears immutably", () => {
    const s = mkS({ raci: { "5": "C" } });
    const set = setRaciRole(s, 7, "A");
    expect(set).not.toBe(s);
    expect(set.raci).toEqual({ "5": "C", "7": "A" });
    const cleared = setRaciRole(set, 5, null);
    expect(cleared.raci).toEqual({ "7": "A" });
  });
});

describe("compareStakeholder", () => {
  it("ranks influence Low<Medium<High and respects direction", () => {
    const lo = mkS({ id: 1, influence: "Low" });
    const hi = mkS({ id: 2, influence: "High" });
    expect(compareStakeholder(lo, hi, "influence", "asc")).toBeLessThan(0);
    expect(compareStakeholder(lo, hi, "influence", "desc")).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (`npm run test:run -- stakeholders.test.ts`) — "Cannot find module './stakeholders'".

- [ ] **Step 3: Implement `src/app/stakeholders.ts`**

```ts
// Pure helpers for the Stakeholder register + RACI. No React, no DOM.
// Sibling to raid.ts / change-log.ts.
import type {
  InfluenceInterest, Milestone, RaciRole, Stakeholder, StakeholderCategory,
} from "./types";
import { STAKEHOLDER_CATEGORIES } from "./types";

/** Next id — monotonic, separate id space. */
export function nextStakeholderId(items: readonly Stakeholder[]): number {
  let max = 0;
  for (const s of items) if (s.id > max) max = s.id;
  return max + 1;
}

export type StakeholderQuadrant =
  | "manage-closely" | "keep-satisfied" | "keep-informed" | "monitor";

const isHigh = (l: InfluenceInterest): boolean => l === "High";

/** 2x2 grid placement. Only "High" is the high bucket; Medium/Low fold to Low. */
export function quadrantFor(
  s: Pick<Stakeholder, "influence" | "interest">,
): StakeholderQuadrant {
  const inf = isHigh(s.influence);
  const intr = isHigh(s.interest);
  if (inf && intr) return "manage-closely";
  if (inf && !intr) return "keep-satisfied";
  if (!inf && intr) return "keep-informed";
  return "monitor";
}

export interface RaciCell { stakeholderId: number; role: RaciRole | null }
export interface RaciRow { milestone: Milestone; cells: RaciCell[] }

/** Pivot stakeholders x milestones. Orphan raci keys (deleted milestones) are
 *  ignored because we only iterate existing milestones. */
export function buildRaciMatrix(
  stakeholders: readonly Stakeholder[],
  milestones: readonly Milestone[],
): RaciRow[] {
  return milestones.map((m) => ({
    milestone: m,
    cells: stakeholders.map((s) => ({
      stakeholderId: s.id,
      role: s.raci[String(m.id)] ?? null,
    })),
  }));
}

export function accountableCountByMilestone(
  stakeholders: readonly Stakeholder[],
  milestoneId: number,
): number {
  const key = String(milestoneId);
  let n = 0;
  for (const s of stakeholders) if (s.raci[key] === "A") n += 1;
  return n;
}

export type RaciWarning = "none" | "missing" | "multiple";
export function raciWarningFor(accountableCount: number): RaciWarning {
  if (accountableCount === 0) return "missing";
  if (accountableCount > 1) return "multiple";
  return "none";
}

/** Immutable set/clear of one RACI cell on a stakeholder. */
export function setRaciRole(
  s: Stakeholder,
  milestoneId: number,
  role: RaciRole | null,
): Stakeholder {
  const key = String(milestoneId);
  const raci = { ...s.raci };
  if (role === null) delete raci[key];
  else raci[key] = role;
  return { ...s, raci };
}

export type StakeholderSortKey =
  | "name" | "organization" | "category" | "influence" | "interest";

const LEVEL_RANK: Record<InfluenceInterest, number> = { Low: 1, Medium: 2, High: 3 };

function sortValue(s: Stakeholder, key: StakeholderSortKey): string | number {
  switch (key) {
    case "name": return s.name.toLowerCase();
    case "organization": return (s.organization ?? "").toLowerCase();
    case "category": return (STAKEHOLDER_CATEGORIES as readonly StakeholderCategory[]).indexOf(s.category);
    case "influence": return LEVEL_RANK[s.influence];
    case "interest": return LEVEL_RANK[s.interest];
  }
}

export function compareStakeholder(
  a: Stakeholder, b: Stakeholder, key: StakeholderSortKey, dir: "asc" | "desc",
): number {
  const av = sortValue(a, key);
  const bv = sortValue(b, key);
  const cmp = typeof av === "number" && typeof bv === "number"
    ? av - bv
    : String(av).localeCompare(String(bv));
  return dir === "asc" ? cmp : -cmp;
}
```

- [ ] **Step 4: Run — expect PASS.** **Step 5: Commit**

```bash
git add src/app/stakeholders.ts src/app/stakeholders.test.ts
git commit -F - <<'EOF'
feat: stakeholders.ts pure helpers (quadrant, RACI matrix, comparator)
EOF
```

---

## Task A3: Sanitizer + RACI map codec

**Files:**
- Modify: `src/app/sanitize.ts` (add after the change-log sanitizer block, ~line 916)
- Test: `src/app/sanitize-stakeholder.test.ts`

Context: mirror `sanitizeChangeItem` (sanitize.ts:885) and `encodePeriodMap`/`decodePeriodMap` (sanitize.ts:476-496). The existing helpers `isPlainObject`, `toNumber`, `sanitizeText`, `BUDGET_NAME_MAX`, `TEXTAREA_MAX` are already in this file — reuse them. Import the new types at the top of `sanitize.ts` alongside the existing `type ChangeItem` import.

- [ ] **Step 1: Write the failing test** — Create `src/app/sanitize-stakeholder.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { sanitizeStakeholder, encodeRaciMap, decodeRaciMap } from "./sanitize";

describe("encodeRaciMap / decodeRaciMap", () => {
  it("round-trips numeric keys with R/A/C/I values and drops junk", () => {
    expect(encodeRaciMap({ "10": "A", "12": "C" })).toBe("10=A|12=C");
    expect(decodeRaciMap("10=A|12=C")).toEqual({ "10": "A", "12": "C" });
    expect(decodeRaciMap("x=A|12=Z|13=R")).toEqual({ "13": "R" });
    expect(decodeRaciMap("")).toEqual({});
  });
});

describe("sanitizeStakeholder", () => {
  it("requires id>0 and name", () => {
    expect(sanitizeStakeholder({ id: 0, name: "x" })).toBeNull();
    expect(sanitizeStakeholder({ id: 1, name: "" })).toBeNull();
  });
  it("clamps enums to valid values and keeps a valid raci map", () => {
    const s = sanitizeStakeholder({
      id: 2, name: "Sponsor Sam", category: "Bogus", influence: "High",
      interest: "nope", resourceId: "5", raci: { "10": "A", "11": "Q" },
    });
    expect(s).not.toBeNull();
    expect(s!.category).toBe("Other");      // invalid -> fallback
    expect(s!.influence).toBe("High");
    expect(s!.interest).toBe("Medium");     // invalid -> fallback
    expect(s!.resourceId).toBe(5);
    expect(s!.raci).toEqual({ "10": "A" });  // bad letter dropped
  });
  it("accepts the raci map as an encoded string too", () => {
    const s = sanitizeStakeholder({ id: 3, name: "Vee", raci: "10=R|12=I" });
    expect(s!.raci).toEqual({ "10": "R", "12": "I" });
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement** — add to `src/app/sanitize.ts`:

```ts
// --- Stakeholder + RACI ----------------------------------------------------

const STAKEHOLDER_CATEGORY_SET = new Set<string>(STAKEHOLDER_CATEGORIES);
const INFLUENCE_INTEREST_SET = new Set<string>(["Low", "Medium", "High"]);
const RACI_SET = new Set<string>(RACI_ROLES);
const RACI_KEY_RE = /^\d+$/;

/** Encode a RACI map "milestoneId=letter|…"; drops malformed entries. */
export function encodeRaciMap(map: Record<string, RaciRole> | undefined): string {
  if (!map) return "";
  return Object.entries(map)
    .filter(([k, v]) => RACI_KEY_RE.test(k) && RACI_SET.has(v))
    .map(([k, v]) => `${k}=${v}`)
    .join("|");
}

/** Decode "k=v|k=v" back to a RACI map; drops malformed keys/letters. */
export function decodeRaciMap(s: unknown): Record<string, RaciRole> {
  if (typeof s !== "string" || !s) return {};
  const out: Record<string, RaciRole> = {};
  for (const part of s.split("|")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const key = part.slice(0, eq).trim();
    const val = part.slice(eq + 1).trim();
    if (RACI_KEY_RE.test(key) && RACI_SET.has(val)) out[key] = val as RaciRole;
  }
  return out;
}

function coerceRaciMap(input: unknown): Record<string, RaciRole> {
  if (typeof input === "string") return decodeRaciMap(input);
  if (!isPlainObject(input)) return {};
  const out: Record<string, RaciRole> = {};
  for (const [k, v] of Object.entries(input)) {
    if (RACI_KEY_RE.test(k) && typeof v === "string" && RACI_SET.has(v)) {
      out[k] = v as RaciRole;
    }
  }
  return out;
}

/** Accept only well-formed stakeholders from untrusted JSON. id>0 + name required. */
export function sanitizeStakeholder(input: unknown): Stakeholder | null {
  if (!isPlainObject(input)) return null;
  const o = input;
  const id = toNumber(o.id);
  if (!Number.isFinite(id) || id <= 0) return null;
  const name = sanitizeText(o.name, BUDGET_NAME_MAX);
  if (!name) return null;

  const category = (typeof o.category === "string" && STAKEHOLDER_CATEGORY_SET.has(o.category))
    ? (o.category as StakeholderCategory) : "Other";
  const influence = (typeof o.influence === "string" && INFLUENCE_INTEREST_SET.has(o.influence))
    ? (o.influence as InfluenceInterest) : "Medium";
  const interest = (typeof o.interest === "string" && INFLUENCE_INTEREST_SET.has(o.interest))
    ? (o.interest as InfluenceInterest) : "Medium";

  const item: Stakeholder = {
    id: Math.floor(id),
    name,
    category,
    influence,
    interest,
    raci: coerceRaciMap(o.raci),
  };
  const org = sanitizeText(o.organization, BUDGET_NAME_MAX); if (org) item.organization = org;
  const title = sanitizeText(o.title, BUDGET_NAME_MAX); if (title) item.title = title;
  const email = sanitizeText(o.email, BUDGET_NAME_MAX); if (email) item.email = email;
  const notes = sanitizeText(o.notes, TEXTAREA_MAX); if (notes) item.notes = notes;
  const rid = toNumber(o.resourceId);
  if (Number.isFinite(rid) && rid > 0) item.resourceId = Math.floor(rid);
  const lma = sanitizeText(o.localModifiedAt, TEXTAREA_MAX); if (lma) item.localModifiedAt = lma;
  return item;
}
```

Add to the type import block at the top of `sanitize.ts`: `RaciRole`, `Stakeholder`, `StakeholderCategory`, `InfluenceInterest`, and the value import `STAKEHOLDER_CATEGORIES`, `RACI_ROLES` (these are runtime values, import them in the existing `from "./types"` value import, not the `type` import).

- [ ] **Step 4: Run — expect PASS.** **Step 5: Commit**

```bash
git add src/app/sanitize.ts src/app/sanitize-stakeholder.test.ts
git commit -F - <<'EOF'
feat: sanitizeStakeholder + RACI map codec
EOF
```

---

## Task A4: Storage — Workspace field, migration, JSON/CSV/MD round-trip

**Files:**
- Modify: `src/app/storage.ts` (many sites — enumerate with grep below)
- Test: `src/app/storage-stakeholder-roundtrip.test.ts`

Context — this mirrors the Change-log register exactly. Enumerate every `changes` site to mirror:
`rg -n "changes|ChangeItem|CHANGES_CSV|changeFieldToString|buildChangeFromObj|changesToCsv|csvToChanges|changesToMarkdown|markdownToChanges|migrateWorkspaceV7|SCHEMA_VERSION" src/app/storage.ts`

- [ ] **Step 1: Write the failing round-trip test** — Create `src/app/storage-stakeholder-roundtrip.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { emptyWorkspace, workspaceToJson, jsonToWorkspace } from "./storage";
import { stakeholdersToCsv, csvToStakeholders } from "./storage";
import type { Stakeholder } from "./types";

const sample: Stakeholder = {
  id: 1, name: "Sponsor Sam", organization: "Acme", title: "VP",
  email: "sam@acme.test", category: "Sponsor", influence: "High",
  interest: "Medium", notes: "key approver", resourceId: 4,
  raci: { "10": "A", "12": "C" }, localModifiedAt: "2026-06-04T00:00:00.000Z",
};

describe("stakeholder storage round-trip", () => {
  it("survives JSON encode -> decode", () => {
    const ws = { ...emptyWorkspace(), stakeholders: [sample] };
    const back = jsonToWorkspace(workspaceToJson(ws));
    expect(back.stakeholders).toEqual([sample]);
  });
  it("survives CSV encode -> decode (incl. raci map + resourceId)", () => {
    const csv = stakeholdersToCsv([sample]);
    const back = csvToStakeholders(csv);
    expect(back).toEqual([sample]);
  });
});
```

> Use the ACTUAL exported JSON entry points in `storage.ts` for the round-trip — open the file and use the real function names (e.g. the envelope serializer + parser the change tests use). If `workspaceToJson`/`jsonToWorkspace` differ, match the names used in `storage-change-roundtrip.test.ts`.

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement, mirroring the `changes` wiring:**

1. **Workspace type** (storage.ts:58) — add after `changes?`:
   ```ts
   /** Stakeholder register + RACI. Optional for back-compat; load paths default to []. */
   stakeholders?: Stakeholder[];
   ```
2. **`emptyWorkspace`** (storage.ts:86) — add `stakeholders: []`.
3. **Schema version** (storage.ts:83) — bump `const SCHEMA_VERSION = 8;`.
4. **`migrateWorkspaceV8`** — add an idempotent migration mirroring `migrateWorkspaceV7`, defaulting `stakeholders: ws.stakeholders ?? []`, and chain it wherever `migrateWorkspaceV7` is invoked (grep `migrateWorkspaceV7` across the repo and add the V8 call right after each, and export it for `turso-schema.ts`):
   ```ts
   /** v8: ensure the stakeholders array exists. Runs after v7. Idempotent. */
   export function migrateWorkspaceV8(ws: Workspace): Workspace {
     return ws.stakeholders ? ws : { ...ws, stakeholders: [] };
   }
   ```
5. **CSV column list** — add near `CHANGES_CSV_COLUMNS` (storage.ts:765):
   ```ts
   export const STAKEHOLDERS_CSV_COLUMNS: Array<keyof Stakeholder> = [
     "id", "name", "organization", "title", "email", "category",
     "influence", "interest", "notes", "resourceId", "raci", "localModifiedAt",
   ];
   ```
6. **Field encoder + builder** — mirror `changeFieldToString`/`buildChangeFromObj` (storage.ts:771):
   ```ts
   export function stakeholderFieldToString(s: Stakeholder, col: keyof Stakeholder): string {
     if (col === "raci") return encodeRaciMap(s.raci);
     if (col === "resourceId") return s.resourceId == null ? "" : String(s.resourceId);
     const v = s[col];
     return v === undefined || v === null ? "" : String(v);
   }

   export function buildStakeholderFromObj(obj: Record<string, string>): Stakeholder | null {
     return sanitizeStakeholder({
       ...obj,
       id: obj.id ? Number(obj.id) : undefined,
       resourceId: obj.resourceId ? Number(obj.resourceId) : null,
       raci: decodeRaciMap(obj.raci),
     });
   }
   ```
   Import `encodeRaciMap`, `decodeRaciMap`, `sanitizeStakeholder` from `./sanitize` in storage.ts (alongside the existing `sanitizeChangeItem` import).
7. **`stakeholdersToCsv` / `csvToStakeholders`** — mirror `changesToCsv` (storage.ts:835) and the corresponding `csvToChanges` decoder (find it via grep). Use `STAKEHOLDERS_CSV_COLUMNS` + `stakeholderFieldToString` + `csvEscape` for encode; the generic CSV-row parser + `buildStakeholderFromObj` for decode.
8. **JSON serialize/parse** — wherever the envelope writes `changes: ws.changes ?? []` (storage.ts:979) add `stakeholders: ws.stakeholders ?? []`; wherever it parses (`changes: (... ).map(sanitizeChangeItem)…`, storage.ts:1026) add the stakeholders equivalent with `sanitizeStakeholder`.
9. **Combined CSV/MD config sections** — wherever the combined-file decoder reads `s.changesText` (storage.ts:1480) and `s.changesMd` (storage.ts:2233), add `s.stakeholdersText` / `s.stakeholdersMd`. Add `stakeholdersToMarkdown` / `markdownToStakeholders` mirroring `changesToMarkdown` (storage.ts:1736) and define a `STAKEHOLDERS_MD_COLUMNS` list mirroring the change MD columns. Add `stakeholdersText` / `stakeholdersMd` fields to the StorageConfig form type they belong to (grep `changesText` and `changesMd` across `src/app` — e.g. `storage-config.tsx` — and mirror each reference).
10. **Legacy parse path** — wherever the legacy loader defaults `changes` (storage.ts:2537, 2628) add a `stakeholders: []` default + sanitized assignment.

> The acceptance gate is the round-trip test (Step 1) passing, plus `npx tsc --noEmit` clean. If any backend silently drops stakeholders, a later round-trip/Turso test will fail.

- [ ] **Step 4: Run — expect PASS** (`npm run test:run -- storage-stakeholder-roundtrip.test.ts` and `storage-change-roundtrip.test.ts` to confirm no regression). Run `npx tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add src/app/storage.ts src/app/storage-stakeholder-roundtrip.test.ts src/app/storage-config.tsx
git commit -F - <<'EOF'
feat: persist stakeholders across JSON/CSV/MD + schema v8 migration
EOF
```

---

## Task A5: Turso backend mapping

**Files:**
- Modify: `src/app/turso-schema.ts` (imports + one `ENTITY_SPECS` entry + migration call)

Context — the Turso layer is fully generic (turso-schema.ts:48). One spec entry adds the table, DDL, INSERT, SELECT, and round-trip. `turso-schema.ts` already imports `migrateWorkspaceV7`; switch/extend to `migrateWorkspaceV8`.

- [ ] **Step 1: Extend the round-trip test** — in `src/app/turso-schema.test.ts`, find the existing change/milestone round-trip case and add `stakeholders: [sample]` (reuse the `sample` shape from Task A4) to the workspace under test; assert it survives `rowsToWorkspace(...)`. Also assert `TABLE_NAMES` includes `"stakeholders"`.

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement** — in `turso-schema.ts`:
  - Add to the value import from `./storage`: `STAKEHOLDERS_CSV_COLUMNS`, `stakeholderFieldToString`, `buildStakeholderFromObj`, and change `migrateWorkspaceV7` → also import `migrateWorkspaceV8`.
  - Add to the type import from `./types`: `Stakeholder`.
  - Append to `ENTITY_SPECS` (after the `changes` spec, turso-schema.ts:59):
    ```ts
    spec<Stakeholder>({ table: "stakeholders", wsKey: "stakeholders", columns: STAKEHOLDERS_CSV_COLUMNS, get: (w) => w.stakeholders ?? [], toRow: stakeholderFieldToString as unknown as (e: Stakeholder, col: string) => string, fromObj: buildStakeholderFromObj }),
    ```
  - Wherever `rowsToWorkspace` runs `migrateWorkspaceV7` on the assembled workspace, chain `migrateWorkspaceV8` after it (so loaded Turso workspaces get the `stakeholders: []` default).

- [ ] **Step 4: Run — expect PASS** (`turso-schema.test.ts`). Confirm the schema-guard test (the one asserting snapshot tables stay out of `TABLE_NAMES`) is still green.

- [ ] **Step 5: Commit**

```bash
git add src/app/turso-schema.ts src/app/turso-schema.test.ts
git commit -F - <<'EOF'
feat: map stakeholders table in the Turso backend
EOF
```

---

## Task A6: Browser KV + storage bridge + sharepoint + export

**Files:**
- Modify: `src/app/use-storage-backend.ts` (lines 62, 137, 180, 195, 208, 216, 299)
- Modify: `src/app/sharepoint-backend.ts`
- Modify: `src/app/export.ts`
- Modify: `src/app/storage-browser-kv.ts` (if the KV backend enumerates entity stores)

Context — this is the step the Change-log holistic review caught. Every place that lists the workspace entities for save/load/broadcast must include `stakeholders`.

- [ ] **Step 1** — In `use-storage-backend.ts`:
  - Destructure `stakeholders, setStakeholders` from `useWorkspace()` (mirror line 62 `changes, setChanges`).
  - In the load effect (line 137) add `setStakeholders(workspace.stakeholders ?? []);`.
  - In **every** `backend.save({ … })` / `target.save({ … })` object literal (lines 180, 216, 299) add `stakeholders`.
  - Add `stakeholders` to the save effect's dependency array (line 195).
  - Add `useBroadcastSync("stakeholders", stakeholders, setStakeholders, canSend);` next to the `changes` broadcast (line 208).

- [ ] **Step 2** — In `sharepoint-backend.ts` and `export.ts`, grep for `changes` and mirror each reference for `stakeholders` (include it in the persisted/exported workspace). In `storage-browser-kv.ts`, if there is an explicit list of object stores / KV keys per entity, add `stakeholders`; if it serializes the whole workspace blob, no change is needed — verify by reading the file.

- [ ] **Step 3: Typecheck + targeted tests**

Run: `npx tsc --noEmit` then `npm run test:run -- use-storage-backend storage-browser-kv sharepoint-backend`
Expected: PASS. (Existing tests should now also exercise the stakeholders pass-through; if a test asserts the exact save payload shape, update it to include `stakeholders: []`.)

- [ ] **Step 4: Commit**

```bash
git add src/app/use-storage-backend.ts src/app/sharepoint-backend.ts src/app/export.ts src/app/storage-browser-kv.ts
git commit -F - <<'EOF'
feat: bridge stakeholders through KV/save/load/broadcast/export
EOF
```

---

## Task A7: Workspace context state

**Files:**
- Modify: `src/app/workspace-context.tsx` (lines 18-30 imports, 32-70 interface, 88 state, 237 value)

- [ ] **Step 1** — Add `type Stakeholder` to the import block (line 18). Add to `WorkspaceValue` (after `changes`/`setChanges`, line 69):
  ```ts
  stakeholders: Stakeholder[];
  setStakeholders: Dispatch<SetStateAction<Stakeholder[]>>;
  ```
  Add state (after line 88): `const [stakeholders, setStakeholders] = useState<Stakeholder[]>([]);`
  Add to the `value` object (line 237): `stakeholders, setStakeholders,`.

- [ ] **Step 2: Typecheck** — `npx tsc --noEmit` (use-storage-backend from A6 now resolves these).

- [ ] **Step 3: Commit**

```bash
git add src/app/workspace-context.tsx
git commit -F - <<'EOF'
feat: stakeholders state in WorkspaceProvider
EOF
```

---

## Task A8: CRUD hook — `use-stakeholders.ts`

**Files:**
- Create: `src/app/use-stakeholders.ts`
- Test: `src/app/use-stakeholders.test.ts`

Context — mirror `use-change-log.ts`.

- [ ] **Step 1: Write the failing test** — Create `src/app/use-stakeholders.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { WorkspaceProvider } from "./workspace-context";
import { FiltersProvider } from "./filters-context";
import { useStakeholders } from "./use-stakeholders";
import type { Stakeholder } from "./types";
import type { ReactNode } from "react";

const wrapper = ({ children }: { children: ReactNode }) => (
  <FiltersProvider><WorkspaceProvider>{children}</WorkspaceProvider></FiltersProvider>
);
const mk = (id: number): Stakeholder => ({
  id, name: `S${id}`, category: "Internal", influence: "Medium", interest: "Medium", raci: {},
});

describe("useStakeholders", () => {
  it("adds, updates, and deletes", () => {
    const { result } = renderHook(() => useStakeholders({ today: "2026-06-04" }), { wrapper });
    act(() => result.current.handleSaveStakeholder(mk(1)));
    expect(result.current.stakeholders).toHaveLength(1);
    expect(result.current.stakeholders[0].localModifiedAt).toBeTruthy();
    act(() => result.current.handleSaveStakeholder({ ...mk(1), name: "Renamed" }));
    expect(result.current.stakeholders).toHaveLength(1);
    expect(result.current.stakeholders[0].name).toBe("Renamed");
    act(() => result.current.handleDeleteStakeholder(1));
    expect(result.current.stakeholders).toHaveLength(0);
  });
});
```

> Check the real provider wrapper used by `use-change-log.test.tsx` / `use-due-alerts.test.ts` and match it (the `FiltersProvider`/`WorkspaceProvider` nesting and file extension `.tsx` if JSX is used — rename the test to `.test.tsx` if needed).

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement `src/app/use-stakeholders.ts`:**

```ts
"use client";
import { useCallback } from "react";
import { useWorkspace } from "./workspace-context";
import type { Stakeholder } from "./types";

export interface UseStakeholdersArgs {
  today: string;
  logActivity?: (summary: string) => void;
}

export function useStakeholders(args: UseStakeholdersArgs) {
  const { stakeholders, setStakeholders } = useWorkspace();

  const handleSaveStakeholder = useCallback((item: Stakeholder) => {
    const withStamp: Stakeholder = { ...item, localModifiedAt: new Date().toISOString() };
    setStakeholders((prev) => {
      const idx = prev.findIndex((s) => s.id === item.id);
      return idx < 0 ? [...prev, withStamp] : prev.map((s) => (s.id === item.id ? withStamp : s));
    });
    args.logActivity?.(`Stakeholder #${item.id} "${item.title ?? item.name}" saved`);
  }, [setStakeholders, args]);

  const handleDeleteStakeholder = useCallback((id: number) => {
    setStakeholders((prev) => prev.filter((s) => s.id !== id));
    args.logActivity?.(`Stakeholder #${id} deleted`);
  }, [setStakeholders, args]);

  return { stakeholders, handleSaveStakeholder, handleDeleteStakeholder };
}
```

- [ ] **Step 4: Run — expect PASS.** **Step 5: Commit**

```bash
git add src/app/use-stakeholders.ts src/app/use-stakeholders.test.*
git commit -F - <<'EOF'
feat: useStakeholders CRUD hook
EOF
```

---

## Task A9: i18n keys (EN + DE)

**Files:**
- Modify: `src/app/i18n.ts`
- Modify: `src/app/i18n.de.ts`

Context — add keys in BOTH files (same key set). DE values must be ASCII-only. Find the change-log key cluster (`changesAdd`, `changeFieldTitle`, …) and add the stakeholder cluster nearby in both files.

- [ ] **Step 1: Add these keys** (EN values shown; provide German equivalents in `i18n.de.ts`, ASCII-only):

```
navStakeholders: "Stakeholders"
stakeholderRaciTitle: "RACI Matrix"
stakeholderMapTitle: "Influence / Interest"
stakeholdersAdd: "Add stakeholder"
stakeholdersEmpty: "No stakeholders yet."
stakeholderFieldName: "Name"
stakeholderFieldOrganization: "Organization"
stakeholderFieldTitle: "Title / role"
stakeholderFieldEmail: "Email"
stakeholderFieldCategory: "Category"
stakeholderFieldInfluence: "Influence"
stakeholderFieldInterest: "Interest"
stakeholderFieldNotes: "Notes"
stakeholderFieldResource: "Linked resource"
stakeholderResourceNone: "— none —"
stakeholderCategoryInternal: "Internal"
stakeholderCategoryCustomer: "Customer"
stakeholderCategoryVendor: "Vendor"
stakeholderCategorySponsor: "Sponsor"
stakeholderCategoryRegulator: "Regulator"
stakeholderCategoryOther: "Other"
levelLow: "Low"
levelMedium: "Medium"
levelHigh: "High"
raciSectionTitle: "RACI by milestone"
raciNone: "—"
raciRoleR: "Responsible"
raciRoleA: "Accountable"
raciRoleC: "Consulted"
raciRoleI: "Informed"
raciLegend: "R Responsible · A Accountable · C Consulted · I Informed"
raciAccountableMissing: "No Accountable"
raciAccountableMultiple: "Multiple Accountable"
raciNoMilestones: "Add milestones to build the RACI matrix."
raciNoStakeholders: "Add stakeholders to build the RACI matrix."
quadrantManageClosely: "Manage Closely"
quadrantKeepSatisfied: "Keep Satisfied"
quadrantKeepInformed: "Keep Informed"
quadrantMonitor: "Monitor"
quadrantAxisInfluence: "Influence"
quadrantAxisInterest: "Interest"
stakeholderMapEmpty: "No stakeholders to plot yet."
stakeholdersDelete: "Delete stakeholder"
stakeholderConfirmDelete: "Delete this stakeholder?"
versionHighlightStakeholders: "Stakeholder register with RACI matrix and influence/interest grid"
```

- [ ] **Step 2: Verify** — `npx tsc --noEmit` (the `TranslationKey` union now includes the new keys). Then **grep-verify DE is ASCII**: `rg '[“”„‚‘’]' src/app/i18n.de.ts` must return nothing. Run `npm run test:run -- i18n.test.ts` (asserts EN/DE key parity).

- [ ] **Step 3: Commit**

```bash
git add src/app/i18n.ts src/app/i18n.de.ts
git commit -F - <<'EOF'
feat: i18n keys for the stakeholder register + RACI
EOF
```

---

## Task A10: Edit modal — `stakeholder-edit-modal.tsx`

**Files:**
- Create: `src/app/stakeholder-edit-modal.tsx`
- Test: `src/app/stakeholder-edit-modal.test.tsx`

Context — mirror `change-edit-modal.tsx` (sticky/draggable `ModalHeader`, two-column grid, error alert, Delete-left/Cancel+Save-right footer). Replace the two link-pickers with: a Resource picker (`<select>` over resources, "— none —" clears to `null`) and a RACI sub-section listing each milestone with a R/A/C/I `<select>` using `setRaciRole`.

- [ ] **Step 1: Write the failing test** — Create `src/app/stakeholder-edit-modal.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { StakeholderEditModal } from "./stakeholder-edit-modal";
import type { Stakeholder, Milestone } from "./types";

const draft: Stakeholder = {
  id: 1, name: "Sam", category: "Sponsor", influence: "High", interest: "Medium", raci: {},
};
const milestones: Milestone[] = [{ id: 10, name: "Go-Live", date: "2026-09-01", linkedTaskIds: [] }];

function setup(over = {}) {
  const props = {
    lang: "en" as const, draft, isNew: true, milestones, resources: [],
    onChange: vi.fn(), onSave: vi.fn(), onCancel: vi.fn(), onDelete: vi.fn(), ...over,
  };
  render(<StakeholderEditModal {...props} />);
  return props;
}

describe("StakeholderEditModal", () => {
  it("requires a name to save", () => {
    const p = setup({ draft: { ...draft, name: "" } });
    fireEvent.submit(screen.getByRole("button", { name: /save/i }).closest("form")!);
    expect(p.onSave).not.toHaveBeenCalled();
  });
  it("edits a RACI cell for a milestone", () => {
    const p = setup();
    fireEvent.change(screen.getByLabelText("Go-Live"), { target: { value: "A" } });
    expect(p.onChange).toHaveBeenCalledWith(expect.objectContaining({ raci: { "10": "A" } }));
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement** — Create `stakeholder-edit-modal.tsx`. Use this prop interface and the key field logic; copy the modal shell (Modal + ModalHeader + useDraggable + footer) verbatim from `change-edit-modal.tsx` and swap the form body:

```tsx
"use client";
import { useEffect, useState } from "react";
import { type Lang, t, type TranslationKey } from "./i18n";
import { Modal } from "./modal";
import { ModalHeader } from "./modal-header";
import { useDraggable } from "./use-draggable";
import { setRaciRole } from "./stakeholders";
import {
  RACI_ROLES, STAKEHOLDER_CATEGORIES, INFLUENCE_INTEREST_LEVELS,
  type InfluenceInterest, type Milestone, type RaciRole, type Resource,
  type Stakeholder, type StakeholderCategory,
} from "./types";
import { resourceDisplayName } from "./resource-foundation";

export interface StakeholderEditModalProps {
  lang: Lang;
  draft: Stakeholder;
  isNew: boolean;
  milestones: readonly Milestone[];
  resources: readonly Resource[];
  onChange: (next: Stakeholder) => void;
  onSave: () => void;
  onCancel: () => void;
  onDelete: () => void;
}

const INPUT_CLASS = "rounded-md border border-line bg-surface px-3 py-2 text-sm";

const CATEGORY_LABEL_KEYS: Record<StakeholderCategory, TranslationKey> = {
  Internal: "stakeholderCategoryInternal", Customer: "stakeholderCategoryCustomer",
  Vendor: "stakeholderCategoryVendor", Sponsor: "stakeholderCategorySponsor",
  Regulator: "stakeholderCategoryRegulator", Other: "stakeholderCategoryOther",
};
const LEVEL_LABEL_KEYS: Record<InfluenceInterest, TranslationKey> = {
  Low: "levelLow", Medium: "levelMedium", High: "levelHigh",
};
const RACI_LABEL_KEYS: Record<RaciRole, TranslationKey> = {
  R: "raciRoleR", A: "raciRoleA", C: "raciRoleC", I: "raciRoleI",
};
```

Body requirements (render inside the same `<form onSubmit>` grid as the change modal):
- `update(key, value)` helper: `onChange({ ...draft, [key]: value })`.
- Fields: name (required, `sm:col-span-2`), organization, title, email, category `<select>` (options from `STAKEHOLDER_CATEGORIES` + `CATEGORY_LABEL_KEYS`), influence `<select>` and interest `<select>` (options from `INFLUENCE_INTEREST_LEVELS` + `LEVEL_LABEL_KEYS`), notes textarea (`sm:col-span-2`), resource `<select>` (`aria-label={t(lang,"stakeholderFieldResource")}`, value `draft.resourceId ?? ""`, first option `value="" → t("stakeholderResourceNone")` setting `resourceId: undefined`, then one option per resource `value={r.id}` label `resourceDisplayName(r)`).
- RACI sub-section (`sm:col-span-2`): heading `t(lang,"raciSectionTitle")`; for each milestone a row with the milestone name as a `<label>` and a `<select aria-label={m.name}>` whose value is `draft.raci[String(m.id)] ?? ""`, first option `"" → t("raciNone")`, then `RACI_ROLES` options labelled `t(lang, RACI_LABEL_KEYS[role])`. onChange: `onChange(setRaciRole(draft, m.id, e.target.value === "" ? null : e.target.value as RaciRole))`. If `milestones.length === 0`, render `t(lang,"raciNoMilestones")` instead.
- Submit handler: if `!draft.name.trim()` set an error alert (reuse the change modal's `role="alert"` markup with `t(lang,"raidErrorTitleRequired")` or add a name-specific message) and return; else `onSave()`.
- Footer: identical to the change modal (Delete disabled when `isNew`, confirm with `t(lang,"stakeholderConfirmDelete")`; Cancel; Save disabled when name empty). Title: `isNew ? t(lang,"stakeholdersAdd") : t(lang,"navStakeholders")`.

- [ ] **Step 4: Run — expect PASS.** **Step 5: Commit**

```bash
git add src/app/stakeholder-edit-modal.tsx src/app/stakeholder-edit-modal.test.tsx
git commit -F - <<'EOF'
feat: stakeholder edit modal with RACI sub-section
EOF
```

---

## Task A11: Register panel — `stakeholders-panel.tsx`

**Files:**
- Create: `src/app/stakeholders-panel.tsx`
- Test: `src/app/stakeholders-panel.test.tsx`

Context — mirror the structure of `change-panel.tsx` (read it first): local `draft`/`isNew` modal state, `openNew`/`openEdit`/`closeModal`, search box, "Add" button before the search, and a `report-table.tsx` `ReportCard` table. Columns: name, organization, title, category (chip), influence (chip), interest (chip), linked resource (via `resources`), email. Sort via `compareStakeholder`.

- [ ] **Step 1: Write the failing test** — Create `src/app/stakeholders-panel.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { StakeholdersPanel } from "./stakeholders-panel";
import type { Stakeholder } from "./types";

const items: Stakeholder[] = [
  { id: 1, name: "Zoe", category: "Customer", influence: "High", interest: "Low", raci: {} },
  { id: 2, name: "Amy", category: "Internal", influence: "Low", interest: "High", raci: {} },
];

function setup() {
  const props = {
    lang: "en" as const, stakeholders: items, resources: [], milestones: [], today: "2026-06-04",
    onSave: vi.fn(), onDelete: vi.fn(),
  };
  render(<StakeholdersPanel {...props} />);
  return props;
}

describe("StakeholdersPanel", () => {
  it("renders a row per stakeholder", () => {
    setup();
    expect(screen.getByText("Zoe")).toBeInTheDocument();
    expect(screen.getByText("Amy")).toBeInTheDocument();
  });
  it("opens the add modal", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: /add stakeholder/i }));
    expect(screen.getByText(/add stakeholder/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement** — `StakeholdersPanel` props: `{ lang, stakeholders, resources, milestones, today, onSave, onDelete }`. Manage `draft`/`isNew`; `openNew` builds `{ id: nextStakeholderId(stakeholders), name: "", category: "Internal", influence: "Medium", interest: "Medium", raci: {} }`. Render `ReportCard` (see `change-report-panel.tsx` / `resources-report.tsx` for the exact `ReportCard` props — title slot, `TABLE_HEAD_CLASS` header, sortable columns, search). Category/influence/interest render as chips reusing existing badge classes (see how `rag-badge.tsx` / change panel render chips — do NOT introduce new colours). On row click → `openEdit`. Render `<StakeholderEditModal>` when `draft` is set, wiring `onSave`/`onDelete`/`onCancel`.

- [ ] **Step 4: Run — expect PASS.** **Step 5: Commit**

```bash
git add src/app/stakeholders-panel.tsx src/app/stakeholders-panel.test.tsx
git commit -F - <<'EOF'
feat: stakeholders register panel
EOF
```

---

## Task A12: RACI matrix — `raci-panel.tsx`

**Files:**
- Create: `src/app/raci-panel.tsx`
- Test: `src/app/raci-panel.test.tsx`

- [ ] **Step 1: Write the failing test** — Create `src/app/raci-panel.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { RaciPanel } from "./raci-panel";
import type { Stakeholder, Milestone } from "./types";

const stakeholders: Stakeholder[] = [
  { id: 1, name: "Sam", category: "Sponsor", influence: "High", interest: "High", raci: { "10": "A" } },
  { id: 2, name: "Lee", category: "Internal", influence: "Medium", interest: "High", raci: { "10": "A" } },
];
const milestones: Milestone[] = [{ id: 10, name: "Go-Live", date: "2026-09-01", linkedTaskIds: [] }];

describe("RaciPanel", () => {
  it("flags milestones with multiple Accountable", () => {
    render(<RaciPanel lang="en" stakeholders={stakeholders} milestones={milestones} onSave={vi.fn()} />);
    expect(screen.getByText(/multiple accountable/i)).toBeInTheDocument();
  });
  it("edits a cell and saves the stakeholder", () => {
    const onSave = vi.fn();
    render(<RaciPanel lang="en" stakeholders={stakeholders} milestones={milestones} onSave={onSave} />);
    const cell = screen.getByLabelText("Go-Live · Sam");
    fireEvent.change(cell, { target: { value: "R" } });
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ id: 1, raci: { "10": "R" } }));
  });
  it("shows an empty state when there are no milestones", () => {
    render(<RaciPanel lang="en" stakeholders={stakeholders} milestones={[]} onSave={vi.fn()} />);
    expect(screen.getByText(/add milestones/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement** — `RaciPanel` props `{ lang, stakeholders, milestones, onSave }`. Empty states: no milestones → `t(lang,"raciNoMilestones")`; no stakeholders → `t(lang,"raciNoStakeholders")`. Build rows via `buildRaciMatrix(stakeholders, milestones)`. Render a `<table>` with `TABLE_HEAD_CLASS` header (first column "Milestone", one column per stakeholder name). Each row: milestone name + a warning chip when `raciWarningFor(accountableCountByMilestone(stakeholders, m.id))` is `"missing"`/`"multiple"` (amber chip reusing the existing amber/health class; label `t(lang,"raciAccountableMissing"|"raciAccountableMultiple")`). Each cell: a `<select aria-label={`${m.name} · ${stakeholderName}`}>` value `role ?? ""`, options `""`→`t("raciNone")` then `RACI_ROLES`; onChange → `onSave(setRaciRole(stakeholder, m.id, value || null))` (look up the stakeholder object by `cell.stakeholderId`). Render a legend line `t(lang,"raciLegend")`. Wrap in the printable container used by other report panels.

- [ ] **Step 4: Run — expect PASS.** **Step 5: Commit**

```bash
git add src/app/raci-panel.tsx src/app/raci-panel.test.tsx
git commit -F - <<'EOF'
feat: RACI matrix panel with accountable-count warnings
EOF
```

---

## Task A13: Influence/Interest grid — `stakeholder-map-panel.tsx`

**Files:**
- Create: `src/app/stakeholder-map-panel.tsx`
- Test: `src/app/stakeholder-map-panel.test.tsx`

- [ ] **Step 1: Write the failing test** — Create `src/app/stakeholder-map-panel.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { StakeholderMapPanel } from "./stakeholder-map-panel";
import type { Stakeholder } from "./types";

const items: Stakeholder[] = [
  { id: 1, name: "Sam", category: "Sponsor", influence: "High", interest: "High", raci: {} },
  { id: 2, name: "Lee", category: "Internal", influence: "Low", interest: "Low", raci: {} },
];

describe("StakeholderMapPanel", () => {
  it("plots each stakeholder in its quadrant", () => {
    render(<StakeholderMapPanel lang="en" stakeholders={items} />);
    const manage = screen.getByTestId("quadrant-manage-closely");
    expect(within(manage).getByText("Sam")).toBeInTheDocument();
    const monitor = screen.getByTestId("quadrant-monitor");
    expect(within(monitor).getByText("Lee")).toBeInTheDocument();
  });
  it("shows an empty state when there are no stakeholders", () => {
    render(<StakeholderMapPanel lang="en" stakeholders={[]} />);
    expect(screen.getByText(/no stakeholders to plot/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement** — `StakeholderMapPanel` props `{ lang, stakeholders }`. If empty → `t(lang,"stakeholderMapEmpty")`. Otherwise a 2×2 CSS grid (`grid grid-cols-2`); the four cells carry `data-testid="quadrant-manage-closely|keep-satisfied|keep-informed|monitor"` and headings `t(lang,"quadrantManageClosely"|…)`. Place each stakeholder via `quadrantFor(s)` as a chip (name) inside its cell. Axis labels `t(lang,"quadrantAxisInfluence")` (vertical) and `t(lang,"quadrantAxisInterest")` (horizontal). Brand-palette tints only (reuse existing surface/health tint classes). Printable wrapper like the other report panels.

- [ ] **Step 4: Run — expect PASS.** **Step 5: Commit**

```bash
git add src/app/stakeholder-map-panel.tsx src/app/stakeholder-map-panel.test.tsx
git commit -F - <<'EOF'
feat: stakeholder influence/interest grid
EOF
```

---

## Task A14: Navigation entries

**Files:**
- Modify: `src/app/nav-config.ts` (AppView union line 6-28, NAV_GROUPS line 63-70, LABEL_KEYS line 77-99)
- Test: `src/app/nav-config.test.ts`

- [ ] **Step 1: Write the failing test** — add to `src/app/nav-config.test.ts`:

```ts
import { allNavViews, navLabelKey, subTabsFor } from "./nav-config";

it("includes the stakeholders register and its sub-views", () => {
  const views = allNavViews();
  expect(views).toContain("stakeholders");
  expect(views).toContain("raci");
  expect(views).toContain("stakeholder-map");
  expect(subTabsFor("stakeholders").map((c) => c.view)).toEqual(["raci", "stakeholder-map"]);
  expect(navLabelKey("stakeholders")).toBe("navStakeholders");
});
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement** — in `nav-config.ts`:
  - Add `| "stakeholders" | "raci" | "stakeholder-map"` to the `AppView` union.
  - In the Registers `NAV_GROUPS` entry, after `{ view: "changes", children: [...] }` and before `{ view: "reports" }`, add:
    ```ts
    { view: "stakeholders", children: [{ view: "raci" }, { view: "stakeholder-map" }] },
    ```
  - Add to `LABEL_KEYS`:
    ```ts
    stakeholders: "navStakeholders",
    raci: "stakeholderRaciTitle",
    "stakeholder-map": "stakeholderMapTitle",
    ```

- [ ] **Step 4: Run — expect PASS** (`nav-config.test.ts`). `npx tsc --noEmit` (the `LABEL_KEYS` `Record<Exclude<AppView,"edit">,…>` forces exhaustiveness — this is the safety net that proves all three views are labelled).

- [ ] **Step 5: Commit**

```bash
git add src/app/nav-config.ts src/app/nav-config.test.ts
git commit -F - <<'EOF'
feat: stakeholders register nav entries
EOF
```

---

## Task A15: Wire panels into the shells + task-manager

**Files:**
- Modify: `src/app/workspace-section.tsx` (classic layout; ChangePanel wiring at lines 54, 95-96, 141, 549-565)
- Modify: the modern shell view switch (find where `activeTab === "changes"` / `change-report` render in the modern path — grep `change-report` across `src/app`)
- Modify: `src/app/task-manager.tsx` (changes wiring at lines 137, 232, 288-289, 334, 714)

- [ ] **Step 1** — In `task-manager.tsx`: call `useStakeholders({ today, logActivity })` near `useChangeLog`; pull `milestones`, `resources`, `stakeholders` from context; build `handleSaveStakeholder`/`handleDeleteStakeholder`. Pass `stakeholders`, `resources`, `milestones`, `handleSaveStakeholder`, `handleDeleteStakeholder` down to the workspace section / modern shell exactly where `changes`/`handleSaveChange` are passed.

- [ ] **Step 2** — In `workspace-section.tsx`: add a `dynamic()` import for each panel (mirror `ChangePanel` at line 54):
  ```ts
  const StakeholdersPanel = dynamic(() => import("./stakeholders-panel").then((m) => m.StakeholdersPanel), { ssr: false });
  const RaciPanel = dynamic(() => import("./raci-panel").then((m) => m.RaciPanel), { ssr: false });
  const StakeholderMapPanel = dynamic(() => import("./stakeholder-map-panel").then((m) => m.StakeholderMapPanel), { ssr: false });
  ```
  Add the props to the component's prop type (mirror lines 95-96), and render three new `role="tabpanel"` blocks (mirror lines 549-565):
  ```tsx
  {activeTab === "stakeholders" && (
    <div id="panel-stakeholders" role="tabpanel" className={panelClass}>
      <StakeholdersPanel lang={lang} stakeholders={stakeholders} resources={resources}
        milestones={milestones} today={today} onSave={handleSaveStakeholder} onDelete={handleDeleteStakeholder} />
    </div>
  )}
  {activeTab === "raci" && (
    <div id="panel-raci" role="tabpanel" className={panelClass}>
      <RaciPanel lang={lang} stakeholders={stakeholders} milestones={milestones} onSave={handleSaveStakeholder} />
    </div>
  )}
  {activeTab === "stakeholder-map" && (
    <div id="panel-stakeholder-map" role="tabpanel" className={panelClass}>
      <StakeholderMapPanel lang={lang} stakeholders={stakeholders} />
    </div>
  )}
  ```

- [ ] **Step 3** — In the modern shell view switch, add the same three `activeTab === …` branches (matching how `changes`/`change-report` are rendered there).

- [ ] **Step 4: Verify** — `npx tsc --noEmit`; `npm run test:run -- workspace-section task-manager`. Manually reason that the three views now resolve in both layouts.

- [ ] **Step 5: Commit**

```bash
git add src/app/workspace-section.tsx src/app/task-manager.tsx src/app/modern-shell.tsx
git commit -F - <<'EOF'
feat: wire stakeholder register/RACI/grid into both shells
EOF
```

> Note: confirm the actual modern-shell file name via grep (`change-report` usage). It may be `modern-shell.tsx` or `app-shell.tsx`; stage whichever you edited.

---

# Workstream B — True RAID deep-linking

## Task B1: Hash grammar helpers

**Files:**
- Modify: `src/app/nav-config.ts` (add `parseHash`/`buildHash` after `slugToView`, line 140)
- Test: `src/app/nav-config.test.ts`

- [ ] **Step 1: Write the failing test** — add to `nav-config.test.ts`:

```ts
import { parseHash, buildHash } from "./nav-config";

describe("parseHash / buildHash", () => {
  it("parses a bare view slug", () => {
    expect(parseHash("#raid")).toEqual({ view: "raid", itemId: null });
  });
  it("parses a view slug with an item id", () => {
    expect(parseHash("#raid/123")).toEqual({ view: "raid", itemId: 123 });
  });
  it("ignores a non-numeric id", () => {
    expect(parseHash("#raid/abc")).toEqual({ view: "raid", itemId: null });
  });
  it("falls back to open-points for unknown views", () => {
    expect(parseHash("")).toEqual({ view: "open-points", itemId: null });
  });
  it("builds both forms", () => {
    expect(buildHash("raid")).toBe("#raid");
    expect(buildHash("raid", 123)).toBe("#raid/123");
    expect(buildHash("raid", null)).toBe("#raid");
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement** — add to `nav-config.ts`:

```ts
/** Parse a URL hash into a view + optional trailing numeric item id.
 *  Forms: "#raid" -> {view:"raid", itemId:null}; "#raid/123" -> {itemId:123}. */
export function parseHash(raw: string): { view: AppView; itemId: number | null } {
  const stripped = raw.replace(/^#/, "");
  const slash = stripped.indexOf("/");
  const slug = slash === -1 ? stripped : stripped.slice(0, slash);
  const idPart = slash === -1 ? "" : stripped.slice(slash + 1);
  const view = slugToView(slug);
  const itemId = /^\d+$/.test(idPart) ? Number(idPart) : null;
  return { view, itemId };
}

/** Build a hash for a view, with an optional item id suffix. */
export function buildHash(view: AppView, itemId?: number | null): string {
  const slug = viewToSlug(view);
  return itemId != null ? `#${slug}/${itemId}` : `#${slug}`;
}
```

- [ ] **Step 4: Run — expect PASS.** **Step 5: Commit**

```bash
git add src/app/nav-config.ts src/app/nav-config.test.ts
git commit -F - <<'EOF'
feat: parseHash/buildHash for #<view>/<id> deep-link grammar
EOF
```

---

## Task B2: Pending-open channel on the workspace-tab context

**Files:**
- Modify: `src/app/workspace-tab-context.tsx`
- Test: `src/app/workspace-tab-context.test.tsx`

- [ ] **Step 1: Write the failing test** — add to (or create) `workspace-tab-context.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { WorkspaceTabProvider, useWorkspaceTab } from "./workspace-tab-context";

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <WorkspaceTabProvider>{children}</WorkspaceTabProvider>
);

describe("pendingOpen", () => {
  it("requestOpen sets the active tab and pending target; clear resets it", () => {
    const { result } = renderHook(() => useWorkspaceTab(), { wrapper });
    act(() => result.current.requestOpen("raid", 42));
    expect(result.current.activeTab).toBe("raid");
    expect(result.current.pendingOpen).toEqual({ view: "raid", id: 42 });
    act(() => result.current.clearPendingOpen());
    expect(result.current.pendingOpen).toBeNull();
  });
});
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement** — in `workspace-tab-context.tsx`:
  - Import `buildHash` from `./nav-config`.
  - Extend the context value interface:
    ```ts
    pendingOpen: { view: AppView; id: number } | null;
    requestOpen: (view: AppView, id: number) => void;
    clearPendingOpen: () => void;
    ```
  - Add state `const [pendingOpen, setPendingOpen] = useState<{ view: AppView; id: number } | null>(null);`
  - Implement:
    ```ts
    const requestOpen = useCallback((view: AppView, id: number) => {
      setActiveTab(view);
      setPendingOpen({ view, id });
      if (!isPopout && typeof window !== "undefined") {
        window.location.hash = buildHash(view, id);
      }
    }, [isPopout]);
    const clearPendingOpen = useCallback(() => setPendingOpen(null), []);
    ```
    (Import `useCallback`.) Add all three to the provider `value`.

- [ ] **Step 4: Run — expect PASS.** **Step 5: Commit**

```bash
git add src/app/workspace-tab-context.tsx src/app/workspace-tab-context.test.tsx
git commit -F - <<'EOF'
feat: pendingOpen/requestOpen channel for deep-linking
EOF
```

---

## Task B3: Hash → view + pending-open wiring

**Files:**
- Modify: `src/app/use-hash-view.ts`
- Test: `src/app/use-hash-view.test.tsx`

- [ ] **Step 1: Write the failing test** — add to `use-hash-view.test.tsx` (match the existing test's provider/setup):

```tsx
it("opens a deep-linked RAID item from #raid/123 on mount", () => {
  window.location.hash = "#raid/123";
  const seen: Array<{ view: string; id: number } | null> = [];
  function Probe() {
    useHashView(true);
    const { activeTab, pendingOpen } = useWorkspaceTab();
    seen.push(pendingOpen);
    return <span>{activeTab}</span>;
  }
  render(<WorkspaceTabProvider><Probe /></WorkspaceTabProvider>);
  expect(screen.getByText("raid")).toBeInTheDocument();
  expect(seen.at(-1)).toEqual({ view: "raid", id: 123 });
});
```

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement** — rewrite `use-hash-view.ts` to use `parseHash`/`buildHash` and `requestOpen`:

```ts
"use client";
import { useEffect, useLayoutEffect } from "react";
import { useWorkspaceTab } from "./workspace-tab-context";
import { buildHash, parseHash } from "./nav-config";

function hashSlug(): string {
  if (typeof window === "undefined") return "";
  return window.location.hash;
}

export function useHashView(enabled: boolean = true): void {
  const { activeTab, setActiveTab, isPopout, requestOpen } = useWorkspaceTab();

  // Mount + back/forward: hash drives the view (and any deep-linked item).
  useLayoutEffect(() => {
    if (!enabled || isPopout) return;
    const apply = () => {
      const { view, itemId } = parseHash(hashSlug());
      setActiveTab(view);
      if (itemId != null) requestOpen(view, itemId);
    };
    apply();
    window.addEventListener("hashchange", apply);
    return () => window.removeEventListener("hashchange", apply);
  }, [enabled, isPopout, setActiveTab, requestOpen]);

  // View change: write the hash, but only when the BASE view differs — so an
  // existing "#raid/123" is not clobbered while we stay on RAID. Skip "edit".
  useEffect(() => {
    if (!enabled || typeof window === "undefined" || isPopout || activeTab === "edit") return;
    const current = parseHash(window.location.hash);
    if (current.view !== activeTab) window.location.hash = buildHash(activeTab);
  }, [enabled, isPopout, activeTab]);
}
```

- [ ] **Step 4: Run — expect PASS** (`use-hash-view.test.tsx`). Verify the existing hash-sync tests still pass.

- [ ] **Step 5: Commit**

```bash
git add src/app/use-hash-view.ts src/app/use-hash-view.test.tsx
git commit -F - <<'EOF'
feat: deep-link RAID items via hash; preserve id while on RAID
EOF
```

---

## Task B4: RAID panel consume-once open-by-id

**Files:**
- Modify: `src/app/raid-panel.tsx` (it already has `openEdit`, `raidById`, `draft` — lines 191-278)
- Test: `src/app/raid-panel.test.tsx`

- [ ] **Step 1: Write the failing test** — add to `raid-panel.test.tsx` (match the existing render/provider setup; the panel must be rendered inside `WorkspaceTabProvider`):

```tsx
it("opens the edit modal for a pending deep-linked item", () => {
  // Arrange: a RAID item #5 exists; pendingOpen targets it.
  // Render RaidPanel inside WorkspaceTabProvider, then requestOpen("raid", 5).
  // Assert the edit modal for #5 is shown and pendingOpen is cleared.
});
```

Flesh this out following the file's existing test helpers (build a workspace with a RAID item id 5, render the panel, drive `requestOpen` via a small probe component or the context, assert the modal title/fields for #5 appear). If the panel test file does not already wrap in `WorkspaceTabProvider`, add it.

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement** — in `raid-panel.tsx`:
  - `import { useWorkspaceTab } from "./workspace-tab-context";` and read `const { pendingOpen, clearPendingOpen } = useWorkspaceTab();`
  - Add an effect after `openEdit`/`raidById` are defined:
    ```ts
    useEffect(() => {
      if (pendingOpen?.view !== "raid") return;
      const item = raidById.get(pendingOpen.id);
      if (item) openEdit(item);
      clearPendingOpen();
    }, [pendingOpen, raidById, clearPendingOpen]);
    ```
  - `openEdit` is a stable function defined in the component body; if the linter flags it as a missing dep, wrap `openEdit` in `useCallback` or add an eslint-safe ref — prefer making `openEdit`/the effect consistent with the file's existing patterns. Do NOT disable lint rules.

- [ ] **Step 4: Run — expect PASS.** **Step 5: Commit**

```bash
git add src/app/raid-panel.tsx src/app/raid-panel.test.tsx
git commit -F - <<'EOF'
feat: RAID panel opens deep-linked item once
EOF
```

---

## Task B5: Wire entry points (RAID-review modal + task-manager)

**Files:**
- Modify: `src/app/notifications.tsx` (RaidReviewModal `onSelectRaid`)
- Modify: `src/app/task-manager.tsx` (provides the callback)
- Test: `src/app/notifications.test.tsx`

Context — v0.51 made `onSelectRaid: () => void` because no open-by-id path existed. It now exists.

- [ ] **Step 1: Update the test** — in `notifications.test.tsx`, find the `RaidReviewModal` test asserting `onSelectRaid` is called; change it to assert it is called WITH the item id, e.g. `expect(onSelectRaid).toHaveBeenCalledWith(7)`.

- [ ] **Step 2: Run — expect FAIL.**

- [ ] **Step 3: Implement** — in `notifications.tsx`: change the `RaidReviewModal` prop type to `onSelectRaid: (id: number) => void` and call `onClick={() => onSelectRaid(item.id)}` on each row's open/Edit affordance (the row already has the RAID item in scope).

- [ ] **Step 4** — in `task-manager.tsx`: read `requestOpen` from `useWorkspaceTab()`, define `const openRaidItem = useCallback((id: number) => requestOpen("raid", id), [requestOpen]);` and pass it as the `RaidReviewModal`'s `onSelectRaid`. Remove the old no-arg `onSelectRaidReview` indirection that did `setActiveTab("raid") + clear filter` (the deep-link path now handles navigation); if other call sites used it, point them at `openRaidItem`.

- [ ] **Step 5: Run — expect PASS** (`notifications.test.tsx`, `task-manager.shell.test.tsx`). `npx tsc --noEmit`.

- [ ] **Step 6: Commit**

```bash
git add src/app/notifications.tsx src/app/task-manager.tsx src/app/notifications.test.tsx
git commit -F - <<'EOF'
feat: RAID-review modal deep-links to the specific item
EOF
```

---

# Finalize

## Task C1: Version bump + docs

**Files:**
- Modify: `src/app/version.ts`, `package.json`, `CHANGELOG.md`, `README.md`, `docs/CODEMAPS/*.md`

- [ ] **Step 1** — In `version.ts`: set `APP_VERSION = "0.52.0"`, `APP_BUILD_DATE = "2026-06-04"`, `APP_MILESTONE = "<next codename>"` (pick the next author in the established sci-fi/author series — confirm the prior was "Pratchett"; choose a new unused name), and append `"versionHighlightStakeholders"` to `APP_HIGHLIGHT_KEYS`.
- [ ] **Step 2** — Bump `package.json` `version` to `0.52.0`.
- [ ] **Step 3** — Add a `0.52.0` section to `CHANGELOG.md` (stakeholder register + RACI matrix + influence/interest grid; true RAID deep-linking). Update `README.md` feature list. Update `docs/CODEMAPS/data.md` (new `Stakeholder` entity + `stakeholders` workspace field + Turso `stakeholders` table) and `docs/CODEMAPS/frontend.md` (three new views + panels).
- [ ] **Step 4: Verify** — `npx tsc --noEmit`; `npm run test:run -- version`.
- [ ] **Step 5: Commit**

```bash
git add src/app/version.ts package.json CHANGELOG.md README.md docs/CODEMAPS
git commit -F - <<'EOF'
chore: release 0.52.0 — stakeholder register + RACI and RAID deep-linking
EOF
```

---

## Final verification (after all tasks)

- [ ] `npx tsc --noEmit` — clean.
- [ ] `npm run lint` — clean (no disabled rules added; no edits to `eslint.config.mjs`).
- [ ] `npm run test:run` — full suite green (re-run any contention-flaky storage/property file standalone to confirm).
- [ ] `rg '[“”„‚‘’]' src/app/i18n.de.ts` — returns nothing (DE stayed ASCII).
- [ ] Final code review across the whole branch, then `superpowers:finishing-a-development-branch`.

---

## Self-Review (plan vs. spec)

- **A1 entity model** → Task A1 ✓. **A2 pure helpers** → A2 ✓. **A3 UI (register/RACI/grid + modal)** → A10/A11/A12/A13 (+ A9 modal) ✓. **A4 nav** → A14 ✓. **A5 storage wiring (9-point checklist)** → A4 (types/storage/sanitize-via-A3)+A5 (turso)+A6 (KV/bridge/sharepoint/export)+A7 (context) ✓. **A6 quadrant axis split** → A2 `quadrantFor` + test pins Medium→Low ✓.
- **B1 hash grammar** → B1 ✓. **B2 pending-open** → B2 ✓. **B3 use-hash-view** → B3 ✓. **B4 raid consume-once** → B4 ✓. **B5 entry points** → B5 ✓.
- **i18n** → A9 ✓ (ordered before the panels that consume the keys, so `TranslationKey` resolves). **Testing** → per-task TDD + round-trip + deep-link tests ✓. **Versioning** → C1 ✓.
- **Type consistency:** `Stakeholder.raci: Record<string, RaciRole>`, `setRaciRole(s, milestoneId:number, role|null)`, `quadrantFor`, `compareStakeholder(…, StakeholderSortKey, dir)`, `buildRaciMatrix`/`RaciRow`/`RaciCell`, `parseHash`/`buildHash`, `pendingOpen`/`requestOpen`/`clearPendingOpen`, `useStakeholders`/`handleSaveStakeholder`/`handleDeleteStakeholder` — names used identically across all tasks ✓.
- **Note for the implementer:** several mechanical storage/shell sites are specified as "mirror every `changes` reference" with the exact pattern code given (Tasks A4/A6/A15). The binding acceptance criteria are the round-trip test (A4), the Turso test (A5), and `tsc`/lint/full-suite green — these fail loudly if any mirror site is missed.
