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
| TD-4 | `sanitize*.ts` branch coverage 84.82% < the ≥90 pure-engine target | Phase 4 T2 | tech-lead | 2026-10-03 | Floor set at the honest measured level (`vitest.config.ts`); add validator branch tests to reach 90, then raise the floor. Not faked. |
| TD-5 | `task-manager.tsx` residual size > 800 lines | Phase 3 T5 | tech-lead | 2026-10-03 | Deliberate — orchestrator glue after 5 move-only extractions; further splitting = pass-through modules (YAGNI). Higher-leverage future move: consolidate top-level hooks/effects, not slice the render tree. See `tech-debt-register-inputs.md` history in git. |
| TD-6 | Duplication ≈ 2.83% (gate ratchet at 3.7%) — not ≤50% of the Phase 1 baseline | Phase 3/4 | tech-lead | 2026-10-03 | The ≤50% roadmap target is a repo-wide halving, not toolbar/prop-dedup-achievable. Remaining clones are across edit-modals + unrelated panels; a repo-wide dedup is its own effort. Ratchet the gate DOWN opportunistically. |

## Deferred major dependency upgrades (Phase 4 T4 — one major per MR)

Recorded from `npm outdated` 2026-07-02. Order: security → tooling → runtime. Update the
Status column as each lands or is blocked.

| Package | Current | Latest major | Status | Notes |
|---|---|---|---|---|
| `@azure/msal-browser` | 4.30.0 | 5.16.0 | pending | auth lib — review token-cache/API breaking changes; test M365 flows |
| `eslint` | 9.39.4 | 10.6.0 | pending | pairs with `eslint-config-next` v10 support; check flat-config compat |
| `typescript` | 5.9.3 | 6.0.3 | pending | full `tsc --noEmit` + build; watch for stricter checks |
| `jsdom` | 25.0.1 | 29.1.1 | pending | test env — verify the layout-stub landmines still hold |
| `@vitejs/plugin-react` | 4.7.0 | 6.0.3 | pending | vitest transform — verify property suites |
| `@types/node` | 20.19.41 | 26.1.0 | pending | bump WITH the Node runtime (CI is node:20); a v26 types on node 20 over-declares APIs |

### Held — CI-image lockstep (bump both together in one MR)

| Package | Current | Wanted | Why held |
|---|---|---|---|
| `@playwright/test` | 1.60.0 | 1.61.1 | CI e2e image is pinned `mcr.microsoft.com/playwright:v1.60.0-jammy`; bump the client + image tag together. |
| `@axe-core/playwright` | 4.11.3 | 4.12.1 | peers on `@playwright/test`; bump alongside the playwright pair. |
| `@tiptap/react` + `@tiptap/starter-kit` | 3.26.1 | 3.27.1 | bumping to 3.27 skews the sub-packages → `tsc` TS2769 in `rich-text-editor.tsx`; needs a coordinated bump of the whole `@tiptap/*` set. |

### Range-pinned (no action — semver range holds them)

`next` (forked, A7 — never auto-bump), `eslint-config-next`, `react`, `react-dom` —
`Wanted == Current`; the latest is outside the pinned range by design.
