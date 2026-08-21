# Help SP4 — Themed Guided Tours Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the single onboarding tour into a Help-view catalog of 6 themed guided tours (getting-started · raid · reporting · planning · stakeholders · ai), with per-tour ✓-completion tracking.

**Architecture:** A pure `TourDefinition[]` catalog layer in `app-tour.ts` wraps the existing `TourStep` model (the current flat steps become the `getting-started` tour). `use-tour.ts` tracks the active tour id and exposes `catalogTours`/`completedTours`. A new presentational `tour-catalog.tsx` renders cards in a Help-view `<details>` section, gated modern-only. `completedTours` persists in `settings` via the `writeSettings` spread.

**Tech Stack:** Next.js 16 (forked) · React 19 · TypeScript · Tailwind v4 · vitest. CI gates: `npx tsc --noEmit`, `npm run lint` (`--max-warnings=0`), `npm run test:run`.

---

## Conventions for every task

- Run from repo root `C:\Projects\lop-app`.
- After ANY test edit run `npx tsc --noEmit` (vitest does NOT typecheck tests; CI does).
- `i18n.ts` (EN) edits use the Edit tool. `i18n.de.ts` (DE) is CRLF and the Edit tool corrupts umlauts/curly-quotes — edit it via a node utf8 write (see Task 1). German must use real umlauts (the `i18n-encoding` test bans `ue`/`ae`/`oe`/`ss` substitutions); tsc enforces EN/DE key parity.
- `Lang` literal in tests is `"en-US"` (never `"en"`). DE dict is lazy — a test asserting DE output must `await loadI18n("de")` first.
- Help is NOT in the axe gate; eye-verify the catalog separately (Task 9).
- Commit after each task with the shown message.

---

## File Structure

- **Modify** `src/app/i18n.ts` — EN keys: catalog chrome (4), 6 tour titles+descs (12), 15 new-tour step title+body pairs (30). (Task 1)
- **Modify** `src/app/i18n.de.ts` — the same 46 keys in German (node utf8 write). (Task 1)
- **Modify** `src/app/app-tour.ts` — add `TourDefinition`, `TourCatalogEntry`, `TOURS`, `findTour`; re-home `TOUR_STEPS` as `getting-started.steps`; generalize `visibleSteps(steps, features)`. (Task 2)
- **Modify** `src/app/app-tour.test.ts` — fix `visibleSteps` call sites + add catalog tests. (Task 2)
- **Modify** `src/app/settings-types.ts` — `completedTours?: readonly string[]`. (Task 3)
- **Modify** `src/app/use-settings.ts` — sanitize `completedTours` on load. (Task 3)
- **Modify** `src/app/use-settings.test.ts` — round-trip test. (Task 3)
- **Modify** `src/app/use-tour.ts` — `activeTourId`, `start(id?)`, `done`→`completedTours`, `catalogTours`, `completedTours`, `activeTourTitleKey`. (Task 4)
- **Modify** `src/app/use-tour.test.tsx` — fix `visibleSteps` call + new cases. (Task 4)
- **Create** `src/app/tour-catalog.tsx` + `src/app/tour-catalog.test.tsx`. (Task 5)
- **Modify** `src/app/help-view.tsx` + `src/app/help-view.test.tsx` — Guided-tours section. (Task 6)
- **Modify** `src/app/tour-overlay.tsx` — optional `tourTitleKey`. (Task 7)
- **Modify** `src/app/task-manager.tsx`, `src/app/workspace-section.tsx`, `src/app/workspace-section-types.ts` — wiring. (Task 8)
- **Modify** `AGENTS.md` — SP4 bullet; eye-verify. (Task 9)

---

## Task 1: i18n keys (EN + DE)

**Files:**
- Modify: `src/app/i18n.ts` (after the `tourStepSettingsBody` line, currently ~2183)
- Modify: `src/app/i18n.de.ts` (after the matching DE `tourStepSettingsBody` line)

- [ ] **Step 1: Add the EN keys** — Edit `src/app/i18n.ts`, inserting these lines immediately after the `tourStepSettingsBody: "…",` entry:

```ts
  // SP4 themed-tours catalog chrome
  helpGuidedToursTitle: "Guided tours",
  helpGuidedToursIntro: "Pick a topic for a short, guided walkthrough.",
  tourStartCta: "Start tour",
  tourDoneBadge: "Done",
  // SP4 tour catalog titles + blurbs
  tourGettingStartedTitle: "Getting started",
  tourGettingStartedDesc: "A quick tour of the main areas — projects, tasks, actions, and the dashboard.",
  tourRaidTitle: "Managing risks",
  tourRaidDesc: "Track risks, assumptions, issues, and dependencies in the RAID log.",
  tourReportingTitle: "Reporting & dashboards",
  tourReportingDesc: "Read the dashboard cockpit and build composable reports.",
  tourPlanningTitle: "Planning",
  tourPlanningDesc: "Plan milestones and the Gantt timeline, and find the critical path.",
  tourStakeholdersTitle: "Stakeholders",
  tourStakeholdersDesc: "Map stakeholders, RACI, and communication.",
  tourAiTitle: "AI assistant",
  tourAiDesc: "Use Ask-Claude chat and AI action suggestions.",
  // SP4 raid tour steps
  tourStepRaidOverviewTitle: "RAID log",
  tourStepRaidOverviewBody: "Risks, assumptions, issues, and dependencies in one register — with owners, severity, and review dates.",
  tourStepRaidMatrixTitle: "The risk matrix",
  tourStepRaidMatrixBody: "Score each risk by probability × impact on the 5×5 matrix; the colour shows severity at a glance.",
  tourStepRaidReviewTitle: "Review reminders",
  tourStepRaidReviewBody: "RAID items surface in the Action Center when a review is due, so nothing goes stale.",
  // SP4 reporting tour steps
  tourStepReportDashboardTitle: "The dashboard cockpit",
  tourStepReportDashboardBody: "Your landing overview: health ratings, completion, overdue work, and the ranked next-actions queue.",
  tourStepReportReportsTitle: "Composable reports",
  tourStepReportReportsBody: "Budget, RAID, and change reports you can sort, filter, reorder, and print.",
  tourStepReportEvmTitle: "Earned value",
  tourStepReportEvmBody: "Track planned vs earned vs actual (EVM) to see whether you're ahead or behind, over or under budget.",
  // SP4 planning tour steps
  tourStepPlanMilestonesTitle: "Milestones",
  tourStepPlanMilestonesBody: "Set the dates that matter and track their health; overdue and upcoming ones surface on the dashboard horizon.",
  tourStepPlanGanttTitle: "The Gantt timeline",
  tourStepPlanGanttBody: "Drag tasks and milestones on a timeline; dependencies draw arrows between them.",
  tourStepPlanCriticalTitle: "Critical path",
  tourStepPlanCriticalBody: "Highlight the chain of tasks that drives your end date, so you know where slippage hurts most.",
  // SP4 stakeholders tour steps
  tourStepStakeRegisterTitle: "Stakeholder register",
  tourStepStakeRegisterBody: "Capture who's involved, their influence and interest, and how engaged they are.",
  tourStepStakeRaciTitle: "RACI",
  tourStepStakeRaciBody: "Mark who's Responsible, Accountable, Consulted, and Informed for the work.",
  tourStepStakeCommsTitle: "Communication",
  tourStepStakeCommsBody: "Plan and track stakeholder updates and reminders so the right people stay informed.",
  // SP4 ai tour steps
  tourStepAiChatTitle: "Ask Claude",
  tourStepAiChatBody: "Ask about this project in plain language, attach documents, or have the assistant create and update records for you.",
  tourStepAiActionsTitle: "AI action analysis",
  tourStepAiActionsBody: "Let AI review your project and suggest what to focus on next — advisory only; it never changes data on its own.",
  tourStepAiSettingsTitle: "Turn AI on",
  tourStepAiSettingsBody: "AI is off by default. Add your Anthropic key and enable it in Settings → Integrations to use these features.",
```

