# EVM→RAG + UI Polish (v0.46.0 "Banks") — Design

**Date:** 2026-06-02
**Status:** Approved design (pre-implementation)

## Goal

A polish batch with one behavior change (the deferred EVM→RAG follow-up) plus four
small UI/docs improvements, shipped as v0.46.0 "Banks".

## 1. EVM thresholds folded into the dashboard RAGs (`dashboard.ts`)

The only real logic. SPI feeds the Schedule RAG, CPI feeds the Budget RAG, both
worst-of with the existing signals; manual overrides still win.

- Constants: `EVM_INDEX_AMBER = 0.9`, `EVM_INDEX_RED = 0.8`.
- `evmIndexHealth(index: number | null): "R" | "A" | null` — `R` if `< 0.8`,
  `A` if `< 0.9`, else `null` (healthy / undefined ⇒ no contribution).
- A small rank helper combines health values: `R=3, A=2, G=1, null=0`; result is
  the health at the max rank present, or `null` if all absent.
- **Schedule** = worst-of(task schedule `G/A/R`, milestone contribution `R/A/null`,
  `evmIndexHealth(spi)`). Always non-null (task schedule defaults `G`).
- **Budget** = worst-of(budget-from-buckets `Health|null`, `evmIndexHealth(cpi)`).
  CPI may turn a blank Budget pill Amber/Red even when no budget buckets exist
  (decision: CPI is an effort-cost measure independent of buckets).
- No UI restructure: the existing SPI/CPI burn-band tiles stay; the top RAG pills
  now reflect EVM through the computed values.

**Tests (`dashboard.test.ts`):** SPI 0.75 → Schedule R; CPI 0.85 with no budgets →
Budget A (not null); healthy indices → no RAG change; manual override still wins.

## 2. Clickable sidebar version → version-history modal

- Extract `VersionMenu`'s panel body (version/build + per-feature highlights +
  tech stack + AIPM footer) into shared `version-info.tsx` (`VersionInfo`).
  `VersionMenu` renders it inside its existing popover (DRY, no behavior change).
- The inert version line in `sidebar.tsx` becomes a `<button>` calling a new
  `onShowVersion?` prop. `ModernShell` owns the open state and renders a centered
  modal (backdrop + Esc / click-out close) wrapping `VersionInfo`.

## 3. Double help window initial size (`help-menu.tsx`)

`h-[480px] w-[560px]` → `h-[960px] w-[1120px]`; update the 560/480 initial-
placement fallbacks to 1120/960. Existing `maxHeight`/`maxWidth` caps keep it on
screen; saved user sizes are untouched.

## 4. Settings version + license links (`SettingsView` footer)

A bottom footer row: a **Version** link (opens the `VersionInfo` modal) and a
**License: Apache-2.0 ↗** link → `https://opensource.org/license/Apache-2.0`
(`LICENSE` + `package.json` already say Apache-2.0). The same license link is
added to the help-menu footer beside the policy link. New i18n keys (EN+DE):
`versionLicense`, `settingsAbout`.

## 5. Docs

- `version.ts`: 0.46.0 / "Banks", build 2026-06-02, new top comment block, one
  new `versionHighlight*` key.
- `CHANGELOG.md`: new `## [0.46.0]` section. `package.json`: `version` → 0.46.0.
- `README`: version line + feature notes. `docs/CODEMAPS/*`: version stamps.

## Out of scope

- No new persisted state; EVM stays purely derived.
- Classic settings popover keeps its existing `VersionMenu` header access (no
  separate footer there).

## Shipping

Branch `feat-evm-rag-ui-polish` off `main`; implement inline with TDD on the
dashboard logic; `tsc` + `lint` + `test:run`; code-review pass; merge to local
`main` and push to GitLab origin.
