# Help Expansion SP1 — Content Backbone + Help-view Concept Content — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add a typed help-content backbone (concepts · workflows · features · what's-automated, with relations data) and render it as a grouped, searchable Help view, so PM-novices learn what entities are, why they matter, and how they connect. EN + DE.

**Architecture:** One typed module `help-content.ts` holds all help entries tagged by `HelpGroup`; the existing 28 feature sections fold in as `group:"features"` and the floating panel keeps reading them via a derived `HELP_SECTIONS`. The Help view renders all groups (grouped TOC + content, search across all). Concept entries carry `relatedViews`/`relatedConcepts` (rendered as a "Related:" line now; the visual map in a later SP reads the same data).

**Tech Stack:** Next.js 16 · React 19 · TypeScript · Tailwind v4 · Vitest.

**Spec:** `docs/superpowers/specs/2026-06-28-help-concepts-sp1-design.md`.

---

## Conventions (CI-fatal)

- `npm run lint` is `--max-warnings=0` (unused import/var fatal). `npx tsc --noEmit` typechecks tests + enforces i18n EN/DE key parity + `TranslationKey` validity.
- **i18n:** EN keys in `i18n.ts` via Edit; DE keys in `i18n.de.ts` via a **node utf8 write** (file is CRLF; use `\r\n` anchors; type umlauts as literal `ä ö ü ß` in the node string OR `\uXXXX`). NEVER Edit `i18n.de.ts` directly (Edit corrupts umlauts/curls quotes). The `i18n-encoding` test BANS ASCII umlaut subs (fuer/ue) — use real German.
- Help is NOT in axe `A11Y_VIEWS`; verify a11y by eye. The sidebar Help entry is scanned every view (already labeled).
- Help-view bodies render `whitespace-pre-line`; concept bodies use the shape `What: … \n\nWhy it matters: … \n\nIn this app: …`.

## File structure

| File | Responsibility |
|------|----------------|
| `src/app/help-content.ts` (NEW; replaces `help-sections.ts`) | `HelpGroup`, `HelpEntry`, `HELP_ENTRIES`, `HELP_GROUP_ORDER`, `HELP_GROUP_LABEL`, derived `HELP_SECTIONS` |
| `src/app/help-content.test.ts` (NEW) | backbone guards (unique ids, relations resolve, keys exist) |
| `src/app/help-menu.tsx` (MODIFY) | import `HELP_SECTIONS` from `help-content` (was `help-sections`) |
| `src/app/help-view.tsx` (MODIFY) | grouped TOC + grouped content + "Related:" links + search hides empty groups |
| `src/app/help-view.test.tsx` (NEW) | group headers, search filter, related links |
| `src/app/i18n.ts` + `i18n.de.ts` (MODIFY) | group labels + concept/workflow/automated strings; `helpRelated` label |

---

### Task 1: Content backbone module

**Files:**
- Create: `src/app/help-content.ts`
- Delete: `src/app/help-sections.ts`
- Create: `src/app/help-content.test.ts`

- [ ] **Step 1: Write the failing test** (`help-content.test.ts`):

```ts
import { describe, it, expect } from "vitest";
import { HELP_ENTRIES, HELP_SECTIONS, HELP_GROUP_ORDER, HELP_GROUP_LABEL } from "./help-content";
import { allNavViews } from "./nav-config";
import en from "./i18n";

describe("help-content backbone", () => {
  it("has unique entry ids", () => {
    const ids = HELP_ENTRIES.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("HELP_SECTIONS is exactly the features group", () => {
    expect(HELP_SECTIONS).toEqual(HELP_ENTRIES.filter((e) => e.group === "features"));
  });
  it("every relatedConcepts id resolves to a real entry", () => {
    const ids = new Set(HELP_ENTRIES.map((e) => e.id));
    for (const e of HELP_ENTRIES) for (const r of e.relatedConcepts ?? []) expect(ids.has(r)).toBe(true);
  });
  it("every relatedViews entry is a valid AppView", () => {
    const views = new Set(allNavViews());
    for (const e of HELP_ENTRIES) for (const v of e.relatedViews ?? []) expect(views.has(v)).toBe(true);
  });
  it("every group in HELP_GROUP_ORDER has a label and vice-versa", () => {
    for (const g of HELP_GROUP_ORDER) expect(HELP_GROUP_LABEL[g]).toBeTruthy();
  });
});
```

