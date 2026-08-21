# Dashboard Empty-State Coaching CTAs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** On a blank/new project, surface a "Get started" coaching card on the Dashboard with CTAs (Add task · Configure AI · Add milestone · Set up budget) routing to the right view; the card self-hides once any task exists.

**Architecture:** Pure `computeCoaching` (gap detection → CTA list, gated on `taskCount===0`); presentational `dashboard-coaching-card.tsx`; rendered in `dashboard-panel.tsx` after the delta strip; navigation via a single new `onNavigate=setActiveTab` prop, AI-config detection via a new `aiConfigured` prop.

**Tech Stack:** TypeScript, React 19, vitest, Tailwind (AIPM tokens), forked Next.js 16.

**Conventions (AGENTS.md):**
- `npm run lint` is `--max-warnings=0` (unused import/var FATAL).
- `npx tsc --noEmit` enforces i18n EN/DE parity AND typechecks tests. Run after editing ANY test.
- `i18n.de.ts` is CRLF; patch DE via node utf8 script matching `\r\n`, real umlauts (ü ö ä ß). `i18n-encoding` test bans ASCII subs.
- `t(lang, key, ...args)` uses 0-based `{0}` placeholders.
- Dashboard IS in axe `A11Y_VIEWS` — CTA buttons need text accessible names; verify `npx playwright test e2e/a11y.spec.ts --project=chromium -g "Dashboard"`.

**Facts:** `settings.apiKey: string` (`""` when unset; in-memory hydrated) is the Anthropic-key field. `AppView` ids: tasks=`"open-points"`, budget=`"budget"`, settings=`"settings"`, milestones=`"milestones"` (nav-config.ts). `useWorkspaceTab().setActiveTab(view)` navigates to any AppView. `WorkspaceSection` already receives `settings`.

**Branch:** create `feat-dashboard-coaching` off `main` before Task 1. Never commit `docs/refactor-review-2026-06-19.md`.

---

### Task 1: `dashboard-coaching.ts` engine + unit tests

**Files:**
- Create: `src/app/dashboard-coaching.ts`
- Test: `src/app/dashboard-coaching.test.ts`

- [ ] **Step 1: Write the failing test**

`src/app/dashboard-coaching.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import { computeCoaching } from "./dashboard-coaching";

const base = { taskCount: 0, milestoneCount: 0, budgetCount: 0, showMilestones: true, showBudget: true, aiConfigured: true };

describe("computeCoaching", () => {
  test("returns [] once any task exists (non-naggy on active projects)", () => {
    expect(computeCoaching({ ...base, taskCount: 1, aiConfigured: false })).toEqual([]);
  });

  test("blank project always offers Add-task first", () => {
    const ctas = computeCoaching(base);
    expect(ctas[0]).toEqual({ key: "task", labelKey: "coachingAddTask", view: "open-points" });
  });

  test("offers Configure-AI when the key is not set", () => {
    const ctas = computeCoaching({ ...base, aiConfigured: false });
    expect(ctas.map((c) => c.key)).toEqual(["task", "ai"]);
    expect(ctas[1].view).toBe("settings");
  });

  test("offers Add-milestone only when the module is on and none exist", () => {
    expect(computeCoaching({ ...base }).some((c) => c.key === "milestone")).toBe(true);
    expect(computeCoaching({ ...base, milestoneCount: 2 }).some((c) => c.key === "milestone")).toBe(false);
    expect(computeCoaching({ ...base, showMilestones: false }).some((c) => c.key === "milestone")).toBe(false);
  });

  test("offers Set-up-budget only when the module is on and none exist", () => {
    expect(computeCoaching({ ...base }).some((c) => c.key === "budget")).toBe(true);
    expect(computeCoaching({ ...base, budgetCount: 1 }).some((c) => c.key === "budget")).toBe(false);
    expect(computeCoaching({ ...base, showBudget: false }).some((c) => c.key === "budget")).toBe(false);
  });

  test("full order on a fully-blank project with no AI key", () => {
    const ctas = computeCoaching({ ...base, aiConfigured: false });
    // task, ai, milestone, budget
    expect(ctas.map((c) => c.key)).toEqual(["task", "ai", "milestone", "budget"]);
    expect(ctas.map((c) => c.view)).toEqual(["open-points", "settings", "milestones", "budget"]);
  });
});
```

