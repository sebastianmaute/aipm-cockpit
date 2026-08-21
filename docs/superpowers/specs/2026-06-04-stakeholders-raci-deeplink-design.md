# Stakeholder Register + RACI, and RAID Deep-Linking — Design

**Date:** 2026-06-04
**Target release:** v0.52.0
**Status:** Approved

Two independent workstreams shipped in one branch/release:

- **A — Stakeholder register + RACI matrix + influence/interest grid** (new workspace entity, builds on the resources/roles people model and the milestones model).
- **B — True RAID deep-linking** (`#raid/<id>` opens a specific item; provides the open-by-id entry point the v0.51 "Pratchett" follow-up flagged as missing).

---

## Workstream A — Stakeholder register + RACI

### A1. Data model

One new workspace entity. RACI is **embedded** as a map on the stakeholder (not a second entity), exactly like `Resource.utilization` is an embedded `Record<string, number>` — this keeps the storage-wiring cost to a single entity and reuses the proven map-in-CSV/MD serialization path.

```ts
// types.ts
export const RACI_ROLES = ["R", "A", "C", "I"] as const; // Responsible / Accountable / Consulted / Informed
export type RaciRole = (typeof RACI_ROLES)[number];

export const STAKEHOLDER_CATEGORIES = [
  "Internal", "Customer", "Vendor", "Sponsor", "Regulator", "Other",
] as const;
export type StakeholderCategory = (typeof STAKEHOLDER_CATEGORIES)[number];

export type InfluenceInterest = "Low" | "Medium" | "High";
export const INFLUENCE_INTEREST_LEVELS: InfluenceInterest[] = ["Low", "Medium", "High"];

export type Stakeholder = {
  id: number;
  name: string;
  organization?: string;
  title?: string;             // role / title (free text)
  email?: string;
  category: StakeholderCategory;
  influence: InfluenceInterest;
  interest: InfluenceInterest;
  notes?: string;
  /** Optional FK -> Resource.id; null/absent for purely-external stakeholders. */
  resourceId?: number | null;
  /** milestoneId (as string key) -> RACI letter. Sparse; orphan keys (deleted
   *  milestones) are filtered at render time, optionally pruned on save. */
  raci: Record<string, RaciRole>;
  /** ISO 8601 — set on every save for sync/conflict detection. */
  localModifiedAt?: string;
};
```

RACI convention (per decision): **soft warning only.** Any assignment is allowed; the matrix flags milestones that have zero or more-than-one `A` (Accountable) with a non-blocking amber chip. No auto-demotion, no hard block.

### A2. Pure helpers — `stakeholders.ts` (+ `stakeholders.test.ts`)

No React, no DOM. Sibling to `raid.ts` / `change-log.ts`.

- `nextStakeholderId(items: readonly Stakeholder[]): number` — monotonic, separate id space.
- `quadrantFor(s: Pick<Stakeholder,"influence"|"interest">): StakeholderQuadrant` where
  `type StakeholderQuadrant = "manage-closely" | "keep-satisfied" | "keep-informed" | "monitor"`.
  Per-axis binary split defined in A6. high-influence + high-interest → manage-closely;
  high-influence + low-interest → keep-satisfied; low-influence + high-interest → keep-informed;
  low-influence + low-interest → monitor.
- `buildRaciMatrix(stakeholders, milestones)` → `{ milestone: Milestone; cells: Array<{ stakeholderId: number; role: RaciRole | null }> }[]`.
  Only existing milestone ids are used; orphan keys ignored.
- `accountableCountByMilestone(stakeholders, milestoneId): number` — backs the soft-warning chip.
- `raciWarningFor(count: number): "none" | "missing" | "multiple"` — 0 → missing, 1 → none, >1 → multiple.
- `compareStakeholder(a, b, key, dir)` with
  `type StakeholderSortKey = "name" | "organization" | "category" | "influence" | "interest"`.
  Influence/interest rank Low<Medium<High; category by enum order; strings case-folded.
- `resourceLinkLabel(s, resources)` — display name of the linked resource, or "" when unlinked.

### A3. UI — three views

New parent register **Stakeholders** in the Registers nav group, with two sub-views.

