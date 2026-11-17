<!-- Generated: 2026-07-30 · counts re-verified 2026-11-17 at ed6435dd1 | App 1.21.0 "French" | Files scanned: 3106 (src/**/*.{ts,tsx}, incl. 1644 tests; `git ls-tree -r --name-only HEAD src | grep -cE '\.tsx?$'`, tests with `'\.test\.tsx?$'`) | Token estimate: ~950 -->

# Architecture

Single Next.js app (public `next` pinned exactly — read the version from `package.json` — React 19.3.1), **no server database and no backend of
its own**. All project data lives client-side; the only server code is a set of thin same-origin
proxies that exist to add auth + SSRF guards to third-party calls the browser cannot make directly,
the AI relay (`/api/ai/messages` and `/api/ai/models`, used only when the deployment sends AI through a
gateway or restricts keys to its organisation) with `/api/ai/status`, asked before every AI send, a daily sweep of expired saved chats started from `src/instrumentation.ts`, and
request-time middleware issuing a per-request CSP nonce.

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
                                     /api/ai/*    → AI gateway or api.anthropic.com
```

★ `api.anthropic.com` is in the CSP only while the browser may call it directly: an `ai` switch-off, a
gateway or a key restriction drops it (`CSP_CONNECT_HOSTS`, `when: "ai-direct"`, `src/proxy.ts`), and
every AI request goes through `ai-transport.ts`, the one browser module that talks to Anthropic.

## Boundaries that matter

- **Pure engine vs React surface.** Domain logic lives in i18n-free modules and subdirectories
  (`next-actions/`, `insights/`, `alloc-plan/`, `task-dedup/`, `inline-ai-edit/`, `digest/`,
  `scheduled-jobs/`, `undo/`, `committee-report/`, `forecast/`, the serializers, `sanitize*`). React imports them
  and translates. Engines take `today`/`now` as parameters — no clock reads inside (a lint purity
  rule also bans `Date.now()`/`Math.random()` in render bodies).
- **Facade over backends.** Nothing outside `storage.ts` picks a backend. A new persisted
  `Workspace` field must be wired through **six** write paths (JSON · CSV · Markdown · Turso-single ·
  Turso-tenant · IndexedDB) — see `data.md`.
- **Proxies are guards, not logic.** Every route that takes a user-supplied host (11 of the 15; the three
  `api/ai/` routes take none)
  reuses `api/_shared/proxy-ssrf.ts` for IP-classification + host allowlisting; only normalize/auth/URL
  is per-route. Deliberately *not* factored into one parameterized helper — divergent security guards.
  ★ `ecb` is the exception and needs no guard: one hard-coded URL, no user input, no secret.
- **A deployment can switch integrations off.** `AIPM_DISABLED_INTEGRATIONS` (§762) names any of
  `jira` · `confluence` · `timelog` · `ecb` · `stt` · `ai` (`INTEGRATION_IDS` in `integration-switches.ts`
  also takes the four AI safeguard locks `ai-people` · `ai-direct-writes` · `ai-rates` · `ai-background`,
  which the app enforces and no route refuses except `stt` under `ai-people`); every one of the 12 integration routes, and
  the AI relay's `ai/messages` and `ai/models`, asks
  `refuseIfDisabled` (`api/_shared/integration-switch.ts`, reached through the jira/timelog/stt
  `_helpers.ts`, directly in `ecb`, and in the relay's `relay`) and answers 503 before any other work
  (`ai/status` always answers, so the client can learn why AI is off), and the root layout hands
  the list to the client (`integration-switches.ts`), which hides the controls. Read per request, no
  rebuild. Detail: `docs/AGENTS/platform.md`.
- **Secrets never reach the server.** Five device-sealed `SecretId`s (AES-256-GCM under a
  non-extractable IndexedDB key). Tokens travel outbound through a proxy but are never logged or
  persisted server-side.

## Cross-cutting subsystems

| Subsystem | Entry | Note |
|---|---|---|
| AI assistant | `chat-panel.tsx` + pure `chat-api.ts` | 63 tools (`TOOL_DEFS` in `chat-tool-defs.ts`, which spreads in `DOCUMENT_TOOL_DEFS`, `FORECAST_TOOL_DEFS` and `PROJECT_TOOL_DEFS`; re-count with `grep -hcE '^    name: "' src/app/chat-tool-defs.ts src/app/chat-tool-defs-*.ts` and sum the four per-file counts; the six forecast tools refuse while the simulation is off); browser-direct to Anthropic; prompt-cache prefix ordering is load-bearing |
| Next actions | `next-actions/` | pure ranking engine + providers → Action Center |
| Insights loop | `insights/` | detect → reconcile → recommend → measure outcome |
| Undo/redo | `undo/` | `UNDO_CAP` = 25 entries, in-memory, backend-agnostic |
| Calendar sync | `use-entity-calendar-push` / `-pull` | two-way Outlook for task · RAID · change · absence · milestone (`use-milestone-calendar-pull.ts`), wired in `use-calendar-integrations.ts` |
| Scheduled jobs | `scheduled-jobs/` + `use-scheduled-job-runner.ts` | Turso-only; one named project per job, each run kept as a report in `scheduled_reports` and shown in the Scheduled reports view (§772) |
| Unload journal | `unload-journal.ts` + `use-unload-journal.ts` | §629 — a synchronous localStorage copy of an unconfirmed save, written at pagehide and restored on the next load; see `docs/AGENTS/storage.md` |
| Diagnostics | `diagnostics.ts` | capped per-device ring, two-layer secret redaction |
| AI people protection | `ai-people-dictionary.ts` → `ai-people-redact.ts`, applied in `ai-transport.ts` via `ai-privacy.ts` | per-project, on by default; known names, e-mails, phones and IBANs become placeholders before a request leaves the browser and are restored in the reply |
| AI project switches | `ai-project-switches.ts` | review every AI write, withhold rates, background AI off; stored in `settingsOverrides.ai`, forced on by the deployment locks |
| Saved AI chats | `chat-thread-codec.ts` + `chat-crypto.ts` + `chat-key-vault.ts` | Turso-only; each row encrypted per write, wrapped for its owner and for the operator's recovery key; expired by the browser (`use-chat-retention-sweep.ts`) and the server sweep |
| Reassigned hours | pure `reassign-hours.ts` + `use-reassign-hours.ts` | §774 — a new owner takes the task's remaining planned hours, one undo step with the owner change |
| Cross-project people | `cross-project/` + `person-links-store.ts` | §785 — Plan with AI counts a person's hours in other projects of the same Turso database; answers stored in `person_links` |
| AI-generated mark | `ai-content-mark.ts` | §801 — documents an AI tool wrote, and digest mails with an AI summary, carry the IPTC source type and a visible line |

## Layouts

Three shells from one tree: **modern** (default — sidebar + off-canvas drawer), **classic** (tab
strip), **popout** (read-only mirror, no header). A new top-bar control must be wired into *both*
`AppHeader` and the `ModernShell` `topBarMenus` slot or it is invisible in one layout.

## CI gates (GitHub Actions)

`static · unit · unit-shuffled · build · sbom · e2e · prod-smoke · semgrep · audit`, run on every pull
request and push to `main` (not a chain — the only `needs:` edges are `unit-shuffled` on
`unit`, and `e2e`/`prod-smoke` both on `build`; the rest, `sbom` included, run independently). All but
`sbom` are required checks; `sbom` is required only once the owner adds it to the `main` ruleset. A separate tag-triggered
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
