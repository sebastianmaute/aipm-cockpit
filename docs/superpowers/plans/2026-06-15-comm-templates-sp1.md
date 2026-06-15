# Communication Templates SP1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Foundation for editable comms templates — pure model + interpolation, a global Turso store, a Turso-gated settings pane (textarea body), and send-flow wiring so "send inquiry" / "draft stakeholder message" auto-use the category default (with an i18n fallback off-Turso).

**Architecture:** New pure `comm-templates.ts` (model, categories, merge-fields, `renderTemplate`, var builders) + `html-to-text.ts`. A `comm-templates-store.ts` over the shared Turso pipeline (table ensured by the store, OUT of `TABLE_NAMES` — version-store precedent; no `SCHEMA_VERSION` bump). A Turso-gated `useCommTemplates()` hook exposing `resolveTemplateBody(category)`. The two send sites use it, falling back to the existing i18n body templates.

**Tech Stack:** TypeScript, React (Next.js fork), Vitest + RTL, Turso (`runTursoPipeline`), i18n EN+DE (tsc parity).

**Spec:** `docs/superpowers/specs/2026-06-15-comm-templates-sp1-design.md`

---

## Grounding facts (verified)

- Turso store pattern (`snapshot-store.ts`): `runTursoPipeline(config, SqlStmt[])`; each call prepends a `CREATE TABLE IF NOT EXISTS` DDL; `SqlStmt = { sql: string; args?: Array<{ type: "text"|"integer"|"null"; value?: string|number }> }` (from `turso-schema`). Results are positional; data rows come after the DDL statements.
- `TABLE_NAMES` (turso-schema.ts) drives workspace save/load — `comm_templates` must NOT be added to it (mirrors `project_versions`).
- Turso-gating pattern (`use-snapshots.ts`): `active = isTurso && tursoConfig !== null && !isPopout && …`; refs for config; load in an effect.
- `onSendInquiry` (use-task-row-handlers.ts:111): builds body via `t(lang,"emailBodyTemplate",greeting,task.id,task.taskName,task.dueDate,task.lastUpdateDate)`; `greetingName` is imported there. The comms draft (`handleDraftMessageFromAction` in task-manager.tsx) uses `t(lang,"commsEmailBodyTemplate",sh.name)`.
- Settings rail (`settings-view.tsx`) gates entries (Trends/History are Turso-gated) — reuse that gating for the new section.

## Conventions for every task
- Tests: `npx vitest run src/app/<file>.test.ts(x)`; typecheck `npx tsc --noEmit`; lint `npm run lint` (CI `--max-warnings=0` — a stray unused import fails it; re-check imports after refactors).
- New i18n strings → EN + DE identical keys; DE umlauts via node write; verify `i18n-encoding`.
- a11y: new controls need accessible names (axe gate).
- Commit after each task. No `Co-Authored-By`.

## File Structure

| File | Responsibility |
|---|---|
| `comm-templates.ts` | **new** pure: types, categories, `CATEGORY_FIELDS`, `renderTemplate`, `withDefault`, var builders |
| `html-to-text.ts` | **new** pure `htmlToPlainText` |
| `comm-templates-schema.ts` | **new** DDL + statement builders + `rowsToTemplates` |
| `comm-templates-store.ts` | **new** Turso CRUD |
| `use-comm-templates.ts` | **new** Turso-gated hook + `resolveTemplateBody` |
| `settings-sections/comm-templates-section.tsx` | **new** settings pane |
| `settings-view.tsx` | add Turso-gated "Communication templates" rail entry |
| `use-task-row-handlers.ts`, `task-manager.tsx` | send-wiring (consume `resolveTemplateBody`) |
| `i18n.ts` / `i18n.de.ts` | category/field/UI/highlight strings |
| `version.ts` / `CHANGELOG.md` | release 0.88.0 "Niven" |

---

### Task 1: Pure model + interpolation (`comm-templates.ts`)

