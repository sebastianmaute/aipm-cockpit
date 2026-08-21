# Palette Sweep — Menus + Chrome + Misc (0.16.0 "Butler") — Design

**Date:** 2026-05-28
**Status:** Approved (design); pending implementation plan
**Branch:** `feat/0.16.0-palette-sweep-menus-chrome`
**Context:** **FINAL** E-sweep chunk. Completes sub-project E. After this lands, the AIPM design system covers the entire app — version bumps to **0.16.0** with a new "Butler" codename and the `versionHighlightPalette` headline key. See [[design-system-batch]].

## Goal

Migrate the remaining ~16 menus + chrome + misc files (~3914 LOC) to the AIPM palette + surface tokens; ship as the headline release closing out sub-project E. No behavior/markup change beyond class strings.

## Scope (16 files)

`settings-menu.tsx`, `jira-settings.tsx`, `storage-config.tsx`, `export-menu.tsx`, `help-menu.tsx`, `version-menu.tsx`, `notifications.tsx`, `chat-panel.tsx`, `activity-log-panel.tsx`, `effort-progress-bar.tsx`, `error.tsx`, `markdown.tsx`, `page.tsx`, `voice-button.tsx`, `workspace-section.tsx`, `read-only-mirror-banner.tsx`.

## Mapping — the chunk pattern (same as prior chunks, hardened)

| Current utility | Replace with |
|---|---|
| `bg-white` | `bg-surface` |
| `bg-zinc-50/100`, `dark:bg-zinc-900/950` | `bg-surface-muted` |
| `border-zinc-200/300`, `dark:border-zinc-700/800`, `border-AIPM-light-grey` | `border-line` |
| `divide-zinc-*`, `divide-AIPM-light-grey` | `divide-line` |
| `bg-AIPM-light-grey`(`/NN`) (chrome bg) | `bg-surface-muted` |
| `shadow-*` | remove |
| `focus:ring-AIPM-dark-blue`/`focus-visible:ring-AIPM-dark-blue`/`ring-zinc-*` | `ring-AIPM-green` |
| `hover:bg-zinc-*`/`dark:hover:bg-zinc-*`/`hover:bg-AIPM-light-grey` | `hover:bg-surface-muted` |
| `text-zinc-900/800/700` (+ paired dark) | `text-foreground` |
| `text-zinc-500/600/400` (+ paired dark) | `text-muted-foreground` |
| `text-AIPM-dark-grey` (+ any paired `dark:text-AIPM-light-grey`) | `text-foreground` |
| `text-AIPM-medium-grey` (+ any paired dark) | `text-muted-foreground` |

**KEEP UNCHANGED:** `bg-AIPM-dark-blue text-white` fills; heading pairs `text-AIPM-dark-blue dark:text-AIPM-light-grey`; all AIPM accent colors; ALL non-class code.

**CRITICAL:** REPLACE each utility in place — never ADD a second color utility. No element may end with two `bg-*`, two `border-<color>`, two `divide-*`, or two `text-<color>` base utilities (variants like `hover:`/`dark:` are fine).

## Per-file named status edits