- [ ] **Step 2: Run, verify failure**

Run: `npm run test:run -- src/app/dashboard-coaching.test.ts`
Expected: FAIL — import unresolved.

- [ ] **Step 3: Implement `src/app/dashboard-coaching.ts`**

```ts
// Pure, i18n-free coaching-CTA selector for the Dashboard's first-open
// "Get started" card. No React, no I/O. Returns translation keys + view ids;
// the card translates and wires navigation. Gated on a blank project so it
// self-hides (never nags) once work begins.

import type { TranslationKey } from "./i18n";
import type { AppView } from "./nav-config";

export type CoachingCta = { key: string; labelKey: TranslationKey; view: AppView };

export function computeCoaching(input: {
  taskCount: number;
  milestoneCount: number;
  budgetCount: number;
  showMilestones: boolean;
  showBudget: boolean;
  aiConfigured: boolean;
}): CoachingCta[] {
  if (input.taskCount > 0) return [];
  const ctas: CoachingCta[] = [];
  ctas.push({ key: "task", labelKey: "coachingAddTask", view: "open-points" });
  if (!input.aiConfigured) ctas.push({ key: "ai", labelKey: "coachingConfigureAi", view: "settings" });
  if (input.showMilestones && input.milestoneCount === 0) ctas.push({ key: "milestone", labelKey: "coachingAddMilestone", view: "milestones" });
  if (input.showBudget && input.budgetCount === 0) ctas.push({ key: "budget", labelKey: "coachingSetBudget", view: "budget" });
  return ctas;
}
```

- [ ] **Step 4: Run, verify pass**

Run: `npm run test:run -- src/app/dashboard-coaching.test.ts`
Expected: PASS. (The `labelKey` literals must be valid `TranslationKey`s — they won't exist until Task 3, so tsc will fail until then; the vitest run still passes because vitest doesn't typecheck. Proceed; Task 3 closes the type gap.)

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard-coaching.ts src/app/dashboard-coaching.test.ts
git commit -m "feat(dashboard): computeCoaching engine for first-open CTAs"
```

> Note: do NOT run `npx tsc --noEmit` as a gate here — the `labelKey` string literals reference i18n keys added in Task 3, so tsc only goes green after Task 3 lands. The full lint+tsc gate runs in Task 4.

---

### Task 2: i18n keys (EN + DE)

**Files:**
- Modify: `src/app/i18n.ts` (after `versionHighlightMilestoneHorizon`)
- Modify: `src/app/i18n.de.ts` (node utf8 script)
- Create (temp): `scripts/_patch-de-coaching.mjs` (delete after)

- [ ] **Step 1: Add EN keys to `src/app/i18n.ts`**

Insert immediately after the `versionHighlightMilestoneHorizon: "…",` entry:

```ts
  versionHighlightCoaching:
    "New projects get a \"Get started\" card on the Dashboard with one-tap steps — add a task, configure the AI assistant, add a milestone, set up a budget — that disappears once you're underway.",
  coachingTitle: "Get started",
  coachingSubtitle: "A few steps to set up this project:",
  coachingAddTask: "Add your first task",
  coachingConfigureAi: "Configure AI assistant",
  coachingAddMilestone: "Add a milestone",
  coachingSetBudget: "Set up a budget",
```

- [ ] **Step 2: tsc — confirms BOTH the parity gap AND closes the Task-1 type gap**

Run: `npx tsc --noEmit`
Expected: FAIL with i18n parity errors (DE missing the 7 new keys). The `dashboard-coaching.ts` `labelKey` errors from Task 1 are now resolved (EN keys exist). After Step 3 (DE), tsc goes fully green.

- [ ] **Step 3: DE via node script**

Create `scripts/_patch-de-coaching.mjs`:

```js
import { readFileSync, writeFileSync } from "node:fs";
const path = "src/app/i18n.de.ts";
let s = readFileSync(path, "utf8");
const anchor = /(versionHighlightMilestoneHorizon:\s*\r?\n?\s*"[^"]*",\r?\n)/;
if (!anchor.test(s)) { console.error("anchor not found"); process.exit(1); }
const block =
  '  versionHighlightCoaching:\r\n' +
  '    "Neue Projekte erhalten im Dashboard eine „Erste Schritte“-Karte mit Ein-Klick-Schritten – Aufgabe anlegen, KI-Assistenten einrichten, Meilenstein anlegen, Budget einrichten – die verschwindet, sobald es losgeht.",\r\n' +
  '  coachingTitle: "Erste Schritte",\r\n' +
  '  coachingSubtitle: "Ein paar Schritte zum Einrichten dieses Projekts:",\r\n' +
  '  coachingAddTask: "Erste Aufgabe anlegen",\r\n' +
  '  coachingConfigureAi: "KI-Assistenten einrichten",\r\n' +
  '  coachingAddMilestone: "Meilenstein anlegen",\r\n' +
  '  coachingSetBudget: "Budget einrichten",\r\n';