**Files:** Create `src/app/comm-templates.ts`, `src/app/comm-templates.test.ts`.

- [ ] **Step 1: Write failing test** — create `comm-templates.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { renderTemplate, withDefault, CATEGORY_FIELDS, buildStatusInquiryVars, buildStakeholderUpdateVars, type CommTemplate } from "./comm-templates";

describe("renderTemplate", () => {
  it("replaces known tokens and html-escapes values", () => {
    const out = renderTemplate("Hi {{assignee}} re {{taskName}}", "status-inquiry", { assignee: "A & B", taskName: "<x>" });
    expect(out).toBe("Hi A &amp; B re &lt;x&gt;");
  });
  it("leaves unknown tokens literal", () => {
    expect(renderTemplate("{{nope}}", "status-inquiry", {})).toBe("{{nope}}");
  });
  it("empty for a known token with no value", () => {
    expect(renderTemplate("[{{dueDate}}]", "status-inquiry", {})).toBe("[]");
  });
});

describe("withDefault", () => {
  const list: CommTemplate[] = [
    { id: "a", category: "status-inquiry", name: "A", body: "", isDefault: true, createdAt: "", updatedAt: "" },
    { id: "b", category: "status-inquiry", name: "B", body: "", isDefault: false, createdAt: "", updatedAt: "" },
    { id: "c", category: "stakeholder-update", name: "C", body: "", isDefault: true, createdAt: "", updatedAt: "" },
  ];
  it("moves the default within a category, leaving others untouched", () => {
    const next = withDefault(list, "b");
    expect(next.find((t) => t.id === "a")!.isDefault).toBe(false);
    expect(next.find((t) => t.id === "b")!.isDefault).toBe(true);
    expect(next.find((t) => t.id === "c")!.isDefault).toBe(true); // other category untouched
  });
});

describe("var builders", () => {
  it("builds status-inquiry vars", () => {
    const v = buildStatusInquiryVars({ id: 7, taskName: "Ship", dueDate: "2026-07-01", lastUpdateDate: "2026-06-01", assignee: "Mara Vega" } as never, "en-US");
    expect(v.taskId).toBe("7");
    expect(v.taskName).toBe("Ship");
    expect(v.dueDate).toBe("2026-07-01");
    expect(v.assignee).toBeTruthy();
  });
  it("builds stakeholder-update vars", () => {
    expect(buildStakeholderUpdateVars({ name: "Acme" } as never, "Proj X")).toEqual({ stakeholderName: "Acme", projectName: "Proj X" });
  });
  it("registry covers both categories", () => {
    expect(CATEGORY_FIELDS["status-inquiry"]).toContain("taskName");
    expect(CATEGORY_FIELDS["stakeholder-update"]).toContain("stakeholderName");
  });
});
```
(If `greetingName`'s real output differs, assert `v.assignee` loosely as above — `toBeTruthy`.)

- [ ] **Step 2: Run, verify failure** — `npx vitest run src/app/comm-templates.test.ts` → FAIL.

- [ ] **Step 3: Implement** — create `src/app/comm-templates.ts`:

```ts
// src/app/comm-templates.ts — pure model + interpolation for communication templates.
import type { Lang } from "./i18n";
import type { Task, Stakeholder } from "./types";
import { greetingName } from "./sanitize"; // adjust import to greetingName's real module

export type CommTemplateCategory = "status-inquiry" | "stakeholder-update";

export const COMM_TEMPLATE_CATEGORIES: readonly CommTemplateCategory[] = ["status-inquiry", "stakeholder-update"];

export const CATEGORY_FIELDS: Record<CommTemplateCategory, readonly string[]> = {
  "status-inquiry": ["taskId", "taskName", "dueDate", "lastUpdate", "assignee"],
  "stakeholder-update": ["stakeholderName", "projectName"],
};

export interface CommTemplate {
  id: string;
  category: CommTemplateCategory;
  name: string;
  body: string;        // HTML
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
function htmlEscape(s: string): string { return s.replace(/[&<>"']/g, (c) => ESC[c]); }

export function renderTemplate(body: string, category: CommTemplateCategory, vars: Readonly<Record<string, string>>): string {
  const allowed = new Set(CATEGORY_FIELDS[category]);
  return body.replace(/\{\{(\w+)\}\}/g, (m, field) => (allowed.has(field) ? htmlEscape(vars[field] ?? "") : m));
}

export function withDefault(list: readonly CommTemplate[], id: string): CommTemplate[] {
  const target = list.find((t) => t.id === id);
  if (!target) return [...list];
  return list.map((t) => (t.category === target.category ? { ...t, isDefault: t.id === id } : t));
}

export function buildStatusInquiryVars(task: Task, _lang: Lang): Record<string, string> {
  return {
    taskId: String(task.id),
    taskName: task.taskName,
    dueDate: task.dueDate ?? "",
    lastUpdate: task.lastUpdateDate ?? "",
    assignee: greetingName(task.assignee) || task.assignee || "",
  };
}

export function buildStakeholderUpdateVars(sh: Stakeholder, projectName: string): Record<string, string> {
  return { stakeholderName: sh.name, projectName };
}
```
(Verify `greetingName`'s module via grep — adjust the import. If `Stakeholder` isn't exported from `./types`, import from its real module.)

- [ ] **Step 4: Run, verify pass** — `npx vitest run src/app/comm-templates.test.ts && npx tsc --noEmit` → PASS/clean.

- [ ] **Step 5: Commit** — `git add src/app/comm-templates.ts src/app/comm-templates.test.ts && git commit -m "feat: pure comm-template model + interpolation"`

---

### Task 2: `html-to-text.ts`

**Files:** Create `src/app/html-to-text.ts`, `src/app/html-to-text.test.ts`.

- [ ] **Step 1: Write failing test**:

```ts
import { describe, it, expect } from "vitest";
import { htmlToPlainText } from "./html-to-text";

describe("htmlToPlainText", () => {
  it("converts block tags + br to newlines and strips tags", () => {
    expect(htmlToPlainText("<p>Hi</p><p>There</p>")).toBe("Hi\nThere");
    expect(htmlToPlainText("a<br>b")).toBe("a\nb");
    expect(htmlToPlainText("<b>bold</b> <i>x</i>")).toBe("bold x");
  });
  it("decodes common entities", () => {
    expect(htmlToPlainText("A &amp; B &lt;x&gt; &nbsp;y")).toBe("A & B <x>  y");
  });
  it("collapses 3+ blank lines and trims", () => {
    expect(htmlToPlainText("<p>a</p><br><br><br><p>b</p>")).toBe("a\n\nb");
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** — `src/app/html-to-text.ts`:

```ts
// src/app/html-to-text.ts — basic HTML → plain text for the mailto body (SP1).
const ENT: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };

export function htmlToPlainText(html: string): string {
  let s = html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/\s*(p|div|li|h[1-6]|tr)\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "");
  s = s.replace(/&amp;|&lt;|&gt;|&quot;|&#39;|&nbsp;/g, (e) => ENT[e]);
  return s.replace(/\n{3,}/g, "\n\n").trim();
}
```

- [ ] **Step 4: Run → PASS** + `npx tsc --noEmit`.
- [ ] **Step 5: Commit** — `git add src/app/html-to-text.ts src/app/html-to-text.test.ts && git commit -m "feat: htmlToPlainText util"`

---

### Task 3: Turso store (`comm-templates-schema.ts` + `comm-templates-store.ts`)

**Files:** Create `comm-templates-schema.ts`, `comm-templates-store.ts`, `comm-templates-store.test.ts`; Test: also assert NOT in `TABLE_NAMES`.

- [ ] **Step 1: Write failing test** — `comm-templates-store.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";

vi.mock("./turso-pipeline", () => ({ runTursoPipeline: vi.fn(async () => []) }));
import { runTursoPipeline } from "./turso-pipeline";
import { upsertTemplate, deleteTemplate, setDefaultTemplate, loadTemplates } from "./comm-templates-store";
import { TABLE_NAMES } from "./turso-schema";

