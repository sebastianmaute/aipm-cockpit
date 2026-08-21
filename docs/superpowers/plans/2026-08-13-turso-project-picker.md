# Turso Project Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Load from Turso" button — in the pre-project empty state and the Projects view — that opens a picker listing the configured Turso database's active projects and switches straight into whichever one is clicked.

**Architecture:** A pure localStorage/settings helper (`commitTursoPortfolioSwitch`) added to `portfolio-mode.ts` does the actual mode-flip + project-select + reload (mirrors the existing `confirmPortfolioModeSwitch` and `handleCreateProjectByMode`'s cross-mode-create branch — same three writes, this one selects an existing project instead of a new one). A new `TursoProjectPicker` component, built from the shared `Modal`/`ModalHeader`/`Button`/`EmptyState` primitives, fetches `listProjects(cfg)` on open — no mode flip needed just to browse — and calls the helper when a row is clicked. Two call sites (`project-empty-state.tsx`, `projects-panel.tsx`) each get a new button, gated the same way the existing "Move to Turso" button already is (`tursoConfigured`).

**Tech Stack:** Next.js/React/TypeScript, vitest + React Testing Library, existing `turso-portfolio.ts`/`turso-config.ts`/`portfolio-mode.ts` modules.

---

## File structure

- Modify: `src/app/portfolio-mode.ts` — add `commitTursoPortfolioSwitch`.
- Modify: `src/app/portfolio-mode.test.ts` — test it.
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts` — new keys.
- Create: `src/app/turso-project-picker.tsx` — the picker component.
- Create: `src/app/turso-project-picker.test.tsx` — its tests.
- Modify: `src/app/project-empty-state.tsx` — wire in the button + picker.
- Modify: `src/app/project-empty-state.test.tsx` — test the wiring.
- Modify: `src/app/projects-panel.tsx` — wire in the button + picker.
- Modify: `src/app/projects-panel.test.tsx` — test the wiring.

---

### Task 1: `commitTursoPortfolioSwitch` helper

**Files:**
- Modify: `src/app/portfolio-mode.ts`
- Test: `src/app/portfolio-mode.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/app/portfolio-mode.test.ts`, inside the existing `describe("portfolio-mode", ...)` block, right after the `"current turso project id defaults to null and round-trips"` test (before its closing `});`):

```ts
  it("commitTursoPortfolioSwitch persists mode, project id, and storageConfig, then reloads", () => {
    const reloadSpy = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, reload: reloadSpy },
    });
    commitTursoPortfolioSwitch(defaultSettings, "p1");
    expect(loadPortfolioMode()).toBe("turso");
    expect(loadCurrentTursoProjectId()).toBe("p1");
    expect(reloadSpy).toHaveBeenCalledTimes(1);
  });
```

Add two imports at the top of the file: add `commitTursoPortfolioSwitch` to the existing import list from `"./portfolio-mode"` (it currently imports `loadPortfolioMode, savePortfolioMode, loadCurrentTursoProjectId, saveCurrentTursoProjectId, MODE_KEY, CURRENT_TURSO_PROJECT_KEY`), and add a new import `import { defaultSettings } from "./settings-types";`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/portfolio-mode.test.ts --reporter=dot`
Expected: FAIL — `commitTursoPortfolioSwitch is not exported` (or `is not a function`).

- [ ] **Step 3: Write minimal implementation**

In `src/app/portfolio-mode.ts`, add the import and function at the end of the file:

```ts
import { type Settings } from "./settings-types";
import { writeSettings } from "./use-settings";
```

(add these two imports right after the existing `import { isSafeMode } from "./safe-mode";` line)

```ts
/** Switch the portfolio to Turso and land directly on `projectId` after
 *  reload — the "load an existing Turso project" shortcut used by the
 *  TursoProjectPicker. Same three writes `confirmPortfolioModeSwitch`
 *  (integrations-section.tsx) already does when switching TO Turso, plus
 *  pre-selecting which project to land on. Left as a plain export here
 *  rather than folded into that function: that one also handles the
 *  switch-AWAY-from-turso branch, which this shortcut has no reason to know
 *  about. */
export function commitTursoPortfolioSwitch(settings: Settings, projectId: string): void {
  savePortfolioMode("turso");
  saveCurrentTursoProjectId(projectId);
  writeSettings({ ...settings, storageConfig: { kind: "turso" } });
  window.location.reload();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/portfolio-mode.test.ts --reporter=dot`
