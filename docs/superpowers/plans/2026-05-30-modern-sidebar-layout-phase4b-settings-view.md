# Phase 4 Workstream B — Full-page Settings View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the modern-layout Settings popover stand-in with a real full-page Settings view (left section rail), sharing all section content with the classic popover via extracted components.

**Architecture:** Extract each popover section into a presentational component under `settings-sections/`; both the classic popover and the new `SettingsView` consume them (single source of truth). `settings` is already an `AppView`, so the seam is a plain `setActiveTab("settings")` + a new `ModernShell.settingsView` slot, with **live auto-save** (no draft state). The modern Settings gear is removed; the sidebar item becomes the sole modern entry point. Classic layout is untouched.

**Tech Stack:** Next.js 16 (App Router), React 18, TypeScript, Tailwind v4 (CSS-var tokens), Vitest + React Testing Library (jsdom).

**Spec:** `docs/superpowers/specs/2026-05-30-modern-sidebar-layout-phase4-settings-view-design.md`

---

## Conventions for this plan

- **Branch:** `phase4b-settings-view` (already created; the spec is committed there).
- **Extraction tasks are mechanical moves.** Where a step says *"move verbatim from `settings-menu.tsx:A–B`"*, copy that exact JSX unchanged into the new component — only the surrounding scaffold (imports, props, helper relocation) is new and is shown in full here. Do **not** restyle, re-order, or "improve" the moved markup: byte-identical rendered output is the parity guarantee.
- **Palette:** AIPM 9-color tokens only. No gradients, no drop shadows, no off-palette hex. Active rail item uses `bg-AIPM-dark-blue text-white` (matches the sidebar).
- **Never touch or stage** `README.md` or `public/*.png` (pre-existing uncommitted user changes).
- **`i18n.de.ts` hazard:** the Edit tool can corrupt ASCII `"` into curly quotes in this file. Prefer `Write` for it, and after editing grep to confirm the new keys are present with straight quotes (Step shown in Task 9).
- **Run the full suite** with `npx vitest run` and **typecheck** with `npx tsc --noEmit`. A task is only done when both are green.
- After each task: `git add <files>` then `git commit`. Do **not** `git add -A` (would stage README/png). Specs/plans under `docs/superpowers/` need `git add -f`.

---

## File Structure

**Create:**
- `src/app/settings-types.ts` — shared Settings types, defaults, and `sanitizeIntegrations` (moved out of `settings-menu.tsx`).
- `src/app/settings-sections/appearance-section.tsx` — Theme + Layout.
- `src/app/settings-sections/localization-section.tsx` — Language + holiday countries.
- `src/app/settings-sections/general-section.tsx` — Pop-out reuse + Resources workday hours.
- `src/app/settings-sections/notifications-section.tsx` — Notifications (incl. `NotificationRow`).
- `src/app/settings-sections/ai-section.tsx` — AI assistant.
- `src/app/settings-sections/integrations-section.tsx` — M365 + Turso.
- `src/app/settings-sections/localization-section.test.tsx`, `general-section.test.tsx`, `notifications-section.test.tsx`, `ai-section.test.tsx` — direct unit tests for the sections not already `onChange`-covered by the popover tests.
- `src/app/settings-sections-sweep.test.ts` — import-parity guard.
- `src/app/settings-view.tsx` — full-page left-rail view.
- `src/app/settings-view.test.tsx` — view behavior tests.

**Modify:**
- `src/app/settings-menu.tsx` — re-export from `settings-types`; popover body consumes the extracted sections.
- `src/app/modern-shell.tsx` — add `settingsView` slot.
- `src/app/task-manager.tsx` — navigate to `settings`; drop the modern gear + `settingsOpen` state.
- `src/app/i18n.ts` + `src/app/i18n.de.ts` — 8 rail-label keys.
- `src/app/version.ts`, `CHANGELOG.md` — release.

---

## Task 1: Extract shared Settings types into `settings-types.ts`

Breaks the circular dependency (sections need the types; `settings-menu.tsx` needs the section components) and gives the view a type source independent of the popover.

**Files:**
- Create: `src/app/settings-types.ts`
- Modify: `src/app/settings-menu.tsx:1-174` (remove the moved declarations; re-export)
- Test: existing suite (no new test — this is a behavior-preserving move guarded by tsc + all current tests)

- [ ] **Step 1: Create `settings-types.ts` with the moved declarations**

Move these **verbatim** out of `settings-menu.tsx` (currently lines ~19–174): `ChatModel`, `AiConfig`, `defaultAiConfig`, `ChannelConfig`, `NotificationsConfig`, `defaultNotificationsConfig`, `JiraAssigneeMode`, `JiraConfig`, `defaultJiraConfig`, `M365IntegrationsSettings`, `TursoIntegrationsSettings`, `IntegrationsSettings`, `defaultM365Integrations`, `defaultTursoIntegrations`, `defaultIntegrations`, `sanitizeIntegrations`, `Settings`, `defaultSettings`.

```typescript
// src/app/settings-types.ts
import type { Lang } from "./i18n";
import {
  type StorageConfig,
  defaultStorageConfig,
} from "./storage";

export type ChatModel =
  | "claude-sonnet-4-6"
  | "claude-opus-4-7"
  | "claude-haiku-4-5-20251001";

export type AiConfig = {
  apiKey: string;
  model: ChatModel;
  consentAccepted: boolean;
};

export const defaultAiConfig: AiConfig = {
  apiKey: "",
  model: "claude-sonnet-4-6",
  consentAccepted: false,
};

export type ChannelConfig = { enabled: boolean };

export type NotificationsConfig = {
  reminderLeadDays: number;
  banner: ChannelConfig;
  toast: ChannelConfig;
  popup: ChannelConfig;
  birthday: ChannelConfig;
};

export const defaultNotificationsConfig: NotificationsConfig = {
  reminderLeadDays: 7,
  banner: { enabled: true },
  toast: { enabled: true },
  popup: { enabled: true },
  birthday: { enabled: true },
};

export type JiraAssigneeMode = "currentUser" | "any" | "specific";

// JiraConfig, defaultJiraConfig, M365IntegrationsSettings,
// TursoIntegrationsSettings, IntegrationsSettings, defaultM365Integrations,
// defaultTursoIntegrations, defaultIntegrations, sanitizeIntegrations,
// Settings, defaultSettings:
//   MOVE VERBATIM from settings-menu.tsx (current lines ~56–174),
//   keeping their `export`. `Settings` keeps:
//     storageConfig: StorageConfig;  // from ./storage (imported above)
//   and `defaultSettings.storageConfig` stays `defaultStorageConfig`.
```