Note: `import en from "./i18n"` — confirm the EN dict's actual export name first (`grep -nE "export (default|const)" src/app/i18n.ts`); adapt the key-existence assertion if needed, else drop that import (tsc already enforces `TranslationKey`).

- [ ] **Step 2: Run, expect FAIL** — `npm run test:run -- help-content` (module missing).

- [ ] **Step 3: Implement `help-content.ts`** — copy the 28 entries from the current `help-sections.ts`, give each a stable `id` (`feature-<slug>`), tag `group:"features"`, and add the scaffolding. (Concept/workflow/automated entries are added in Tasks 4–6.)

```ts
import type { TranslationKey } from "./i18n";
import type { AppView } from "./nav-config";

export type HelpGroup = "concepts" | "workflows" | "features" | "automated";

export interface HelpEntry {
  id: string;
  group: HelpGroup;
  titleKey: TranslationKey;
  bodyKey: TranslationKey;
  relatedViews?: readonly AppView[];
  relatedConcepts?: readonly string[];
}

export const HELP_GROUP_ORDER: readonly HelpGroup[] = ["concepts", "workflows", "features", "automated"];

export const HELP_GROUP_LABEL: Record<HelpGroup, TranslationKey> = {
  concepts: "helpGroupConcepts",
  workflows: "helpGroupWorkflows",
  features: "helpGroupFeatures",
  automated: "helpGroupAutomated",
};

export const HELP_ENTRIES: readonly HelpEntry[] = [
  // ── Features (migrated from help-sections.ts; one per former section) ──
  { id: "feature-layout", group: "features", titleKey: "helpSecLayoutTitle", bodyKey: "helpSecLayoutBody" },
  { id: "feature-add", group: "features", titleKey: "helpSecAddTitle", bodyKey: "helpSecAddBody" },
  { id: "feature-field-visibility", group: "features", titleKey: "helpSecFieldVisibilityTitle", bodyKey: "helpSecFieldVisibilityBody" },
  { id: "feature-templates", group: "features", titleKey: "helpSecTemplatesTitle", bodyKey: "helpSecTemplatesBody" },
  { id: "feature-per-project-functions", group: "features", titleKey: "helpSecPerProjectFunctionsTitle", bodyKey: "helpSecPerProjectFunctionsBody" },
  { id: "feature-template-suggest", group: "features", titleKey: "helpSecTemplateSuggestTitle", bodyKey: "helpSecTemplateSuggestBody" },
  { id: "feature-workspace", group: "features", titleKey: "helpSecWorkspaceTitle", bodyKey: "helpSecWorkspaceBody" },
  { id: "feature-tabs", group: "features", titleKey: "helpSecTabsTitle", bodyKey: "helpSecTabsBody" },
  { id: "feature-tasks", group: "features", titleKey: "helpSecTasksTitle", bodyKey: "helpSecTasksBody" },
  { id: "feature-task-status", group: "features", titleKey: "helpSecTaskStatusTitle", bodyKey: "helpSecTaskStatusBody" },
  { id: "feature-gantt", group: "features", titleKey: "helpSecGanttTitle", bodyKey: "helpSecGanttBody" },
  { id: "feature-raid", group: "features", titleKey: "helpSecRaidTitle", bodyKey: "helpSecRaidBody" },
  { id: "feature-resources", group: "features", titleKey: "helpSecResourcesTitle", bodyKey: "helpSecResourcesBody" },
  { id: "feature-steering", group: "features", titleKey: "helpSecSteeringTitle", bodyKey: "helpSecSteeringBody" },
  { id: "feature-activity", group: "features", titleKey: "helpSecActivityTitle", bodyKey: "helpSecActivityBody" },
  { id: "feature-documents", group: "features", titleKey: "helpSecDocumentsTitle", bodyKey: "helpSecDocumentsBody" },
  { id: "feature-voice", group: "features", titleKey: "helpSecVoiceTitle", bodyKey: "helpSecVoiceBody" },
  { id: "feature-notif", group: "features", titleKey: "helpSecNotifTitle", bodyKey: "helpSecNotifBody" },
  { id: "feature-timezones", group: "features", titleKey: "helpSecTimezonesTitle", bodyKey: "helpSecTimezonesBody" },
  { id: "feature-jira", group: "features", titleKey: "helpSecJiraTitle", bodyKey: "helpSecJiraBody" },
  { id: "feature-storage", group: "features", titleKey: "helpSecStorageTitle", bodyKey: "helpSecStorageBody" },
  { id: "feature-setup-wizard", group: "features", titleKey: "helpSecSetupWizardTitle", bodyKey: "helpSecSetupWizardBody" },
  { id: "feature-version-history", group: "features", titleKey: "helpSecVersionHistoryTitle", bodyKey: "helpSecVersionHistoryBody" },
  { id: "feature-ai", group: "features", titleKey: "helpSecAiTitle", bodyKey: "helpSecAiBody" },
  { id: "feature-ai-advanced", group: "features", titleKey: "helpSecAiAdvancedTitle", bodyKey: "helpSecAiAdvancedBody" },
  { id: "feature-input-feedback", group: "features", titleKey: "helpSecInputFeedbackTitle", bodyKey: "helpSecInputFeedbackBody" },
  { id: "feature-tour", group: "features", titleKey: "helpSecTourTitle", bodyKey: "helpSecTourBody" },
  { id: "feature-keys", group: "features", titleKey: "helpSecKeysTitle", bodyKey: "helpSecKeysBody" },
  // Concepts/workflows/automated appended in Tasks 4–6.
];

export const HELP_SECTIONS = HELP_ENTRIES.filter((e) => e.group === "features");
```

