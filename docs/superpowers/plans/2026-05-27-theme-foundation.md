# Theme Foundation — Light / Dark / System (0.15.0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a user-controlled Light / Dark / System theme (class-based dark mode, persisted per device, no flash on load), replacing today's media-query-only dark mode.

**Architecture:** Pure helpers (`theme.ts`) + a `ThemeProvider`/`useTheme` hook (`use-theme.tsx`) that toggles a `.dark` class on `<html>`. A no-flash inline script in `layout.tsx` sets the class before paint. `globals.css` switches the Tailwind `dark` variant to class-based, so every existing `dark:` utility immediately follows the toggle. A 3-way SegmentedControl in `SettingsMenu` drives it. Theme lives in its own `localStorage` key, NOT in the workspace `Settings`.

**Tech Stack:** Next.js 16 (App Router), React 19, TypeScript, Tailwind v4 (CSS `@theme`/`@custom-variant`, no JS config), Vitest + Testing Library. No new deps.

**Spec:** `docs/superpowers/specs/2026-05-27-theme-foundation-design.md`
**Branch:** `feat/0.15.0-theme-foundation` (already created off `main`).

**Conventions:** immutable; no `any`; reuse the existing `SegmentedControl`; introduce NO new colors (palette cleanup is the separate sub-project E). Run `npx tsc --noEmit`, `npm run lint`, and relevant `npx vitest run` after each task. Each task leaves the build green.

> **Heads-up for every implementer subagent:**
> 1. This repo has a fact-forcing gate hook. Before your FIRST shell command, print 2 facts (the task + what the command does). Before EVERY Write/Edit, in the SAME message print 4 facts — (a) importers of the file (run a Grep in the same turn; for a NEW file, grep the symbol/file name to show nothing imports it yet), (b) public functions/props affected, (c) data fields involved, (d) the user instruction verbatim: "add a light and dark mode as well as the option to follow the system default setting." — then retry the same Write/Edit.
> 2. **AGENTS.md:** "This is NOT the Next.js you know." Before editing `layout.tsx`, READ the relevant guide under `node_modules/next/dist/docs/` for the Next 16 way to inject a pre-hydration inline `<script>` and to place a client-component provider in the root layout. Heed deprecation notices.
> 3. Platform is win32 — use the Bash tool for `npx`/`git`/`npm` (cross-platform). No `&&`-chained `cd`.
> 4. After test runs, if `git status` shows `src/app/sample-workspace.md` modified, `git restore src/app/sample-workspace.md` BEFORE committing.

---

## Task 1: Pure theme helpers

**Files:**
- Create: `src/app/theme.ts`
- Test: `src/app/theme.test.ts`

- [ ] **Step 1: Write the failing test** — create `src/app/theme.test.ts`:

```ts
import { describe, test, expect } from "vitest";
import { resolveTheme, readStoredTheme, THEME_STORAGE_KEY } from "./theme";

describe("resolveTheme", () => {
  test("system follows the OS preference", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
  });
  test("explicit choice overrides the OS preference", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });
});

describe("readStoredTheme", () => {
  test("returns a valid stored value", () => {
    expect(readStoredTheme("dark")).toBe("dark");
    expect(readStoredTheme("light")).toBe("light");
    expect(readStoredTheme("system")).toBe("system");
  });
  test("falls back to system on null or invalid input", () => {
    expect(readStoredTheme(null)).toBe("system");
    expect(readStoredTheme("bogus")).toBe("system");
    expect(readStoredTheme("")).toBe("system");
  });
});

test("storage key is the documented constant", () => {
  expect(THEME_STORAGE_KEY).toBe("lop-theme");
});
```

- [ ] **Step 2: Run → FAIL** — `npx vitest run src/app/theme.test.ts`. Expected: FAIL (module/exports do not exist).

- [ ] **Step 3: Implement** — create `src/app/theme.ts`:

```ts
// Per-device theme preference. "system" follows the OS; "light"/"dark" override
// it. Stored in its own localStorage key (NOT the workspace Settings), so it can
// be applied before first paint by a no-flash script. Pure helpers only — the
// DOM/localStorage wiring lives in use-theme.tsx.

export type Theme = "light" | "dark" | "system";

export const THEME_STORAGE_KEY = "lop-theme";

/** Resolve the chosen theme to the concrete mode to apply. */
export function resolveTheme(theme: Theme, systemPrefersDark: boolean): "light" | "dark" {
  if (theme === "system") return systemPrefersDark ? "dark" : "light";
  return theme;
}

/** Validate a raw stored string into a Theme, defaulting to "system". */
export function readStoredTheme(raw: string | null): Theme {
  return raw === "light" || raw === "dark" || raw === "system" ? raw : "system";
}
```

- [ ] **Step 4: Run → PASS** — `npx vitest run src/app/theme.test.ts`; then `npx tsc --noEmit` (0); `npm run lint` (0).

- [ ] **Step 5: Commit**
```bash
git add src/app/theme.ts src/app/theme.test.ts
git commit -m "feat(theme): pure theme helpers (resolveTheme, readStoredTheme)"
```

---

## Task 2: ThemeProvider + useTheme hook

**Files:**
- Create: `src/app/use-theme.tsx`
- Test: `src/app/use-theme.test.tsx`

Design notes: `ThemeContext` is created with a NON-undefined default (`{ theme: "system", setTheme: () => {} }`) so `useTheme()` called outside a provider returns harmless defaults (this keeps existing `SettingsMenu` tests working without wrapping). The provider owns real state, applies the `.dark` class, listens to system changes, and persists.

- [ ] **Step 1: Write the failing test** — create `src/app/use-theme.test.tsx`:

```tsx
import { describe, test, expect, beforeEach, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { ThemeProvider, useTheme } from "./use-theme";
import { THEME_STORAGE_KEY } from "./theme";

// jsdom has no matchMedia — install a controllable mock.
let systemDark = false;
const listeners = new Set<(e: { matches: boolean }) => void>();
beforeEach(() => {
  systemDark = false;
  listeners.clear();
  localStorage.clear();
  document.documentElement.classList.remove("dark");
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: systemDark,
    media: query,
    addEventListener: (_: string, cb: (e: { matches: boolean }) => void) => listeners.add(cb),
    removeEventListener: (_: string, cb: (e: { matches: boolean }) => void) => listeners.delete(cb),
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
    onchange: null,
  })) as unknown as typeof window.matchMedia;
});

function Probe() {
  const { theme, setTheme } = useTheme();
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <button onClick={() => setTheme("light")}>light</button>
      <button onClick={() => setTheme("dark")}>dark</button>
      <button onClick={() => setTheme("system")}>system</button>
    </div>
  );
}

describe("ThemeProvider", () => {
  test("applies .dark when the stored theme is dark", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    render(<ThemeProvider><Probe /></ThemeProvider>);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(screen.getByTestId("theme").textContent).toBe("dark");
  });

  test("setTheme('light') removes .dark and persists", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    render(<ThemeProvider><Probe /></ThemeProvider>);
    fireEvent.click(screen.getByText("light"));
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
  });

  test("system mode follows matchMedia and reacts to OS changes", () => {
    systemDark = true;
    localStorage.setItem(THEME_STORAGE_KEY, "system");
    render(<ThemeProvider><Probe /></ThemeProvider>);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    // Simulate the OS switching to light.
    act(() => {
      systemDark = false;
      listeners.forEach((cb) => cb({ matches: false }));
    });
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
});
```

- [ ] **Step 2: Run → FAIL** — `npx vitest run src/app/use-theme.test.tsx`. Expected: FAIL (module does not exist).

- [ ] **Step 3: Implement** — create `src/app/use-theme.tsx`:

```tsx
"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { type Theme, THEME_STORAGE_KEY, readStoredTheme, resolveTheme } from "./theme";

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

// Non-undefined default: useTheme() outside a provider is harmless (no throw).
const ThemeContext = createContext<ThemeContextValue>({
  theme: "system",
  setTheme: () => {},
});

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}

function prefersDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() =>
    typeof window === "undefined" ? "system" : readStoredTheme(localStorage.getItem(THEME_STORAGE_KEY)),
  );

  // Apply the resolved theme as a `.dark` class on <html>, and (in system mode)
  // keep it in sync with OS changes.
  useEffect(() => {
    const apply = () =>
      document.documentElement.classList.toggle("dark", resolveTheme(theme, prefersDark()) === "dark");
    apply();
    if (theme !== "system") return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => apply();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [theme]);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Ignore storage failures (private mode, quota) — in-memory state still applies.
    }
  }, []);

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}
```

