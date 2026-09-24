# Hash-view cold apply: gate it on hydration — design

**Date:** 2026-09-20
**Register entries:** §535, §536, §540, plus one new entry (§595, number to be re-checked against
`origin/main` immediately before push)
**Branch:** `fix/hash-view-cold-apply`

## Problem

`useHashView` (`src/app/use-hash-view.ts`) decides, once per page load, what an incoming URL fragment
means: a view-only hash (`#raid`) is discarded as stale session residue and the user lands on the
Dashboard, while an item-bearing hash (`#raid/123`) is honoured as a deep link. That decision is the
"cold apply". Everything below is one consequence of the cold apply running **before the user's real
settings are known**, plus one passive effect that writes the URL before the decision has been made.

### The enabling fact

`use-settings.ts:171` seeds its state non-lazily:

```ts
const [settings, setSettings] = useState<Settings>(defaultSettings);
```

The persisted settings arrive later, inside an async effect (`use-settings.ts:208-380`) that awaits
`localStorage` plus secret-store hydration. `settings-types.ts:731` sets `defaultSettings.layout` to
`"modern"`. The single production call site is `task-manager.tsx:247`:

```ts
useHashView(settings.layout === "modern", settings.features);
```

So `enabled` is `true` on the hook's first executed run **for every user**, including one whose stored
layout is `"classic"`. A real classic-layout load runs `enabled: true → false`, never `false → true`.

### The four defects