- [ ] **Step 4: Delete `help-sections.ts`.**

- [ ] **Step 5: Run** `npm run test:run -- help-content` (PASS) + `npx tsc --noEmit` (will fail on `help-sections` importers — fixed in Task 2; the test file itself + help-content must compile).

- [ ] **Step 6: Commit** — `feat(help): typed help-content backbone (features group migrated from help-sections)`. (Tree may not yet tsc-clean repo-wide; Task 2 closes it — combine commits if a green tree per commit is required.)

---

### Task 2: Repoint importers at help-content

**Files:** Modify `src/app/help-menu.tsx`, `src/app/help-view.tsx`

- [ ] **Step 1:** In `help-menu.tsx` change `import { HELP_SECTIONS as SECTIONS } from "./help-sections";` → `from "./help-content";`.
- [ ] **Step 2:** In `help-view.tsx` change `import { HELP_SECTIONS } from "./help-sections";` → `from "./help-content";` (Task 3 will switch it to `HELP_ENTRIES`).
- [ ] **Step 3: Run** `npx tsc --noEmit` (0) + `npm run test:run -- help-menu help-view` (green).
- [ ] **Step 4: Commit** — `refactor(help): repoint help-menu/help-view at help-content`.

---

### Task 3: Grouped Help-view rendering + group labels

**Files:** Modify `src/app/help-view.tsx`, `src/app/i18n.ts`, `src/app/i18n.de.ts`; Create `src/app/help-view.test.tsx`

- [ ] **Step 1: Add group-label + "Related" i18n.** EN (`i18n.ts`, Edit) after `helpContents`:

```ts
  helpGroupConcepts: "Concepts",
  helpGroupWorkflows: "Workflows",
  helpGroupFeatures: "Features",
  helpGroupAutomated: "What's automated",
  helpRelated: "Related",
```

DE (`i18n.de.ts`, node utf8 write after `helpContents:`): `helpGroupConcepts: "Konzepte"`, `helpGroupWorkflows: "Arbeitsabläufe"`, `helpGroupFeatures: "Funktionen"`, `helpGroupAutomated: "Was automatisch passiert"`, `helpRelated: "Verwandt"`. (Use a node script: read file, splice after the `helpContents:` line, write `\r\n`-joined.)