- [ ] **Step 2: Add the DE keys via a node utf8 write** — the Edit tool corrupts umlauts in the CRLF `i18n.de.ts`. Find the DE anchor line first:

Run: `grep -n "tourStepSettingsBody" src/app/i18n.de.ts`
Expected: one line number (the DE `tourStepSettingsBody: "…",`).

Then write a temp node script `scripts/tmp-sp4-de.mjs` and run it (it inserts after the anchor line, preserving CRLF, using `\u` escapes only where a non-ASCII char appears):

```js
import { readFileSync, writeFileSync } from "node:fs";
const path = "src/app/i18n.de.ts";
let s = readFileSync(path, "utf8");
const anchor = /(  tourStepSettingsBody: "[^"]*",\r\n)/;
if (!anchor.test(s)) throw new Error("anchor not found");
const block = [
  '  helpGuidedToursTitle: "Geführte Touren",',
  '  helpGuidedToursIntro: "Wählen Sie ein Thema für eine kurze, geführte Einführung.",',
  '  tourStartCta: "Tour starten",',
  '  tourDoneBadge: "Erledigt",',
  '  tourGettingStartedTitle: "Erste Schritte",',
  '  tourGettingStartedDesc: "Ein kurzer Rundgang durch die wichtigsten Bereiche — Projekte, Aufgaben, Aktionen und das Dashboard.",',
  '  tourRaidTitle: "Risiken managen",',
  '  tourRaidDesc: "Risiken, Annahmen, Probleme und Abhängigkeiten im RAID-Log verfolgen.",',
  '  tourReportingTitle: "Berichte & Dashboards",',
  '  tourReportingDesc: "Das Dashboard-Cockpit lesen und zusammenstellbare Berichte erstellen.",',
  '  tourPlanningTitle: "Planung",',
  '  tourPlanningDesc: "Meilensteine und die Gantt-Zeitachse planen und den kritischen Pfad finden.",',
  '  tourStakeholdersTitle: "Stakeholder",',
  '  tourStakeholdersDesc: "Stakeholder, RACI und Kommunikation abbilden.",',
  '  tourAiTitle: "KI-Assistent",',
  '  tourAiDesc: "Den Ask-Claude-Chat und KI-Aktionsvorschläge nutzen.",',
  '  tourStepRaidOverviewTitle: "RAID-Log",',
  '  tourStepRaidOverviewBody: "Risiken, Annahmen, Probleme und Abhängigkeiten in einem Register — mit Verantwortlichen, Schweregrad und Überprüfungsterminen.",',
  '  tourStepRaidMatrixTitle: "Die Risikomatrix",',
  '  tourStepRaidMatrixBody: "Bewerten Sie jedes Risiko nach Wahrscheinlichkeit × Auswirkung in der 5×5-Matrix; die Farbe zeigt den Schweregrad auf einen Blick.",',
  '  tourStepRaidReviewTitle: "Überprüfungserinnerungen",',
  '  tourStepRaidReviewBody: "RAID-Einträge erscheinen im Action Center, wenn eine Überprüfung fällig ist, damit nichts veraltet.",',
  '  tourStepReportDashboardTitle: "Das Dashboard-Cockpit",',
  '  tourStepReportDashboardBody: "Ihre Startübersicht: Gesundheits-Ampeln, Fertigstellungsgrad, überfällige Arbeit und die priorisierte Aktionsliste.",',
  '  tourStepReportReportsTitle: "Zusammenstellbare Berichte",',
  '  tourStepReportReportsBody: "Budget-, RAID- und Änderungsberichte, die Sie sortieren, filtern, umordnen und drucken können.",',
  '  tourStepReportEvmTitle: "Earned Value",',
  '  tourStepReportEvmBody: "Verfolgen Sie Plan vs. Earned vs. Ist (EVM), um zu sehen, ob Sie im Zeit- und Budgetrahmen liegen.",',
  '  tourStepPlanMilestonesTitle: "Meilensteine",',
  '  tourStepPlanMilestonesBody: "Legen Sie die wichtigen Termine fest und verfolgen Sie deren Gesundheit; überfällige und anstehende erscheinen im Dashboard-Horizont.",',
  '  tourStepPlanGanttTitle: "Die Gantt-Zeitachse",',
  '  tourStepPlanGanttBody: "Ziehen Sie Aufgaben und Meilensteine auf einer Zeitachse; Abhängigkeiten werden als Pfeile dargestellt.",',
  '  tourStepPlanCriticalTitle: "Kritischer Pfad",',
  '  tourStepPlanCriticalBody: "Heben Sie die Kette von Aufgaben hervor, die Ihren Endtermin bestimmt, damit Sie wissen, wo Verzögerungen am meisten schmerzen.",',
  '  tourStepStakeRegisterTitle: "Stakeholder-Register",',
  '  tourStepStakeRegisterBody: "Erfassen Sie, wer beteiligt ist, deren Einfluss und Interesse und wie engagiert sie sind.",',
  '  tourStepStakeRaciTitle: "RACI",',
  '  tourStepStakeRaciBody: "Markieren Sie, wer verantwortlich (R), rechenschaftspflichtig (A), konsultiert (C) und informiert (I) ist.",',
  '  tourStepStakeCommsTitle: "Kommunikation",',
  '  tourStepStakeCommsBody: "Planen und verfolgen Sie Stakeholder-Updates und Erinnerungen, damit die richtigen Personen informiert bleiben.",',
  '  tourStepAiChatTitle: "Ask Claude",',
  '  tourStepAiChatBody: "Fragen Sie in natürlicher Sprache zu diesem Projekt, hängen Sie Dokumente an oder lassen Sie den Assistenten Einträge erstellen und aktualisieren.",',
  '  tourStepAiActionsTitle: "KI-Aktionsanalyse",',
  '  tourStepAiActionsBody: "Lassen Sie die KI Ihr Projekt prüfen und vorschlagen, worauf Sie sich als Nächstes konzentrieren sollten — nur beratend; sie ändert nie selbst Daten.",',
  '  tourStepAiSettingsTitle: "KI aktivieren",',
  '  tourStepAiSettingsBody: "KI ist standardmäßig aus. Fügen Sie Ihren Anthropic-Schlüssel hinzu und aktivieren Sie sie unter Einstellungen → Integrationen.",',
].join("\r\n") + "\r\n";
s = s.replace(anchor, (m) => m + block);
writeFileSync(path, s, "utf8");
console.log("DE keys inserted");
```

