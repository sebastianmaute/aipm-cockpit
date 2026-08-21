# Module 0 — Separation Boundary Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish the one-directional "core never imports a pack" boundary (with a CI gate), plus the actor + deployment-capability abstractions and a pack-registration seam — all while the app stays 100% local-first with zero user-visible behavior change.

**Architecture:** Add a new `src/pack/` directory (empty in M0) reserved for cloud/team code, guarded by a `dependency-cruiser` rule that forbids `src/app` (core) from importing `src/pack`, and forbids packs from importing each other. Add pure `actor.ts` (identity abstraction) and `deployment.ts` (tier→capabilities), plus a `use-current-actor.ts` hook backed by a mutable session-provider seam that packs will register on boot (defaults to the local actor). Wire the actor into the activity-log producer hook as a *sourced* value only (not serialized).

**Tech Stack:** TypeScript 6, React 19, Next.js 16 (forked), Vitest 4 (+ `@testing-library/react` `renderHook`), dependency-cruiser (new devDependency), GitLab CI.

**Spec:** `docs/superpowers/specs/2026-07-12-module0-separation-boundary-design.md`

**Out of plan scope:** push / MR / merge / release publication (user-triggered per repo convention). Task 8 prepares the release artifacts (version + CHANGELOG) only.

**Conventions to honor (from AGENTS.md / project rules):**
- Commit format `<type>: <description>`; NO attribution footer (disabled globally).
- `npm run lint` runs with `--max-warnings=0` in CI — an unused import/var is FATAL.
- Typecheck with `npx tsc --noEmit` after editing any `.ts`/`.test.ts`.
- Adding a `package.json` script REQUIRES a `scriptsDescriptions` entry + regenerating docs (`npm run docs:scripts`), else `docs:scripts:check` fails.
- Adding a CI gate REQUIRES updating the AGENTS.md "Hard constraints" CI line.
- Pure `.ts` files are coverage-gated (floors in `vitest.config.ts`); write real tests.

**File structure (created/modified in this plan):**
- Create `src/app/actor.ts` — `Actor` type + `LOCAL_ACTOR` sentinel (pure).
- Create `src/app/actor.test.ts`.
- Create `src/app/deployment.ts` — `DeploymentTier`, `Capabilities`, `capabilitiesFor` (pure).
- Create `src/app/deployment.test.ts`.
- Create `src/app/use-current-actor.ts` — session-provider seam + `useCurrentActor`.
- Create `src/app/use-current-actor.test.ts`.
- Modify `src/app/use-activity-log.ts` — source the actor (returned field only).
- Create `src/app/use-activity-log.test.tsx`.
- Create `src/pack/README.md` — boundary rule doc.
- Create `.dependency-cruiser.cjs` — the boundary rules.
- Create `src/app/boundary-config.test.ts` — asserts the rules exist.
- Modify `package.json` — add `dependency-cruiser` devDep, `boundary:check` script, `scriptsDescriptions` entry.
- Modify `.gitlab-ci.yml` — add `boundary:check` to the quality stage.
- Modify `AGENTS.md` — update the CI hard-constraint line.
- Modify `src/app/version.ts` + `CHANGELOG.md` + `package.json` version — release prep (Task 8).

---

### Task 1: Actor abstraction (`actor.ts`)

**Files:**
- Create: `src/app/actor.ts`
- Test: `src/app/actor.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/app/actor.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { LOCAL_ACTOR, type Actor } from "./actor";

describe("actor", () => {
  it("LOCAL_ACTOR is a stable local sentinel", () => {
    expect(LOCAL_ACTOR).toEqual({ id: "local", kind: "local", displayName: "You" });
  });

  it("Actor type accepts a real user shape", () => {
    const user: Actor = { id: "u-42", kind: "user", displayName: "Ada" };
    expect(user.kind).toBe("user");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/actor.test.ts`
Expected: FAIL — cannot find module `./actor`.

- [ ] **Step 3: Write minimal implementation**

Create `src/app/actor.ts`:

