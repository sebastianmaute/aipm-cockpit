<!-- Generated: 2026-07-30 | App 0.215.0 "Friedman" | Files scanned: 1544 (src/**/*.{ts,tsx}, incl. 768 tests) | Token estimate: ~950 -->

# Architecture

Single Next.js app (public `next ^16.2.11`, React 19.2.4), **no server database and no backend of
its own**. All project data lives client-side; the only server code is a set of thin same-origin
proxies that exist to add auth + SSRF guards to third-party calls the browser cannot make directly,
plus request-time middleware issuing a per-request CSP nonce.

```
┌─ browser ─────────────────────────────────────────────────────────────┐
│  task-manager.tsx  (root orchestrator: layout, top bar, view routing) │
│      │                                                                │
│      ├── workspace-context ── live entity state + setters             │
│      ├── workspace-section ── view router → ~20 lazy panels           │
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
  `scheduled-jobs/`, `undo/`, `committee-report/`, the serializers, `sanitize*`). React imports them
  and translates. Engines take `today`/`now` as parameters — no clock reads inside (a lint purity
  rule also bans `Date.now()`/`Math.random()` in render bodies).
- **Facade over backends.** Nothing outside `storage.ts` picks a backend. A new persisted
  `Workspace` field must be wired through **six** write paths (JSON · CSV · Markdown · Turso-single ·
  Turso-tenant · IndexedDB) — see `data.md`.
- **Proxies are guards, not logic.** Every route that takes a user-supplied host (11 of the 12)
  reuses `api/_shared/proxy-ssrf.ts` for IP-classification + host allowlisting; only normalize/auth/URL
  is per-route. Deliberately *not* factored into one parameterized helper — divergent security guards.
  ★ `ecb` is the exception and needs no guard: one hard-coded URL, no user input, no secret.
- **Secrets never reach the server.** Five device-sealed `SecretId`s (AES-256-GCM under a
  non-extractable IndexedDB key). Tokens travel outbound through a proxy but are never logged or
  persisted server-side.

## Cross-cutting subsystems

| Subsystem | Entry | Note |
|---|---|---|
| AI assistant | `chat-panel.tsx` + pure `chat-api.ts` | 35 tools; browser-direct to Anthropic; prompt-cache prefix ordering is load-bearing |
| Next actions | `next-actions/` | pure ranking engine + providers → Action Center |
| Insights loop | `insights/` | detect → reconcile → recommend → measure outcome |
| Undo/redo | `undo/` | ~10-step, in-memory, backend-agnostic |
| Calendar sync | `use-entity-calendar-push` / `-pull` | two-way Outlook for task · RAID · change · absence; milestone push-only |
| Diagnostics | `diagnostics.ts` | capped per-device ring, two-layer secret redaction |

## Layouts

Three shells from one tree: **modern** (default — sidebar + off-canvas drawer), **classic** (tab
strip), **popout** (read-only mirror, no header). A new top-bar control must be wired into *both*
`AppHeader` and the `ModernShell` `topBarMenus` slot or it is invisible in one layout.

## CI gates (GitLab,  (GitLab))

`install → quality → build → e2e`. Quality is blocking: lint (`--max-warnings=0`), `tsc --noEmit`,
Semgrep SAST, dependency audit, file-size ratchet, jscpd duplication gate, vitest coverage floors.
E2E includes a 16-view × 5-scheme-combo axe pass (85 checks) plus the print spec. ★ Visual-regression
is **not** in the CI run — `playwright.config.ts` puts it in a separate `visual` project that the
default `chromium` project `testIgnore`s, because baselines are per-platform (`npm run e2e:visual`).
