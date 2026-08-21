# Simple / Modular / Advanced Mode — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Simple mode (core only: Tasks, Chat, Reports, Activity, Settings), let the user re-enable individual feature-modules to reach Modular mode, and auto-return to Advanced (all on) when every module is enabled — disabling a module retains its data, records no new data, and pauses cross-module automation.

**Architecture:** A new `feature-modules.ts` registry holds the 9 toggleable modules and pure helpers (`deriveMode`, `isViewEnabled`, `sanitizeFeatures`, `filterNavGroups` inputs, `visibleReports`). `Settings.features: FeatureModuleId[]` (default all) is the single source of truth. A new Mode settings section edits a local draft and, on explicit Save, writes settings to localStorage and reloads. Navigation, automation hooks, dashboard sections, gantt overlay, cross-links, and the reports picker all read the enabled set and hide disabled modules' surfaces.

**Tech Stack:** Next.js (app dir), React, TypeScript, Tailwind (AIPM palette), Vitest 4 + Testing Library.

---

## Conventions (apply to every task)

- **Run a single test file:** `npx vitest run src/app/<file>.test.ts`
- **Full suite:** `npm run test:run`
- **Lint (must be clean, `--max-warnings=0`):** `npm run lint`
- **Types:** `npx tsc --noEmit` (a pre-existing `.next/dev/types/routes.d.ts` error is ignorable)
- **Commit via the Bash tool** with a heredoc: `git commit -F - <<'EOF' ... EOF` (NOT PowerShell `@'…'@`).
- **i18n:** add EN keys to `src/app/i18n.ts` (Edit/Write is fine). Add DE keys to `src/app/i18n.de.ts` via a **Node byte-patch script** (CRLF-aware), NEVER the Edit tool (it corrupts ASCII `"` into curly quotes). After patching DE, verify zero curly quotes were introduced: `node -e "const s=require('fs').readFileSync('src/app/i18n.de.ts','utf8');console.log([...s].filter(c=>'“”‘’'.includes(c)).length)"` must print `0`.
- **Palette:** AIPM tokens only. The only amber allowed is `bg-amber-500/20 text-AIPM-purple`.
- Component tests use `lang="en-US"`.

---

## Task 1: Feature-module registry + helpers

**Files:**
- Create: `src/app/feature-modules.ts`
- Test: `src/app/feature-modules.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/app/feature-modules.test.ts
import { describe, expect, it } from "vitest";
import {
  ALL_MODULE_IDS,
  CORE_VIEWS,
  FEATURE_MODULES,
  deriveMode,
  enabledNavViews,
  isModuleEnabled,
  isViewEnabled,
  moduleForView,
  sanitizeFeatures,
  visibleReports,
} from "./feature-modules";

describe("feature-modules registry", () => {
  it("has 9 modules and uses each id once", () => {
    expect(ALL_MODULE_IDS).toHaveLength(9);
    expect(new Set(ALL_MODULE_IDS).size).toBe(9);
  });

  it("every module's parent view appears in its views list", () => {
    for (const m of FEATURE_MODULES) expect(m.views).toContain(m.id as never);
  });
});

describe("sanitizeFeatures", () => {
  it("treats undefined (legacy) as all modules enabled", () => {
    expect(sanitizeFeatures(undefined)).toEqual([...ALL_MODULE_IDS]);
  });
  it("treats an empty array as Simple (nothing enabled)", () => {
    expect(sanitizeFeatures([])).toEqual([]);
  });
  it("drops junk and orders by registry order", () => {
    expect(sanitizeFeatures(["raid", "nope", "budget", "raid"])).toEqual(["budget", "raid"]);
  });
});

describe("deriveMode", () => {
  it("all nine -> advanced", () => {
    expect(deriveMode([...ALL_MODULE_IDS])).toBe("advanced");
  });
  it("none -> simple", () => {
    expect(deriveMode([])).toBe("simple");
  });
  it("some -> modular", () => {
    expect(deriveMode(["raid"])).toBe("modular");
  });
});

describe("isViewEnabled", () => {
  it("core views are always enabled, even in Simple", () => {
    for (const v of CORE_VIEWS) expect(isViewEnabled(v, [])).toBe(true);
  });
  it("a child view follows its parent module", () => {
    expect(isViewEnabled("raci", [])).toBe(false);
    expect(isViewEnabled("raci", ["stakeholders"])).toBe(true);
  });
  it("budget-report follows the budget module", () => {
    expect(isViewEnabled("budget-report", [])).toBe(false);
    expect(isViewEnabled("budget-report", ["budget"])).toBe(true);
  });
});

describe("isModuleEnabled / moduleForView / enabledNavViews", () => {
  it("isModuleEnabled reflects membership", () => {
    expect(isModuleEnabled("raid", ["raid"])).toBe(true);
    expect(isModuleEnabled("raid", [])).toBe(false);
  });
  it("moduleForView maps child to parent module, core to null", () => {
    expect(moduleForView("stakeholder-map")).toBe("stakeholders");
    expect(moduleForView("chat")).toBeNull();
  });
  it("enabledNavViews includes core plus enabled modules' views", () => {
    const views = enabledNavViews(["budget"]);
    expect(views).toContain("open-points");
    expect(views).toContain("budget");
    expect(views).toContain("budget-report");
    expect(views).not.toContain("raid");
  });
});

describe("visibleReports", () => {
  it("keeps only reports whose module is enabled, preserving stored order semantics", () => {
    expect(visibleReports(["raid-report", "budget-report"], ["budget"])).toEqual(["budget-report"]);
  });
  it("returns nothing when all owning modules are off", () => {
    expect(visibleReports(["raid-report", "stakeholder-report"], [])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/feature-modules.test.ts`
Expected: FAIL — `Cannot find module './feature-modules'`.

- [ ] **Step 3: Write the implementation**