Expected: PASS (5 tests in the main describe block, all green).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/app/portfolio-mode.ts src/app/portfolio-mode.test.ts
git commit -m "feat: add commitTursoPortfolioSwitch for loading an existing Turso project"
```

---

### Task 2: i18n keys

**Files:**
- Modify: `src/app/i18n.ts`
- Modify: `src/app/i18n.de.ts`

- [ ] **Step 1: Add the English keys**

In `src/app/i18n.ts`, find this existing line (search for `projectMigrateNoProject`):

```ts
  projectMigrateNoProject: "No current project to move.",
```

Add these eight keys immediately after it (before the following `portfolioModeLabel:` line):

```ts
  projectLoadFromTurso: "Load from Turso",
  projectLoadFromTursoHint:
    "Browse projects already stored in the configured Turso database and switch into one.",
  tursoPickerTitle: "Load a Turso project",
  tursoPickerLoading: "Loading projects…",
  tursoPickerEmpty: "No projects found in this Turso database.",
  tursoPickerError: "Could not load the project list.",
  tursoPickerRetry: "Retry",
  tursoPickerLoad: "Load",
```

- [ ] **Step 2: Add the matching German keys via a raw Node.js script (NOT the Edit tool)**

`src/app/i18n.de.ts` is CRLF and this project's own tooling (including the Edit tool) can corrupt its encoding even for umlaut-free insertions — always patch it with a raw UTF-8 Node.js script instead. First find the anchor line (same key, German file) — it should read:

```ts
  projectMigrateNoProject: "Kein aktuelles Projekt zum Verschieben.",
```

(confirm the exact existing text with `grep -n "projectMigrateNoProject" src/app/i18n.de.ts` before writing the script — copy the anchor from that output rather than assuming this English gloss is byte-exact).

Then run a script like this (adjust the anchor string to match exactly what the grep printed, including its trailing comma and any trailing whitespace before the line terminator):

```bash
node -e '
const fs = require("fs");
const path = "src/app/i18n.de.ts";
const original = fs.readFileSync(path, "utf8");
const anchor = "  projectMigrateNoProject: \"Kein aktuelles Projekt zum Verschieben.\",\r\n";
const insertion =
  "  projectLoadFromTurso: \"Von Turso laden\",\r\n" +
  "  projectLoadFromTursoHint:\r\n" +
  "    \"Bereits in der konfigurierten Turso-Datenbank gespeicherte Projekte durchsuchen und in eines wechseln.\",\r\n" +
  "  tursoPickerTitle: \"Turso-Projekt laden\",\r\n" +
  "  tursoPickerLoading: \"Projekte werden geladen…\",\r\n" +
  "  tursoPickerEmpty: \"Keine Projekte in dieser Turso-Datenbank gefunden.\",\r\n" +
  "  tursoPickerError: \"Projektliste konnte nicht geladen werden.\",\r\n" +
  "  tursoPickerRetry: \"Wiederholen\",\r\n" +
  "  tursoPickerLoad: \"Laden\",\r\n";
if (!original.includes(anchor)) {
  throw new Error("Anchor not found — re-check the exact existing line with grep first.");
}
const updated = original.replace(anchor, anchor + insertion);
fs.writeFileSync(path, updated, "utf8");
console.log("inserted");
'
```

- [ ] **Step 2b: Verify the insertion landed uncorrupted**

Run: `grep -n "tursoPickerLoad\|projectLoadFromTurso" src/app/i18n.de.ts`
Expected: all 8 new keys listed, German text intact (no mangled quotes, no literal `\r\n` visible as text).

- [ ] **Step 3: Verify EN/DE key parity**

Run: `npx tsc --noEmit`
Expected: exit 0. (`Lang`'s i18n typing enforces EN/DE key-set identity — a missing DE key fails here, not at runtime.)

- [ ] **Step 4: Commit**

```bash
git add src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat: add i18n strings for the Turso project picker"
```

---

### Task 3: `TursoProjectPicker` component

**Files:**
- Create: `src/app/turso-project-picker.tsx`
- Test: `src/app/turso-project-picker.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/app/turso-project-picker.test.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TursoProjectPicker } from "./turso-project-picker";
import { defaultSettings } from "./settings-types";