- [ ] **Step 2: Write the failing test** (`help-view.test.tsx`):

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { HelpView } from "./help-view";

describe("HelpView grouped", () => {
  it("renders a Features group header", () => {
    render(<HelpView lang="en-US" />);
    // Group header appears as a heading; at least one group label is shown.
    expect(screen.getAllByText("Features").length).toBeGreaterThan(0);
  });
  it("filters out non-matching groups on search", () => {
    render(<HelpView lang="en-US" />);
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "zzzznomatch" } });
    expect(screen.getByText("No help topics match your search.")).toBeInTheDocument();
  });
});
```

(jsdom stubs for `useResizable` are unnecessary here; if a layout measure throws, stub `scrollHeight` per the repo convention.)

- [ ] **Step 2b: Run, expect FAIL** (no group header yet).

- [ ] **Step 3: Implement grouped rendering** in `help-view.tsx`. Switch the import to `HELP_ENTRIES`, `HELP_GROUP_ORDER`, `HELP_GROUP_LABEL` and group the filtered entries. Replace the single `filtered.map(...)` TOC + content with a per-group loop:

```tsx
import { HELP_ENTRIES, HELP_GROUP_ORDER, HELP_GROUP_LABEL, type HelpEntry } from "./help-content";
import { navLabelKey } from "./nav-config";
// ...
const filtered = useMemo(
  () => HELP_ENTRIES.filter((e) => matchesQuery(t(lang, e.titleKey), t(lang, e.bodyKey), query)),
  [lang, query],
);
const groups = HELP_GROUP_ORDER
  .map((g) => ({ group: g, entries: filtered.filter((e) => e.group === g) }))
  .filter((x) => x.entries.length > 0);