**§535 — a cold item deep link loses its item, and under StrictMode its view too.**
The apply effect is a `useLayoutEffect` and the view→hash write is a passive `useEffect`, so on the
first commit the cold apply does see the original `#raid/123` and calls `setActiveTab("raid")`. That
state has not committed yet, so the passive effect runs in the same commit with `activeTab` still
`"dashboard"`, finds `parseHash(hash).view !== activeTab`, and `replaceState`s the URL to `#dashboard`.
The tab change then commits, the passive effect re-runs, and writes the bare `#raid` — the item id is
gone. Under StrictMode (the dev app router, and therefore Playwright's dev server) the remount's warm
apply reads the already-clobbered `#dashboard` and lands the user on the Dashboard.

**§536 — a classic-layout load still gets a cold apply.** The symptom filed is real: a stale view-only
hash lands the user on the Dashboard, and an item-bearing hash left by `requestOpen` reopens that item.
The mechanism filed is **refuted**. §536 argues the first classic→modern switch is the page's first
enabled window (`false → true`). Per the enabling fact above, the true sequence is `true → false`: the
cold apply fires immediately against `defaultSettings`, and only then does hydration flip the layout to
classic. The `enabled: false` initial-props scenario that two hook tests pin cannot occur on any real
mount. Commit `0666ed320` already described that case as "a defensive addition", not a traced bug.

**§595 (new) — the cold rule is judged against default `features`.** `features` is read only inside the
apply effect, for two decisions: the blank-hash target (`dashboard`, or `open-points` when the dashboard
module is off) and the disabled-target bail (`if (features && !isViewEnabled(view, features)) return;`).
At the time of the cold apply, `features` is `defaultSettings.features`. A re-run on a new `features`
identity takes the warm path — `pageColdDoneRef` is already set — so the decision is never revisited. A
user who has disabled the dashboard module is still landed on the Dashboard, and a hash naming a module
they disabled is still honoured. No register entry covers this; it is filed and closed on this branch.

**§540 — a repeated resource deep link re-runs the open.** `ResourceDirectory` is conditionally mounted
(`workspace-section.tsx:525`, `{activeTab === "directory" && (…)}`), so it remounts on the tab switch the
request itself causes and no per-mount ref can recognise a repeat. `pendingOpen` is a request object
(`workspace-tab-context.tsx:20`), set by `requestOpen` and cleared by the directory effect that consumes
it. The editor state lives above both, in `use-resource-directory.ts:144`:

```ts
const [editingResource, setEditingResource] = useState<{ resource: Resource; isNew: boolean } | null>(null);
```

§540 names `task-manager.tsx` as the guard site; that is wrong — `task-manager.tsx` only threads the
value through. `resource-edit-modal.tsx:65-74` resets its draft by **reference** equality in a
render-time reconcile, so a same-object repeat is harmless; a draft is lost only when a concurrent
writer (AI, sync, another tab) replaced the stored row and the link is then repeated.

## Root cause

One sentence: **the cold apply runs before hydration, and the passive view→hash effect writes the URL
before the cold apply has decided.**

## Approach

Considered and rejected:

- **Re-judge after hydration.** Keep today's render-1 apply and add a corrective second pass when
  `hydrated` flips. Rejected: two applies mean a visible flash of the wrong view, a `requestOpen` may
  already have fired for an item on a disabled module, and it layers a second state machine on the one
  that produced §478, §535 and §536.
- **Per-entry minimal fixes.** Fix §535's ordering and §540's guard, re-file §536 with the corrected
  mechanism, defer the rest. Rejected: closes §536 by rewriting the entry rather than the code, and
  leaves §595 unfixed.

Taken: **gate the cold apply on hydration.**

## Design

### `use-hash-view.ts`

1. **Snapshot the incoming hash at mount** into a ref, before any effect can write. The cold apply reads
   the snapshot. Warm applies and the `hashchange`/`popstate` listeners keep reading
   `window.location.hash` live — those are genuine navigations and must not see a stale value.

   This is load-bearing, not defensive. The apply effect currently reads the hash live
   (`const raw = currentHash();`, with `currentHash()` returning `window.location.hash`), and today that
   is safe only because the layout effect runs before the passive one on the first commit. Deferring the
   cold apply to a post-hydration commit removes that guarantee: the passive effect would have run and
   overwritten the URL first.

2. **`useHashView` takes `hydrated`.** `task-manager.tsx:247` passes the flag `useSettings` already
   returns (`use-settings.ts:167`, returned at `:504`). It flips only after the secret merge resolves —
   the file's own comment at `:425-427` says consumers "never observe a half-loaded settings object" —
   and it always flips, including the no-persisted-settings path at `:453`. While `hydrated` is false the
   apply effect does nothing.

3. **The cold apply runs on the first executed run after hydration**, against the user's real `features`.
   `pageColdDoneRef` keeps it once per page load, as today.

4. **The passive view→hash effect is suppressed until `pageColdDoneRef` is set.** No URL rewrite before
   the cold decision exists. This single change is what stops the pre-hydration hash being eaten and what
   removes §535's clobbering write.

5. **After the cold apply routes, the passive effect stays quiet until `activeTab` has reached the applied
   view**, so the bare-`#raid` rewrite never happens and the item id survives. `requestOpen` already
   writes `buildHash(view, id)` itself (`workspace-tab-context.tsx:68`), so once the passive effect stops
   fighting it the URL is correct without the hook writing it.

Unchanged: the MSAL auth-response guard in both effects, `reentryRepairRef` and all §478 re-entry
behaviour, `replaceState` firing neither `hashchange` nor `popstate`, back/forward staying warm, the
popout early-return.

A classic user's hook now never reaches an enabled window at all, because hydration resolves
`layout: "classic"` before anything applies. That is §536 fixed at its real mechanism.

### `use-resource-directory.ts`

Guard the `handleEditResource` path (`:167`): skip the open when `editingResource` is non-null, is not
`isNew`, and carries the same id as the requested resource.

**Deliberate consequence, to be recorded in the §540 closure:** skipping leaves the previous object in
`editingResource`, so when a concurrent writer has replaced that row the editor shows a stale copy rather
than wiping the user's draft. Preserving the draft is what §540 asks for; the staleness is the price and
is documented rather than discovered.

## Testing

### Hook tests (`src/app/use-hash-view.test.tsx`)

Existing tests, labelled:

- **DELETE** — `is cold on the first enabled window even when the page loaded disabled and the cold
  target is not the default tab`. Pins a mount sequence that cannot occur.
- **MIGRATE** — `applies the cold rule on the first EXECUTED run, not the first render`. Its motivating
  case (feature-identity churn on an already-enabled modern window, per `0666ed320`) is still real;
  rephrase to "first executed run after hydration".
- **KEEP UNCHANGED** — the §478 set: both re-entry tests, back/forward-after-re-entry, the StrictMode
  re-entry test, `does not reopen an item-bearing hash left by requestOpen during classic`, the MSAL
  test, the disabled and popout tests. Their staying green unchanged is the no-regression evidence.

New tests:

- Before hydration the hook does nothing: no `setActiveTab`, no `requestOpen`, no `replaceState`. After
  `hydrated` flips there is **exactly one** cold apply. The count is the positive observable — a
  zero-calls assertion alone would also pass against a hook that never runs at all.
- A classic user never reaches an enabled window: hydration resolves `layout: "classic"`, no apply of any
  kind occurs. (§536)
- The cold rule uses real `features`: with the dashboard module off, a view-only hash lands on
  `open-points`; a hash naming a module the user has disabled is ignored. (§595)
- A cold `#raid/123` leaves `activeTab === "raid"` **and** the URL ending in `/123`, with no intermediate
  `#dashboard` in the `replaceState` call log. (§535)
- The same under StrictMode, mounted via `wrapper: StrictMode` or RTL's `reactStrictMode: true` — never a
  composed wrapper, which AGENTS.md records as vacuous-but-green. (§535)
- A `hashchange` after mount is read live, not from the snapshot — this pins the snapshot's scope and
  fails a fix that over-caches.

Every new guard gets a named mutant, proved red one at a time and reverted byte-for-byte.

### Resource tests (`src/app/resource-directory.test.tsx`)

`KNOWN RESIDUAL: re-fires the edit handler for a repeated deep-link to the resource whose editor is
already open` (`:634`) inverts: `toHaveBeenCalledTimes(2)` becomes `1`, and the title loses its
`KNOWN RESIDUAL` prefix. It must keep exercising the real `resources` → `directory` hop rather than a
statically mounted directory, since the remount is the reason the guard cannot live in the panel.

### Playwright (`e2e/hash-deep-link.spec.ts`)

A new spec file is picked up by the chromium project automatically — `testDir: "./e2e"` with no
`testMatch` on that project; only `visual.spec.ts` and `desktop-smoke.spec.ts` are carved out — so it
gates the MR in the CI `e2e` job. The `webServer` is `npm run dev` (`playwright.config.ts:80`), which
means the dev app router and therefore **live StrictMode**: §535's headline symptom is directly
observable rather than reasoned.

Cases: a cold `#raid/<id>` lands on the RAID view with the id still in the URL; a classic-layout load
with a stale hash stays where it is; a repeated `#resources/<id>` keeps an in-progress draft and does not
re-open the editor.

**Known risk, to be resolved in the plan rather than discovered during it:** the classic-layout case needs
`settings.layout` persisted before first paint. `e2e/seed.ts` seeds file-mode workspace data; whether it
can seed settings is unverified. If it cannot, that case stays hook-level and the spec covers the other
two. The plan's first task must establish this before the spec is written.

## Documentation and register

- Close **§535** and **§540**. §540's closure corrects its wrong guard site (`task-manager.tsx` →
  `use-resource-directory.ts`) and records the stale-row trade above.