Run: `node scripts/tmp-sp4-de.mjs` → expect `DE keys inserted`. Then delete the temp script: `rm scripts/tmp-sp4-de.mjs`.

- [ ] **Step 3: Verify parity + encoding + umlauts intact**

Run: `npx tsc --noEmit`
Expected: PASS (EN/DE key parity holds; no missing `TranslationKey`).

Run: `npx vitest run i18n-encoding`
Expected: PASS (no ASCII umlaut substitutions).

Run: `grep -n "Gef\xc3\xbchrte Touren\|standardm\xc3\xa4\xc3\x9fig" src/app/i18n.de.ts` (or visually re-open the file) — expect the umlauts/ß render correctly, not mojibake.

- [ ] **Step 4: Commit**

```bash
git add src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat(help): add SP4 themed-tours i18n (catalog chrome, 6 tours, new steps) EN+DE"
```

---

## Task 2: Engine — TourDefinition / TOURS / findTour / visibleSteps refactor

**Files:**
- Modify: `src/app/app-tour.ts`
- Modify: `src/app/app-tour.test.ts`

- [ ] **Step 1: Update the failing tests first** — replace `src/app/app-tour.test.ts` entirely with:

```ts
import { describe, expect, it } from "vitest";
import { TOUR_STEPS, TOURS, findTour, visibleSteps, clampStep } from "./app-tour";
import type { AppView } from "./nav-config";

const ALL = ["dashboard", "milestones", "resources", "raid", "changes", "stakeholders", "budget"] as const;

describe("app-tour engine", () => {
  it("getting-started is first and its steps === TOUR_STEPS", () => {
    expect(TOURS[0].id).toBe("getting-started");
    expect(findTour("getting-started")?.steps).toBe(TOUR_STEPS);
    expect(TOUR_STEPS[0].id).toBe("welcome");
  });
  it("ships the six themed tours with unique ids and at least one step each", () => {
    const ids = TOURS.map((t) => t.id);
    expect(ids).toEqual(["getting-started", "raid", "reporting", "planning", "stakeholders", "ai"]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const t of TOURS) expect(t.steps.length).toBeGreaterThan(0);
  });
  it("every step view (when set) is a valid AppView used by other tours", () => {
    const valid = new Set<AppView>(["dashboard", "projects", "open-points", "actions", "chat", "reports", "raid", "milestones", "stakeholders", "steering-committee", "settings"]);
    for (const t of TOURS) for (const s of t.steps) if (s.view) expect(valid.has(s.view)).toBe(true);
  });
  it("findTour returns undefined for an unknown id", () => {
    expect(findTour("nope")).toBeUndefined();
  });
  it("visibleSteps(steps, features) keeps all when modules enabled, drops disabled-module steps", () => {
    expect(visibleSteps(TOUR_STEPS, [...ALL]).length).toBe(TOUR_STEPS.length);
    const none = visibleSteps(TOUR_STEPS, []);
    expect(none.some((s) => s.id === "welcome")).toBe(true); // no-view step survives
    expect(none.length).toBeLessThan(TOUR_STEPS.length);
    // a fully module-gated tour collapses to 0 visible steps
    expect(visibleSteps(findTour("raid")!.steps, []).length).toBe(0);
  });
  it("clampStep bounds the index", () => {
    expect(clampStep(-1, 5)).toBe(0);
    expect(clampStep(9, 5)).toBe(4);
    expect(clampStep(0, 0)).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run app-tour`
Expected: FAIL (`TOURS`/`findTour` not exported; `visibleSteps` arity).

- [ ] **Step 3: Implement the engine** — replace `src/app/app-tour.ts` entirely with:

