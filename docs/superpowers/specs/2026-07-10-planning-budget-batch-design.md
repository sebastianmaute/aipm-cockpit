# Planning / Budget UX + Data Batch — Design

**Date:** 2026-07-10
**Status:** Approved (design), pending spec review → plan
**Target:** one batched minor release

## Goal

Five focused improvements to the **planning** (`resources-panel.tsx`) and **budget**
(`budget-panel.tsx`) views: a mode-aware suffix on planning inputs, left-aligned date
headers in both views, an opt-in "budget follows plan" live mirror, and a bucket-name
search box.

## Scope — the five slices

### Slice 1 — Suffix symbol on the planning utilization box

**File:** `resources-panel.tsx` (utilization input, ~line 563–570).

The planning grid has a `percent | hours` `SegmentedControl` (`resource.utilizationMode`).
Show a trailing symbol next to the utilization number box:

- percent mode → `%`
- hours mode → `h`

**How:** wrap the `<input>` in a small inline flex container with a trailing
`<span aria-hidden="true" className="text-xs text-muted-foreground">` holding `%`/`h`.
The symbol is decorative (the box already has a row-unique `aria-label`); mark it
`aria-hidden`. The cost line rendered below (via `formatCurrency`) is **unchanged** — the
currency symbol stays there.

- **Out of scope:** the absence-override input keeps its current look (no suffix) — it is a
  purple-bordered override, not the primary utilization value.

### Slice 2 — Left-align planning date headers

**File:** `resources-panel.tsx`, period-column `<th>` (~line 482–490), currently
`... text-right ...`. Remove `text-right` so the period date-key labels (e.g. `2026-01`)
left-align. The plan start/end date pickers are already left-aligned (no change).

- The numeric utilization/cost **cell values** stay `text-right tabular-nums` (numbers
  right-align by convention) — only the **date header label** moves left.

### Slice 3 — Left-align budget bucket date headers

**File:** `budget-panel.tsx`, per-bucket period-column `<th>` (~line 439–448), currently
`relative px-1 py-1 text-right`. Remove `text-right` so the bucket period date-keys
left-align. Mirrors slice 2 for visual consistency. Numeric budget/actual cells stay right.

### Slice 4 — "Budget hours follow plan" live mirror (opt-in, per project)

**Decision:** per-project toggle, **default OFF**. OFF = today's manual budget entry
(preserves existing typed data — no data loss). ON = the **budget** input of each
allocation period cell mirrors the live **planned hours**, read-only.

**Why opt-in + resourced-only:** planned hours = sum of `displayCapacityHours` over an
allocation's **assigned resources** (`allocationPlannedHours`, `budget-report.ts:18-40`).
A budget line that is a **role with no named resource** has planned hours = 0. A flat
always-on mirror would force those lines to 0 and make them uneditable, breaking
role-based budgeting. Therefore:

- **Toggle ON, allocation HAS assigned resources** (`alloc.resourceIds` non-empty):
  budget cell shows the computed planned hours for that allocation+period, **read-only**,
  updates live as planning changes. The typed `budgetHours` value is **not written** — the
  cell derives at render.
- **Toggle ON, allocation has NO assigned resources:** cell stays **manually editable**
  (nothing to mirror).
- **Toggle OFF:** all cells manually editable (current behavior).

**Read-only cell:** in `HoursCell` (`budget-panel.tsx:51-93`) the budget `<input>` gets a
`readOnly` prop; when read-only, render the derived planned value and drop the `onChange`
write (or make it a no-op). Keep the a11y label. The **actual** input is always editable.

**Planned value per allocation+period:** reuse the existing capacity path. `HoursCell`
needs, per period, the planned hours for the allocation. The panel already has everything
`allocationPlannedHours` needs (`plan`, `resources`, `absences`, `holidaySet`,
`workdayHours`). Compute a per-allocation, per-period planned-hours lookup (a
`Map<periodKey, number>` per allocation, memoized on `[plan, resources, absences,
holidaySet, workdayHours, alloc.resourceIds]`) and pass the relevant number into `HoursCell`.
Do **not** re-derive ISO week/period keys — reuse `bucketActivePeriods` / the existing
`periodKeyForDate` path so keys line up with the typed-budget map.