```

`sectionId(e.id)` is the anchor (entries now keyed by `id`, not `titleKey`). TOC: for each group render a group-label heading then its entries' buttons (`scrollToSection(e.id)`). Content: for each group render a group `<h2>` then each entry as a `<section id={sectionId(e.id)}>` with `<h3>` title + `<p>` body (`Highlighted`), and — for `relatedViews`/`relatedConcepts` — a "Related:" line:

```tsx
{(e.relatedConcepts?.length || e.relatedViews?.length) ? (
  <p className="mt-1 text-xs text-muted-foreground">
    <span className="font-medium">{t(lang, "helpRelated")}:</span>{" "}
    {e.relatedConcepts?.map((rid) => {
      const target = HELP_ENTRIES.find((x) => x.id === rid);
      return target ? (
        <button key={rid} type="button" onClick={() => scrollToSection(rid)} className={`underline-offset-2 hover:underline ${INTERACTIVE}`}>
          {t(lang, target.titleKey)}
        </button>
      ) : null;
    })}
    {e.relatedViews?.map((v) => <span key={v} className="ml-2">{t(lang, navLabelKey(v))}</span>)}
  </p>
) : null}
```

(Comma-separate the related-concept buttons as you prefer — keep it simple.) Empty-state (`filtered.length === 0`) unchanged.

- [ ] **Step 4: Run** `npm run test:run -- help-view` + `npx tsc --noEmit` + `npm run lint` (0).
- [ ] **Step 5: Commit** — `feat(help): grouped Help view (group TOC + headers + related links)`.

---

### Task 4: Concept entries + content

**Files:** Modify `src/app/help-content.ts`, `src/app/i18n.ts`, `src/app/i18n.de.ts`, `src/app/help-content.test.ts`

- [ ] **Step 1: Add a concepts-count assertion** to `help-content.test.ts`:

```ts
it("has the concept entries", () => {
  expect(HELP_ENTRIES.filter((e) => e.group === "concepts").length).toBeGreaterThanOrEqual(10);
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Append concept entries** to `HELP_ENTRIES` (before the closing `]`). Each: `{ id, group:"concepts", titleKey, bodyKey, relatedViews, relatedConcepts }`. Use these ids/titles/relations:

| id | titleKey | relatedViews | relatedConcepts |
|----|----------|--------------|-----------------|
| `concept-milestone` | `helpConceptMilestoneTitle` | `["milestones","gantt"]` | `["concept-dependency","concept-baseline"]` |
| `concept-raid` | `helpConceptRaidTitle` | `["raid"]` | `["concept-change","concept-stakeholder"]` |
| `concept-change` | `helpConceptChangeTitle` | `["changes"]` | `["concept-raid","concept-budget"]` |
| `concept-stakeholder` | `helpConceptStakeholderTitle` | `["stakeholders","raci"]` | `["concept-raci","concept-steering"]` |
| `concept-raci` | `helpConceptRaciTitle` | `["raci","stakeholders"]` | `["concept-stakeholder"]` |
| `concept-budget` | `helpConceptBudgetTitle` | `["budget","budget-report"]` | `["concept-resource"]` |
| `concept-resource` | `helpConceptResourceTitle` | `["resources","workload","planning"]` | `["concept-budget"]` |
| `concept-steering` | `helpConceptSteeringTitle` | `["steering-committee"]` | `["concept-stakeholder"]` |
| `concept-task-status` | `helpConceptTaskStatusTitle` | `["open-points"]` | `["concept-milestone"]` |
| `concept-baseline` | `helpConceptBaselineTitle` | `["trends"]` | `["concept-milestone","concept-budget"]` |
| `concept-dependency` | `helpConceptDependencyTitle` | `["gantt","open-points"]` | `["concept-milestone"]` |

Each entry's `bodyKey` = same camel id (e.g. `helpConceptMilestoneBody`).

- [ ] **Step 4: Add EN strings** (`i18n.ts`, Edit) — titles + bodies. Bodies follow `What: … \n\nWhy it matters: … \n\nIn this app: …`. Author concise (2–4 sentence) plain-language EN for each. Example (milestone):

```ts
  helpConceptMilestoneTitle: "Milestone",
  helpConceptMilestoneBody:
    "What: A milestone is a significant, dated checkpoint in a project — a deliverable, a decision, or a phase gate (e.g. \"Go-live\").\n\nWhy it matters: Milestones turn a long list of tasks into a timeline you can steer by; slipping milestones are the earliest signal a project is off track.\n\nIn this app: Add milestones in the Milestones view; they appear on the Gantt and the dashboard horizon, and their dates drive the Schedule RAG.",
```

Author the remaining 10 concept bodies in the same shape (RAID, change control, stakeholder, RACI, budget/EVM, resource/capacity, steering committee, task status, baseline/trends, dependency), each truthful to this app's behaviour. For EVM, define SPI/CPI in one plain sentence each.

- [ ] **Step 5: Add DE strings** (`i18n.de.ts`, node utf8 write) — translate each title+body to German, real umlauts, `\r\n`-spliced after an existing anchor key. One node script can append all concept DE keys at once (build an array of `  key: "…",` lines, splice after the `helpRelated:` line).

- [ ] **Step 6: Run** `npm run test:run -- help-content help-view` + `npx tsc --noEmit` (EN/DE parity) + `npm run lint`.
- [ ] **Step 7: Commit** — `feat(help): PM concept glossary (10+ concepts, EN/DE, relations)`.

---

### Task 5: Workflow entries + content

**Files:** Modify `src/app/help-content.ts`, `i18n.ts`, `i18n.de.ts`, `help-content.test.ts`

- [ ] **Step 1: Assertion** — `expect(HELP_ENTRIES.filter((e) => e.group === "workflows").length).toBeGreaterThanOrEqual(6);`. Run, expect FAIL.
- [ ] **Step 2: Append workflow entries** (`group:"workflows"`):

| id | titleKey | relatedViews | relatedConcepts |
|----|----------|--------------|-----------------|
| `workflow-end-to-end` | `helpWorkflowEndToEndTitle` | `["dashboard","open-points","milestones"]` | `["concept-milestone","concept-task-status"]` |
| `workflow-plan` | `helpWorkflowPlanTitle` | `["milestones","gantt"]` | `["concept-milestone","concept-dependency"]` |
| `workflow-risk` | `helpWorkflowRiskTitle` | `["raid"]` | `["concept-raid"]` |
| `workflow-scope` | `helpWorkflowScopeTitle` | `["changes"]` | `["concept-change"]` |
| `workflow-budget` | `helpWorkflowBudgetTitle` | `["budget","trends"]` | `["concept-budget","concept-baseline"]` |
| `workflow-stakeholders` | `helpWorkflowStakeholdersTitle` | `["stakeholders","raci","steering-committee"]` | `["concept-stakeholder","concept-raci"]` |

- [ ] **Step 3: EN strings** — title + a numbered-steps body. Example:

```ts
  helpWorkflowEndToEndTitle: "Track a project end to end",
  helpWorkflowEndToEndBody:
    "1. Create the project (or start from a template).\n2. Add the key dates as milestones.\n3. Break the work into tasks on Open Points and assign owners + due dates.\n4. Log risks/issues in RAID and route scope changes through Changes.\n5. Watch the dashboard: RAG, overdue, and the ranked next actions tell you where to look.",
```

Author the remaining 5 workflow bodies as short numbered steps referencing the real views.

- [ ] **Step 4: DE strings** (node utf8 write). **Step 5: Run** tests + tsc + lint. **Step 6: Commit** — `feat(help): workflow guides (6, EN/DE)`.

---

### Task 6: "What's automated" entries + content

**Files:** Modify `src/app/help-content.ts`, `i18n.ts`, `i18n.de.ts`, `help-content.test.ts`

- [ ] **Step 1: Assertion** — `expect(HELP_ENTRIES.filter((e) => e.group === "automated").length).toBeGreaterThanOrEqual(1);`. Run, expect FAIL.
- [ ] **Step 2: Append automated entries** (`group:"automated"`):

| id | titleKey | relatedViews | relatedConcepts |
|----|----------|--------------|-----------------|
| `automated-tracking` | `helpAutomatedTrackingTitle` | `["dashboard","actions","open-points"]` | `["concept-task-status"]` |
| `automated-health` | `helpAutomatedHealthTitle` | `["dashboard","budget","trends"]` | `["concept-budget","concept-baseline"]` |

- [ ] **Step 3: EN strings.** Example:

```ts
  helpAutomatedTrackingTitle: "Tracking the app does for you",
  helpAutomatedTrackingBody:
    "The app flags overdue and due-soon work automatically, keeps a task's completion date in sync with its status, ranks the most important next actions for you, and records every change in the activity log — you don't maintain any of this by hand.",
  helpAutomatedHealthTitle: "Health & forecasting the app computes",
  helpAutomatedHealthBody:
    "Overall/Schedule/Budget/Scope RAG, earned-value SPI/CPI, and the burn-down forecast are derived from your tasks, milestones and budget — no manual status rollups. On a Turso backend it also snapshots progress over time for the Trends view.",
```

- [ ] **Step 4: DE strings** (node utf8 write). **Step 5: Run** full `npm run test:run`, `npx tsc --noEmit`, `npm run lint`. **Step 6: Eye-check** the Help view (`#help`) at desktop width: grouped TOC (Concepts·Workflows·Features·What's automated), search filtering, related links scroll. **Step 7: Commit** — `feat(help): "what's automated" section (EN/DE); SP1 complete`.

---

## Self-review

- **Spec coverage:** backbone (T1) · floating-panel-unchanged via derived HELP_SECTIONS (T1/T2) · grouped Help view + search-hides-empty + related links (T3) · concepts (T4) · workflows (T5) · automated (T6) · EN/DE (T3–T6) · backbone guards test (T1) + Help-view test (T3). All spec sections covered.
- **Type consistency:** `HelpEntry`/`HELP_ENTRIES`/`HELP_GROUP_ORDER`/`HELP_GROUP_LABEL`/`HELP_SECTIONS`/`sectionId(id)` used consistently T1→T6; anchors keyed by `e.id` (not `titleKey`) from T3 on.
- **Placeholders:** concept/workflow/automated bodies are authored content (the executor writes the remaining bodies in the given shape — that is the deliverable, not a placeholder); DE = a defined node-write translation step.