- [ ] **Step 2: Replace the moved block in `settings-menu.tsx` with re-exports**

At the top of `settings-menu.tsx`, delete the moved declarations and re-export everything so every existing importer (`task-manager`, `jira-settings`, `use-storage-backend`, `app-header`, tests, …) keeps working unchanged:

```typescript
// settings-menu.tsx — replaces the deleted type/const block
export {
  defaultAiConfig,
  defaultNotificationsConfig,
  defaultJiraConfig,
  defaultM365Integrations,
  defaultTursoIntegrations,
  defaultIntegrations,
  sanitizeIntegrations,
  defaultSettings,
} from "./settings-types";
export type {
  ChatModel,
  AiConfig,
  ChannelConfig,
  NotificationsConfig,
  JiraAssigneeMode,
  JiraConfig,
  M365IntegrationsSettings,
  TursoIntegrationsSettings,
  IntegrationsSettings,
  Settings,
} from "./settings-types";
```

Keep the imports `settings-menu.tsx` still needs (e.g. `import { type Settings, defaultIntegrations, defaultM365Integrations, defaultTursoIntegrations } from "./settings-types"` for its own remaining inline use, plus existing `StorageConfig`/`StorageKind`/`defaultStorageConfig` from `./storage`). Remove now-unused imports.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS (0 errors). If an importer pulled a type from `settings-menu` that you forgot to re-export, tsc names it — add it to the re-export.

- [ ] **Step 4: Run the full suite**

Run: `npx vitest run`
Expected: PASS — same count as before this task (no behavior change).

- [ ] **Step 5: Commit**

```bash
git add src/app/settings-types.ts src/app/settings-menu.tsx
git commit -m "refactor: extract Settings types into settings-types.ts (re-exported from settings-menu)"
```

---

## Task 2: Extract `AppearanceSection` (Theme + Layout)

**Files:**
- Create: `src/app/settings-sections/appearance-section.tsx`
- Modify: `src/app/settings-menu.tsx` (consume it; remove the inline Theme+Layout blocks at current lines ~316–351)
- Test: covered transitively by `settings-menu.layout.test.tsx` (Layout) and `settings-menu.test.tsx` "theme control" (Theme) — both must stay green.

- [ ] **Step 1: Create the component**

```tsx
// src/app/settings-sections/appearance-section.tsx
"use client";

import { type Lang, t } from "../i18n";
import { SegmentedControl } from "../segmented-control";
import type { Settings } from "../settings-types";
import type { Theme } from "../theme";
import { useTheme } from "../use-theme";
import { InfoTooltip } from "../info-tooltip";

interface AppearanceSectionProps {
  lang: Lang;
  settings: Settings;
  onChange: (s: Settings) => void;
}

export function AppearanceSection({ lang, settings, onChange }: AppearanceSectionProps) {
  const { theme, setTheme } = useTheme();
  return (
    <>
      {/* MOVE VERBATIM from settings-menu.tsx lines ~316–351:
          the Theme <div className="mb-4">…</div> and the
          Layout <div className="mb-4">…</div>. They reference
          `theme`/`setTheme` (from useTheme above), `settings.layout`,
          `onChange`, `t`, `lang`, `SegmentedControl`, `Theme`, `InfoTooltip`
          — all in scope here. */}
    </>
  );
}
```

- [ ] **Step 2: Consume it in the popover**

In `settings-menu.tsx`, replace the inline Theme + Layout blocks (lines ~316–351) with:

```tsx
<AppearanceSection lang={lang} settings={settings} onChange={onChange} />
```

Add `import { AppearanceSection } from "./settings-sections/appearance-section";`. Remove the now-unused `useTheme`/`Theme`/`SegmentedControl` imports from `settings-menu.tsx` **only if** no other remaining inline block uses them. When in doubt, leave them and let tsc/lint flag the unused ones.

- [ ] **Step 3: Run the affected tests**

Run: `npx vitest run settings-menu`
Expected: PASS — both `settings-menu.test.tsx` (theme) and `settings-menu.layout.test.tsx` (Layout radio "Classic" → onChange) still pass against the extracted component.

- [ ] **Step 4: Typecheck + full suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/settings-sections/appearance-section.tsx src/app/settings-menu.tsx
git commit -m "refactor: extract AppearanceSection (theme + layout) shared by popover"
```

---

## Task 3: Extract `LocalizationSection` (Language + Holidays)

**Files:**
- Create: `src/app/settings-sections/localization-section.tsx`
- Create: `src/app/settings-sections/localization-section.test.tsx`
- Modify: `src/app/settings-menu.tsx` (consume; remove inline Language + Holidays at lines ~353–436; relocate `pending` state + `countryName`/`available`/`addCountry`/`removeCountry` helpers into the component)

- [ ] **Step 1: Write the failing test**

```tsx
// src/app/settings-sections/localization-section.test.tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LocalizationSection } from "./localization-section";
import { defaultSettings } from "../settings-types";