```ts
// src/app/app-tour.ts — pure, i18n-free guided-tour engine (keys only; no React/Date).
import type { TranslationKey } from "./i18n";
import type { AppView } from "./nav-config";
import { isViewEnabled } from "./feature-modules";
import type { FeatureModuleId } from "./feature-modules";

export type TourStepKind = "modal" | "spotlight";

export interface TourStep {
  id: string;
  kind: TourStepKind;
  titleKey: TranslationKey;
  bodyKey: TranslationKey;
  view?: AppView;
  anchorId?: string;
}

/** A themed tour: a named, described, ordered list of steps. */
export interface TourDefinition {
  id: string;
  titleKey: TranslationKey;
  descKey: TranslationKey;
  steps: readonly TourStep[];
}

/** The catalog projection the Help-view picker renders (no steps). */
export interface TourCatalogEntry {
  id: string;
  titleKey: TranslationKey;
  descKey: TranslationKey;
}

export const TOUR_ANCHORS = {
  navTasks: "tour-nav-tasks",
  navActions: "tour-nav-actions",
  askClaude: "tour-ask-claude",
  projectSwitcher: "tour-project-switcher",
} as const;

// The original onboarding walkthrough — now the "getting-started" tour's steps.
export const TOUR_STEPS: readonly TourStep[] = [
  { id: "welcome", kind: "modal", titleKey: "tourStepWelcomeTitle", bodyKey: "tourStepWelcomeBody" },
  { id: "projects", kind: "spotlight", titleKey: "tourStepProjectsTitle", bodyKey: "tourStepProjectsBody", view: "projects", anchorId: TOUR_ANCHORS.projectSwitcher },
  { id: "tasks", kind: "spotlight", titleKey: "tourStepTasksTitle", bodyKey: "tourStepTasksBody", view: "open-points", anchorId: TOUR_ANCHORS.navTasks },
  { id: "actions", kind: "spotlight", titleKey: "tourStepActionsTitle", bodyKey: "tourStepActionsBody", view: "actions", anchorId: TOUR_ANCHORS.navActions },
  { id: "chat", kind: "spotlight", titleKey: "tourStepChatTitle", bodyKey: "tourStepChatBody", view: "chat", anchorId: TOUR_ANCHORS.askClaude },
  { id: "dashboard", kind: "modal", titleKey: "tourStepDashboardTitle", bodyKey: "tourStepDashboardBody", view: "dashboard" },
  { id: "reports", kind: "modal", titleKey: "tourStepReportsTitle", bodyKey: "tourStepReportsBody", view: "reports" },
  { id: "raid", kind: "modal", titleKey: "tourStepRaidTitle", bodyKey: "tourStepRaidBody", view: "raid" },
  { id: "milestones", kind: "modal", titleKey: "tourStepMilestonesTitle", bodyKey: "tourStepMilestonesBody", view: "milestones" },
  { id: "stakeholders", kind: "modal", titleKey: "tourStepStakeholdersTitle", bodyKey: "tourStepStakeholdersBody", view: "stakeholders" },
  { id: "steering", kind: "modal", titleKey: "tourStepSteeringTitle", bodyKey: "tourStepSteeringBody", view: "steering-committee" },
  { id: "settings", kind: "modal", titleKey: "tourStepSettingsTitle", bodyKey: "tourStepSettingsBody", view: "settings" },
];

const RAID_STEPS: readonly TourStep[] = [
  { id: "raid-overview", kind: "modal", titleKey: "tourStepRaidOverviewTitle", bodyKey: "tourStepRaidOverviewBody", view: "raid" },
  { id: "raid-matrix", kind: "modal", titleKey: "tourStepRaidMatrixTitle", bodyKey: "tourStepRaidMatrixBody", view: "raid" },
  { id: "raid-review", kind: "modal", titleKey: "tourStepRaidReviewTitle", bodyKey: "tourStepRaidReviewBody", view: "raid" },
];

const REPORTING_STEPS: readonly TourStep[] = [
  { id: "report-dashboard", kind: "modal", titleKey: "tourStepReportDashboardTitle", bodyKey: "tourStepReportDashboardBody", view: "dashboard" },
  { id: "report-reports", kind: "modal", titleKey: "tourStepReportReportsTitle", bodyKey: "tourStepReportReportsBody", view: "reports" },
  { id: "report-evm", kind: "modal", titleKey: "tourStepReportEvmTitle", bodyKey: "tourStepReportEvmBody", view: "reports" },
];

const PLANNING_STEPS: readonly TourStep[] = [
  { id: "plan-milestones", kind: "modal", titleKey: "tourStepPlanMilestonesTitle", bodyKey: "tourStepPlanMilestonesBody", view: "milestones" },
  { id: "plan-gantt", kind: "modal", titleKey: "tourStepPlanGanttTitle", bodyKey: "tourStepPlanGanttBody", view: "milestones" },
  { id: "plan-critical", kind: "modal", titleKey: "tourStepPlanCriticalTitle", bodyKey: "tourStepPlanCriticalBody", view: "milestones" },
];

const STAKEHOLDER_STEPS: readonly TourStep[] = [
  { id: "stake-register", kind: "modal", titleKey: "tourStepStakeRegisterTitle", bodyKey: "tourStepStakeRegisterBody", view: "stakeholders" },
  { id: "stake-raci", kind: "modal", titleKey: "tourStepStakeRaciTitle", bodyKey: "tourStepStakeRaciBody", view: "stakeholders" },
  { id: "stake-comms", kind: "modal", titleKey: "tourStepStakeCommsTitle", bodyKey: "tourStepStakeCommsBody", view: "stakeholders" },
];

const AI_STEPS: readonly TourStep[] = [
  { id: "ai-chat", kind: "modal", titleKey: "tourStepAiChatTitle", bodyKey: "tourStepAiChatBody", view: "chat" },
  { id: "ai-actions", kind: "modal", titleKey: "tourStepAiActionsTitle", bodyKey: "tourStepAiActionsBody", view: "actions" },
  { id: "ai-settings", kind: "modal", titleKey: "tourStepAiSettingsTitle", bodyKey: "tourStepAiSettingsBody", view: "settings" },
];

export const TOURS: readonly TourDefinition[] = [
  { id: "getting-started", titleKey: "tourGettingStartedTitle", descKey: "tourGettingStartedDesc", steps: TOUR_STEPS },
  { id: "raid", titleKey: "tourRaidTitle", descKey: "tourRaidDesc", steps: RAID_STEPS },
  { id: "reporting", titleKey: "tourReportingTitle", descKey: "tourReportingDesc", steps: REPORTING_STEPS },
  { id: "planning", titleKey: "tourPlanningTitle", descKey: "tourPlanningDesc", steps: PLANNING_STEPS },
  { id: "stakeholders", titleKey: "tourStakeholdersTitle", descKey: "tourStakeholdersDesc", steps: STAKEHOLDER_STEPS },
  { id: "ai", titleKey: "tourAiTitle", descKey: "tourAiDesc", steps: AI_STEPS },
];

export function findTour(id: string): TourDefinition | undefined {
  return TOURS.find((t) => t.id === id);
}

/** Drop steps whose deep-link view belongs to a disabled feature module, so a
 *  tour never navigates to a hidden view. Steps without a `view` always survive. */
export function visibleSteps(steps: readonly TourStep[], features: readonly FeatureModuleId[]): TourStep[] {
  return steps.filter((s) => s.view === undefined || isViewEnabled(s.view, features));
}

/** Bound an index to [0, total-1]; returns 0 for an empty list. */
export function clampStep(index: number, total: number): number {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(index, total - 1));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run app-tour`
Expected: PASS.

Run: `npx tsc --noEmit`
Expected: FAIL — `use-tour.ts` still calls `visibleSteps(features)` (single-arg). This is expected; fixed in Task 4. (Do NOT touch use-tour here; commit the engine.)

- [ ] **Step 5: Commit**

```bash
git add src/app/app-tour.ts src/app/app-tour.test.ts
git commit -m "feat(tour): add themed-tour catalog (TOURS/findTour) + generalize visibleSteps"
```

---

## Task 3: Settings — completedTours field + load sanitize

**Files:**
- Modify: `src/app/settings-types.ts:430` (after `tourSeen?: boolean;`)
- Modify: `src/app/use-settings.ts` (the `merged` object, ~line 263)
- Modify: `src/app/use-settings.test.ts`

- [ ] **Step 1: Write the failing test** — add to `src/app/use-settings.test.ts` inside the existing top-level `describe` (near the `tourSeen` round-trip test ~line 131):

```ts
    it("completedTours round-trips and drops non-strings on load", async () => {
      writeSettings({ ...defaultSettings, completedTours: ["raid", "reporting"] });
      const { result } = renderHook(() => useSettings());
      await waitFor(() => expect(result.current.hydrated).toBe(true));
      expect(result.current.settings.completedTours).toEqual(["raid", "reporting"]);
    });
```

