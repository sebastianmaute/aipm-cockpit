# Guided Tour + Demo Showcase (SP-F) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a modern-shell-only guided tour (hybrid modal + spotlight, ~12 steps) plus a one-click demo-data load, auto-launched once on first run and replayable from the Help menu.

**Architecture:** A pure i18n-free engine (`app-tour.ts`) owns the ordered step list + visibility filtering. A `tour-overlay.tsx` renders the current step as either a centered modal or an anchored spotlight (falling back to modal if the anchor is missing). A `use-tour.ts` hook (mounted in `task-manager`, above the view) owns open/index state, the per-device `tourSeen` flag (via `setSettings`), and render-time auto-launch. Demo data loads by lazily importing the bundled `sample-workspace-small.json` and applying it through the existing `applyRestoredWorkspace`.

**Tech Stack:** Next.js 16 (forked) / React 19 / TypeScript, vitest, Playwright axe gate, GitLab CI. AIPM palette tokens only. EN/DE i18n parity enforced by tsc.

---

## Conventions (read once)

- **Lint is fatal** (`--max-warnings=0`): no unused imports/vars. Run `npm run lint` after every task.
- **tsc enforces EN/DE i18n key parity** + typechecks tests. Run `npx tsc --noEmit` after editing tests.
- **DE edits:** the Edit tool corrupts umlauts + curls quotes in `i18n.de.ts`, which is CRLF. Edit DE strings via a node UTF-8 write that matches `\r\n` anchors, then verify with a node read (no `fuer`/`ae` ASCII subs — the `i18n-encoding` test bans them).
- **No `set-state-in-effect`** (banned/fatal). Sync-to-prop uses the render-time reconcile pattern: `if (cond && !handled) { setHandled(true); setX(...) }` during render, guarded by a state flag — NOT a `useEffect`.
- **No `Date.now()`/`new Date()` in a render body** (purity rule). Not needed here.
- **`Lang`** is `"en-US" | "en-GB" | "de"` (no `"en"`). DE dict is lazy — a test asserting DE output calls `loadI18n("de")` in `beforeAll`.
- **Settings writes** go through `setSettings` (from `useSettings`), which routes to `writeSettings`. NEVER raw `localStorage.setItem`.
- **AIPM tokens only** (`globals.css`): no off-palette colors, gradients, shadows (incl. Tailwind `shadow-*`).
- The tour is **modern-shell only** (`settings.layout === "modern" && !isPopout`).

---

## File Structure

- `src/app/app-tour.ts` (NEW, pure) — `TourStep`, `TOUR_STEPS`, `visibleSteps`, `clampStep`, anchor-id constants.
- `src/app/tour-overlay.tsx` (NEW) — the modal + spotlight overlay component.
- `src/app/use-tour.ts` (NEW) — open/index state, `tourSeen`, render-time auto-launch.
- `src/app/settings-types.ts` (MODIFY) — `tourSeen?: boolean`.
- `src/app/project-empty-state.tsx` (MODIFY) — `onLoadDemo?` CTA.
- `src/app/help-menu.tsx` (MODIFY) — `onTakeTour?` footer button.
- `src/app/action-menus.tsx` (MODIFY) — thread `onTakeTour` to `HelpMenu`.
- `src/app/task-manager.tsx` (MODIFY) — mount overlay, `loadDemo`, auto-launch wiring, `onTakeTour`, ~4 `data-tour-id` attributes.
- `src/app/i18n.ts` + `src/app/i18n.de.ts` (MODIFY) — all tour strings.
- `src/app/version.ts` + `CHANGELOG.md` (MODIFY) — release.

---

## Task 1: i18n keys for the tour (EN + DE)

The pure engine (Task 2) references `TranslationKey` literals, so the keys must exist first.

**Files:**
- Modify: `src/app/i18n.ts`
- Modify: `src/app/i18n.de.ts`

- [ ] **Step 1: Add EN keys**

In `src/app/i18n.ts`, add this block to the dictionary object (near the other feature blocks, e.g. after the steering-committee keys). Keep keys grouped + comment them:

