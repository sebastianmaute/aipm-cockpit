# Tech Debt Phase 4 — Best-Practice Lock-In Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert Phases 1–3 gains into enforced defaults: flip warn-only gates to blocking, ratchet coverage with per-directory floors, add the duplication gate, land deferred major upgrades, and sync all documentation to the post-decomposition layout.

**Architecture:** Pure configuration + documentation phase, plus isolated one-major-per-MR dependency upgrades. Every gate is a ratchet against a committed baseline, never an absolute bar — with a documented emergency escape hatch.

**Tech Stack:** GitLab CI, vitest coverage thresholds (glob-scoped), jscpd, npm.

**Entry gate:** Phase 3 exit checklist complete.

---

### Task 1: Flip Semgrep + file-size gates to blocking

**Files:**
- Modify: `.gitlab-ci.yml`

- [ ] **Step 1: Precondition check**

Last 10 pipelines on main: semgrep job green (or only baselined findings) and file-size-ratchet green. If either is red, fix the findings FIRST — flipping a red gate blocks everyone.

- [ ] **Step 2: Remove `allow_failure: true` from both jobs**

`semgrep:` and `file-size-ratchet:` jobs each lose the `allow_failure` line. Add the escape hatch as a comment on each:

```yaml
  # Emergency bypass: MR label "quality-gate-bypass" + mandatory follow-up ticket.
  # rules:
  #   - if: $CI_MERGE_REQUEST_LABELS =~ /quality-gate-bypass/
  #     allow_failure: true
  #   - when: on_success
```
(Enable the rules block for real if the team wants the label mechanism active from day one; otherwise the comment documents the procedure.)

- [ ] **Step 3: Commit**

```bash
git add .gitlab-ci.yml
git commit -m "ci: flip semgrep + file-size ratchet from warn to blocking"
```

---

### Task 2: Coverage ratchet step 2 — per-directory floors for pure engines

**Files:**
- Modify: `vitest.config.ts`

- [ ] **Step 1: Measure per-directory reality**

```bash
npm run test:coverage 2>&1 | grep -E "next-actions|codecs|sanitize" | head -20
```
Record actual % for `src/app/next-actions/`, the codec modules, sanitize modules.

- [ ] **Step 2: Add glob-scoped thresholds (vitest supports glob keys inside `thresholds`)**

```ts
thresholds: {
  // global floor — raise each to measured-minus-1 from the Phase 2 ratchet,
  // never below: lines 90, functions 89, branches 78, statements 87
  lines: 90, functions: 89, branches: 80, statements: 88,   // ← use real measured values
  // pure-engine floors (roadmap target ≥ 90):
  "src/app/next-actions/**": { lines: 90, branches: 85 },
  "src/app/*codecs*.ts":     { lines: 90, branches: 85 },
  "src/app/sanitize*.ts":    { lines: 95, branches: 90 },
},
```
Rule: every number = measured − small headroom. If a pure-engine dir measures BELOW 90, do not fake it — add the missing behavior tests first (separate commit), then set the floor.

- [ ] **Step 3: Verify + commit**

```bash
npm run test:coverage && npx tsc --noEmit
git add vitest.config.ts src/app
git commit -m "test: per-directory coverage floors for pure engines; global ratchet step 2"
```

---

### Task 3: Duplication gate in CI

**Files:**
- Modify: `.gitlab-ci.yml`, `package.json`

- [ ] **Step 1: Set the threshold from the Phase 3 exit value**

Read the current % from `npm run dup:check` (should be ≤ 50% of the Phase 1 baseline). Set gate = current + 0.5 points headroom.

```json
"dup:check": "jscpd src --min-tokens 50 --ignore \"**/*.test.*,**/*.property.test.*,**/__fixtures__/**,**/i18n*.ts\" --threshold <VALUE> --reporters console"
```
(`--threshold` makes jscpd exit non-zero above VALUE.)

- [ ] **Step 2: Add blocking CI job**

```yaml
duplication-gate:
  stage: quality
  needs: [install]
  script:
    - npm run dup:check
```

- [ ] **Step 3: Verify locally + commit**

```bash
npm run dup:check; echo "exit=$?"     # expect exit=0
git add .gitlab-ci.yml package.json
git commit -m "ci: blocking duplication gate at phase-3 exit level (ratchet)"
```

---

### Task 4: Deferred major dependency upgrades — one per MR

**Files:**
- Input: the majors list recorded in `docs/tech-debt-register-inputs.md` (Phase 1 Task 12)
- Modify: `package.json`, `package-lock.json` per upgrade

- [ ] **Step 1: Order the list**

Priority: (1) security-relevant, (2) test/build tooling, (3) runtime libs. EXCLUDED permanently pending owner decision: `next` (forked — roadmap A7). LOCKSTEP: `@playwright/test` major requires the `.gitlab-ci.yml` image tag change in the SAME commit (documented pairing).

- [ ] **Step 2: Per major (repeat this block per package)**

```bash
npm i <pkg>@latest
npm run lint && npx tsc --noEmit && npm run test:run && npm run build && npm run e2e
```
Then eye-verify the axe-EXEMPT surfaces the upgrade could touch (chat, Kanban board interactions, Calendar, Help, stakeholder map — the documented not-in-gate list) if the package is UI-adjacent.

- [ ] **Step 3: Commit per major**

