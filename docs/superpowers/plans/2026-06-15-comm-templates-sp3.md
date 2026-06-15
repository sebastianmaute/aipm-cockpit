# Communication Templates SP3 — Versions + Compare + Restore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user save named versions of a communication template, compare any two as a rendered plain-text diff, and restore an earlier one (auto-snapshotting the current body first) — all Turso-only, in the existing template Settings pane.

**Architecture:** A new append-only `comm_template_versions` Turso table (OUT of `TABLE_NAMES`, mirroring `comm_templates`) + a pure in-repo LCS line diff (`text-diff.ts`, no dependency). A Turso-gated `useCommTemplateVersions({templateId})` hook is instantiated **inside** the settings section (which owns the selected-template state); a new `config` prop is threaded task-manager → SettingsView → section. Restore orchestrates an auto-snapshot then a body overwrite, reloading the SP2 editor via a `key` nonce. The live `comm_templates.body` and both send flows are untouched.

**Tech Stack:** TypeScript, React 19 (Next.js fork), Turso (`runTursoPipeline`), Vitest + RTL, i18n EN+DE (tsc parity).

**Spec:** `docs/superpowers/specs/2026-06-15-comm-templates-sp3-design.md`

---

## Grounding facts (verified)

- `comm-templates-store.ts` pattern: `const ddl = () => COMM_TEMPLATE_DDL.map(sql => ({sql}))`; each call `runTursoPipeline(config, [...ddl(), ...stmts])`; decode `results[DDL.length]`.
- `comm-templates-schema.ts` helpers: `const txt = (value:string) => ({type:"text" as const, value})`; `const int = (value:number) => ({type:"integer" as const, value:String(value)})` (**SqlArg.value is string-only even for ints**); `rowObjects(res)` reads `res.response.result.cols[].name` → `rows[][].value`.
- `TABLE_NAMES` from `./turso-schema` — new table MUST NOT be added (guard test). `SqlStmt`/`PipelineResultLike` from `./turso-schema`. `TursoConfig` from `./turso-config`.
- `htmlToPlainText` from `./html-to-text`.
- The section (`comm-templates-section.tsx`) holds `selectedId`/`bodyDraft` state; renders the SP2 `RichTextEditor` with `key={selected.id}`; persists via `props.onSaveBody`. It is fed by `SettingsView` (gets `commTemplates` + `commTemplatesEnabled` props) which is rendered by `task-manager.tsx` (computes `commTemplatesActive = tursoConfig !== null && !isPopout`, has `tursoConfig`).
- The section test mocks `../rich-text-editor`. SP3 also mocks `../use-comm-template-versions`.

## Conventions for every task
- Tests: `npx vitest run src/app/<file>`; typecheck `npx tsc --noEmit`; lint `npm run lint` (CI `--max-warnings=0` — orphaned imports/vars FAIL).
- New i18n strings → EN + DE identical keys; **DE via node CRLF write** (`i18n.de.ts` is `\r\n`; a `\n`-anchored replace silently no-ops); verify `i18n-encoding`.
- a11y: new controls need accessible names; the diff view exposes per-line semantics.
- Palette: only sanctioned tokens (`border-line`, `bg-surface`, `bg-surface-muted`, `text-foreground`, `text-muted-foreground`, `text-AIPM-green-strong`, `text-AIPM-purple`, `text-AIPM-dark-blue`, `focus:ring-AIPM-green`). No shadows/gradients/off-palette.
- Commit after each task. No `Co-Authored-By`. No push.

## File Structure

| File | Responsibility |
|---|---|
| `text-diff.ts` | **new** pure LCS `diffLines(before[], after[]) → DiffLine[]` |
| `comm-template-versions-schema.ts` | **new** `CommTemplateVersion` type, DDL, SQL builders, `rowsToVersions` |
| `comm-template-versions-store.ts` | **new** Turso CRUD (`loadVersions`/`saveVersion`/`deleteVersion`) |
| `use-comm-template-versions.ts` | **new** Turso-gated hook keyed on `templateId` |
| `comm-template-diff-view.tsx` | **new** renders `DiffLine[]` (added/removed/same) |
| `settings-sections/comm-templates-section.tsx` | **modify** Versions area (save/list/restore/compare) + `config` prop |
| `settings-view.tsx`, `task-manager.tsx` | **modify** thread `commTemplatesConfig` |
| `i18n.ts` / `i18n.de.ts` | **modify** SP3 strings + release highlight |
| `version.ts` / `CHANGELOG.md` | **modify** release 0.90.0 "Russ" |

---

### Task 1: Pure LCS line diff (`text-diff.ts`)

**Files:** Create `src/app/text-diff.ts`, `src/app/text-diff.test.ts`.

