# Technical Debt Remediation Roadmap — lop-app

**Date:** 2026-07-02 · **Baseline commit:** `main` after MR !170 (v0.164 "Cixin")
**Author role:** Senior software architect

---

## Executive Summary

lop-app is in unusually good shape for a codebase of its size (546 source files, ~94k LOC): zero known dependency vulnerabilities, a 1:1 test-to-source file ratio with a ~70% coverage gate, secrets encrypted at rest, SSRF-guarded API proxies, and a CI pipeline (GitLab,  (GitLab)) that already enforces lint-zero-warnings, typecheck, unit, build, and an axe accessibility gate. The dominant debt is therefore **structural, not security-critical**: a 2,840-line root orchestrator (`task-manager.tsx`) that has absorbed every cross-cutting hook and now threads props through 4–5 layers; six sibling entity panels (RAID, changes, milestones, stakeholders, resources, tasks) that have copy-pasted the same toolbar/filter/bulk-edit/calendar-sync wiring with local drift; and per-entity persistence code that must be edited in six places per new field. This roadmap sequences four phases over ~16 weeks: a short security re-verification and quick-wins phase first (weeks 1–2), characterization-test scaffolding plus code-level refactoring (weeks 3–6), the high-risk decomposition of `task-manager.tsx` and panel deduplication (weeks 7–12), and best-practice consolidation with ratcheted quality gates (weeks 13–16). Every phase is gated on the existing CI staying green and golden byte-stability fixtures staying untouched except where a format change is deliberate.

---

## Measured Baseline (verified 2026-07-02, not assumed)

| Metric | Value | Source |
|---|---|---|
| Source files (non-test) | 546 | `find src` |
| Test files (unit + property + e2e) | 555 | `find src e2e` |
| Total src LOC | ~94,000 | `wc -l` |
| Largest module | `task-manager.tsx` — 2,840 lines | measured |
| Files > 800-line project limit | 4 (`i18n.ts` 3053, `i18n.de.ts` 2974 — dictionaries, exempt; `task-manager.tsx` 2840; `workspace-section.tsx` 1009) | measured |
| Files 600–800 lines (watch list) | ~18 (raid-panel 905, tasks-section 799, resources-panel 786, chat-panel 743, timelog-panel 742, change-edit-modal 718, …) | measured |
| npm audit vulnerabilities | 0 (info/low/moderate/high/critical all 0) across 719 deps | `npm audit` |
| Coverage gate | ~70% (vitest) | vitest config / repo memory |
| CI quality gates | lint `--max-warnings=0`, `tsc --noEmit` (incl. i18n EN/DE key parity), unit, build, e2e incl. 39-pass axe gate (13 views × 3 themes) | `.gitlab-ci.yml` / AGENTS.md |

**Stated assumptions (context missing — verify before committing tickets):**

- **A1:** No duplication baseline exists. Duplication % figures below are *targets to be set after* a `jscpd` baseline run (Phase 1 task), not current measurements.
- **A2:** No formal threat model document exists in the repo.
- **A3:** SAST beyond ESLint is not currently in CI (no Semgrep/CodeQL job observed in the pipeline description).
- **A4:** DAST has never been run against a deployed instance. The app is client-heavy (browser calls Anthropic/Graph/Turso directly; thin Next.js proxy routes for Jira/Confluence/Timelog), so DAST scope is small but non-zero (`/api/*` routes, CSP, headers).
- **A5:** Team size unknown. Durations assume **2 engineers ~70% allocated**; scale accordingly.
- **A6:** "Dead code" volume unknown until knip/ts-prune baseline (Phase 1 task).

---

## Prioritization Rationale — Effort vs. Impact