| File | Edits |
|---|---|
| **`settings-menu.tsx`** | Remove-country `×` button (~line 291): `text-zinc-500 hover:text-red-600 dark:text-zinc-400 dark:hover:text-red-400` → `text-muted-foreground hover:text-AIPM-pink`. AI-consent revoke link (~line 472): `text-xs font-medium text-red-600 underline-offset-2 hover:underline dark:text-red-400` → `text-xs font-medium text-AIPM-pink underline-offset-2 hover:underline`. AI-consent required hint (~line 478): `text-xs text-amber-700 dark:text-amber-400` → `text-xs text-AIPM-purple`. |
| **`chat-panel.tsx`** | Red error message (~315): `mt-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300` → `mt-2 rounded-md bg-AIPM-pink/10 px-3 py-2 text-sm text-AIPM-pink dark:bg-AIPM-pink/15`. **AI-consent card** (~375–416, a multi-element warning block): all amber-700/800/900 + amber-50/100/950 + amber-300/400/500/600 → `AIPM-purple` equivalents; card bg `bg-AIPM-purple/10 dark:bg-AIPM-purple/15`, border `border-AIPM-purple/40 dark:border-AIPM-purple/50`, headings/body `text-AIPM-purple` light, body softer `text-AIPM-purple/80` for paragraphs; checkbox `border-AIPM-purple/40 text-AIPM-purple focus:ring-AIPM-purple dark:border-AIPM-purple/50 dark:bg-AIPM-purple/15`; the **"I consent" primary button** (~416) becomes `bg-AIPM-purple text-white hover:bg-AIPM-purple/90 focus:outline-none focus:ring-2 focus:ring-AIPM-purple focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50` (drop `shadow-sm`, preserve the warning-tinted primary semantic). Selected-item red border (~446): `border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200` → `border-AIPM-pink/40 bg-AIPM-pink/10 text-AIPM-pink dark:border-AIPM-pink/50 dark:bg-AIPM-pink/15`. |
| **`notifications.tsx`** | `today` badge (~19): `bg-amber-500 text-white` → `bg-AIPM-green text-white` (today=green, matches calendar). |
| **`read-only-mirror-banner.tsx`** | Whole banner: `mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800` → `mb-3 rounded-md border border-AIPM-purple/40 bg-AIPM-purple/10 px-3 py-2 text-sm text-AIPM-purple` (read-only warning = warning purple; no dark variant present since the banner uses opacity blending). |
| **`storage-config.tsx`** | 4× amber hint text `text-xs text-amber-700 dark:text-amber-400` → `text-xs text-AIPM-purple`; inline `<span>` `ml-1 text-amber-700 dark:text-amber-400` → `ml-1 text-AIPM-purple`; one red error `text-xs text-red-600 dark:text-red-400` → `text-xs text-AIPM-pink`. |
| **`voice-button.tsx`** | Recording-pulse bg (~105): `animate-pulse bg-red-100 text-red-600 dark:bg-red-950/40 dark:text-red-400` → `animate-pulse bg-AIPM-pink/15 text-AIPM-pink dark:bg-AIPM-pink/20`. Inline recording text (~187): `animate-pulse text-red-600 dark:text-red-400` → `animate-pulse text-AIPM-pink`. |
| **`activity-log-panel.tsx`** | Delete-confirm input border (~183): `border-red-500 focus:border-red-500 focus:ring-red-500 dark:border-red-500` → `border-AIPM-pink focus:border-AIPM-pink focus:ring-AIPM-pink`. Caption (~188): `text-[10px] text-red-600 dark:text-red-400` → `text-[10px] text-AIPM-pink`. |
| **Other files** (`jira-settings`, `workspace-section`, `export-menu`, `help-menu`, `version-menu`, `error`, `markdown`, `page`, `effort-progress-bar`) | Chrome-only — apply the standard mapping. If any stray red/amber appears, map per the standard rule (red→`AIPM-pink`, amber→`AIPM-purple`). |

## Release: 0.16.0 "Butler" (the headline)

- `APP_VERSION = "0.16.0"`. New codename **"Butler"** (Octavia E.) — continues the Bradbury/Atwood/Le Guin author pattern.
- `APP_BUILD_DATE = "2026-05-28"; // Butler milestone`.
- **Append `"versionHighlightPalette"` as the LAST entry of `APP_HIGHLIGHT_KEYS`** (minor adds the highlight). Add the i18n string in BOTH `i18n.ts` (`enUS`) and `i18n.de.ts`:
  - EN: `"Full AIPM palette rollout: surface tokens (light/dark), green accent, dark-blue fills, no shadows or gradients."`
  - DE: `"Vollständige AIPM-Palette: Surface-Tokens (hell/dunkel), grüner Akzent, dunkelblaue Füllungen, keine Schatten oder Verläufe."`
- Top-of-file comment in `version.ts` recording the milestone.
- CHANGELOG `[0.16.0]` headline entry: the AIPM design system now covers the whole app.
- `docs/DESIGN-TOKENS.md`: update migration-status section — mark this final chunk done; replace the "Remaining" line with a "✅ Sub-project E complete (0.16.0)" line.

## Non-goals

- No behavior/layout/markup/prop change — class strings + the 3 named record/literal edits (notifications today, chat-panel consent button) only.
- No new tokens (E0 covered them).
- Sub-project **B** (resources-tab styling unification) is separate and follows E.

## Edge cases

- **chat-panel consent button is a primary (filled) action**, not a soft chip. Keeping it `bg-AIPM-purple text-white` (rather than the standard dark-blue primary) preserves the original "weighty consent" semantic — purple = warning, filled = primary action. The destructive-button recipe is *outlined* (border + soft bg); this is the only purple-filled primary in the app.
- **chat-panel consent body text** uses `text-amber-900/80` (80% alpha) — map to `text-AIPM-purple/80` to preserve the softer body tone.
- **notifications today badge** changing from amber→green is a deliberate alignment with the calendar's today=green decision; both surfaces now agree.
- **markdown.tsx** is a prose-rendering wrapper — it may have many text-color tokens; apply the standard mapping but watch for `prose` plugin colors that aren't Tailwind palette shades (they shouldn't match the grep).

## Testing

- Each file's existing tests stay green (behavior, not classes).
- **Per-file verification grep** → ZERO for both regexes (the standard zinc/shadow/color-shade + chrome-AIPM-light-grey/dark-grey/medium-grey patterns).
- Duplicate-utility scan per file.
- Full suite green; tsc 0; lint 0; `test:coverage` ≥ 70%.

## Release (recap)

Minor → **0.16.0 "Butler"** with the **`versionHighlightPalette` highlight key** (EN + DE). The final E-sweep chunk that closes out sub-project E. After this:
- `docs/DESIGN-TOKENS.md` migration status: all chunks ✅, remaining list replaced by `Sub-project E complete (0.16.0)`.
- The next outstanding work is sub-project **B** (resources-tab styling unification to workload).