s = s.replace(anchor, (m) => m + block);
writeFileSync(path, s, "utf8");
console.log("DE coaching keys inserted");
```

Run: `node scripts/_patch-de-coaching.mjs` → expect `DE coaching keys inserted`. If `anchor not found`, open `i18n.de.ts`, find the DE `versionHighlightMilestoneHorizon` entry, adjust the regex to its exact bytes (keep `\r\n`), re-run.

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && npm run test:run -- src/app/i18n-encoding src/app/dashboard-coaching.test.ts`
Expected: tsc clean (parity satisfied + Task-1 labelKeys valid); both test files PASS.

- [ ] **Step 5: Delete temp script**

```bash
rm scripts/_patch-de-coaching.mjs
```

- [ ] **Step 6: Commit**

```bash
git add src/app/i18n.ts src/app/i18n.de.ts
git commit -m "i18n(dashboard): coaching CTA strings (EN + DE)"
```

---

### Task 3: `dashboard-coaching-card.tsx` component

**Files:**
- Create: `src/app/dashboard-coaching-card.tsx`
- Test: `src/app/dashboard-coaching-card.test.tsx`

**Context:** `t`/`Lang` from `./i18n`; `CoachingCta` from `./dashboard-coaching`; `AppView` from `./nav-config`. i18n keys (Task 2) exist. AIPM tokens only.

- [ ] **Step 1: Write the failing test**

`src/app/dashboard-coaching-card.test.tsx`:

```tsx
import { describe, expect, test, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DashboardCoachingCard } from "./dashboard-coaching-card";
import type { CoachingCta } from "./dashboard-coaching";

const CTAS: CoachingCta[] = [
  { key: "task", labelKey: "coachingAddTask", view: "open-points" },
  { key: "ai", labelKey: "coachingConfigureAi", view: "settings" },
];

describe("DashboardCoachingCard", () => {
  test("renders nothing when ctas is empty", () => {
    const { container } = render(<DashboardCoachingCard lang="en-US" ctas={[]} onNavigate={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  test("renders the title and a button per CTA", () => {
    render(<DashboardCoachingCard lang="en-US" ctas={CTAS} onNavigate={() => {}} />);
    expect(screen.getByText("Get started")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add your first task" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Configure AI assistant" })).toBeInTheDocument();
  });

  test("clicking a CTA navigates to its view", () => {
    const onNavigate = vi.fn();
    render(<DashboardCoachingCard lang="en-US" ctas={CTAS} onNavigate={onNavigate} />);
    fireEvent.click(screen.getByRole("button", { name: "Configure AI assistant" }));
    expect(onNavigate).toHaveBeenCalledWith("settings");
  });
});
```

- [ ] **Step 2: Run, verify failure**

Run: `npm run test:run -- src/app/dashboard-coaching-card.test.tsx`
Expected: FAIL — import unresolved.

- [ ] **Step 3: Implement `src/app/dashboard-coaching-card.tsx`**