```ts
  // --- Guided tour (SP-F) ---
  tourLaunch: "Take the tour",
  tourLoadDemo: "Explore a demo project",
  tourSkip: "Skip",
  tourNext: "Next",
  tourBack: "Back",
  tourDone: "Done",
  tourShowMe: "Show me",
  tourDemoError: "Couldn't load the demo project.",
  tourStepWelcomeTitle: "Welcome to the PM Tracker",
  tourStepWelcomeBody: "A quick tour of the main areas. You can skip anytime and replay it later from the Help menu.",
  tourStepProjectsTitle: "Projects",
  tourStepProjectsBody: "Create a project from scratch, import one from a file, SharePoint, or Confluence, or let AI draft it from a description.",
  tourStepTasksTitle: "Open points",
  tourStepTasksBody: "Track work as tasks in a table or a Kanban board, with status, RAID links, and Jira sync.",
  tourStepActionsTitle: "Action Center",
  tourStepActionsBody: "Ranked suggested next actions from your tasks, RAID, milestones, budget, and committee reminders — with one-click CTAs.",
  tourStepChatTitle: "AI assistant",
  tourStepChatBody: "Ask Claude about this project, attach documents, or have it create and update records for you.",
  tourStepDashboardTitle: "Dashboard",
  tourStepDashboardBody: "A portfolio overview: health, completion, budget, and (on Turso) trend snapshots.",
  tourStepReportsTitle: "Reports",
  tourStepReportsBody: "Composable budget, RAID, and change reports you can sort, filter, reorder, and print.",
  tourStepRaidTitle: "RAID log",
  tourStepRaidBody: "Risks, assumptions, issues, and dependencies — with owners, severity, and review reminders.",
  tourStepMilestonesTitle: "Milestones & Gantt",
  tourStepMilestonesBody: "Plan milestones on a timeline and push them to your Outlook calendar.",
  tourStepStakeholdersTitle: "Stakeholders",
  tourStepStakeholdersBody: "Map stakeholders, RACI, and communication reminders.",
  tourStepSteeringTitle: "Steering committee",
  tourStepSteeringBody: "Record committee members, the meeting schedule, and info-pack reminders — and push them to Outlook.",
  tourStepSettingsTitle: "Settings & storage",
  tourStepSettingsBody: "Switch storage backends, tune next-action weights, configure AI and integrations, and set your mode.",
```

- [ ] **Step 2: Add the matching DE keys via a node UTF-8 write**

