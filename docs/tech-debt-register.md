# Tech Debt Register

> Living doc. Every entry has an owner + review date. Review quarterly. Folklore dies here.
> Supersedes `tech-debt-register-inputs.md` (migrated + deleted in Phase 4).

Owners are role placeholders (`tech-lead` / `security-lead`) pending assignment. Review
dates are quarterly from creation; next sweep **2026-10-03**.

## Open items

| ID | Item | Origin | Owner | Review by | Notes |
|---|---|---|---|---|---|
| TD-1 | Forked Next.js pinned — upgrade path unowned | Roadmap A7 | tech-lead | 2026-10-03 | Explicitly out of scope; pinned unless a CVE forces action. |
| TD-2 | Six-write-path persistence — full storage rewrite deferred | Phase 3 T10 | tech-lead | 2026-10-03 | `entity-persistence-registry.test.ts` mitigates (CSV+MD+Turso columns for `outlookEventId`); a unified codec/schema rewrite remains out of scope. |
| TD-3 | Auto-pull re-creates a pruned event when the entity is still pushable | v0.164 (SP5) | tech-lead | 2026-10-03 | Documented SP5 limit; a permanent per-item opt-out is future work. |
| TD-5 | `task-manager.tsx` residual size > 800 lines | Phase 3 T5 | tech-lead | 2026-10-03 | Deliberate — orchestrator glue after 5 move-only extractions; further splitting = pass-through modules (YAGNI). Higher-leverage future move: consolidate top-level hooks/effects, not slice the render tree. See `tech-debt-register-inputs.md` history in git. |
| TD-6 | Duplication ≈ 2.61% total / tsx 2.83% (gate at 3.3%) — not yet ≤50% of the Phase 1 baseline | Phase 3/4 | tech-lead | 2026-10-03 | **Progress 2026-07-03:** extracted the shared `SavedViewsMenu` (the select+save+delete shell duplicated across `panel-views-control`/`saved-views-control`/`reports-views-control` — the top 3 clones, ~133 lines) → total 2.83%→**2.61%**, tsx 3.24%→**2.83%**; gate ratcheted 3.7→**3.3**. Remaining top clusters (own effort): the change/raid/stakeholder edit-modal chip sections + intra-file self-clones (raid-report-panel, change-report-panel, voice-button). The ≤50% roadmap target is a repo-wide halving, not single-extraction-achievable. Keep ratcheting DOWN opportunistically. |

## Resolved

| ID | Item | Origin | Resolved | Notes |
|---|---|---|---|---|
| TD-4 | `sanitize*.ts` branch coverage 84.82% < the ≥90 pure-engine target | Phase 4 T2 | 2026-07-03 | `sanitize-branches.test.ts` added the validator reject/fallback/clamp arms → branch **95.70%** (lines 98.33%). Floor ratcheted to 94/95 in `vitest.config.ts`. Not faked. |
| Playwright + axe CI-image lockstep | `@playwright/test` 1.60→1.61.1, `@axe-core/playwright` 4.11.3→4.12.1 + e2e image `v1.60.0-jammy`→`v1.61.1-jammy` | Phase 4 held | 2026-07-03 | Client + image bumped together in one MR. Local verify: `playwright --version` 1.61.1, config parses (52 tests), tsc 0 (axe 4.12 types compatible). Real e2e/axe run validated at CI-time (the e2e stage gates the MR); `npx playwright install` in the job is the browser safety net. |
| `@tiptap/*` set 3.26.1→3.27.1 | held: bumping only react/starter-kit skewed sub-packages → TS2769 in `rich-text-editor.tsx` | Phase 4 held | 2026-07-03 | Bumped `@tiptap/react` + `@tiptap/starter-kit` to ^3.27.1; the stale `node_modules/@tiptap` subtree pinned the transitive core/pm at 3.26.1 → ERESOLVE, cleared by removing that subtree + reinstall so the whole `@tiptap/*` tree deduped uniform at 3.27.1 (lock restructured, lockfileVersion 3 unchanged; only 2 inconsequential non-tiptap transitives moved — `fsevents` patch/macOS-only, `@napi-rs/wasm-runtime` build transitive). Verified: tsc 0 (TS2769 gone), editor+comm-template tests 15/15, build clean. |

## Deferred major dependency upgrades (Phase 4 T4 — one major per MR)

Recorded from `npm outdated` 2026-07-02. Order: security → tooling → runtime. Update the
Status column as each lands or is blocked.

| Package | From | To | Status | Notes |
|---|---|---|---|---|
| `@azure/msal-browser` | 4.30.0 | 5.16.0 | ✅ LANDED (2026-07-03) | tsc+lint+build+unit green. Caveat: MSAL is mocked in unit tests — live M365 token flow needs a real-tenant smoke test (no CI tenant). |
| `typescript` | 5.9.3 | 6.0.3 | ✅ LANDED (2026-07-03) | tsc 0 errors (no stricter-check breakage), lint+build+unit green. |
| `jsdom` | 25.0.1 | 29.1.1 | ✅ LANDED (2026-07-03) | Layout-stub landmines hold; unit 5382/5382. |
| `@vitejs/plugin-react` | 4.7.0 | 6.0.3 | ✅ LANDED (2026-07-03) | Vitest transform + property suites green. |
| `eslint` | 9.39.4 | 10.6.0 | ⛔ BLOCKED | `eslint-config-next`'s bundled `eslint-plugin-react` calls `context.getFilename` (removed in eslint 10's flat-config API) → lint crashes. `eslint-config-next` is tied to the forked Next.js (A7, out of scope). Unblock requires upgrading eslint-config-next / the react plugin. Owner: tech-lead. |
| `@types/node` | 20.19.41 | 26.1.0 | ⏸ DEFERRED | Bump WITH the Node runtime — CI is `node:20`; v26 types on node 20 over-declare APIs. Land when the runtime moves off node 20. Owner: tech-lead. |

### Held — CI-image lockstep (bump both together in one MR)

_None — all held upgrades landed 2026-07-03 (see Resolved)._

### Range-pinned (no action — semver range holds them)

`next` (forked, A7 — never auto-bump), `eslint-config-next`, `react`, `react-dom` —
`Wanted == Current`; the latest is outside the pinned range by design.