(If the file's existing tests use a different hydration-wait idiom, mirror it — copy the wait pattern from the adjacent `tourSeen` test verbatim.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run use-settings`
Expected: FAIL (`completedTours` not on `Settings` / stripped on load).

- [ ] **Step 3a: Add the field** — Edit `src/app/settings-types.ts`, after line 430 (`tourSeen?: boolean;`):

```ts
  /** Per-device: ids of guided tours the user has completed (✓ badge in the
   *  Help catalog). Separate from `tourSeen` (which gates first-run auto-launch). */
  completedTours?: readonly string[];
```

- [ ] **Step 3b: Sanitize on load** — Edit `src/app/use-settings.ts`. In the `merged` object (the block ending ~line 263 with `branding:`), add this property (mirrors the `holidayCountries` array-filter at ~243-247):

```ts
            completedTours: Array.isArray((parsed as Record<string, unknown>).completedTours)
              ? Array.from(
                  new Set(
                    ((parsed as Record<string, unknown>).completedTours as unknown[]).filter(
                      (v): v is string => typeof v === "string",
                    ),
                  ),
                ).slice(0, 50)
              : undefined,
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run use-settings`
Expected: PASS.

Run: `npx tsc --noEmit`
Expected: still FAIL only in `use-tour.ts` (Task 4) — no new errors here.

- [ ] **Step 5: Commit**

```bash
git add src/app/settings-types.ts src/app/use-settings.ts src/app/use-settings.test.ts
git commit -m "feat(settings): persist per-device completedTours (Help tour catalog)"
```

---

## Task 4: use-tour — active tour, start(id), completion, catalog projection

**Files:**
- Modify: `src/app/use-tour.ts`
- Modify: `src/app/use-tour.test.tsx`

- [ ] **Step 1: Update the tests** — replace `src/app/use-tour.test.tsx` entirely with:

```ts
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTour } from "./use-tour";
import { TOUR_STEPS, visibleSteps, findTour } from "./app-tour";

const FEATURES = ["dashboard", "milestones", "resources", "raid", "changes", "stakeholders", "budget"] as const;
const base = { features: [...FEATURES] };

describe("useTour", () => {
  it("auto-launches getting-started once in modern, non-popout, unseen", () => {
    const setSettings = vi.fn();
    const { result } = renderHook(() =>
      useTour({ layout: "modern", isPopout: false, hydrated: true, tourSeen: false, completedTours: undefined, ...base, setSettings }));
    expect(result.current.isOpen).toBe(true);
    expect(result.current.index).toBe(0);
    expect(result.current.steps.length).toBe(TOUR_STEPS.length);
  });
  it("does NOT auto-launch in classic / popout / when seen / before hydration", () => {
    const setSettings = vi.fn();
    for (const args of [
      { layout: "classic" as const, isPopout: false, hydrated: true, tourSeen: false },
      { layout: "modern" as const, isPopout: true, hydrated: true, tourSeen: false },
      { layout: "modern" as const, isPopout: false, hydrated: true, tourSeen: true },
      { layout: "modern" as const, isPopout: false, hydrated: false, tourSeen: false },
    ]) {
      const { result } = renderHook(() => useTour({ ...args, completedTours: undefined, ...base, setSettings }));
      expect(result.current.isOpen).toBe(false);
    }
  });
  it("start(id) activates a themed tour at index 0", () => {
    const setSettings = vi.fn();
    const { result } = renderHook(() =>
      useTour({ layout: "modern", isPopout: false, hydrated: true, tourSeen: true, completedTours: undefined, ...base, setSettings }));
    act(() => { result.current.start("raid"); });
    expect(result.current.isOpen).toBe(true);
    expect(result.current.index).toBe(0);
    expect(result.current.steps.length).toBe(findTour("raid")!.steps.length);
    expect(result.current.activeTourTitleKey).toBe("tourRaidTitle");
  });
  it("done appends the active tour id to completedTours and sets tourSeen", () => {
    const setSettings = vi.fn();
    const { result } = renderHook(() =>
      useTour({ layout: "modern", isPopout: false, hydrated: true, tourSeen: true, completedTours: ["raid"], ...base, setSettings }));
    act(() => { result.current.start("reporting"); });
    act(() => { result.current.done(); });
    expect(result.current.isOpen).toBe(false);
    const updater = setSettings.mock.calls.at(-1)![0];
    const out = updater({ tourSeen: false, completedTours: ["raid"] });
    expect(out.tourSeen).toBe(true);
    expect(out.completedTours).toEqual(["raid", "reporting"]);
  });
  it("skip sets tourSeen only (no completion badge)", () => {
    const setSettings = vi.fn();
    const { result } = renderHook(() =>
      useTour({ layout: "modern", isPopout: false, hydrated: true, tourSeen: false, completedTours: undefined, ...base, setSettings }));
    act(() => { result.current.skip(); });
    const updater = setSettings.mock.calls.at(-1)![0];
    const out = updater({ tourSeen: false, completedTours: ["raid"] });
    expect(out.tourSeen).toBe(true);
    expect(out.completedTours).toEqual(["raid"]); // unchanged
  });
  it("catalogTours lists tours with >=1 visible step; completedTours passes through", () => {
    const setSettings = vi.fn();
    const { result } = renderHook(() =>
      useTour({ layout: "modern", isPopout: false, hydrated: true, tourSeen: true, completedTours: ["ai"], ...base, setSettings }));
    expect(result.current.catalogTours.map((t) => t.id)).toEqual(["getting-started", "raid", "reporting", "planning", "stakeholders", "ai"]);
    expect(result.current.completedTours).toEqual(["ai"]);
  });
  it("catalogTours drops a tour gated to 0 visible steps", () => {
    const setSettings = vi.fn();
    const { result } = renderHook(() =>
      useTour({ layout: "modern", isPopout: false, hydrated: true, tourSeen: true, completedTours: undefined, features: [], setSettings }));
    // raid/reporting/planning/stakeholders/ai all deep-link disabled views -> dropped;
    // getting-started keeps its no-view "welcome" step -> survives.
    expect(result.current.catalogTours.some((t) => t.id === "raid")).toBe(false);
    expect(result.current.catalogTours.some((t) => t.id === "getting-started")).toBe(true);
  });
  it("next/back clamp within the visible steps", () => {
    const setSettings = vi.fn();
    const { result } = renderHook(() =>
      useTour({ layout: "modern", isPopout: false, hydrated: true, tourSeen: true, completedTours: undefined, ...base, setSettings }));
    act(() => { result.current.start(); });
    act(() => { result.current.back(); });
    expect(result.current.index).toBe(0);
    const last = visibleSteps(TOUR_STEPS, [...FEATURES]).length - 1;
    for (let k = 0; k < 50; k++) act(() => { result.current.next(); });
    expect(result.current.index).toBe(last);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run use-tour`
Expected: FAIL (`completedTours` arg / `start(id)` / `activeTourTitleKey` / `catalogTours` missing).

- [ ] **Step 3: Implement** — replace `src/app/use-tour.ts` entirely with:

```ts
"use client";

// Guided-tour open/index/active-tour state + per-device tourSeen + completedTours,
// plus the render-time auto-launch (NO useEffect setState — banned). Modern-shell only.
import { useCallback, useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { TranslationKey } from "./i18n";
import { clampStep, visibleSteps, findTour, TOURS, type TourStep, type TourCatalogEntry } from "./app-tour";
import type { FeatureModuleId } from "./feature-modules";
import type { Settings } from "./settings-types";

const DEFAULT_TOUR_ID = "getting-started";

interface UseTourArgs {
  layout: "modern" | "classic";
  isPopout: boolean;
  hydrated: boolean;
  tourSeen: boolean | undefined;
  completedTours: readonly string[] | undefined;
  features: readonly FeatureModuleId[];
  setSettings: Dispatch<SetStateAction<Settings>>;
}

export interface UseTour {
  isOpen: boolean;
  index: number;
  steps: TourStep[];
  activeTourTitleKey: TranslationKey;
  catalogTours: TourCatalogEntry[];
  completedTours: readonly string[];
  start: (tourId?: string) => void;
  next: () => void;
  back: () => void;
  skip: () => void;
  done: () => void;
  showMe: (step: TourStep, navigate: (view: NonNullable<TourStep["view"]>) => void) => void;
}

export function useTour({ layout, isPopout, hydrated, tourSeen, completedTours, features, setSettings }: UseTourArgs): UseTour {
  const [isOpen, setIsOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [activeTourId, setActiveTourId] = useState<string>(DEFAULT_TOUR_ID);
  const [autoHandled, setAutoHandled] = useState(false);

  const activeTour = findTour(activeTourId) ?? TOURS[0];
  const steps = useMemo(() => visibleSteps(activeTour.steps, features), [activeTour, features]);

  const catalogTours = useMemo<TourCatalogEntry[]>(
    () =>
      TOURS.filter((t) => visibleSteps(t.steps, features).length > 0).map((t) => ({
        id: t.id,
        titleKey: t.titleKey,
        descKey: t.descKey,
      })),
    [features],
  );

  // Render-time auto-launch (guarded; runs once). NOT a useEffect. Launches the
  // default (getting-started) tour, which is already the active tour at mount.
  const eligible = hydrated && layout === "modern" && !isPopout && !tourSeen && steps.length > 0;
  if (eligible && !autoHandled) {
    setAutoHandled(true);
    setIsOpen(true);
    setIndex(0);
  }

  const start = useCallback((tourId?: string) => {
    setActiveTourId(tourId ?? DEFAULT_TOUR_ID);
    setIndex(0);
    setIsOpen(true);
  }, []);
  const next = useCallback(() => setIndex((k) => clampStep(k + 1, steps.length)), [steps.length]);
  const back = useCallback(() => setIndex((k) => clampStep(k - 1, steps.length)), [steps.length]);
  const skip = useCallback(() => {
    setIsOpen(false);
    setSettings((s) => ({ ...s, tourSeen: true }));
  }, [setSettings]);
  const done = useCallback(() => {
    setIsOpen(false);
    setActiveTourId((id) => {
      setSettings((s) => ({
        ...s,
        tourSeen: true,
        completedTours: Array.from(new Set([...(s.completedTours ?? []), id])),
      }));
      return id;
    });
  }, [setSettings]);
  const showMe = useCallback((step: TourStep, navigate: (view: NonNullable<TourStep["view"]>) => void) => {
    if (step.view) navigate(step.view);
  }, []);

  return {
    isOpen,
    index,
    steps,
    activeTourTitleKey: activeTour.titleKey,
    catalogTours,
    completedTours: completedTours ?? [],
    start,
    next,
    back,
    skip,
    done,
    showMe,
  };
}
```

> Note on `done`: it reads the live `activeTourId` via the `setActiveTourId` updater form (returning the same id) so the completion write always sees the current tour without adding `activeTourId` to the `useCallback` deps (keeps the handler stable, mirrors the existing bare-function ethos).

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run use-tour`
Expected: PASS.

Run: `npx tsc --noEmit`
Expected: FAIL only in `task-manager.tsx` (the `useTour` call lacks `completedTours`) — fixed in Task 8. No other errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/use-tour.ts src/app/use-tour.test.tsx
git commit -m "feat(tour): active-tour state, start(id), completion tracking, catalog projection"
```

---

## Task 5: TourCatalog presentational component

**Files:**
- Create: `src/app/tour-catalog.tsx`
- Create: `src/app/tour-catalog.test.tsx`

- [ ] **Step 1: Write the failing test** — create `src/app/tour-catalog.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TourCatalog } from "./tour-catalog";

const TOURS = [
  { id: "getting-started", titleKey: "tourGettingStartedTitle", descKey: "tourGettingStartedDesc" },
  { id: "raid", titleKey: "tourRaidTitle", descKey: "tourRaidDesc" },
] as const;

describe("TourCatalog", () => {
  it("renders one card per tour", () => {
    render(<TourCatalog lang="en-US" tours={[...TOURS]} completedTours={[]} onStartTour={() => {}} />);
    expect(screen.getByText("Getting started")).toBeInTheDocument();
    expect(screen.getByText("Managing risks")).toBeInTheDocument();
  });
  it("shows the Done badge for a completed tour", () => {
    render(<TourCatalog lang="en-US" tours={[...TOURS]} completedTours={["raid"]} onStartTour={() => {}} />);
    expect(screen.getAllByText("Done").length).toBe(1);
  });
  it("fires onStartTour with the tour id when a card is clicked", () => {
    const onStart = vi.fn();
    render(<TourCatalog lang="en-US" tours={[...TOURS]} completedTours={[]} onStartTour={onStart} />);
    fireEvent.click(screen.getByRole("button", { name: /managing risks/i }));
    expect(onStart).toHaveBeenCalledWith("raid");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run tour-catalog`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement** — create `src/app/tour-catalog.tsx`:

```tsx
"use client";

// Presentational guided-tour catalog (Help SP4). Props-only (no context) so it
// unit-tests standalone, mirroring relations-map.tsx / view-callout.tsx. Each tour
// is a single clickable card; a completed tour shows a ✓ Done badge.
import { type Lang, t } from "./i18n";
import type { TourCatalogEntry } from "./app-tour";
import { INTERACTIVE } from "./interaction-styles";

export interface TourCatalogProps {
  lang: Lang;
  tours: readonly TourCatalogEntry[];
  completedTours: readonly string[];
  onStartTour: (id: string) => void;
}

export function TourCatalog({ lang, tours, completedTours, onStartTour }: TourCatalogProps) {
  const done = new Set(completedTours);
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {tours.map((tour) => {
        const isDone = done.has(tour.id);
        return (
          <button
            key={tour.id}
            type="button"
            onClick={() => onStartTour(tour.id)}
            aria-label={`${t(lang, "tourStartCta")} – ${t(lang, tour.titleKey)}`}
            className={`flex flex-col gap-1 rounded-md border border-line bg-surface p-3 text-left hover:border-AIPM-dark-blue hover:bg-surface-muted ${INTERACTIVE}`}
          >
            <span className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-foreground">{t(lang, tour.titleKey)}</span>
              {isDone && (
                <span className="shrink-0 rounded-full bg-AIPM-green/15 px-2 py-0.5 text-[10px] font-medium text-AIPM-green-text">
                  <span aria-hidden="true">✓ </span>
                  {t(lang, "tourDoneBadge")}
                </span>
              )}
            </span>
            <span className="text-xs text-muted-foreground">{t(lang, tour.descKey)}</span>
            <span className="mt-1 text-xs font-medium text-AIPM-dark-blue dark:text-AIPM-light-grey">
              {t(lang, "tourStartCta")} →
            </span>
          </button>
        );
      })}
    </div>
  );
}
```

> Palette note: `text-AIPM-green-text` is the AA RAG token (verify it exists in `globals.css`/the token set; if the project uses `text-AIPM-green-strong` for AA green text instead, use that). The `→` and `✓` glyphs are decorative — `✓` is `aria-hidden`; the `→` rides inside the button whose `aria-label` already names the action.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run tour-catalog`
Expected: PASS.

Run: `npx tsc --noEmit`
Expected: no NEW errors from this file (the pre-existing task-manager error from Task 4 remains until Task 8).

- [ ] **Step 5: Commit**

```bash
git add src/app/tour-catalog.tsx src/app/tour-catalog.test.tsx
git commit -m "feat(help): add TourCatalog card grid (SP4)"
```

---

## Task 6: Help-view "Guided tours" section

**Files:**
- Modify: `src/app/help-view.tsx`
- Modify: `src/app/help-view.test.tsx`

- [ ] **Step 1: Write the failing test** — add to `src/app/help-view.test.tsx` inside the existing `describe`:

```tsx
  it("renders the Guided tours section only when onStartTour is provided", () => {
    const { rerender } = render(<HelpView lang="en-US" />);
    expect(screen.queryByText("Guided tours")).toBeNull();
    rerender(
      <HelpView
        lang="en-US"
        onStartTour={() => {}}
        catalogTours={[{ id: "raid", titleKey: "tourRaidTitle", descKey: "tourRaidDesc" }]}
        completedTours={[]}
      />,
    );
    expect(screen.getByText("Guided tours")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /managing risks/i })).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run help-view`
Expected: FAIL (`onStartTour`/`catalogTours` not props; "Guided tours" absent).

- [ ] **Step 3a: Add imports + props** — Edit `src/app/help-view.tsx`. Add to the import block (after the `RelationsMap` import on line 9):

```ts
import { TourCatalog } from "./tour-catalog";
import type { TourCatalogEntry } from "./app-tour";
```

Extend the `HelpView` prop type (after the `onNavigateView?` prop, ~line 49):

```ts
  /** Launch a themed tour by id (SP4). Present only in modern, non-popout. */
  onStartTour?: (id: string) => void;
  /** Tours available under the current feature set (SP4). */
  catalogTours?: readonly TourCatalogEntry[];
  /** Ids of completed tours, for the ✓ badge (SP4). */
  completedTours?: readonly string[];
```

And add them to the destructure (alongside `onNavigateView`):

```ts
  onStartTour,
  catalogTours,
  completedTours,
```

- [ ] **Step 3b: Render the section** — Edit `src/app/help-view.tsx`. Immediately BEFORE the existing relations-map `<details open className="mb-2 shrink-0 print:hidden">` (the SP3 "How it all connects" block, ~line 108), insert:

```tsx
      {onStartTour && (
        <details open className="mb-2 shrink-0 print:hidden">
          <summary className={`cursor-pointer text-sm font-medium text-foreground ${FOCUS_RING}`}>
            {t(lang, "helpGuidedToursTitle")}
          </summary>
          <p className="mb-2 mt-1 text-xs text-muted-foreground">{t(lang, "helpGuidedToursIntro")}</p>
          <TourCatalog
            lang={lang}
            tours={catalogTours ?? []}
            completedTours={completedTours ?? []}
            onStartTour={onStartTour}
          />
        </details>
      )}
```

(`FOCUS_RING` is already imported in help-view.tsx.)

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run help-view`
Expected: PASS.

Run: `npx tsc --noEmit`
Expected: no NEW errors (task-manager error from Task 4 still pending until Task 8).

- [ ] **Step 5: Commit**

```bash
git add src/app/help-view.tsx src/app/help-view.test.tsx
git commit -m "feat(help): Guided tours section in Help view (SP4)"
```

---

## Task 7: TourOverlay — optional tour title label

**Files:**
- Modify: `src/app/tour-overlay.tsx`

- [ ] **Step 1: Add the optional prop** — Edit `src/app/tour-overlay.tsx`. Add to `TourOverlayProps` (after `lang: Lang;`):

```ts
  /** When set, the active tour's title shows as a small label above the step (SP4). */
  tourTitleKey?: TranslationKey;
```

Add the import for the type at the top (extend the existing i18n import):

```ts
import { type Lang, type TranslationKey, t } from "./i18n";
```

(Replace the current `import { type Lang, t } from "./i18n";` line.)

Add `tourTitleKey` to the destructured params of `TourOverlay({ ... })`.

- [ ] **Step 2: Render it** — inside the dialog `<div>`, immediately BEFORE the dots row (`<div className="mb-2 flex items-center gap-1" aria-hidden="true">`), insert:

```tsx
        {tourTitleKey && (
          <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {t(lang, tourTitleKey)}
          </p>
        )}
```

- [ ] **Step 3: Verify existing overlay tests still pass** (they pass no `tourTitleKey`, so the label is absent — unchanged behavior).

Run: `npx vitest run tour-overlay`
Expected: PASS.

Run: `npx tsc --noEmit`
Expected: no NEW errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/tour-overlay.tsx
git commit -m "feat(tour): show active tour title in the overlay (SP4)"
```

---

## Task 8: Wiring — task-manager + workspace-section

**Files:**
- Modify: `src/app/task-manager.tsx` (the `useTour` call ~931; the `<TourOverlay>` render ~2316; the `<WorkspaceSection>` render)
- Modify: `src/app/workspace-section-types.ts` (`WorkspaceSectionProps`)
- Modify: `src/app/workspace-section.tsx` (the `<HelpView>` render)

- [ ] **Step 1: Pass `completedTours` into useTour** — Edit `src/app/task-manager.tsx`, the `useTour({...})` call (~931). Add the arg:

```ts
    completedTours: settings.completedTours,
```

(Add it alongside `tourSeen: settings.tourSeen,`.)

- [ ] **Step 2: Pass the title key into the overlay** — Edit the `<TourOverlay ... />` render (~2316). Add the prop:

```tsx
          tourTitleKey={tour.activeTourTitleKey}
```

- [ ] **Step 3: Add the WorkspaceSectionProps fields** — Edit `src/app/workspace-section-types.ts`. Add to the `WorkspaceSectionProps` interface (optional, so existing callers/tests are unaffected):

```ts
  /** SP4 themed tours: launch a tour by id (Help view); modern non-popout only. */
  onStartTour?: (id: string) => void;
  /** SP4: tours available under the current feature set. */
  catalogTours?: readonly import("./app-tour").TourCatalogEntry[];
  /** SP4: completed tour ids (for the ✓ badge). */
  completedTours?: readonly string[];
```

> If `workspace-section-types.ts` prefers top-of-file imports over inline `import("…")`, add `import type { TourCatalogEntry } from "./app-tour";` at the top and use `readonly TourCatalogEntry[]` instead.

- [ ] **Step 4: Thread task-manager → WorkspaceSection** — Edit `src/app/task-manager.tsx`. In the `<WorkspaceSection ... />` render (find it by searching `<WorkspaceSection`), add:

```tsx
        onStartTour={settings.layout === "modern" && !isPopout ? tour.start : undefined}
        catalogTours={tour.catalogTours}
        completedTours={tour.completedTours}
```

- [ ] **Step 5: Thread WorkspaceSection → HelpView** — Edit `src/app/workspace-section.tsx`. Find the `<HelpView ... />` render (it already passes `onNavigateView={(v) => setActiveTab(v)}`). Add:

```tsx
            onStartTour={props.onStartTour}
            catalogTours={props.catalogTours}
            completedTours={props.completedTours}
```

> Match the existing prop-access idiom in that file — if it destructures props (e.g. `onNavigateView` came from a destructure rather than `props.`), use the same form for these three.

- [ ] **Step 6: Full typecheck + targeted tests**

Run: `npx tsc --noEmit`
Expected: PASS (all Task-4 pending errors now resolved).

Run: `npx vitest run app-tour use-tour tour-catalog help-view tour-overlay use-settings`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app/task-manager.tsx src/app/workspace-section.tsx src/app/workspace-section-types.ts
git commit -m "feat(help): wire themed-tour catalog through task-manager + workspace-section (SP4)"
```

---

## Task 9: Docs + full gates + eye-verify

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1: Add the AGENTS.md bullet** — Edit `AGENTS.md`. After the "Interactive relations map (Help SP3)" bullet, add:

```markdown
  • **Themed guided tours (Help SP4):** the single onboarding tour became a CATALOG of 6 themed
  tours (`getting-started` · `raid` · `reporting` · `planning` · `stakeholders` · `ai`). Pure engine
  `app-tour.ts` gained `TourDefinition`/`TourCatalogEntry`/`TOURS`/`findTour`; the old flat `TOUR_STEPS`
  is KEPT as an export (= `getting-started`'s steps; `tour-overlay.test` imports it). `visibleSteps`
  is now `(steps, features)` (was `(features)`) — drops a step whose `view` is a disabled module.
  `use-tour.ts` tracks `activeTourId` (`start(tourId?)` defaults `getting-started`, preserving
  auto-launch + HelpMenu), exposes `catalogTours` (tours with ≥1 visible step) + `completedTours` +
  `activeTourTitleKey`; `done()` appends the active id to `settings.completedTours` (functional
  `setSettings`), `skip()` sets `tourSeen` only. Per-device `settings.completedTours?: readonly
  string[]` rides the `writeSettings` spread (no allowlist edit, sanitized on load, capped 50), OUT of
  exports/Turso, cleared by `clearAppConfig`'s `lop-app:*` sweep; `tourSeen` STILL gates first-run
  auto-launch separately. Presentational `tour-catalog.tsx` (props-only, no context — standalone
  unit-tested) renders a card grid in a `<details open>` "Guided tours" section in `help-view.tsx`,
  ABOVE the SP3 relations map; the whole section is GATED on `onStartTour` presence (mirrors the
  `onTakeTour` gate) so standalone tests / classic / popout don't render it — tours stay modern-only.
  Threaded task-manager → `WorkspaceSectionProps` (3 new OPTIONAL fields) → HelpView. `TourOverlay`
  gained an optional `tourTitleKey` label. Help is NOT in axe `A11Y_VIEWS` → catalog a11y eye-verified.
```

- [ ] **Step 2: Run the full unit suite**

Run: `npm run test:run`
Expected: PASS (all files; previous baseline + the new SP4 tests).

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: PASS, 0 warnings (an unused import/var is fatal — re-check after the edits).

- [ ] **Step 4: Commit docs**

```bash
git add AGENTS.md
git commit -m "docs(agents): document themed guided tours (Help SP4)"
```

- [ ] **Step 5: Eye-verify (manual; cannot be automated — Help is not in the axe gate)**

Run `npm run dev`, open Help (sidebar, below Settings):
- "Guided tours" section shows 6 cards in a 1-col (narrow) / 2-col (≥sm) grid.
- Each card shows title + blurb + "Start tour →".
- Click a themed card → the overlay opens with that tour's title label + first step; Next/Back/Show me/Done work; Done returns to Help and the card now shows a "✓ Done" badge (persists across reload).
- Disable a module (Settings) whose tour deep-links only that view → its card disappears from the catalog.
- Check light + dark + Mockup styles for palette/contrast; Tab-focus each card (focus ring visible).
- Classic layout + a popout: no "Guided tours" section.

---

## Self-Review

**Spec coverage:** Engine catalog (Task 2) · `completedTours` persistence (Task 3) · active-tour/start(id)/completion/catalog projection (Task 4) · TourCatalog (Task 5) · Help-view section gated on `onStartTour` (Task 6) · overlay title (Task 7) · wiring incl. modern-only gate (Task 8) · i18n EN+DE for all 6 tours + steps + chrome (Task 1) · tests for engine/use-tour/catalog/help-view (Tasks 2,4,5,6) · AGENTS.md + eye-verify (Task 9). All spec sections mapped.

**Placeholder scan:** none — every code/test step shows full content; i18n strings are literal EN+DE.

**Type consistency:** `TourDefinition`/`TourCatalogEntry`/`TOURS`/`findTour`/`visibleSteps(steps,features)` defined in Task 2 and used identically in Tasks 4–8. `useTour` return shape (`activeTourTitleKey`, `catalogTours`, `completedTours`, `start(tourId?)`) consistent across Task 4 impl, Task 8 wiring, and the Task 4 tests. `completedTours` settings field (Task 3) matches the `useTour` arg + write (Task 4). Help-view props (Task 6) match what task-manager/workspace-section thread (Task 8).

**Known signature-change fallout (handled):** generalizing `visibleSteps` breaks the OLD single-arg call sites in `app-tour.test.ts` (Task 2 Step 1 rewrites them), `use-tour.test.tsx` (Task 4 Step 1 rewrites it), and `use-tour.ts` itself (Task 4 Step 3). After Task 2 the tree intentionally fails `tsc` until Task 4; after Task 4 it fails only in task-manager until Task 8. Each task notes its expected-still-red state so an executor doesn't "fix" it prematurely.
