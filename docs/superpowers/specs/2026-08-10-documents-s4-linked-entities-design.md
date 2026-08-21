# Documents S4 — `linkedEntities`: design

_Written 2026-08-10 against 0.229.0 "Marillier" (`ab085ef2`). Slice **S4** of the documents roadmap
recorded as [`docs/open-followups.md`](../../open-followups.md) §113._

★ This tree is **gitignored**, so this file exists only on the machine that wrote it. Every decision
below that survives the slice must be reproduced into the register or into `docs/AGENTS/documents.md`
— that is §44's failure mode and §113 exists because of it.

---

## 1. What this slice ships

A `ProjectDocument` can name the project entities it is about. The reference lives on the
**document**, and the four entity surfaces render it read-only.

| | |
|---|---|
| **New persisted state** | `linkedEntities?: readonly DocEntityRef[]` on `ProjectDocument` — free, inside the existing `documents` meta-blob |
| **Attach door** | Documents panel only (one picker) |
| **Entity side** | one shared row badge on task / milestone / RAID / change, deep-linking into Documents |
| **Filter** | transient, set by the badge, dismissible; no standing toolbar control |
| **Dangling** | left in place, rendered with the shared dangling presentation |
| **Versioning** | a reference is not content — link/unlink write no version |

S4 is sequenced **ahead of** the S3b block editor by §113, because it settles the dangling pattern and
the versioning policy on a `{kind, id}` pair rather than on images.

### Decisions §113 already fixed — not reopened here

1. The field lives on `ProjectDocument`, inside the `documents` blob.
2. **Content versions; references and metadata do not.** `DocMutation` is a discriminated union, so
   every new kind forces this answer at the compiler.
3. **One dangling presentation** across all three producers (deleted linked entity, missing asset, the
   existing dangling resource): a non-colour marker plus a distinguishing `title`.
4. Derive, never duplicate, for every allow-list / classifier pair.

---

## 2. The four decisions taken in this design

Each was a fork with a live alternative. Recorded with its reason so the alternative is not
re-litigated, and so a future reader can tell a decision from an accident.

### 2.1 One door: the document side

The attach UI lives in the Documents panel. The four entity surfaces are **read-only**.

Rejected — an entity-side picker in the task / milestone / RAID / change edit modals (mirroring
`knowledgeLinks`, which those four already carry). It would put four modals in the business of
mutating a field on a *document*, i.e. a write from the side that does not own the state — the shape
behind §48 and §49, where a stale snapshot spread over a live row destroyed the note log. It is also
four pickers instead of one, and documents are few while entities are many, so attaching one status
report to five tasks is one screen and five picks rather than five screens.

★ Recorded as a follow-up rather than dropped: **entity-side attach (door B)** gets its own register
entry when this slice lands. The model is deliberately shaped so door B needs no model change.

★★ Both doors at once was rejected as "one door of two" — the shape §113 says recurred six times in
one release. One door is a decision; half of two doors is an accident.

### 2.2 The row badge, not an editor chip list

`DocumentBadge` renders on the row (and the Kanban card), following `task-raid-badge.tsx` and the
`🗒 N` note badge. Rejected: a read-only chip list inside the four edit modals, which buries the
reverse lookup — "which documents are about this row" is unanswerable without opening a modal per row.

Accepted cost: four new per-row controls, each needing a **row-unique** accessible name (WCAG 2.4.6).
★★★ The axe gate cannot catch a collision — measured against axe-core 4.12.1, no rule in the four
tags the spec requests flags two controls sharing a name, at any seed size. A unit test rendering ≥2
same-kind rows is the only possible detector.

### 2.3 `{kind, id, label}` — the label is a tombstone

Rejected `{kind, id}` alone: a dangling reference could then only say "deleted task #12", which tells
the user nothing and leaves them no action but to delete the reference. Rejected a fourth `addedAt`
field: nothing consumes it, and every optional field is bytes on six write paths plus a golden regen.

★★★ The label is a **tombstone**, never a display source while the target lives. Read it eagerly and
a rename silently desyncs the chip — the class `effectivePersonEmail` exists to prevent, and the
`stale-name-cache-farmer` failure. Enforced by routing every surface through one resolver (§3.2).

### 2.4 Dangling references are left in place

Rejected cascade-prune at entity delete: it must be wired at four delete handlers plus the AI
`delete_*` tools, bulk operations, and every future delete path, and a miss is silent. Worse, undoing
the entity delete restores the entity but not the pruned reference — the §50 shape, undo reverting
write-through state. Rejected prune-at-load for the same undo loss, plus it is a permanent
normalisation pass outside the numbered migration chain (§82).

Leaving the reference is the only option where a delete → undo round trip is lossless.

---

## 3. Model

### 3.1 `document-ref.ts` — a new leaf module