| Workstream | Effort | Impact | Priority | Rationale |
|---|---|---|---|---|
| 3. Security review | **Low** | **High** | **P0 — Phase 1** | Cheap to verify; catastrophic if a real gap hides behind the "already hardened" assumption. Mostly confirmation work (audit=0 today), plus threat-model doc + SAST gate that pay compounding dividends. |
| 4. Hardening | **Low–Med** | **Med** | **P0/P1 — Phase 1–2** | Most hardening already shipped (secrets-at-rest, SSRF allowlists, CSP, sanitize.ts at boundaries). Remaining work is closing enumerated residual gaps + secure-defaults sweep, not greenfield. |
| 1. Refactoring | **Med** | **Med** | **P1 — Phase 2** | Dead-code removal and naming cleanup de-risk and shrink the decomposition that follows. Do it *before* decomposition so you don't carefully decompose code that should be deleted. |
| 6. Best-practice adoption | **Low** | **Med** | **P1 + continuous** | CI gates are the ratchet that locks in every other workstream's gains. Cheap to add incrementally (duplication gate, coverage ratchet, file-size gate). Started in Phase 1, finished in Phase 4. |
| 2. Decomposition | **High** | **High** | **P2 — Phase 3** | Biggest payoff (velocity, reviewability, agent-editability of `task-manager.tsx`) but highest regression risk. Must come *after* characterization tests and dead-code removal. |
| 5. Deduplication | **Med–High** | **High** | **P2 — Phase 3** | The six-panel copy-paste family and the six-write-path persistence pattern are the top sources of "miss one site" bugs (a documented recurring landmine class). Consolidate during decomposition while the same files are open. |

