# Theme Foundation — Light / Dark / System (0.15.0) — Design

**Date:** 2026-05-27
**Status:** Approved (design); pending implementation plan
**Branch:** `feat/0.15.0-theme-foundation`
**Context:** Sub-project D of the design-system batch. The batch was split into **D = theme foundation** (this spec — the switchable light/dark/system mechanism) and **E = palette sweep** (a later spec — replace `zinc-*`/off-palette colors with the AIPM palette and strip all shadows/gradients across ~44 files). This is D. D deliberately does NOT touch component colors; it only makes the theme switchable. Because Tailwind's `dark` variant becomes class-based here, every existing `dark:` utility immediately responds to the new toggle; E later corrects *which* colors those utilities use.

## Goal

Add a user-controlled **Light / Dark / System** theme, replacing today's media-query-only dark mode. "System" follows the OS preference live; an explicit Light or Dark choice overrides the OS. The choice persists per device and applies before first paint (no flash).

## Current state

- `globals.css` defines the AIPM brand palette as `--AIPM-*` CSS vars and exposes them via `@theme inline`. Dark mode is **media-query only**: `@media (prefers-color-scheme: dark)` flips just `--background` and `--foreground`. There is no class-based dark, no toggle, and no persistence.
- Components hardcode `dark:bg-zinc-*` etc. (≈417 `zinc-*` refs across 44 files) — left untouched in D; addressed in E.
- `SettingsMenu` (`settings-menu.tsx`) hosts device/workspace preferences (language, holiday countries, notifications, …) via a persisted `Settings` object with an `onChange` callback.
- `layout.tsx` is the App Router root layout. Pop-out windows are same-origin and run the same layout/scripts.

## Design

### Theme state (per-device, decoupled from `Settings`)

- `Theme = "light" | "dark" | "system"`.
- Persisted in its OWN `localStorage` key `lop-theme` (NOT in the workspace-scoped `Settings` object, which loads asynchronously and is per-workspace; theme is per-device and must apply before paint). Default when unset/invalid: `"system"`.

### Pure helpers — `theme.ts` (new)

- `export type Theme = "light" | "dark" | "system";`
- `export const THEME_STORAGE_KEY = "lop-theme";`
- `resolveTheme(theme: Theme, systemPrefersDark: boolean): "light" | "dark"` — returns `theme` when explicit; when `"system"`, returns `"dark"` if `systemPrefersDark` else `"light"`. Pure.
- `readStoredTheme(raw: string | null): Theme` — returns the value if it is one of the three; otherwise `"system"`. Pure (callers pass `localStorage.getItem(THEME_STORAGE_KEY)`).

### Provider + hook — `use-theme.tsx` (new, client)

- `ThemeProvider` wraps the app. Internal state initialised from `readStoredTheme(localStorage.getItem(THEME_STORAGE_KEY))`, guarded for SSR (lazy initialiser / effect; no `window` access during render on the server).
- Exposes `useTheme(): { theme: Theme; setTheme: (t: Theme) => void }`.
- An effect applies the resolved theme: `document.documentElement.classList.toggle("dark", resolveTheme(theme, systemPrefersDark) === "dark")`.
- When `theme === "system"`, subscribes to `matchMedia("(prefers-color-scheme: dark)")` `change` events and re-applies the class live; unsubscribes when leaving system mode or on unmount.
- `setTheme(t)` updates state and writes `localStorage[THEME_STORAGE_KEY] = t`.

### No-flash script — `layout.tsx`

A small inline IIFE injected into `<head>` (via a `<script>` with `dangerouslySetInnerHTML`) that runs before first paint:

```js
(function () {
  try {
    var t = localStorage.getItem("lop-theme") || "system";
    var dark = t === "dark" || (t === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", dark);
  } catch (e) {}
})();
```

The root layout also wraps the app in `<ThemeProvider>`. (Per AGENTS.md, confirm the Next 16 / React 19 conventions for injecting a head script and for client-provider placement in `node_modules/next/dist/docs/` before implementing.)

