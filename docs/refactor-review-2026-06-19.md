# Refactor Review — lop-app (read-only)

**Date:** 2026-06-19
**Base:** `main` @ `6b743da` (post v0.104.0 "Hutchinson" / SP4 merge)
**Method:** 6 parallel read-only review agents (orchestration shell, gantt+reports, modals+forms, AI surface, storage+serializers, hooks+integrations), scored on 4 dimensions: type safety, component/hook structure, dead code & duplication, async UI & correctness. Headline "CRITICAL" claims verified against source before inclusion.
**Scope reviewed:** `src/app/` — 370 source files, ~38k LOC TSX. Top size: `task-manager.tsx` (2224), `gantt.tsx` (1496), `reports.tsx` (1027), `workspace-section.tsx` (972), several 700–870-line modals. (i18n dicts excluded — string tables, not refactor targets.)

> Constraint frame: app is CI-green (lint `--max-warnings=0`, `tsc --noEmit`, vitest 3959+). Therefore **no current fatal lint/CI violation can exist in committed code** — any finding claiming one is a false positive. All proposals must be behavior-preserving and byte-safe (golden serializers, i18n EN/DE parity, palette, axe gate).

---

## False positives (verified, do NOT act on)

Reviewers inflated severity without running lint. Three scariest claims debunked by reading source:

| Reviewer claim | Reality | Verdict |
|---|---|---|
| `task-manager.tsx:170/183/271` — "3 CRITICAL set-state-in-effect, fails lint" | **Conditional** `setActiveTab` navigation effects (guarded by `if`), committed + CI-green. The `react-hooks/set-state-in-effect` ban targets *unconditional* derived-state mirroring; conditional nav side-effects pass. | FALSE — not critical, not lint-failing. MED style pref at most. |
| `jira-settings.tsx:65-68` — "set-state-in-render anti-pattern; convert to useEffect" | This IS the **sanctioned render-time reconcile pattern** AGENTS.md mandates (`if(prev!==cur){setPrev(...)}`). Converting to `useEffect` = the **BANNED** pattern → would fail CI. | FALSE + harmful — reject. |
| `jira-api.ts:59` — "CRITICAL: `return data as T` unvalidated" | `data` typed `unknown`; error path throws `JiraApiError`; callers guard (`Array.isArray(r.values)`). Deliberate typed-fetch boundary. | Over-rated — real-ish MED type note, not critical. Zod fix = new dep (must ask). |

Also rejected as speculative / wrong:
- "Pure modules may import React/i18n" (action-ai.ts, ai-project-proposal.ts, chat-attachments.ts) — verifiable as clean; non-findings.
- "7 ref-sync effects cause 7× re-renders" (use-jira-sync) — effects don't trigger re-renders; claim wrong. Cosmetic only.

---

## Tier A — Safe, high-value, low-risk (recommended batch)

All behavior-preserving, no serializer/i18n/palette risk. Each = its own gated slice (`npx tsc --noEmit` → `npm run lint` → `npm run test:run`).

| # | Finding | Files / target | Dim | Risk | Effort |
|---|---|---|---|---|---|
| A1 | `Field()` wrapper re-declared identically | `task-form-fields.tsx` + `project-form-fields.tsx` → extract shared `form-field.tsx` | Dup | Low | S |
| A2 | Escape-key `useEffect`+listener duped across modals | raid/change/budget edit modals → `useEscapeKey(onClose)` hook | Dup | Low | S |
| A3 | `resetAllCols` chains N× `resetColWidths()` + repeated deps array | raid/change/resources report panels → `useResetTableColumns(resizers[])` | Dup | Low | S |
| A4 | `getValue` sort callbacks copy-pasted 4–6× | report panels → `makeGetValue(mapping)` factory | Dup | Low | M |
| A5 | Touched-field `Set` + render-reset pattern duped | raid-edit-modal + task-form-fields → `useFormTouchedFields<T>()` hook | Struct | Low–Med | M |

> Confirm exact line/shape at slice time (agent findings plausible but unverified line-by-line). A5 must preserve the render-time-reconcile reset (NOT convert to effect).

---

## Tier B — Real but higher risk / needs decision (each its own approval)

| # | Finding | Note |
|---|---|---|
| B1 | 4 near-identical raw Anthropic `fetch` blocks → shared `callAnthropic()` | chat-panel, use-chat-dispatcher, use-action-analysis, use-project-proposal. Genuine win + centralizes apiKey-safe errors. BUT call shapes differ (tools, streaming, cache_control prefix ordering). Medium risk — design carefully to not break prompt-cache prefix. |
| B2 | `use-bulk-operations.ts` (25 hooks) + `use-resource-planner.ts` (48 hooks) multi-concern → split | Real structural debt. **L effort, large blast radius.** Dedicated effort. |
| B3 | `task-manager.tsx` 2224 lines | Already partially decomposed (Workspace/TaskForm/Filters providers). Further split = L, risky. Separate effort. |
| B4 | Jira API responses not schema-validated (untrusted external data) | Legit type-safety. Zod = **new dependency → must ask first**, or hand-rolled guards (M). |

---

## Tier C — Reject / low-value

- **CSV_COLUMNS meta-programming** (csv/markdown codecs): REJECT — directly threatens byte-stable golden serializers; the reviewing agent itself flagged the risk.
- `array.includes`→`Set.has` in sanitize.ts: micro-perf, unmeasured, near-zero value. Skip.
- use-jira-sync ref-sync effect consolidation: cosmetic (re-render claim was false). Skip.

---

## Possible real bug (not a refactor — worth a check)

- **`task-row.tsx` action buttons may lack `aria-label`** (expand/collapse + per-row action buttons). Open-Points view is **NOT** in the axe 12-view gate (`e2e/a11y.spec.ts`), so unlabeled per-row controls would be a genuine *unguarded* WCAG 2.4.6 issue. Per-row labels must be ROW-UNIQUE (qualify by task). Verify, then small a11y fix if confirmed.

---

## Recommended execution path

1. Branch fresh off `main` @ `6b743da` (e.g. `refactor/safe-dedup-batch`).
2. Execute **Tier A (A1–A5)** as 5 individually-gated slices; report exact `tsc`/`lint`/`test:run` output per slice.
3. Decide B1 / B4 individually (each own approval). Defer B2 / B3 to dedicated efforts.
4. Optionally fold the `task-row` a11y check in.

Tier A is the reviewable, low-blast-radius core of "refactor the app." The rest is risky (defer), needs a dependency decision (ask), or false (reject).
