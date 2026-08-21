# Edit-Bucket Modal + Role Picker (0.14.0) — Design

**Date:** 2026-05-27
**Status:** Approved (design); pending implementation plan
**Branch:** `feat/0.14.0-budget-bucket-modal`

## Problem

The Budget panel can only edit the per-period hours of allocations that already
exist. There is no UI to edit a bucket's own fields or to add/remove allocation
(role) lines, so a bucket created via "Add bucket" is an uneditable empty shell
(`blankBucket()` returns `allocations: []`). Users cannot meaningfully edit budgets.

## Goal

Add a draggable **Edit-bucket modal** (with a role picker) that edits a bucket's
fields and its allocation lines, and wire "Add bucket" to open it. The budget data
model (`BudgetBucket`, `BucketAllocation`) already supports every field — this is a
UI-only change.

## Components

### `BudgetBucketModal` (new `src/app/budget-bucket-modal.tsx`)

Built on the shared `Modal` + `ModalHeader` (draggable header, in-modal voice mic via
the existing `VoiceCommandProvider` context — consistent with the other 6 modals).
Edits a **local draft** (a copy of the bucket) and commits on **Save**; **Cancel**
discards. Mirrors the draft+Save pattern of `shift-edit-modal` / `resource-edit-modal`.

Props: `{ lang, bucket: BudgetBucket, allBuckets: readonly BudgetBucket[], roles,
disciplines, grades, resources, onSave: (b: BudgetBucket) => void, onClose: () => void }`.

**Fields:**
- **Name** — text (required, non-empty).
- **PO #** — text (optional → `poNumber`).
- **Type** — `SegmentedControl` over `BUDGET_TYPES` ("tm"/"fixed"); labels reuse
  `budgetTypeTm`/`budgetTypeFixed`.
- **Currency** — `<select>` over `SUPPORTED_CURRENCIES` (EUR/USD/GBP).
- **Fixed-price amount** — number input, **rendered only when `type === "fixed"`**
  (→ `fixedPriceAmount`). When type is "tm", `fixedPriceAmount` is left `undefined`.
- **Start date / End date** — date inputs (`startDate`/`endDate`).
- **Spillover successor** — `<select>` of the OTHER buckets (option per bucket by name)
  plus a "None" option (→ `successorId`, `number | null`). A bucket cannot be its own
  successor (exclude self).
- **Manual FX rate override** — number input (→ `fxRateOverride`). Hint:
  "Manual EUR→{currency} rate; leave blank to use the cached ECB rate." Blank →
  `undefined`. Only meaningful when `currency !== "EUR"` (still editable; EUR→EUR is 1).

### Allocations editor (the role picker), inside the modal

- **Existing role lines:** one row per `draft.allocations`, showing the role label
  (`roleLabel(role, disciplines, grades)` or `#roleId`), a **resource picker**, and a
  **Remove** button (drops the allocation).
- **Resource picker (per role line):** a checkbox list of `resources`
  (`resourceDisplayName`) → toggles ids in that allocation's `resourceIds`.
- **Add role:** a `<select>` of rate-card `roles` **not already allocated** in this
  bucket + an **Add** button → appends
  `{ roleId, resourceIds: [], budgetHours: {}, actualHours: {} }`.
- **Per-period hours are NOT edited here** — they remain in the panel's existing grid.
  Adding a role here makes its hour cells appear in that grid.

## Panel integration (`src/app/budget-panel.tsx`)

- Add `editingBucketId: number | null` state. Render `<BudgetBucketModal>` when set
  (resolving the bucket by id from `buckets`).
- **Edit button** on each bucket card's action row (beside Close/Remove), opens the
  modal for that bucket. Reuse the assignee-style hover used by Close/Remove.
- **Add bucket** → create `blankBucket(...)` via `onChangeBuckets`, then set
  `editingBucketId` to the new id so the modal opens immediately on the new bucket.
  (Cancel leaves the bucket in place — no orphan trap, since Edit/Remove now exist.)
- **Save** → replace the bucket by id immutably via `onChangeBuckets`, stamping
  `localModifiedAt`; close the modal. **Cancel/close** → clear `editingBucketId`.

## Validation

On Save (block with an inline message; do not emit an invalid bucket):
- Name must be non-empty (trimmed).
- `startDate <= endDate`.
- If type is "fixed" and an amount is entered, it must be a finite number `>= 0`
  (blank → `undefined`).
- `fxRateOverride`, if entered, must be a finite number `> 0` (blank → `undefined`).

No `sanitize.ts`/`types.ts` changes — the model already supports all fields, and
in-app edits are typed (sanitize still guards import/load paths as before).

## i18n (EN + DE)

New keys (same set in both dicts): `budgetEditBucket` (button + modal title),
`budgetBucketName`, `budgetPoNumber`, `budgetStartDate`, `budgetEndDate`,
`budgetSuccessor`, `budgetSuccessorNone`, `budgetFixedPriceAmount`,
`budgetFxOverride`, `budgetFxOverrideHint`, `budgetAllocations`, `budgetAddRole`,
`budgetRemoveRole`, `budgetResources`, `budgetNoRolesLeft` (when every role is already
allocated), and validation messages `budgetNameRequired`, `budgetDateRangeInvalid`.
Reuse existing: `budgetTypeTm`, `budgetTypeFixed`, `budgetCurrency` (if present, else
add), `alertModalClose`.

## Non-goals

- No change to per-period hours editing (stays in the panel grid).
- No change to the spillover/CCI engine, sanitize, storage, or types.
- No bulk operations; one bucket at a time.

## Testing

- **Component (`budget-bucket-modal.test.tsx`):** editing name/dates/currency/type →
  Save emits the updated bucket; Fixed-price field appears only when Type = Fixed;
  blank FX override → `fxRateOverride` undefined; Add role appends an allocation with
  empty hour maps; Remove role drops it; toggling a resource updates `resourceIds`;
  successor select sets `successorId` (and excludes self); name-empty / start>end block
  Save with a message.
- **Panel integration (`budget-panel`/`budget-panel-edit` tests):** clicking **Edit**
  opens the modal for that bucket; **Add bucket** emits a new bucket AND opens the modal
  on it.
- Existing budget tests (hours editing, reorder, remove) must stay green.

## Release

New feature → **0.14.0**. Bump `version.ts` (new milestone/codename or keep "Bradbury"
— follow the file's convention; add a highlight key if the file expects one per minor),
CHANGELOG `0.14.0` entry, and `docs/CODEMAPS/frontend.md` (`budget-bucket-modal.tsx`).
Gates: lint 0, tsc 0, `test:coverage` green (≥70%).