```typescript
// src/app/feature-modules.ts
import type { AppView } from "./nav-config";
import type { AddableReportId } from "./addable-reports";
import type { TranslationKey } from "./i18n";

export type FeatureModuleId =
  | "dashboard" | "trends" | "gantt" | "milestones" | "resources"
  | "budget" | "raid" | "changes" | "stakeholders";

export interface FeatureModule {
  id: FeatureModuleId;
  labelKey: TranslationKey;
  /** Parent view + every child view this module owns. The parent view id equals the module id. */
  views: AppView[];
  /** The addable report this module unlocks, if any. */
  report?: AddableReportId;
}

export const FEATURE_MODULES: readonly FeatureModule[] = [
  { id: "dashboard", labelKey: "navDashboard", views: ["dashboard"] },
  { id: "trends", labelKey: "navTrends", views: ["trends"] },
  { id: "gantt", labelKey: "tabGantt", views: ["gantt"] },
  { id: "milestones", labelKey: "navMilestones", views: ["milestones"] },
  {
    id: "resources",
    labelKey: "tabResources",
    views: ["resources", "directory", "workload", "calendar", "planning", "manage-roles"],
    report: "resource-report",
  },
  { id: "budget", labelKey: "tabBudget", views: ["budget", "budget-report"], report: "budget-report" },
  { id: "raid", labelKey: "tabRaid", views: ["raid", "raid-report"], report: "raid-report" },
  { id: "changes", labelKey: "navChanges", views: ["changes", "change-report"] },
  {
    id: "stakeholders",
    labelKey: "navStakeholders",
    views: ["stakeholders", "raci", "stakeholder-map"],
    report: "stakeholder-report",
  },
] as const;

/** Views always present regardless of mode. */
export const CORE_VIEWS: readonly AppView[] = [
  "open-points", "chat", "reports", "activity", "settings", "edit",
] as const;

export const ALL_MODULE_IDS: readonly FeatureModuleId[] = FEATURE_MODULES.map((m) => m.id);

export type AppMode = "simple" | "modular" | "advanced";

const MODULE_BY_ID = new Map<FeatureModuleId, FeatureModule>(
  FEATURE_MODULES.map((m) => [m.id, m]),
);
const VIEW_TO_MODULE = new Map<AppView, FeatureModuleId>(
  FEATURE_MODULES.flatMap((m) => m.views.map((v) => [v, m.id] as const)),
);

/** undefined (legacy, no key) -> all modules; arrays kept (incl. []), filtered to valid ids in registry order. */
export function sanitizeFeatures(raw: unknown): FeatureModuleId[] {
  if (raw === undefined) return [...ALL_MODULE_IDS];
  if (!Array.isArray(raw)) return [];
  const wanted = new Set(raw);
  return ALL_MODULE_IDS.filter((id) => wanted.has(id));
}

export function deriveMode(features: readonly FeatureModuleId[]): AppMode {
  if (features.length === 0) return "simple";
  if (features.length >= ALL_MODULE_IDS.length) return "advanced";
  return "modular";
}

export function isModuleEnabled(id: FeatureModuleId, features: readonly FeatureModuleId[]): boolean {
  return features.includes(id);
}

export function moduleForView(view: AppView): FeatureModuleId | null {
  return VIEW_TO_MODULE.get(view) ?? null;
}

export function isViewEnabled(view: AppView, features: readonly FeatureModuleId[]): boolean {
  const mod = VIEW_TO_MODULE.get(view);
  if (!mod) return true; // core view
  return features.includes(mod);
}

export function enabledNavViews(features: readonly FeatureModuleId[]): AppView[] {
  const core = CORE_VIEWS.filter((v) => v !== "edit" && v !== "settings");
  const moduleViews = features.flatMap((id) => MODULE_BY_ID.get(id)?.views ?? []);
  return [...core, ...moduleViews];
}

export function reportForModule(id: FeatureModuleId): AddableReportId | null {
  return MODULE_BY_ID.get(id)?.report ?? null;
}

/** Filter a stored extra-reports list to those whose owning module is enabled. */
export function visibleReports(
  extra: readonly AddableReportId[],
  features: readonly FeatureModuleId[],
): AddableReportId[] {
  const enabledReports = new Set(
    features.map((id) => MODULE_BY_ID.get(id)?.report).filter((r): r is AddableReportId => !!r),
  );
  return extra.filter((id) => enabledReports.has(id));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/feature-modules.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Lint + commit**

```bash
npm run lint
git add src/app/feature-modules.ts src/app/feature-modules.test.ts
git commit -F - <<'EOF'
feat: feature-module registry + mode helpers

Single source of truth for the 9 toggleable modules, core views, and pure
helpers (deriveMode, isViewEnabled, sanitizeFeatures, enabledNavViews,
visibleReports).
EOF
```

---

## Task 2: Settings field + persistence helpers

**Files:**
- Modify: `src/app/settings-types.ts:170-198` (add `features` to `Settings` + `defaultSettings`)
- Modify: `src/app/use-settings.ts` (merge `sanitizeFeatures` on load; export `SETTINGS_KEY` + `writeSettings`)
- Test: `src/app/use-settings.test.ts` (extend)

- [ ] **Step 1: Write the failing test** (append to `src/app/use-settings.test.ts`)

```typescript
import { SETTINGS_KEY, writeSettings } from "./use-settings";
import { ALL_MODULE_IDS } from "./feature-modules";
import { defaultSettings } from "./settings-types";

