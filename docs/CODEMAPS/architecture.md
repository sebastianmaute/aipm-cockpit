<!-- Generated: 2026-07-30 · counts re-verified 2026-10-26 at 816097a87 | App 1.20.1 "Indridason" | Files scanned: 2836 (src/**/*.{ts,tsx}, incl. 1485 tests) | Token estimate: ~950 -->

# Architecture

Single Next.js app (public `next` pinned exactly — read the version from `package.json` — React 19.3.1), **no server database and no backend of
its own**. All project data lives client-side; the only server code is a set of thin same-origin
proxies that exist to add auth + SSRF guards to third-party calls the browser cannot make directly,
plus request-time middleware issuing a per-request CSP nonce.

```
┌─ browser ─────────────────────────────────────────────────────────────┐
│  task-manager.tsx  (root orchestrator: layout, top bar, view routing) │
│      │                                                                │
│      ├── workspace-context ── live entity state + setters             │
│      ├── workspace-section ── view router → 26 lazy panels           │
│      └── use-storage-backend ─ load/save debounce, broadcast sync     │
│                    │                                                  │
│            storage.ts (facade)                                        │
│              ├── local-file-backend   JSON · CSV · Markdown           │
│              ├── browser-backend      IndexedDB (`aipm-cockpit`)      │
│              ├── sharepoint-backend   Graph-hosted file               │
│              └── turso-backend        libSQL, single + multi-tenant   │
└───────────────────────────────────────────────────────────────────────┘
      │ direct (CSP-allowlisted)          │ same-origin /api/* proxies
      ▼                                   ▼
 api.anthropic.com                   /api/jira/*  → *.atlassian.net
 *.turso.io                          /api/confluence/page → same host
 graph.microsoft.com                 /api/timelog → *.timelog.com
 login.microsoftonline.com           /api/stt     → user-supplied BYO host
                                     /api/ecb     → ECB FX rates
```

## Boundaries that matter

- **Pure engine vs React surface.** Domain logic lives in i18n-free modules and subdirectories
  (`next-actions/`, `insights/`, `alloc-plan/`, `task-dedup/`, `inline-ai-edit/`, `digest/`,
  `scheduled-jobs/`, `undo/`, `committee-report/`, `forecast/`, the serializers, `sanitize*`). React imports them
  and translates. Engines take `today`/`now` as parameters — no clock reads inside (a lint purity
  rule also bans `Date.now()`/`Math.random()` in render bodies).
- **Facade over backends.** Nothing outside `storage.ts` picks a backend. A new persisted
  `Workspace` field must be wired through **six** write paths (JSON · CSV · Markdown · Turso-single ·
  Turso-tenant · IndexedDB) — see `data.md`.
- **Proxies are guards, not logic.** Every route that takes a user-supplied host (11 of the 12)
  reuses `api/_shared/proxy-ssrf.ts` for IP-classification + host allowlisting; only normalize/auth/URL
  is per-route. Deliberately *not* factored into one parameterized helper — divergent security guards.
  ★ `ecb` is the exception and needs no guard: one hard-coded URL, no user input, no secret.
- **A deployment can switch integrations off.** `AIPM_DISABLED_INTEGRATIONS` (§762) names any of
  `jira` · `confluence` · `timelog` · `ecb` · `stt`; every one of the 12 routes asks
  `refuseIfDisabled` (`api/_shared/integration-switch.ts`, reached through the jira/timelog/stt
  `_helpers.ts` and directly in `ecb`) and answers 503 before any other work, and the root layout hands
  the list to the client (`integration-switches.ts`), which hides the controls. Read per request, no
  rebuild. Detail: `docs/AGENTS/platform.md`.
- **Secrets never reach the server.** Five device-sealed `SecretId`s (AES-256-GCM under a
  non-extractable IndexedDB key). Tokens travel outbound through a proxy but are never logged or
  persisted server-side.

## Cross-cutting subsystems

| Subsystem | Entry | Note |
|---|---|---|
| AI assistant | `chat-panel.tsx` + pure `chat-api.ts` | 62 tools (`TOOL_DEFS` in `chat-tool-defs.ts`, which spreads in `DOCUMENT_TOOL_DEFS`, `FORECAST_TOOL_DEFS` and `PROJECT_TOOL_DEFS`; re-count with `grep -hcE '^    name: "' src/app/chat-tool-defs.ts src/app/chat-tool-defs-*.ts` and sum the four per-file counts; the six forecast tools refuse while the simulation is off); browser-direct to Anthropic; prompt-cache prefix ordering is load-bearing |
| Next actions | `next-actions/` | pure ranking engine + providers → Action Center |
| Insights loop | `insights/` | detect → reconcile → recommend → measure outcome |
| Undo/redo | `undo/` | `UNDO_CAP` = 25 entries, in-memory, backend-agnostic |
| Calendar sync | `use-entity-calendar-push` / `-pull` | two-way Outlook for task · RAID · change · absence · milestone (`use-milestone-calendar-pull.ts`), wired in `use-calendar-integrations.ts` |
| Scheduled jobs | `scheduled-jobs/` + `use-scheduled-job-runner.ts` | Turso-only; one named project per job, each run kept as a report in `scheduled_reports` and shown in the Scheduled reports view (§772) |
| Unload journal | `unload-journal.ts` + `use-unload-journal.ts` | §629 — a synchronous localStorage copy of an unconfirmed save, written at pagehide and restored on the next load; see `docs/AGENTS/storage.md` |
| Diagnostics | `diagnostics.ts` | capped per-device ring, two-layer secret redaction |

## Layouts

Three shells from one tree: **modern** (default — sidebar + off-canvas drawer), **classic** (tab
strip), **popout** (read-only mirror, no header). A new top-bar control must be wired into *both*
`AppHeader` and the `ModernShell` `topBarMenus` slot or it is invisible in one layout.

## CI gates (GitHub Actions)

`static · unit · unit-shuffled · build · e2e · prod-smoke · semgrep · audit`, all required checks on
every pull request and push to `main` (not a chain — the only `needs:` edges are `unit-shuffled` on
`unit`, and `e2e`/`prod-smoke` both on `build`; the rest run independently); a separate tag-triggered
`release.yml` builds and publishes the desktop installer. Job detail is in `docs/AGENTS/ci.md`;
enumerate the ids from the source with
`awk '/^jobs:/{f=1;next} f && /^  [a-z][a-zA-Z0-9_-]*:/{print}' .github/workflows/ci.yml` (lint fails
on any warning, `--max-warnings=0`).
E2E includes an axe pass over the `A11Y_VIEWS` (18 listed; 17 scanned while Forecast is release-hidden) × 7 scheme combos, plus three scans per combo (Kanban board, pink count badge, RAG letter
chip), harbor-light-only scans (notes-window toolbar, Documents block editor, Reports cumulative chart,
Budget currency-switch dialog, two Turso-storage Settings tests), one Reports chart-readout scan whose name carries no `a11y:` prefix, and the print spec. List them with
`grep -n -e 'a11y: ' -e 'chart readout open' e2e/a11y.spec.ts`. ★ MEASURE the scan count, do not derive it — the spec
carries its own arithmetic and a draft of it has been wrong twice: `npx playwright test
e2e/a11y.spec.ts --list` (no browsers needed). ★ Visual-regression
is **not** in the CI run — `playwright.config.ts` puts it in a separate `visual` project that the
default `chromium` project `testIgnore`s, because baselines are per-platform (`npm run e2e:visual`).