**Sequencing logic:** security first (verify, don't assume) → tests-as-safety-net → cheap cleanup → risky structural work behind the net → lock in with gates.

---

## Phase 1 — Security Verification & Quick Wins (Weeks 1–2)

**Objectives:** Independently confirm the security posture instead of trusting accumulated convention; establish the measurement baselines (duplication, dead code, bundle) every later phase is scored against; land zero-risk quick wins.

**Owner role:** Security-lead engineer (workstreams 3–4) + one engineer on tooling baselines.

### Tasks (sprint-ticket granularity)

**Security review (WS3):**
1. Write `docs/security/threat-model.md`: STRIDE pass over the five trust boundaries — browser↔Anthropic (direct), browser↔MS Graph/MSAL, browser↔Turso, browser↔`/api/jira|confluence|timelog` proxies, and localStorage/IndexedDB at-rest surface. Enumerate assets (API keys, Turso tokens, Jira tokens, workspace data) and existing mitigations per boundary.
2. Add SAST job to `.gitlab-ci.yml`: Semgrep with `p/typescript`, `p/react`, `p/owasp-top-ten` rulesets, warn-only for 2 weeks, then blocking on new findings (baseline file committed).
3. Add `npm audit --omit=dev --audit-level=high` as a blocking CI job + a scheduled weekly pipeline for full audit (catches new CVEs between MRs).
4. Manual findings triage doc: review the three proxy routes (`api/jira/_helpers`, confluence, timelog) against their allowlist/private-IP/CRLF guards; review `secrets.ts` key-wrapping; review `isSafeHttpUrl` call sites for any URL sink that bypasses it. Output: `docs/security/findings-2026-07.md` with severity-tagged findings (CRITICAL/HIGH/MEDIUM/LOW).
5. One-time DAST smoke: run OWASP ZAP baseline scan against a local `next build && next start` instance; triage into the same findings doc. (Scope per A4: headers, CSP, `/api/*` only.)

**Hardening (WS4):**
6. Secure-defaults sweep ticket: grep every integration `enabled` flag and confirm default-off (AI master switch already default-off; verify Jira/Timelog/M365/calendar-auto parity).
7. Verify secrets never hit exports/Turso/logs: extend the existing guard tests with one test asserting `lop-app:secrets` ciphertext and all four `SecretId` plaintexts are absent from every serializer output (JSON/CSV/MD) on a workspace containing configured integrations.
8. Rate-limit review on the three proxy scopes: confirm per-scope limits exist and add a test per route for 429 behavior.

**Baselines & quick wins (WS1/5/6):**
9. Run `npx jscpd src --min-tokens 50 --reporters json,console`, commit report to `docs/baselines/jscpd-2026-07.json`. Record duplication % — this number sets Phase 3 targets.
10. Run `npx knip` + `npx ts-prune`; commit report. Delete only the *unambiguous* hits (unexported-and-unreferenced) as the first quick-win MR — expect low-risk wins given 546-file breadth.
11. Add CI file-size gate: warn-only script failing on new files > 800 lines and on any file *growing* past its recorded size if already > 600 (ratchet, exempting `i18n*.ts`). Prevents the debt growing while it's being paid down.
12. Quick win: `npm outdated` review + patch/minor bumps only (majors deferred to Phase 4), verified by full CI.

### Entry criteria
- Main green; v0.164 merged (done).

### Exit criteria
- Threat model + findings doc merged; **all CRITICAL findings fixed, HIGH triaged with owners and phase assignment**.
- Semgrep + audit jobs live in CI (warn-only acceptable for Semgrep).
- jscpd/knip baselines committed; file-size ratchet live.

### Success metrics
- npm audit high/critical: **0** (currently 0 — keep it, now enforced by CI instead of by luck).
- Semgrep new-code findings: **0 blocking** after grace period.
- CRITICAL findings open: **0**; HIGH findings: all ticketed.
- Duplication %: **measured** (baseline established, per A1).

### Risks & mitigations
- *Risk:* ZAP/Semgrep flood of false positives stalls the phase. → Timebox triage to 2 days; anything not triaged becomes a ticket, not a blocker; baseline-file approach means only *new* findings ever block.
- *Risk:* Dead-code deletion breaks a dynamic/lazy import knip can't see (`dynamic(ssr:false)` panels, `await import(...)` barrels). → Only delete unambiguous hits; full CI incl. e2e must pass; the `workspace-panels.tsx` lazy registry and `export-ooxml` barrel are explicitly on the do-not-touch list this phase.

---

## Phase 2 — Safety Net + Code-Level Refactoring (Weeks 3–6)

**Objectives:** Build the characterization-test net around the modules Phase 3 will break apart; finish dead-code and naming cleanup; close HIGH security findings from Phase 1.

**Owner role:** Tech-lead engineer (refactoring) + security-lead (findings burn-down).

### Tasks

**Characterization tests (prerequisite for Phase 3 — WS6 serving WS2):**
1. Snapshot-style characterization suite for `task-manager.tsx` orchestration seams: for each of the ~12 cross-cutting hooks it mounts (auto-sync runners, pull hooks, scheduled jobs, tour, dispatcher…), one test pinning *what props/handlers reach the child layer* for a representative workspace. These tests are deliberately coarse — they exist to scream during Phase 3 extraction, then get replaced by focused tests on the extracted hooks.
2. Same for `workspace-section.tsx` (1,009 lines): a routing table test asserting view-id → rendered-panel + threaded-prop-set for all ~20 views.
3. Raise the vitest coverage gate 70% → 75% (ratchet step 1). Fill gaps only in files Phase 3 will touch (raid-panel, tasks-section, resources-panel, change-panel) — targeted, not shotgun.

**Refactoring (WS1):**
4. Second knip/ts-prune pass: now delete the *reviewed-ambiguous* hits from Phase 1's report (one MR per cluster, file-disjoint, parallelizable per the established subagent batch workflow).
5. Naming-consistency sweep, mechanical only: enforce the documented conventions (`is/has/should/can` booleans, `use*` hooks) via an ESLint naming rule set to warn; fix warnings in files already being touched. **No behavior change; no renames of exported/persisted identifiers** (CSV/MD column names and localStorage keys are byte-stable contracts — explicitly out of scope).
6. Extract magic numbers in touched files to named consts (existing convention: `STALE_DAYS`, `MAX_PER_BUCKET` style).
7. Delete commented-out code blocks and stale TODOs repo-wide (grep-driven ticket, trivially reviewable).

**Hardening finish (WS4):**
8. Fix all HIGH findings from Phase 1 triage. (Content unknown until triage — placeholder sized at 1 engineer-week per A5.)
9. Input-validation audit delta: confirm every `/api/*` route and every AI-tool-call path routes through `sanitize.ts` validators; add the missing ones. (`parseAnalysis`/`groundEntity`/`parseWeightSuggestions` pattern is the template.)

### Entry criteria
- Phase 1 exit criteria met; CRITICALs closed.

### Exit criteria
- Characterization suites for `task-manager.tsx` + `workspace-section.tsx` merged and green.
- knip/ts-prune reports clean (or remaining items documented as intentional with inline `@public` markers).
- Coverage gate at 75% and green.
- HIGH security findings: 0 open.

### Success metrics
- Coverage: **≥ 75%** enforced.
- Dead-code detector findings: **0 unexplained**.
- HIGH vulns open: **0**.
- LOC deleted (dead code): report actual number (expect four digits; verify against A6).

### Risks & mitigations
- *Risk:* Characterization tests pin incidental behavior and become change-blockers. → Mark them `@characterization` with a documented policy: they may be *updated freely* during Phase 3 when the diff is understood, unlike golden fixtures.
- *Risk:* Naming sweep produces huge noisy diffs that mask real changes. → Mechanical-only MRs, one rule per MR, no logic edits in the same MR; lint rule stays warn until sweep completes.
- *Risk:* Coverage push produces low-value assertion-free tests. → Review rule: new tests must assert behavior (AAA pattern per repo standard), reviewer rejects coverage-only tests.

---

## Phase 3 — Decomposition + Deduplication (Weeks 7–12)

**Objectives:** Break `task-manager.tsx` (2,840 lines) into bounded modules; flatten the deepest prop-threading chains; consolidate the six-panel copy-paste family and shared persistence plumbing.

**Owner role:** Tech-lead engineer + second engineer; every MR through the existing code-review agent flow.

### Target boundaries (WS2) — the decomposition contract

`task-manager.tsx` currently owns: layout/shell assembly, view routing glue, workspace + AI hook orchestration, **all** calendar push/pull/auto-sync wiring for four entity types, action-center handlers, scheduled-job + tour + dispatcher mounting. Target end-state — `task-manager.tsx` ≤ ~600 lines of pure composition, with:

| New module | Contents (moves out of task-manager) | Interface |
|---|---|---|
| `use-calendar-integrations.ts` | The 4× (`useEntityCalendarPush` + `useEntityCalendarPull` + `useCalendarAutoSync`) instances, `use-calendar-auto-pull` runner, the `set*ForCalendar` bridges, pushable-list derivations | in: workspace setters + settings; out: one `calendarProps` bag per entity, already shaped for the pane boundary (`calendarEnabled`/`onToggleCalendar`/`onPushCalendar`/`onPullCalendar`/`calendarPushBusy`/`calendarPullBusy`) |
| `use-ai-orchestration.ts` | action-analysis hook, scheduled-job runner, weight suggestions, dispatcher assembly | in: workspace + settings + isPopout; out: `aiBundle` (undefined in popout, preserving current contract) |
| `use-action-center-handlers.ts` | assign/mark-done/clear-blocker/reschedule/escalate/rebaseline handler cluster (all functional-setter, per landmine rule) | in: entity setters; out: `ActionHandlers` (type already exists in `action-cta-controls.tsx`) |
| `use-shell-chrome.ts` | header/topBarMenus dual-mount assembly, display-tz switcher, global search mounting | out: `{ appHeaderEl, topBarMenus }` — makes the "wire BOTH headers" landmine structural instead of remembered |
| `calendar-summary-modals.tsx` | The 4 pull-summary modal mounts + their open-state | props-only |

Constraints carried over from repo conventions (non-negotiable): extracted hook factories take a typed `deps` object and are **not memoized** (live render-scope reads — the `useFileProjectOps` precedent); called unconditionally before the single return (react-hooks purity rule); public prop contracts at the pane boundary unchanged (zero edits in `workspace-section-types.ts` in extraction MRs).

Watch-list files get the same treatment only where they exceed 800: `workspace-section.tsx` (1,009) splits routing table from provider/callout chrome; `raid-panel.tsx` (905) extracts its table-row + toolbar the way gantt/reports already did (those are the in-repo template for this pattern).

### Deduplication targets (WS5)

1. **Entity-panel toolbar family:** one `EntityToolbar` composition (search-input-flex-1 + saved-views control + print + add) replacing per-panel copies across raid/changes/stakeholders/milestones — jscpd baseline from Phase 1 quantifies; target ≥ 60% reduction of the measured cross-panel duplication.
2. **Calendar prop-threading:** the FIVE-prop × four-entity threading through `workspace-section-types.ts` collapses to one `calendar?: EntityCalendarProps` bag per entity (single type, single thread).
3. **Per-entity CRUD handler shape** in task-manager (`handleSaveX`/`handleDeleteX` × 6 entities): extract `makeEntityCrudHandlers(setX, logActivity, kind)` factory — kills the recurring functional-setter landmine by construction.
4. **Six-write-path persistence:** do *not* attempt a full storage rewrite (out of scope, high risk). Instead: one `describeEntityPersistence` registry test that asserts, per entity, column presence across `*_CSV_COLUMNS` / `*_MD_COLUMNS` / sanitizer — turning "miss one of six paths" from a silent data-drop into a red test. This is dedup of *knowledge*, cheap and high-impact.
5. Consolidate the three near-identical `_helpers.ts` proxy modules (jira/confluence/timelog per A-verified clone lineage) into one parameterized `api/_shared/proxy-helpers.ts` (host allowlist, scope, path rules as config). Security-sensitive: security-lead reviews; behavior pinned by existing route tests first.

### Sprint sequencing inside the phase
- Weeks 7–8: extraction MRs 1–2 (`use-calendar-integrations`, `use-action-center-handlers`) — highest line-count wins, protected by Phase 2 characterization tests.
- Weeks 9–10: `use-ai-orchestration`, `use-shell-chrome`, modal extraction; workspace-section split.
- Weeks 11–12: dedup targets 1–5; raid-panel split; characterization tests replaced by focused per-hook tests.

### Entry criteria
- Phase 2 exit criteria met (characterization net green is **hard-blocking**).

### Exit criteria
- `task-manager.tsx` ≤ 800 lines (stretch 600); no non-dictionary file > 1,000 lines.
- jscpd duplication ≤ 50% of Phase 1 baseline value.
- All extraction MRs merged with zero golden-fixture changes and zero `workspace-section-types.ts` contract changes (except the deliberate calendar-bag consolidation, its own MR).
- Characterization suites retired/replaced.

### Success metrics
- `task-manager.tsx` line count: **2,840 → ≤ 800**.
- Files > 800 lines (excl. i18n dictionaries): **2 → 0**.
- Duplication %: **≤ 50% of baseline** (absolute target set once A1 resolved).
- Regression count attributable to phase: **0 escaped to main** (CI-caught doesn't count; user-reported does).

### Risks & mitigations
- *Risk (highest of the roadmap):* behavioral regression during extraction — stale-closure/memoization bugs are this codebase's documented top landmine class. → Characterization tests first (Phase 2 gate); extraction MRs are move-only (no logic edits, enforced in review); the non-memoized-deps-object pattern is copied from the proven `use-storage-file-ops` precedent, not invented.
- *Risk:* Calendar-prop consolidation breaks the pane contract for ~30 test render sites. → Bag type introduced additively with old props deprecated for one MR cycle; codemod-style mechanical migration MR.
- *Risk:* Proxy-helper consolidation weakens an SSRF guard through a subtle config merge. → Route tests pinned *before* consolidation; security-lead mandatory reviewer; diff must show identical allowlist/deny behavior per route.
- *Risk:* Two engineers colliding in the same giant file. → File-disjoint MR batching (established parallel-subagent workflow); task-manager extractions serialized, everything else parallel.

---

## Phase 4 — Best-Practice Lock-In (Weeks 13–16)

**Objectives:** Convert everything gained into enforced defaults; finish adoption items; deferred upgrades.

**Owner role:** Tech-lead + rotating "quality gate" owner thereafter.

### Tasks
1. Flip Semgrep job warn → block; flip file-size ratchet warn → block at 800 lines (i18n exempt).
2. Coverage ratchet step 2: 75% → **80%**, matching the org standard; add per-directory floors for `next-actions/`, codecs, and sanitize modules (the pure engines should sit ≥ 90%).
3. Add jscpd job to CI: blocking on duplication rising above the Phase 3 exit value (ratchet, not absolute).
4. Deferred major dependency upgrades from Phase 1's `npm outdated` review — one major per MR, full CI + eye-verification of axe-exempt views per upgrade.
5. Documentation debt: update `AGENTS.md` architecture pointers for every module moved in Phase 3 (the file is the operative map — stale pointers are a real hazard here); add `docs/architecture/` one-pagers for the three new orchestration hooks; document the threat model's review cadence (re-run STRIDE pass on every new trust boundary).
6. Coding-standards delta doc: capture the extraction patterns (deps-object hooks, calendar-bag props, CRUD factory) as named conventions in AGENTS.md so future entities follow them by default.
7. Retro + debt register: whatever didn't make the cut becomes a living `docs/tech-debt-register.md` with owner + review date, not folklore.

### Entry criteria
- Phase 3 exit criteria met.

### Exit criteria / success metrics
- Coverage **≥ 80%** enforced; pure-engine dirs ≥ 90%.
- All quality gates blocking (SAST, audit, size ratchet, duplication ratchet).
- 0 majors more than one major version behind (or documented exception).
- AGENTS.md pointers verified against post-Phase-3 file layout.

### Risks & mitigations
- *Risk:* Gate-flipping blocks unrelated urgent work. → Every gate is a *ratchet against baseline*, never an absolute bar; emergency `allow-fail` label with mandatory follow-up ticket.
- *Risk:* Major upgrades destabilize the forked Next.js setup. → One-per-MR, e2e gate, and the fork itself is explicitly **out of scope** — pinned unless a CVE forces it (assumption A7: fork upgrade path unknown; flag to owner).

---

## Quick Wins — First 2 Weeks (subset of Phase 1, callable out)

1. `npm audit` + Semgrep CI jobs (hours of work, permanent guardrail).
2. Unambiguous dead-code deletion MR from knip/ts-prune.
3. File-size ratchet script (stops the bleeding immediately).
4. jscpd + knip baselines committed (makes all later progress measurable).
5. Patch/minor dependency bumps.
6. Secrets-absent-from-exports guard test.
7. Commented-out-code / stale-TODO deletion MR.

---

## Roadmap-Level Assumptions Register

| # | Assumption | Resolution path |
|---|---|---|
| A1 | No duplication baseline exists | Phase 1 task 9 |
| A2 | No threat-model doc exists | Phase 1 task 1 |
| A3 | No SAST beyond ESLint in CI | Verify against `.gitlab-ci.yml` before Phase 1 task 2 |
| A4 | DAST never run; small server surface | Phase 1 task 5 confirms scope |
| A5 | 2 engineers ~70% allocated; 16-week envelope scales linearly with capacity | Confirm with owner before committing dates |
| A6 | Dead-code volume unknown | Phase 1 task 10 |
| A7 | Forked Next.js upgrade path unknown — treated as pinned/out-of-scope | Owner decision required |
