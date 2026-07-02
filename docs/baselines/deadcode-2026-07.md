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

## AMBIGUOUS (Phase 2 Task 4 — review before deleting)

The remaining ~55 "unused export" hits (color/threshold consts like `BUDGET_OVER_AMBER`, `EVM_INDEX_RED`, `QUADRANT_TARGET`; helper components `FormSection`/`Field`/`inputClass` in `*-form-fields.tsx`; `parseCreds` in `timelog/_helpers.ts`; `saveSchemes`; `isValidDocumentLink`; `isFolder`; `MAX_AI_ACTIONS`; etc.). Each needs the per-item `grep src e2e scripts` + dynamic-import check (Phase 2 Task 4 Step 1) — several are plausibly test-only exports or recently-orphaned consts. NOT touched in Phase 1.

Note: `parseCreds` (timelog) is exported for its unit test — likely a test-only export, keep or mark `@public`; decide in Phase 2.

## Baseline metrics
- Unused files: **1** (deleted).
- Unused exports flagged: **60** (1 unambiguous already covered by the file deletion; ~4 false-positive clusters; ~55 ambiguous → Phase 2).
- Unlisted dependency: `playwright` in `scripts/e2e-smoke.mjs` — it's a devDependency via `@playwright/test`; knip wants a direct listing. Low priority, note only.