- [ ] **Step 4: Run → PASS** — `npx vitest run src/app/use-theme.test.tsx`; then `npx tsc --noEmit` (0); `npm run lint` (0).

- [ ] **Step 5: Commit**
```bash
git add src/app/use-theme.tsx src/app/use-theme.test.tsx
git commit -m "feat(theme): ThemeProvider + useTheme (class toggle, system-follow, persistence)"
```

---

## Task 3: Class-based dark CSS + no-flash script + mount provider

**Files:**
- Modify: `src/app/globals.css`
- Modify: `src/app/layout.tsx`

No new unit test (CSS + server-layout wiring). Verification is tsc + lint + the existing test suite staying green; the class-application behavior is already covered by Task 2's provider test.

- [ ] **Step 1: Read the Next docs** — per AGENTS.md, read the relevant guide under `node_modules/next/dist/docs/` for the Next 16 way to (a) inject a pre-hydration inline `<script>` from the root layout and (b) place a client-component provider wrapping `{children}`. Note any deprecations before editing.

- [ ] **Step 2: globals.css** — open `src/app/globals.css`. Directly after the `@import "tailwindcss";` line add:
```css
@custom-variant dark (&:where(.dark, .dark *));
```
Then REPLACE this block:
```css
@media (prefers-color-scheme: dark) {
  :root {
    --background: #0a0a0a;
    --foreground: #e3e6e6;
  }
}
```
with:
```css
.dark {
  --background: #0a0a0a;
  --foreground: #e3e6e6;
}
```
Leave the `:root` palette tokens and the `@theme inline` block unchanged.

- [ ] **Step 3: layout.tsx** — add the no-flash script + the provider. Import the provider at the top:
```tsx
import { ThemeProvider } from "./use-theme";
```
Define the script string (above the component) and render it as the FIRST child of `<body>`, then wrap `{children}` in `<ThemeProvider>`. The `<html>` tag already has `suppressHydrationWarning` — keep it. Result (adapt to the Next 16 head-script guidance from Step 1 if it differs):
```tsx
const NO_FLASH_THEME_SCRIPT = `(function(){try{var t=localStorage.getItem("lop-theme")||"system";var d=t==="dark"||(t==="system"&&window.matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d);}catch(e){}})();`;
```
and inside `<body>`:
```tsx
      <body className="min-h-full flex flex-col font-[var(--font-titillium)]">
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH_THEME_SCRIPT }} />
        <ThemeProvider>{children}</ThemeProvider>
      </body>
```

- [ ] **Step 4: Verify** — `npx tsc --noEmit` (0); `npm run lint` (0); `npx vitest run` (full suite still green — switching to class-based dark must not break any existing test). Manually reason: jsdom tests have no `.dark` class and no matchMedia by default, so components render in light mode exactly as before.

- [ ] **Step 5: Commit**
```bash
git add src/app/globals.css src/app/layout.tsx
git commit -m "feat(theme): class-based dark variant + no-flash script + ThemeProvider mount"
```

---

## Task 4: Theme control in SettingsMenu + i18n

**Files:**
- Modify: `src/app/settings-menu.tsx`
- Modify: `src/app/i18n.ts`
- Modify: `src/app/i18n.de.ts`
- Test: `src/app/settings-menu.test.tsx`

- [ ] **Step 1: i18n keys (EN)** — in `src/app/i18n.ts`, inside the `enUS` object (the one ending `} as const;` that defines `TranslationKey`), add near the `language` key:
```ts
  theme: "Theme",
  themeLight: "Light",
  themeDark: "Dark",
  themeSystem: "System",
  themeHint: "Choose light, dark, or follow your system setting.",
```
(en-GB mirrors `enUS` via `{ ...enUS }`, so no en-GB edit is needed.)

- [ ] **Step 2: i18n keys (DE)** — in `src/app/i18n.de.ts`, add the same keys with German values (the dict is typed `Record<TranslationKey, string>`, so all five are required or tsc fails):
```ts
  theme: "Darstellung",
  themeLight: "Hell",
  themeDark: "Dunkel",
  themeSystem: "System",
  themeHint: "Hell, dunkel oder der Systemeinstellung folgen.",
```