```ts
// Identity abstraction. Core has no user concept in local-first mode; a cloud/
// team pack (M1+) supplies a real user via the session-provider seam
// (see use-current-actor.ts). Attribution reads through useCurrentActor() —
// never a raw user field in panels. Pure / i18n-free: displayName carries a
// plain fallback so non-React consumers never crash; React UI still translates
// the visible "You" label at the render site.

export type Actor = {
  /** Stable id. "local" for the single-device local actor; "u-<n>" for a user. */
  id: string;
  kind: "local" | "user";
  /** Non-translated fallback label. */
  displayName: string;
};

export const LOCAL_ACTOR: Actor = { id: "local", kind: "local", displayName: "You" };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/actor.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/app/actor.ts src/app/actor.test.ts
git commit -m "feat: add Actor identity abstraction (M0 separation foundation)"
```

---

### Task 2: Deployment tier + capabilities (`deployment.ts`)

**Files:**
- Create: `src/app/deployment.ts`
- Test: `src/app/deployment.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/app/deployment.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { capabilitiesFor, type Capabilities, type DeploymentTier } from "./deployment";

describe("capabilitiesFor", () => {
  it("local tier enables nothing", () => {
    expect(capabilitiesFor("local")).toEqual({
      hosted: false,
      serverSync: false,
      multiUser: false,
      remoteAuthz: false,
    });
  });

  it("cloud tier enables hosting + server sync only", () => {
    expect(capabilitiesFor("cloud")).toEqual({
      hosted: true,
      serverSync: true,
      multiUser: false,
      remoteAuthz: false,
    });
  });

  it("team tier enables everything", () => {
    expect(capabilitiesFor("team")).toEqual({
      hosted: true,
      serverSync: true,
      multiUser: true,
      remoteAuthz: true,
    });
  });

  it("every tier resolves to a complete Capabilities object", () => {
    const tiers: DeploymentTier[] = ["local", "cloud", "team"];
    for (const t of tiers) {
      const caps: Capabilities = capabilitiesFor(t);
      expect(Object.keys(caps).sort()).toEqual(
        ["hosted", "multiUser", "remoteAuthz", "serverSync"],
      );
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/deployment.test.ts`
Expected: FAIL — cannot find module `./deployment`.

- [ ] **Step 3: Write minimal implementation**

Create `src/app/deployment.ts`:

```ts
// Deployment tier → capability resolution. Features ask "can this deployment do
// X?" (a capability), NEVER "which tier am I?" — so adding cloud/team later means
// flipping capability values, not hunting scattered `if (tier === …)`. Kept
// SEPARATE from deriveMode(settings.features): that gates user-chosen feature
// modules; this is an orthogonal infra fact. Pure / i18n-free.

export type DeploymentTier = "local" | "cloud" | "team";

export type Capabilities = {
  /** Data lives on a server (cloud/L0+). */
  hosted: boolean;
  /** Version-token server write path (cloud/L0+). */
  serverSync: boolean;
  /** More than one account per workspace (team/L2+). */
  multiUser: boolean;
  /** Server enforces permissions (team/L2+). */
  remoteAuthz: boolean;
};

export function capabilitiesFor(tier: DeploymentTier): Capabilities {
  switch (tier) {
    case "local":
      return { hosted: false, serverSync: false, multiUser: false, remoteAuthz: false };
    case "cloud":
      return { hosted: true, serverSync: true, multiUser: false, remoteAuthz: false };
    case "team":
      return { hosted: true, serverSync: true, multiUser: true, remoteAuthz: true };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/deployment.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/app/deployment.ts src/app/deployment.test.ts
git commit -m "feat: add deployment tier→capabilities resolver (M0)"
```

---

### Task 3: Session-provider seam + `useCurrentActor` / `useCapabilities`

The registration seam: core exposes setters a pack calls on boot; core reads through them. Defaults yield the local actor / `"local"` tier, so M0 behaves as pure local-first.

