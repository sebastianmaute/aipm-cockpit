# Tech-Debt Register Inputs (Phase 1 → migrated into the living register in Phase 4)

> Scratchpad for items parked during Phase 1. Phase 4 Task 7 migrates these into `docs/tech-debt-register.md` and deletes this file.

## Deferred major dependency upgrades (Phase 4 Task 4 — one MR each)

Recorded from `npm outdated` on 2026-07-02. Order: security-relevant → tooling → runtime.

| Package | Current | Latest major | Notes |
|---|---|---|---|
| `@azure/msal-browser` | 4.30.0 | 5.16.0 | auth lib — review changelog for breaking token-cache/API changes; test M365 flows |
| `eslint` | 9.39.4 | 10.6.0 | pairs with `eslint-config-next` support for v10; check flat-config compat |
| `typescript` | 5.9.3 | 6.0.3 | run full `tsc --noEmit` + build; watch for stricter checks |
| `jsdom` | 25.0.1 | 29.1.1 | test env — verify the layout-stub landmines still hold |
| `@vitejs/plugin-react` | 4.7.0 | 6.0.3 | vitest transform — verify property suites |
| `@types/node` | 20.19.41 | 26.1.0 | align with the Node runtime (CI is node:20 image; a v26 types on node 20 may over-declare APIs — bump with the runtime, not before) |

## Held — CI-image lockstep (NOT a major, but paired)

| Package | Current | Wanted | Why held |
|---|---|---|---|
| `@playwright/test` | 1.60.0 | 1.61.1 | CI e2e image is pinned `mcr.microsoft.com/playwright:v1.60.0-jammy`. Bumping the client without the image tag drifts them (documented lockstep, AGENTS.md). Bump both together in one MR. |
| `@axe-core/playwright` | 4.11.3 | 4.12.1 | peers on `@playwright/test`; bump alongside the playwright pair to avoid peer drift. |
| `@tiptap/react` + `@tiptap/starter-kit` | 3.26.1 | 3.27.1 | bumping to 3.27 skews the tiptap sub-packages → `tsc` error TS2769 in `rich-text-editor.tsx` (`Extension<StarterKitOptions>` not assignable to `AnyExtension`). Needs a coordinated bump of the whole `@tiptap/*` set; reverted in Phase 1. |

## Range-pinned (no action — semver range holds them)

`next` (forked, A7 — never auto-bump), `eslint-config-next`, `react`, `react-dom` — all report `Wanted == Current`; the latest is outside the pinned range by design.