```bash
git add package.json package-lock.json .gitlab-ci.yml
git commit -m "chore(deps): upgrade <pkg> to v<N> (major)"
```
Failure path: revert, record blocker + reason in the debt register, move on — no multi-day yak-shaves inside this task.

---

### Task 5: Documentation sync — AGENTS.md + architecture one-pagers

**Files:**
- Modify: `AGENTS.md`
- Create: `docs/architecture/calendar-integrations.md`, `docs/architecture/ai-orchestration.md`, `docs/architecture/shell-chrome.md`

- [ ] **Step 1: Verify every AGENTS.md pointer against the post-Phase-3 tree**

```bash
grep -oE "\`[a-z0-9-]+\.(ts|tsx)\`" AGENTS.md | sort -u | tr -d '\`' | while read f; do
  ls src/app/$f src/app/*/$f 2>/dev/null >/dev/null || echo "STALE: $f"
done
```
Fix every STALE hit — AGENTS.md is the operative map; stale pointers are an active hazard (agents follow them).

- [ ] **Step 2: Update the moved-module bullets**

Rewrite the task-manager orchestration bullets to point at `use-calendar-integrations` / `use-ai-orchestration` / `use-action-center-handlers` / `use-shell-chrome` / `calendar-summary-modals`, the workspace-section/raid-panel splits, `EntityToolbar`, `EntityCalendarProps` bag, `makeEntityCrudHandlers`, and `api/_shared/proxy-helpers`. Preserve the ★ landmine annotations — move them WITH their subject.

- [ ] **Step 3: One-pagers**

Each `docs/architecture/*.md`: purpose, deps-object interface, invariants (non-memoized, popout gates, purity constraints), test entry points. ≤ 1 page each — the details live in code + AGENTS.md.

- [ ] **Step 4: Threat-model cadence note**

Append to `docs/security/threat-model.md`: "Re-run the STRIDE pass on every new trust boundary (new external host in CSP, new SecretId, new /api route). Owner: security-lead. Checked in MR review via the CSP/SecretId lockstep lists."

- [ ] **Step 5: Commit**

```bash
git add AGENTS.md docs/architecture docs/security/threat-model.md
git commit -m "docs: sync AGENTS.md pointers + architecture one-pagers to post-decomposition layout"
```

---

### Task 6: Coding-standards delta — name the new conventions

**Files:**
- Modify: `AGENTS.md` (Architecture pointers section)

- [ ] **Step 1: Add a "Extraction conventions (Phase 3)" bullet block**

Codify as named patterns so future entities follow by default:
1. **Deps-object hook**: cross-cutting orchestration extracted from task-manager takes a typed `deps` object, called unconditionally, handlers non-memoized.
2. **Calendar bag**: new calendar-capable entity threads ONE `EntityCalendarProps`, never five flat props.
3. **CRUD factory**: new entity save/delete handlers come from `makeEntityCrudHandlers` (functional-setter by construction).
4. **Proxy config**: new external-API proxy = `createProxyHelpers(cfg)` instantiation, never a hand-rolled guard chain.
5. **Panel split**: any panel crossing ~700 lines splits orchestrator/rows/toolbar (gantt pattern) before it crosses 800.

- [ ] **Step 2: Commit**

```bash
git add AGENTS.md
git commit -m "docs: codify phase-3 extraction patterns as named conventions"
```

---

### Task 7: Retro + living debt register

**Files:**
- Create: `docs/tech-debt-register.md`
- Delete: `docs/tech-debt-register-inputs.md` (contents migrated)

- [ ] **Step 1: Write the register**

```markdown
# Tech Debt Register
> Living doc. Every entry: owner + review date. Review quarterly. Folklore dies here.

| ID | Item | Origin | Owner | Review by | Notes |
|---|---|---|---|---|---|
| TD-1 | Forked Next.js pinned — upgrade path unowned | Roadmap A7 | <owner> | <date> | CVE forces action |
| TD-2 | Six-write-path persistence — registry test mitigates, full storage rewrite out of scope | Phase 3 Task 10 | | | |
| TD-3 | Auto-pull re-creates pruned events when entity still pushable (documented SP5 limit) | v0.164 | | | per-item opt-out is future work |
| TD-4 | <majors that failed Task 4> | Phase 4 | | | |
| TD-5 | <task-manager residual if > 600 lines> | Phase 3 Task 5 | | | |
```
Migrate every parked item from `tech-debt-register-inputs.md` and any Phase 1–3 "deferred" notes; then delete the inputs file.

- [ ] **Step 2: Link from the roadmap**

Append to `docs/tech-debt-remediation-roadmap.md`: "Completed <date>. Residual items: see [tech-debt-register.md](tech-debt-register.md)."

- [ ] **Step 3: Commit**

```bash
git add docs/tech-debt-register.md docs/tech-debt-remediation-roadmap.md
git rm docs/tech-debt-register-inputs.md
git commit -m "docs: living tech-debt register; roadmap closed out"
```

---

## Phase exit checklist (= roadmap completion)
- [ ] All quality gates blocking: SAST, dependency audit, file-size ratchet, duplication ratchet, coverage floors (global + pure-engine dirs).
- [ ] 0 dependencies more than one major behind (or TD-register exception with owner).
- [ ] AGENTS.md pointer scan: 0 STALE hits.
- [ ] Debt register live with owners + review dates.