**Files:**
- Create: `src/app/use-current-actor.ts`
- Test: `src/app/use-current-actor.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/app/use-current-actor.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
import { LOCAL_ACTOR, type Actor } from "./actor";
import { capabilitiesFor } from "./deployment";
import {
  useCapabilities,
  useCurrentActor,
  __resetDeploymentSeamForTests,
  setSessionProvider,
  setTierProvider,
} from "./use-current-actor";

afterEach(() => {
  __resetDeploymentSeamForTests();
});

describe("deployment seam", () => {
  it("defaults to the local actor when no pack registered", () => {
    expect(useCurrentActor()).toEqual(LOCAL_ACTOR);
  });

  it("defaults to the local tier's capabilities", () => {
    expect(useCapabilities()).toEqual(capabilitiesFor("local"));
  });

  it("reads a registered session provider (pack override)", () => {
    const ada: Actor = { id: "u-1", kind: "user", displayName: "Ada" };
    setSessionProvider(() => ada);
    expect(useCurrentActor()).toEqual(ada);
  });

  it("reads a registered tier provider (pack override)", () => {
    setTierProvider(() => "cloud");
    expect(useCapabilities()).toEqual(capabilitiesFor("cloud"));
  });

  it("reset restores local defaults", () => {
    setSessionProvider(() => ({ id: "u-1", kind: "user", displayName: "Ada" }));
    __resetDeploymentSeamForTests();
    expect(useCurrentActor()).toEqual(LOCAL_ACTOR);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/use-current-actor.test.ts`
Expected: FAIL — cannot find module `./use-current-actor`.

- [ ] **Step 3: Write minimal implementation**

Create `src/app/use-current-actor.ts`:

```ts
"use client";

// Registration seam (reserved for packs, M1+). A cloud/auth pack registers the
// real session actor + deployment tier on boot; core reads through these
// providers. Defaults yield the local actor / "local" tier, so with no pack the
// app is pure local-first. These are hooks by NAME (forward contract) but call
// no React hooks in M0 — a pack replaces the provider body in M1 to make them
// reactive. Reading a registered function during render is deterministic (not
// Date.now/Math.random), so the react-hooks purity rule is satisfied.

import { LOCAL_ACTOR, type Actor } from "./actor";
import { capabilitiesFor, type Capabilities, type DeploymentTier } from "./deployment";

type SessionProvider = () => Actor;
type TierProvider = () => DeploymentTier;

const DEFAULT_SESSION: SessionProvider = () => LOCAL_ACTOR;
const DEFAULT_TIER: TierProvider = () => "local";

let sessionProvider: SessionProvider = DEFAULT_SESSION;
let tierProvider: TierProvider = DEFAULT_TIER;

/** Reserved for packs (M1+): register the authenticated session actor source. */
export function setSessionProvider(provider: SessionProvider): void {
  sessionProvider = provider;
}

/** Reserved for packs (M1+): register the active deployment tier source. */
export function setTierProvider(provider: TierProvider): void {
  tierProvider = provider;
}

/** Test-only: restore local-first defaults between tests. */
export function __resetDeploymentSeamForTests(): void {
  sessionProvider = DEFAULT_SESSION;
  tierProvider = DEFAULT_TIER;
}

/** The single sanctioned answer to "who is acting?". Local in M0. */
export function useCurrentActor(): Actor {
  return sessionProvider();
}

/** The single sanctioned answer to "what can this deployment do?". */
export function useCapabilities(): Capabilities {
  return capabilitiesFor(tierProvider());
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/use-current-actor.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Typecheck + lint**

Run: `npx tsc --noEmit`
Expected: exit 0.
Run: `npm run lint`
Expected: exit 0 (no unused vars/imports).

- [ ] **Step 6: Commit**

```bash
git add src/app/use-current-actor.ts src/app/use-current-actor.test.ts
git commit -m "feat: add session/tier registration seam + useCurrentActor/useCapabilities (M0)"
```

---

### Task 4: Source the actor in the activity-log producer

Wire the seam into the single activity producer WITHOUT serializing it: `useActivityLog` now calls `useCurrentActor()` and returns the actor as a new field. Entries are unchanged (not written into `appendActivity`), so localStorage bytes + golden fixtures are untouched. M1 flips this from returned-only to written-into-entries.

**Files:**
- Modify: `src/app/use-activity-log.ts`
- Test: `src/app/use-activity-log.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/app/use-activity-log.test.tsx`:

```tsx
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LOCAL_ACTOR, type Actor } from "./actor";
import { __resetDeploymentSeamForTests, setSessionProvider } from "./use-current-actor";
import { useActivityLog } from "./use-activity-log";

