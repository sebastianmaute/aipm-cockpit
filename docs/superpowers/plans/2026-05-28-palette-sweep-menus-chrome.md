# Palette Sweep — Menus + Chrome + Misc (0.16.0 "Butler") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the remaining ~16 menus + chrome + misc files (~3914 LOC) to the AIPM palette + surface tokens — class strings + a handful of named status edits — and ship **0.16.0 "Butler"** with the `versionHighlightPalette` headline key, closing out sub-project E.

**Architecture:** Per-file class-string migration applying the shared chunk mapping + per-file named status edits (decided in the spec). Most files are chrome-only; the small ones (≤67 lines, no status colors) are grouped into a single task. Per-file *transform → grep-verify-clean → existing tests stay green → commit*.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind v4, Vitest. No new deps.

**Spec:** `docs/superpowers/specs/2026-05-28-palette-sweep-menus-chrome-design.md`
**Reference (binding):** `docs/DESIGN-TOKENS.md`
**Branch:** `feat/0.16.0-palette-sweep-menus-chrome` (already created off `main`).

## Shared mapping table (apply to every file task)

| Current utility | Replace with |
|---|---|
| `bg-white` | `bg-surface` |
| `bg-zinc-50/100`, `dark:bg-zinc-900/950` | `bg-surface-muted` |
| `border-zinc-200/300`, `dark:border-zinc-700/800`, `border-AIPM-light-grey` | `border-line` |
| `divide-zinc-*`, `divide-AIPM-light-grey` | `divide-line` |
| `bg-AIPM-light-grey`(`/NN`) | `bg-surface-muted` |
| `shadow-*` | remove |
| `focus:ring-AIPM-dark-blue` / `focus-visible:ring-AIPM-dark-blue` / `ring-zinc-*` | `ring-AIPM-green` / `focus-visible:ring-AIPM-green` |
| `hover:bg-zinc-*` / `dark:hover:bg-zinc-*` / `hover:bg-AIPM-light-grey` | `hover:bg-surface-muted` |
| `text-zinc-900/800/700` (+ paired dark) | `text-foreground` |
| `text-zinc-500/600/400` (+ paired dark) | `text-muted-foreground` |
| `text-AIPM-dark-grey` (+ any `dark:text-AIPM-light-grey`) | `text-foreground` |
| `text-AIPM-medium-grey` (+ any dark) | `text-muted-foreground` |
| `bg-gradient-*`, `from-*`, `via-*`, `to-*` | remove |

**KEEP UNCHANGED:** `bg-AIPM-dark-blue text-white` fills; heading pairs `text-AIPM-dark-blue dark:text-AIPM-light-grey`; all AIPM accent colors (`AIPM-pink`, `AIPM-green`, `AIPM-blue`, `AIPM-purple`); ALL non-class code.

**CRITICAL:** REPLACE each utility in place — never ADD a second color utility. After editing, no className may contain two `bg-*`, two `border-<color>`, two `divide-*`, or two `text-<color>` base utilities (variants like `hover:`/`dark:` are fine).

## Per-file verification (run after each file)

Use the Grep tool on the single migrated file with BOTH regexes; expect **zero matches** for each:
1. `zinc-|shadow-|bg-gradient|from-\[|(amber|red|emerald|sky|rose|slate|gray|orange|yellow|teal|cyan|indigo|violet|fuchsia|green|blue|purple|pink)-[0-9]`
2. `border-AIPM-light-grey|divide-AIPM-light-grey|bg-AIPM-light-grey|text-AIPM-dark-grey|text-AIPM-medium-grey`

`AIPM-*` alpha utilities (`bg-AIPM-pink/15`, `text-AIPM-purple`, etc.) do NOT match either pattern. `dark:text-AIPM-light-grey` heading-text variant does NOT match.

