# Tiptap lazy-loading and the entry bundle — design

**Follow-up:** `docs/open-followups.md` §129 — "Six of the eight `RichTextEditor` call sites import it
statically, so Tiptap SSRs and ships in the initial bundle".

**Status:** design approved 2026-08-19. Not yet planned or implemented.

**Branch:** `perf/tiptap-lazy-bundle`, off `d20ab9c1` (main at 0.248.0 "Bujold").

---

## The question this slice answers

§129 ends with an instruction, and it is the whole reason this is a slice rather than a rider:

> **The real question is bundle weight, and it is UNMEASURED.** … Nobody has measured the delta.
> **Measure before deciding** — a conversion argued from "Tiptap is big" rather than from a number is
> the same class of reasoning that put the wrong mechanism in §54.

So this slice produces a **number** first and a code change only if the number justifies one. Both
endings are successes. Closing §129 as WON'T DO with a measurement attached is a better outcome than
converting six files on the strength of "Tiptap is large".

## What §129's own table does not say

§129 classifies the eight consumers by **import style**. Import style is not what puts bytes in the
entry chunk — **reachability from the entry** is. Traced on `d20ab9c1`:

| Consumer | Chain to the entry | In the initial graph? |
|---|---|---|
| `task-form-fields.tsx` | `task-manager` → `app-modals` → `task-form-modal` | **yes, fully static** |
| `note-log-panel.tsx` | `task-manager` → `notes-window` | **yes, fully static** |
| `dashboard-sections/dashboard-narrative.tsx` | `workspace-section` → `dashboard-panel` | **yes, fully static** |
| `milestone-edit-modal.tsx` | `workspace-section` → `milestones-panel` | **yes, fully static** |
| `change-edit-modal.tsx` | `ChangePanel`, `dynamic()` in `workspace-panels.tsx` | no — behind a lazy boundary |
| `raid-edit-modal.tsx` | `RaidPanel`, `dynamic()` in `workspace-panels.tsx` | no — behind a lazy boundary |
| `meeting-report-panel.tsx` | already `dynamic(… ssr:false)` at the editor | no |
| `settings-sections/comm-templates-section.tsx` | already `dynamic(… ssr:false)` at the editor | no |

Reproduce the consumer set and the two existing dynamic sites with §129's own commands. Reproduce the
chains with:

```bash
grep -rn "from \"\./\(app-modals\|notes-window\|task-form-modal\)\"" src/app --include=*.tsx | grep -v '\.test\.'
grep -n "dynamic(" src/app/workspace-panels.tsx        # the 24 lazy panels — ChangePanel and RaidPanel among them
grep -rn "lazy(" src/app --include=*.tsx --include=*.ts | grep -v '\.test\.'   # empty: there is no React.lazy in this repo
```

★★ **Two of §129's six are already behind a lazy panel boundary, so converting them is expected to
move nothing.** They are not wrong as written — their import style really is static — but a slice that
converts "the six" and reports a win cannot attribute it. The four static chains are the unit of work.

★ **No `React.lazy` exists anywhere in `src/app`.** Every lazy boundary in this app is `next/dynamic`,
and 24 of them live in one registry (`workspace-panels.tsx`). AGENTS.md's phrase "the lazy panels"
means that file. Do not reach for `React.lazy` here for consistency's sake — it has no precedent in
this repo.

★ A shared chunk can defeat the whole exercise. If Tiptap ends up in a common chunk that the entry
still loads — because the four convert but a lazy panel and the entry now both want it — the route's
First Load JS can fall while the shared line rises by the same amount. **That is a null result, and it
looks like a win if only one line is read.** Read both.

## Non-goals, stated because §129 warns about each

- **This does not fix §54** (the prod-only CSP `<style>` defect). `useEditor` runs with
  `immediatelyRender: false`, so Editor construction — and therefore `injectCSS()` — is deferred to
  mount under *both* import styles. `ssr: false` changes where the component renders, not where Tiptap
  injects. Reading this slice as an alternative fix for §54 is the trap §129 names.
- **This does not retire the `typeof document` guard in `csp-nonce.ts`.** It costs one line, it makes
  the function total, and it is what stops a future static import silently reintroducing the SSR call.