- [ ] **Step 1: Write the failing test** — `src/app/text-diff.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { diffLines } from "./text-diff";

describe("diffLines", () => {
  it("marks identical lines as same", () => {
    expect(diffLines(["a", "b"], ["a", "b"])).toEqual([
      { type: "same", text: "a" },
      { type: "same", text: "b" },
    ]);
  });
  it("marks an inserted line as added", () => {
    expect(diffLines(["a", "b"], ["a", "x", "b"])).toEqual([
      { type: "same", text: "a" },
      { type: "added", text: "x" },
      { type: "same", text: "b" },
    ]);
  });
  it("marks a deleted line as removed", () => {
    expect(diffLines(["a", "b", "c"], ["a", "c"])).toEqual([
      { type: "same", text: "a" },
      { type: "removed", text: "b" },
      { type: "same", text: "c" },
    ]);
  });
  it("treats a changed line as removed + added", () => {
    expect(diffLines(["a", "b"], ["a", "B"])).toEqual([
      { type: "same", text: "a" },
      { type: "removed", text: "b" },
      { type: "added", text: "B" },
    ]);
  });
  it("handles empty inputs", () => {
    expect(diffLines([], [])).toEqual([]);
    expect(diffLines(["a"], [])).toEqual([{ type: "removed", text: "a" }]);
    expect(diffLines([], ["a"])).toEqual([{ type: "added", text: "a" }]);
  });
});
```

- [ ] **Step 2: Run → FAIL.** `npx vitest run src/app/text-diff.test.ts`

- [ ] **Step 3: Implement** — `src/app/text-diff.ts`:

```ts
// src/app/text-diff.ts — minimal LCS-based line diff for comparing two rendered
// plain-text template bodies. No dependency. A changed line shows as a removed
// line followed by an added line.
export type DiffLine = { type: "same" | "added" | "removed"; text: string };

export function diffLines(before: readonly string[], after: readonly string[]): DiffLine[] {
  const n = before.length;
  const m = after.length;
  // lcs[i][j] = length of the longest common subsequence of before[i..] / after[j..]
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = before[i] === after[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (before[i] === after[j]) {
      out.push({ type: "same", text: before[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push({ type: "removed", text: before[i] });
      i++;
    } else {
      out.push({ type: "added", text: after[j] });
      j++;
    }
  }
  while (i < n) { out.push({ type: "removed", text: before[i] }); i++; }
  while (j < m) { out.push({ type: "added", text: after[j] }); j++; }
  return out;
}
```

- [ ] **Step 4: Run → PASS** + `npx tsc --noEmit`.
- [ ] **Step 5: Commit** — `git add src/app/text-diff.ts src/app/text-diff.test.ts && git commit -m "feat: pure LCS line diff util"`

---

### Task 2: Versions Turso store (`comm-template-versions-schema.ts` + `-store.ts`)

**Files:** Create `comm-template-versions-schema.ts`, `comm-template-versions-store.ts`, `comm-template-versions-store.test.ts`.

- [ ] **Step 1: Write the failing test** — `src/app/comm-template-versions-store.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";

vi.mock("./turso-pipeline", () => ({ runTursoPipeline: vi.fn(async () => []) }));
import { runTursoPipeline } from "./turso-pipeline";
import { saveVersion, deleteVersion, loadVersions } from "./comm-template-versions-store";
import { TABLE_NAMES } from "./turso-schema";

const cfg = {} as never;
const v = { id: "x-v-1", templateId: "x", name: "v1", body: "<p>b</p>", isAuto: false, createdAt: "t" } as const;

describe("comm-template-versions-store", () => {
  it("comm_template_versions is NOT in TABLE_NAMES", () => {
    expect(TABLE_NAMES).not.toContain("comm_template_versions");
  });
  it("saveVersion prepends DDL and inserts the row", async () => {
    await saveVersion(cfg, v as never);
    const stmts = (runTursoPipeline as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)![1];
    expect(stmts.some((s: { sql: string }) => /CREATE TABLE IF NOT EXISTS comm_template_versions/i.test(s.sql))).toBe(true);
    expect(stmts.some((s: { sql: string }) => /INSERT INTO comm_template_versions/i.test(s.sql))).toBe(true);
  });
  it("loadVersions decodes rows after the DDL, ordered as returned", async () => {
    (runTursoPipeline as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { type: "ok" },
      { type: "ok", response: { type: "execute", result: {
        cols: [{ name: "id" }, { name: "template_id" }, { name: "name" }, { name: "body" }, { name: "is_auto" }, { name: "created_at" }],
        rows: [[{ value: "x-v-1" }, { value: "x" }, { value: "v1" }, { value: "<p>b</p>" }, { value: "1" }, { value: "t" }]],
      } } },
    ]);
    const out = await loadVersions(cfg, "x");
    expect(out).toEqual([{ id: "x-v-1", templateId: "x", name: "v1", body: "<p>b</p>", isAuto: true, createdAt: "t" }]);
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** — `src/app/comm-template-versions-schema.ts`:

```ts
// src/app/comm-template-versions-schema.ts — pure SQL builders + row decoder for
// the GLOBAL append-only comm_template_versions table. MUST stay OUT of
// turso-schema's TABLE_NAMES (a guard test enforces it) so the workspace save's
// per-table DELETE never touches it.
import type { PipelineResultLike, SqlStmt } from "./turso-schema";

