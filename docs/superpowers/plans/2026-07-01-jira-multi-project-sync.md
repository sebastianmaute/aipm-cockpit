# Additive Multi-Project Jira Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user sync issues from multiple Jira projects, keeping one two-way "primary" project and adding opt-in extra projects each with a per-project read-only toggle.

**Architecture:** A new dependency-light pure module `jira-projects.ts` holds the project-key helpers + the extra-projects sanitizer (so `use-settings`, the badge, and the settings UI can import them without dragging in the lazy-loaded `jira-api.ts`). `buildJql` unions all project keys. The sync loop classifies each linked row via `isReadOnlyIssue` and pulls-only (remote-wins/revert) for read-only projects. UI telegraphs read-only via a distinct badge variant plus an editor banner.

**Tech Stack:** Next.js (forked) / React / TypeScript, Vitest + Testing Library, Tailwind v4 AIPM tokens. i18n EN (`i18n.ts`) + DE (`i18n.de.ts`, patched via node utf8 write — the Edit tool corrupts that file).

**Spec:** `docs/superpowers/specs/2026-07-01-jira-multi-project-sync-design.md`

---

## File Structure

- **Create** `src/app/jira-projects.ts` — pure, dep-light: `JiraExtraProject` re-export is NOT here (type lives in `settings-types.ts`); this holds `jiraProjectKeyOf`, `jiraProjectKeys`, `isReadOnlyIssue`, `sanitizeJiraExtraProjects`.
- **Create** `src/app/jira-projects.test.ts` — unit tests for the above.
- **Create** `src/app/jira-readonly-banner.tsx` — presentational banner shared by both editor surfaces.
- **Modify** `src/app/settings-types.ts` — `JiraExtraProject` type + `JiraConfig.extraProjects` + default.
- **Modify** `src/app/use-settings.ts` — sanitize `extraProjects` on load.
- **Modify** `src/app/jira-api.ts` — `buildJql` unions keys via `jiraProjectKeys`.
- **Modify** `src/app/use-jira-sync.ts` — read-only classification (never push, revert, no conflict) + per-issue group.
- **Modify** `src/app/i18n.ts` + `src/app/i18n.de.ts` — new keys.
- **Modify** `src/app/task-jira-badge.tsx` (+ `.test.tsx`) — `readOnlyProject` prop + wording.
- **Modify** `src/app/task-row.tsx`, `src/app/tasks-section.tsx`, `src/app/task-kanban-board.tsx`, `src/app/task-kanban-card.tsx`, `src/app/task-manager.tsx` — thread the read-only flag.
- **Modify** `src/app/task-edit-view.tsx`, `src/app/task-form-modal.tsx` — editor banner slot.
- **Modify** `src/app/jira-settings.tsx` — extra-projects settings block.

---

## Task 1: Pure `jira-projects.ts` helpers

**Files:**
- Create: `src/app/jira-projects.ts`
- Test: `src/app/jira-projects.test.ts`
- Modify (type dependency, do Step 0 first): `src/app/settings-types.ts`

- [ ] **Step 0: Add the `JiraExtraProject` type + field so the helpers compile**

In `src/app/settings-types.ts`, immediately above `export type JiraConfig = {` (line ~131) add:

```ts
export type JiraExtraProject = {
  /** Jira project key, e.g. "OPS". */
  key: string;
  /** Display name (cached for UI). */
  name: string;
  /** true = watch/read-only (never push); false = two-way like the primary. */
  readOnly: boolean;
};
```

Inside `JiraConfig`, directly after the `projectName: string;` line (~140) add:

```ts
  /** Additional projects to READ (union into the sync JQL). The primary
   *  `projectKey` stays the two-way create target. Each carries its own
   *  read-only flag; default read-only ON. */
  extraProjects: JiraExtraProject[];
```

In `defaultJiraConfig`, directly after `projectName: "",` (~159) add:

```ts
  extraProjects: [],
```

- [ ] **Step 1: Write the failing test**