- **This does not touch `rich-text-editor.tsx` itself.** In particular the `{editor && <RichTextToolbar …>}`
  guard stays exactly as it is; the comment above it records that the guard, not the
  `immediatelyRender` flag, is what makes the hydration render safe.

## Architecture

```
rich-text-editor.tsx          unchanged — Tiptap, useEditor, immediatelyRender:false
        ▲ dynamic import boundary  (ssr:false)
rich-text-editor-lazy.tsx     NEW — the single wrapper
        ▲ static import
the consumers                 import-path swap only, one line each
```

### The new module

`src/app/rich-text-editor-lazy.tsx`:

```tsx
"use client";
import dynamic from "next/dynamic";
import { Skeleton } from "./skeleton";

const loading = () => <Skeleton className="min-h-40 rounded-md" />;

export const RichTextEditor = dynamic(
  () => import("./rich-text-editor").then((m) => m.RichTextEditor),
  { ssr: false, loading },
);
```

Module-scope `loading` const, mirroring `workspace-panels.tsx`. The fallback is prop-less and
decorative — there is no `lang` in this module scope and nothing for it to announce.

★ **Name checked against the `.ts`-shadows-`.tsx` landmine.** `ls src/app/rich-text-editor-lazy.*`
returns nothing today; a bare `./rich-text-editor-lazy` import resolves `.ts` ahead of `.tsx`, so a
future pure module of that name would hijack this component. Keep the name distinct if one is ever
needed.

### Why one shared module rather than six copies

The block that would be copied already exists verbatim in two files:

```tsx
loading: () => <div className="min-h-40 rounded-md border border-line bg-surface-muted" />,
```

Converting four more per-site takes that from 2 copies to 6. One shared module takes it to 0: the two
existing sites collapse onto the wrapper as part of this slice. That is fewer duplicated lines for
`dup:check`, one place to change the fallback, and no way for six fallbacks to drift apart.

### Rejected alternatives

**Per-site `dynamic()`.** Matches today's local pattern exactly and needs no new file. Rejected: six
near-identical blocks in a repo whose duplication gate reads total duplicated lines, and six
independent chances for the fallback to diverge.

**Lazy the consumers instead of the editor** — `dynamic()` the task modal, the notes window, the
milestones panel, the narrative. Would evict more than Tiptap from the entry. Rejected: it changes
modal mount timing across the app, which is a far larger behavioural surface than §129 describes and
lands squarely on the standing "confirm before altering any window's layout, chrome or empty state"
constraint. If the measurement shows the four-site conversion is worth having, this is a candidate
follow-up entry, not part of this slice.

## The fallback

`src/app/skeleton.tsx` exports `Skeleton({ className })` alongside `PanelSkeleton({ lang, rows })`.
The editor fallback uses `Skeleton`, so a loading editor shimmers exactly as a loading view does —
the same treatment the 24 lazy panels already give the user, rather than a second, flat, motionless
loading idiom.

The two existing sites' flat `bg-surface-muted` box is replaced by this, which is a deliberate small
visual change to two surfaces (the meeting-report pane and the comm-templates settings section) in
the direction of consistency.

## Measurement method

`next build` prints a route table with **Size** and **First Load JS** per route, plus a shared-chunk
summary. Three pages exist — `/`, `/recovery`, `/msal-redirect` — and `/` is the application.

1. Build `d20ab9c1` clean, record `/`'s First Load JS and every shared-chunk line.
2. Apply the conversion, build clean again, record the same figures.
3. Report the delta on **both** `/` and the shared lines. A fall in one matched by a rise in the other
   is a null result (see the shared-chunk star above), not a win.

No bundle analyzer is installed and none is added — that would be a new dependency and therefore
`dependency-audit` surface, for a number `next build` already prints. Builds are run clean (remove
`.next` between them) so a stale cache cannot contribute to the delta.

**Both figures go into §129 whatever the outcome**, so nobody re-derives the import graph a third time.

## Decision rule

Approved: **any real reduction, judged on the number.**

- Tiptap genuinely leaves the entry graph → ship the conversion, record the figure, close §129.
- The delta is noise, or a shared chunk keeps it in the entry graph anyway → **revert the four
  conversions** and close §129 as WON'T DO, with the measurement as the evidence and the import-graph
  table above preserved in the entry.