1. **`stakeholders` (register table)** — `stakeholders-panel.tsx`. Uses the shared `report-table.tsx`
   `ReportCard` (sortable / filterable / resizable, dark-blue `TABLE_HEAD_CLASS`), mirroring the RAID
   and Change report panels. Columns: name, organization, title, category (chip), influence (chip),
   interest (chip), linked resource, email. Search box + category filter. "Add stakeholder" button
   before the search (matches RAID/Change convention). Rows open the edit modal.
2. **`raci` (RACI matrix)** — `raci-panel.tsx`. Milestones as rows, stakeholders as columns; each cell a
   `<select>` (blank / R / A / C / I). Amber ⚠ chip on any milestone row whose Accountable count is 0
   or >1. Empty-state when there are no milestones or no stakeholders (with a hint to add them first).
   Dark-blue header; printable via the existing `.print-root` scoping.
3. **`stakeholder-map` (influence/interest grid)** — `stakeholder-map-panel.tsx`. A 2×2 CSS grid
   (Manage Closely / Keep Satisfied / Keep Informed / Monitor), each stakeholder rendered as a chip in
   its quadrant via `quadrantFor`. Brand-palette tints only; printable.

**Edit modal** — `stakeholder-edit-modal.tsx`, mirroring `change-edit-modal.tsx`:
fields for name, organization, title, email, category (select), influence (select), interest (select),
notes, an optional **Resource picker** (combobox over `resources`, clears to unlinked), and a **RACI
sub-section** listing every milestone with a R/A/C/I select. Immutable update via spread; stamps
`localModifiedAt`.

### A4. Navigation (`nav-config.ts`)

- Extend `AppView` with `"stakeholders" | "raci" | "stakeholder-map"`.
- Add to the Registers `NavGroup`:
  `{ view: "stakeholders", children: [{ view: "raci" }, { view: "stakeholder-map" }] }`,
  placed after Changes and before Reports.
- Add `LABEL_KEYS` entries (new i18n keys).
- `subTabsFor` automatically exposes the children to the classic sub-tab row — no extra wiring.
- Wire the three panels into the modern shell view switch and the classic workspace section, following
  how `changes` / `change-report` are wired.

### A5. Storage wiring (end-to-end — the Change-log checklist)

Each is one task in the plan. Missing any one silently drops stakeholders on that backend.

1. `types.ts` — the types above.
2. `storage.ts`:
   - `Workspace.stakeholders?: Stakeholder[]`.
   - `emptyWorkspace()` seeds `stakeholders: []`.
   - Bump `SCHEMA_VERSION` 7 → 8; add idempotent `migrateWorkspaceV8(ws)` defaulting `stakeholders: []`.
   - JSON serialize (envelope) + parse (sanitize + default `[]`).
   - CSV: `stakeholdersToCsv` / `csvToStakeholders` + section wiring in the combined-file encoder/decoder.
   - Markdown: `stakeholdersToMarkdown` / `markdownToStakeholders` + section wiring.
   - Legacy-parse path defaults `stakeholders: []`.
3. `sanitize.ts` — `sanitizeStakeholder(raw): Stakeholder | null`: clamps `category` /`influence`/`interest`
   to valid enums (fallback `Other` / `Medium`), validates RACI letters (drop unknown), coerces ids,
   drops malformed rows. (+ `sanitize-stakeholder.test.ts`.)
4. `turso-schema.ts` — stakeholder table in the schema + `TABLE_NAMES`; map the `raci` map to a JSON/text
   column (same approach used for resource utilization). Keep schema-guard test green.
5. `turso-backend.ts` / `turso-pipeline.ts` — save/load the new table.
6. `sharepoint-backend.ts` — include stakeholders in the workspace round-trip.
7. **BrowserBackend KV + `use-storage-backend.ts`** — add the stakeholders store to the IndexedDB KV
   backend AND the save/load/broadcast bridge. (This is the step the Change-log holistic review caught
   as missing; treat as mandatory.)
8. `workspace-context.tsx` — `stakeholders` / `setStakeholders` state + context value.
9. `export.ts` — include stakeholders wherever the full workspace is exported.

### A6. Power/interest grid axis decision

The 2×2 grid uses a binary High/Low split per axis. **"High" bucket = level === "High"; "Medium" and
"Low" both map to the Low bucket.** This is stated explicitly so the implementation is unambiguous and
the helper test pins it. (The register table still shows the full three-level chip.)

---

## Workstream B — True RAID deep-linking

### B1. Hash grammar

Extend `#<view-slug>` to `#<view-slug>[/<id>]`, e.g. `#raid/123`.