Create `src/app/jira-projects.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  jiraProjectKeyOf,
  jiraProjectKeys,
  isReadOnlyIssue,
  sanitizeJiraExtraProjects,
} from "./jira-projects";
import { defaultJiraConfig, type JiraConfig } from "./settings-types";

function cfg(over: Partial<JiraConfig>): JiraConfig {
  return { ...defaultJiraConfig, ...over };
}

describe("jiraProjectKeyOf", () => {
  it("returns the substring before the first hyphen", () => {
    expect(jiraProjectKeyOf("OPS-123")).toBe("OPS");
    expect(jiraProjectKeyOf("ABC2-9")).toBe("ABC2");
  });
  it("returns the whole string when there is no hyphen", () => {
    expect(jiraProjectKeyOf("NOPE")).toBe("NOPE");
  });
});

describe("jiraProjectKeys", () => {
  it("returns just the primary when there are no extras", () => {
    expect(jiraProjectKeys(cfg({ projectKey: "LOP" }))).toEqual(["LOP"]);
  });
  it("unions primary + extras, deduped, empties dropped", () => {
    const c = cfg({
      projectKey: "LOP",
      extraProjects: [
        { key: "OPS", name: "Ops", readOnly: true },
        { key: "LOP", name: "dup", readOnly: false },
        { key: "", name: "blank", readOnly: true },
      ],
    });
    expect(jiraProjectKeys(c)).toEqual(["LOP", "OPS"]);
  });
  it("returns [] when the primary is blank and there are no extras", () => {
    expect(jiraProjectKeys(cfg({ projectKey: "" }))).toEqual([]);
  });
});

describe("isReadOnlyIssue", () => {
  const c = cfg({
    projectKey: "LOP",
    extraProjects: [
      { key: "OPS", name: "Ops", readOnly: true },
      { key: "DEV", name: "Dev", readOnly: false },
    ],
  });
  it("primary project is never read-only", () => {
    expect(isReadOnlyIssue("LOP-1", c)).toBe(false);
  });
  it("read-only extra project is read-only", () => {
    expect(isReadOnlyIssue("OPS-1", c)).toBe(true);
  });
  it("two-way extra project is not read-only", () => {
    expect(isReadOnlyIssue("DEV-1", c)).toBe(false);
  });
  it("unrecognized project defaults to read-only", () => {
    expect(isReadOnlyIssue("XXX-1", c)).toBe(true);
  });
});

describe("sanitizeJiraExtraProjects", () => {
  it("returns [] for non-array input", () => {
    expect(sanitizeJiraExtraProjects(undefined, "LOP")).toEqual([]);
    expect(sanitizeJiraExtraProjects("nope", "LOP")).toEqual([]);
  });
  it("keeps valid entries, defaults missing readOnly to true", () => {
    const out = sanitizeJiraExtraProjects(
      [{ key: "OPS", name: "Ops" }],
      "LOP",
    );
    expect(out).toEqual([{ key: "OPS", name: "Ops", readOnly: true }]);
  });
  it("coerces readOnly to a real boolean", () => {
    const out = sanitizeJiraExtraProjects(
      [{ key: "OPS", name: "Ops", readOnly: false }],
      "LOP",
    );
    expect(out[0].readOnly).toBe(false);
  });
  it("drops the primary, duplicates, blank/invalid keys", () => {
    const out = sanitizeJiraExtraProjects(
      [
        { key: "LOP", name: "primary", readOnly: true },
        { key: "OPS", name: "Ops", readOnly: true },
        { key: "OPS", name: "dup", readOnly: false },
        { key: "", name: "blank", readOnly: true },
        { key: "BAD KEY", name: "space", readOnly: true },
      ],
      "LOP",
    );
    expect(out).toEqual([{ key: "OPS", name: "Ops", readOnly: true }]);
  });
  it("caps the list at 20 entries", () => {
    const many = Array.from({ length: 30 }, (_, i) => ({
      key: `P${i}`,
      name: `p${i}`,
      readOnly: true,
    }));
    expect(sanitizeJiraExtraProjects(many, "LOP")).toHaveLength(20);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/app/jira-projects.test.ts`
Expected: FAIL — `Cannot find module './jira-projects'`.

- [ ] **Step 3: Write the implementation**

Create `src/app/jira-projects.ts`:

```ts
// src/app/jira-projects.ts
//
// Pure, dependency-light helpers for the multi-project Jira sync. Kept OUT of
// jira-api.ts (which is lazy-loaded to stay off the boot bundle) so use-settings,
// the task badge, and the settings UI can import them cheaply at boot.
import type { JiraConfig, JiraExtraProject } from "./settings-types";

/** Jira issue keys are "<PROJECTKEY>-<number>"; project keys never contain "-". */
export function jiraProjectKeyOf(issueKey: string): string {
  const i = issueKey.indexOf("-");
  return i < 0 ? issueKey : issueKey.slice(0, i);
}

/** Deduped union of the primary project key + every extra project key, with
 *  empty strings removed. Primary comes first. */
export function jiraProjectKeys(
  config: Pick<JiraConfig, "projectKey" | "extraProjects">,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (k: string) => {
    if (k && !seen.has(k)) {
      seen.add(k);
      out.push(k);
    }
  };
  push(config.projectKey);
  for (const p of config.extraProjects ?? []) push(p.key);
  return out;
}

/** primary -> false; extra project -> its readOnly flag; unrecognized -> true
 *  (never write to a project we don't recognize). */
export function isReadOnlyIssue(
  issueKey: string,
  config: Pick<JiraConfig, "projectKey" | "extraProjects">,
): boolean {
  const project = jiraProjectKeyOf(issueKey);
  if (project === config.projectKey) return false;
  const extra = (config.extraProjects ?? []).find((p) => p.key === project);
  return extra ? extra.readOnly : true;
}

const KEY_RE = /^[A-Za-z0-9_]+$/;
const MAX_EXTRA_PROJECTS = 20;
const NAME_MAX = 120;

/** Validate the persisted extraProjects array from untrusted storage. Drops
 *  malformed/blank/invalid keys, the primary key, and duplicates; defaults a
 *  missing readOnly to true; caps the count. Keys are charset-restricted because
 *  they flow into JQL. */
export function sanitizeJiraExtraProjects(
  raw: unknown,
  primaryKey: string,
): JiraExtraProject[] {
  if (!Array.isArray(raw)) return [];
  const out: JiraExtraProject[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const key = typeof rec.key === "string" ? rec.key.trim() : "";
    if (!key || key.length > 64 || !KEY_RE.test(key)) continue;
    if (key === primaryKey || seen.has(key)) continue;
    seen.add(key);
    const name =
      typeof rec.name === "string" ? rec.name.trim().slice(0, NAME_MAX) : "";
    const readOnly = rec.readOnly === undefined ? true : rec.readOnly === true;
    out.push({ key, name, readOnly });
    if (out.length >= MAX_EXTRA_PROJECTS) break;
  }
  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/app/jira-projects.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/app/jira-projects.ts src/app/jira-projects.test.ts src/app/settings-types.ts
git commit -m "feat(jira): add multi-project key helpers + extraProjects config field"
```

---

## Task 2: Sanitize `extraProjects` on settings load

**Files:**
- Modify: `src/app/use-settings.ts:223-226`
- Test: `src/app/use-settings.secrets.test.ts` (add a case) OR a new `src/app/use-settings.jira.test.ts`

