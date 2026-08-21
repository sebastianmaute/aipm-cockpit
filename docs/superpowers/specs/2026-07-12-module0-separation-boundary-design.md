# Module 0 — Separation Boundary Foundation (design)

Date: 2026-07-12
Status: Approved (design); pending implementation plan
Author: brainstorming session

## Context & strategic frame

lop-app is a local-first, browser-only, single-PM AI cockpit. A growth path was
explored toward optional hosted / team ("enterprise") capability, benchmarked
against OpenProject. The agreed product shape:

- **Local-first stays the main path and product identity.** Zero-infra, offline,
  file/IndexedDB backends. This is the moat.
- **Hosted/team is an OPTIONAL, additive path**, not a re-platform of the core.
- Tiers:
  - **Core (local-first)** — always present, no server.
  - **Cloud (L0)** — default *hosted* option: single-user, cross-device sync.
  - **Team (L2–L4)** — enterprise opt-in: RBAC, multi-user concurrency, collaboration.

The team path decomposes into substrate layers L0 (hosted data) → L1 (identity)
→ L2 (membership/RBAC) → L3 (multi-user sync/concurrency) → L4 (collaboration).
These ship sequentially; each has an independently valuable midpoint. A parallel
"capability module" track (subtasks, custom fields, …) is architecture-independent
and can ship on the local-first core without any server.

**Decomposition decision:** the *separation machinery itself* lands FIRST, as its
own module, before any server code — so the "keep it separate" boundary is proven
while the app is still 100% local-first.

- **Module 0 (this spec)** — the boundary. No server. Zero behavior change.
- **Module 1 (next spec cycle)** — L0 cloud pack, the first thing built behind the
  proven boundary.

This document specifies **Module 0 only**. Module 1 (L0) gets its own
spec → plan → implementation cycle.

## Why a boundary module first

The one-directional dependency rule (packs depend on core; core NEVER depends on a
pack) is the entire mechanism that keeps hosted/team code from tangling into the
local-first core. A rule without a CI gate rots — consistent with every constraint
in AGENTS.md being CI-enforced. Establishing the gate *from empty* is the cheapest
moment to get it right, and it stands guard the instant M1 adds the first cloud file.

## Scope

### In scope (Module 0)

1. **`src/pack/` boundary directory** — new top-level sibling of `src/app/`. Empty
   at end of M0 except a `README.md` stating the rule.
2. **`dependency-cruiser` import-boundary rule + CI gate** — `core → pack` imports
   forbidden; packs may not import each other.
3. **Actor abstraction** — `Actor` type + `LOCAL_ACTOR` sentinel + `useCurrentActor()`
   hook (returns local in M0). Activity-log "who" wired through it as the single
   producer.
4. **Capability / tier resolution** — `DeploymentTier` + `Capabilities` +
   `capabilitiesFor(tier)` + `useCapabilities()` (tier hardcoded `"local"` in M0).
5. **Registration-seam stub** — a 3-line `setSessionProvider`-style no-op indirection
   in core, reserved for packs (see §Boundary validation).
6. **Boundary-contract doc** — what is core, what is a pack, the one-directional rule.

### Non-goals (deferred to M1+)

- No server, no `/api/workspace`, no auth, no sync, no version token.
- No RBAC, no multi-user, no comments, no presence.
- **No attribution fields on entities** (`createdBy` etc.). The actor abstraction
  exists; entities and serialized shapes are untouched in M0.
- **No file relocation** of existing code. All current code remains core in place.
- No user-visible behavior change. No user-facing release highlight.

### Success criteria

- App behaves identically; all existing gates (lint/tsc/semgrep/size/dup/unit/e2e/
  golden/characterization) stay green.
- A NEW CI gate fails the pipeline if any `core` file imports `pack`, or a pack
  imports another pack.
- `useCurrentActor()` / `useCapabilities()` are the only sanctioned paths for
  "who am I" / "what can this deployment do".
- Golden fixtures + `task-manager.characterization` byte-identical (proves zero
  behavior change).

## Design

### 1. Directory boundary + CI gate

**Layout.** New top-level `src/pack/` (sibling of `src/app/`). Empty in M0 except
`src/pack/README.md` stating the rule. All existing code is **core**
(`src/app/**`, `src/proxy.ts`, etc.). No files move.

**The rule (one-directional):**

- `src/pack/**` MAY import core (`src/app/**`).
- Core (`src/app/**` and everything outside `src/pack/`) MUST NOT import `src/pack/**`.
- Packs MUST NOT import each other (`pack/cloud` ∤ `pack/team`) — packs stay
  independent.