**Persistence of the toggle:** a new optional field on `ResourcePlan`, e.g.
`budgetFollowsPlan?: boolean` (project-level, shared — NOT a per-device setting, because it
changes shared budget semantics). `ResourcePlan` is a single object inside `Workspace`, not a
row table. Wire the field through every plan serialization surface it already uses (verify
in the plan): `sanitizePlan` (`sanitize-entities.ts`), the CSV plan codec
(`csv-codecs-*`), the Markdown plan codec (`markdown-codecs-*`), Turso (derives from the CSV
column list), and JSON/IDB whole-object pass-through. Absent field ⇒ `false` ⇒ blank blobs
stay byte-stable. **Regenerate golden fixtures** only if the plan serialization gains a
column/key (legit format change).

**Toolbar control:** a labeled toggle (checkbox or `SegmentedControl`/switch) in the budget
toolbar row (`budget-panel.tsx:297-326`), gated `!isPopout` (popout is read-only). New i18n
key `budgetFollowsPlan` (+ hint) EN+DE. Budget is a printable view — mark the toggle
`print:hidden`.

**Edge cases:**
- Blended (discipline) budget rows vs role rows: both derive from `allocationPlannedHours`
  the same way (it sums over `resourceIds`), so both mirror when resourced. Verify the
  discipline-row setter path (`setDisciplineCell`) is also made read-only under the toggle.
- Actual-vs-budget RAG (`ratioHealth`) keeps working — it reads whatever the budget cell
  shows (planned when mirrored).

### Slice 5 — Bucket-name search box

**File:** `budget-panel.tsx` toolbar (~line 297–326) + the `report.buckets.map` render
(~line 343).

Add a second `TableFilter` ("bucket name") beside the existing **role** filter (line
340–342). New `bucketFilter` state (mirrors `roleFilter`, line 199). Before rendering,
filter `report.buckets` to those whose `name` includes the query (case-folded, trimmed).
Both filters compose (bucket-name narrows buckets; role filter still narrows rows within
each shown bucket). New i18n key `budgetBucketFilter` (placeholder) EN+DE. Budget IS in axe
`A11Y_VIEWS` — `TableFilter` already carries an accessible label; two filter boxes need
**distinct** labels (role vs bucket) so they're not duplicate accessible names.

## Files touched (summary)

- `resources-panel.tsx` — slice 1 (suffix), slice 2 (date header left-align).
- `budget-panel.tsx` — slice 3 (date header), slice 4 (read-only mirror cell, planned-hours
  lookup, toolbar toggle), slice 5 (bucket search).
- `budget-report.ts` — reuse `allocationPlannedHours` (no change expected; export if needed).
- `types.ts` — `ResourcePlan.budgetFollowsPlan?: boolean`.
- `sanitize-entities.ts` — `sanitizePlan` validates the new boolean.
- `csv-codecs-*`, `markdown-codecs-*` — plan codec gains the field (verify exact files).
- `i18n.ts` + `i18n.de.ts` — new keys: suffix needs none; `budgetFollowsPlan` (+hint),
  `budgetBucketFilter`. EN/DE parity (tsc-enforced); edit `i18n.de.ts` via node utf8 write,
  CRLF anchors, real umlauts.
- Tests alongside each module; golden fixtures only if plan serialization changes shape.

## Constraints / gates

- **Palette:** AIPM tokens only; no off-palette color/shadow/gradient. Suffix span uses
  `text-muted-foreground`.
- **a11y:** suffix is `aria-hidden`; two budget filter boxes need distinct labels; read-only
  input keeps its `aria-label`. Verify with
  `npx playwright test e2e/a11y.spec.ts --project=chromium -g "Budget"` and `-g "Resources"`.
- **React purity:** no set-state-in-effect; planned-hours lookup is a `useMemo` with scalar
  deps hoisted (exhaustive-deps rejects `obj.member` / `?.length` in dep arrays).
- **i18n encoding:** DE via node utf8 write, real umlauts, no ASCII subs.
- **Size/dup:** `resources-panel.tsx` and `budget-panel.tsx` are large — run
  `npm run size:check` / `dup:check`; extract the toggle/suffix into a small presentational
  helper if a file crosses the ratchet.
- **No new secret, no new external host.** No calendar/AI surface touched.

## Verification

`npx tsc --noEmit` · `npm run test:run` · `npm run build` · `size:check` · `dup:check` ·
axe (`Budget` + `Resources`). Manual: toggle OFF = unchanged manual entry; toggle ON =
resourced lines read-only + mirror live planning edits, role-only lines still typed; reload
persists the toggle; suffix flips with the mode; date headers left-aligned; bucket search
filters buckets and composes with the role filter.

## Not doing (YAGNI)

- No per-bucket or per-line mirror override (project-level toggle only).
- No suffix on the absence-override input.
- No change to actual-hours entry or the FX/currency conversion path.
- No one-click "apply once" button (superseded by the live toggle).