> Rationale: `JiraConfig` is loaded with a bare `{ ...defaultSettings.jira, ...parsed.jira }` — no sanitizer. `extraProjects` is untrusted (keys flow into JQL) so it must be sanitized here.

- [ ] **Step 1: Write the failing test**

Create `src/app/use-settings.jira.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { sanitizeJiraExtraProjects } from "./jira-projects";

// The load path applies sanitizeJiraExtraProjects to the merged jira config.
// This test pins that a corrupt stored array is cleaned against the primary key.
describe("jira extraProjects load sanitization", () => {
  it("drops the primary-colliding + invalid entries", () => {
    const raw = [
      { key: "LOP", name: "primary", readOnly: true },
      { key: "OPS", name: "Ops" },
      { key: "x y", name: "bad", readOnly: true },
    ];
    expect(sanitizeJiraExtraProjects(raw, "LOP")).toEqual([
      { key: "OPS", name: "Ops", readOnly: true },
    ]);
  });
});
```

(The pure helper is already covered in Task 1; this test documents the load-path contract. The wiring below is verified by `tsc` + the existing settings load tests.)

- [ ] **Step 2: Run it to confirm it passes against the helper**

Run: `npx vitest run src/app/use-settings.jira.test.ts`
Expected: PASS.

- [ ] **Step 3: Wire the sanitizer into the load merge**

In `src/app/use-settings.ts`, add the import near the other local imports (top of file, after the existing imports):

```ts
import { sanitizeJiraExtraProjects } from "./jira-projects";
```

Replace the `jira:` block at lines 223-226:

```ts
            jira: {
              ...defaultSettings.jira,
              ...(isPlainObject(parsed.jira) ? parsed.jira : {}),
            },
```

with:

```ts
            jira: (() => {
              const merged = {
                ...defaultSettings.jira,
                ...(isPlainObject(parsed.jira) ? parsed.jira : {}),
              };
              return {
                ...merged,
                extraProjects: sanitizeJiraExtraProjects(
                  merged.extraProjects,
                  merged.projectKey,
                ),
              };
            })(),
```

- [ ] **Step 4: Run the settings suite + typecheck**

Run: `npx vitest run src/app/use-settings.secrets.test.ts src/app/use-settings.jira.test.ts`
Expected: PASS.
Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/app/use-settings.ts src/app/use-settings.jira.test.ts
git commit -m "feat(jira): sanitize extraProjects on settings load"
```

---

## Task 3: `buildJql` unions all project keys

**Files:**
- Modify: `src/app/jira-api.ts:159-178` (`buildJql`)
- Test: `src/app/jira-api.test.ts` (add cases; file already exists per the codebase)

- [ ] **Step 1: Write the failing test**

Add to `src/app/jira-api.test.ts` (import `buildJql` if not already imported, and `defaultJiraConfig`):

```ts
import { buildJql } from "./jira-api";
import { defaultJiraConfig } from "./settings-types";