**Enforcement — `dependency-cruiser`** (devDependency). One `.dependency-cruiser.cjs`
with `forbidden` rules:

- `core-must-not-import-pack`: from `src/app` → to `src/pack` ✗
- `pack-cross-import`: from `src/pack/<X>` → to `src/pack/<Y>` (different pack) ✗

Reads the existing tsconfig path aliases so import resolution matches the build.

**Wiring:**

- `npm run boundary:check` script + a `scriptsDescriptions` entry (satisfies the
  `docs:scripts:check` rule).
- Runs in the CI **quality** stage alongside lint/typecheck/semgrep, with `--error`
  so a violation fails the pipeline (blocking ratchet).
- Update the AGENTS.md "New CI gate → also update this line" hard-constraint list.

**Green from empty:** nothing in `pack/` yet, so the gate passes immediately and can
merge; it guards the moment M1 adds the first cloud file.

**Why dependency-cruiser over eslint-plugin-boundaries:** purpose-built for
layer/path rules, no per-file directives, clean CI failure output naming the
offending edge.

### 2. Actor abstraction

**Purpose.** One sanctioned answer to "who is acting?" so that when M1+ introduces
real users, attribution flows through a single seam instead of raw user reads
scattered through panels.

**Type (core, new `src/app/actor.ts`, pure / i18n-free):**

```ts
export type Actor = { id: string; kind: "local" | "user"; displayName: string };
export const LOCAL_ACTOR: Actor = { id: "local", kind: "local", displayName: "You" };
```

`displayName` is a non-React fallback default only — React UI still translates the
"You" label via i18n at the render site. The sentinel carries a plain default so
pure / non-React consumers never crash.

**Hook (`src/app/use-current-actor.ts`):** `useCurrentActor(): Actor` returns
`LOCAL_ACTOR` unconditionally in M0. The signature is the forward-contract; the body
gains a real branch in M1 (reads the authenticated session via the registration
seam). Pure engines that need an actor take it as a **param** (never call the hook)
— mirrors how `today` / `tz` are threaded through pure engines.

**M0 wiring — one producer (sourced-only).** The activity-log producer hook
`useActivityLog()` (`use-activity-log.ts`) is already the single producer. In M0 it
*sources* the actor — calls `useCurrentActor()` and returns it as a new `actor`
field — but does **not** write it into activity entries. Rationale:
`saveActivityLog` JSON-stringifies whole entries, so writing the actor would
serialize it (violating the non-goal below) and reading-then-dropping it would trip
the `--max-warnings=0` unused-var gate. Returning it is lint-clean, changes no stored
bytes, and establishes the seam (the producer hook owns actor acquisition). **M1
flips it from returned-only to written-into-entries** when a real non-local actor
exists and serialization becomes intended. **No new persisted field in M0:** the
activity log's stored shape is unchanged. Golden fixtures + the six-write-path rule
stay untouched. Entities gain no `createdBy`.

**Convention (adopt now, free in M0):** panels/handlers never read a user identity
directly — always `useCurrentActor()` or a threaded `Actor` param. Nothing else to
read in M0, so the rule costs nothing to adopt.

### 3. Capability / tier resolution

**Purpose.** Features ask "can this deployment do X?", never "which tier am I?" — so
adding cloud/team later flips capability values instead of hunting scattered
`if (tier === …)`.

**Types (core, new `src/app/deployment.ts`, pure / i18n-free):**

```ts
export type DeploymentTier = "local" | "cloud" | "team";
export type Capabilities = {
  hosted: boolean;      // data lives on a server (cloud/L0+)
  serverSync: boolean;  // version-token server write path (cloud/L0+)
  multiUser: boolean;   // >1 account per workspace (team/L2+)
  remoteAuthz: boolean; // server enforces permissions (team/L2+)
};
export function capabilitiesFor(tier: DeploymentTier): Capabilities;
```

- `capabilitiesFor("local")` → all `false`.
- `capabilitiesFor("cloud")` → `hosted: true, serverSync: true`, rest `false`.
- `capabilitiesFor("team")` → all `true`.

Single source of truth; mirrors `deriveMode(features)`.

**Resolution (M0):** tier is **hardcoded `"local"`** — no setting, no UI, no
persistence. `useCapabilities(): Capabilities` returns `capabilitiesFor("local")`.
The reader pattern lands now; the real tier source (session/settings) arrives in M1.

**Consumers in M0:** none functional (everything is already local). Value of shipping
now = the contract + tests exist, so M1 adds cloud code reading `caps.hosted` against
an already-proven resolver, and the boundary/actor/capability trio land together as
"the foundation".

