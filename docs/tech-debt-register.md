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
| TD-6 | Duplication ≈ 2.21% total / tsx 2.28% (binding) / typescript 2.14% (gate at 2.7%) — not yet ≤50% of the Phase 1 baseline | Phase 3/4 | tech-lead | 2026-10-03 | **Progress 2026-07-03:** (1) shared `SavedViewsMenu` (3 views-controls shell) → total 2.83%→2.61%, tsx 3.24%→2.83%; gate 3.7→3.3. (2) `edit-modal-chrome.tsx` (`ModalFieldError`/`StakeholderChipPicker`/`ModalEditFooter`, top cross-file edit-modal clones) → total 2.61%→2.52%, tsx 2.83%→2.65%; gate 3.3→3.1. (3) `SortResizeTh<K>` in `report-table.tsx` (the sortable+resizable `<th>` trio) — converted **56** call sites across raid-report (34) / resources-report (16) / change-report (6) → total 2.52%→**2.42%**, tsx 2.65%→**2.46%** (tokens 3.29%→2.83%); gate 3.1→2.9. (4) adopted the EXISTING `usePopoverDismiss` hook in 6 menus (ask-claude/project-switcher/version/export/template/settings) — removed the duplicated outside-click+Escape effect → total 2.42%→**2.32%**, tsx 2.46%→**2.28%**; gate 2.9→2.8. (5) generic `decodeCsvSection<T>(csv, build)` helper in `csv-codecs-decode.ts` — collapsed the 6 identical per-entity header-scan decode loops (absences/shifts/milestones/changes/stakeholders/raid; `csvToTasks` diverges, kept bespoke) → typescript 2.38%→**2.14%**, total 2.32%→**2.21%**; gate 2.8→**2.7**. ★ this dropped typescript BELOW tsx again — binding **flipped back to tsx 2.28%**; the two formats leapfrog, so the gate is always bounded by max(tsx, ts). Byte-stable (golden + property + 635 codec/storage tests green). Remaining clusters (own effort): the SAME header-scan pattern in `markdown-codecs-decode` (ts, won't move a tsx-bound gate), report BODY-row self-clones (tsx), `voice-button` (tsx), the change-panel↔raid/stakeholder/milestones-panel toolbar families (tsx, divergent — higher risk), Jira API-route boilerplate + Turso schema-DDL clones (ts, security/data-integrity-adjacent — higher risk). ★★ **OPPORTUNISTIC-RATCHET PHASE PAUSED after slice 5 (2026-07-03):** every LOW-RISK cross-file extraction is done (gate 3.7→2.7 this session). What remains needs dedicated effort with real risk — a shared scaffold for divergent entity panels, or factoring security/data-integrity-adjacent code (API routes, schema DDL) — so it's a deliberate future task, NOT more opportunistic single-extractions. The ≤50% roadmap target (repo-wide halving) is not reachable by further single extractions; it needs that structural effort. Ratchet the gate DOWN only when a real reduction lands. |

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