```tsx
"use client";

import { t, type Lang } from "./i18n";
import type { CoachingCta } from "./dashboard-coaching";
import type { AppView } from "./nav-config";

interface DashboardCoachingCardProps {
  lang: Lang;
  ctas: readonly CoachingCta[];
  onNavigate: (view: AppView) => void;
}

export function DashboardCoachingCard({ lang, ctas, onNavigate }: DashboardCoachingCardProps) {
  if (ctas.length === 0) return null;
  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <h3 className="text-sm font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey">{t(lang, "coachingTitle")}</h3>
      <p className="mt-0.5 text-xs text-muted-foreground">{t(lang, "coachingSubtitle")}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {ctas.map((cta) => (
          <button
            key={cta.key}
            type="button"
            onClick={() => onNavigate(cta.view)}
            className="rounded-md border border-line bg-surface px-3 py-1 text-xs font-medium text-foreground hover:bg-surface-muted hover:border-AIPM-dark-blue"
          >
            {t(lang, cta.labelKey)}
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run, verify pass**

Run: `npm run test:run -- src/app/dashboard-coaching-card.test.tsx`
Expected: PASS.

- [ ] **Step 5: Lint + tsc**

Run: `npm run lint && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/app/dashboard-coaching-card.tsx src/app/dashboard-coaching-card.test.tsx
git commit -m "feat(dashboard): coaching card component"
```

---

### Task 4: Wire into `dashboard-panel.tsx` + `workspace-section.tsx`

**Files:**
- Modify: `src/app/dashboard-panel.tsx`
- Modify: `src/app/workspace-section.tsx`
- Test: `src/app/dashboard-panel.test.tsx` (extend)

**Context:** `DashboardDeltaStrip` is rendered first in the panel's `space-y-4`, then the top-actions section. The slice-1/2 derived-values block holds `repTaskId`, `greeting`, `milestoneBuckets`. `useMemo` imported. `AppView` type is available via `nav-config` (import it).

- [ ] **Step 1: Extend `dashboard-panel.test.tsx`**

Add (the existing `baseProps` in the file have `tasks: []` → blank; `fullProps` also has `tasks: []`. Use a populated-tasks render to assert absence):

```tsx
describe("DashboardPanel coaching card", () => {
  it("shows the Get started card on a blank project (no tasks)", () => {
    render(<DashboardPanel {...fullProps} aiConfigured={false} onNavigate={vi.fn()} />, { wrapper });
    expect(screen.getByText("Get started")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add your first task" })).toBeInTheDocument();
  });

  it("hides the coaching card once a task exists", () => {
    render(
      <DashboardPanel
        {...fullProps}
        tasks={[{ id: 1, title: "T", status: "Open", linkedRaidIds: [], subtaskIds: [], parentId: null, assigneeIds: [] } as never]}
        aiConfigured={false}
        onNavigate={vi.fn()}
      />,
      { wrapper },
    );
    expect(screen.queryByText("Get started")).toBeNull();
  });

  it("navigates when a coaching CTA is clicked", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    render(<DashboardPanel {...fullProps} aiConfigured={false} onNavigate={onNavigate} />, { wrapper });
    await user.click(screen.getByRole("button", { name: "Configure AI assistant" }));
    expect(onNavigate).toHaveBeenCalledWith("settings");
  });
});
```

(`userEvent` is already imported in this test file.)

- [ ] **Step 2: Run, verify failure**

Run: `npm run test:run -- src/app/dashboard-panel.test.tsx`
Expected: FAIL — props not accepted / card absent.

- [ ] **Step 3: `dashboard-panel.tsx` — props**

In `DashboardPanelProps` (after `onOpenChange?: () => void;` from slice 1) add:

```ts
  onNavigate?: (view: AppView) => void;
  aiConfigured?: boolean;
```

- [ ] **Step 4: `dashboard-panel.tsx` — imports + compute**

Add imports:

```ts
import { computeCoaching } from "./dashboard-coaching";
import { DashboardCoachingCard } from "./dashboard-coaching-card";
import type { AppView } from "./nav-config";
```

Near the other derived values (after `milestoneBuckets`), add:

```ts
  const coachingCtas = useMemo(
    () =>
      computeCoaching({
        taskCount: props.tasks.length,
        milestoneCount: props.milestones?.length ?? 0,
        budgetCount: props.budgets.length,
        showMilestones,
        showBudget,
        aiConfigured: props.aiConfigured ?? false,
      }),
    [props.tasks.length, props.milestones, props.budgets.length, showMilestones, showBudget, props.aiConfigured],
  );
```

- [ ] **Step 5: `dashboard-panel.tsx` — render the card**

Immediately AFTER the `<DashboardDeltaStrip ... />` element and BEFORE the `{/* Top actions ... */}` block, insert:

```tsx
        <DashboardCoachingCard lang={lang} ctas={coachingCtas} onNavigate={props.onNavigate ?? (() => {})} />
```

- [ ] **Step 6: `workspace-section.tsx` — pass the new props**

At the `DashboardPanel` call site, add after the slice-1 props (`onOpenChange={...}`):

```tsx
              onNavigate={setActiveTab}
              aiConfigured={!!settings.apiKey?.trim()}