**Kept separate from `deriveMode` / `settings.features`:** those gate *feature
modules* (the user's simple/advanced preference). Deployment tier is orthogonal — an
infra fact, not a user preference — so it stays a separate module (same rationale as
`data-style` staying orthogonal to `.dark`).

### 4. Boundary validation (M1/L0 fits behind it)

Not built in M0. Traced here to prove the committed boundary is correct — if any L0
piece forced a `core → pack` import, the boundary would be wrong. It does not:

| L0 piece                      | Lands in                         | Imports (allowed)              |
|-------------------------------|----------------------------------|--------------------------------|
| `/api/workspace` edge R/W     | `pack/cloud/api`                 | core codecs/sanitize/types     |
| magic-link + M365 OAuth       | `pack/cloud/auth`                | core (MSAL wiring reused)      |
| version-token sync + conflict | `pack/cloud/sync`                | core storage-error channel     |
| remote backend adapter        | core declares port; **pack** impl| core interface                 |
| tier source (real `"cloud"`)  | pack registers → core reads      | via registration seam          |
| real `useCurrentActor` branch | core hook body reads session     | session provided by pack       |

**The registration seam (the one new core concept M0 anticipates).** Core owns
*interfaces* and a *registration point*; a pack provides the *implementation* and
registers it at runtime. Core never imports pack source. Standard ports-and-adapters:

- The storage facade's 7th backend *kind* (interface) is core; the *cloud adapter*
  (class) is pack, registered on boot.
- Same shape for actor/tier: core exposes a `setSessionProvider(fn)` the cloud pack
  calls on boot; the core hook reads through it.

Dependency direction: **core → interface**, **pack → registers-impl** — never
core → pack. M0 ships this as a **3-line no-op stub** (`setSessionProvider` stores a
provider; default provider yields local actor / `"local"` tier) so M1 has the hook
to call. Documented "reserved for packs".

**Conclusion:** boundary holds. All server code lands in `pack/cloud`; core gains
only interfaces + a registration point. No `core → pack` edge anywhere. The M0 gate
is honest, not a rule L0 must violate.

## Testing

- `actor.test.ts` — `LOCAL_ACTOR` shape; `useCurrentActor()` returns local.
- `deployment.test.ts` — `capabilitiesFor` truth table for all three tiers (locks the
  contract before any consumer exists).
- `boundary.test` (thin) — assert the dependency-cruiser config parses and the two
  forbidden rules are present (belt-and-suspenders beside the CI gate).
- Activity-log producer test — `useActivityLog().actor` returns `LOCAL_ACTOR` by
  default and a registered pack actor when overridden; and a logged entry's stored
  JSON has NO `actor` key (byte-stability). Guards the sourced-only seam.
- Registration-seam test — default provider yields `LOCAL_ACTOR` / `"local"`; a
  registered provider is read back (proves the M1 hook works without a pack present).
- **Characterization safety:** existing `task-manager.characterization` + golden
  fixtures stay byte-identical.

**Coverage:** `actor.ts` / `deployment.ts` / `use-current-actor.ts` are covered by
their own direct unit tests and stay coverage-gated (not excluded) — they carry real
logic (the tier switch, the provider seam), so they're testable in isolation.

## Gates / CI

- New blocking gate `boundary:check` (dependency-cruiser) in the **quality** stage,
  `--error`.
- Update AGENTS.md hard-constraints "New CI gate → also update this line".
- Add `scriptsDescriptions` entry for `boundary:check` (else `docs:scripts:check`
  fails).

## Rollout / risk

- Ships as a normal release: bump `src/app/version.ts` (APP_VERSION + milestone),
  CHANGELOG entry. **No user-facing highlight key** — internal foundation; note in
  CHANGELOG as infra.
- Risk near-zero: no behavior change, no runtime deps added (dependency-cruiser is a
  devDependency), gate green from empty.
- Only chore of substance: the registration-seam 3-line stub in core — keep it a
  no-op in M0 so M1 has the hook to call.
- Effort: small — one release, mostly new pure files + config, no risky edits to hot
  paths.

## Follow-on (not this spec)

- **Module 1 (L0 cloud pack):** `pack/cloud` — extend the existing Next.js server
  with an authoritative `/api/workspace` read/write path (same-origin, no new CSP
  host); magic-link email + optional M365/MSAL OAuth identity; optimistic
  whole-workspace version-token sync with pull-on-open, conflict surfaced via the
  existing storage-error banner; the remote backend adapter registered behind the
  core facade port; real `useCurrentActor` / tier source. L0 upgrades the sync token
  from whole-workspace to per-entity when L3 (team) arrives.
- **Capability track (parallel, server-free):** task hierarchy / subtasks, custom
  fields — shippable on the local-first core independently of the tier work.