DE strings (real umlauts). Run this (adjust the anchor to an existing unique DE line near where you want them — here we append before the closing of the dict by anchoring on the steering-committee DE block's last key; pick a real `\r\n`-terminated anchor line you confirm exists):

```bash
node -e '
const fs = require("fs");
const p = "src/app/i18n.de.ts";
let s = fs.readFileSync(p, "utf8");
// Anchor: insert right AFTER the EN-mirrored steering committee push key. Replace
// ANCHOR with an actual unique line you grep from i18n.de.ts (must end with \r\n).
const ANCHOR = "  committeePushError: \"Erinnerungen konnten nicht an Outlook gesendet werden.\",\r\n";
if (!s.includes(ANCHOR)) { console.error("ANCHOR NOT FOUND - grep i18n.de.ts for a real line"); process.exit(1); }
const de = [
  "  // --- Guided tour (SP-F) ---",
  "  tourLaunch: \"Tour starten\",",
  "  tourLoadDemo: \"Demo-Projekt erkunden\",",
  "  tourSkip: \"Überspringen\",",
  "  tourNext: \"Weiter\",",
  "  tourBack: \"Zurück\",",
  "  tourDone: \"Fertig\",",
  "  tourShowMe: \"Zeig es mir\",",
  "  tourDemoError: \"Demo-Projekt konnte nicht geladen werden.\",",
  "  tourStepWelcomeTitle: \"Willkommen beim PM-Tracker\",",
  "  tourStepWelcomeBody: \"Eine kurze Tour durch die wichtigsten Bereiche. Sie können jederzeit abbrechen und sie später über das Hilfe-Menü erneut starten.\",",
  "  tourStepProjectsTitle: \"Projekte\",",
  "  tourStepProjectsBody: \"Erstellen Sie ein Projekt von Grund auf, importieren Sie es aus einer Datei, SharePoint oder Confluence, oder lassen Sie es per KI aus einer Beschreibung entwerfen.\",",
  "  tourStepTasksTitle: \"Offene Punkte\",",
  "  tourStepTasksBody: \"Verfolgen Sie Arbeit als Aufgaben in einer Tabelle oder einem Kanban-Board, mit Status, RAID-Verknüpfungen und Jira-Synchronisierung.\",",
  "  tourStepActionsTitle: \"Aktionszentrum\",",
  "  tourStepActionsBody: \"Priorisierte nächste Aktionen aus Aufgaben, RAID, Meilensteinen, Budget und Ausschuss-Erinnerungen — mit Ein-Klick-Aktionen.\",",
  "  tourStepChatTitle: \"KI-Assistent\",",
  "  tourStepChatBody: \"Fragen Sie Claude zu diesem Projekt, hängen Sie Dokumente an oder lassen Sie Datensätze für Sie anlegen und aktualisieren.\",",
  "  tourStepDashboardTitle: \"Dashboard\",",
  "  tourStepDashboardBody: \"Ein Portfolio-Überblick: Gesundheit, Fortschritt, Budget und (mit Turso) Trend-Snapshots.\",",
  "  tourStepReportsTitle: \"Berichte\",",
  "  tourStepReportsBody: \"Zusammenstellbare Budget-, RAID- und Änderungsberichte zum Sortieren, Filtern, Umordnen und Drucken.\",",
  "  tourStepRaidTitle: \"RAID-Liste\",",
  "  tourStepRaidBody: \"Risiken, Annahmen, Probleme und Abhängigkeiten — mit Verantwortlichen, Schweregrad und Prüf-Erinnerungen.\",",
  "  tourStepMilestonesTitle: \"Meilensteine & Gantt\",",
  "  tourStepMilestonesBody: \"Planen Sie Meilensteine auf einer Zeitleiste und übertragen Sie sie in Ihren Outlook-Kalender.\",",
  "  tourStepStakeholdersTitle: \"Stakeholder\",",
  "  tourStepStakeholdersBody: \"Bilden Sie Stakeholder, RACI und Kommunikations-Erinnerungen ab.\",",
  "  tourStepSteeringTitle: \"Lenkungsausschuss\",",
  "  tourStepSteeringBody: \"Erfassen Sie Ausschussmitglieder, den Sitzungsplan und Info-Paket-Erinnerungen — und übertragen Sie sie nach Outlook.\",",
  "  tourStepSettingsTitle: \"Einstellungen & Speicher\",",
  "  tourStepSettingsBody: \"Wechseln Sie Speicher-Backends, justieren Sie Aktionsgewichte, konfigurieren Sie KI und Integrationen und setzen Sie Ihren Modus.\",",
  "",
].join("\r\n");
s = s.replace(ANCHOR, ANCHOR + de);
fs.writeFileSync(p, s, "utf8");
console.log("DONE; tourLaunch present:", s.includes("tourLaunch"));
'
```

- [ ] **Step 3: Verify parity + umlauts**

Run: `npx tsc --noEmit` → Expected: 0 errors (EN/DE key sets identical).
Run: `node -e 'const s=require("fs").readFileSync("src/app/i18n.de.ts","utf8");const m=s.match(/tourStepTasksBody: "(.*?)",/);console.log(/[äöüÄÖÜ]/.test(m[1]), !/fuer|ueber\b|koennen/.test(m[1]))'` → Expected: `true true`.
Run: `npm run test:run -- i18n-encoding` → Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/app/i18n.ts src/app/i18n.de.ts
git commit -m "i18n(sp-f): guided-tour strings (EN+DE)"
```

---

## Task 2: Pure tour engine (`app-tour.ts`)

**Files:**
- Create: `src/app/app-tour.ts`
- Test: `src/app/app-tour.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/app/app-tour.test.ts
import { describe, expect, it } from "vitest";
import { TOUR_STEPS, visibleSteps, clampStep } from "./app-tour";

describe("app-tour engine", () => {
  it("has a welcome step first and includes a steering-committee step", () => {
    expect(TOUR_STEPS[0].id).toBe("welcome");
    expect(TOUR_STEPS.some((s) => s.id === "steering")).toBe(true);
  });
  it("visibleSteps keeps core steps when all modules enabled", () => {
    const all = ["dashboard", "milestones", "resources", "raid", "changes", "stakeholders", "budget"] as const;
    const out = visibleSteps([...all]);
    expect(out.length).toBe(TOUR_STEPS.length);
  });
  it("visibleSteps drops a step whose view's module is disabled", () => {
    // milestones step targets the "milestones" view; with that module off it is dropped
    const out = visibleSteps([]); // no modules enabled
    expect(out.some((s) => s.id === "milestones")).toBe(false);
    // welcome (no view) always survives
    expect(out.some((s) => s.id === "welcome")).toBe(true);
  });
  it("clampStep bounds the index", () => {
    expect(clampStep(-1, 5)).toBe(0);
    expect(clampStep(9, 5)).toBe(4);
    expect(clampStep(2, 5)).toBe(2);
    expect(clampStep(0, 0)).toBe(0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:run -- app-tour` → Expected: FAIL (module not found).

- [ ] **Step 3: Implement `app-tour.ts`**

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
  /** Deep-link target for the step's "Show me" action. */
  view?: AppView;
  /** data-tour-id of the element a spotlight step points at. */
  anchorId?: string;
}

/** data-tour-id values placed on the anchored controls (Task 7). */
export const TOUR_ANCHORS = {
  navTasks: "tour-nav-tasks",
  navActions: "tour-nav-actions",
  askClaude: "tour-ask-claude",
  projectSwitcher: "tour-project-switcher",
} as const;

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

/** Drop steps whose deep-link view belongs to a disabled feature module, so the
 *  tour never navigates to a hidden view. Steps without a `view` always survive. */
export function visibleSteps(features: readonly FeatureModuleId[]): TourStep[] {
  return TOUR_STEPS.filter((s) => s.view === undefined || isViewEnabled(s.view, features));
}

/** Bound an index to [0, total-1]; returns 0 for an empty list. */
export function clampStep(index: number, total: number): number {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(index, total - 1));
}
```

NOTE: confirm `isViewEnabled(view, features)` exists in `feature-modules.ts` (it does — returns `true` for core views with no module). If the milestones/reports/etc. views are core (no module), adjust the test's "disabled" example to a view that IS module-gated (grep `VIEW_TO_MODULE` in `feature-modules.ts` to pick one that maps to a module, e.g. `milestones`/`resources`/`budget`); keep `welcome` (no view) as the always-survives case.

- [ ] **Step 4: Run the test**

Run: `npm run test:run -- app-tour` → Expected: PASS (4 tests). If the "drops a step" test fails because the chosen view is core, switch its assertion to a genuinely module-gated view id per the NOTE.

- [ ] **Step 5: Lint + commit**

Run: `npm run lint` → clean.
```bash
git add src/app/app-tour.ts src/app/app-tour.test.ts
git commit -m "feat(sp-f): pure guided-tour engine (steps, visibleSteps, clampStep)"
```

---

## Task 3: `tourSeen` per-device setting

**Files:**
- Modify: `src/app/settings-types.ts`
- Test: `src/app/settings-types.test.ts` (if one exists; else fold into Task 5's hook test)

- [ ] **Step 1: Add the field + default**

In `src/app/settings-types.ts`, add to the `Settings` interface (near `tasksViewMode?`):
```ts
  /** Per-device: the guided tour has been seen/skipped (suppresses auto-launch). */
  tourSeen?: boolean;
```
Do NOT add it to `defaultSettings` (absent = not seen = auto-launch eligible). Confirm `tourSeen` is NOT stripped by any settings sanitizer; if a `sanitizeSettings`/`writeSettings` allowlist exists, add `tourSeen` to it so it persists.

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit` → 0 errors.
Run: `npm run test:run -- settings` → PASS (no regressions).

- [ ] **Step 3: Commit**

```bash
git add src/app/settings-types.ts
git commit -m "feat(sp-f): Settings.tourSeen per-device flag"
```

---

## Task 4: Tour overlay component (`tour-overlay.tsx`)

**Files:**
- Create: `src/app/tour-overlay.tsx`
- Test: `src/app/tour-overlay.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/app/tour-overlay.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TourOverlay } from "./tour-overlay";
import { TOUR_STEPS } from "./app-tour";
import { t } from "./i18n";

const handlers = () => ({ onBack: vi.fn(), onNext: vi.fn(), onSkip: vi.fn(), onDone: vi.fn(), onShowMe: vi.fn() });

describe("TourOverlay", () => {
  it("renders the current modal step title/body + progress", () => {
    render(<TourOverlay lang="en-US" steps={TOUR_STEPS} index={0} {...handlers()} />);
    expect(screen.getByText(t("en-US", "tourStepWelcomeTitle"))).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
  it("Next/Back/Skip call handlers; last step shows Done", () => {
    const h = handlers();
    const { rerender } = render(<TourOverlay lang="en-US" steps={TOUR_STEPS} index={0} {...h} />);
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "tourNext") }));
    expect(h.onNext).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "tourSkip") }));
    expect(h.onSkip).toHaveBeenCalled();
    rerender(<TourOverlay lang="en-US" steps={TOUR_STEPS} index={TOUR_STEPS.length - 1} {...h} />);
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "tourDone") }));
    expect(h.onDone).toHaveBeenCalled();
  });
  it("Escape triggers skip", () => {
    const h = handlers();
    render(<TourOverlay lang="en-US" steps={TOUR_STEPS} index={0} {...h} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(h.onSkip).toHaveBeenCalled();
  });
  it("a spotlight step with a MISSING anchor falls back to a centered modal (no crash)", () => {
    // index 2 = tasks (spotlight, anchorId tour-nav-tasks) — not in the DOM here
    const h = handlers();
    render(<TourOverlay lang="en-US" steps={TOUR_STEPS} index={2} {...h} />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(t("en-US", "tourStepTasksTitle"))).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:run -- tour-overlay` → Expected: FAIL (module not found).

- [ ] **Step 3: Implement `tour-overlay.tsx`**

```tsx
"use client";

// Guided-tour overlay (SP-F), modern-shell only. Renders the current step as a
// centered modal, or — for "spotlight" steps — a dimmed overlay with a tooltip
// anchored to a [data-tour-id] element. If the anchor is missing (gated/unmounted
// view), it falls back to a centered modal so it never points at nothing. The
// host (task-manager) owns navigation + state; this is a controlled component.

import { useEffect, useRef, useState } from "react";
import { type Lang, t } from "./i18n";
import { clampStep, type TourStep } from "./app-tour";

export interface TourOverlayProps {
  lang: Lang;
  steps: readonly TourStep[];
  index: number;
  onBack: () => void;
  onNext: () => void;
  onSkip: () => void;
  onDone: () => void;
  onShowMe: (step: TourStep) => void;
}

interface Rect { top: number; left: number; width: number; height: number; }

export function TourOverlay({ lang, steps, index, onBack, onNext, onSkip, onDone, onShowMe }: TourOverlayProps) {
  const total = steps.length;
  const i = clampStep(index, total);
  const step = steps[i];
  const isLast = i === total - 1;
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [anchorRect, setAnchorRect] = useState<Rect | null>(null);

  // Measure the spotlight anchor (if any) AFTER paint. jsdom returns 0s — the
  // measurement is a real-browser concern; tests cover the fallback path.
  useEffect(() => {
    if (step?.kind !== "spotlight" || !step.anchorId) { setAnchorRect(null); return; }
    const el = document.querySelector<HTMLElement>(`[data-tour-id="${step.anchorId}"]`);
    if (!el) { setAnchorRect(null); return; }
    const r = el.getBoundingClientRect();
    setAnchorRect(r.width > 0 || r.height > 0 ? { top: r.top, left: r.left, width: r.width, height: r.height } : null);
  }, [step]);

  // Escape = skip; focus the card on mount/step change (focus trap-lite).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") { e.preventDefault(); onSkip(); }
    }
    document.addEventListener("keydown", onKey);
    cardRef.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [onSkip, i]);

  if (!step) return null;
  const spotlight = step.kind === "spotlight" && anchorRect !== null;

  // Card position: beside the anchor for a measured spotlight, else centered.
  const cardStyle: React.CSSProperties = spotlight && anchorRect
    ? { position: "fixed", top: Math.min(anchorRect.top + anchorRect.height + 8, window.innerHeight - 180), left: Math.max(8, Math.min(anchorRect.left, window.innerWidth - 360)) }
    : { position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)" };

  return (
    <div className="fixed inset-0 z-[60] bg-AIPM-dark-blue/40" role="presentation">
      {spotlight && anchorRect && (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed rounded-md ring-2 ring-AIPM-green"
          style={{ top: anchorRect.top - 4, left: anchorRect.left - 4, width: anchorRect.width + 8, height: anchorRect.height + 8 }}
        />
      )}
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-label={t(lang, step.titleKey)}
        tabIndex={-1}
        style={cardStyle}
        className="w-[340px] max-w-[92vw] rounded-lg border border-line bg-surface p-4 focus:outline-none"
      >
        <div className="mb-2 flex items-center gap-1" aria-hidden="true">
          {steps.map((s, k) => (
            <span key={s.id} className={k === i ? "h-1.5 w-3 rounded-full bg-AIPM-dark-blue" : "h-1.5 w-1.5 rounded-full bg-line"} />
          ))}
        </div>
        <h2 className="text-sm font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey">{t(lang, step.titleKey)}</h2>
        <p className="mt-1 text-xs leading-relaxed text-foreground">{t(lang, step.bodyKey)}</p>
        <p className="mt-2 text-[11px] text-muted-foreground">{i + 1} / {total}</p>
        <div className="mt-3 flex items-center justify-between gap-2">
          <button type="button" onClick={onSkip} className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-surface-muted">
            {t(lang, "tourSkip")}
          </button>
          <div className="flex items-center gap-2">
            {step.view && (
              <button type="button" onClick={() => onShowMe(step)} className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-AIPM-dark-blue hover:bg-surface-muted dark:text-AIPM-light-grey">
                {t(lang, "tourShowMe")}
              </button>
            )}
            {i > 0 && (
              <button type="button" onClick={onBack} className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-surface-muted">
                {t(lang, "tourBack")}
              </button>
            )}
            <button type="button" onClick={isLast ? onDone : onNext} className="rounded-md border border-AIPM-dark-blue bg-AIPM-dark-blue px-2.5 py-1.5 text-xs font-medium text-white hover:bg-AIPM-dark-blue/90">
              {t(lang, isLast ? "tourDone" : "tourNext")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the test**

Run: `npm run test:run -- tour-overlay` → Expected: PASS (4 tests).

- [ ] **Step 5: Lint + tsc + commit**

Run: `npm run lint` → clean. Run: `npx tsc --noEmit` → 0.
```bash
git add src/app/tour-overlay.tsx src/app/tour-overlay.test.tsx
git commit -m "feat(sp-f): tour overlay (modal + spotlight w/ anchor-missing fallback)"
```

---

## Task 5: Tour state hook (`use-tour.ts`)

**Files:**
- Create: `src/app/use-tour.ts`
- Test: `src/app/use-tour.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/app/use-tour.test.tsx
import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTour } from "./use-tour";
import { visibleSteps } from "./app-tour";

const FEATURES = ["dashboard", "milestones", "resources", "raid", "changes", "stakeholders", "budget"] as const;

describe("useTour", () => {
  it("auto-launches once in modern, non-popout, unseen", () => {
    const setSettings = vi.fn();
    const { result } = renderHook(() =>
      useTour({ layout: "modern", isPopout: false, hydrated: true, tourSeen: false, features: [...FEATURES], setSettings }));
    expect(result.current.isOpen).toBe(true);
    expect(result.current.index).toBe(0);
  });
  it("does NOT auto-launch in classic / popout / when seen / before hydration", () => {
    const setSettings = vi.fn();
    for (const args of [
      { layout: "classic" as const, isPopout: false, hydrated: true, tourSeen: false },
      { layout: "modern" as const, isPopout: true, hydrated: true, tourSeen: false },
      { layout: "modern" as const, isPopout: false, hydrated: true, tourSeen: true },
      { layout: "modern" as const, isPopout: false, hydrated: false, tourSeen: false },
    ]) {
      const { result } = renderHook(() => useTour({ ...args, features: [...FEATURES], setSettings }));
      expect(result.current.isOpen).toBe(false);
    }
  });
  it("done marks tourSeen via setSettings and closes", () => {
    const setSettings = vi.fn();
    const { result } = renderHook(() =>
      useTour({ layout: "modern", isPopout: false, hydrated: true, tourSeen: false, features: [...FEATURES], setSettings }));
    act(() => { result.current.done(); });
    expect(result.current.isOpen).toBe(false);
    // setSettings called with an updater that sets tourSeen true
    const updater = setSettings.mock.calls.at(-1)![0];
    expect(updater({ tourSeen: false }).tourSeen).toBe(true);
  });
  it("next/back clamp within the visible steps", () => {
    const setSettings = vi.fn();
    const { result } = renderHook(() =>
      useTour({ layout: "modern", isPopout: false, hydrated: true, tourSeen: true, features: [...FEATURES], setSettings }));
    act(() => { result.current.start(); });
    act(() => { result.current.back(); });
    expect(result.current.index).toBe(0); // clamped at 0
    const last = visibleSteps([...FEATURES]).length - 1;
    for (let k = 0; k < 50; k++) act(() => { result.current.next(); });
    expect(result.current.index).toBe(last); // clamped at end
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:run -- use-tour` → Expected: FAIL (module not found).

- [ ] **Step 3: Implement `use-tour.ts`**

```ts
"use client";

// Guided-tour open/index state + per-device tourSeen flag + render-time
// auto-launch (NO useEffect setState — banned). Modern-shell only.
import { useCallback, useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { clampStep, visibleSteps, type TourStep } from "./app-tour";
import type { FeatureModuleId } from "./feature-modules";
import type { Settings } from "./settings-types";

interface UseTourArgs {
  layout: "modern" | "classic";
  isPopout: boolean;
  hydrated: boolean;
  tourSeen: boolean | undefined;
  features: readonly FeatureModuleId[];
  setSettings: Dispatch<SetStateAction<Settings>>;
}

export interface UseTour {
  isOpen: boolean;
  index: number;
  steps: TourStep[];
  start: () => void;
  next: () => void;
  back: () => void;
  skip: () => void;
  done: () => void;
  showMe: (step: TourStep, navigate: (view: NonNullable<TourStep["view"]>) => void) => void;
}

export function useTour({ layout, isPopout, hydrated, tourSeen, features, setSettings }: UseTourArgs): UseTour {
  const steps = useMemo(() => visibleSteps(features), [features]);
  const [isOpen, setIsOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [autoHandled, setAutoHandled] = useState(false);

  // Render-time auto-launch (guarded; runs once). NOT a useEffect.
  const eligible = hydrated && layout === "modern" && !isPopout && !tourSeen && steps.length > 0;
  if (eligible && !autoHandled) {
    setAutoHandled(true);
    setIsOpen(true);
    setIndex(0);
  }

  const markSeen = useCallback(() => setSettings((s) => ({ ...s, tourSeen: true })), [setSettings]);

  const start = useCallback(() => { setIndex(0); setIsOpen(true); }, []);
  const next = useCallback(() => setIndex((k) => clampStep(k + 1, steps.length)), [steps.length]);
  const back = useCallback(() => setIndex((k) => clampStep(k - 1, steps.length)), [steps.length]);
  const skip = useCallback(() => { setIsOpen(false); markSeen(); }, [markSeen]);
  const done = useCallback(() => { setIsOpen(false); markSeen(); }, [markSeen]);
  const showMe = useCallback((step: TourStep, navigate: (view: NonNullable<TourStep["view"]>) => void) => {
    if (step.view) navigate(step.view);
  }, []);

  return { isOpen, index, steps, start, next, back, skip, done, showMe };
}
```

- [ ] **Step 4: Run the test**

Run: `npm run test:run -- use-tour` → Expected: PASS (4 tests).

- [ ] **Step 5: Lint + tsc + commit**

Run: `npm run lint` → clean. Run: `npx tsc --noEmit` → 0.
```bash
git add src/app/use-tour.ts src/app/use-tour.test.tsx
git commit -m "feat(sp-f): useTour hook (state + tourSeen + render-time auto-launch)"
```

---

## Task 6: Demo-data load + empty-state CTA

**Files:**
- Modify: `src/app/project-empty-state.tsx`
- Test: `src/app/project-empty-state.test.tsx` (create if absent)

- [ ] **Step 1: Write the failing test**

```tsx
// src/app/project-empty-state.test.tsx (add this case; create the file if it doesn't exist)
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ProjectEmptyState } from "./project-empty-state";
import { t } from "./i18n";

// Minimal props — copy the required props from the component's interface; the
// point of THIS test is only the demo CTA.
const base = {
  lang: "en-US" as const,
  onCreate: vi.fn(),
  onLoadFromFile: vi.fn(),
  // ...add any other REQUIRED props from ProjectEmptyStateProps with no-op/empty values
};

describe("ProjectEmptyState demo CTA", () => {
  it("shows 'Explore a demo project' and calls onLoadDemo when provided", () => {
    const onLoadDemo = vi.fn();
    render(<ProjectEmptyState {...base} onLoadDemo={onLoadDemo} />);
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "tourLoadDemo") }));
    expect(onLoadDemo).toHaveBeenCalled();
  });
  it("hides the demo CTA when onLoadDemo is not provided", () => {
    render(<ProjectEmptyState {...base} />);
    expect(screen.queryByRole("button", { name: t("en-US", "tourLoadDemo") })).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run test:run -- project-empty-state` → Expected: FAIL (no such button / prop). Fill `base` with the component's actual required props (read `ProjectEmptyStateProps`) until the render compiles.

- [ ] **Step 3: Add the prop + CTA**

In `src/app/project-empty-state.tsx`: add `onLoadDemo?: () => void;` to `ProjectEmptyStateProps`, destructure it, and render a CTA next to the existing "Load from file" button (line ~161 region), guarded by the prop:
```tsx
{onLoadDemo && (
  <button
    type="button"
    onClick={onLoadDemo}
    className="rounded-md border border-line bg-surface px-3 py-2 text-sm font-medium text-AIPM-dark-blue hover:bg-surface-muted dark:text-AIPM-light-grey"
  >
    {t(lang, "tourLoadDemo")}
  </button>
)}
```
(Match the surrounding button styling; AIPM tokens only.)

- [ ] **Step 4: Run the test**

Run: `npm run test:run -- project-empty-state` → Expected: PASS.

- [ ] **Step 5: Lint + tsc + commit**

Run: `npm run lint` → clean. Run: `npx tsc --noEmit` → 0.
```bash
git add src/app/project-empty-state.tsx src/app/project-empty-state.test.tsx
git commit -m "feat(sp-f): empty-state 'Explore a demo project' CTA"
```

---

## Task 7: Wire into task-manager (overlay, demo load, auto-launch, Help entry, anchors)

**Files:**
- Modify: `src/app/task-manager.tsx`
- Modify: `src/app/help-menu.tsx`
- Modify: `src/app/action-menus.tsx`

This task is integration; verify by the full suite + tsc + lint (no new unit test file, but do not break existing ones).

- [ ] **Step 1: HelpMenu — add an `onTakeTour` footer button**

In `src/app/help-menu.tsx`: change the signature to `export function HelpMenu({ lang, onTakeTour }: { lang: Lang; onTakeTour?: () => void })`. In the footer `<div>` (the one with the policy + license links, ~line 383), prepend a button rendered only when `onTakeTour` is set:
```tsx
{onTakeTour && (
  <button
    type="button"
    onClick={() => { setOpen(false); onTakeTour(); }}
    className="text-xs font-medium text-AIPM-dark-blue underline-offset-2 hover:underline dark:text-AIPM-blue"
  >
    {t(lang, "tourLaunch")}
  </button>
)}
```

- [ ] **Step 2: action-menus.tsx — thread the prop**

In `src/app/action-menus.tsx`: add `onTakeTour?: () => void` to the props interface, destructure it, and pass it to `<HelpMenu lang={lang} onTakeTour={onTakeTour} />` (line ~68).

- [ ] **Step 3: task-manager — instantiate the hook + demo load + Help wiring**

In `src/app/task-manager.tsx`:
- Imports: `import { useTour } from "./use-tour";`, `import { TourOverlay } from "./tour-overlay";`, `import { jsonToWorkspace } from "./workspace";` (confirm the import path/name — it's exported from `workspace.ts`/`storage.ts`).
- Instantiate the hook (after `settings`/`isPopout`/`applyRestoredWorkspace` are in scope):
```ts
const tour = useTour({
  layout: settings.layout,
  isPopout,
  hydrated,
  tourSeen: settings.tourSeen,
  features: settings.features,
  setSettings,
});
```
- `loadDemo` callback:
```ts
const loadDemo = useCallback(async () => {
  try {
    const mod = await import("../../sample-workspace-small.json");
    const ws = jsonToWorkspace(JSON.stringify((mod as { default?: unknown }).default ?? mod));
    applyRestoredWorkspace(ws);
    tour.start();
  } catch {
    showToast("error", t(lang, "tourDemoError"));
  }
}, [applyRestoredWorkspace, tour, showToast, lang]);
```
- Pass `onLoadDemo` into the empty state where `ProjectEmptyState` is rendered (the `onLoadFromFile: () => { void loadProjectFromFile(); }` site ~line 1994): add `onLoadDemo: () => { void loadDemo(); }`. (Empty state only — so it never overwrites a real project.)
- Pass `onTakeTour` into `ActionMenus` (line ~2012) but ONLY for the modern, non-popout case:
```tsx
<ActionMenus
  ... existing props ...
  onTakeTour={settings.layout === "modern" && !isPopout ? tour.start : undefined}
/>
```
- Mount the overlay above the view. Render it in the modern tree (next to where `ModernShell` is rendered / `topBarMenus` are wired, ~line 2212) so it overlays everything, gated:
```tsx
{tour.isOpen && settings.layout === "modern" && !isPopout && (
  <TourOverlay
    lang={lang}
    steps={tour.steps}
    index={tour.index}
    onBack={tour.back}
    onNext={tour.next}
    onSkip={tour.skip}
    onDone={tour.done}
    onShowMe={(step) => tour.showMe(step, (view) => requestOpen ? setActiveTab(view) : setActiveTab(view))}
  />
)}
```
(Use `setActiveTab(view)` for the deep-link; `requestOpen` is for entity-id deep-links and isn't needed here. Simplify to `onShowMe={(step) => tour.showMe(step, setActiveTab)}`.)

- [ ] **Step 4: Add the 4 `data-tour-id` anchors**

Add `data-tour-id` to the anchored controls (import `TOUR_ANCHORS` from `./app-tour`):
- the Ask-Claude pill (`askClaudeEl`, ~line 2002): wrap or pass `data-tour-id={TOUR_ANCHORS.askClaude}` onto its outer element. If `AskClaudeMenu` doesn't forward DOM props, wrap it: `<span data-tour-id={TOUR_ANCHORS.askClaude}>{/* AskClaudeMenu */}</span>`.
- the project switcher: add `data-tour-id={TOUR_ANCHORS.projectSwitcher}` to its container.
- the sidebar nav items for tasks + actions: these render in `sidebar-nav.tsx`/`modern-shell.tsx`. Add `data-tour-id` keyed by view — in the nav item render, set `data-tour-id={item.view === "open-points" ? TOUR_ANCHORS.navTasks : item.view === "actions" ? TOUR_ANCHORS.navActions : undefined}`. (Find the nav `<button>`/`<a>` element; pass through the attribute.)

If wiring a clean anchor onto any of these is awkward, LEAVE that step as `kind:"modal"` in `app-tour.ts` instead (the overlay already falls back to modal when an anchor is missing — but prefer a real anchor). Note any you downgraded in the task report.

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit` → 0. Run: `npm run lint` → clean.
Run: `npm run test:run` → all green (watch action-menus / help-menu / empty-state tests).

- [ ] **Step 6: Commit**

```bash
git add src/app/task-manager.tsx src/app/help-menu.tsx src/app/action-menus.tsx
git commit -m "feat(sp-f): mount tour overlay + demo load + auto-launch + Help re-launch + anchors"
```

---

## Task 8: Release v0.112.0

**Files:**
- Modify: `src/app/version.ts`
- Modify: `src/app/i18n.ts` + `src/app/i18n.de.ts`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Bump version + highlight key**

In `src/app/version.ts`: `APP_VERSION = "0.112.0"`; update `APP_BUILD_DATE` comment; `APP_MILESTONE = "Okorafor"` (Nnedi Okorafor; update the codename comment for the 0.112.x line). Append `"versionHighlightTour"` to the END of `APP_HIGHLIGHT_KEYS`.

- [ ] **Step 2: Highlight i18n (EN + DE)**

EN (`i18n.ts`), add near the other `versionHighlight*`:
```ts
  versionHighlightTour: "Guided tour + demo: a first-run walkthrough of the main areas (modern layout), a one-click demo project to explore, and a 'Take the tour' entry in the Help menu to replay it anytime.",
```
DE (`i18n.de.ts`) via a node UTF-8 CRLF-aware write (anchor on a real existing `versionHighlight...` DE line):
```
  versionHighlightTour: "Gefuehrte Tour + Demo" -> NO. Use real umlaut:
  versionHighlightTour: "Geführte Tour + Demo: ein Rundgang durch die wichtigsten Bereiche beim ersten Start (moderne Ansicht), ein Demo-Projekt zum Erkunden per Klick und ein Eintrag \"Tour starten\" im Hilfe-Menü zum jederzeitigen Wiederholen.",
```
(Write it with the real `ü` via the node script pattern from Task 1, NOT the Edit tool.) Verify parity + umlauts as in Task 1 Step 3.

- [ ] **Step 3: CHANGELOG entry**

Prepend to `CHANGELOG.md` above the `## [0.111.0]` entry:
```markdown
## [0.112.0] - 2026-06-20 "Okorafor"

### Added
- Guided tour + demo showcase: first-run users get a short walkthrough of the main areas in the modern layout, a one-click "Explore a demo project" that loads sample data, and a "Take the tour" entry in the Help menu to replay it anytime. Per-device; the tour does not run in the classic layout or popouts.
```

- [ ] **Step 4: Verify build + axe (nav anchor didn't regress a11y)**

Run: `npx tsc --noEmit` → 0. Run: `npm run lint` → clean. Run: `npm run test:run` → green.
Run: `npm run build` → succeeds (prebuild highlight-key sync passes).
Run: `npx playwright test e2e/a11y.spec.ts --project=chromium` → Expected: 12/12 pass (the new `data-tour-id` attributes + Help "Take the tour" button must not introduce an axe violation — the Help button has an accessible name via its text).

- [ ] **Step 5: Commit**

```bash
git add src/app/version.ts src/app/i18n.ts src/app/i18n.de.ts CHANGELOG.md
git commit -m "chore(sp-f): release v0.112.0 \"Okorafor\" (guided tour + demo)"
```

---

## Final steps (after all tasks)

1. Dispatch a final whole-branch reviewer (security is light here — focus correctness: auto-launch guard not firing in classic/popout, demo load never clobbering real data, overlay focus/Escape, EN/DE parity, no off-palette tokens, a11y of the overlay + Help button).
2. Use superpowers:finishing-a-development-branch.
3. NOTE: this branch is stacked on SP-E (`steering-committee-spe`). Before the MR, if SP-E (!93) has merged to `main`, rebase `guided-tour-spf` onto `main` so the MR diffs cleanly to just SP-F.

## Self-review notes (resolved)
- **Spec coverage:** modal+spotlight hybrid (Task 4), demo load empty-gated (Task 6), auto first-run + Help re-launch (Tasks 5+7), broad ~12 steps (Task 2), modern-only gates (Tasks 5+7), per-device flag (Task 3), EN/DE (Tasks 1+8). All covered.
- **Anchor IDs** are defined once in `TOUR_ANCHORS` (Task 2) and consumed in Tasks 4/7 — consistent.
- **`jsonToWorkspace` / `applyRestoredWorkspace`** names verified against task-manager (line ~909) + the codecs. Confirm the `jsonToWorkspace` import path at implementation time.
- **`isViewEnabled`** assumed in `feature-modules.ts` (verified present). If a chosen "disabled" test view is core, swap to a module-gated view id.
