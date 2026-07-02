# Dead-Code Baseline — 2026-07 (Phase 1 Task 10)

**Date:** 2026-07-02 · **Tools:** `knip` (config `knip.json`) + `ts-prune` · Raw knip output: `knip-raw.txt`.

Two detectors, cross-referenced. A finding is **UNAMBIGUOUS** only when both tools agree AND a `grep` across `src` + `e2e` + dynamic `import()` confirms zero references. Everything else is deferred to Phase 2 review (AMBIGUOUS) or classified FALSE-POSITIVE with a reason.

## UNAMBIGUOUS (deleted this pass)

| Item | Kind | Evidence |
|---|---|---|
| `src/app/task-status-badge.tsx` (`TaskStatusBadge`) | unused file | knip "Unused files (1)"; ts-prune `task-status-badge.tsx:8`; grep across src+e2e+dynamic-import = 0 refs. The live status label path is `task-status-ui.ts` + `TaskStatusSelect`; this badge component was orphaned. |

## FALSE-POSITIVE (kept — reason recorded)

| Item(s) | Why kept |
|---|---|
| Next.js route handlers — every `api/**/route.ts` `POST`/`runtime`, `page.tsx`/`error.tsx`/`layout.tsx` `default`/`metadata`, `proxy.ts` `config`, `playwright.config`/`vitest.config` `default` | Framework entry points — consumed by Next.js/tooling by convention, not by an import. Never delete. |
| `sanitize.ts` barrel exports (`toNumber`, `sanitizeText`, `sanitizeMultiline`, …), `next-actions/index.ts` type re-exports (`ActionTier`/`ActionSource`/`ActionCta`), codec `*ToCsv`/`*ToMarkdown` (`storageMod`-tagged) | Barrel (`export *`) re-exports — the documented public surface (AGENTS.md "Sanitize/Codec module maps", ~37 importers). Byte-stable storage contract. ts-prune/knip don't trace barrel usage. |
| `next-actions/action-cta.ts` `can*` predicates (`canAssign`/`canClearBlocker`/`canReschedule`/`canRebaseline`/`canEscalate`/`canDraft`/`canMarkDone`/`canCreateTask`) | AGENTS.md: "the `can*` predicates live here, consumed by `action-row.tsx` AND `action-hero-card.tsx`". Likely reached via namespace/barrel import knip misses. Verify in Phase 2 before any touch. |
| devDep `tailwindcss` | Tailwind v4 auto-scans all files; not a JS import. Core build dependency. |
| `workspace-panels.tsx`, `export-ooxml.ts` | Explicitly ignored in `knip.json` — lazy `dynamic()` registry + `await import()` barrel (roadmap Phase 1 do-not-touch). |

## AMBIGUOUS — RESOLVED in Phase 2 Task 4 (2026-07-02): all false-positive

Every one of the ~55 remaining "unused export" hits was per-item verified with
`grep -rw <sym> src e2e scripts` + a dynamic-import check. **None is dead code.**
They fall into three live categories:

1. **Used in-module** — the symbol is consumed within its own file, so the `export`
   keyword is redundant but the code is live. Verified refs: `BUDGET_OVER_AMBER`
   (budget-health.ts:22), `QUADRANT_TARGET` (stakeholders.ts:53), `isFolder` (5×),
   `inputClass` (66×), `FormSection`/`Field`/`TaskFormSection`, `saveSchemes` (4×),
   `isValidDocumentLink`, `compareStrOrNum`, `applyFavicon`, `colDdl`,
   `migrateWorkspaceV8`, `APP_VERSION` (→ `APP_VERSION_LABEL`), the color/threshold
   consts (`EVM_INDEX_*`, `COST_PERF_*`, `MARGIN_GREEN_PCT`, `TIER_SOON`,
   `TREND_LOOKBACK`), the branding/calendar consts, etc.
2. **Barrel / byte-stable contract exports** — the `storageMod`-tagged codec
   functions (`*ToCsv`/`*ToMarkdown`), consumed via the `csv-codecs`/`markdown-codecs`
   barrels and the round-trip tests; knip doesn't trace `export *` re-exports.
3. **Test-only exports** — e.g. `parseCreds` (timelog), imported by its unit test.

**Decision:** keep all as-is. Removing 60 redundant `export` keywords would be
low-value churn that risks breaking the barrel/re-export patterns knip can't see,
for no runtime benefit. No `@public` markers added (they would be noise on 60
symbols). The codebase carries no ambiguous dead code — consistent with the single
unambiguous deletion in Phase 1 being the only real find.

Note: knip's export-analysis is unreliable here — it flagged `APP_VERSION` (release
infrastructure, used by `APP_VERSION_LABEL` in the same file) as unused. Treat future
knip "unused export" output as a review prompt, not a delete list.

## Baseline metrics
- Unused files: **1** (deleted).
- Unused exports flagged: **60** (1 unambiguous already covered by the file deletion; ~4 false-positive clusters; ~55 ambiguous → Phase 2).
- Unlisted dependency: `playwright` in `scripts/e2e-smoke.mjs` — it's a devDependency via `@playwright/test`; knip wants a direct listing. Low priority, note only.