afterEach(() => {
  __resetDeploymentSeamForTests();
  window.localStorage.clear();
});

describe("useActivityLog actor sourcing", () => {
  it("exposes the local actor by default", () => {
    const { result } = renderHook(() => useActivityLog());
    expect(result.current.actor).toEqual(LOCAL_ACTOR);
  });

  it("exposes a registered pack actor", () => {
    const ada: Actor = { id: "u-1", kind: "user", displayName: "Ada" };
    setSessionProvider(() => ada);
    const { result } = renderHook(() => useActivityLog());
    expect(result.current.actor).toEqual(ada);
  });

  it("does NOT serialize the actor into stored entries (byte-stability)", () => {
    const { result } = renderHook(() => useActivityLog());
    act(() => {
      result.current.logActivity("task.created", "T-1");
    });
    const raw = window.localStorage.getItem("lop-app:activity-log");
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw as string);
    expect(parsed).toHaveLength(1);
    expect(Object.keys(parsed[0]).sort()).toEqual(["args", "id", "kind", "timestamp"]);
    expect(parsed[0]).not.toHaveProperty("actor");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/use-activity-log.test.tsx`
Expected: FAIL — `result.current.actor` is `undefined` (property does not exist yet).

- [ ] **Step 3: Write minimal implementation**

Edit `src/app/use-activity-log.ts`. Add the import near the existing imports (after line 13):

```ts
import { useCurrentActor } from "./use-current-actor";
import type { Actor } from "./actor";
```

Add `actor: Actor;` to the return type object of `useActivityLog` (inside the `: { … }` annotation, alongside `activityLog`):

```ts
export function useActivityLog(): {
  activityLog: ActivityEntry[];
  setActivityLog: Dispatch<SetStateAction<ActivityEntry[]>>;
  actor: Actor;
  logActivity: (kind: ActivityKind, ...args: (string | number)[]) => void;
  logActivityChanges: (
    kind: ActivityKind,
    changes: readonly FieldChange[],
    ...args: (string | number)[]
  ) => void;
  handleClearActivityLog: () => void;
} {
```

Inside the hook body, source the actor (add near the top of the body, after the `useState`/`useRef` lines):

```ts
  const actor = useCurrentActor();
```

Add `actor` to the returned object (the final `return { … }`):

```ts
  return { activityLog, setActivityLog, actor, logActivity, logActivityChanges, handleClearActivityLog };
```

Do NOT change `appendActivity`/`appendActivityEntry` calls — the actor is sourced only, never written into an entry.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/use-activity-log.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck + lint + guard existing behavior**

Run: `npx tsc --noEmit`
Expected: exit 0.
Run: `npm run lint`
Expected: exit 0.
Run: `npx vitest run src/app/workspace-section.characterization.test.tsx src/app/task-manager.characterization.test.tsx`
Expected: PASS — proves the task-manager→section contract is unchanged (adding a return field is backward-compatible).

- [ ] **Step 6: Commit**

```bash
git add src/app/use-activity-log.ts src/app/use-activity-log.test.tsx
git commit -m "feat: source current actor in activity producer (returned-only, not serialized) (M0)"
```

---

### Task 5: Boundary directory + dependency-cruiser rules + script

**Files:**
- Create: `src/pack/README.md`
- Create: `.dependency-cruiser.cjs`
- Create: `src/app/boundary-config.test.ts`
- Modify: `package.json` (devDep + script + scriptsDescriptions)

- [ ] **Step 1: Install dependency-cruiser**

Run: `npm install -D dependency-cruiser`
Expected: adds `dependency-cruiser` to `devDependencies`.

- [ ] **Step 2: Create the boundary directory placeholder**

Create `src/pack/README.md`:

```markdown
# `src/pack/` — deployment packs (cloud / team)

Reserved for OPTIONAL, additive deployment code (cloud sync, team/RBAC). Empty
until Module 1 (L0 cloud pack).

## The one-directional boundary rule (CI-enforced)

- A pack (`src/pack/**`) MAY import core (`src/app/**`).
- Core MUST NOT import any pack (`src/app/** → src/pack/**` is forbidden).
- Packs MUST NOT import each other (`src/pack/<X> → src/pack/<Y>` is forbidden).

Enforced by `.dependency-cruiser.cjs` via `npm run boundary:check` (blocking in
the CI quality stage). Core declares interfaces + registration points (e.g.
`setSessionProvider` in `src/app/use-current-actor.ts`, the storage-facade
backend port); a pack provides the implementation and REGISTERS it at runtime —
so the dependency always points pack→core, never core→pack.
```

- [ ] **Step 3: Write the failing config test**

Create `src/app/boundary-config.test.ts`:

```ts
import { describe, expect, it } from "vitest";
// The dependency-cruiser config lives at the repo root (CommonJS).
import config from "../../.dependency-cruiser.cjs";

type ForbiddenRule = { name: string; from: { path?: string }; to: { path?: string } };

describe(".dependency-cruiser config", () => {
  const rules = (config as { forbidden?: ForbiddenRule[] }).forbidden ?? [];

  it("forbids core importing a pack", () => {
    const rule = rules.find((r) => r.name === "core-no-import-pack");
    expect(rule).toBeDefined();
    expect(rule?.from.path).toBe("^src/app");
    expect(rule?.to.path).toBe("^src/pack");
  });

  it("forbids a pack importing another pack", () => {
    const rule = rules.find((r) => r.name === "pack-no-cross-import");
    expect(rule).toBeDefined();
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run src/app/boundary-config.test.ts`
Expected: FAIL — cannot find module `../../.dependency-cruiser.cjs`.

- [ ] **Step 5: Create the dependency-cruiser config**

Create `.dependency-cruiser.cjs`:

```js
/**
 * Import-boundary rules for the local-first / pack separation (Module 0).
 * Core (`src/app`) must never depend on a pack (`src/pack`); packs must not
 * depend on each other. Run via `npm run boundary:check` (blocking in CI).
 */
module.exports = {
  forbidden: [
    {
      name: "core-no-import-pack",
      severity: "error",
      comment: "Core (src/app) must not import deployment packs (src/pack).",
      from: { path: "^src/app" },
      to: { path: "^src/pack" },
    },
    {
      name: "pack-no-cross-import",
      severity: "error",
      comment: "A pack must not import a different pack (packs stay independent).",
      from: { path: "^src/pack/([^/]+)/.+" },
      to: { path: "^src/pack/([^/]+)/", pathNot: "^src/pack/$1/" },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: {
      extensions: [".ts", ".tsx", ".js", ".jsx", ".json"],
    },
  },
};
```

- [ ] **Step 6: Run the config test to verify it passes**

Run: `npx vitest run src/app/boundary-config.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 7: Add the `boundary:check` script + description**

Edit `package.json`. In `"scripts"`, add after the `"size:check"` line (add a comma to the previous line):

```json
    "size:check": "node scripts/check-file-sizes.mjs",
    "boundary:check": "depcruise src --config .dependency-cruiser.cjs --output-type err"
```

In `"scriptsDescriptions"`, add after the `"size:check"` line (add a comma to the previous line):

```json
    "size:check": "Fail if a src file exceeds 800 lines or grows past its baselined size (ratchet)",
    "boundary:check": "Enforce the core/pack import boundary (src/app must not import src/pack; packs must not import each other) via dependency-cruiser"
```

- [ ] **Step 8: Run the gate — verify green from empty**

Run: `npm run boundary:check`
Expected: exit 0, no violations reported (nothing in `src/pack/` yet).

- [ ] **Step 9: Prove the gate BITES (temporary negative check)**

Temporarily create `src/pack/cloud/probe.ts` and `src/app/__boundary_probe__.ts`:

`src/pack/cloud/probe.ts`:
```ts
export const PROBE = 1;
```
`src/app/__boundary_probe__.ts`:
```ts
export { PROBE } from "../pack/cloud/probe";
```

Run: `npm run boundary:check`
Expected: FAIL (exit non-zero) naming `core-no-import-pack` on `src/app/__boundary_probe__.ts → src/pack/cloud/probe.ts`.

Then DELETE both probe files:
```bash
rm src/app/__boundary_probe__.ts src/pack/cloud/probe.ts
```
(Use PowerShell `Remove-Item` if `rm` is unavailable.) Re-run `npm run boundary:check` → exit 0.

- [ ] **Step 10: Regenerate script docs**

Run: `npm run docs:scripts`
Then verify: `npm run docs:scripts:check`
Expected: exit 0 (tables in sync with the new script + description).

- [ ] **Step 11: Typecheck + full lint**

Run: `npx tsc --noEmit`
Expected: exit 0.
Run: `npm run lint`
Expected: exit 0.

- [ ] **Step 12: Commit**

```bash
git add src/pack/README.md .dependency-cruiser.cjs src/app/boundary-config.test.ts package.json package-lock.json
git add -A   # picks up regenerated docs tables from `npm run docs:scripts`
git commit -m "feat: add core/pack import boundary + dependency-cruiser gate (M0)"
```

---

### Task 6: Wire the gate into CI + update AGENTS.md

**Files:**
- Modify: `.gitlab-ci.yml`
- Modify: `AGENTS.md`

- [ ] **Step 1: Inspect the existing quality stage**

Run: `git grep -n "lint\|typecheck\|quality" .gitlab-ci.yml`
Read the job that runs `npm run lint` / `tsc` in the `quality` stage — mirror its `image`, `stage`, `needs`, and `rules` (including the `quality-gate-bypass` escape-hatch block if present).

- [ ] **Step 2: Add the boundary job**

In `.gitlab-ci.yml`, add a job in the `quality` stage mirroring the lint job. Template (adapt keys — `stage`/`needs`/`rules`/`image` — to match the sibling lint job exactly):

```yaml
boundary:check:
  stage: quality
  needs: ["install"]
  script:
    - npm run boundary:check
  rules:
    # mirror the sibling lint/typecheck job's rules block (incl. quality-gate-bypass)
```

- [ ] **Step 3: Update the AGENTS.md CI hard-constraint line**

In `AGENTS.md`, find the `**CI is GitLab**` hard-constraint bullet listing the quality gates (`lint · typecheck · semgrep · dependency-audit · file-size-ratchet · duplication-gate · unit`). Add `· **import-boundary**` to that enumerated list. Keep the trailing "New CI gate → also update this line." sentence.

- [ ] **Step 4: Verify the gate command still passes locally**

Run: `npm run boundary:check`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add .gitlab-ci.yml AGENTS.md
git commit -m "ci: run import-boundary gate in the quality stage (M0)"
```

---

### Task 7: Full local gate sweep (parity with CI)

No new files. Confirm zero behavior change + all ratchets green before release prep.

- [ ] **Step 1: Unit suite**

Run: `npm run test:run`
Expected: PASS (all suites, incl. the new actor/deployment/seam/activity/boundary tests + existing golden + characterization).

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0 (incl. i18n EN/DE parity — untouched here).

- [ ] **Step 3: Lint (CI parity, warnings fatal)**

Run: `npm run lint`
Expected: exit 0.

- [ ] **Step 4: Ratchets**

Run: `npm run size:check`
Expected: exit 0 (new files are small; no baselined file grew).
Run: `npm run dup:check`
Expected: exit 0 (under threshold).
Run: `npm run boundary:check`
Expected: exit 0.

- [ ] **Step 5: Coverage floor (the new pure files are gated)**

Run: `npm run test:coverage`
Expected: PASS — global floors (lines 92 / funcs 91 / branches 80 / stmts 89) hold. `actor.ts`, `deployment.ts`, `use-current-actor.ts` are covered by their direct tests; `use-activity-log.ts`'s new lines are covered by `use-activity-log.test.tsx`.

If any floor regresses: add the missing case to the relevant `*.test.ts` (do NOT lower a threshold). Re-run.

- [ ] **Step 6: No commit** (verification only). If any step failed, fix in its owning task before proceeding.

---

### Task 8: Release prep (version + CHANGELOG) — run only when the user says "release"

Module 0 ships as a normal release but carries NO user-facing highlight key (internal foundation). Push / MR / merge are the user's explicit trigger — this task only prepares the artifacts.

**Files:**
- Modify: `src/app/version.ts`
- Modify: `package.json`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Choose a unique milestone codename**

Run: `git grep -n "milestone" src/app/version.ts` and skim `CHANGELOG.md` headers.
Pick the next version (`0.184.0`) and an UNUSED author codename. Verify uniqueness:
Run: `grep -i "\"<candidate-name>\"" CHANGELOG.md` → expect NO match before using it.
(Codenames must be globally unique per release block — see prior "Palmer" dedupe.)

- [ ] **Step 2: Bump `src/app/version.ts`**

Set `APP_VERSION` to `0.184.0` and the milestone/codename fields to the chosen name. Do NOT add a `versionHighlight*` key and do NOT touch `APP_HIGHLIGHT_KEYS` (no user-facing highlight for this internal release).

- [ ] **Step 3: Bump `package.json` version**

Set `"version": "0.184.0"`.

- [ ] **Step 4: Add the CHANGELOG entry**

Prepend a `0.184.0 "<codename>"` entry under the latest section describing: core/pack import boundary + CI gate, actor abstraction, deployment tier→capabilities, session/tier registration seam. Mark it as internal infrastructure (no user-visible change).

- [ ] **Step 5: Verify version/i18n tests**

Run: `npx vitest run src/app/version.test.ts` (or the version/i18n test files if named differently — `git grep -l "APP_VERSION" src`).
Run: `npx tsc --noEmit`
Expected: PASS / exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/app/version.ts package.json CHANGELOG.md
git commit -m "chore(release): 0.184.0 \"<codename>\" — M0 separation boundary foundation"
```

- [ ] **Step 7: STOP.** Do not push / open an MR / merge. Report completion and await the user's explicit "release" instruction.

---

## Self-review notes

- **Spec coverage:** pack dir + depcruise gate (Task 5) · CI gate (Task 6) · actor abstraction (Task 1) · capability/tier (Task 2) · registration seam (Task 3) · activity-log producer sourcing the actor (Task 4, refined to returned-only per the serialization non-goal) · boundary-contract doc (Task 5 README) · testing + coverage (Task 7) · rollout/version (Task 8). All spec sections map to a task.
- **Refinement vs spec:** spec §2 said "wire the activity log's who through useCurrentActor as the single producer." Implemented as *sourced-and-returned* (not written into entries) because `saveActivityLog` JSON-stringifies whole entries — writing the actor would serialize it (violates the spec non-goal) and dropping-after-read would trip the unused-var lint gate. Same intent (the producer hook owns actor acquisition); M1 flips returned-only → written-into-entries. Spec doc updated to match.
- **Type consistency:** `Actor` (Task 1) is imported unchanged in Tasks 3 & 4. `capabilitiesFor` (Task 2) is the only resolver, consumed in Task 3. `setSessionProvider`/`setTierProvider`/`__resetDeploymentSeamForTests` names match across Tasks 3 & 4 tests. `useActivityLog` return field `actor` name matches between Task 4 impl + test.
- **No placeholders:** every code step contains full content; the only `<codename>` placeholder is a deliberate release-time human choice (Task 8) with a uniqueness-check step.