> **Heads-up for every implementer subagent:**
> 1. Fact-forcing gate. Before FIRST shell command print 2 facts (task + command purpose). Before EVERY Edit, in the SAME message print 4 facts — (a) importers (Grep `<ComponentName>` in same turn), (b) symbols affected (none — class strings unless the task says otherwise), (c) data fields (none), (d) instruction verbatim: "adjust the design to follow the following table:". Then retry the Edit.
> 2. win32 — Bash tool, no `&&`-chained `cd`, don't touch eslint.config.mjs.
> 3. After test runs, if `git status` shows `src/app/sample-workspace.md` dirty, `git restore` it BEFORE committing.
> 4. **Class strings ONLY** (plus the explicit named string-literal edits where listed). Targeted edits — preserve all logic/markup/tests byte-for-byte.

---

## Task 1: `settings-menu.tsx` (538 lines)

**Files:** Modify `src/app/settings-menu.tsx`.

- [ ] **Step 1: Migrate** — READ the file. Apply the shared mapping table. The biggest file of this chunk (~34 zinc refs + several status spots).
- [ ] **Step 2: Named status edits** (exact before→after):
  - Remove-country `×` button (~line 291): `text-zinc-500 hover:text-red-600 dark:text-zinc-400 dark:hover:text-red-400` → `text-muted-foreground hover:text-AIPM-pink`
  - AI-consent revoke link (~line 472): `text-xs font-medium text-red-600 underline-offset-2 hover:underline dark:text-red-400` → `text-xs font-medium text-AIPM-pink underline-offset-2 hover:underline`
  - AI-consent required hint (~line 478): `text-xs text-amber-700 dark:text-amber-400` → `text-xs text-AIPM-purple`
- [ ] **Step 3: Grep-verify** — both regexes return ZERO; duplicate-utility scan clean.
- [ ] **Step 4: Gates** — `npx vitest run settings-menu`; `npx tsc --noEmit` (0); `npm run lint` (0). If `settings-menu.test.tsx` asserts on any old palette classes, update those assertions.
- [ ] **Step 5: Commit**
```bash
git add src/app/settings-menu.tsx
git add src/app/settings-menu.test.tsx 2>/dev/null || true
git commit -m "style(palette): settings-menu to surface tokens; red->pink, amber->purple"
```

---

## Task 2: `chat-panel.tsx` (465 lines — biggest status work: the AI-consent card)

**Files:** Modify `src/app/chat-panel.tsx`.

- [ ] **Step 1: Migrate** — READ the file. Apply the shared mapping table to all chrome (sticky header, scroll panel, message list, input area, buttons).
- [ ] **Step 2: Named status edits** (exact before→after):
  - Red error message (~315): `mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300` → `mt-2 rounded-md bg-AIPM-pink/10 px-3 py-2 text-sm text-AIPM-pink dark:bg-AIPM-pink/15`
  - **AI-consent card** (~lines 375–416) — multi-element warning block; map ALL amber-* to `AIPM-purple` equivalents:
    - Outer card (~375): `rounded-lg border border-amber-300 bg-amber-50 p-5 dark:border-amber-700 dark:bg-amber-950/30` → `rounded-lg border border-AIPM-purple/40 bg-AIPM-purple/10 p-5 dark:border-AIPM-purple/50 dark:bg-AIPM-purple/15`
    - `<h3>` heading (~376): `text-base font-semibold text-amber-900 dark:text-amber-100` → `text-base font-semibold text-AIPM-purple`
    - Body `<p>` (~379): `mt-2 text-sm text-amber-900/80 dark:text-amber-100/80` → `mt-2 text-sm text-AIPM-purple/80`
    - `<ul>` (~382): `mt-3 space-y-2 text-sm text-amber-900 dark:text-amber-100` → `mt-3 space-y-2 text-sm text-AIPM-purple`
    - Inline link (~397): `font-medium text-amber-900 underline underline-offset-2 hover:text-amber-700 dark:text-amber-100 dark:hover:text-amber-200` → `font-medium text-AIPM-purple underline underline-offset-2 hover:text-AIPM-purple/80`
    - Checkbox `<label>` (~402): `mt-4 flex cursor-pointer items-start gap-2 text-sm text-amber-900 dark:text-amber-100` → `mt-4 flex cursor-pointer items-start gap-2 text-sm text-AIPM-purple`
    - Checkbox `<input>` (~407): `mt-0.5 h-4 w-4 cursor-pointer rounded border-amber-400 text-amber-700 focus:ring-amber-500 dark:border-amber-600 dark:bg-amber-950` → `mt-0.5 h-4 w-4 cursor-pointer rounded border-AIPM-purple/40 text-AIPM-purple focus:ring-AIPM-purple dark:border-AIPM-purple/50 dark:bg-AIPM-purple/15`
    - **"I consent" primary button** (~416): `rounded-md bg-amber-700 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-amber-800 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-amber-600 dark:hover:bg-amber-500` → `rounded-md bg-AIPM-purple px-4 py-2 text-sm font-medium text-white hover:bg-AIPM-purple/90 focus:outline-none focus:ring-2 focus:ring-AIPM-purple focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50`
  - Selected-item red border (~446): `border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200` → `border-AIPM-pink/40 bg-AIPM-pink/10 text-AIPM-pink dark:border-AIPM-pink/50 dark:bg-AIPM-pink/15`