describe("buildJql multi-project", () => {
  it("emits `project = \"K\"` for a single project (byte-identical to before)", () => {
    const jql = buildJql({ ...defaultJiraConfig, projectKey: "LOP", assigneeMode: "any", issueTypes: [] });
    expect(jql).toBe('project = "LOP" ORDER BY updated DESC');
  });
  it("emits `project in (...)` for primary + extras", () => {
    const jql = buildJql({
      ...defaultJiraConfig,
      projectKey: "LOP",
      assigneeMode: "any",
      issueTypes: [],
      extraProjects: [
        { key: "OPS", name: "Ops", readOnly: true },
        { key: "DEV", name: "Dev", readOnly: false },
      ],
    });
    expect(jql).toBe('project in ("LOP", "OPS", "DEV") ORDER BY updated DESC');
  });
  it("returns null when no project is set", () => {
    expect(buildJql({ ...defaultJiraConfig, projectKey: "" })).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/app/jira-api.test.ts -t "buildJql multi-project"`
Expected: FAIL — the multi-project case still emits `project = "LOP"` only.

- [ ] **Step 3: Implement**

In `src/app/jira-api.ts`, add near the top imports:

```ts
import { jiraProjectKeys } from "./jira-projects";
```

Replace the head of `buildJql` (lines 159-161):

```ts
export function buildJql(config: JiraConfig): string | null {
  if (!config.projectKey) return null;
  const parts: string[] = [`project = "${escapeJqlString(config.projectKey)}"`];
```

with:

```ts
export function buildJql(config: JiraConfig): string | null {
  const keys = jiraProjectKeys(config);
  if (keys.length === 0) return null;
  const projectClause =
    keys.length === 1
      ? `project = "${escapeJqlString(keys[0])}"`
      : `project in (${keys.map((k) => `"${escapeJqlString(k)}"`).join(", ")})`;
  const parts: string[] = [projectClause];
```

(The rest of `buildJql` — assignee, issuetype, `ORDER BY` — is unchanged.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/app/jira-api.test.ts`
Expected: PASS (including the pre-existing single-project cases).

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit`  → exit 0.

```bash
git add src/app/jira-api.ts src/app/jira-api.test.ts
git commit -m "feat(jira): union all project keys into the sync JQL"
```

---

## Task 4: Read-only handling in the sync loop

**Files:**
- Modify: `src/app/use-jira-sync.ts` (per-row branch ~111-216; create loop ~218-246)
- Test: `src/app/use-jira-sync.test.tsx` (add cases)

- [ ] **Step 1: Write the failing test**

Add to `src/app/use-jira-sync.test.tsx` a describe block that renders the hook (follow the file's existing harness/mocks for `loadJiraApi`) and asserts:

```ts
// Pseudocode-shaped against the file's existing test harness — mirror how the
// existing tests mock jira-api and drive handleJiraSync.
describe("read-only project sync", () => {
  it("reverts a locally-changed read-only-project task without pushing", async () => {
    // Arrange: settings.jira.projectKey = "LOP";
    //   extraProjects = [{ key: "OPS", name: "Ops", readOnly: true }].
    // A local task { jiraKey: "OPS-1", taskName: "local edit",
    //   localModifiedAt > lastSyncedAt } (locally changed).
    // Mock searchAllIssues -> [{ key: "OPS-1", fields: { summary: "remote name",
    //   updated: <= lastSyncedAt } }] (remote unchanged).
    // Act: run handleJiraSync.
    // Assert: updateIssue was NOT called; the resulting task.taskName === "remote name"
    //   (reverted) and localModifiedAt is cleared.
    expect(updateIssueMock).not.toHaveBeenCalled();
  });

  it("never queues a conflict for a read-only-project task", async () => {
    // Arrange: same as above but BOTH remoteUpdated > lastSync AND localMod > lastSync.
    // Act: run handleJiraSync.
    // Assert: jiraConflicts stays empty; updateIssue NOT called; task fields == remote.
    expect(updateIssueMock).not.toHaveBeenCalled();
  });

  it("still pushes a locally-changed two-way (primary) task", async () => {
    // Regression: a "LOP-1" task locally changed with remote unchanged -> updateIssue IS called.
    expect(updateIssueMock).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/app/use-jira-sync.test.tsx -t "read-only project sync"`
Expected: FAIL — read-only rows currently push (updateIssue called) / raise conflicts.

- [ ] **Step 3: Implement the read-only branch**

In `src/app/use-jira-sync.ts`, add the import at the top:

```ts
import { isReadOnlyIssue, jiraProjectKeyOf } from "./jira-projects";
```

Inside `handleJiraSync`, in the `for (const row of list)` loop, AFTER the block that computes `remoteChanged` / `localChanged` (right before `if (remoteChanged && localChanged) {` at ~line 128), insert:

```ts
        // Read-only project: never push/transition, never queue a conflict.
        // Remote is authoritative — pull (reverting any stray local edit) or
        // just refresh the stamp when nothing moved.
        if (isReadOnlyIssue(row.jiraKey, jiraCfg)) {
          if (remoteChanged || localChanged) {
            const patch = issueToTaskFields(issue, todayNow);
            pulled++;
            next.push({
              ...row,
              taskName: patch.taskName ?? row.taskName,
              assignee: patch.assignee ?? row.assignee,
              assigneeEmail: patch.assigneeEmail ?? row.assigneeEmail,
              dueDate: patch.dueDate ?? row.dueDate,
              lastUpdateDate: patch.lastUpdateDate ?? row.lastUpdateDate,
              priority: patch.priority ?? row.priority,
              labels: patch.labels ?? row.labels,
              notes: patch.notes ?? row.notes,
              status: patch.status,
              completedDate: patch.completedDate,
              jiraKey: issue.key,
              jiraIssueType: patch.jiraIssueType ?? row.jiraIssueType,
              localModifiedAt: undefined,
              lastSyncedAt: syncStamp,
            });
          } else {
            next.push({ ...row, lastSyncedAt: syncStamp });
          }
          continue;
        }
```

- [ ] **Step 4: Per-issue group in the create loop**

In the "New Jira issues we didn't have locally → create" loop (~218-246), replace the `group:` line:

```ts
          group: jiraCfg.projectName || jiraCfg.projectKey || "",
```

with:

```ts
          group: (() => {
            const proj = jiraProjectKeyOf(issue.key);
            if (proj === jiraCfg.projectKey) return jiraCfg.projectName || jiraCfg.projectKey || "";
            return jiraCfg.extraProjects.find((p) => p.key === proj)?.name || proj;
          })(),
```

- [ ] **Step 5: Defensive guard in conflict resolution**

In `handleResolveConflicts`, inside the `for (const res of resolutions)` loop, right after `if (!original || !conflict) continue;` add:

```ts
      // Read-only projects never push, even if a stale conflict resolution asks to.
      if (isReadOnlyIssue(conflict.jiraKey, jiraCfg)) continue;
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/app/use-jira-sync.test.tsx`
Expected: PASS (new read-only cases + existing regression cases).

- [ ] **Step 7: Typecheck + commit**

Run: `npx tsc --noEmit`  → exit 0.

```bash
git add src/app/use-jira-sync.ts src/app/use-jira-sync.test.tsx
git commit -m "feat(jira): read-only projects sync pull-only (revert, no push, no conflict)"
```

---

## Task 5: i18n keys (EN + DE)

**Files:**
- Modify: `src/app/i18n.ts`
- Modify: `src/app/i18n.de.ts` (via node utf8 write — NOT the Edit tool)

- [ ] **Step 1: Add the EN keys**

In `src/app/i18n.ts`, next to the existing Jira keys (near `integrationsTursoUrlTooltip` region is Turso; find the Jira block — e.g. near `jiraProject`/`jiraSyncedReadOnly`), add:

```ts
  jiraExtraProjectsLabel: "Also sync from other projects",
  jiraExtraProjectsHint: "The primary project above stays two-way. Extra projects are read-only by default (watch only); switch one to two-way to push edits back.",
  jiraExtraProjectInclude: "Include",
  jiraReadOnly: "Read-only",
  jiraTwoWay: "Two-way",
  jiraSyncedTwoWay: "Synced with Jira (two-way)",
  jiraSyncedReadOnlyProject: "Watched from Jira — read-only",
  jiraReadOnlyBanner: "Read-only — watched from Jira project {0}. Changes here won't be saved and revert on next sync.",
```

> Note: this is a NEW key, distinct from the pre-existing `jiraSyncedReadOnly`
> (whose text is about the drag/status lock — do NOT repurpose it).

- [ ] **Step 2: Run tsc to confirm the DE side is now required (parity)**

Run: `npx tsc --noEmit`
Expected: FAIL — DE dictionary is missing the 7 new keys (i18n parity is tsc-enforced).

- [ ] **Step 3: Add the DE keys via node**

Run this exact command (from repo root):

```bash
node -e '
const fs=require("fs");
const p="src/app/i18n.de.ts";
let s=fs.readFileSync(p,"utf8");
const anchor="  jiraSyncedReadOnly:";
const idx=s.indexOf(anchor);
if(idx<0){console.error("ANCHOR NOT FOUND");process.exit(1);}
const block=[
  "  jiraExtraProjectsLabel: \"Auch aus anderen Projekten synchronisieren\",",
  "  jiraExtraProjectsHint: \"Das prim\\u00e4re Projekt oben bleibt bidirektional. Zusatzprojekte sind standardm\\u00e4\\u00dfig schreibgesch\\u00fctzt (nur beobachten); stelle eines auf bidirektional, um \\u00c4nderungen zur\\u00fcckzuschreiben.\",",
  "  jiraExtraProjectInclude: \"Einbeziehen\",",
  "  jiraReadOnly: \"Schreibgesch\\u00fctzt\",",
  "  jiraTwoWay: \"Bidirektional\",",
  "  jiraSyncedTwoWay: \"Mit Jira synchronisiert (bidirektional)\",",
  "  jiraSyncedReadOnlyProject: \"Aus Jira beobachtet \\u2013 schreibgesch\\u00fctzt\",",
  "  jiraReadOnlyBanner: \"Schreibgesch\\u00fctzt \\u2013 beobachtet aus Jira-Projekt {0}. \\u00c4nderungen hier werden nicht gespeichert und beim n\\u00e4chsten Sync verworfen.\",",
  "",
].join("\r\n");
s=s.slice(0,idx)+block+s.slice(idx);
fs.writeFileSync(p,s,"utf8");
console.log("OK");
'
```

Expected: `OK`.

- [ ] **Step 4: Verify DE keys + parity**

Run: `npx tsc --noEmit`
Expected: exit 0 (parity satisfied).

Verify no curly-quote/umlaut corruption:

Run: `git diff -- src/app/i18n.de.ts` and confirm the 7 lines have straight `"` quotes and real umlauts (ä/ö/ü/ß).

- [ ] **Step 5: Commit**

```bash
git add src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat(jira): i18n for multi-project + read-only telegraph"
```

---

## Task 6: Badge read-only variant

**Files:**
- Modify: `src/app/task-jira-badge.tsx`
- Test: `src/app/task-jira-badge.test.tsx`

- [ ] **Step 1: Update the tests**

Replace `src/app/task-jira-badge.test.tsx` body assertions to cover both variants. The badge now takes `readOnlyProject` (default `false` = two-way). Add/adjust:

```ts
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { JiraBadge } from "./task-jira-badge";

describe("JiraBadge", () => {
  it("renders the key text", () => {
    render(<JiraBadge jiraKey="ABC-123" lang="en-US" />);
    expect(screen.getByText("ABC-123")).toBeInTheDocument();
  });

  it("two-way (default) uses the two-way accessible name", () => {
    render(<JiraBadge jiraKey="ABC-123" lang="en-US" />);
    expect(screen.getByLabelText("Synced with Jira (two-way)")).toBeInTheDocument();
  });

  it("read-only project uses the read-only accessible name", () => {
    render(<JiraBadge jiraKey="ABC-123" lang="en-US" readOnlyProject />);
    expect(screen.getByLabelText(/read-only/i)).toBeInTheDocument();
  });

  it("link variant keeps href + accessible name", () => {
    render(
      <JiraBadge jiraKey="ABC-123" lang="en-US" readOnlyProject href="https://x.atlassian.net/browse/ABC-123" />,
    );
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "https://x.atlassian.net/browse/ABC-123");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/app/task-jira-badge.test.tsx`
Expected: FAIL — the two-way label `"Synced with Jira (two-way)"` isn't rendered yet (badge always says read-only).

- [ ] **Step 3: Implement the variant**

In `src/app/task-jira-badge.tsx`:

Add a `readOnlyProject` prop to the interface (after `issueType?: string;`):

```ts
  /** true = the issue's project is read-only (watch); false = two-way. Drives the
   *  glyph + tooltip wording. Defaults to two-way. */
  readOnlyProject?: boolean;
```

Add a sync glyph constant next to `lockIcon`:

```ts
// Two circular arrows — signals a two-way synced link (vs the read-only padlock).
const syncIcon: ReactNode = (
  <svg
    aria-hidden="true"
    viewBox="0 0 24 24"
    className="inline-block h-2.5 w-2.5 mr-0.5 align-[-1px]"
    fill="currentColor"
  >
    <path d="M12 4V1L8 5l4 4V6a6 6 0 0 1 6 6h2a8 8 0 0 0-8-8zm-6 8H4a8 8 0 0 0 8 8v3l4-4-4-4v3a6 6 0 0 1-6-6z" />
  </svg>
);
```

Rewrite `JiraBadgeImpl` to branch on `readOnlyProject`:

```ts
function JiraBadgeImpl({ jiraKey, lang, href, issueType, readOnlyProject = false }: JiraBadgeProps) {
  const label = t(lang, readOnlyProject ? "jiraSyncedReadOnlyProject" : "jiraSyncedTwoWay");
  const glyph = readOnlyProject ? lockIcon : syncIcon;

  if (href) {
    const title = issueType ? `${jiraKey} (${issueType}) — ${label}` : `${jiraKey} — ${label}`;
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        title={title}
        aria-label={label}
        className={`${BADGE_CLASS} hover:underline ${INTERACTIVE}`}
      >
        {glyph}
        {jiraKey}
      </a>
    );
  }

  return (
    <span title={label} aria-label={label} className={BADGE_CLASS}>
      {glyph}
      {jiraKey}
    </span>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/app/task-jira-badge.test.tsx`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit`  → exit 0.

```bash
git add src/app/task-jira-badge.tsx src/app/task-jira-badge.test.tsx
git commit -m "feat(jira): badge distinguishes read-only (watch) from two-way sync"
```

---

## Task 7: Thread the read-only flag to badge call sites

**Files:**
- Modify: `src/app/task-manager.tsx` (compute `jiraReadOnlyKeys`; pass to tasks-section)
- Modify: `src/app/tasks-section.tsx` (prop → RowContextValue + `<TaskKanban>`)
- Modify: `src/app/task-row.tsx` (RowContextValue field + badge caller)
- Modify: `src/app/task-kanban-board.tsx` (prop → card)
- Modify: `src/app/task-kanban-card.tsx` (prop → badge)
- Test: `src/app/task-row.test.tsx`, `src/app/tasks-section.test.tsx` (add `jiraReadOnlyKeys: []` to their render props); `src/app/task-kanban-card.test.tsx` if it renders the card directly.

- [ ] **Step 1: Compute the keys in task-manager**

In `src/app/task-manager.tsx`, after `const editingIsJiraLinked = !!editingTask?.jiraKey;` (line 1685) add:

```ts
  // Keys of extra projects flagged read-only — drives the badge/editor telegraph.
  const jiraReadOnlyKeys = (settings.jira.extraProjects ?? [])
    .filter((p) => p.readOnly)
    .map((p) => p.key);
```

Then in the `<TasksSection .../>` prop list, right after `jiraSiteUrl={settings.jira.siteUrl}` (line 1896) add:

```tsx
      jiraReadOnlyKeys={jiraReadOnlyKeys}
```

- [ ] **Step 2: Thread through tasks-section**

In `src/app/tasks-section.tsx`, add to the props interface next to `jiraSiteUrl: string;` (line 61):

```ts
  jiraReadOnlyKeys: readonly string[];
```

Destructure it next to `jiraSiteUrl,` (line 122):

```ts
  jiraReadOnlyKeys,
```

Add to the `rowContextValue` object next to `jiraSiteUrl,` (line 202) AND to its dep array next to `jiraSiteUrl,` (line 221):

```ts
      jiraReadOnlyKeys,
```

Pass it into `<TaskKanban>` (after `holidaySet={holidaySet}` at line 554):

```tsx
          jiraReadOnlyKeys={jiraReadOnlyKeys}
```

- [ ] **Step 3: Thread through task-row + compute the flag**

In `src/app/task-row.tsx`:

Add to `RowContextValue` after `jiraProjectKey: string;` (line 24):

```ts
  jiraReadOnlyKeys: readonly string[];
```

Add the import at the top:

```ts
import { jiraProjectKeyOf } from "./jira-projects";
```

Destructure `jiraReadOnlyKeys` from the context read at line 157 area (add next to `jiraSiteUrl,`).

Replace the badge render (lines 224-232) with:

```tsx
          return (
            <span className="ml-1">
              <JiraBadge
                jiraKey={task.jiraKey}
                lang={lang}
                href={href}
                issueType={task.jiraIssueType}
                readOnlyProject={jiraReadOnlyKeys.includes(jiraProjectKeyOf(task.jiraKey))}
              />
            </span>
          );
```

- [ ] **Step 4: Thread through the kanban board + card**

In `src/app/task-kanban-board.tsx`:

Add to `TaskKanbanProps` after `holidaySet?: Set<string>;` (line 22):

```ts
  /** Keys of read-only Jira projects — drives the per-card badge variant. */
  jiraReadOnlyKeys?: readonly string[];
```

Add to the destructure with a default (after `holidaySet = EMPTY_HOLIDAYS,` line 44):

```ts
  jiraReadOnlyKeys = EMPTY_READONLY_KEYS,
```

Add the module const near `EMPTY_HOLIDAYS` (line 37):

```ts
const EMPTY_READONLY_KEYS: readonly string[] = [];
```

Add the import at the top:

```ts
import { jiraProjectKeyOf } from "./jira-projects";
```

In the `<TaskKanbanCard ...>` render (line 87), add the prop:

```tsx
                    readOnlyProject={!!task.jiraKey && jiraReadOnlyKeys.includes(jiraProjectKeyOf(task.jiraKey))}
```

In `src/app/task-kanban-card.tsx`:

Add to `TaskKanbanCardProps` after `onJumpToRaid` (line 25):

```ts
  readOnlyProject?: boolean;
```

Destructure it (after `onJumpToRaid,` line 37):

```ts
  readOnlyProject,
```

Pass it to the badge (line 73):

```tsx
        {task.jiraKey && <JiraBadge jiraKey={task.jiraKey} lang={lang} readOnlyProject={readOnlyProject} />}
```

- [ ] **Step 5: Fix the test render props**

In `src/app/task-row.test.tsx` (line 53 area) and `src/app/tasks-section.test.tsx` (line 113 area), add to the row-context / props object next to `jiraSiteUrl: "",`:

```ts
    jiraReadOnlyKeys: [],
```

- [ ] **Step 6: Run the affected suites + typecheck**

Run: `npx vitest run src/app/task-row.test.tsx src/app/tasks-section.test.tsx src/app/task-kanban-card.test.tsx src/app/task-kanban.component.test.tsx`
Expected: PASS.
Run: `npx tsc --noEmit`
Expected: exit 0 (this catches any test-only render site still missing `jiraReadOnlyKeys`).

- [ ] **Step 7: Commit**

```bash
git add src/app/task-manager.tsx src/app/tasks-section.tsx src/app/task-row.tsx src/app/task-kanban-board.tsx src/app/task-kanban-card.tsx src/app/task-row.test.tsx src/app/tasks-section.test.tsx
git commit -m "feat(jira): thread read-only-project flag to table + kanban badges"
```

---

## Task 8: Editor read-only banner

**Files:**
- Create: `src/app/jira-readonly-banner.tsx`
- Test: `src/app/jira-readonly-banner.test.tsx`
- Modify: `src/app/task-edit-view.tsx`, `src/app/task-form-modal.tsx`
- Modify: `src/app/task-manager.tsx` (compute + pass `readOnlyJiraProjectName` to both surfaces)

- [ ] **Step 1: Write the failing test**

Create `src/app/jira-readonly-banner.test.tsx`:

```ts
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { JiraReadOnlyBanner } from "./jira-readonly-banner";

describe("JiraReadOnlyBanner", () => {
  it("names the project and warns edits won't save", () => {
    render(<JiraReadOnlyBanner lang="en-US" projectName="Ops" />);
    expect(screen.getByText(/Ops/)).toBeInTheDocument();
    expect(screen.getByRole("note")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/app/jira-readonly-banner.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the banner**

Create `src/app/jira-readonly-banner.tsx`:

```tsx
"use client";
// src/app/jira-readonly-banner.tsx — shown atop the task editor when the task's
// Jira project is read-only (watch only). Palette-safe AIPM tokens.
import { type Lang, t } from "./i18n";

export function JiraReadOnlyBanner({ lang, projectName }: { lang: Lang; projectName: string }) {
  return (
    <div
      role="note"
      className="rounded-md border border-AIPM-amber/40 bg-AIPM-amber/10 px-3 py-2 text-xs text-foreground"
    >
      {t(lang, "jiraReadOnlyBanner", projectName)}
    </div>
  );
}
```

> Palette note: `AIPM-amber` is a sanctioned token. If lint/palette-sweep flags the exact class, fall back to `border-line bg-surface-muted text-muted-foreground` (still clearly a banner). Verify by eye that it reads as a warning.

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/app/jira-readonly-banner.test.tsx`
Expected: PASS.

- [ ] **Step 5: Add the slot to `TaskEditView`**

In `src/app/task-edit-view.tsx`:

Add the import:

```ts
import { JiraReadOnlyBanner } from "./jira-readonly-banner";
```

Add to `TaskEditViewProps` (after `onClose?: () => void;`):

```ts
  /** When set, the task's Jira project is read-only; show a warning banner. */
  readOnlyJiraProjectName?: string;
```

Destructure it in the component signature so it is NOT spread into `TaskFormFields`:

```ts
export function TaskEditView({ onSubmit, footer, footerLeading, heading, onClose, readOnlyJiraProjectName, ...fieldProps }: TaskEditViewProps) {
```

Render it directly above `<TaskFormFields {...fieldProps} />` (line 60):

```tsx
          {readOnlyJiraProjectName && (
            <JiraReadOnlyBanner lang={lang} projectName={readOnlyJiraProjectName} />
          )}
          <TaskFormFields {...fieldProps} />
```

- [ ] **Step 6: Add the slot to `TaskFormModal`**

In `src/app/task-form-modal.tsx`:

Add the import:

```ts
import { JiraReadOnlyBanner } from "./jira-readonly-banner";
```

Add to `TaskFormModalProps` (after `deleteAction?: ReactNode;`):

```ts
  /** When set, the task's Jira project is read-only; show a warning banner. */
  readOnlyJiraProjectName?: string;
```

Destructure `readOnlyJiraProjectName,` in the params (after `deleteAction,`).

Render it directly above `<TaskFormFields` (line 108):

```tsx
          {readOnlyJiraProjectName && (
            <JiraReadOnlyBanner lang={lang} projectName={readOnlyJiraProjectName} />
          )}
          <TaskFormFields
```

- [ ] **Step 7: Compute + pass from task-manager**

In `src/app/task-manager.tsx`, after the `jiraReadOnlyKeys` const from Task 7, add:

```ts
  const editingReadOnlyJiraProjectName = (() => {
    if (!editingTask?.jiraKey) return undefined;
    const proj = jiraProjectKeyOf(editingTask.jiraKey);
    const extra = (settings.jira.extraProjects ?? []).find((p) => p.key === proj);
    return extra?.readOnly ? extra.name || extra.key : undefined;
  })();
```

Add the import at the top of task-manager (with the other local imports):

```ts
import { jiraProjectKeyOf } from "./jira-projects";
```

In the `<TaskEditView` prop list (line ~1998-2014), after `editingIsJiraLinked={editingIsJiraLinked}` (line 2009) add:

```tsx
      readOnlyJiraProjectName={editingReadOnlyJiraProjectName}
```

In the `<TaskFormModal` prop list (line ~2235-2241), after `editingIsJiraLinked={editingIsJiraLinked}` (line 2235) add:

```tsx
        readOnlyJiraProjectName={editingReadOnlyJiraProjectName}
```

- [ ] **Step 8: Run the editor + task-manager suites + typecheck**

Run: `npx vitest run src/app/jira-readonly-banner.test.tsx src/app/task-form-modal.test.tsx src/app/task-edit-view.test.tsx`
Expected: PASS (existing editor tests unaffected — the new prop is optional).
Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 9: Commit**

```bash
git add src/app/jira-readonly-banner.tsx src/app/jira-readonly-banner.test.tsx src/app/task-edit-view.tsx src/app/task-form-modal.tsx src/app/task-manager.tsx
git commit -m "feat(jira): editor banner warns when a task's project is read-only"
```

---

## Task 9: Settings UI — extra projects block

**Files:**
- Modify: `src/app/jira-settings.tsx`
- Test: `src/app/jira-settings.test.tsx` if present, else add a focused render test.

- [ ] **Step 1: Write the failing test**

Add a test that renders `JiraSettingsSection` with a config that has a primary project + a loaded project list, and asserts the extra-projects block behavior. Follow the existing `jira-settings` test harness (it mocks `jira-api`). Assert:

```ts
// After a successful connection test loads projects [LOP, OPS, DEV] and primary=LOP:
// - "Also sync from other projects" heading renders.
// - OPS and DEV appear as includable rows (LOP excluded — it's primary).
// - Clicking Include on OPS calls the config setter with
//   extraProjects containing { key: "OPS", name: "OPS", readOnly: true }.
// - Toggling OPS to two-way calls the setter with readOnly: false.
// - Each per-row control has a project-unique accessible name.
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/app/jira-settings.test.tsx`
Expected: FAIL — the block doesn't exist yet.

- [ ] **Step 3: Implement the block**

In `src/app/jira-settings.tsx`, after the primary project `<select>` group (the block ending at line ~371 that renders the `<select value={config.projectKey}>`), add the extra-projects section. Use the existing `INTERACTIVE`/`FOCUS_RING` atoms and the `updateConfig`/`onChange` setter the component already uses for `projectKey`:

```tsx
{config.projectKey && (
  <div className="mt-3">
    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {t(lang, "jiraExtraProjectsLabel")}
    </p>
    <p className="mb-2 text-xs text-muted-foreground">{t(lang, "jiraExtraProjectsHint")}</p>
    <ul className="space-y-1">
      {projects
        .filter((p) => p.key !== config.projectKey)
        .map((p) => {
          const entry = config.extraProjects.find((e) => e.key === p.key);
          const included = !!entry;
          return (
            <li key={p.key} className="flex items-center justify-between gap-2 text-sm">
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={included}
                  aria-label={`${t(lang, "jiraExtraProjectInclude")} – ${p.name} (${p.key})`}
                  onChange={(e) => {
                    const next = e.target.checked
                      ? [...config.extraProjects, { key: p.key, name: p.name, readOnly: true }]
                      : config.extraProjects.filter((x) => x.key !== p.key);
                    onChange({ ...config, extraProjects: next });
                  }}
                  className="h-4 w-4"
                />
                <span>
                  {p.name} <span className="text-muted-foreground">({p.key})</span>
                </span>
              </label>
              {included && (
                <label className="flex cursor-pointer items-center gap-1 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={entry.readOnly}
                    aria-label={`${t(lang, "jiraReadOnly")} – ${p.name} (${p.key})`}
                    onChange={(e) => {
                      const next = config.extraProjects.map((x) =>
                        x.key === p.key ? { ...x, readOnly: e.target.checked } : x,
                      );
                      onChange({ ...config, extraProjects: next });
                    }}
                    className={`h-3.5 w-3.5 ${FOCUS_RING}`}
                  />
                  {t(lang, "jiraReadOnly")}
                </label>
              )}
            </li>
          );
        })}
    </ul>
  </div>
)}
```

> Notes:
> - The component's setter is `onChange(next: JiraConfig)` (prop, `jira-settings.tsx:43`) — the primary project `<select>` already calls `onChange({ ...config, projectKey, projectName })`. Use the identical `onChange({ ...config, extraProjects: next })` shape shown above; do not introduce a new setter.
> - The component does not currently import `FOCUS_RING` — add `import { FOCUS_RING } from "./interaction-styles";` at the top.
> - This iterates the already-loaded `projects` list. Configured extras whose project is not in a freshly-loaded list still persist in config (they just aren't shown until the next connection test reloads `projects`) — acceptable; the primary `<select>` has the same load-dependency today.

- [ ] **Step 4: Run the test + axe check**

Run: `npx vitest run src/app/jira-settings.test.tsx`
Expected: PASS.
Run: `npx playwright test e2e/a11y.spec.ts --project=chromium -g "General"`
Expected: PASS (Settings → General/Integrations is axe-scanned; the new checkboxes carry project-unique `aria-label`s).

- [ ] **Step 5: Typecheck + commit**

Run: `npx tsc --noEmit`  → exit 0.

```bash
git add src/app/jira-settings.tsx src/app/jira-settings.test.tsx
git commit -m "feat(jira): settings UI to add extra projects with per-project read-only"
```

---

## Task 10: Full-suite verification

**Files:** none (verification only).

- [ ] **Step 1: Lint**

Run: `npm run lint`
Expected: 0 warnings (unused imports/vars are fatal — re-check every touched file).

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0 (EN/DE i18n parity holds).

- [ ] **Step 3: Unit suite**

Run: `npm run test:run`
Expected: PASS (no regressions).

- [ ] **Step 4: a11y gate for the touched views**

Run: `npx playwright test e2e/a11y.spec.ts --project=chromium -g "General"`
Expected: PASS.

- [ ] **Step 5: Commit any lint/fix follow-ups (if needed)**

```bash
git add -A
git commit -m "chore(jira): lint/typecheck follow-ups for multi-project sync"
```

---

## Notes for the implementer

- **No release / version bump / CHANGELOG in this plan.** That happens only on an explicit "release" from the user, per standing rules. This plan stops at green local checks.
- **DE i18n:** never edit `i18n.de.ts` with the Edit tool — it corrupts umlauts and curls quotes. Use the node command in Task 5.
- **No new persisted Workspace field, no six-write-path, no golden-fixture regen, no CSP host, no new AppView.** This is per-device settings config only.
- **`jira-api.ts` stays lazy-loaded.** Do not import `use-settings.ts` / `jira-settings.tsx` symbols from it; the shared helpers live in `jira-projects.ts` on purpose.