- `nav-config.ts` pure helpers (+ tests):
  - `parseHash(raw: string): { view: AppView; itemId: number | null }` — strips `#`, splits on `/`,
    resolves the view via the existing `slugToView`, parses a trailing positive integer as `itemId`
    (else `null`). Preserves the `address-book`/`resource-report` aliases.
  - `buildHash(view: AppView, itemId?: number | null): string` — `#raid` or `#raid/123`.

### B2. Pending-open plumbing (`workspace-tab-context.tsx`)

- Add `pendingOpen: { view: AppView; id: number } | null`, `requestOpen(view, id)`, `clearPendingOpen()`.
- `requestOpen` sets `activeTab = view`, records `pendingOpen`, and (main window only, not popout)
  writes `buildHash(view, id)` to `window.location.hash`.

### B3. `use-hash-view.ts`

- On mount + `hashchange`: `parseHash` → `setActiveTab(view)`; when `itemId != null`,
  `requestOpen(view, itemId)`.
- View→hash writer: only rewrite when the **base view** changes (compare `parseHash(currentHash).view`
  to `activeTab`). This prevents clobbering an existing `#raid/123` while the user stays on RAID;
  switching to another view writes that view's plain slug and naturally drops the id.

### B4. `raid-panel.tsx` consume-once

- Watch `pendingOpen`; when `pendingOpen?.view === "raid"`, look up the id in `raidById`; if found,
  `openEdit(item)`; then `clearPendingOpen()` (so it fires once and reopening doesn't refire). If the id
  is unknown, just clear.

### B5. Wire entry points

- **RAID-review modal** (`notifications.tsx`): change `onSelectRaid` back to `(id: number) => void`;
  call `requestOpen("raid", id)`. This restores the honest open-by-id contract.
- `task-manager.tsx`: provide an `openRaidItem(id)` callback (`requestOpen("raid", id)`) and pass it to
  the RAID-review modal and any RAID list row that exposes an "open" affordance.
- Where the dashboard RAID band renders a row with a known id, wire its click to `openRaidItem(id)`;
  otherwise leave the generic "go to RAID register" navigation as-is.

---

## Cross-cutting

### i18n (`i18n.ts` + `i18n.de.ts`)

New EN + DE keys (DE strings **ASCII-only** — the Edit tool corrupts `"` to curly quotes in
`i18n.de.ts`; write/grep-verify): nav labels (`navStakeholders`, `stakeholderRaciTitle`,
`stakeholderMapTitle`), register/matrix/grid headers and column labels, category option labels,
influence/interest option labels, RACI letter labels + legend (R/A/C/I full words), the A-uniqueness
warning (`raciAccountableMissing` / `raciAccountableMultiple`), edit-modal field labels, empty-states,
and `versionHighlightStakeholders`.

### Testing (TDD)

- Pure modules first: `stakeholders.ts` (quadrant, matrix pivot, accountable count/warning, comparator)
  and `parseHash`/`buildHash`.
- Storage round-trip: stakeholders survive JSON / CSV / MD encode→decode, including the embedded `raci`
  map and the optional `resourceId`; Turso schema guard stays green.
- Panels via Testing Library: register renders + sorts; RACI matrix renders cells, edits a cell, shows
  the A-warning chip; grid places a stakeholder in the right quadrant; edit modal saves immutably.
- `use-hash-view` deep-link test: `#raid/123` on mount sets the RAID view and requests open of id 123;
  staying on RAID doesn't clobber the id; leaving drops it.
- Hold the existing ~70% coverage gate.

### Constraints

- Palette: only the 9 AIPM brand tokens; chips/quadrants reuse existing RAG/`Health` classes. No new
  colors, no gradients/shadows.
- Immutability throughout (spread updates; `localModifiedAt` stamped on save).
- Files focused (<800 lines); panels split where they grow.

### Versioning

Bump to **0.52.0** with a new milestone codename; update `version.ts`, `package.json`, `CHANGELOG.md`,
`README.md`, and `docs/CODEMAPS/*` (append `versionHighlightStakeholders` to the highlight keys).

---

## Out of scope (YAGNI)

- A separate RACI entity / RACI over tasks (we map over milestones, embedded on the stakeholder).
- Stakeholder communication-plan scheduling, engagement-history log.
- Deep-linking grammar for entities other than RAID (the `parseHash`/`buildHash` helpers are generic, but
  only the RAID consumer is wired this release).