```

(`setActiveTab` is from the `useWorkspaceTab()` destructure at the top of `WorkspaceSection`; `settings` is already a prop in scope. If `setActiveTab` is not yet destructured there, add it to the existing `useWorkspaceTab()` destructure.)

- [ ] **Step 7: Run tests**

Run: `npm run test:run -- src/app/dashboard-panel.test.tsx src/app/workspace-section.test.tsx`
Expected: PASS.

- [ ] **Step 8: Full lint + tsc + unit suite**

Run: `npm run lint && npx tsc --noEmit && npm run test:run`
Expected: all green, zero warnings.

- [ ] **Step 9: Commit**

```bash
git add src/app/dashboard-panel.tsx src/app/workspace-section.tsx src/app/dashboard-panel.test.tsx
git commit -m "feat(dashboard): render first-open coaching card; wire nav + aiConfigured"
```

---

### Task 5: a11y gate + release

**Files:** `src/app/version.ts`, `CHANGELOG.md`, `README.md`, `package.json`

- [ ] **Step 1: Dashboard a11y gate**

Run: `npx playwright test e2e/a11y.spec.ts --project=chromium -g "Dashboard"`
Expected: PASS. (The live app seeds a populated project, so the coaching card is absent at scan time; CTA buttons are text-labelled regardless. Investigate + label any flagged node.)

- [ ] **Step 2: Bump `version.ts`**

- `APP_VERSION = "0.120.0"`
- `APP_BUILD_DATE = "2026-06-21"` comment `// 0.120.0 Dashboard coaching CTAs (Chiang)`
- `APP_MILESTONE = "Chiang"`; update the doc comment `0.120.x line is "Chiang" (Ted Chiang)`.
- Append `"versionHighlightCoaching",` as the LAST entry of `APP_HIGHLIGHT_KEYS` (after `"versionHighlightMilestoneHorizon",`).

- [ ] **Step 3: CHANGELOG entry**

Top of the version list:

```markdown
## [0.120.0] - 2026-06-21 "Chiang"

### Added
- **Dashboard get-started coaching.** A new project's Dashboard now shows a
  "Get started" card with one-tap setup CTAs — add your first task, configure
  the AI assistant, add a milestone, set up a budget — each jumping to the right
  view. The card self-hides once the project has any task, so it never nags an
  active project.
```

- [ ] **Step 4: README badge + package.json**

- `README.md`: bump badge `0.119.0`/`Gibson` → `0.120.0`/`Chiang` (grep `0.119.0`).
- `package.json`: `"version": "0.120.0"`.

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: PASS (prebuild docs-sync + version-highlight present + typecheck).

- [ ] **Step 6: Final verification**

Run: `npm run lint && npx tsc --noEmit && npm run test:run`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add src/app/version.ts CHANGELOG.md README.md package.json
git commit -m "release: 0.120.0 \"Chiang\" — dashboard coaching CTAs"
```

---

## After all tasks

Final branch code review, then push → GitLab MR ( (GitLab)) → poll pipeline → merge on green → sync main → delete branch.

## Self-review notes (plan vs spec)

- Engine ✓ (T1, gated on taskCount, gap detection, order). i18n ✓ (T2). Card ✓ (T3). Panel+workspace wiring ✓ (T4). Release ✓ (T5).
- Type consistency: `CoachingCta` (`{key,labelKey,view}`), `computeCoaching` input shape, `DashboardCoachingCard` props, `onNavigate(view:AppView)`, `aiConfigured` — identical across T1/T3/T4. ✓
- Ordering gotcha called out: T1's `labelKey` literals only typecheck after T2 adds the keys — T1 commits without a tsc gate; T2 closes it. Documented in T1 step 4 + T2 step 2. ✓
- No new Workspace field; two new OPTIONAL panel props (back-compat with ~30 test sites). ✓
- Nav via `setActiveTab` (the single active-view source) covers `open-points` even though tasks render in a separate section. ✓
- a11y: card buttons text-labelled; Dashboard in `A11Y_VIEWS`; live scan sees a populated project (card absent) — no new risk. ✓
- `aiConfigured = !!settings.apiKey?.trim()` — `apiKey` is the confirmed in-memory field. ✓