★ **"Revert" means the four static-chain conversions ONLY.** The wrapper module and the two
already-dynamic sites moving onto it are a pure de-duplication with no effect on any chunk — 2 copies
of the fallback block become 0 either way — so that half is kept regardless of the number. Reverting
it would restore duplication in exchange for nothing. This is stated because "revert the product code"
reads as though it covers both, and it does not.

No numeric floor is fixed in advance, deliberately: a bar picked before seeing the number is arbitrary,
and a modest reduction on the entry chunk of an app that people open cold is not self-evidently
worthless.

## Testing

Test cost is **not uniform across the four**, and this was measured rather than assumed:

| Suite | Today | Expected after |
|---|---|---|
| `meeting-report-panel.test.tsx` | `vi.mock`s `./rich-text-editor`, renders synchronously | unchanged — the mock resolves the same module id through the boundary |
| `comm-templates-section.test.tsx` | already behind `dynamic()` | unchanged |
| `note-log-panel.test.tsx` | mocks `use-push-to-talk`, not the editor | likely needs `await findBy…` |
| `milestone-edit-modal.test.tsx` | mocks `use-settings` / `use-ms-auth`, not the editor | likely needs `await findBy…` |
| `task-form-fields.test.tsx` | mocks nothing — mounts **real Tiptap in jsdom** | needs `await findBy…` |
| `dashboard-narrative.test.tsx` | mocks nothing — mounts **real Tiptap in jsdom** | needs `await findBy…` |

The last two are where the real work is. Each row of this table is re-measured during implementation
rather than trusted from here — "likely" means likely.

★★ **Every converted assertion is checked for vacuity.** A `findBy` that resolves against the
*skeleton* instead of the editor passes while proving nothing, and it passes just as happily with the
component it claims to await deleted. The check is the standard one: make the assertion fail on
purpose (stub the editor away, or assert on a control that only the real editor renders) and confirm
it goes red.

★ There is a second, quieter risk in this direction: a suite that currently mounts real Tiptap is
implicitly testing that Tiptap mounts at all. After conversion it may pass while never resolving the
chunk. At least one assertion per converted suite must observe something only the loaded editor
produces.

## Risk

Low and reversible.

- **No autofocus-on-mount exists** in `rich-text-editor.tsx` or in any of the six consumers — the only
  `.focus()` calls are inside explicit user commands (link insert, merge-field chip). The usual failure
  mode of a lazily-loaded editor, a delayed chunk arriving after focus has moved, therefore does not
  apply. Verified with a grep across the editor and all four static consumers.
- `ssr: false` under the Next 16 App Router is already in production use twice in this codebase, in
  client components, with the same wrapper shape.
- The revert is an import-path swap plus deleting one file.

**Two things are explicitly NOT claimed here and must be run, not reasoned:**

1. **`prod-smoke`.** It is the only gate that sees the production CSP, and this slice changes *how* a
   `<style>`-injecting component loads. §54 lives in exactly this seam. `npm run e2e:smoke:prod`
   before shipping — build first, it does not build.
2. **`size:check`.** A new file is added and four are edited. The gate counts `readFileSync().split("\n").length`,
   i.e. one more than `wc -l`; budget from that number, not from `wc -l`.

Also to be run rather than assumed: `npx tsc --noEmit` (a component whose type now comes through
`dynamic()` can lose prop inference), `npx eslint --max-warnings=0 src/app`, and `dup:check` — the
last one to confirm the wrapper *lowers* duplication as intended rather than merely relocating it.

## Release posture

If the conversion ships, it is a user-visible behavioural change (loading states on four surfaces) and
warrants a version bump across all eight sites that carry a version — `version.ts`, `CHANGELOG.md`,
`package.json`, `package-lock.json` (twice), the README shields badge with its codename, and the five
`docs/CODEMAPS/*.md` headers. No gate checks any of them.

If it does not ship, the slice is docs-only — §129 updated with the measurement — and takes **no bump**.

## Out of scope, recorded so it is not re-derived

- The two lazy-panel-boundary sites (`change-edit-modal`, `raid-edit-modal`) are left on static imports.
  They are already off the entry graph; converting them would be churn.
- Auditing what *else* rides the entry chunk. Real, and a plausible next slice, but §129 is about Tiptap.
- §54 and the `csp-nonce.ts` guard, per the non-goals above.