vi.mock("./turso-portfolio", () => ({
  listProjects: vi.fn(),
}));
vi.mock("./portfolio-mode", () => ({
  commitTursoPortfolioSwitch: vi.fn(),
}));

import { listProjects } from "./turso-portfolio";
import { commitTursoPortfolioSwitch } from "./portfolio-mode";

const TURSO_SETTINGS = {
  ...defaultSettings,
  integrations: {
    ...defaultSettings.integrations,
    turso: { enabled: true, databaseUrl: "libsql://db-org.turso.io", authToken: "tok" },
  },
};

function setup() {
  const onClose = vi.fn();
  render(<TursoProjectPicker lang="en-US" settings={TURSO_SETTINGS} onClose={onClose} />);
  return { onClose };
}

afterEach(() => {
  vi.resetAllMocks();
});

describe("TursoProjectPicker", () => {
  it("shows each active project as a row and switches on click", async () => {
    vi.mocked(listProjects).mockResolvedValueOnce([
      { id: "p1", meta: { name: "Apollo", code: "APL-1" }, archived: false } as never,
      { id: "p2", meta: { name: "Gemini", code: "GEM-2" }, archived: false } as never,
    ]);
    setup();
    expect(await screen.findByText("Apollo")).toBeInTheDocument();
    expect(screen.getByText("Gemini")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /load – apollo/i }));
    expect(commitTursoPortfolioSwitch).toHaveBeenCalledWith(TURSO_SETTINGS, "p1");
  });

  it("shows an empty state when the database has no projects", async () => {
    vi.mocked(listProjects).mockResolvedValueOnce([]);
    setup();
    expect(
      await screen.findByText("No projects found in this Turso database."),
    ).toBeInTheDocument();
  });

  it("shows an error with Retry, and Retry re-fetches", async () => {
    vi.mocked(listProjects).mockRejectedValueOnce(new Error("network down"));
    setup();
    expect(await screen.findByText(/could not load/i)).toBeInTheDocument();

    vi.mocked(listProjects).mockResolvedValueOnce([
      { id: "p1", meta: { name: "Apollo", code: "APL-1" }, archived: false } as never,
    ]);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Apollo")).toBeInTheDocument();
  });

  it("calls onClose when the modal's close button is clicked", async () => {
    vi.mocked(listProjects).mockResolvedValueOnce([]);
    const { onClose } = setup();
    await screen.findByText("No projects found in this Turso database.");
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/turso-project-picker.test.tsx --reporter=dot`
Expected: FAIL — `Cannot find module './turso-project-picker'` (the component doesn't exist yet).

- [ ] **Step 3: Write minimal implementation**

Create `src/app/turso-project-picker.tsx`:

```tsx
"use client";

// Picker for loading an existing project from a configured Turso database.
// Fetches the ACTIVE project list on open — no portfolio-mode flip needed
// just to browse — and switches straight into whichever project is clicked
// via commitTursoPortfolioSwitch. Mirrors "Load from file" as a direct,
// self-contained action rather than routing through the general Settings
// File/Turso mode toggle (which has no project picker of its own).
//
// Archived projects are out of scope here — both call sites already have a
// dedicated archived-project restore flow; this picker lists active
// projects only.

import { useEffect, useState } from "react";
import { t, type Lang } from "./i18n";
import { Modal } from "./modal";
import { ModalHeader } from "./modal-header";
import { Button } from "./button";
import { EmptyState } from "./empty-state";
import { getTursoConfig } from "./turso-config";
import { listProjects } from "./turso-portfolio";
import { commitTursoPortfolioSwitch } from "./portfolio-mode";
import { type Settings } from "./settings-types";
import type { ProjectListEntry } from "./turso-tenant-schema";

export interface TursoProjectPickerProps {
  lang: Lang;
  settings: Settings;
  onClose: () => void;
}

type FetchState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; projects: ProjectListEntry[] };

const TITLE_ID = "turso-project-picker-title";

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function TursoProjectPicker({ lang, settings, onClose }: TursoProjectPickerProps) {
  const [state, setState] = useState<FetchState>({ kind: "loading" });

  function load() {
    setState({ kind: "loading" });
    const cfg = getTursoConfig(
      settings.integrations?.turso?.databaseUrl,
      settings.integrations?.turso?.authToken,
    );
    if (!cfg) {
      setState({ kind: "error", message: t(lang, "tursoPickerError") });
      return;
    }
    listProjects(cfg)
      .then((projects) => setState({ kind: "ready", projects }))
      .catch((err: unknown) =>
        setState({ kind: "error", message: `${t(lang, "tursoPickerError")} ${errorText(err)}` }),
      );
  }

  // Fetch once on mount, same shape as the already-shipped Turso list refresh
  // in task-manager.tsx (async IIFE inside a mount-only effect). Retry
  // re-invokes `load` directly from its button, so the effect's own deps stay
  // `[]` — it only ever needs to fire once.
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handlePick(id: string) {
    commitTursoPortfolioSwitch(settings, id);
  }

  return (
    <Modal open onClose={onClose} ariaLabelledby={TITLE_ID} align="center" zIndex={60}>
      <div
        data-modal-panel
        className="relative flex max-h-[90vh] w-[520px] min-w-[360px] max-w-[95vw] flex-col overflow-hidden rounded-xl border border-line bg-surface"
      >
        <ModalHeader lang={lang} title={t(lang, "tursoPickerTitle")} titleId={TITLE_ID} onClose={onClose} />
        <div className="overflow-y-auto p-6">
          {state.kind === "loading" && (
            <p className="text-sm text-muted-foreground">{t(lang, "tursoPickerLoading")}</p>
          )}
          {state.kind === "error" && (
            <div className="flex flex-col items-start gap-3">
              <p className="text-sm text-ui-pink-strong">{state.message}</p>
              <Button variant="secondary" size="sm" onClick={load}>
                {t(lang, "tursoPickerRetry")}
              </Button>
            </div>
          )}
          {state.kind === "ready" && state.projects.length === 0 && (
            <EmptyState compact title={t(lang, "tursoPickerEmpty")} />
          )}
          {state.kind === "ready" && state.projects.length > 0 && (
            <ul className="flex flex-col gap-2">
              {state.projects.map((p) => (
                <li
                  key={p.id}
                  className="flex items-center justify-between gap-3 rounded-md border border-line bg-surface px-3 py-2"
                >
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <span className="font-medium text-foreground">{p.meta.name}</span>
                    <span className="font-mono text-xs text-muted-foreground">{p.meta.code}</span>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => handlePick(p.id)}
                    aria-label={`${t(lang, "tursoPickerLoad")} – ${p.meta.name}`}
                  >
                    {t(lang, "tursoPickerLoad")}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Modal>
  );
}
```

Note on the mount effect: `react-hooks/set-state-in-effect` (AGENTS.md) bans directly mirroring a changed PROP into state inside a `useEffect` (use the render-time reconcile pattern for that) — it does not ban a mount-only async fetch whose `.then`/`.catch` calls `setState`. `task-manager.tsx`'s `refreshTursoProjects` effect (`useEffect(() => { ...; void (async () => { await refreshTursoProjects(); })(); }, [...])`) is the exact same shape and already ships. `load()` here plays the same role as that inner async IIFE.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/turso-project-picker.test.tsx --reporter=dot`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit`
Expected: exit 0.

Run: `npx eslint --max-warnings=0 src/app/turso-project-picker.tsx src/app/turso-project-picker.test.tsx`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/app/turso-project-picker.tsx src/app/turso-project-picker.test.tsx
git commit -m "feat: add TursoProjectPicker component"
```

---

### Task 4: Wire into the pre-project empty state

**Files:**
- Modify: `src/app/project-empty-state.tsx`
- Test: `src/app/project-empty-state.test.tsx`

- [ ] **Step 1: Write the failing tests**

Add to `src/app/project-empty-state.test.tsx`, as a new `describe` block after the existing `describe("ProjectEmptyState", ...)` block:

```tsx
describe("ProjectEmptyState — Load from Turso", () => {
  it("hides the button when Turso is not configured", () => {
    setup();
    expect(screen.queryByRole("button", { name: "Load from Turso" })).toBeNull();
  });

  it("hides the button when the portfolio is already on Turso", () => {
    setup({
      mode: "turso",
      settings: {
        ...defaultSettings,
        integrations: {
          ...defaultSettings.integrations,
          turso: { enabled: true, databaseUrl: "libsql://db-org.turso.io", authToken: "tok" },
        },
      },
    });
    expect(screen.queryByRole("button", { name: "Load from Turso" })).toBeNull();
  });

  it("shows the button in file mode once Turso is configured, and opens the picker", () => {
    setup({
      settings: {
        ...defaultSettings,
        integrations: {
          ...defaultSettings.integrations,
          turso: { enabled: true, databaseUrl: "libsql://db-org.turso.io", authToken: "tok" },
        },
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Load from Turso" }));
    expect(screen.getByRole("dialog", { name: "Load a Turso project" })).toBeInTheDocument();
  });
});
```

Add `defaultTursoIntegrations` is already imported in this test file but unused for this — no new imports needed beyond what's already there (`defaultSettings` is already imported).

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/app/project-empty-state.test.tsx --reporter=dot`
Expected: FAIL on all three new tests — "Load from Turso" button not found (doesn't exist yet).

- [ ] **Step 3: Write minimal implementation**

In `src/app/project-empty-state.tsx`, add two imports after the existing `import { BackendSetupWizard } from "./backend-setup-wizard";` line:

```tsx
import { TursoProjectPicker } from "./turso-project-picker";
import { getTursoConfig } from "./turso-config";
```

Add a `tursoPickerOpen` state next to the existing `configOpen`/`wizardOpen`/`aiConfigOpen` state declarations:

```tsx
  const [tursoPickerOpen, setTursoPickerOpen] = useState(false);
```

Compute whether Turso is configured, right before the `handleOpenCreate` line:

```tsx
  const tursoConfigured = !!getTursoConfig(
    settings.integrations?.turso?.databaseUrl,
    settings.integrations?.turso?.authToken,
  );
```

In the choices view's button row, add the new button right after the existing "Load from file" `Button` and before the `onLoadDemo` block:

```tsx
                {mode === "file" && tursoConfigured && (
                  <Button variant="secondary" onClick={() => setTursoPickerOpen(true)}>
                    {t(lang, "projectLoadFromTurso")}
                  </Button>
                )}
```

Render the picker near the other conditionally-rendered modals at the bottom of the component, right after the closing `)}` of the `wizardOpen` block and before the `deleteTarget` block:

```tsx
      {tursoPickerOpen && (
        <TursoProjectPicker
          lang={lang}
          settings={settings}
          onClose={() => setTursoPickerOpen(false)}
        />
      )}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/app/project-empty-state.test.tsx --reporter=dot`
Expected: PASS (all tests in the file, including the 3 new ones).

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit`
Expected: exit 0.

Run: `npx eslint --max-warnings=0 src/app/project-empty-state.tsx src/app/project-empty-state.test.tsx`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/app/project-empty-state.tsx src/app/project-empty-state.test.tsx
git commit -m "feat: add Load-from-Turso button to the pre-project empty state"
```

---

### Task 5: Wire into the Projects view

**Files:**
- Modify: `src/app/projects-panel.tsx`
- Test: `src/app/projects-panel.test.tsx`

- [ ] **Step 1: Write the failing tests**

Add to `src/app/projects-panel.test.tsx`, as a new `describe` block after the existing `describe("ProjectsPanel turso mode", ...)` block:

```tsx
describe("ProjectsPanel — Load from Turso", () => {
  it("hides the button when Turso is not configured", () => {
    setup();
    expect(screen.queryByRole("button", { name: "Load from Turso" })).toBeNull();
  });

  it("hides the button while already in turso mode", () => {
    setup({
      mode: "turso",
      settings: {
        ...defaultSettings,
        integrations: {
          ...defaultSettings.integrations,
          turso: { enabled: true, databaseUrl: "libsql://db-org.turso.io", authToken: "tok" },
        },
      },
    });
    expect(screen.queryByRole("button", { name: "Load from Turso" })).toBeNull();
  });

  it("shows the button in file mode once Turso is configured, and opens the picker", () => {
    setup({
      settings: {
        ...defaultSettings,
        integrations: {
          ...defaultSettings.integrations,
          turso: { enabled: true, databaseUrl: "libsql://db-org.turso.io", authToken: "tok" },
        },
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Load from Turso" }));
    expect(screen.getByRole("dialog", { name: "Load a Turso project" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/app/projects-panel.test.tsx --reporter=dot`
Expected: FAIL on the 3 new tests — "Load from Turso" button not found.

- [ ] **Step 3: Write minimal implementation**

In `src/app/projects-panel.tsx`, add an import after the existing `import { getTursoConfig } from "./turso-config";` line:

```tsx
import { TursoProjectPicker } from "./turso-project-picker";
```

Add a `tursoPickerOpen` state next to the existing `showArchived`/`hardDeleteTarget` state declarations:

```tsx
  const [tursoPickerOpen, setTursoPickerOpen] = useState(false);
```

In the header, add the new button right after the existing "Load from file" `Button` block and before the "Migrate to Turso" block:

```tsx
          {!isTurso && tursoConfigured && (
            <Button variant="secondary" size="sm" onClick={() => setTursoPickerOpen(true)}>
              {t(lang, "projectLoadFromTurso")}
            </Button>
          )}
```

Render the picker near the other conditionally-rendered modals, right after the closing `)}` of the `hardDeleteTarget` block and before the `modal.mode === "create"` block:

```tsx
      {tursoPickerOpen && (
        <TursoProjectPicker
          lang={lang}
          settings={settings}
          onClose={() => setTursoPickerOpen(false)}
        />
      )}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/app/projects-panel.test.tsx --reporter=dot`
Expected: PASS (all tests in the file, including the 3 new ones).

- [ ] **Step 5: Typecheck and lint**

Run: `npx tsc --noEmit`
Expected: exit 0.

Run: `npx eslint --max-warnings=0 src/app/projects-panel.tsx src/app/projects-panel.test.tsx`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/app/projects-panel.tsx src/app/projects-panel.test.tsx
git commit -m "feat: add Load-from-Turso button to the Projects view"
```

---

### Task 6: Full verification pass

**Files:** none (verification only).

- [ ] **Step 1: Full typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 2: Full lint (the actual CI gate, not bare `npm run lint`)**

Run: `npx eslint --max-warnings=0 src/app`
Expected: exit 0.

- [ ] **Step 3: Doc-claims ratchet**

Run: `npm run docs:claims:check`
Expected: exit 0. (No new `path:LINE` citations were added by this plan, so this should be a pure pass-through.)

- [ ] **Step 4: Full unit suite**

Run: `npm run test:run > /tmp/turso-picker-suite.log 2>&1; echo "EXIT=$?"` then read the log file (never trust a piped exit code — see AGENTS.md).
Expected: `EXIT=0`, all test files passed, no new failures.

- [ ] **Step 5: Shuffle suite (the local reproduction of the blocking CI shuffle gate)**

Run: `npm run test:shuffle > /tmp/turso-picker-shuffle.log 2>&1; echo "EXIT=$?"` then read the log file.
Expected: `EXIT=0`.

- [ ] **Step 6: Symbol-check gate (this plan didn't touch any `docs/AGENTS/*.md` file, but confirm nothing else broke it)**

Run: `npm run docs:symbols:check`
Expected: exit 0.

No commit for this task — it's verification-only. If anything fails, fix it and re-run the specific failing command before moving on; do not proceed to the next slice with a red gate.

---

## Self-review notes

- **Spec coverage:** every section of `2026-08-13-turso-project-picker-design.md` has a task — the shared helper (Task 1), i18n (Task 2), the picker component with all four states (Task 3), and both wiring call sites (Tasks 4–5). The spec's "non-goals" (archived projects, the Settings dropdown, the create wizard) are honored by omission — no task touches any of them.
- **Type consistency:** `commitTursoPortfolioSwitch(settings: Settings, projectId: string)` is defined once in Task 1 and called with that exact signature in Task 3's `handlePick` and in every test. `TursoProjectPickerProps` (`lang`, `settings`, `onClose`) matches how both Task 4 and Task 5 render it.
- **Placeholder scan:** no TBDs; every step shows real code or an exact command + expected output.