describe("LocalizationSection", () => {
  it("changing the language select calls onChange with the new language", () => {
    const onChange = vi.fn();
    render(<LocalizationSection lang="en-US" settings={defaultSettings} onChange={onChange} />);
    fireEvent.change(screen.getByDisplayValue("English (US)"), {
      target: { value: "de" },
    });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ language: "de" }));
  });

  it("adding a holiday country appends it to holidayCountries", () => {
    const onChange = vi.fn();
    render(<LocalizationSection lang="en-US" settings={defaultSettings} onChange={onChange} />);
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    const firstReal = select.options[1];
    fireEvent.change(select, { target: { value: firstReal.value } });
    fireEvent.click(screen.getByRole("button", { name: /add/i }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ holidayCountries: [firstReal.value] }),
    );
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run settings-sections/localization-section`
Expected: FAIL — `Cannot find module './localization-section'`.

- [ ] **Step 3: Create the component**

```tsx
// src/app/settings-sections/localization-section.tsx
"use client";

import { useState } from "react";
import { COUNTRIES } from "../holidays";
import { type Lang, t } from "../i18n";
import type { Settings } from "../settings-types";
import { InfoTooltip } from "../info-tooltip";

interface LocalizationSectionProps {
  lang: Lang;
  settings: Settings;
  onChange: (s: Settings) => void;
}

export function LocalizationSection({ lang, settings, onChange }: LocalizationSectionProps) {
  const [pending, setPending] = useState("");

  const countryName = (code: string) => {
    const c = COUNTRIES.find((c) => c.code === code);
    if (!c) return code;
    return lang === "de" ? c.nameDe : c.nameEn;
  };
  const available = COUNTRIES.filter(
    (c) => !settings.holidayCountries.includes(c.code),
  );
  function addCountry() {
    if (!pending || settings.holidayCountries.includes(pending)) return;
    onChange({ ...settings, holidayCountries: [...settings.holidayCountries, pending] });
    setPending("");
  }
  function removeCountry(code: string) {
    onChange({
      ...settings,
      holidayCountries: settings.holidayCountries.filter((c) => c !== code),
    });
  }

  return (
    <>
      {/* MOVE VERBATIM from settings-menu.tsx lines ~353–436:
          the Language <label className="mb-4 block">…</label> and the
          Holiday-countries <div>…</div>. They reference `settings`,
          `onChange`, `pending`/`setPending`, `available`, `addCountry`,
          `removeCountry`, `countryName`, `t`, `lang`, `InfoTooltip`
          — all in scope here. */}
    </>
  );
}
```

- [ ] **Step 4: Consume it in the popover**

In `settings-menu.tsx`, replace the inline Language + Holidays blocks (lines ~353–436) with:

```tsx
<LocalizationSection lang={lang} settings={settings} onChange={onChange} />
```

Add the import. Delete the now-orphaned `pending`/`setPending` state and the `countryName`/`available`/`addCountry`/`removeCountry` definitions from `settings-menu.tsx`. Remove the `COUNTRIES` import from `settings-menu.tsx` if nothing else uses it.

- [ ] **Step 5: Run tests (new + popover) and typecheck**

Run: `npx vitest run settings-sections/localization-section settings-menu && npx tsc --noEmit`
Expected: PASS (new section tests green; popover tests unaffected).

- [ ] **Step 6: Full suite + commit**

Run: `npx vitest run`
Expected: PASS.

```bash
git add src/app/settings-sections/localization-section.tsx src/app/settings-sections/localization-section.test.tsx src/app/settings-menu.tsx
git commit -m "refactor: extract LocalizationSection (language + holidays) shared by popover"
```

---

## Task 4: Extract `GeneralSection` (Pop-out + Resources)

**Files:**
- Create: `src/app/settings-sections/general-section.tsx`
- Create: `src/app/settings-sections/general-section.test.tsx`
- Modify: `src/app/settings-menu.tsx` (consume; remove inline Pop-out at ~503–523 and Resources at ~527–543, plus the surrounding `<hr>`s as appropriate)

- [ ] **Step 1: Write the failing test**

```tsx
// src/app/settings-sections/general-section.test.tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GeneralSection } from "./general-section";
import { defaultSettings } from "../settings-types";
import { t } from "../i18n";

describe("GeneralSection", () => {
  it("toggling reuse-window persists popout.reuseWindow", () => {
    const onChange = vi.fn();
    render(<GeneralSection lang="en-US" settings={defaultSettings} onChange={onChange} />);
    fireEvent.click(screen.getByRole("checkbox", { name: t("en-US", "popoutReuseWindow") }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ popout: { reuseWindow: true } }),
    );
  });

  it("editing workday hours persists resources.workdayHours", () => {
    const onChange = vi.fn();
    render(<GeneralSection lang="en-US" settings={defaultSettings} onChange={onChange} />);
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "10" } });
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ resources: { workdayHours: 10 } }),
    );
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run settings-sections/general-section`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the component**

```tsx
// src/app/settings-sections/general-section.tsx
"use client";

import { type Lang, t } from "../i18n";
import type { Settings } from "../settings-types";
import { InfoTooltip } from "../info-tooltip";

interface GeneralSectionProps {
  lang: Lang;
  settings: Settings;
  onChange: (s: Settings) => void;
}

export function GeneralSection({ lang, settings, onChange }: GeneralSectionProps) {
  return (
    <>
      {/* MOVE VERBATIM from settings-menu.tsx:
          - Pop-out block lines ~503–523 (the reuseWindow checkbox <div className="mb-4">)
          - Resources block lines ~527–543 (the workdayHours <div className="mb-4">)
          Put a <hr className="my-4 border-line" /> between them to match the
          popover's current divider. They reference `settings`, `onChange`,
          `t`, `lang`, `InfoTooltip` — all in scope. */}
    </>
  );
}
```

- [ ] **Step 4: Consume it in the popover**

In `settings-menu.tsx`, replace the inline Pop-out + Resources blocks (and the `<hr>` that sat between them) with:

```tsx
<GeneralSection lang={lang} settings={settings} onChange={onChange} />
```

Keep the outer `<hr>`s that separate this group from Notifications (above) and AI (below) so the popover's divider rhythm is unchanged.

- [ ] **Step 5: Tests + typecheck + full suite**

Run: `npx vitest run settings-sections/general-section settings-menu && npx tsc --noEmit && npx vitest run`
Expected: PASS (the existing popout-toggle test in `settings-menu.test.tsx` still passes — it finds the checkbox rendered via `GeneralSection`).

- [ ] **Step 6: Commit**

```bash
git add src/app/settings-sections/general-section.tsx src/app/settings-sections/general-section.test.tsx src/app/settings-menu.tsx
git commit -m "refactor: extract GeneralSection (popout + resources) shared by popover"
```

---

## Task 5: Extract `NotificationsSection` (+ `NotificationRow`)

**Files:**
- Create: `src/app/settings-sections/notifications-section.tsx`
- Create: `src/app/settings-sections/notifications-section.test.tsx`
- Modify: `src/app/settings-menu.tsx` (consume; remove inline Notifications at ~440–499 and the `NotificationRow` helper at ~837–863)

- [ ] **Step 1: Write the failing test**

```tsx
// src/app/settings-sections/notifications-section.test.tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NotificationsSection } from "./notifications-section";
import { defaultSettings } from "../settings-types";
import { t } from "../i18n";