export interface CommTemplateVersion {
  id: string;
  templateId: string;
  name: string;
  body: string;     // HTML snapshot
  isAuto: boolean;  // 1 = "before restore" auto-snapshot
  createdAt: string;
}

export const COMM_TEMPLATE_VERSION_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS comm_template_versions (id TEXT PRIMARY KEY, template_id TEXT, name TEXT, body TEXT, is_auto INTEGER, created_at TEXT)`,
];

const txt = (value: string) => ({ type: "text" as const, value });
const int = (value: number) => ({ type: "integer" as const, value: String(value) });

export const versionsSelect = (templateId: string): SqlStmt[] => [
  { sql: `SELECT * FROM comm_template_versions WHERE template_id = ? ORDER BY created_at DESC`, args: [txt(templateId)] },
];

export function insertVersionStatements(v: CommTemplateVersion): SqlStmt[] {
  return [{
    sql: `INSERT INTO comm_template_versions (id,template_id,name,body,is_auto,created_at) VALUES (?,?,?,?,?,?)`,
    args: [txt(v.id), txt(v.templateId), txt(v.name), txt(v.body), int(v.isAuto ? 1 : 0), txt(v.createdAt)],
  }];
}

export function deleteVersionStatements(id: string): SqlStmt[] {
  return [{ sql: `DELETE FROM comm_template_versions WHERE id = ?`, args: [txt(id)] }];
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

export function rowsToVersions(res: PipelineResultLike | undefined): CommTemplateVersion[] {
  return rowObjects(res)
    .filter((r) => r.id)
    .map((r): CommTemplateVersion => ({
      id: r.id,
      templateId: r.template_id ?? "",
      name: r.name ?? "",
      body: r.body ?? "",
      isAuto: r.is_auto === "1",
      createdAt: r.created_at ?? "",
    }));
}
```

`src/app/comm-template-versions-store.ts`:

```ts
// src/app/comm-template-versions-store.ts — async CRUD for comm-template versions
// over the shared Turso pipeline. Every call prepends the DDL (CREATE IF NOT EXISTS).
import { runTursoPipeline } from "./turso-pipeline";
import {
  COMM_TEMPLATE_VERSION_DDL, versionsSelect, insertVersionStatements, deleteVersionStatements, rowsToVersions,
  type CommTemplateVersion,
} from "./comm-template-versions-schema";
import type { SqlStmt } from "./turso-schema";
import type { TursoConfig } from "./turso-config";

const ddl = (): SqlStmt[] => COMM_TEMPLATE_VERSION_DDL.map((sql) => ({ sql }));

export async function loadVersions(config: TursoConfig | null, templateId: string): Promise<CommTemplateVersion[]> {
  const results = await runTursoPipeline(config, [...ddl(), ...versionsSelect(templateId)]);
  return rowsToVersions(results[COMM_TEMPLATE_VERSION_DDL.length]);
}
export async function saveVersion(config: TursoConfig | null, v: CommTemplateVersion): Promise<void> {
  await runTursoPipeline(config, [...ddl(), ...insertVersionStatements(v)]);
}
export async function deleteVersion(config: TursoConfig | null, id: string): Promise<void> {
  await runTursoPipeline(config, [...ddl(), ...deleteVersionStatements(id)]);
}
```

- [ ] **Step 4: Run → PASS** + `npx tsc --noEmit`.
- [ ] **Step 5: Commit** — `git add src/app/comm-template-versions-schema.ts src/app/comm-template-versions-store.ts src/app/comm-template-versions-store.test.ts && git commit -m "feat: comm-template versions Turso store (out of TABLE_NAMES)"`

---

### Task 3: `useCommTemplateVersions` hook

**Files:** Create `src/app/use-comm-template-versions.ts`, `src/app/use-comm-template-versions.test.tsx`.

- [ ] **Step 1: Write the failing test** — `src/app/use-comm-template-versions.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

const loadVersions = vi.hoisted(() => vi.fn());
const saveVersion = vi.hoisted(() => vi.fn(async () => {}));
const deleteVersion = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("./comm-template-versions-store", () => ({ loadVersions, saveVersion, deleteVersion }));

import { useCommTemplateVersions } from "./use-comm-template-versions";

const cfg = {} as never;

beforeEach(() => { loadVersions.mockReset(); loadVersions.mockResolvedValue([]); saveVersion.mockClear(); });

describe("useCommTemplateVersions", () => {
  it("inactive: empty, store not hit", async () => {
    const { result } = renderHook(() => useCommTemplateVersions({ active: false, config: cfg, templateId: "x" }));
    expect(result.current.versions).toEqual([]);
    expect(loadVersions).not.toHaveBeenCalled();
  });
  it("active with templateId: loads", async () => {
    loadVersions.mockResolvedValue([{ id: "x-v-1", templateId: "x", name: "v1", body: "<p>b</p>", isAuto: false, createdAt: "t" }]);
    const { result } = renderHook(() => useCommTemplateVersions({ active: true, config: cfg, templateId: "x" }));
    await waitFor(() => expect(result.current.versions.length).toBe(1));
    expect(loadVersions).toHaveBeenCalledWith(cfg, "x");
  });
  it("saveVersion inserts and prepends to state", async () => {
    const { result } = renderHook(() => useCommTemplateVersions({ active: true, config: cfg, templateId: "x" }));
    await waitFor(() => expect(loadVersions).toHaveBeenCalled());
    await act(async () => { await result.current.saveVersion("v2", "<p>c</p>", false); });
    expect(saveVersion).toHaveBeenCalledTimes(1);
    expect(result.current.versions[0]?.name).toBe("v2");
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** — `src/app/use-comm-template-versions.ts`:

```ts
// src/app/use-comm-template-versions.ts — Turso-gated hook for a single template's
// named versions. Mirrors use-comm-templates gating (cfgRef, opSeq staleness guard);
// load/mutation failures are swallowed (versions are an optional Turso feature).
"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  loadVersions, saveVersion as storeSave, deleteVersion as storeDelete,
} from "./comm-template-versions-store";
import type { CommTemplateVersion } from "./comm-template-versions-schema";
import type { TursoConfig } from "./turso-config";