- [ ] **Step 3: Write the failing test** — in `src/app/settings-menu.test.tsx`, add at the TOP (after the existing imports) a hoisted spy + mock of the theme hook, then a new test. The mock applies to the whole file; the existing tests do not use theme and are unaffected.

Add after the existing `vi.mock(...)` calls (lines 7–12):
```tsx
const setTheme = vi.hoisted(() => vi.fn());
vi.mock("./use-theme", () => ({
  useTheme: () => ({ theme: "system" as const, setTheme }),
  ThemeProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
```
Add this test inside a new `describe`:
```tsx
describe("SettingsMenu theme control", () => {
  it("renders Light/Dark/System and selecting one calls setTheme", () => {
    render(<SettingsMenu {...makeProps()} />);
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "settings") }));
    expect(screen.getByRole("radio", { name: t("en-US", "themeSystem") })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: t("en-US", "themeDark") }));
    expect(setTheme).toHaveBeenCalledWith("dark");
  });
});
```

- [ ] **Step 4: Run → FAIL** — `npx vitest run src/app/settings-menu.test.tsx -t "theme control"`. Expected: FAIL (no theme radios rendered yet).

- [ ] **Step 5: Implement** — in `src/app/settings-menu.tsx`:
  1. Add imports:
```tsx
import { SegmentedControl } from "./segmented-control";
import { useTheme } from "./use-theme";
import type { Theme } from "./theme";
```
  2. Inside `SettingsMenu`, near the other hooks (e.g. after `const lang = settings.language;`), add:
```tsx
  const { theme, setTheme } = useTheme();
```
  3. Render the control as the FIRST block inside the settings dropdown, immediately after the `<h3>…{t(lang, "settings")}</h3>` heading and before the Language `<label>`:
```tsx
          <div className="mb-4">
            <span className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              {t(lang, "theme")}
            </span>
            <SegmentedControl<Theme>
              value={theme}
              ariaLabel={t(lang, "theme")}
              title={t(lang, "themeHint")}
              className="w-full"
              options={[
                { value: "light", label: t(lang, "themeLight") },
                { value: "dark", label: t(lang, "themeDark") },
                { value: "system", label: t(lang, "themeSystem") },
              ]}
              onChange={setTheme}
            />
          </div>
```

- [ ] **Step 6: Run → PASS** — `npx vitest run src/app/settings-menu.test.tsx`; then `npx tsc --noEmit` (0); `npm run lint` (0).

- [ ] **Step 7: Commit**
```bash
git add src/app/settings-menu.tsx src/app/i18n.ts src/app/i18n.de.ts src/app/settings-menu.test.tsx
git commit -m "feat(theme): Light/Dark/System control in settings (+EN/DE i18n)"
```

---

## Task 5: Release 0.15.0 "Le Guin"

**Files:** `src/app/version.ts`, `src/app/i18n.ts`, `src/app/i18n.de.ts`, `CHANGELOG.md`, `docs/CODEMAPS/frontend.md`, `docs/CODEMAPS/data.md`.

- [ ] **Step 1: version.ts** — in `src/app/version.ts`:
  - Set `export const APP_VERSION = "0.15.0";`.
  - Update the build-date codename comment to `export const APP_BUILD_DATE = "2026-05-27"; // Le Guin milestone`.
  - Append `"versionHighlightTheme"` as the LAST entry of the `APP_HIGHLIGHT_KEYS` array (minors add a highlight key).
  - Add a one-line comment block at the very TOP of the file (above the existing `// 0.14.3 …` comment):
```ts
// 0.15.0 "Le Guin" adds a Light / Dark / System theme: a class-based dark mode
// with a no-flash loader, persisted per device (localStorage "lop-theme"), and a
// 3-way control in Settings. (Palette/shadow cleanup follows in a later release.)
```

- [ ] **Step 2: i18n highlight string** — add `versionHighlightTheme` to BOTH dicts.
  - `src/app/i18n.ts` (`enUS`), next to the other `versionHighlight*` keys:
```ts
  versionHighlightTheme: "Light / Dark / System theme with a no-flash loader and a settings toggle.",
```
  - `src/app/i18n.de.ts`:
```ts
  versionHighlightTheme: "Helles / dunkles / systemgesteuertes Design mit Sofortladen und Umschalter in den Einstellungen.",
```