- [ ] **Step 3: Grep-verify** — both regexes return ZERO; duplicate-utility scan clean.
- [ ] **Step 4: Gates** — `npx vitest run chat-panel`; `npx tsc --noEmit` (0); `npm run lint` (0).
- [ ] **Step 5: Commit**
```bash
git add src/app/chat-panel.tsx
git commit -m "style(palette): chat-panel to surface tokens; AI-consent card amber->purple; error/selected red->pink"
```

---

## Task 3: `jira-settings.tsx` (463 lines, chrome-only)

**Files:** Modify `src/app/jira-settings.tsx`.

- [ ] **Step 1: Migrate** — READ the file. Apply the shared mapping table. Chrome only — no named status edits expected. If any stray red/amber appears, map per the standard rule.
- [ ] **Step 2: Grep-verify** — both regexes return ZERO; duplicate-utility scan clean.
- [ ] **Step 3: Gates** — `npx vitest run jira-settings`; `npx tsc --noEmit` (0); `npm run lint` (0).
- [ ] **Step 4: Commit**
```bash
git add src/app/jira-settings.tsx
git commit -m "style(palette): jira-settings to surface tokens (no zinc/shadow)"
```

---

## Task 4: `workspace-section.tsx` (462 lines, chrome)

**Files:** Modify `src/app/workspace-section.tsx`.

- [ ] **Step 1: Migrate** — READ the file. Apply the shared mapping table. Chrome.
- [ ] **Step 2: Grep-verify** — both regexes return ZERO; duplicate-utility scan clean.
- [ ] **Step 3: Gates** — `npx vitest run workspace-section`; `npx tsc --noEmit` (0); `npm run lint` (0).
- [ ] **Step 4: Commit**
```bash
git add src/app/workspace-section.tsx
git commit -m "style(palette): workspace-section to surface tokens (no zinc/shadow)"
```

---

## Task 5: `activity-log-panel.tsx` (291 lines — delete-confirm red bits)

**Files:** Modify `src/app/activity-log-panel.tsx`.

- [ ] **Step 1: Migrate** — READ the file. Apply the shared mapping table.
- [ ] **Step 2: Named status edits**:
  - Delete-confirm input border (~183): `border-red-500 focus:border-red-500 focus:ring-red-500 dark:border-red-500` → `border-AIPM-pink focus:border-AIPM-pink focus:ring-AIPM-pink`
  - Caption below input (~188): `text-[10px] text-red-600 dark:text-red-400` → `text-[10px] text-AIPM-pink`
- [ ] **Step 3: Grep-verify** — both regexes return ZERO; duplicate-utility scan clean.
- [ ] **Step 4: Gates** — `npx vitest run activity-log-panel`; `npx tsc --noEmit` (0); `npm run lint` (0).
- [ ] **Step 5: Commit**
```bash
git add src/app/activity-log-panel.tsx
git commit -m "style(palette): activity-log-panel to surface tokens; delete-confirm red->pink"
```