describe("NotificationsSection", () => {
  it("toggling the toast channel persists notifications.toast.enabled", () => {
    const onChange = vi.fn();
    render(<NotificationsSection lang="en-US" settings={defaultSettings} onChange={onChange} />);
    fireEvent.click(screen.getByRole("checkbox", { name: t("en-US", "notifToast") }));
    const last = onChange.mock.calls.at(-1)?.[0];
    expect(last.notifications.toast.enabled).toBe(false);
  });

  it("editing reminder lead days persists the value", () => {
    const onChange = vi.fn();
    render(<NotificationsSection lang="en-US" settings={defaultSettings} onChange={onChange} />);
    fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "14" } });
    const last = onChange.mock.calls.at(-1)?.[0];
    expect(last.notifications.reminderLeadDays).toBe(14);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run settings-sections/notifications-section`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the component (carry `NotificationRow`)**

```tsx
// src/app/settings-sections/notifications-section.tsx
"use client";

import { type Lang, type TranslationKey, t } from "../i18n";
import type { ChannelConfig, Settings } from "../settings-types";
import { InfoTooltip } from "../info-tooltip";

interface NotificationsSectionProps {
  lang: Lang;
  settings: Settings;
  onChange: (s: Settings) => void;
}

export function NotificationsSection({ lang, settings, onChange }: NotificationsSectionProps) {
  return (
    <div className="mb-4">
      {/* MOVE VERBATIM the *inner* contents of settings-menu.tsx's
          Notifications <div className="mb-4">…</div> (lines ~440–499):
          the label, hint, reminderLeadDays input, the three <NotificationRow>
          uses, and the birthday checkbox. They reference `settings`,
          `onChange`, `t`, `lang`, `InfoTooltip`, `NotificationRow`. */}
    </div>
  );
}

// MOVE VERBATIM the body from settings-menu.tsx lines ~837–863:
function NotificationRow({
  labelKey,
  lang,
  config,
  onChange,
}: {
  labelKey: TranslationKey;
  lang: Lang;
  config: ChannelConfig;
  onChange: (c: ChannelConfig) => void;
}) {
  /* … existing JSX body, unchanged … */
  return null as never; // replace this line with the verbatim moved return
}
```

- [ ] **Step 4: Consume it in the popover**

In `settings-menu.tsx`, replace the inline Notifications `<div className="mb-4">…</div>` (lines ~440–499) with:

```tsx
<NotificationsSection lang={lang} settings={settings} onChange={onChange} />
```

Delete the `NotificationRow` function from `settings-menu.tsx` (it now lives in the section). Remove the `TranslationKey` import from `settings-menu.tsx` if nothing else there uses it. Keep the surrounding `<hr>`s.

- [ ] **Step 5: Tests + typecheck + full suite**

Run: `npx vitest run settings-sections/notifications-section settings-menu && npx tsc --noEmit && npx vitest run`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/settings-sections/notifications-section.tsx src/app/settings-sections/notifications-section.test.tsx src/app/settings-menu.tsx
git commit -m "refactor: extract NotificationsSection (incl. NotificationRow) shared by popover"
```

---

## Task 6: Extract `AiSection`

**Files:**
- Create: `src/app/settings-sections/ai-section.tsx`
- Create: `src/app/settings-sections/ai-section.test.tsx`
- Modify: `src/app/settings-menu.tsx` (consume; remove inline AI block at ~547–620)

- [ ] **Step 1: Write the failing test**

```tsx
// src/app/settings-sections/ai-section.test.tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AiSection } from "./ai-section";
import { defaultSettings } from "../settings-types";
import { t } from "../i18n";

describe("AiSection", () => {
  it("typing an API key persists ai.apiKey", () => {
    const onChange = vi.fn();
    render(<AiSection lang="en-US" settings={defaultSettings} onChange={onChange} />);
    fireEvent.change(screen.getByPlaceholderText(t("en-US", "aiApiKeyPlaceholder")), {
      target: { value: "sk-test" },
    });
    const last = onChange.mock.calls.at(-1)?.[0];
    expect(last.ai.apiKey).toBe("sk-test");
  });

  it("shows the consent-required notice when consent not yet accepted", () => {
    render(<AiSection lang="en-US" settings={defaultSettings} onChange={vi.fn()} />);
    expect(screen.getByText(t("en-US", "aiConsentRequired"))).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run settings-sections/ai-section`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the component**

```tsx
// src/app/settings-sections/ai-section.tsx
"use client";

import { type Lang, t } from "../i18n";
import type { ChatModel, Settings } from "../settings-types";
import { InfoTooltip } from "../info-tooltip";

interface AiSectionProps {
  lang: Lang;
  settings: Settings;
  onChange: (s: Settings) => void;
}

export function AiSection({ lang, settings, onChange }: AiSectionProps) {
  return (
    <div className="mb-4">
      {/* MOVE VERBATIM the *inner* contents of settings-menu.tsx's AI
          <div className="mb-4">…</div> (lines ~547–620): the label, API-key
          input, model <select> (cast `e.target.value as ChatModel`), hint,
          and the consent granted/required block. References `settings`,
          `onChange`, `t`, `lang`, `InfoTooltip`, `ChatModel`. */}
    </div>
  );
}
```

- [ ] **Step 4: Consume it in the popover**

In `settings-menu.tsx`, replace the inline AI `<div className="mb-4">…</div>` (lines ~547–620) with:

```tsx
<AiSection lang={lang} settings={settings} onChange={onChange} />
```

Keep surrounding `<hr>`s.

- [ ] **Step 5: Tests + typecheck + full suite**

Run: `npx vitest run settings-sections/ai-section settings-menu && npx tsc --noEmit && npx vitest run`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/settings-sections/ai-section.tsx src/app/settings-sections/ai-section.test.tsx src/app/settings-menu.tsx
git commit -m "refactor: extract AiSection shared by popover"
```

---

## Task 7: Extract `IntegrationsSection` (M365 + Turso)

**Files:**
- Create: `src/app/settings-sections/integrations-section.tsx`
- Modify: `src/app/settings-menu.tsx` (consume; remove inline Integrations card at ~651–830 and the `updateM365`/`updateTurso` helpers + `auth`/env-flag/integrations locals at ~213–237)
- Test: covered transitively by the existing `settings-menu.test.tsx` "Integrations section" block (must stay green).

- [ ] **Step 1: Create the component (carry helpers, auth, env flags)**

```tsx
// src/app/settings-sections/integrations-section.tsx
"use client";

import { type Lang, t } from "../i18n";
import {
  type M365IntegrationsSettings,
  type TursoIntegrationsSettings,
  type Settings,
  defaultIntegrations,
  defaultM365Integrations,
  defaultTursoIntegrations,
} from "../settings-types";
import { useMsAuth } from "../use-ms-auth";
import { InfoTooltip } from "../info-tooltip";

interface IntegrationsSectionProps {
  lang: Lang;
  settings: Settings;
  onChange: (s: Settings) => void;
}

export function IntegrationsSection({ lang, settings, onChange }: IntegrationsSectionProps) {
  const integrations = settings.integrations ?? defaultIntegrations;
  const m365 = integrations.m365 ?? defaultM365Integrations;
  const turso = integrations.turso ?? defaultTursoIntegrations;
  const auth = useMsAuth(m365.enabled);
  const envClientIdSet = !!process.env.NEXT_PUBLIC_MSAL_CLIENT_ID;
  const envTenantIdSet = !!process.env.NEXT_PUBLIC_MSAL_TENANT_ID;
  const envTursoUrlSet = !!process.env.NEXT_PUBLIC_TURSO_DATABASE_URL;
  const envTursoTokenSet = !!process.env.NEXT_PUBLIC_TURSO_AUTH_TOKEN;

  function updateTurso(patch: Partial<TursoIntegrationsSettings>) {
    onChange({ ...settings, integrations: { ...integrations, turso: { ...turso, ...patch } } });
  }
  function updateM365(patch: Partial<M365IntegrationsSettings>) {
    onChange({ ...settings, integrations: { ...integrations, m365: { ...m365, ...patch } } });
  }

  return (
    <div className="rounded-md border border-line bg-surface p-3">
      {/* MOVE VERBATIM the *inner* contents of settings-menu.tsx's Integrations
          card <div className="rounded-md border …">…</div> (lines ~651–830):
          everything from the <div className="mb-2 flex …"> heading through the
          Turso inputs. References `m365`, `turso`, `auth`, the four env flags,
          `updateM365`, `updateTurso`, `t`, `lang`, `InfoTooltip`. */}
    </div>
  );
}
```

- [ ] **Step 2: Consume it in the popover**

In `settings-menu.tsx`, replace the inline Integrations card (lines ~651–830) with:

```tsx
<IntegrationsSection lang={lang} settings={settings} onChange={onChange} />
```

Delete from `settings-menu.tsx`: the `integrations`/`m365`/`turso` locals, `auth = useMsAuth(...)`, the four `env*Set` consts, and `updateM365`/`updateTurso` (all now in the section). Remove the `useMsAuth` import from `settings-menu.tsx` if unused elsewhere there.

- [ ] **Step 3: Run the affected tests**

Run: `npx vitest run settings-menu`
Expected: PASS — the existing "Integrations section" tests (M365 master toggle, Turso toggle + inputs, SharePoint/Outlook sub-toggles, turso.tech link, InfoTooltip affordances) all pass against the extracted component. `settings-menu.test.tsx` already mocks `./use-ms-auth`.

- [ ] **Step 4: Typecheck + full suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/settings-sections/integrations-section.tsx src/app/settings-menu.tsx
git commit -m "refactor: extract IntegrationsSection (M365 + Turso) shared by popover"
```

---

## Task 8: Import-parity guard

Prevents the popover and the view from drifting apart: asserts `settings-menu.tsx` imports every extracted section from `./settings-sections/`.

**Files:**
- Create: `src/app/settings-sections-sweep.test.ts`

- [ ] **Step 1: Write the test**

```ts
// src/app/settings-sections-sweep.test.ts
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Sections that MUST be sourced from ./settings-sections/ by the popover, so
// the classic popover and the modern full-page view never diverge.
const SHARED_SECTIONS = [
  "appearance-section",
  "localization-section",
  "general-section",
  "notifications-section",
  "ai-section",
  "integrations-section",
];

describe("settings sections — single source of truth", () => {
  it("resolves the source directory from the vitest root", () => {
    expect(existsSync(join(process.cwd(), "src/app"))).toBe(true);
  });

  const menuSrc = readFileSync(join(process.cwd(), "src/app/settings-menu.tsx"), "utf8");

  for (const name of SHARED_SECTIONS) {
    it(`settings-menu.tsx imports ${name} from ./settings-sections/`, () => {
      expect(menuSrc).toContain(`./settings-sections/${name}`);
    });
    it(`${name}.tsx exists`, () => {
      expect(existsSync(join(process.cwd(), "src/app/settings-sections", `${name}.tsx`))).toBe(true);
    });
  }
});
```

- [ ] **Step 2: Run it**

Run: `npx vitest run settings-sections-sweep`
Expected: PASS (Tasks 2–7 already wired all six imports).

- [ ] **Step 3: Commit**

```bash
git add src/app/settings-sections-sweep.test.ts
git commit -m "test: guard that the settings popover sources all sections from settings-sections/"
```

---

## Task 9: i18n — 8 rail-label keys

**Files:**
- Modify: `src/app/i18n.ts` (add keys to the `enUS` object, before `} as const` at line ~1059)
- Modify: `src/app/i18n.de.ts` (add the same keys to the `de` dictionary — **required**, else `Record<TranslationKey,string>` fails tsc)
- Test: `src/app/i18n.test.ts` (existing) stays green; optionally add a presence check.

- [ ] **Step 1: Add the keys to `enUS` in `i18n.ts`**

Insert just before the closing `} as const;` of the `enUS` object:

```typescript
  settingsSectionAppearance: "Appearance",
  settingsSectionLocalization: "Language & Holidays",
  settingsSectionGeneral: "General",
  settingsSectionNotifications: "Notifications",
  settingsSectionAi: "AI Assistant",
  settingsSectionJira: "Jira",
  settingsSectionStorage: "Storage",
  settingsSectionIntegrations: "Integrations",
```

- [ ] **Step 2: Add the same keys to `de` in `i18n.de.ts`**

Insert into the `de` object (group them near `settings:`). **Use straight ASCII quotes**:

```typescript
  settingsSectionAppearance: "Darstellung",
  settingsSectionLocalization: "Sprache & Feiertage",
  settingsSectionGeneral: "Allgemein",
  settingsSectionNotifications: "Benachrichtigungen",
  settingsSectionAi: "KI-Assistent",
  settingsSectionJira: "Jira",
  settingsSectionStorage: "Speicher",
  settingsSectionIntegrations: "Integrationen",
```

- [ ] **Step 3: Verify no curly-quote corruption crept into `i18n.de.ts`**

Run: `npx tsc --noEmit`
Expected: PASS. Then confirm the new German keys use straight quotes:

Run (PowerShell): `Select-String -Path src/app/i18n.de.ts -Pattern 'settingsSection' | Select-String -Pattern '[“”]'`
Expected: **no output** (no curly quotes on those lines). If any appear, fix them with `Write` (not Edit).

- [ ] **Step 4: Optional presence test**

If `i18n.test.ts` lacks a full key-parity test, add:

```typescript
it("exposes the 8 settings section labels in en-US", () => {
  for (const k of [
    "settingsSectionAppearance","settingsSectionLocalization","settingsSectionGeneral",
    "settingsSectionNotifications","settingsSectionAi","settingsSectionJira",
    "settingsSectionStorage","settingsSectionIntegrations",
  ] as const) {
    expect(t("en-US", k)).toBeTruthy();
  }
});
```

- [ ] **Step 5: Run + commit**

Run: `npx vitest run i18n && npx tsc --noEmit`
Expected: PASS.

```bash
git add src/app/i18n.ts src/app/i18n.de.ts src/app/i18n.test.ts
git commit -m "i18n: add 8 settings-section rail labels (en + de)"
```

---

## Task 10: `SettingsView` (left rail + panel)

**Files:**
- Create: `src/app/settings-view.tsx`
- Create: `src/app/settings-view.test.tsx`

The view forwards the same storage/auth-bearing props the popover receives, so the Storage and Jira rail entries reuse the existing standalone `StorageConfigSection` / `JiraSettingsSection` directly.

- [ ] **Step 1: Write the failing test**

```tsx
// src/app/settings-view.test.tsx
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SettingsView } from "./settings-view";
import { defaultSettings } from "./settings-types";
import { t } from "./i18n";

vi.mock("./jira-settings", () => ({ JiraSettingsSection: () => <div>jira-stub</div> }));
vi.mock("./storage-config", () => ({ StorageConfigSection: () => <div>storage-stub</div> }));
vi.mock("./use-ms-auth", () => ({
  useMsAuth: () => ({ account: null, ready: true, signIn: vi.fn(), signOut: vi.fn(), acquireToken: async () => null }),
}));
const setTheme = vi.hoisted(() => vi.fn());
vi.mock("./use-theme", () => ({
  useTheme: () => ({ theme: "system" as const, setTheme }),
  ThemeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

function makeProps(overrides = {}) {
  return {
    lang: "en-US" as const,
    settings: defaultSettings,
    onChange: vi.fn(),
    storageDescription: null,
    storageReady: false,
    onPickStorageFile: vi.fn().mockResolvedValue(undefined),
    onOpenStorageFile: vi.fn().mockResolvedValue(undefined),
    onGrantStorageWrite: vi.fn().mockResolvedValue(undefined),
    onRequestStorageSwitch: vi.fn(),
    ...overrides,
  };
}

describe("SettingsView", () => {
  it("defaults to the Appearance section", () => {
    render(<SettingsView {...makeProps()} />);
    expect(screen.getByRole("radio", { name: t("en-US", "themeSystem") })).toBeInTheDocument();
  });

  it("clicking a rail entry switches the visible section", () => {
    render(<SettingsView {...makeProps()} />);
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "settingsSectionStorage") }));
    expect(screen.getByText("storage-stub")).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: t("en-US", "themeSystem") })).not.toBeInTheDocument();
  });

  it("auto-saves: a control change propagates through onChange", () => {
    const onChange = vi.fn();
    render(<SettingsView {...makeProps({ onChange })} />);
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "settingsSectionGeneral") }));
    fireEvent.click(screen.getByRole("checkbox", { name: t("en-US", "popoutReuseWindow") }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ popout: { reuseWindow: true } }));
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run settings-view`
Expected: FAIL — `Cannot find module './settings-view'`.

- [ ] **Step 3: Implement the view**

```tsx
// src/app/settings-view.tsx
"use client";

import { useState } from "react";
import { type Lang, type TranslationKey, t } from "./i18n";
import type { Settings } from "./settings-types";
import type { StorageKind } from "./storage";
import { AppearanceSection } from "./settings-sections/appearance-section";
import { LocalizationSection } from "./settings-sections/localization-section";
import { GeneralSection } from "./settings-sections/general-section";
import { NotificationsSection } from "./settings-sections/notifications-section";
import { AiSection } from "./settings-sections/ai-section";
import { IntegrationsSection } from "./settings-sections/integrations-section";
import { JiraSettingsSection } from "./jira-settings";
import { StorageConfigSection } from "./storage-config";

interface SettingsViewProps {
  lang: Lang;
  settings: Settings;
  onChange: (s: Settings) => void;
  storageDescription: string | null;
  storageReady: boolean;
  onPickStorageFile: () => Promise<void>;
  onOpenStorageFile: () => Promise<void>;
  onGrantStorageWrite: () => Promise<void>;
  onRequestStorageSwitch: (kind: StorageKind) => void;
}

type SectionId =
  | "appearance" | "localization" | "general" | "notifications"
  | "ai" | "jira" | "storage" | "integrations";

const RAIL: { id: SectionId; labelKey: TranslationKey }[] = [
  { id: "appearance", labelKey: "settingsSectionAppearance" },
  { id: "localization", labelKey: "settingsSectionLocalization" },
  { id: "general", labelKey: "settingsSectionGeneral" },
  { id: "notifications", labelKey: "settingsSectionNotifications" },
  { id: "ai", labelKey: "settingsSectionAi" },
  { id: "jira", labelKey: "settingsSectionJira" },
  { id: "storage", labelKey: "settingsSectionStorage" },
  { id: "integrations", labelKey: "settingsSectionIntegrations" },
];

export function SettingsView(props: SettingsViewProps) {
  const { lang, settings, onChange } = props;
  const [active, setActive] = useState<SectionId>("appearance");

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 md:flex-row">
      <nav
        aria-label={t(lang, "settings")}
        className="flex shrink-0 flex-row flex-wrap gap-1 md:w-56 md:flex-col"
      >
        {RAIL.map(({ id, labelKey }) => {
          const isActive = active === id;
          return (
            <button
              key={id}
              type="button"
              aria-current={isActive ? "page" : undefined}
              onClick={() => setActive(id)}
              className={
                isActive
                  ? "rounded-md bg-AIPM-dark-blue px-3 py-2 text-left text-sm font-medium text-white"
                  : "rounded-md px-3 py-2 text-left text-sm text-foreground hover:bg-surface-muted"
              }
            >
              {t(lang, labelKey)}
            </button>
          );
        })}
      </nav>

      <section className="min-w-0 flex-1 rounded-lg border border-line bg-surface p-6">
        {active === "appearance" && (
          <AppearanceSection lang={lang} settings={settings} onChange={onChange} />
        )}
        {active === "localization" && (
          <LocalizationSection lang={lang} settings={settings} onChange={onChange} />
        )}
        {active === "general" && (
          <GeneralSection lang={lang} settings={settings} onChange={onChange} />
        )}
        {active === "notifications" && (
          <NotificationsSection lang={lang} settings={settings} onChange={onChange} />
        )}
        {active === "ai" && (
          <AiSection lang={lang} settings={settings} onChange={onChange} />
        )}
        {active === "jira" && (
          <JiraSettingsSection
            lang={lang}
            config={settings.jira}
            onChange={(jira) => onChange({ ...settings, jira })}
          />
        )}
        {active === "storage" && (
          <StorageConfigSection
            lang={lang}
            config={settings.storageConfig}
            onChange={(storageConfig) => onChange({ ...settings, storageConfig })}
            onRequestSwitch={props.onRequestStorageSwitch}
            description={props.storageDescription}
            ready={props.storageReady}
            onPickFile={props.onPickStorageFile}
            onOpenFile={props.onOpenStorageFile}
            onGrantWrite={props.onGrantStorageWrite}
            m365Enabled={settings.integrations?.m365?.enabled ?? false}
            sharepointEnabled={settings.integrations?.m365?.sharepoint ?? false}
            tursoEnabled={settings.integrations?.turso?.enabled ?? false}
          />
        )}
        {active === "integrations" && (
          <IntegrationsSection lang={lang} settings={settings} onChange={onChange} />
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 4: Run the view tests**

Run: `npx vitest run settings-view`
Expected: PASS (default = Appearance; rail switches to Storage stub; General → popout toggle propagates).

- [ ] **Step 5: Typecheck + full suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/settings-view.tsx src/app/settings-view.test.tsx
git commit -m "feat: add full-page SettingsView (left section rail) reusing shared sections"
```

---

## Task 11: `ModernShell` `settingsView` slot

**Files:**
- Modify: `src/app/modern-shell.tsx`
- Test: `src/app/modern-shell.test.tsx` (create if absent; otherwise add a case)

- [ ] **Step 1: Write the failing test**

```tsx
// src/app/modern-shell.test.tsx  (add this case; create the file if it doesn't exist)
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ModernShell } from "./modern-shell";

function baseProps() {
  return {
    lang: "en-US" as const,
    activeView: "settings" as const,
    onNavigate: () => {},
    version: "0.0.0-test",
    bannerCount: 0,
    onNewTask: () => {},
    onShowAlerts: () => {},
    topBarMenus: null,
    sidebarFooter: null,
    tasksSection: <div>tasks</div>,
    workspace: <div>workspace</div>,
  };
}

describe("ModernShell settings slot", () => {
  it("renders settingsView in main when activeView === 'settings'", () => {
    render(<ModernShell {...baseProps()} settingsView={<div>settings-page</div>} />);
    expect(screen.getByText("settings-page")).toBeInTheDocument();
    expect(screen.queryByText("workspace")).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run modern-shell`
Expected: FAIL — `settingsView` prop unknown / settings page not rendered.

- [ ] **Step 3: Add the slot to `modern-shell.tsx`**

Extend `ModernShellProps`:

```tsx
  /** Phase 4B: full-page Settings, shown when activeView === "settings". */
  settingsView?: React.ReactNode;
```

Add `settingsView = null` to the destructured params, and update the content selection so the settings view wins for the `settings` view (no `primaryAction` — it's a normal page):

```tsx
  const isEditing = activeView === "edit";
  const isSettings = activeView === "settings";
  const title = isEditing ? editTitle : t(lang, navLabelKey(activeView));
  const content = isEditing
    ? editView
    : isSettings
      ? settingsView
      : activeView === "open-points"
        ? tasksSection
        : workspace;
```

(`navLabelKey("settings")` already returns the `"settings"` label key, so the title is correct without special-casing.)

- [ ] **Step 4: Run + typecheck + full suite**

Run: `npx vitest run modern-shell && npx tsc --noEmit && npx vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/modern-shell.tsx src/app/modern-shell.test.tsx
git commit -m "feat: add ModernShell settingsView slot for the full-page settings view"
```

---

## Task 12: Seam — navigate to Settings, drop the modern gear

**Files:**
- Modify: `src/app/task-manager.tsx`

**Note on testability:** `task-manager.tsx` is a large orchestrator without an isolated test harness. The seam is verified by tsc + the full suite staying green (no existing test depends on the modern gear) + the `ModernShell` slot test (Task 11) + a manual smoke check. Do not invent a brittle source-grep test for this.

- [ ] **Step 1: Build the settings view element**

Near where `editViewEl` is built (around line ~753), add:

```tsx
  const settingsViewEl = (
    <SettingsView
      lang={lang}
      settings={settings}
      onChange={setSettings}
      storageDescription={storageDescription}
      storageReady={storageReady}
      onPickStorageFile={onPickStorageFile}
      onOpenStorageFile={onOpenStorageFile}
      onGrantStorageWrite={onGrantWriteAccess}
      onRequestStorageSwitch={onRequestStorageSwitch}
    />
  );
```

Add `import { SettingsView } from "./settings-view";`.

- [ ] **Step 2: Pass it to `ModernShell` and stop intercepting `settings`**

In the `modernTree` (around lines ~955–989):

- Change `onNavigate` from:

```tsx
        onNavigate={(v) => {
          if (v === "settings") { setSettingsOpen(true); return; }
          setActiveTab(v);
        }}
```

to:

```tsx
        onNavigate={(v) => setActiveTab(v)}
```

- Add the prop to `<ModernShell …>`:

```tsx
        settingsView={settingsViewEl}
```

- [ ] **Step 3: Drop the modern Settings gear**

In `topBarMenus` (around lines ~778–801), **remove** the entire `<SettingsMenu … open={settingsOpen} onOpenChange={setSettingsOpen} />` element. Then delete the now-unused `const [settingsOpen, setSettingsOpen] = useState(false);` (line ~214) and remove the `SettingsMenu` import from `task-manager.tsx` (the classic path uses `AppHeader`, which imports `SettingsMenu` itself; `task-manager`'s own import is now unused).

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS. tsc flags any leftover `settingsOpen` reference or unused import — fix until clean.

- [ ] **Step 5: Full suite**

Run: `npx vitest run`
Expected: PASS — full count green. No existing test relied on the modern gear or the `settings → popover` interception.

- [ ] **Step 6: Manual smoke (record result in the commit body)**

Run the app (`npm run dev`), modern layout:
1. Click the sidebar **Settings** item → the main panel shows the full-page view with the left rail; URL hash is `#settings`.
2. The top bar has **no gear icon**; Voice/Export/Help/Version remain.
3. Switch a few rail sections; toggle Theme and Layout — changes apply live.
4. Toggle to **Classic** layout (from Appearance) → classic header still has its gear popover with all sections.

- [ ] **Step 7: Commit**

```bash
git add src/app/task-manager.tsx
git commit -m "feat: modern Settings opens the full-page view (sidebar-only; drop the gear popover)"
```

---

## Task 13: Release — version, changelog, memory

**Files:**
- Modify: `src/app/version.ts`
- Modify: `CHANGELOG.md`
- Modify (memory): `~/.claude/projects/C--Projects-lop-app/memory/modern-layout-roadmap.md` + `MEMORY.md`

- [ ] **Step 1: Bump the version**

In `src/app/version.ts`, set `APP_VERSION = "0.33.0"` and update the build-date / milestone comment to describe Phase-4 Workstream B (full-page Settings view; shared section components; modern gear dropped). Pick the next author surname in the established codename series (Phase 4A was "Jemisin").

- [ ] **Step 2: Changelog**

Add a `## [0.33.0] — 2026-05-30` block to `CHANGELOG.md`:
- **Added:** full-page Settings view (modern layout) with a left section rail.
- **Changed:** modern Settings is reached via the sidebar only — the gear popover is removed from the modern top bar (classic layout unchanged); settings sections are now shared components (`settings-sections/`) consumed by both the popover and the page.
- **Internal:** `Settings` types moved to `settings-types.ts` (re-exported from `settings-menu.tsx`); import-parity guard test.

- [ ] **Step 3: Typecheck + full suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/app/version.ts CHANGELOG.md
git commit -m "release: 0.33.0 — full-page Settings view (Phase 4 Workstream B)"
```

- [ ] **Step 5: Update memory**

Edit `modern-layout-roadmap.md`: mark Workstream **B = DONE @ <merge sha>, v0.33.0** with the key facts (shared `settings-sections/`; `settings-types.ts` re-export; modern gear dropped, sidebar-only; `SettingsView` left rail; `ModernShell.settingsView` slot; live auto-save). Update its `description:` and the `MEMORY.md` index line. Leave C/D pending.

---

## Final review (after all tasks)

Dispatch a final holistic `code-reviewer` over the whole branch diff (`git diff main...HEAD`), then use **superpowers:finishing-a-development-branch**:
- Verify `npx vitest run` (full suite green) + `npx tsc --noEmit`.
- Confirm the working tree shows **only** the pre-existing `README.md` + `public/*.png` beyond this branch's commits.
- Present merge options (the user's flow: merge to `main` locally; **push only on request**).

---

## Self-Review (plan vs spec)

**Spec coverage:**
- Left section rail → Task 10. ✓
- Shared section extraction, both consume → Tasks 1–7 (+ guard Task 8). ✓
- Live auto-save (no draft) → SettingsView forwards `onChange` directly; no `primaryAction` (Tasks 10–11). ✓
- Modern sidebar-only, drop gear; classic unchanged → Task 12. ✓
- `settings-types.ts` re-export breaking the cycle → Task 1. ✓
- i18n 8 keys (en + de, tsc-enforced) → Task 9. ✓
- Parity guard + per-section tests + view tests + seam coverage → Tasks 3–6, 8, 10, 11, 12. ✓
- Palette / README-png / branch constraints → Conventions + per-task. ✓

**Placeholder scan:** Extraction bodies are explicit verbatim-move instructions with exact line ranges (the logic already exists); all new scaffold/threading code is shown in full. No "TBD"/"handle edge cases"/"similar to Task N".

**Type consistency:** `Settings`, `ChatModel`, `ChannelConfig`, `NotificationsConfig`, `M365IntegrationsSettings`, `TursoIntegrationsSettings`, `IntegrationsSettings`, `StorageKind`, `TranslationKey` are used consistently across tasks and match current source. Section component prop shape is uniform: `{ lang, settings, onChange }` (storage/auth handled inside `IntegrationsSection`, or passed to `StorageConfigSection`/`JiraSettingsSection` in the view).