Imports nothing from the app, mirroring `document-link.ts`'s leaf discipline, so door B can depend on
it later without a cycle. ★ `document-model.ts` already sits in a value-import cycle
(`settings-types` ⇄ `workspace` ⇄ `document-model`, §92) — a leaf module keeps the new type out of it.

```ts
export type DocRefKind = "task" | "milestone" | "raid" | "change";

export type DocEntityRef = {
  kind: DocRefKind;
  id: number;
  /** TOMBSTONE ONLY — the display source when `id` no longer resolves.
   *  Never read while the target lives, or a rename silently desyncs the chip. */
  label?: string;
};
```

`ProjectDocument.linkedEntities?: readonly DocEntityRef[]` — optional, and **omitted when empty**, so
an unlinked document serializes byte-identically and only the one seeded sample document moves the
goldens.

`MAX_LINKS_PER_DOC = 50`, declared **in `document-ref.ts`** and imported by `document-model.ts`. ★ Not
the other way round: the validator below lives in the leaf module, and importing a constant back from
`document-model.ts` would put the leaf into that module's import cycle (§92) for no gain.

### 3.2 The single resolver

```ts
resolveDocRef(ref, lookups) → { title: string; dangling: boolean }
```

Live entity title when `id` resolves; `ref.label` on a miss (empty string if absent); `dangling` true
only in the second case. Every surface — the doc-side chip, the badge's accessible name, the filter
banner — goes through it, so the tombstone rule lives in one place rather than being re-decided at
four call sites.

★ `lookups` is a plain bag of `Map`s the caller builds, not a `Workspace` — keeps the module leaf and
keeps the resolver testable without a workspace fixture.

### 3.3 Validation

`sanitizeDocEntityRefs(raw): DocEntityRef[]`:

- `kind` must be a member of the union — an unknown kind is **dropped**, never degraded to a default.
- `id` must be finite and > 0 (`Math.floor`, matching `sanitizeDocument`'s own id handling).
- `label` capped with the existing `str(…)` helper; absent stays absent (sparse).
- De-duplicated on `(kind, id)`.
- Truncated at `MAX_LINKS_PER_DOC`.

---

## 4. Persistence — three mandatory edits

The field rides inside the `documents` meta-blob, so it reaches all six write paths for free. What is
**not** free:

1. ★★★ **`sanitizeDocument` builds from an explicit field list** (`document-model.ts`, the
   `sanitizeDocument` function). A field it does not name is silently dropped on **every** load. This
   is the `sanitizeRaidItem` shape that erased RAID note logs unrecoverably in 0.211.1 — the sanitizer
   is not a pass-through, and forgetting this line is the single highest-cost mistake in the slice.
2. `sanitizeDocument` calls `sanitizeDocEntityRefs` (§3.3), which is where the cap, the de-dup and the
   unknown-kind drop all live — consistent with how `MAX_BLOCKS_PER_DOC` is applied one level down.
   `sanitizeProjectDocuments` threads nothing new.
3. **Goldens.** `sample-workspace-small.json` carries **1** document today and both
   `golden-workspace.md` and `golden-workspace.csv` serialize it (verified 2026-08-10, not assumed).
   Seed one link on that document, regenerate `-big`/`-huge` with
   `npx vite-node scripts/generate-sample-workspace.ts`, then regenerate the goldens. This is a
   legitimate format change, not a mask.

★ `documents` persists by **reference equality** (`prev.documents !== next.documents`), so every
mutation must return a new array — an in-place push silently skips the save.

---

## 5. Mutation path

Two new `DocMutation` kinds, routed through `applyDocMutation` — the single mutation path, where each
`case` decides its own versioning (`create` already writes none).

```ts
| { kind: "link";   id: number; ref: DocEntityRef }
| { kind: "unlink"; id: number; ref: Pick<DocEntityRef, "kind" | "id"> }
```

★ `id` is the **document** id, matching `rename` / `duplicate` / `delete` / `ops`; the entity's id is
`ref.id`. Two `id`s in one object is a readability hazard — name the local `docId` at every call site.

Both:

- **write no version** — §113 decision 1. Comment the `case` with the reason, next to `create`'s.
- **do not move `updatedAt`** — it is a displayed, sortable column (`documents-list.tsx`,
  `documents-panel.tsx`'s sort accessor), so bumping it on an attach would report a content edit that
  never happened.
- are **idempotent**: linking an existing `(kind, id)` is `changed: false`; unlinking an absent one is
  `changed: false` with a `rejected` reason.
- respect `MAX_LINKS_PER_DOC`, refusing with a reason in the existing `*LimitReason()` style.

★ `unlink` takes `(kind, id)` and not an index — an index is invalidated by any concurrent edit, the
`entity-id-mint` class of bug.

---

## 6. Surfaces

### 6.1 Doc-side attach — extend `EntityLinkPicker`

The picker already exists: chips + search dropdown, entity-agnostic, i18n-free, shared by
`task-link-picker.tsx` and `raid-edit-fields.tsx`. Reusing it is the no-hand-roll rule.

★★ One genuine gap: `LinkPickerEntry.id` is a `number` and `onRemove` takes that id, but four kinds
have colliding ids — "remove task 7" and "remove risk 7" are indistinguishable, and React keys
collide too. **Extend the primitive**, do not dodge it:

- add `key?: string` to `LinkPickerEntry`, defaulting to `String(id)`;
- change `onRemove` to receive the **entry** rather than the id; the two existing call sites become
  `(e) => …e.id`.

★★★ §110 is the precedent for extending rather than working around: a caller-side override that
Tailwind's source-order resolution silently defeated turned into a permanent, deliberate hand-roll.
A primitive that cannot express the case is a primitive problem.

The Documents panel supplies `code` per kind (`#42`, `M#3`, `R#7`, `C#5`) — which is also what
disambiguates each chip's remove-button name — and owns query state and option filtering, as the
picker's contract requires.

### 6.2 `DocumentBadge`

New shared component modelled on `task-raid-badge.tsx`:

- `memo`, **props only** (`lang`, `count`, `entityTitle`, `onOpen`) — ★★ never `useTaskRowContext`,
  which throws outside `RowContextProvider` and would crash the Kanban board.
- `onClick` calls `stopPropagation` (in-`<tr>` controls must, or the row's own handler fires).
- Accessible name qualified with the entity title: `Documents (2) – Vendor delay`.
- Rendered at four surfaces: task table row **and** Kanban card, RAID rows, change rows, milestone
  rows. Hidden entirely at count 0 — a badge reading 0 is noise on every row of an unlinked project.

### 6.3 Deep-link and the transient filter

Follows `onJumpToRaid` (`use-task-row-handlers.ts`) exactly: the badge sets a parent-held
`{kind, id}` request and `setActiveTab("documents")`.

★★★ The Documents view **mounts fresh on each visit** (the modern shell renders only the active
view). The panel reconciles at render time against a **sentinel-null** handled seed, and the parent
**clears on consume**. Seeding the handled ref from the live prop is the remount-swallow trap that
already bit the settings learning deep-link and `openCreateNonce`.

On arrival the list filters to documents linking that entity and shows a dismissible banner —
"Linked to: Vendor delay ✕" — whose label comes from `resolveDocRef`, so a deleted entity reads as a
tombstone rather than blank.

### 6.4 Dangling presentation

The existing `ResourcePicker` pattern, which §113 decision 2 designates the shared one:

- a `data-dangling-marker` warning glyph, `aria-hidden`, beside the chip;
- a distinguishing `title` — `documentRefDangling` vs `documentRefLinked`.

★★ `title` is the accessible **description**, a screen-reader disclosure — it is **not** a 1.4.1 fix
(hover-only, no keyboard focus, unreachable on touch). The glyph is what closes 1.4.1, and it is
required, not decorative.

---

## 7. Verification

Beyond lint / tsc / `test:run` / `test:shuffle` / axe:

| What | Why it needs its own assertion |
|---|---|
| `sanitizeDocument` round-trips `linkedEntities` | the whole six-write-path cost is this one line; its absence is silent |
| `resolveDocRef` tombstone rule, **mutation-tested** | a stub reading `label` while the target lives must turn a test red, or the rule is unpinned |
| link/unlink write **no** version | silent if wrong |
| link/unlink leave `updatedAt` | silent if wrong, and visible only as a wrong date in a column |
| idempotent link, absent unlink, cap refusal, unknown-kind drop | each is a `rejected` path with no UI |
| **≥2 same-kind rows** render distinct badge names | axe is structurally blind to the collision |
| goldens regenerated after seeding the sample master | format change, must not be masked |
| e2e seed gains a link on a seeded document | otherwise the Documents axe scan sees an empty state — the "a view in the list is not a view covered" trap |

Gate headroom to check before pushing, not after:

- `size:check` counts `split("\n").length`, i.e. `wc -l` **+ 1** — read the real number for
  `document-model.ts`, `document-mutations.ts` and `documents-panel.tsx` before budgeting.
- duplication gate has **0.56pp** of headroom on the total duplicated-LINE figure (§116); four
  near-identical badge call sites are exactly the shape jscpd counts.
- `document-ref.ts` is a pure `.ts` with real logic, so it is coverage-gated — that is correct here
  (exclude glue, not logic).

---

## 8. Out of scope — recorded so none becomes an accidental gap

- **Entity-side attach (door B)** — §2.1. Gets its own register entry with this slice.
- **AI link/unlink tools**, and letting the model see a task's attached documents — §113 already names
  both, precisely so they do not become a fourth gap beside §86 / §87 / §89.
- A standing toolbar filter, a "has links / no links" toggle, and saved-view capture of either. ★
  Saved views capture RAW values, so a captured filter could pin to a deleted entity — the orphaned-
  filter class.
- Linking to resources, stakeholders or budget rows. Four kinds only.
- Bulk attach / detach.