export interface UseCommTemplateVersionsArgs {
  active: boolean;
  config: TursoConfig | null;
  templateId: string | null;
}

export interface UseCommTemplateVersionsResult {
  versions: CommTemplateVersion[];
  busy: boolean;
  saveVersion: (name: string, body: string, isAuto?: boolean) => Promise<void>;
  removeVersion: (id: string) => Promise<void>;
  refresh: () => Promise<void>;
}

export function useCommTemplateVersions(args: UseCommTemplateVersionsArgs): UseCommTemplateVersionsResult {
  const { active, config, templateId } = args;
  const [versions, setVersions] = useState<CommTemplateVersion[]>([]);
  const [busy, setBusy] = useState(false);
  const cfgRef = useRef(config);
  const tidRef = useRef(templateId);
  const opSeqRef = useRef(0);
  useEffect(() => { cfgRef.current = config; }, [config]);
  useEffect(() => { tidRef.current = templateId; }, [templateId]);

  const canRun = () => active && cfgRef.current !== null && !!tidRef.current;

  const load = useCallback(async () => {
    if (!canRun()) { setVersions([]); return; }
    const startSeq = opSeqRef.current;
    try {
      const list = await loadVersions(cfgRef.current, tidRef.current as string);
      if (opSeqRef.current !== startSeq) return;
      setVersions(list);
    } catch {
      // optional feature
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  useEffect(() => {
    if (!active || !cfgRef.current || !templateId) { setVersions([]); return; }
    let cancelled = false;
    const startSeq = opSeqRef.current;
    (async () => {
      try {
        const list = await loadVersions(cfgRef.current, templateId);
        if (cancelled || opSeqRef.current !== startSeq) return;
        setVersions(list);
      } catch {
        // ignore
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, templateId]);

  const saveVersion = useCallback(async (name: string, body: string, isAuto = false) => {
    if (!canRun()) return;
    opSeqRef.current += 1;
    setBusy(true);
    try {
      const now = new Date().toISOString();
      const suffix = Math.random().toString(36).slice(2, 8);
      const tid = tidRef.current as string;
      const v: CommTemplateVersion = { id: `${tid}-v-${now}-${suffix}`, templateId: tid, name, body, isAuto, createdAt: now };
      await storeSave(cfgRef.current, v);
      setVersions((prev) => [v, ...prev]);
    } finally {
      setBusy(false);
    }
  }, [active]);

  const removeVersion = useCallback(async (id: string) => {
    if (!canRun()) return;
    opSeqRef.current += 1;
    setBusy(true);
    try {
      await storeDelete(cfgRef.current, id);
      setVersions((prev) => prev.filter((v) => v.id !== id));
    } finally {
      setBusy(false);
    }
  }, [active]);

  return { versions, busy, saveVersion, removeVersion, refresh: load };
}
```

- [ ] **Step 4: Run → PASS** + `npx tsc --noEmit` + `npm run lint`.
- [ ] **Step 5: Commit** — `git add src/app/use-comm-template-versions.ts src/app/use-comm-template-versions.test.tsx && git commit -m "feat: useCommTemplateVersions hook (Turso-gated, per template)"`

---

### Task 4: Diff view (`comm-template-diff-view.tsx`)

**Files:** Create `src/app/comm-template-diff-view.tsx`, `src/app/comm-template-diff-view.test.tsx`.

i18n-free (labels via props), like the SP2 editor.

- [ ] **Step 1: Write the failing test** — `src/app/comm-template-diff-view.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CommTemplateDiffView } from "./comm-template-diff-view";
import type { DiffLine } from "./text-diff";

const lines: DiffLine[] = [
  { type: "same", text: "Hello" },
  { type: "removed", text: "old line" },
  { type: "added", text: "new line" },
];

describe("CommTemplateDiffView", () => {
  it("renders added/removed/same rows with accessible markers", () => {
    render(
      <CommTemplateDiffView lines={lines} addedLabel="added" removedLabel="removed" summary="1 added, 1 removed" />,
    );
    expect(screen.getByLabelText("1 added, 1 removed")).toBeTruthy();
    expect(screen.getByLabelText("added: new line")).toBeTruthy();
    expect(screen.getByLabelText("removed: old line")).toBeTruthy();
    expect(screen.getByText("Hello")).toBeTruthy();
  });
  it("renders an empty (all-same / no-change) diff without crashing", () => {
    render(<CommTemplateDiffView lines={[]} addedLabel="added" removedLabel="removed" summary="no changes" />);
    expect(screen.getByLabelText("no changes")).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** — `src/app/comm-template-diff-view.tsx`:

```tsx
"use client";
import type { DiffLine } from "./text-diff";

export interface CommTemplateDiffViewProps {
  lines: DiffLine[];
  addedLabel: string;
  removedLabel: string;
  summary: string;
}

export function CommTemplateDiffView(props: CommTemplateDiffViewProps) {
  const { lines, addedLabel, removedLabel, summary } = props;
  return (
    <div
      role="list"
      aria-label={summary}
      className="flex flex-col rounded-md border border-line bg-surface px-2 py-1.5 font-mono text-xs"
    >
      {lines.map((line, i) => {
        if (line.type === "added") {
          return (
            <div key={i} role="listitem" aria-label={`${addedLabel}: ${line.text}`} className="text-AIPM-green-strong">
              <span aria-hidden>+ </span>{line.text || " "}
            </div>
          );
        }
        if (line.type === "removed") {
          return (
            <div key={i} role="listitem" aria-label={`${removedLabel}: ${line.text}`} className="text-AIPM-purple line-through">
              <span aria-hidden>- </span>{line.text || " "}
            </div>
          );
        }
        return (
          <div key={i} role="listitem" className="text-muted-foreground">
            <span aria-hidden>&nbsp;&nbsp;</span>{line.text || " "}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Run → PASS** + `npx tsc --noEmit` + `npm run lint`.
- [ ] **Step 5: Commit** — `git add src/app/comm-template-diff-view.tsx src/app/comm-template-diff-view.test.tsx && git commit -m "feat: comm-template diff view (added/removed/same lines)"`

---

### Task 5: Versions area in the pane (save / list / restore) + config threading + i18n

**Files:** Modify `settings-sections/comm-templates-section.tsx`, `settings-view.tsx`, `task-manager.tsx`, `i18n.ts`, `i18n.de.ts`, and the section test.

- [ ] **Step 1: Add ALL SP3 EN i18n keys via Edit** — in `src/app/i18n.ts`, find `  commTplLinkPrompt: "Enter a URL (https://…)",` and insert AFTER it:
```
  commTplVersions: "Versions",
  commTplSaveVersion: "Save version",
  commTplVersionNamePrompt: "Name this version",
  commTplRestore: "Restore",
  commTplRestored: "Restored",
  commTplCompare: "Compare",
  commTplCurrent: "Current",
  commTplVersionAuto: "Auto",
  commTplVersionsEmpty: "No saved versions yet.",
  commTplBeforeRestore: "Before restore",
  commTplDiffAdded: "added",
  commTplDiffRemoved: "removed",
  commTplDiffSummary: "Diff: {0} added, {1} removed",
```

- [ ] **Step 2: Add DE i18n keys via node CRLF write** — run with `node` (grep the DE `commTplLinkPrompt` line first to confirm the anchor bytes):
```js
const fs = require("fs");
const p = "src/app/i18n.de.ts";
let s = fs.readFileSync(p, "utf8");
const anchor = '  commTplLinkPrompt: "URL eingeben (https://…)",';
if (!s.includes(anchor)) throw new Error("DE anchor not found");
if (s.includes("commTplSaveVersion")) throw new Error("DE keys already present");
const block = [
  '  commTplVersions: "Versionen",',
  '  commTplSaveVersion: "Version speichern",',
  '  commTplVersionNamePrompt: "Diese Version benennen",',
  '  commTplRestore: "Wiederherstellen",',
  '  commTplRestored: "Wiederhergestellt",',
  '  commTplCompare: "Vergleichen",',
  '  commTplCurrent: "Aktuell",',
  '  commTplVersionAuto: "Auto",',
  '  commTplVersionsEmpty: "Noch keine gespeicherten Versionen.",',
  '  commTplBeforeRestore: "Vor Wiederherstellung",',
  '  commTplDiffAdded: "hinzugefügt",',
  '  commTplDiffRemoved: "entfernt",',
  '  commTplDiffSummary: "Vergleich: {0} hinzugefügt, {1} entfernt",',
].join("\r\n");
s = s.replace(anchor, anchor + "\r\n" + block);
fs.writeFileSync(p, s, "utf8");
console.log("DE SP3 keys inserted");
```

- [ ] **Step 3: Thread `config` through SettingsView + task-manager.**
  - `src/app/settings-view.tsx`: add `import type { TursoConfig } from "./turso-config";` (if not present). Add to `SettingsViewProps`: `commTemplatesConfig?: TursoConfig | null;`. In the `<CommTemplatesSection ... />` render (the `active === "commTemplates"` block), add the prop `config={props.commTemplatesConfig ?? null}`.
  - `src/app/task-manager.tsx`: in the `<SettingsView ... />` element (where `commTemplatesEnabled`/`commTemplates` are already passed), add `commTemplatesConfig={tursoConfig}`.

- [ ] **Step 4: Update the section test** — `src/app/settings-sections/comm-templates-section.test.tsx`. Add a mock for the versions hook near the top (after the existing `vi.mock("../rich-text-editor", ...)`):
```tsx
const saveVersion = vi.fn(async () => {});
vi.mock("../use-comm-template-versions", () => ({
  useCommTemplateVersions: () => ({
    versions: [{ id: "x-v-1", templateId: "t1", name: "v1", body: "<p>old</p>", isAuto: false, createdAt: "2026-06-15T00:00:00Z" }],
    busy: false,
    saveVersion,
    removeVersion: vi.fn(),
    refresh: vi.fn(),
  }),
}));
```
Add a test (the section now needs the `config` prop — update `setup` to pass `config={{} as never}` if it constructs props inline; otherwise add it):
```tsx
  it("saves a named version of the current body", async () => {
    setup([tpl()]);
    fireEvent.click(screen.getByRole("button", { name: "Inquiry A" }));
    vi.spyOn(window, "prompt").mockReturnValue("My version");
    fireEvent.click(screen.getByRole("button", { name: "Save version" }));
    expect(saveVersion).toHaveBeenCalledWith("My version", expect.any(String), false);
  });
```
(Ensure the section's `setup` passes the new required `config` prop. If `CommTemplatesSectionProps.config` is `TursoConfig | null`, pass `config={null}` — but then the hook mock still returns the versions; the mock ignores args, so `null` is fine for the test.)

- [ ] **Step 5: Run → the new test FAILS** (no Save version button yet). `npx vitest run src/app/settings-sections/comm-templates-section.test.tsx`

- [ ] **Step 6: Implement the section changes** — `src/app/settings-sections/comm-templates-section.tsx`:
  (a) Imports (after existing): 
```tsx
import type { TursoConfig } from "../turso-config";
import { useCommTemplateVersions } from "../use-comm-template-versions";
```
  (b) Add `config: TursoConfig | null;` to `CommTemplatesSectionProps`.
  (c) Inside the component, after the existing `useState` lines, add:
```tsx
  const [restoreNonce, setRestoreNonce] = useState(0);
  const versions = useCommTemplateVersions({ active: props.config !== null, config: props.config, templateId: selectedId });

  function saveCurrentVersion() {
    if (!selected) return;
    const name = window.prompt(t(lang, "commTplVersionNamePrompt"), "");
    if (!name || !name.trim()) return;
    void versions.saveVersion(name.trim(), bodyDraft, false);
  }

  function restoreVersion(body: string) {
    if (!selected) return;
    const stamp = new Date().toISOString();
    void versions.saveVersion(`${t(lang, "commTplBeforeRestore")} — ${stamp}`, bodyDraft, true);
    setBodyDraft(body);
    props.onSaveBody(selected.id, body);
    setRestoreNonce((n) => n + 1);
  }
```
  (d) Change BOTH the rename input `key={selected.id}` and the editor `key={selected.id}` to `key={`${selected.id}:${restoreNonce}`}` (so restore reloads the editor content; the rename input may keep `key={selected.id}`, but using the same nonce is harmless).
     - Editor: `key={`${selected.id}:${restoreNonce}`}`.
  (e) After the editor wrapper `<div>` (still inside `{selected && (...)}`), add the Versions area:
```tsx
          <div className="flex flex-col gap-2 border-t border-line pt-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-foreground">{t(lang, "commTplVersions")}</span>
              <button
                type="button"
                onClick={saveCurrentVersion}
                className="shrink-0 rounded-md border border-line px-2 py-1 text-xs hover:bg-surface-muted"
              >
                {t(lang, "commTplSaveVersion")}
              </button>
            </div>
            {versions.versions.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t(lang, "commTplVersionsEmpty")}</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {versions.versions.map((v) => (
                  <li key={v.id} className="flex items-center justify-between gap-2 rounded-md border border-line bg-surface px-2 py-1">
                    <span className="flex min-w-0 flex-1 items-center gap-2">
                      <span className="truncate text-xs text-foreground">{v.name}</span>
                      {v.isAuto && (
                        <span className="shrink-0 rounded bg-surface-muted px-1 py-0.5 text-[10px] text-muted-foreground">
                          {t(lang, "commTplVersionAuto")}
                        </span>
                      )}
                    </span>
                    <button
                      type="button"
                      onClick={() => restoreVersion(v.body)}
                      aria-label={`${t(lang, "commTplRestore")}: ${v.name}`}
                      className="shrink-0 rounded-md border border-line px-2 py-0.5 text-[11px] hover:bg-surface-muted"
                    >
                      {t(lang, "commTplRestore")}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
```

- [ ] **Step 7: Run → PASS** — run ALL:
```
npx vitest run src/app/settings-sections/comm-templates-section.test.tsx src/app/i18n-encoding.test.ts
npx tsc --noEmit
npm run lint
```
All pass; tsc proves EN/DE parity; lint 0 warnings.

- [ ] **Step 8: Commit** — `git add src/app/settings-sections/comm-templates-section.tsx src/app/settings-sections/comm-templates-section.test.tsx src/app/settings-view.tsx src/app/task-manager.tsx src/app/i18n.ts src/app/i18n.de.ts && git commit -m "feat: comm-template versions — save + restore in the pane"`

---

### Task 6: Compare two versions (diff view)

**Files:** Modify `settings-sections/comm-templates-section.tsx`, its test.

- [ ] **Step 1: Add the failing test** — append to `comm-templates-section.test.tsx`:
```tsx
  it("compares Current against a version and shows the diff", async () => {
    setup([tpl({ body: "<p>new</p>" })]);
    fireEvent.click(screen.getByRole("button", { name: "Inquiry A" }));
    // select Current + v1 to compare
    fireEvent.click(screen.getByRole("button", { name: "Compare: Current" }));
    fireEvent.click(screen.getByRole("button", { name: "Compare: v1" }));
    // v1 body is "<p>old</p>" (from the mock), current is "<p>new</p>"
    expect(await screen.findByLabelText(/removed: old/)).toBeTruthy();
    expect(screen.getByLabelText(/added: new/)).toBeTruthy();
  });
```
(The diff is plain-text: `htmlToPlainText("<p>old</p>")` = "old", `htmlToPlainText("<p>new</p>")` = "new". Comparing Current="new" vs v1="old" yields removed "new"? order depends on which side is "before". Define: the OLDER-by-createdAt side is "before". Current has no createdAt → treat Current as the newest (after). So before=v1 "old", after=current "new" → removed "old", added "new". The assertions match.)

- [ ] **Step 2: Run → FAIL** (no Compare buttons).

- [ ] **Step 3: Implement** — in `comm-templates-section.tsx`:
  (a) Imports: `import { diffLines } from "../text-diff";`, `import { htmlToPlainText } from "../html-to-text";`, `import { CommTemplateDiffView } from "../comm-template-diff-view";`.
  (b) Add state + a compare helper near `restoreNonce`:
```tsx
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const CURRENT_ID = "__current__";

  function toggleCompare(id: string) {
    setCompareIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : prev.length >= 2 ? [prev[1], id] : [...prev, id],
    );
  }

  function bodyOf(id: string): string {
    if (id === CURRENT_ID) return bodyDraft;
    return versions.versions.find((v) => v.id === id)?.body ?? "";
  }

  function sortKey(id: string): string {
    // Current is "newest"; versions sort by createdAt.
    if (id === CURRENT_ID) return "￿";
    return versions.versions.find((v) => v.id === id)?.createdAt ?? "";
  }
```
  (c) Add a compare toggle button to EACH version `<li>` (next to Restore) and add a synthetic "Current" row at the top of the list. Each compare button:
```tsx
                    <button
                      type="button"
                      onClick={() => toggleCompare(v.id)}
                      aria-pressed={compareIds.includes(v.id)}
                      aria-label={`${t(lang, "commTplCompare")}: ${v.name}`}
                      className={compareIds.includes(v.id)
                        ? "shrink-0 rounded-md border border-line bg-AIPM-dark-blue px-2 py-0.5 text-[11px] text-white"
                        : "shrink-0 rounded-md border border-line px-2 py-0.5 text-[11px] hover:bg-surface-muted"}
                    >
                      {t(lang, "commTplCompare")}
                    </button>
```
     And a "Current" entry rendered just above the `<ul>` mapping (or as the first `<li>`):
```tsx
                <li className="flex items-center justify-between gap-2 rounded-md border border-line bg-surface px-2 py-1">
                  <span className="truncate text-xs text-foreground">{t(lang, "commTplCurrent")}</span>
                  <button
                    type="button"
                    onClick={() => toggleCompare(CURRENT_ID)}
                    aria-pressed={compareIds.includes(CURRENT_ID)}
                    aria-label={`${t(lang, "commTplCompare")}: ${t(lang, "commTplCurrent")}`}
                    className={compareIds.includes(CURRENT_ID)
                      ? "shrink-0 rounded-md border border-line bg-AIPM-dark-blue px-2 py-0.5 text-[11px] text-white"
                      : "shrink-0 rounded-md border border-line px-2 py-0.5 text-[11px] hover:bg-surface-muted"}
                  >
                    {t(lang, "commTplCompare")}
                  </button>
                </li>
```
  (d) Below the list, when two are selected, render the diff:
```tsx
            {compareIds.length === 2 && (() => {
              const [a, b] = [...compareIds].sort((x, y) => sortKey(x).localeCompare(sortKey(y)));
              const before = htmlToPlainText(bodyOf(a)).split("\n");
              const after = htmlToPlainText(bodyOf(b)).split("\n");
              const lines = diffLines(before, after);
              const added = lines.filter((l) => l.type === "added").length;
              const removed = lines.filter((l) => l.type === "removed").length;
              return (
                <CommTemplateDiffView
                  lines={lines}
                  addedLabel={t(lang, "commTplDiffAdded")}
                  removedLabel={t(lang, "commTplDiffRemoved")}
                  summary={t(lang, "commTplDiffSummary", String(added), String(removed))}
                />
              );
            })()}
```
  (e) Reset `compareIds` to `[]` when the selected template changes (in `selectTemplate` and the category `onChange`): add `setCompareIds([]);` there.

- [ ] **Step 4: Run → PASS** + `npx tsc --noEmit` + `npm run lint`.
- [ ] **Step 5: Commit** — `git add src/app/settings-sections/comm-templates-section.tsx src/app/settings-sections/comm-templates-section.test.tsx && git commit -m "feat: compare two comm-template versions (plain-text diff)"`

---

### Task 7: Release — 0.90.0 "Russ"

**Files:** `version.ts`, `CHANGELOG.md`, `i18n.ts`, `i18n.de.ts`.

- [ ] **Step 1:** Full suite + build green: `npx vitest run && npx tsc --noEmit && npm run lint && npm run build`. STOP on any failure.
- [ ] **Step 2:** `version.ts`: `APP_VERSION="0.90.0"`; `APP_BUILD_DATE` comment → `// 0.90.0 comm templates SP3 versions`; `APP_MILESTONE="Russ"` (Joanna Russ) + update its JSDoc (`0.90.x line is "Russ"`). Append `"versionHighlightCommTemplatesVersions"` to `APP_HIGHLIGHT_KEYS`.
- [ ] **Step 3:** EN (Edit) after `  versionHighlightCommTemplatesRich: "...",`:
```
  versionHighlightCommTemplatesVersions: "Save named versions of a communication template, compare any two, and restore an earlier one (your current draft is snapshotted first).",
```
DE (node CRLF write; grep the `versionHighlightCommTemplatesRich` DE line for the anchor) after it:
```
  versionHighlightCommTemplatesVersions: "Benannte Versionen einer Kommunikationsvorlage speichern, zwei davon vergleichen und eine frühere wiederherstellen (der aktuelle Entwurf wird zuerst gesichert).",
```
Verify bytes; run `npx vitest run src/app/i18n-encoding.test.ts`.
- [ ] **Step 4:** `CHANGELOG.md`: add above `## [0.89.0]`:
```
## [0.90.0] - 2026-06-15 "Russ"

### Added / Changed
- **Communication templates versions (SP3)**: save named versions of a template,
  compare any two as a rendered plain-text diff, and restore an earlier one — the
  current draft is auto-snapshotted before a restore so nothing is lost. Versions
  live in an append-only Turso table (out of the workspace save cycle). This
  completes the editable-templates roadmap ahead of the optional Graph HTML-send slice.
```
- [ ] **Step 5:** `npx vitest run && npx tsc --noEmit && npm run lint && npm run build`, then `git add src/app/version.ts src/app/i18n.ts src/app/i18n.de.ts CHANGELOG.md && git commit -m "chore: release 0.90.0 comm templates SP3 versions"`.

---

## Final verification (before finishing)
```bash
npx vitest run && npx tsc --noEmit && npm run lint && npm run build
```
Then **superpowers:finishing-a-development-branch**. e2e axe gate runs in CI — the Save/Restore/Compare controls + the diff view must be labelled + keyboard-reachable.

## Self-Review

**Spec coverage:** LCS plain-text diff (T1) ✓; append-only versions store out of TABLE_NAMES (T2) ✓; Turso-gated per-template hook (T3) ✓; diff view (T4) ✓; named-version save + auto-snapshot restore + editor key-nonce reload + config threading + i18n (T5) ✓; compare two of {Current,…versions} (T6) ✓; release (T7) ✓.

**Placeholder scan:** none — every step has concrete code/commands.

**Type consistency:** `CommTemplateVersion` (schema, T2) used identically by the store (T2), hook (T3), section (T5/T6); `DiffLine` (T1) used by the diff view (T4) and the section compare (T6); `diffLines(before,after)`, `useCommTemplateVersions({active,config,templateId})→{versions,saveVersion,removeVersion,refresh}`, `saveVersion(name,body,isAuto?)` consistent across tasks; `CommTemplatesSectionProps.config: TursoConfig | null` added in T5 and consumed in T6.

**Resolved deviation from spec:** the spec's "thread a versions prop bundle" line is overridden — because the hook needs `templateId` = the section's local `selectedId`, the section instantiates the hook itself with a `config` prop (threaded task-manager → SettingsView → section). Tests mock `../use-comm-template-versions`. This keeps selection state and version loading colocated; the section stays testable via the mock.

**Adapt-to-existing notes (not placeholders):** the DE i18n anchors (`commTplLinkPrompt`, `versionHighlightCommTemplatesRich`) — grep exact bytes before the node write; the `t(lang, key, ...args)` interpolation signature for `commTplDiffSummary` ({0}/{1}) — confirm the project's `t()` supports positional args (it does: `emailBodyTemplate` etc. use them).