---

## Task 6: `storage-config.tsx` (173 lines — 4× amber hints + 1 red)

**Files:** Modify `src/app/storage-config.tsx`.

- [ ] **Step 1: Migrate** — READ the file. Apply the shared mapping table.
- [ ] **Step 2: Named status edits**:
  - 4× amber hint `<p>`/`<span>`: `text-xs text-amber-700 dark:text-amber-400` → `text-xs text-AIPM-purple` (and the `ml-1` variant becomes `ml-1 text-AIPM-purple`)
  - Red error `<p>`: `text-xs text-red-600 dark:text-red-400` → `text-xs text-AIPM-pink`
- [ ] **Step 3: Grep-verify** — both regexes return ZERO; duplicate-utility scan clean.
- [ ] **Step 4: Gates** — `npx vitest run storage-config`; `npx tsc --noEmit` (0); `npm run lint` (0).
- [ ] **Step 5: Commit**
```bash
git add src/app/storage-config.tsx
git commit -m "style(palette): storage-config to surface tokens; amber->purple, red->pink"
```

---

## Task 7: `notifications.tsx` (277 lines — today badge amber→green)

**Files:** Modify `src/app/notifications.tsx`.

- [ ] **Step 1: Migrate** — READ the file. Apply the shared mapping table.
- [ ] **Step 2: Named status edit** (~line 19): the `today` entry of the badge-color record:
  - `today: "bg-amber-500 text-white"` → `today: "bg-AIPM-green text-white"`
  (today = green, consistent with the calendar's today-column decision)
- [ ] **Step 3: Grep-verify** — both regexes return ZERO; duplicate-utility scan clean.
- [ ] **Step 4: Gates** — `npx vitest run notifications`; `npx tsc --noEmit` (0); `npm run lint` (0).
- [ ] **Step 5: Commit**
```bash
git add src/app/notifications.tsx
git commit -m "style(palette): notifications to surface tokens; today badge amber->green"
```

---

## Task 8: `voice-button.tsx` (194 lines — recording-pulse indicator)

**Files:** Modify `src/app/voice-button.tsx`.

- [ ] **Step 1: Migrate** — READ the file. Apply the shared mapping table.
- [ ] **Step 2: Named status edits**:
  - Recording-pulse bg (~105): `animate-pulse bg-red-100 text-red-600 dark:bg-red-950/40 dark:text-red-400` → `animate-pulse bg-AIPM-pink/15 text-AIPM-pink dark:bg-AIPM-pink/20`
  - Inline recording text (~187): `animate-pulse text-red-600 dark:text-red-400` → `animate-pulse text-AIPM-pink`
- [ ] **Step 3: Grep-verify** — both regexes return ZERO; duplicate-utility scan clean.
- [ ] **Step 4: Gates** — `npx vitest run voice-button`; `npx tsc --noEmit` (0); `npm run lint` (0).
- [ ] **Step 5: Commit**
```bash
git add src/app/voice-button.tsx
git commit -m "style(palette): voice-button to surface tokens; recording red->pink"
```

---

## Task 9: `read-only-mirror-banner.tsx` (16 lines, amber banner)

**Files:** Modify `src/app/read-only-mirror-banner.tsx`.

- [ ] **Step 1: Named edit** — the banner element's full className:
  - `mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800` → `mb-3 rounded-md border border-AIPM-purple/40 bg-AIPM-purple/10 px-3 py-2 text-sm text-AIPM-purple`
- [ ] **Step 2: Grep-verify** — both regexes return ZERO.
- [ ] **Step 3: Gates** — `npx vitest run read-only-mirror-banner` (or `npx vitest run read-only` if no dedicated test); `npx tsc --noEmit` (0); `npm run lint` (0).
- [ ] **Step 4: Commit**
```bash
git add src/app/read-only-mirror-banner.tsx
git commit -m "style(palette): read-only-mirror-banner amber->purple (warning)"
```

---

## Task 10: Small chrome-only files (grouped — 7 files)

**Files:** Modify `src/app/effort-progress-bar.tsx` (43), `src/app/page.tsx` (15), `src/app/error.tsx` (67), `src/app/markdown.tsx` (313), `src/app/help-menu.tsx` (332), `src/app/version-menu.tsx` (119), `src/app/export-menu.tsx` (146) — 7 files, 1035 LOC, all chrome-only.

- [ ] **Step 1: Migrate** — READ each file in turn. Apply the shared mapping table. If any stray red/amber appears in any file, map per the standard rule (red→`AIPM-pink`, amber→`AIPM-purple`). Edit one file at a time; do not batch edits across files in a single Edit call.
- [ ] **Step 2: Grep-verify** — on EACH of the 7 files individually, both regexes return ZERO; duplicate-utility scan clean.
- [ ] **Step 3: Gates** — `npx vitest run effort-progress-bar markdown help-menu version-menu export-menu` (whichever have tests); `npx tsc --noEmit` (0); `npm run lint` (0).
- [ ] **Step 4: Commit**
```bash
git add src/app/effort-progress-bar.tsx src/app/page.tsx src/app/error.tsx src/app/markdown.tsx src/app/help-menu.tsx src/app/version-menu.tsx src/app/export-menu.tsx
git commit -m "style(palette): small chrome files to surface tokens (effort-progress-bar, page, error, markdown, help/version/export menus)"
```

---

## Task 11: Release 0.16.0 "Butler" (the headline)

**Files:** `src/app/version.ts`, `src/app/i18n.ts`, `src/app/i18n.de.ts`, `CHANGELOG.md`, `docs/DESIGN-TOKENS.md`.

- [ ] **Step 1: version.ts** — READ. Set `export const APP_VERSION = "0.16.0";` (currently "0.15.7"). Update build-date codename to `export const APP_BUILD_DATE = "2026-05-28"; // Butler milestone`. **Append** `"versionHighlightPalette"` as the LAST entry of `APP_HIGHLIGHT_KEYS` (minor adds the highlight). Add a top comment above the existing `// 0.15.7 …` block:
```ts
// 0.16.0 "Butler" completes the AIPM palette rollout: the design system covers
// every panel, modal, menu, and chrome surface. Surface tokens (light/dark),
// green accent, dark-blue fills, no shadows or gradients. Closes sub-project E.
```

- [ ] **Step 2: i18n highlight strings** — add `versionHighlightPalette` to BOTH dictionaries (the German dict is typed `Record<TranslationKey, string>` so all keys are required):
  - `src/app/i18n.ts` (`enUS`), next to the other `versionHighlight*` keys:
```ts
  versionHighlightPalette: "Full AIPM palette rollout: surface tokens (light/dark), green accent, dark-blue fills, no shadows or gradients.",
```
  - `src/app/i18n.de.ts`:
```ts
  versionHighlightPalette: "Vollständige AIPM-Palette: Surface-Tokens (hell/dunkel), grüner Akzent, dunkelblaue Füllungen, keine Schatten oder Verläufe.",
```

- [ ] **Step 3: CHANGELOG** — READ to match the existing style; add a new `[0.16.0]` entry directly ABOVE `[0.15.7]`:
```markdown
## [0.16.0] — 2026-05-28

### Changed
- **AIPM design-system rollout complete.** Every panel, modal, menu, and chrome surface in the app now uses the AIPM palette and the semantic surface tokens — consistent light/dark surfaces, green accent, dark-blue fills, no drop shadows or gradients. Status colours are mapped consistently across the app (errors/delete=pink, warnings/holds=purple, info/vacation=blue, positive/done=green). This release closes the design-system sub-project; the next release line returns to feature work.
```
(Match whatever format `[0.15.7]` actually uses if it differs.)

- [ ] **Step 4: DESIGN-TOKENS.md** — under "## Migration status (sub-project E)" add a final line:
```markdown
- E-sweep menus + chrome + misc (0.16.0): settings-menu, jira-settings, storage-config, export-menu, help-menu, version-menu, notifications, chat-panel, activity-log-panel, effort-progress-bar, error, markdown, page, voice-button, workspace-section, read-only-mirror-banner. ✅
```
Replace the existing "Remaining" line with:
```markdown
- ✅ **Sub-project E complete (0.16.0 "Butler")** — the AIPM design system covers the whole app.
```

- [ ] **Step 5: Verify** — `npx tsc --noEmit` (0); `npm run lint` (0); `npm run test:coverage` (green, lines ≥70%). Then `git status`; if `src/app/sample-workspace.md` is dirty, `git restore` it.

- [ ] **Step 6: Commit**
```bash
git add src/app/version.ts src/app/i18n.ts src/app/i18n.de.ts CHANGELOG.md docs/DESIGN-TOKENS.md
git commit -m "docs(release): 0.16.0 \"Butler\" — AIPM design-system rollout complete"
```

---

## Final review

Dispatch a final reviewer over `git diff main...HEAD`. Read `version.ts`/`CHANGELOG.md` directly. Confirm:
- `APP_VERSION === "0.16.0"`; `APP_HIGHLIGHT_KEYS` now ends with `"versionHighlightPalette"`; build date `"2026-05-28"` with `// Butler milestone`.
- `versionHighlightPalette` exists in BOTH `i18n.ts` and `i18n.de.ts` (tsc would fail otherwise — confirm).
- Real `[0.16.0]` CHANGELOG entry above `[0.15.7]`, same style.
- DESIGN-TOKENS migration status: this final chunk's line present; "Remaining" replaced by "Sub-project E complete" marker.
- For EACH of the 16 in-scope files, run BOTH verification regexes → ZERO matches each.
- Named edits landed: settings-menu (3 spots), chat-panel (consent card + error + selected), notifications (today=green), read-only-mirror-banner (purple), storage-config (4 amber + 1 red), voice-button (recording = pink), activity-log-panel (delete-confirm = pink).
- Heading pairs (`text-AIPM-dark-blue dark:text-AIPM-light-grey`) and primary fills (`bg-AIPM-dark-blue text-white`) preserved.
- Class-strings only (plus the 3 named record/literal edits and the version + i18n string + CHANGELOG + DESIGN-TOKENS).
- Full suite green; tsc 0; lint 0.

Then use `superpowers:finishing-a-development-branch`.

---

## Self-Review (author)

**Spec coverage:** 16 in-scope files mapped to tasks 1–10 (with 7 chrome-only files grouped into Task 10); the named status edits per the spec land in their respective tasks (settings-menu T1, chat-panel T2, activity-log-panel T5, storage-config T6, notifications T7, voice-button T8, read-only-mirror-banner T9); release + highlight key + i18n + CHANGELOG + DESIGN-TOKENS → Task 11. All spec items mapped.

**Placeholder scan:** No TBD/TODO; named edits are exact before→after strings. The "match `[0.15.7]` style" CHANGELOG note is a real source-confirmation. Task 10 instructs handling any stray red/amber per the standard rule — not a placeholder because the rule itself is documented (red→`AIPM-pink`, amber→`AIPM-purple`) and the grep at the end catches anything missed.

**Type consistency:** All token utilities resolve (palette + E0 surface tokens). The new i18n key `versionHighlightPalette` must be added to BOTH dicts (Task 11 Step 2) — `TranslationKey = keyof typeof enUS` so the German dict (`Record<TranslationKey, string>`) is type-required to include it. The `versionHighlightPalette` value also must be appended to `APP_HIGHLIGHT_KEYS` (Task 11 Step 1) — the array is `as const`, and `version-menu.tsx` already iterates it for the highlights popover, so just appending the string literal is sufficient (no type-level changes needed).