- Close **§536** recording that its stated mechanism was **refuted**, with the evidence
  (`settings-types.ts:731`, `use-settings.ts:171`, `task-manager.tsx:247`). The original body is
  preserved under the register's `_Original finding, as filed …_` convention; the correction is dated.
  A future reader who inherits the wrong premise would go looking for a `false → true` transition that
  never happens.
- File and close **§595** for the default-`features` cold landing. Its number is re-checked against
  `origin/main` immediately before push, because a § is reserved only once it is on `origin/main`.
- Add a dated note to **§478**'s closure: its "an async settings load starts the hook disabled" rationale
  is refuted by the same evidence.
- Fix `resource-edit-modal.tsx`'s header comment, which claims the draft sync happens in a `useEffect`;
  it is a render-time reconcile.
- Check whether AGENTS.md's remount-swallow bullet should name the new `hydrated` gate. Decide in the
  plan; do not add prose speculatively.

Every closed entry drops its `**Work item:**` line and its index row flips to `**CLOSED** 2026-09-20`.
The GitLab issues are #325 (§535), #326 (§536) and #330 (§540); `Closes #NN` appears only in the MR
description, never in a commit message. Each issue's state is verified after the merge.

## Out of scope

- The wider storage-backend race cluster (§548, §588–§591) — another session owns it.
- Any change to `requestOpen`'s own `replaceState` in `workspace-tab-context.tsx` beyond what the hook
  needs; it is the other real hash writer in `src/` and is left alone.
- `safe-mode.ts`, which reads the hash and never writes it.

## As shipped (2026-09-20)

Two prescriptions above were superseded during implementation. Recorded here rather than edited into
the sections above, which describe the plan as written, not the code as it landed.

- **No hash snapshot.** The design's `use-hash-view.ts` point 1 called for snapshotting the incoming
  hash into a ref at mount, read only by the cold apply, so a post-hydration apply could not see a URL
  the passive effect had already overwritten. That mechanism was not built. Instead, `pendingApplyRef`
  (armed by the apply effect only when its routed view differs from the current tab, consumed by the
  view→hash passive effect as a suppress-while-in-flight guard) makes the snapshot unnecessary: the
  passive effect no longer runs ahead of a routing apply at all, so there is nothing for a snapshot to
  protect against. A snapshot would also have had a real cost the design did not weigh: it would ignore
  a hash a user or script edited during the pre-hydration window, where the shipped guard reads
  `window.location.hash` live throughout and only ever suppresses the one write that would otherwise
  race the routing `setActiveTab`.
- **The gate is folded into `enabled`, not a third parameter.** The design's point 2 had `useHashView`
  take `hydrated` as its own argument alongside `enabled` and `features`. The call site instead passes
  `hydrated && settings.layout === "modern"` as the existing `enabled` argument — `useHashView` keeps its
  original two-parameter signature. This reads as the more direct fix for what the entries actually
  named: `enabled` was already supposed to mean "the hook may act now"; a page mid-hydration was never a
  case the hook itself needed to distinguish from a disabled layout, since both mean the same thing to
  it — do nothing yet.

The spec's own DELETE/MIGRATE labels for the two `use-hash-view.test.tsx` tests were also retired in
favour of a smaller diff, for both tests, not just one. `is cold on the first enabled window even when
the page loaded disabled and the cold target is not the default tab` (labelled DELETE) was kept, with
only its comment rewritten: since the call site is now gated on `hydrated`, that `enabled: false`
initial-props scenario is no longer a hypothetical defensive case but the real startup path every page
load takes (see §478 and §536's closures). `applies the cold rule on the first EXECUTED run, not the
first render` (labelled MIGRATE, to be rephrased) was left untouched, byte-for-byte, comment included —
its own §478-era comment about a Classic→Modern switch making the first executed run cold still holds
under the gate, and a rewrite was judged to add words without changing what the test proves. Every other
design decision above — the resource-directory guard shape, the register closures, the Playwright bar —
landed as specified.