### Tailwind / CSS — `globals.css`

- Add `@custom-variant dark (&:where(.dark, .dark *));` so the `dark:` variant keys off the `.dark` class instead of the media query.
- Replace the `@media (prefers-color-scheme: dark) { :root { … } }` block with a class selector:
  ```css
  .dark {
    --background: #0a0a0a;
    --foreground: #e3e6e6;
  }
  ```
- Leave the `--AIPM-*` brand tokens and `@theme inline` block unchanged. No new tokens in D (the semantic surface-token vocabulary is part of E's palette work).

System mode is handled by the no-flash script + provider toggling the class — not by a CSS media query — so an explicit Light choice wins over a dark OS.

### UI — theme control in `SettingsMenu`

A 3-way `SegmentedControl<Theme>` (Light / Dark / System) rendered at the TOP of the settings dropdown, just above or beside the Language control. It calls `useTheme()` directly (`value={theme}`, `onChange={setTheme}`) — it is NOT wired through the `Settings`/`onChange` object. Uses the existing `SegmentedControl` component and existing styling conventions (no new colors).

### i18n (EN + DE)

New keys in both dictionaries: `theme` ("Theme" / "Darstellung"), `themeLight` ("Light" / "Hell"), `themeDark` ("Dark" / "Dunkel"), `themeSystem` ("System" / "System"), `themeHint` (SegmentedControl `title`, e.g. "Choose light, dark, or follow your system setting.").

## Non-goals

- No palette / `zinc-*` / shadow / gradient changes (that is sub-project E). The toggle works app-wide as-is because the `dark:` variant is now class-based.
- Theme is NOT persisted to the workspace file or added to the `Settings` type (device-scoped).
- No per-pop-out theme override — pop-outs inherit the device theme via the same localStorage key + `<head>` script.
- No new semantic surface tokens (E introduces and adopts those).

## Edge cases

- **No JS / pre-hydration:** the `<head>` script sets the class before paint; the app is a client app, so this is the normal path. Without the script's class, the app renders light (acceptable fallback).
- **Invalid/empty `lop-theme`:** `readStoredTheme` returns `"system"`.
- **System mode + OS theme changes while open:** the provider's `matchMedia` listener re-applies the class live.
- **SSR:** the provider must not touch `window`/`localStorage` during server render; reads happen in a lazy initialiser/effect.

## Testing

- **Unit (`theme.test.ts`):** `resolveTheme` — `("system", true) → "dark"`, `("system", false) → "light"`, `("light", true) → "light"`, `("dark", false) → "dark"`. `readStoredTheme` — `"dark" → "dark"`, `"system" → "system"`, `null → "system"`, `"bogus" → "system"`.
- **Provider (`use-theme.test.tsx`):** rendering with stored `"dark"` adds `.dark` to `document.documentElement`; `setTheme("light")` removes it and writes `localStorage`; with `"system"` and a mocked `matchMedia` reporting dark, `.dark` is present and a simulated `change` to light removes it.
- **Component (`settings-menu.test.tsx`):** the Light/Dark/System control renders inside the open settings menu, reflects the current theme, and selecting an option calls `setTheme` with that value (wrap the render in `ThemeProvider` or mock `useTheme`).

## Release

Feature → **0.15.0**, codename **"Le Guin"** (new minor milestone). Add highlight key `versionHighlightTheme` to `APP_HIGHLIGHT_KEYS` with EN+DE i18n strings (minors get a highlight key; patches do not). Bump `version.ts` (`APP_VERSION = "0.15.0"`, build date 2026-05-27, update the codename comment), add a `[0.15.0]` CHANGELOG entry, note the theme system in `docs/CODEMAPS/{frontend,data}.md` (the `lop-theme` key, `theme.ts`, `use-theme.tsx`, the no-flash script). Gates: lint 0, tsc 0, `test:coverage` green (≥70%).