const cfg = {} as never;
const tpl = { id: "x", category: "status-inquiry", name: "N", body: "<p>b</p>", isDefault: true, createdAt: "t", updatedAt: "t" } as const;

describe("comm-templates-store", () => {
  it("comm_templates is NOT in TABLE_NAMES", () => {
    expect(TABLE_NAMES).not.toContain("comm_templates");
  });
  it("upsert prepends DDL and writes the row", async () => {
    await upsertTemplate(cfg, tpl as never);
    const stmts = (runTursoPipeline as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)![1];
    expect(stmts.some((s: { sql: string }) => /CREATE TABLE IF NOT EXISTS comm_templates/i.test(s.sql))).toBe(true);
    expect(stmts.some((s: { sql: string }) => /INSERT INTO comm_templates/i.test(s.sql))).toBe(true);
  });
  it("setDefault clears the category then sets one in a single pipeline", async () => {
    await setDefaultTemplate(cfg, "status-inquiry", "x");
    const stmts = (runTursoPipeline as unknown as ReturnType<typeof vi.fn>).mock.calls.at(-1)![1];
    expect(stmts.some((s: { sql: string }) => /UPDATE comm_templates SET is_default ?= ?0/i.test(s.sql))).toBe(true);
    expect(stmts.some((s: { sql: string }) => /is_default ?= ?1/i.test(s.sql))).toBe(true);
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** — `comm-templates-schema.ts`:

```ts
import type { SqlStmt } from "./turso-schema";
import type { CommTemplate, CommTemplateCategory } from "./comm-templates";

export const COMM_TEMPLATE_DDL: string[] = [
  `CREATE TABLE IF NOT EXISTS comm_templates (id TEXT PRIMARY KEY, category TEXT, name TEXT, body TEXT, is_default INTEGER, created_at TEXT, updated_at TEXT)`,
];
const txt = (v: string) => ({ type: "text" as const, value: v });
const int = (v: number) => ({ type: "integer" as const, value: v });

export const templateSelect = (): SqlStmt[] => [{ sql: `SELECT * FROM comm_templates` }];

export function upsertStatements(t: CommTemplate): SqlStmt[] {
  return [{
    sql: `INSERT INTO comm_templates (id,category,name,body,is_default,created_at,updated_at) VALUES (?,?,?,?,?,?,?)
          ON CONFLICT(id) DO UPDATE SET category=excluded.category,name=excluded.name,body=excluded.body,is_default=excluded.is_default,updated_at=excluded.updated_at`,
    args: [txt(t.id), txt(t.category), txt(t.name), txt(t.body), int(t.isDefault ? 1 : 0), txt(t.createdAt), txt(t.updatedAt)],
  }];
}
export function deleteStatements(id: string): SqlStmt[] {
  return [{ sql: `DELETE FROM comm_templates WHERE id = ?`, args: [txt(id)] }];
}
export function setDefaultStatements(category: CommTemplateCategory, id: string): SqlStmt[] {
  return [
    { sql: `UPDATE comm_templates SET is_default = 0 WHERE category = ?`, args: [txt(category)] },
    { sql: `UPDATE comm_templates SET is_default = 1 WHERE id = ?`, args: [txt(id)] },
  ];
}
export function rowsToTemplates(result: unknown): CommTemplate[] {
  // result shape mirrors snapshot rowsToSnapshots — adapt to the pipeline's row format
  // (read snapshot-schema.ts rowsToSnapshots for the exact `result.rows`/`result.columns` access).
  const rows = (result as { rows?: Array<Record<string, unknown>> })?.rows ?? [];
  return rows.map((r) => ({
    id: String(r.id), category: String(r.category) as CommTemplateCategory, name: String(r.name),
    body: String(r.body ?? ""), isDefault: Number(r.is_default) === 1,
    createdAt: String(r.created_at ?? ""), updatedAt: String(r.updated_at ?? ""),
  }));
}
```
(★ Read `snapshot-schema.ts` `rowsToSnapshots` for the EXACT result-row access shape and match it in `rowsToTemplates`.)

`comm-templates-store.ts` (mirror snapshot-store):
```ts
import { runTursoPipeline } from "./turso-pipeline";
import { COMM_TEMPLATE_DDL, templateSelect, upsertStatements, deleteStatements, setDefaultStatements, rowsToTemplates } from "./comm-templates-schema";
import type { SqlStmt } from "./turso-schema";
import type { TursoConfig } from "./turso-config";
import type { CommTemplate, CommTemplateCategory } from "./comm-templates";

const ddl = (): SqlStmt[] => COMM_TEMPLATE_DDL.map((sql) => ({ sql }));

export async function loadTemplates(config: TursoConfig | null): Promise<CommTemplate[]> {
  const results = await runTursoPipeline(config, [...ddl(), ...templateSelect()]);
  return rowsToTemplates(results[COMM_TEMPLATE_DDL.length]);
}
export async function upsertTemplate(config: TursoConfig | null, t: CommTemplate): Promise<void> {
  await runTursoPipeline(config, [...ddl(), ...upsertStatements(t)]);
}
export async function deleteTemplate(config: TursoConfig | null, id: string): Promise<void> {
  await runTursoPipeline(config, [...ddl(), ...deleteStatements(id)]);
}
export async function setDefaultTemplate(config: TursoConfig | null, category: CommTemplateCategory, id: string): Promise<void> {
  await runTursoPipeline(config, [...ddl(), ...setDefaultStatements(category, id)]);
}
```

- [ ] **Step 4: Run → PASS** + `npx tsc --noEmit`.
- [ ] **Step 5: Commit** — `git add src/app/comm-templates-schema.ts src/app/comm-templates-store.ts src/app/comm-templates-store.test.ts && git commit -m "feat: comm-templates Turso store (out of TABLE_NAMES)"`

---

### Task 4: `useCommTemplates()` hook

**Files:** Create `src/app/use-comm-templates.ts`, `src/app/use-comm-templates.test.tsx`.

- [ ] **Step 1: Write failing test** — render the hook (mock the store): inactive (active=false) → `templates` empty + `resolveTemplateBody("status-inquiry")` null; active with a default template loaded → `resolveTemplateBody` returns its body; non-default doesn't win.

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** — `use-comm-templates.ts` mirroring `use-snapshots.ts`'s active-gating (cfgRef, load effect, opSeq guard). Args: `{ active: boolean; config: TursoConfig | null }`. State: `templates: CommTemplate[]`. Load on mount when active. Expose `create(category,name,body)`, `rename`, `saveBody`, `remove`, `setDefault(category,id)` (each calls the store then updates state; `setDefault` uses `withDefault`), and:
```ts
const resolveTemplateBody = useCallback(
  (category: CommTemplateCategory): string | null => {
    if (!active) return null;
    const def = templates.find((t) => t.category === category && t.isDefault);
    return def ? def.body : null;
  },
  [active, templates],
);
```
Return `{ templates, busy, create, rename, saveBody, remove, setDefault, resolveTemplateBody, refresh }`. New ids: `${category}-${capturedAtISO}` (no `Date.now()` in render — generate in the handler at call time via `new Date().toISOString()`).

- [ ] **Step 4: Run → PASS** + `npx tsc --noEmit`.
- [ ] **Step 5: Commit** — `git add src/app/use-comm-templates.ts src/app/use-comm-templates.test.tsx && git commit -m "feat: useCommTemplates hook (Turso-gated) + resolveTemplateBody"`

---

### Task 5: Settings pane + rail entry + i18n

**Files:** Create `src/app/settings-sections/comm-templates-section.tsx`, its test; Modify `settings-view.tsx`, `i18n.ts`, `i18n.de.ts`.

- [ ] **Step 1: Write failing test** — render `CommTemplatesSection` with a fake `useCommTemplates` result (templates + handlers spies): create a template (calls `create`), select a category, click a merge-field chip → the textarea value gains `{{taskName}}`, click "Set as default" → calls `setDefault`. (Drive via props: the section takes the hook result + lang as props so it's testable without Turso.)

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** — `comm-templates-section.tsx`: props `{ lang, templates, onCreate, onRename, onSaveBody, onRemove, onSetDefault }`. UI: category `<select>` (the `COMM_TEMPLATE_CATEGORIES`, labels `commTplCat_<id>`); list of that category's templates (name + "Default" badge for `isDefault`); a selected template's `<textarea>` (body) with onChange → `onSaveBody`; rename input; delete + "Set as default" buttons; a merge-field palette — for `CATEGORY_FIELDS[category]`, render a chip `<button>` per field (label `commTplField_<field>`) that inserts `{{field}}` at the textarea cursor (track a ref + selectionStart). Empty state text `commTplEmpty`.
  In `settings-view.tsx`: add a `"comm-templates"` SectionId; a rail entry labelled `settingsSectionCommTemplates`, **Turso-gated** (only rendered when the Turso condition holds — reuse the same gate Trends/History use); render `<CommTemplatesSection {...} />` fed by the surface's `useCommTemplates()` (the surface owns the hook; pass its result down — or instantiate in the settings host that has Turso state).
  i18n EN+DE: `settingsSectionCommTemplates`, `commTplCat_statusInquiry`, `commTplCat_stakeholderUpdate`, `commTplField_*` (one per field across both categories), `commTplNew`, `commTplRename`, `commTplDelete`, `commTplSetDefault`, `commTplDefaultBadge`, `commTplBody`, `commTplEmpty`, `commTplName`.

- [ ] **Step 4: Run → PASS** + i18n-encoding + `npx tsc --noEmit` + `npm run lint`.
- [ ] **Step 5: Commit** — `git add src/app/settings-sections/comm-templates-section.tsx src/app/settings-sections/comm-templates-section.test.tsx src/app/settings-view.tsx src/app/i18n.ts src/app/i18n.de.ts && git commit -m "feat: communication templates settings pane (Turso-gated)"`

---

### Task 6: Send-flow wiring (use the default template, i18n fallback)

**Files:** Modify `use-task-row-handlers.ts`, `task-manager.tsx`; Test: extend `use-task-row-handlers.test.ts`.

- [ ] **Step 1: Write failing test** — `use-task-row-handlers.test.ts`: with `resolveTemplateBody` returning `"<p>Hi {{taskName}}</p>"`, `onSendInquiry(task)` sets `window.location.href` to a mailto whose body is the rendered+plain-texted template (assert the decoded body contains the rendered text, not the i18n template). With `resolveTemplateBody` absent/returning null → the existing i18n body is used (current assertion holds).

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement:**
  - `use-task-row-handlers.ts`: add `resolveTemplateBody?: (category: "status-inquiry") => string | null` to `UseTaskRowHandlersArgs`. In `onSendInquiry`, after resolving `email`, compute the body:
    ```ts
    const tplBody = args.resolveTemplateBody?.("status-inquiry") ?? null;
    const body = tplBody != null
      ? htmlToPlainText(renderTemplate(tplBody, "status-inquiry", buildStatusInquiryVars(task, lang)))
      : t(lang, "emailBodyTemplate", greeting, task.id, task.taskName, task.dueDate, task.lastUpdateDate);
    ```
    (Import `htmlToPlainText`, `renderTemplate`, `buildStatusInquiryVars`.) Subject + mailto build + `inquiriesSent` bump unchanged.
  - `task-manager.tsx`: instantiate `const commTemplates = useCommTemplates({ active: <turso-active>, config: tursoConfig });` (reuse the Trends/History `active` computation). Pass `resolveTemplateBody: commTemplates.resolveTemplateBody` into `useTaskRowHandlers({...})`. In `handleDraftMessageFromAction`'s stakeholder-update branch, before building the mailto, resolve the template:
    ```ts
    const tplBody = commTemplates.resolveTemplateBody("stakeholder-update");
    const body = tplBody != null
      ? htmlToPlainText(renderTemplate(tplBody, "stakeholder-update", buildStakeholderUpdateVars(sh, project?.name ?? "")))
      : t(lang, "commsEmailBodyTemplate", sh.name);
    ```
    (Import the helpers + `htmlToPlainText`.) Also wire `commTemplates`'s CRUD into the settings pane (Task 5's section).

- [ ] **Step 4: Run → PASS** + `npx tsc --noEmit` + `npm run lint`.
- [ ] **Step 5: Commit** — `git add src/app/use-task-row-handlers.ts src/app/task-manager.tsx src/app/use-task-row-handlers.test.ts && git commit -m "feat: send flows use the default comm template (i18n fallback)"`

---

### Task 7: Release — 0.88.0 "Niven"

**Files:** `version.ts`, `CHANGELOG.md`, `i18n.ts`, `i18n.de.ts`.

- [ ] **Step 1:** Full suite green: `npx vitest run && npx tsc --noEmit && npm run lint && npm run build`. If anything fails, STOP.
- [ ] **Step 2:** `version.ts`: `APP_VERSION="0.88.0"`, `APP_BUILD_DATE="2026-06-15"` (comment → comm templates SP1), `APP_MILESTONE="Niven"` (Larry Niven; JSDoc from 0.87.x "Wells"). Append `"versionHighlightCommTemplates"`.
- [ ] **Step 3:** EN: `versionHighlightCommTemplates: "Author named communication templates with merge fields (Turso) — your default is used automatically when you draft an email.",` DE (real umlauts; em-dash U+2014): `versionHighlightCommTemplates: "Benannte Kommunikationsvorlagen mit Platzhaltern verfassen (Turso) — die Standardvorlage wird beim Verfassen einer E-Mail automatisch verwendet.",` Verify bytes.
- [ ] **Step 4:** `CHANGELOG.md`: `## [0.88.0] - 2026-06-15 "Niven"` summarizing: communication templates SP1 — named, categorized templates stored in Turso with merge fields and a per-category default that the send flows use automatically (i18n fallback off-Turso); settings pane. Note SP2 (rich editor) / SP3 (versions) to come.
- [ ] **Step 5:** Verify + commit `git commit -m "chore: release 0.88.0 comm templates SP1"`.

---

## Final verification (before finishing)
```bash
npx vitest run && npx tsc --noEmit && npm run lint && npm run build
```
Then **superpowers:finishing-a-development-branch**. e2e axe gate runs in CI — the pane controls + merge-field chips must be labelled + keyboard-reachable.

## Self-Review

**Spec coverage:** model/categories/merge-fields (T1); html→text (T2); global Turso store out of TABLE_NAMES (T3); Turso-gated hook + resolveTemplateBody (T4); settings pane + rail gating (T5); send-wiring + i18n fallback (T6); release (T7). ✓
**Type consistency:** `CommTemplate`, `CommTemplateCategory`, `CATEGORY_FIELDS`, `renderTemplate(body,category,vars)`, `withDefault`, `buildStatusInquiryVars`/`buildStakeholderUpdateVars`, `htmlToPlainText`, store fns `loadTemplates/upsertTemplate/deleteTemplate/setDefaultTemplate`, `resolveTemplateBody(category)` — used identically across tasks.
**Adapt-to-existing notes (not placeholders):** `greetingName`'s import module (grep), `rowsToTemplates` row-access shape (match `snapshot-schema.rowsToSnapshots`), and the Trends/History Turso-`active` expression to reuse — each is a named, locatable anchor, not vague.