- [ ] **Step 3: CHANGELOG** — READ `CHANGELOG.md` to match the existing entry style, then add a new `## [0.15.0] — 2026-05-27` entry above `[0.14.3]`:
```markdown
## [0.15.0] — 2026-05-27

### Added
- **Light / Dark / System theme.** A new theme control in Settings lets you pick light, dark, or follow your operating-system setting. Your choice is remembered on this device and applied instantly on load (no flash). Dark mode is now class-based and switchable, replacing the previous OS-only behavior.
```
(If the existing entries do not use `### Added`, match whatever format `[0.14.3]` uses.)

- [ ] **Step 4: Codemaps** — concise notes matching each file's style:
  - `docs/CODEMAPS/frontend.md`: add `theme.ts` (pure theme helpers), `use-theme.tsx` (ThemeProvider/useTheme — toggles `.dark`, follows system, persists), the no-flash script + `<ThemeProvider>` in `layout.tsx`, and the theme control in `settings-menu.tsx`.
  - `docs/CODEMAPS/data.md`: note the `lop-theme` localStorage key (values `light`/`dark`/`system`, default `system`), separate from the workspace `Settings`.

- [ ] **Step 5: Verify** — `npx tsc --noEmit` (0); `npm run lint` (0); `npm run test:coverage` (green, ≥70% lines). Then `git status`; if `src/app/sample-workspace.md` is dirty, `git restore src/app/sample-workspace.md`.

- [ ] **Step 6: Commit**
```bash
git add src/app/version.ts src/app/i18n.ts src/app/i18n.de.ts CHANGELOG.md docs/CODEMAPS/frontend.md docs/CODEMAPS/data.md
git commit -m "docs(release): 0.15.0 \"Le Guin\" — Light/Dark/System theme"
```

---

## Final review

Dispatch a final code reviewer over `git diff main...HEAD`. Instruct the reviewer to READ `src/app/version.ts` and `CHANGELOG.md` DIRECTLY (do not infer the version from diff +/- direction). Confirm: `APP_VERSION === "0.15.0"`; `"versionHighlightTheme"` is the last `APP_HIGHLIGHT_KEYS` entry and the i18n string exists in BOTH `i18n.ts` and `i18n.de.ts`; a real `[0.15.0]` CHANGELOG entry exists; the `dark` variant is class-based and the `@media (prefers-color-scheme)` block is gone; the no-flash script + `<ThemeProvider>` are in `layout.tsx`; NO new color tokens or palette/shadow edits were introduced (E owns that); the full suite is green. Then use `superpowers:finishing-a-development-branch`.

---

## Self-Review (author)

**Spec coverage:**
- Theme state + `localStorage` key `lop-theme`, default system → Task 1 (`THEME_STORAGE_KEY`, `readStoredTheme`) + Task 2 (init).
- Pure `resolveTheme`/`readStoredTheme` → Task 1.
- `ThemeProvider`/`useTheme`, class toggle, system-follow listener, persistence → Task 2.
- No-flash body/`<head>` script → Task 3.
- Class-based `@custom-variant` + `.dark` block replacing the media query → Task 3.
- Settings SegmentedControl (Light/Dark/System) wired to `useTheme` → Task 4.
- i18n EN+DE (`theme`, `themeLight`, `themeDark`, `themeSystem`, `themeHint`) → Task 4.
- Release 0.15.0 "Le Guin", highlight key + EN/DE string, CHANGELOG, codemaps → Task 5.
All spec requirements map to a task.

**Placeholder scan:** No TBD/TODO; every code step shows complete code. The two "match the existing format" notes (CHANGELOG style; Next head-script guidance) are real source-confirmations, not placeholders.

**Type consistency:** `Theme` is defined in `theme.ts` (Task 1) and consumed by `use-theme.tsx` (Task 2), `settings-menu.tsx` (Task 4 — `SegmentedControl<Theme>`), all using the same three string literals. `useTheme()` returns `{ theme: Theme; setTheme: (theme: Theme) => void }` in Task 2 and is mocked with that exact shape + consumed with that shape in Task 4. `THEME_STORAGE_KEY` ("lop-theme") is shared by Task 1, Task 2, and the Task 3 no-flash script (string literal `"lop-theme"`).