describe("features persistence", () => {
  it("defaultSettings enables all modules (Advanced)", () => {
    expect(defaultSettings.features).toEqual([...ALL_MODULE_IDS]);
  });

  it("writeSettings round-trips the features array to localStorage", () => {
    writeSettings({ ...defaultSettings, features: ["raid", "budget"] });
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw as string).features).toEqual(["raid", "budget"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/use-settings.test.ts`
Expected: FAIL — `SETTINGS_KEY`/`writeSettings` not exported and `defaultSettings.features` undefined.

- [ ] **Step 3: Implement**

In `src/app/settings-types.ts`, import the type and add the field:

```typescript
import type { FeatureModuleId } from "./feature-modules";
import { ALL_MODULE_IDS } from "./feature-modules";
```

Add to the `Settings` type (after `snapshots?`):

```typescript
  features: FeatureModuleId[];
```

Add to `defaultSettings` (after `snapshots`):

```typescript
  features: [...ALL_MODULE_IDS],
```

In `src/app/use-settings.ts`:

1. Export the key and a writer. Change `const SETTINGS_KEY = "lop-app:settings";` to:

```typescript
export const SETTINGS_KEY = "lop-app:settings";

/** Synchronously persist settings (used by the explicit save+reload mode commit). */
export function writeSettings(settings: Settings): void {
  window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}
```

2. Add the import at the top:

```typescript
import { sanitizeFeatures } from "./feature-modules";
```

3. In the `merged` object (inside the load effect), add a `features` line alongside the other coerced fields (e.g. after `snapshots: resolveSnapshotSettings(parsed.snapshots),`):

```typescript
            features: sanitizeFeatures((parsed as Record<string, unknown>).features),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/use-settings.test.ts`
Expected: PASS.

- [ ] **Step 5: Lint + commit**

```bash
npm run lint
git add src/app/settings-types.ts src/app/use-settings.ts src/app/use-settings.test.ts
git commit -F - <<'EOF'
feat: persist Settings.features (default all-on) + writeSettings helper

Legacy settings without a features key migrate to Advanced (all modules on).
EOF
```

---

## Task 3: Nav filtering helpers

**Files:**
- Modify: `src/app/nav-config.ts` (add `filterNavGroups`; add optional `features` arg to `subTabsFor`)
- Test: `src/app/nav-config.test.ts` (extend)

- [ ] **Step 1: Write the failing test** (append to `src/app/nav-config.test.ts`)

```typescript
import { filterNavGroups, subTabsFor } from "./nav-config";

describe("filterNavGroups", () => {
  it("Simple mode keeps only core items and drops empty groups", () => {
    const groups = filterNavGroups([]);
    const views = groups.flatMap((g) => g.items.map((i) => i.view));
    expect(views).toContain("open-points");
    expect(views).toContain("chat");
    expect(views).toContain("reports");
    expect(views).toContain("activity");
    expect(views).not.toContain("gantt");
    expect(views).not.toContain("raid");
    // The "Plan" group has no core items, so it disappears entirely.
    expect(groups.some((g) => g.labelKey === "navGroupPlan")).toBe(false);
  });

  it("enabling a module restores its parent and children", () => {
    const groups = filterNavGroups(["stakeholders"]);
    const item = groups.flatMap((g) => g.items).find((i) => i.view === "stakeholders");
    expect(item).toBeTruthy();
    expect((item?.children ?? []).map((c) => c.view)).toEqual(["raci", "stakeholder-map"]);
  });
});

describe("subTabsFor with features", () => {
  it("filters children to enabled modules", () => {
    // resources children all belong to the resources module
    expect(subTabsFor("resources", []).length).toBe(0);
    expect(subTabsFor("resources", ["resources"]).length).toBeGreaterThan(0);
  });
  it("is unchanged when no features arg is supplied", () => {
    expect(subTabsFor("resources").length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/nav-config.test.ts`
Expected: FAIL — `filterNavGroups` not exported / `subTabsFor` arity.

- [ ] **Step 3: Implement** in `src/app/nav-config.ts`

Add the import at the top:

```typescript
import { isViewEnabled, type FeatureModuleId } from "./feature-modules";
```

Add `filterNavGroups` (place after `allNavViews`):

```typescript
/** NAV_GROUPS pruned to enabled views: disabled items and children removed,
 *  and any group left with no items dropped. Core views always survive. */
export function filterNavGroups(features: readonly FeatureModuleId[]): NavGroup[] {
  return NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items
      .filter((item) => isViewEnabled(item.view, features))
      .map((item) => ({
        ...item,
        children: (item.children ?? []).filter((c) => isViewEnabled(c.view, features)),
      })),
  })).filter((group) => group.items.length > 0);
}
```

Update `subTabsFor` to accept optional features (back-compatible):

```typescript
export function subTabsFor(
  view: AppView,
  features?: readonly FeatureModuleId[],
): readonly { view: AppView }[] {
  for (const group of NAV_GROUPS) {
    for (const item of group.items) {
      const contains =
        item.view === view || (item.children ?? []).some((c) => c.view === view);
      if (contains) {
        const children = item.children ?? [];
        return features ? children.filter((c) => isViewEnabled(c.view, features)) : children;
      }
    }
  }
  return [];
}
```

> Note: `nav-config.ts` importing `feature-modules.ts` which imports `AppView` from `nav-config.ts` is a type-only cycle — fine in TS (the `feature-modules` import of `AppView` is `import type`). Keep `isViewEnabled`/`FeatureModuleId` as a value+type import here; no runtime cycle issue because `feature-modules` only uses `AppView` as a type.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/nav-config.test.ts`
Expected: PASS.

- [ ] **Step 5: Lint + commit**

```bash
npm run lint
git add src/app/nav-config.ts src/app/nav-config.test.ts
git commit -F - <<'EOF'
feat: filterNavGroups + feature-aware subTabsFor

Prune disabled modules (and emptied groups) from the navigation tree.
EOF
```

---

## Task 4: Mode settings section (draft + checkboxes + save/discard)

**Files:**
- Create: `src/app/settings-sections/mode-section.tsx`
- Test: `src/app/settings-sections/mode-section.test.tsx`
- Modify: `src/app/i18n.ts` (EN keys), `src/app/i18n.de.ts` (DE keys, byte-patch)

- [ ] **Step 1: Add i18n keys (EN)** in `src/app/i18n.ts` — add these entries to the EN dictionary object:

```typescript
  settingsSectionMode: "Mode",
  modeSimple: "Simple",
  modeModular: "Modular",
  modeAdvanced: "Advanced",
  modeBadgeLabel: "Current mode",
  modePresetSimple: "Simple",
  modePresetAdvanced: "Advanced",
  modeModulesHeading: "Functions",
  modeIntro: "Simple mode shows only Tasks, Chat and Reports. Turn functions on to build a Modular setup; with all on you are in Advanced mode.",
  modeRetentionNote: "Existing data is kept and reappears when you re-enable a function.",
  modeSave: "Save & reload",
  modeDiscard: "Discard",
```

- [ ] **Step 2: Add i18n keys (DE)** via a Node byte-patch script (CRLF-aware). Create `_patch_de_mode.cjs` at the repo root:

```javascript
// _patch_de_mode.cjs
const fs = require("fs");
const path = "src/app/i18n.de.ts";
let s = fs.readFileSync(path, "utf8");
const nl = s.includes("\r\n") ? "\r\n" : "\n";
const additions = [
  ['settingsSectionMode', 'Modus'],
  ['modeSimple', 'Einfach'],
  ['modeModular', 'Modular'],
  ['modeAdvanced', 'Erweitert'],
  ['modeBadgeLabel', 'Aktueller Modus'],
  ['modePresetSimple', 'Einfach'],
  ['modePresetAdvanced', 'Erweitert'],
  ['modeModulesHeading', 'Funktionen'],
  ['modeIntro', 'Der Einfach-Modus zeigt nur Aufgaben, Chat und Berichte. Schalten Sie Funktionen ein, um einen modularen Aufbau zu erstellen; sind alle aktiv, befinden Sie sich im Erweitert-Modus.'],
  ['modeRetentionNote', 'Vorhandene Daten bleiben erhalten und erscheinen wieder, sobald Sie eine Funktion erneut aktivieren.'],
  ['modeSave', 'Speichern & neu laden'],
  ['modeDiscard', 'Verwerfen'],
];
// Insert before the final closing "};" of the dictionary object.
const marker = nl + "};";
const idx = s.lastIndexOf(marker);
if (idx === -1) throw new Error("dictionary close not found");
const block = additions.map(([k, v]) => `  ${k}: "${v}",`).join(nl);
s = s.slice(0, idx) + nl + block + s.slice(idx);
fs.writeFileSync(path, s);
console.log("patched", additions.length, "DE keys");
```

Run it, then delete it:

```bash
node _patch_de_mode.cjs
node -e "const s=require('fs').readFileSync('src/app/i18n.de.ts','utf8');console.log('curly:',[...s].filter(c=>'“”‘’'.includes(c)).length)"
rm _patch_de_mode.cjs
```

Expected: `patched 12 DE keys` then `curly: 0`. (If the `};` marker doesn't match the file's exact close, open `i18n.de.ts`, find the dictionary's closing line, and adjust `marker`.)

- [ ] **Step 3: Write the failing test**

```tsx
// src/app/settings-sections/mode-section.test.tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ModeSection } from "./mode-section";
import { defaultSettings } from "../settings-types";
import { ALL_MODULE_IDS } from "../feature-modules";

function setup(features = [...ALL_MODULE_IDS]) {
  const onCommit = vi.fn();
  render(
    <ModeSection lang="en-US" settings={{ ...defaultSettings, features }} onCommitFeatures={onCommit} />,
  );
  return { onCommit };
}

describe("ModeSection", () => {
  it("shows Advanced when all modules are on", () => {
    setup([...ALL_MODULE_IDS]);
    expect(screen.getByText("Advanced")).toBeInTheDocument();
  });

  it("the Simple preset clears the draft and the badge reads Simple", () => {
    setup([...ALL_MODULE_IDS]);
    fireEvent.click(screen.getByRole("button", { name: "Simple" }));
    expect(screen.getByText("Modular").closest("*")).toBeTruthy; // badge updated away from Advanced
    expect(screen.getAllByText("Simple").length).toBeGreaterThan(0);
  });

  it("Save is disabled until the draft differs, then commits the draft", () => {
    const { onCommit } = setup([...ALL_MODULE_IDS]);
    const save = screen.getByRole("button", { name: "Save & reload" });
    expect(save).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Simple" })); // draft -> []
    expect(save).toBeEnabled();
    fireEvent.click(save);
    expect(onCommit).toHaveBeenCalledWith([]);
  });

  it("toggling one module off from Advanced yields Modular and commits the remaining set", () => {
    const { onCommit } = setup([...ALL_MODULE_IDS]);
    fireEvent.click(screen.getByRole("checkbox", { name: "RAID" })); // uncheck RAID
    fireEvent.click(screen.getByRole("button", { name: "Save & reload" }));
    const committed = onCommit.mock.calls[0][0] as string[];
    expect(committed).not.toContain("raid");
    expect(committed.length).toBe(ALL_MODULE_IDS.length - 1);
  });

  it("Discard resets the draft to saved (Save disabled again)", () => {
    setup([...ALL_MODULE_IDS]);
    fireEvent.click(screen.getByRole("button", { name: "Simple" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard" }));
    expect(screen.getByRole("button", { name: "Save & reload" })).toBeDisabled();
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run src/app/settings-sections/mode-section.test.tsx`
Expected: FAIL — `Cannot find module './mode-section'`.

- [ ] **Step 5: Implement** `src/app/settings-sections/mode-section.tsx`

```tsx
// src/app/settings-sections/mode-section.tsx
"use client";

import { useMemo, useState } from "react";
import { type Lang, t } from "../i18n";
import type { Settings } from "../settings-types";
import {
  ALL_MODULE_IDS,
  FEATURE_MODULES,
  type FeatureModuleId,
  deriveMode,
} from "../feature-modules";

interface ModeSectionProps {
  lang: Lang;
  settings: Settings;
  onCommitFeatures: (features: FeatureModuleId[]) => void;
}

function sameSet(a: readonly FeatureModuleId[], b: readonly FeatureModuleId[]): boolean {
  if (a.length !== b.length) return false;
  const sa = new Set(a);
  return b.every((x) => sa.has(x));
}

const MODE_LABEL_KEY = {
  simple: "modeSimple",
  modular: "modeModular",
  advanced: "modeAdvanced",
} as const;

export function ModeSection({ lang, settings, onCommitFeatures }: ModeSectionProps) {
  const saved = settings.features;
  const [draft, setDraft] = useState<FeatureModuleId[]>(saved);

  const mode = deriveMode(draft);
  const dirty = !sameSet(draft, saved);
  // Order-stable draft for committing (registry order).
  const orderedDraft = useMemo(
    () => ALL_MODULE_IDS.filter((id) => draft.includes(id)),
    [draft],
  );
  const removesModules = saved.some((id) => !draft.includes(id));

  const toggle = (id: FeatureModuleId) =>
    setDraft((d) => (d.includes(id) ? d.filter((x) => x !== id) : [...d, id]));

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h2 className="text-lg font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey">
          {t(lang, "settingsSectionMode")}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{t(lang, "modeIntro")}</p>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-sm font-medium">{t(lang, "modeBadgeLabel")}:</span>
        <span className="rounded-full bg-AIPM-green/15 px-3 py-1 text-sm font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey">
          {t(lang, MODE_LABEL_KEY[mode])}
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setDraft([])}
          className="rounded-md border border-line px-3 py-1.5 text-sm hover:bg-surface-muted"
        >
          {t(lang, "modePresetSimple")}
        </button>
        <button
          type="button"
          onClick={() => setDraft([...ALL_MODULE_IDS])}
          className="rounded-md border border-line px-3 py-1.5 text-sm hover:bg-surface-muted"
        >
          {t(lang, "modePresetAdvanced")}
        </button>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-semibold text-foreground">
          {t(lang, "modeModulesHeading")}
        </legend>
        {FEATURE_MODULES.map((m) => (
          <label key={m.id} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={draft.includes(m.id)}
              onChange={() => toggle(m.id)}
              className="h-4 w-4 accent-AIPM-green"
            />
            <span>{t(lang, m.labelKey)}</span>
          </label>
        ))}
      </fieldset>

      {removesModules && (
        <p className="rounded-md bg-amber-500/20 px-3 py-2 text-xs text-AIPM-purple">
          {t(lang, "modeRetentionNote")}
        </p>
      )}

      <div className="flex flex-wrap gap-2 border-t border-line pt-4">
        <button
          type="button"
          disabled={!dirty}
          onClick={() => onCommitFeatures(orderedDraft)}
          className="rounded-md bg-AIPM-green px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {t(lang, "modeSave")}
        </button>
        <button
          type="button"
          disabled={!dirty}
          onClick={() => setDraft(saved)}
          className="rounded-md border border-line px-4 py-2 text-sm disabled:opacity-50"
        >
          {t(lang, "modeDiscard")}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run src/app/settings-sections/mode-section.test.tsx`
Expected: PASS.

- [ ] **Step 7: Lint + commit**

```bash
npm run lint
git add src/app/settings-sections/mode-section.tsx src/app/settings-sections/mode-section.test.tsx src/app/i18n.ts src/app/i18n.de.ts
git commit -F - <<'EOF'
feat: Mode settings section (Simple/Modular/Advanced)

Draft-based editor with Simple/Advanced presets, per-module checkboxes, a live
derived mode badge, retention note, and explicit Save (commits via prop) + Discard.
EOF
```

---

## Task 5: Wire the Mode section into SettingsView + commit host + active-view redirect

**Files:**
- Modify: `src/app/settings-view.tsx` (add `mode` rail entry + `onCommitFeatures` prop)
- Modify: `src/app/task-manager.tsx` (pass `onCommitFeatures`; add disabled-view redirect)
- Test: `src/app/settings-view.test.tsx` (extend), `src/app/task-manager.shell.test.tsx` (extend or add a focused test)

- [ ] **Step 1: Write the failing test** (append to `src/app/settings-view.test.tsx`)

```tsx
import { ALL_MODULE_IDS } from "./feature-modules";

it("renders the Mode rail entry and shows the section when selected", () => {
  // Reuse the file's existing render helper if present; otherwise render SettingsView
  // with the same default props used by sibling tests, passing onCommitFeatures={() => {}}.
  // Assert a Mode rail button exists and clicking it reveals the mode badge label.
  // (Adapt to the existing test's render helper.)
});
```

> Implementer note: match the existing `settings-view.test.tsx` render helper/props. The concrete assertions: `screen.getByRole("button", { name: "Mode" })` exists; after clicking it, `screen.getByText("Current mode")` is visible.

- [ ] **Step 2: Run it — expect FAIL** (`Mode` rail button not found).

Run: `npx vitest run src/app/settings-view.test.tsx`

- [ ] **Step 3: Implement `settings-view.tsx`**

- Add import: `import { ModeSection } from "./settings-sections/mode-section";` and `import type { FeatureModuleId } from "./feature-modules";`
- Add `onCommitFeatures: (features: FeatureModuleId[]) => void;` to `SettingsViewProps`.
- Add `"mode"` to the `SectionId` union (first).
- Add `{ id: "mode", labelKey: "settingsSectionMode" }` as the **first** entry of `RAIL`.
- Change the initial active section to `useState<SectionId>("mode")`.
- Add the render branch (with the other branches):

```tsx
        {active === "mode" && (
          <ModeSection lang={lang} settings={settings} onCommitFeatures={props.onCommitFeatures} />
        )}
```

- [ ] **Step 4: Implement the commit host + redirect in `task-manager.tsx`**

- Add imports:

```typescript
import { writeSettings } from "./use-settings";
import { isViewEnabled, isModuleEnabled, type FeatureModuleId } from "./feature-modules";
```

- Define the commit handler (near the other handlers, after `settings` is in scope):

```typescript
  const handleCommitFeatures = useCallback(
    (features: FeatureModuleId[]) => {
      writeSettings({ ...settings, features });
      window.location.reload();
    },
    [settings],
  );
```

- Pass it to the SettingsView element (around line 871):

```tsx
      onCommitFeatures={handleCommitFeatures}
```

- Add the disabled-view redirect effect (immediately after the existing classic-fallback effect at lines 106–113):

```typescript
  // If the active view belongs to a disabled module (e.g. after a Save+reload
  // into Simple mode, or a stale hash), redirect to a still-enabled view.
  useEffect(() => {
    if (isViewEnabled(activeTab, settings.features)) return;
    setActiveTab(isModuleEnabled("dashboard", settings.features) ? "dashboard" : "open-points");
  }, [activeTab, settings.features, setActiveTab]);
```

> `useCallback` is already imported in task-manager (verify; if not, add it to the React import).

- [ ] **Step 5: Add a focused redirect test** in `src/app/task-manager.shell.test.tsx` (or a new `src/app/feature-mode-redirect.test.tsx` if the shell test's harness is heavy). Minimal unit-level alternative — test the redirect rule as a pure decision to avoid mounting the whole shell:

```typescript
// src/app/feature-mode-redirect.test.ts
import { describe, expect, it } from "vitest";
import { isViewEnabled, isModuleEnabled } from "./feature-modules";

function redirectTarget(active: string, features: string[]): string {
  if (isViewEnabled(active as never, features as never)) return active;
  return isModuleEnabled("dashboard" as never, features as never) ? "dashboard" : "open-points";
}

describe("disabled-view redirect rule", () => {
  it("keeps an enabled view", () => {
    expect(redirectTarget("raid", ["raid"])).toBe("raid");
  });
  it("redirects a disabled view to dashboard when dashboard is on", () => {
    expect(redirectTarget("raid", ["dashboard"])).toBe("dashboard");
  });
  it("falls back to open-points when dashboard is also off", () => {
    expect(redirectTarget("raid", [])).toBe("open-points");
  });
});
```

- [ ] **Step 6: Run tests + tsc**

Run: `npx vitest run src/app/settings-view.test.tsx src/app/feature-mode-redirect.test.ts`
Then: `npx tsc --noEmit`
Expected: PASS / no new type errors.

- [ ] **Step 7: Lint + commit**

```bash
npm run lint
git add src/app/settings-view.tsx src/app/task-manager.tsx src/app/settings-view.test.tsx src/app/feature-mode-redirect.test.ts
git commit -F - <<'EOF'
feat: wire Mode section into Settings + save-reload commit + disabled-view redirect

Explicit Save writes settings to localStorage and reloads; a disabled active
view (after reload or stale hash) redirects to Dashboard or Tasks.
EOF
```

---

## Task 6: Gate navigation (modern sidebar + classic tab strip)

**Files:**
- Modify: `src/app/sidebar-nav.tsx` (accept optional `navGroups` prop)
- Modify: `src/app/sidebar.tsx` (thread `navGroups`)
- Modify: `src/app/modern-shell.tsx` (pass `filterNavGroups(features)`) and its caller in `task-manager.tsx` (pass `features`)
- Modify: `src/app/workspace-section.tsx` (gate classic top tabs + sub-tabs)
- Test: `src/app/sidebar-nav.test.tsx` (extend)

- [ ] **Step 1: Write the failing test** (append to `src/app/sidebar-nav.test.tsx`)

```tsx
import { filterNavGroups } from "./nav-config";

it("renders only the provided (filtered) groups", () => {
  render(
    <SidebarNav
      lang="en-US"
      activeView="open-points"
      onNavigate={() => {}}
      navGroups={filterNavGroups([])}
    />,
  );
  // Core survives:
  expect(screen.getByRole("button", { name: /Chat/i })).toBeInTheDocument();
  // RAID is gated off in Simple mode:
  expect(screen.queryByRole("button", { name: /^RAID$/i })).toBeNull();
});
```

- [ ] **Step 2: Run it — expect FAIL** (no `navGroups` prop).

Run: `npx vitest run src/app/sidebar-nav.test.tsx`

- [ ] **Step 3: Implement**

In `src/app/sidebar-nav.tsx`:
- Add to props: `navGroups?: NavGroup[];` and import `NAV_GROUPS, type NavGroup` (NAV_GROUPS already imported — add `type NavGroup`).
- Replace `NAV_GROUPS.map(...)` with `(navGroups ?? NAV_GROUPS).map(...)`. Destructure `navGroups` in the function params.

In `src/app/sidebar.tsx`:
- Add `navGroups?: NavGroup[];` to `SidebarProps` (import `type NavGroup` from `./nav-config`).
- Pass it through: `<SidebarNav ... navGroups={navGroups} />`.

In `src/app/modern-shell.tsx`:
- Add `navGroups?: NavGroup[];` to its props (import `type NavGroup`).
- Pass `navGroups` to `<Sidebar ... navGroups={navGroups} />`.

In `src/app/task-manager.tsx` where `<ModernShell ... />` is rendered:
- Add `navGroups={filterNavGroups(settings.features)}` and import `filterNavGroups` from `./nav-config`.

In `src/app/workspace-section.tsx` (classic top tab strip, lines ~229–313): gate the **non-core** top tabs. Chat / Reports / Activity stay unconditional. Wrap the Gantt, RAID, Resources, and Budget `<TabButton>`s with their module check. Add near the top of the component body:

```typescript
  import { isModuleEnabled } from "./feature-modules";
  // ...inside the component, settings already destructured from useSettings():
  const features = settings.features;
```

Then wrap, e.g.:

```tsx
          {isModuleEnabled("gantt", features) && (
            <TabButton active={activeTab === "gantt"} /* ...unchanged... */>
              {t(lang, "tabGantt")}
            </TabButton>
          )}
```

…and likewise for `raid`, `resources`, `budget`. Update the sub-tab row (line ~357) to pass features:

```tsx
      {!isPopout && !fullBleed && subTabsFor(activeTab, features).length > 0 && (
        // ...
        {subTabsFor(activeTab, features).map((child) => ( /* unchanged */ ))}
      )}
```

> The Dashboard/Trends/Milestones/Changes/Stakeholders views are reached in classic mode via the modern sidebar / sub-tabs / hash; gating them in `filterNavGroups` (Task 3) plus the redirect (Task 5) already prevents reaching a disabled one. No extra top-tab buttons are added for them here (keeps classic parity unchanged).

- [ ] **Step 4: Run tests + tsc**

Run: `npx vitest run src/app/sidebar-nav.test.tsx src/app/sidebar.test.tsx src/app/modern-shell.test.tsx`
Then: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Lint + commit**

```bash
npm run lint
git add src/app/sidebar-nav.tsx src/app/sidebar.tsx src/app/modern-shell.tsx src/app/task-manager.tsx src/app/workspace-section.tsx src/app/sidebar-nav.test.tsx
git commit -F - <<'EOF'
feat: gate navigation by enabled modules (modern sidebar + classic tabs)

SidebarNav consumes a filtered nav-group list; classic top tabs and sub-tabs
hide disabled modules.
EOF
```

---

## Task 7: Pause cross-module automation (RAID-review alerts + snapshot capture)

**Files:**
- Modify: `src/app/use-due-alerts.ts` (gate RAID-review on a new `raidEnabled` flag)
- Modify: `src/app/task-manager.tsx` (pass `raidEnabled`; gate `raidReviewItems` memo + snapshot `trendsActive`)
- Test: `src/app/use-due-alerts.test.ts` (extend)

- [ ] **Step 1: Write the failing test** (append to `src/app/use-due-alerts.test.ts`, mirroring the file's existing setup that builds `UseDueAlertsArgs`)

```typescript
it("does not open the RAID-review modal when the raid module is disabled", () => {
  // Arrange: raid items that WOULD trigger a review, notifications.raidReview.enabled = true,
  // but raidEnabled = false.
  // Act: render the hook (use the file's existing renderHook helper).
  // Assert: result.current.raidReviewModalOpen stays false.
});
```

> Implementer note: copy the closest existing "opens the RAID-review modal" test in this file and flip it by adding `raidEnabled: false` to the args; assert the modal stays closed. Also add the inverse (`raidEnabled: true` keeps current behavior) if not already covered.

- [ ] **Step 2: Run it — expect FAIL** (no `raidEnabled` arg / modal still opens).

Run: `npx vitest run src/app/use-due-alerts.test.ts`

- [ ] **Step 3: Implement `use-due-alerts.ts`**

- Add `raidEnabled: boolean;` to `UseDueAlertsArgs`.
- Destructure `raidEnabled` in the hook signature.
- In the effect, change the review-items guard:

```typescript
    const reviewItems = raidEnabled && notifCfg.raidReview.enabled && !rrSnoozed
      ? getRaidReviewItems(raidRef.current, todayRef.current, notifCfg.raidReviewIntervalDays)
      : [];
```

> Keep `raid` in the effect deps (it already is). `raidEnabled` is read at effect-run time; add it to the dep array too for correctness.

- [ ] **Step 4: Implement `task-manager.tsx`**

- At the `useDueAlerts` call (line ~248), add the flag:

```typescript
    useDueAlerts({ hydrated, tasks, holidaySet, absences, settings, today, showToast, raid, raidEnabled: isModuleEnabled("raid", settings.features) });
```

- Gate the reactive `raidReviewItems` memo (line ~601) so the banner/modal disappear too:

```typescript
  const raidReviewItems = useMemo(
    () => isModuleEnabled("raid", settings.features) && settings.notifications.raidReview.enabled
      ? getRaidReviewItems(raid, today, settings.notifications.raidReviewIntervalDays)
      : [],
    [raid, today, settings.notifications.raidReview, settings.notifications.raidReviewIntervalDays, settings.features],
  );
```

- Gate snapshot capture (line ~207):

```typescript
  const trendsActive =
    settings.storageConfig.kind === "turso" && !isPopout && snapshotsCfg.enabled &&
    isModuleEnabled("trends", settings.features);
```

- [ ] **Step 5: Run tests + tsc**

Run: `npx vitest run src/app/use-due-alerts.test.ts`
Then: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Lint + commit**

```bash
npm run lint
git add src/app/use-due-alerts.ts src/app/task-manager.tsx src/app/use-due-alerts.test.ts
git commit -F - <<'EOF'
feat: pause RAID-review alerts and snapshot capture for disabled modules

RAID-review reminders fire only when the RAID module is on; snapshot capture
requires the Trends module.
EOF
```

---

## Task 8: Gate Dashboard sections by module

**Files:**
- Modify: `src/app/dashboard-panel.tsx` (add `show*` flags; pass empties to `computeDashboard` for disabled modules)
- Modify: `src/app/workspace-section.tsx` (pass the flags)
- Test: `src/app/dashboard-panel.test.tsx` (extend)

- [ ] **Step 1: Write the failing test** (append to `src/app/dashboard-panel.test.tsx`, mirroring its existing render helper)

```tsx
it("hides the Budget RAG when the budget module is disabled", () => {
  // Render DashboardPanel with showBudget={false} and budgets that would otherwise
  // produce a Budget RAG. Assert the budget RAG label (e.g. t("dashboardBudgetRag")
  // or the Budget pill text used by the panel) is not present.
});

it("hides milestone health when the milestones module is disabled", () => {
  // Render with showMilestones={false} + milestones present; assert the milestone
  // section heading is absent.
});
```

> Implementer note: read `dashboard-panel.tsx` fully to identify the exact section headings/labels for Budget RAG, Milestone health, RAID counts, and Changes. Use those exact i18n-rendered strings in the assertions.

- [ ] **Step 2: Run it — expect FAIL** (no `showBudget` prop; section still renders).

Run: `npx vitest run src/app/dashboard-panel.test.tsx`

- [ ] **Step 3: Implement `dashboard-panel.tsx`**

- Add to `DashboardPanelProps` (all optional, default `true`):

```typescript
  showRaid?: boolean;
  showBudget?: boolean;
  showMilestones?: boolean;
  showChanges?: boolean;
```

- Destructure with defaults in the component:

```typescript
  const { showRaid = true, showBudget = true, showMilestones = true, showChanges = true } = props;
```

- Feed `computeDashboard` empties for disabled modules so derived RAG/EVM don't compute:

```typescript
        raid: showRaid ? props.raid : [],
        budgets: showBudget ? props.budgets : [],
        milestones: showMilestones ? (props.milestones ?? []) : [],
        changes: showChanges ? (props.changes ?? []) : [],
```

(adjust the existing `computeDashboard({...})` call accordingly; keep `tasks`, `plan`, `roles`, `resources`, `absences`, `status`, `activity`, `today`, `workdayHours`, `holidaySet` unchanged.)

- Wrap the rendered UI blocks for each module in the matching flag, e.g. `{showBudget && (<...budget RAG...>)}`, `{showMilestones && (<...milestone health...>)}`, and the RAID/Changes contributions inside `RegistersBand` — pass `showRaid`/`showChanges` to `RegistersBand` (add the props there and guard the RAID and Changes columns/rows) OR conditionally omit the relevant data. The TDD assertions from Step 1 confirm the blocks are gone.

- [ ] **Step 4: Implement `workspace-section.tsx`** — pass the flags at the `<DashboardPanel>` call (line ~673):

```tsx
              showRaid={isModuleEnabled("raid", settings.features)}
              showBudget={isModuleEnabled("budget", settings.features)}
              showMilestones={isModuleEnabled("milestones", settings.features)}
              showChanges={isModuleEnabled("changes", settings.features)}
```

(`isModuleEnabled` import added in Task 6.)

- [ ] **Step 5: Run tests + tsc**

Run: `npx vitest run src/app/dashboard-panel.test.tsx`
Then: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Lint + commit**

```bash
npm run lint
git add src/app/dashboard-panel.tsx src/app/workspace-section.tsx src/app/dashboard-panel.test.tsx
git commit -F - <<'EOF'
feat: hide disabled modules' Dashboard sections (budget/milestones/RAID/changes)
EOF
```

---

## Task 9: Gate Gantt milestone overlay, Change→RAID links, and the Reports picker

**Files:**
- Modify: `src/app/workspace-section.tsx` (gantt milestones; change-panel raid)
- Modify: `src/app/change-panel.tsx` (accept `raidEnabled`, hide RAID-link control)
- Modify: `src/app/reports.tsx` (filter picker + rendered extras via `visibleReports`)
- Test: `src/app/reports.test.tsx` (extend), `src/app/change-panel.test.tsx` (extend)

- [ ] **Step 1: Write the failing tests**

Reports (append to `src/app/reports.test.tsx`, mirroring its render helper):

```tsx
import { ALL_MODULE_IDS } from "./feature-modules";

it("omits a stored extra report whose module is disabled", () => {
  // Render ReportsPanel with tasks present, extraReports={["stakeholder-report"]},
  // and features that DO NOT include "stakeholders". Assert the stakeholder report
  // heading (t("stakeholderReportTitle")) is not rendered.
});
```

Change-panel (append to `src/app/change-panel.test.tsx`):

```tsx
it("hides the RAID link control when raidEnabled is false", () => {
  // Render ChangePanel with raidEnabled={false}; assert the RAID-link picker/control
  // (its aria-label) is absent. With raidEnabled (default), it is present.
});
```

> Implementer note: `ReportsPanel` needs a new optional `features` prop to drive `visibleReports`. `ChangePanel` needs a new optional `raidEnabled` prop (default `true`). Use the exact existing labels for assertions after reading each file.

- [ ] **Step 2: Run them — expect FAIL.**

Run: `npx vitest run src/app/reports.test.tsx src/app/change-panel.test.tsx`

- [ ] **Step 3: Implement `reports.tsx`**

- Add to the props type: `features?: FeatureModuleId[];` (import `type FeatureModuleId` and `visibleReports` from `./feature-modules`). Default it: `features = [...ALL_MODULE_IDS]` (import `ALL_MODULE_IDS`) so existing callers/tests are unaffected.
- Compute the visible set and use it for BOTH the picker and the rendered extras:

```typescript
  const visibleExtra = visibleReports(extraReports, features);
  const availableToAdd = ADDABLE_REPORTS.filter(
    (r) => !extraReports.includes(r.id) && visibleReports([r.id], features).length > 0,
  );
```

- Use `availableToAdd` in place of `remainingReports` for the add `<select>` options.
- Use `visibleExtra` in place of `extraReports` for the rendered `.map(...)` at the bottom (the block starting `{extraReports.map((id) => {`). Keep remove controls operating on the full `extraReports` (so the user can still remove a hidden one if desired) — but since hidden ones won't show a card, simplest is to map `visibleExtra` for the cards and leave the remove `<select>` listing `extraReports`. Stored `extraReports` stays untouched.

- [ ] **Step 4: Implement `change-panel.tsx`**

- Add `raidEnabled?: boolean;` to its props (default `true`); destructure `raidEnabled = true`.
- Wrap the RAID-link control (the input/select that links a change to RAID items — locate by its `aria-label`/label) in `{raidEnabled && (...)}`. If RAID data is also threaded only for display, leave existing retained links visible read-only; only the *editor control* for adding/changing the RAID link is hidden.

- [ ] **Step 5: Implement `workspace-section.tsx` wiring**

- Reports call (line ~404): add `features={settings.features}`.
- Gantt call (line ~433): gate milestones + add-milestone:

```tsx
              milestones={isModuleEnabled("milestones", settings.features) ? milestones : []}
              onAddMilestone={isModuleEnabled("milestones", settings.features)
                ? () => { setActiveTab("milestones"); setMilestoneCreateNonce((n) => n + 1); }
                : undefined}
              onEditMilestone={isModuleEnabled("milestones", settings.features)
                ? () => setActiveTab("milestones")
                : undefined}
```

- ChangePanel call (line ~571): add `raidEnabled={isModuleEnabled("raid", settings.features)}` and pass `raid={isModuleEnabled("raid", settings.features) ? raid : []}` (so the picker has no stale options even if shown).

- [ ] **Step 6: Run tests + tsc**

Run: `npx vitest run src/app/reports.test.tsx src/app/change-panel.test.tsx`
Then: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 7: Lint + commit**

```bash
npm run lint
git add src/app/reports.tsx src/app/change-panel.tsx src/app/workspace-section.tsx src/app/reports.test.tsx src/app/change-panel.test.tsx
git commit -F - <<'EOF'
feat: gate Gantt milestones, Change->RAID links, and the Reports picker

Disabled modules' reports drop from the picker/cards (stored choice retained);
the Gantt milestone overlay and the Change RAID-link control hide when their
modules are off.
EOF
```

---

## Task 10: Release v0.54.0 "Herbert"

**Files:**
- Modify: `src/app/version.ts`, `package.json`, `CHANGELOG.md`, `docs/CODEMAPS/frontend.md`
- Modify: `src/app/i18n.ts` + `src/app/i18n.de.ts` (`versionHighlightModes`)

- [ ] **Step 1: Add the highlight i18n key (EN)** in `i18n.ts`:

```typescript
  versionHighlightModes: "Simple / Modular / Advanced mode: pare the app to Tasks, Chat & Reports and re-enable functions as needed.",
```

- [ ] **Step 2: Add the DE highlight** via a byte-patch script (same pattern as Task 4, Step 2), single entry:

```javascript
  ['versionHighlightModes', 'Einfach- / Modular- / Erweitert-Modus: App auf Aufgaben, Chat und Berichte reduzieren und Funktionen nach Bedarf wieder aktivieren.'],
```

Verify `curly: 0` afterward.

- [ ] **Step 3: Bump `version.ts`** — set `APP_VERSION = "0.54.0"`, `APP_MILESTONE = "Herbert"`, prepend a release-narrative comment line, and append `"versionHighlightModes"` to `APP_HIGHLIGHT_KEYS`.

- [ ] **Step 4: Bump `package.json`** `"version": "0.54.0"`.

- [ ] **Step 5: Add a `CHANGELOG.md` entry** for `0.54.0 "Herbert"` summarizing the mode system.

- [ ] **Step 6: Update `docs/CODEMAPS/frontend.md`** — add `feature-modules.ts` and `settings-sections/mode-section.tsx`, and note the `Settings.features` gating.

- [ ] **Step 7: Full verification**

```bash
npm run lint
npx tsc --noEmit
npm run test:run
```

Expected: lint clean; no new tsc errors; all tests green.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -F - <<'EOF'
chore: release 0.54.0 "Herbert" — Simple/Modular/Advanced mode
EOF
```

---

## Self-review (author checklist — completed)

**Spec coverage:**
- Model & registry → Task 1. ✅
- `Settings.features` + legacy migration + save helper → Task 2. ✅
- Mode settings section (draft, presets, checkboxes, badge, retention note, Save→reload, Discard) → Task 4 + host Task 5. ✅
- Nav filtering + active-view redirect → Tasks 3, 5, 6. ✅
- Chain rules: alerts → Task 7; dashboard → Task 8; snapshots → Task 7; gantt/changes/reports → Task 9; stakeholders↔milestones needs no special code (covered by producer/consumer rules) → noted. ✅
- Reports linkage (filter picker + retain stored) → Task 9. ✅
- Release → Task 10. ✅

**Type consistency:** `FeatureModuleId`, `deriveMode`, `isViewEnabled`, `isModuleEnabled`, `enabledNavViews`, `visibleReports`, `filterNavGroups`, `subTabsFor(view, features?)`, `writeSettings`, `SETTINGS_KEY`, `onCommitFeatures`, `ModeSection`, `show{Raid,Budget,Milestones,Changes}`, `raidEnabled`, `navGroups` — all defined once and used consistently across tasks.

**Placeholders:** Two tasks (5 settings-view test, 8 dashboard test, 9 panel tests) defer exact assertion strings to "read the file and use the rendered label" because the precise headings live in files not fully reproduced here; each gives the concrete prop/behavior and the assertion target. All code steps include full code.

**Ordering:** Foundational pure modules (1–3) precede UI (4–6) precede automation/derived gating (7–9) precede release (10). Each task is independently testable and commits green.
