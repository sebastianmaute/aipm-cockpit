# Documents S4 — `linkedEntities` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A project document can name the tasks, milestones, RAID items and changes it is about; those entities show a badge that deep-links back into a filtered Documents view.

**Architecture:** The reference lives on the **document** (`ProjectDocument.linkedEntities`), inside the existing `documents` meta-blob, so it rides all six write paths without a new table. A new leaf module `document-ref.ts` owns the type, its validator, one resolver and one reverse index. Two new `DocMutation` kinds (`link`/`unlink`) go through `applyDocMutation`, the single mutation path, and deliberately write no version and do not move `updatedAt`. The attach UI is one picker in the Documents panel; the four entity surfaces render a read-only badge that calls a new `requestDocumentsForEntity` on `WorkspaceTabContext`.

**Tech Stack:** Next.js 16 / React 19 / TypeScript, vitest + React Testing Library, Playwright + axe, Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-08-10-documents-s4-linked-entities-design.md`

---

## Read before starting

- `AGENTS.md` — the always-loaded landmines. In particular: never read a gate's exit code through a pipe; `size:check` counts `wc -l` **+ 1**; `npm run lint` does not reproduce the CI gate (`npx eslint --max-warnings=0 src/app` does).
- `docs/AGENTS/documents.md` — the DATA half of documents (versions, retention, the single mutation path).
- `docs/open-followups.md` §113 (the roadmap decisions), §92 (the import cycle), §111 + §126 (row-unique names, and why axe cannot see a collision).

Two deviations from the spec, both decided while grounding the plan in the code — they are improvements, not drift:

1. **The picker extension covers `onAdd` as well as `onRemove`.** Spec §6.1 named only `onRemove`, but `onAdd(id: number)` has the identical cross-kind id collision: adding "task 7" and adding "risk 7" are indistinguishable. Both callbacks take the entry.
2. **The deep-link request rides `WorkspaceTabContext`, not a prop threaded from `task-manager`.** That context already carries two request/consume triples of exactly this shape (`pendingChatSeed`/`requestChat`/`clearChatSeed` and `pendingHelpConcept`/`requestHelpConcept`/`clearHelpConcept`). Adding a third is less code than threading a callback through five layers, and it keeps the sentinel-seed rule in one place. The **badge itself still takes an `onOpen` prop** and calls no hook — `useWorkspaceTab` **throws** without a provider, and a badge that throws in an unwrapped Kanban test is the `RaidBadge`/`RowContext` hazard one level up.

---

## File structure

**Created:**

| File | Responsibility |
|---|---|
| `src/app/document-ref.ts` | Leaf module: `DocRefKind`, `DocEntityRef`, `MAX_LINKS_PER_DOC`, `sanitizeDocEntityRefs`, `resolveDocRef`, `indexDocumentsByEntity`. Imports nothing from the app. |
| `src/app/document-ref.test.ts` | Unit tests for the above. |
| `src/app/document-badge.tsx` | The shared read-only row badge. Props only, no hooks beyond `memo`. |
| `src/app/document-badge.test.tsx` | Unit tests, including the ≥2-row name-uniqueness test. |
| `src/app/document-links-field.tsx` | The Documents-panel attach field: chips + search, built on `EntityLinkPicker`. |
| `src/app/document-links-field.test.tsx` | Unit tests for the attach field, including the dangling render. |

**Modified:**

| File | Change |
|---|---|
| `src/app/document-model.ts` | `linkedEntities` on `ProjectDocument`; `sanitizeDocument` reads it. |
| `src/app/document-mutations.ts` | `link` / `unlink` mutation kinds. |
| `src/app/entity-link-picker.tsx` | `LinkPickerEntry.key`; `onAdd`/`onRemove` take the entry. |
| `src/app/task-link-picker.tsx`, `src/app/raid-edit-fields.tsx` | Updated for the new callback signature (3 picker instances). |
| `src/app/workspace-tab-context.tsx` | `pendingDocEntityFilter` / `requestDocumentsForEntity` / `clearDocEntityFilter`. |
| `src/app/documents-panel.tsx` | Renders the attach field; consumes the entity filter; renders the filter banner. |
| `src/app/raid-panel-rows.tsx`, `src/app/change-panel.tsx`, `src/app/milestones-panel.tsx` | Render `DocumentBadge`. |
| `src/app/task-manager.tsx`, `src/app/tasks-section.tsx`, `src/app/task-row.tsx`, `src/app/task-kanban-card.tsx`, `src/app/task-kanban-board.tsx`, `src/app/task-kanban-swimlanes.tsx` | Thread `docCountByTask`, mirroring `raidByTask` exactly. |
| `src/app/i18n.ts`, `src/app/i18n.de.ts` | New strings. |
| `src/app/__fixtures__/sample-workspace-small.json`, `-big`, `-huge`, `__fixtures__/golden-workspace.{md,csv}` | Seed one link; regenerate. |
| `e2e/seed.ts` | Seed one link so the Documents axe scan sees chips. |
| `docs/open-followups.md`, `docs/AGENTS/documents.md` | Register entry for door B; document the new field. |

---

## Task 1: `document-ref.ts` — the leaf model

**Files:**
- Create: `src/app/document-ref.ts`
- Test: `src/app/document-ref.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/app/document-ref.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  MAX_LINKS_PER_DOC,
  indexDocumentsByEntity,
  refKey,
  resolveDocRef,
  sanitizeDocEntityRefs,
  type DocEntityRef,
} from "./document-ref";

describe("sanitizeDocEntityRefs", () => {
  it("keeps a well-formed ref and drops the label when absent", () => {
    expect(sanitizeDocEntityRefs([{ kind: "task", id: 7 }])).toEqual([{ kind: "task", id: 7 }]);
  });

  it("drops an unknown kind rather than defaulting it", () => {
    expect(sanitizeDocEntityRefs([{ kind: "resource", id: 7 }])).toEqual([]);
  });

  it("drops a non-positive or non-finite id", () => {
    expect(sanitizeDocEntityRefs([{ kind: "task", id: 0 }, { kind: "task", id: "x" }])).toEqual([]);
  });

  it("de-duplicates on (kind, id) but keeps the same id under a different kind", () => {
    const out = sanitizeDocEntityRefs([
      { kind: "task", id: 7 },
      { kind: "task", id: 7 },
      { kind: "raid", id: 7 },
    ]);
    expect(out).toEqual([{ kind: "task", id: 7 }, { kind: "raid", id: 7 }]);
  });

  it("truncates at MAX_LINKS_PER_DOC", () => {
    const many = Array.from({ length: MAX_LINKS_PER_DOC + 5 }, (_, i) => ({ kind: "task", id: i + 1 }));
    expect(sanitizeDocEntityRefs(many)).toHaveLength(MAX_LINKS_PER_DOC);
  });

  it("returns [] for a non-array", () => {
    expect(sanitizeDocEntityRefs("nope")).toEqual([]);
  });
});

describe("resolveDocRef", () => {
  const lookups = { task: new Map([[7, "Live title"]]), milestone: new Map(), raid: new Map(), change: new Map() };

  it("prefers the LIVE title over the stored tombstone label", () => {
    const ref: DocEntityRef = { kind: "task", id: 7, label: "Stale label" };
    expect(resolveDocRef(ref, lookups)).toEqual({ title: "Live title", dangling: false });
  });

  it("falls back to the label only when the id no longer resolves", () => {
    const ref: DocEntityRef = { kind: "task", id: 99, label: "Deleted thing" };
    expect(resolveDocRef(ref, lookups)).toEqual({ title: "Deleted thing", dangling: true });
  });

  it("reports dangling with an empty title when there is no label either", () => {
    expect(resolveDocRef({ kind: "task", id: 99 }, lookups)).toEqual({ title: "", dangling: true });
  });
});

describe("indexDocumentsByEntity", () => {
  it("keys by kind and id, and a document with two refs appears under both", () => {
    const docs = [
      { id: 1, linkedEntities: [{ kind: "task", id: 7 }, { kind: "raid", id: 7 }] },
      { id: 2, linkedEntities: [{ kind: "task", id: 7 }] },
      { id: 3 },
    ];
    const index = indexDocumentsByEntity(docs);
    expect(index.get(refKey("task", 7))?.map((d) => d.id)).toEqual([1, 2]);
    expect(index.get(refKey("raid", 7))?.map((d) => d.id)).toEqual([1]);
    expect(index.get(refKey("change", 7))).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

```bash
npx vitest run src/app/document-ref.test.ts
```

Expected: FAIL — `Failed to resolve import "./document-ref"`.

- [ ] **Step 3: Write the minimal implementation**

Create `src/app/document-ref.ts`:

```ts
// src/app/document-ref.ts
//
// A document's reference to a project entity. LEAF MODULE — imports nothing
// from the app, on purpose:
//
//  * `document-model.ts` sits in a value-import cycle (settings-types ⇄
//    workspace ⇄ document-model, open-followups §92). Keeping this module
//    dependency-free keeps the new type out of it.
//  * the entity-side attach door (a follow-up) will want this type from the
//    task/RAID/change/milestone editors, which must not import document-model.
//
// The cap lives HERE and document-model imports it, never the other way round.

/** The four entity kinds a document may reference. */
export type DocRefKind = "task" | "milestone" | "raid" | "change";

const KINDS: readonly DocRefKind[] = ["task", "milestone", "raid", "change"];

export type DocEntityRef = {
  kind: DocRefKind;
  id: number;
  /** ★★★ TOMBSTONE ONLY — the display source when `id` no longer resolves.
   *  Read it while the target LIVES and a rename silently desyncs every chip
   *  and badge (the stale-name-cache class `effectivePersonEmail` exists to
   *  prevent). `resolveDocRef` is the only reader; go through it. */
  label?: string;
};

export const MAX_LINKS_PER_DOC = 50;
const MAX_LABEL_CHARS = 200;

/** Map key for a (kind, id) pair — ids collide ACROSS kinds, so no numeric key. */
export function refKey(kind: DocRefKind, id: number): string {
  return `${kind}:${id}`;
}

function isKind(v: unknown): v is DocRefKind {
  return typeof v === "string" && (KINDS as readonly string[]).includes(v);
}

/** Structural validator. Shape, bounds and dedupe only — no DOM, no i18n. */
export function sanitizeDocEntityRefs(raw: unknown): DocEntityRef[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: DocEntityRef[] = [];
  for (const entry of raw) {
    if (out.length >= MAX_LINKS_PER_DOC) break;
    if (!entry || typeof entry !== "object") continue;
    const e = entry as Record<string, unknown>;
    if (!isKind(e.kind)) continue;
    const id = Math.floor(Number(e.id));
    if (!Number.isFinite(id) || id <= 0) continue;
    const key = refKey(e.kind, id);
    if (seen.has(key)) continue;
    seen.add(key);
    const label = typeof e.label === "string" ? e.label.slice(0, MAX_LABEL_CHARS).trim() : "";
    // Sparse on purpose: an absent label must stay absent so an unlinked or
    // label-less document serializes byte-identically (golden stability).
    out.push(label ? { kind: e.kind, id, label } : { kind: e.kind, id });
  }
  return out;
}

/** Live titles by kind. A plain bag of Maps, not a Workspace — keeps this
 *  module leaf and keeps the resolver testable without a workspace fixture. */
export type DocRefLookups = Record<DocRefKind, ReadonlyMap<number, string>>;

/** THE single reader of `label`. Live title on a hit; the tombstone on a miss. */
export function resolveDocRef(
  ref: DocEntityRef,
  lookups: DocRefLookups,
): { title: string; dangling: boolean } {
  const live = lookups[ref.kind]?.get(ref.id);
  if (live !== undefined) return { title: live, dangling: false };
  return { title: ref.label ?? "", dangling: true };
}

/** Reverse index: (kind, id) → the documents referencing it, in document order. */
export function indexDocumentsByEntity<T extends { readonly linkedEntities?: readonly DocEntityRef[] }>(
  documents: readonly T[],
): Map<string, T[]> {
  const index = new Map<string, T[]>();
  for (const doc of documents) {
    for (const ref of doc.linkedEntities ?? []) {
      const key = refKey(ref.kind, ref.id);
      const bucket = index.get(key);
      if (bucket) bucket.push(doc);
      else index.set(key, [doc]);
    }
  }
  return index;
}
```

- [ ] **Step 4: Run the tests and make sure they pass**

```bash
npx vitest run src/app/document-ref.test.ts
```

Expected: PASS, 12 tests.

- [ ] **Step 5: Mutation-check the tombstone rule**

This is the one rule in the slice that is silent when broken, so prove the test can see it. Temporarily change `resolveDocRef` to read the label first:

```ts
  const live = lookups[ref.kind]?.get(ref.id);
  if (ref.label) return { title: ref.label, dangling: live === undefined };
  if (live !== undefined) return { title: live, dangling: false };
  return { title: "", dangling: true };
```

Run: `npx vitest run src/app/document-ref.test.ts`
Expected: FAIL on "prefers the LIVE title over the stored tombstone label".
**Revert the mutation.** If it had passed, the rule was unpinned and the test needs fixing, not the code.

- [ ] **Step 6: Typecheck and lint**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app/document-ref.ts src/app/document-ref.test.ts; echo "EXIT=$?"
```

Expected: `EXIT=0` for both. (No pipes — a piped exit code is the pipe's, not the command's.)

- [ ] **Step 7: Commit**

```bash
git add src/app/document-ref.ts src/app/document-ref.test.ts
git commit -m "feat(documents): add the document→entity reference model"
```

---

## Task 2: persist `linkedEntities` on `ProjectDocument`

**Files:**
- Modify: `src/app/document-model.ts` (the `ProjectDocument` type and the `sanitizeDocument` function)
- Test: `src/app/document-model.test.ts`

★★★ `sanitizeDocument` builds its return value from an **explicit field list**. A field it does not name is dropped on every load, on every backend, silently — this is the `sanitizeRaidItem` shape that erased RAID note logs unrecoverably. This task is the entire "six write paths" cost of the slice.

- [ ] **Step 1: Write the failing test**

Append to `src/app/document-model.test.ts`:

```ts
describe("sanitizeProjectDocuments — linkedEntities", () => {
  const base = { id: 1, title: "Doc", blocks: [], createdAt: "2026-01-01T00:00:00.000Z" };

  it("round-trips a valid reference through the load path", () => {
    const [doc] = sanitizeProjectDocuments([{ ...base, linkedEntities: [{ kind: "task", id: 7, label: "Kickoff" }] }]);
    expect(doc.linkedEntities).toEqual([{ kind: "task", id: 7, label: "Kickoff" }]);
  });

  it("omits the field entirely when there are no valid references", () => {
    const [doc] = sanitizeProjectDocuments([{ ...base, linkedEntities: [{ kind: "nope", id: 7 }] }]);
    expect("linkedEntities" in doc).toBe(false);
  });

  it("omits the field when it was absent", () => {
    const [doc] = sanitizeProjectDocuments([base]);
    expect("linkedEntities" in doc).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

```bash
npx vitest run src/app/document-model.test.ts -t "linkedEntities"
```

Expected: FAIL — `expected undefined to equal [ { kind: 'task', … } ]`.

- [ ] **Step 3: Write the implementation**

In `src/app/document-model.ts`, add the import beside the existing ones:

```ts
import { sanitizeDocEntityRefs, type DocEntityRef } from "./document-ref";
```

Add the field to `ProjectDocument`, after `updatedAt`:

```ts
  /** Project entities this document is about. Sparse — omitted when empty, so
   *  an unlinked document serializes byte-identically. See document-ref.ts. */
  linkedEntities?: readonly DocEntityRef[];
```

In `sanitizeDocument`, replace the return statement with:

```ts
  // ★★★ THIS FUNCTION BUILDS FROM AN EXPLICIT FIELD LIST. A field not named
  // here is dropped on EVERY load path, silently — the shape that erased RAID
  // note logs (open-followups §49). Adding a persisted field means adding it
  // HERE, not only to the type.
  const linkedEntities = sanitizeDocEntityRefs(d.linkedEntities);
  return {
    id,
    title,
    blocks,
    createdAt,
    updatedAt: isoOr(d.updatedAt, createdAt),
    // Sparse: an empty list is an ABSENT field, not `[]` — the goldens pin bytes.
    ...(linkedEntities.length > 0 ? { linkedEntities } : {}),
  };
```

- [ ] **Step 4: Run the tests and make sure they pass**

```bash
npx vitest run src/app/document-model.test.ts; echo "EXIT=$?"
npx vitest run src/app/document-model.storage-cycle.test.ts src/app/document-model.property.test.ts; echo "EXIT=$?"
```

Expected: `EXIT=0` for both. The storage-cycle suite is the one that would catch a backend dropping the field.

- [ ] **Step 5: Typecheck**

```bash
npx tsc --noEmit; echo "EXIT=$?"
```

Expected: `EXIT=0`.

- [ ] **Step 6: Commit**

```bash
git add src/app/document-model.ts src/app/document-model.test.ts
git commit -m "feat(documents): persist linkedEntities on ProjectDocument"
```

---

## Task 3: `link` / `unlink` mutations

**Files:**
- Modify: `src/app/document-mutations.ts`
- Test: `src/app/document-mutations.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/app/document-mutations.test.ts` (reuse the file's existing `ctx`/state helpers — if it builds state with a local `makeState(...)`, use that; the assertions below are what matter):

```ts
describe("link / unlink", () => {
  const doc = { id: 1, title: "Charter", blocks: [], createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
  const state = { documents: [doc], versions: [] };
  const ctx = { now: "2026-06-01T00:00:00.000Z", source: "user" as const, mintDocId: () => 99, mintVersionId: () => 99 };

  it("adds the reference, writes NO version and does NOT move updatedAt", () => {
    const r = applyDocMutation(state, { kind: "link", id: 1, ref: { kind: "task", id: 7, label: "Kickoff" } }, ctx);
    expect(r.changed).toBe(true);
    expect(r.documents[0].linkedEntities).toEqual([{ kind: "task", id: 7, label: "Kickoff" }]);
    expect(r.versions).toHaveLength(0);
    expect(r.documents[0].updatedAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("is idempotent — linking the same (kind, id) again is not a change", () => {
    const once = applyDocMutation(state, { kind: "link", id: 1, ref: { kind: "task", id: 7 } }, ctx);
    const twice = applyDocMutation(once, { kind: "link", id: 1, ref: { kind: "task", id: 7 } }, ctx);
    expect(twice.changed).toBe(false);
    expect(twice.documents).toBe(once.documents);
  });

  it("refuses past MAX_LINKS_PER_DOC with a reason", () => {
    const full = {
      documents: [{ ...doc, linkedEntities: Array.from({ length: MAX_LINKS_PER_DOC }, (_, i) => ({ kind: "task" as const, id: i + 1 })) }],
      versions: [],
    };
    const r = applyDocMutation(full, { kind: "link", id: 1, ref: { kind: "raid", id: 1 } }, ctx);
    expect(r.changed).toBe(false);
    expect(r.rejected[0]).toContain("link limit");
  });

  it("unlinks by (kind, id) and drops the field when the last one goes", () => {
    const linked = applyDocMutation(state, { kind: "link", id: 1, ref: { kind: "task", id: 7 } }, ctx);
    const r = applyDocMutation(linked, { kind: "unlink", id: 1, ref: { kind: "task", id: 7 } }, ctx);
    expect(r.changed).toBe(true);
    expect("linkedEntities" in r.documents[0]).toBe(false);
    expect(r.versions).toHaveLength(0);
  });

  it("unlinking an absent reference is not a change", () => {
    const r = applyDocMutation(state, { kind: "unlink", id: 1, ref: { kind: "task", id: 7 } }, ctx);
    expect(r.changed).toBe(false);
    expect(r.documents).toBe(state.documents);
  });

  it("rejects an unknown document id", () => {
    const r = applyDocMutation(state, { kind: "link", id: 404, ref: { kind: "task", id: 7 } }, ctx);
    expect(r.rejected[0]).toContain("#404");
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

```bash
npx vitest run src/app/document-mutations.test.ts -t "link / unlink"
```

Expected: FAIL — the `link` kind is not assignable to `DocMutation`, and the cases fall through to `unchanged`.

- [ ] **Step 3: Write the implementation**

In `src/app/document-mutations.ts`, add the import:

```ts
import { MAX_LINKS_PER_DOC, refKey, sanitizeDocEntityRefs, type DocEntityRef } from "./document-ref";
```

Extend the `DocMutation` union (note: `id` is the DOCUMENT id, as on `rename`/`delete`; the entity's id is `ref.id` — name the local `docId` at call sites to keep the two apart):

```ts
  | { kind: "link"; id: number; ref: DocEntityRef }
  | { kind: "unlink"; id: number; ref: Pick<DocEntityRef, "kind" | "id"> };
```

Add a reason helper beside `documentLimitReason`:

```ts
function linkLimitReason(): string {
  return `link limit reached (${MAX_LINKS_PER_DOC})`;
}
```

Add both cases to `applyDocMutation`, after `case "rename"`:

```ts
    // ★★★ A REFERENCE IS NOT CONTENT. Both cases below write NO version
    // (roadmap §113 decision 1: content versions, references and metadata do
    // not) and both leave `updatedAt` alone — it is a displayed, sortable
    // column, so bumping it on an attach would report a content edit that
    // never happened. Consistent with `create`, which also writes none.
    case "link": {
      const target = findTarget(state.documents, m.id);
      if (!target) return unchanged(state, [`document #${m.id} not found`]);
      const [ref] = sanitizeDocEntityRefs([m.ref]);
      if (!ref) return unchanged(state, ["invalid entity reference"]);
      const current = target.linkedEntities ?? [];
      // Idempotent: the same (kind, id) is a no-op, and a no-op must return the
      // caller's OWN array reference — Turso's dirty-table detection is by
      // REFERENCE equality, so a rebuilt-but-equal array forces a needless save.
      if (current.some((r) => refKey(r.kind, r.id) === refKey(ref.kind, ref.id))) return unchanged(state);
      if (current.length >= MAX_LINKS_PER_DOC) return unchanged(state, [linkLimitReason()]);
      const linked: ProjectDocument = { ...target, linkedEntities: [...current, ref] };
      const nextDocuments = state.documents.map((d) => (d.id === target.id ? linked : d));
      return { documents: nextDocuments, versions: state.versions, changed: true, rejected: [], documentId: target.id };
    }

    case "unlink": {
      const target = findTarget(state.documents, m.id);
      if (!target) return unchanged(state, [`document #${m.id} not found`]);
      const current = target.linkedEntities ?? [];
      const key = refKey(m.ref.kind, m.ref.id);
      const kept = current.filter((r) => refKey(r.kind, r.id) !== key);
      if (kept.length === current.length) return unchanged(state, ["reference not found"]);
      // ★ Removing the LAST reference drops the field rather than storing `[]`
      // — the sparse rule sanitizeDocument applies on load, applied on write so
      // the two cannot disagree and the goldens stay byte-stable.
      const { linkedEntities: _dropped, ...withoutRefs } = target;
      const unlinked: ProjectDocument =
        kept.length > 0 ? { ...target, linkedEntities: kept } : withoutRefs;
      const nextDocuments = state.documents.map((d) => (d.id === target.id ? unlinked : d));
      return { documents: nextDocuments, versions: state.versions, changed: true, rejected: [], documentId: target.id };
    }
```

★ `_dropped` is destructured only to omit the key. CI runs `--max-warnings=0` with **no** `argsIgnorePattern`, so if eslint flags the unused binding, replace those three lines with an explicit rebuild:

```ts
      const unlinked: ProjectDocument =
        kept.length > 0
          ? { ...target, linkedEntities: kept }
          : { id: target.id, title: target.title, blocks: target.blocks, createdAt: target.createdAt, updatedAt: target.updatedAt };
```

- [ ] **Step 4: Run the tests and make sure they pass**

```bash
npx vitest run src/app/document-mutations.test.ts src/app/document-mutations.property.test.ts; echo "EXIT=$?"
```

Expected: `EXIT=0`.

- [ ] **Step 5: Lint and typecheck**

```bash
npx eslint --max-warnings=0 src/app/document-mutations.ts; echo "EXIT=$?"
npx tsc --noEmit; echo "EXIT=$?"
```

Expected: `EXIT=0` for both.

- [ ] **Step 6: Commit**

```bash
git add src/app/document-mutations.ts src/app/document-mutations.test.ts
git commit -m "feat(documents): add link/unlink mutations that write no version"
```

---

## Task 4: i18n strings

**Files:**
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts`

★★★ `i18n.de.ts` is **CRLF**, and the Edit tool corrupts umlauts *and* curls double quotes in it — including on umlaut-free strings. Patch it with a node UTF-8 write anchored on `\r\n`, never with Edit.

- [ ] **Step 1: Add the EN keys**

In `src/app/i18n.ts`, immediately after the `documentsActions:` key, add:

```ts
  documentsLinkedEntities: "Linked items",
  documentsLinkedSearch: "Search tasks, milestones, risks and changes",
  documentsLinkedPlaceholder: "Type to search…",
  documentsLinkedRemove: "Unlink",
  documentsLinkedClear: "Clear – Linked items",
  documentsLinkedDangling: "This item no longer exists",
  documentsLinkedLive: "Open this item",
  documentsLinkedBadge: "Referenced by {0} document(s)",
  documentsFilteredBy: "Showing documents linked to: {0}",
  documentsFilterClear: "Show all documents",
  documentsFilterEmpty: "No documents are linked to this item.",
```

- [ ] **Step 2: Add the DE keys via a node UTF-8 write**

```bash
node -e '
const fs = require("fs");
const p = "src/app/i18n.de.ts";
const s = fs.readFileSync(p, "utf8");
const anchor = "  documentsActions:";
const i = s.indexOf(anchor);
if (i < 0) { console.error("ANCHOR NOT FOUND"); process.exit(1); }
const eol = s.indexOf("\r\n", i);
if (eol < 0) { console.error("NO CRLF AFTER ANCHOR — check line endings"); process.exit(1); }
const add = [
  "  documentsLinkedEntities: \"Verknüpfte Einträge\",",
  "  documentsLinkedSearch: \"Aufgaben, Meilensteine, Risiken und Änderungen suchen\",",
  "  documentsLinkedPlaceholder: \"Zum Suchen tippen…\",",
  "  documentsLinkedRemove: \"Verknüpfung entfernen\",",
  "  documentsLinkedClear: \"Leeren – Verknüpfte Einträge\",",
  "  documentsLinkedDangling: \"Dieser Eintrag existiert nicht mehr\",",
  "  documentsLinkedLive: \"Diesen Eintrag öffnen\",",
  "  documentsLinkedBadge: \"In {0} Dokument(en) referenziert\",",
  "  documentsFilteredBy: \"Dokumente verknüpft mit: {0}\",",
  "  documentsFilterClear: \"Alle Dokumente anzeigen\",",
  "  documentsFilterEmpty: \"Mit diesem Eintrag ist kein Dokument verknüpft.\",",
].join("\r\n");
fs.writeFileSync(p, s.slice(0, eol + 2) + add + "\r\n" + s.slice(eol + 2), "utf8");
console.log("inserted");
'
```

Expected output: `inserted`.

★ The `\uXXXX` escapes above are for the **shell heredoc only** — they are decoded by node into real characters before the write, so the file receives real umlauts. The `i18n-encoding` test bans both ASCII substitutions (`fuer`) and literal `\u00XX` sequences in the source; verify in the next step rather than by eye.

- [ ] **Step 3: Verify parity and encoding**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx vitest run src/app/i18n-encoding.test.ts; echo "EXIT=$?"
grep -c "documentsLinked" src/app/i18n.ts src/app/i18n.de.ts
```

Expected: `EXIT=0` twice (tsc enforces EN/DE key parity), and both files report **8**.

- [ ] **Step 4: Commit**

```bash
git add src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat(i18n): add strings for document entity links"
```

---

## Task 5: give `EntityLinkPicker` a cross-kind key

**Files:**
- Modify: `src/app/entity-link-picker.tsx`, `src/app/task-link-picker.tsx`, `src/app/raid-edit-fields.tsx`
- Test: `src/app/entity-link-picker.test.tsx`

Why the primitive changes rather than the caller: `LinkPickerEntry.id` is a `number`, and our four kinds have colliding ids — "task 7" and "risk 7" produce the same React key and the same `onAdd`/`onRemove` argument. §110 is the precedent for extending a primitive instead of dodging it at the call site.

- [ ] **Step 1: Write the failing test**

Append to `src/app/entity-link-picker.test.tsx`:

```tsx
it("distinguishes two entries that share an id but not a key", async () => {
  const user = userEvent.setup();
  const onRemove = vi.fn();
  render(
    <EntityLinkPicker
      selected={[
        { key: "task:7", id: 7, code: "#7", label: "Kickoff" },
        { key: "raid:7", id: 7, code: "R#7", label: "Vendor delay" },
      ]}
      options={[]}
      query=""
      onQueryChange={() => {}}
      onAdd={() => {}}
      onRemove={onRemove}
      searchLabel="Search"
      placeholder="Search"
      removeLabel="Unlink"
      clearLabel="Clear"
    />,
  );
  await user.click(screen.getByRole("button", { name: "Unlink R#7 Vendor delay" }));
  expect(onRemove).toHaveBeenCalledWith(expect.objectContaining({ key: "raid:7" }));
});
```

- [ ] **Step 2: Run it to make sure it fails**

```bash
npx vitest run src/app/entity-link-picker.test.tsx -t "share an id"
```

Expected: FAIL — `onRemove` is called with `7`, not an object.

- [ ] **Step 3: Change the primitive**

In `src/app/entity-link-picker.tsx`:

Add to `LinkPickerEntry`, below `id`:

```ts
  /** Stable identity when `id` alone is not unique — a picker spanning several
   *  entity kinds has colliding ids. Defaults to `String(id)`. */
  key?: string;
```

Change the two callback props:

```ts
  onAdd: (entry: LinkPickerEntry) => void;
  onRemove: (entry: LinkPickerEntry) => void;
```

Add a helper above the component:

```ts
const entryKey = (entry: LinkPickerEntry): string => entry.key ?? String(entry.id);
```

Then update the three call sites inside the component:
- chip list: `key={entry.id}` → `key={entryKey(entry)}`, and `onClick={() => onRemove(entry.id)}` → `onClick={() => onRemove(entry)}`;
- option list: `key={entry.id}` → `key={entryKey(entry)}`, and `onClick={() => onAdd(entry.id)}` → `onClick={() => onAdd(entry)}`;
- the Enter branch in `onKeyDown`: `onAdd(options[active].id)` → `onAdd(options[active])`.

★ `onOpen` keeps its `(id: number)` signature — every consumer of it navigates within one kind, and both current callers pass an id-taking handler straight through.

- [ ] **Step 4: Update the three existing picker instances**

In `src/app/task-link-picker.tsx`, the `onAdd` prop passed to `EntityLinkPicker`:

```tsx
      onAdd={(entry) => {
        onAdd(entry.id);
        onQueryChange("");
      }}
      onRemove={(entry) => onRemove(entry.id)}
```

(keep whatever the existing body does after `onAdd(id)` — only the parameter changes).

In `src/app/raid-edit-fields.tsx`, both pickers:

```tsx
        onAdd={(entry) => addLinked(entry.id)}
        onRemove={(entry) => removeLinked(entry.id)}
```

and

```tsx
          onAdd={(entry) => addCausedBy(entry.id)}
          onRemove={(entry) => removeCausedBy(entry.id)}
```

- [ ] **Step 5: Run the affected suites**

```bash
npx vitest run src/app/entity-link-picker.test.tsx src/app/task-link-picker.test.tsx src/app/raid-edit-fields.test.tsx; echo "EXIT=$?"
npx tsc --noEmit; echo "EXIT=$?"
```

Expected: `EXIT=0` for both. tsc is what proves no call site was missed.

- [ ] **Step 6: Commit**

```bash
git add src/app/entity-link-picker.tsx src/app/entity-link-picker.test.tsx src/app/task-link-picker.tsx src/app/raid-edit-fields.tsx
git commit -m "refactor(ui): let EntityLinkPicker span entity kinds with colliding ids"
```

---

## Task 6: the attach field

**Files:**
- Create: `src/app/document-links-field.tsx`, `src/app/document-links-field.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/app/document-links-field.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DocumentLinksField } from "./document-links-field";

const lookups = {
  task: new Map([[7, "Kickoff"]]),
  milestone: new Map<number, string>(),
  raid: new Map<number, string>(),
  change: new Map<number, string>(),
};
const candidates = [{ kind: "task" as const, id: 7, title: "Kickoff" }, { kind: "raid" as const, id: 3, title: "Vendor delay" }];

describe("DocumentLinksField", () => {
  it("renders a live reference with no dangling marker", () => {
    const { container } = render(
      <DocumentLinksField lang="en-US" refs={[{ kind: "task", id: 7 }]} lookups={lookups} candidates={candidates} onLink={vi.fn()} onUnlink={vi.fn()} onOpenEntity={vi.fn()} />,
    );
    expect(screen.getByText("Kickoff")).toBeInTheDocument();
    expect(container.querySelector("[data-dangling-marker]")).toBeNull();
  });

  it("renders a dangling reference with the tombstone label AND a non-colour marker", () => {
    const { container } = render(
      <DocumentLinksField lang="en-US" refs={[{ kind: "task", id: 99, label: "Deleted task" }]} lookups={lookups} candidates={candidates} onLink={vi.fn()} onUnlink={vi.fn()} onOpenEntity={vi.fn()} />,
    );
    expect(screen.getByText("Deleted task")).toBeInTheDocument();
    expect(container.querySelector("[data-dangling-marker]")).not.toBeNull();
  });

  it("unlinks by (kind, id), not by id alone", async () => {
    const user = userEvent.setup();
    const onUnlink = vi.fn();
    render(
      <DocumentLinksField lang="en-US" refs={[{ kind: "task", id: 7 }, { kind: "raid", id: 7, label: "Vendor delay" }]} lookups={lookups} candidates={candidates} onLink={vi.fn()} onUnlink={onUnlink} onOpenEntity={vi.fn()} />,
    );
    await user.click(screen.getByRole("button", { name: /R#7/ }));
    expect(onUnlink).toHaveBeenCalledWith({ kind: "raid", id: 7 });
  });

  it("links with a tombstone label captured at attach time", async () => {
    const user = userEvent.setup();
    const onLink = vi.fn();
    render(
      <DocumentLinksField lang="en-US" refs={[]} lookups={lookups} candidates={candidates} onLink={onLink} onUnlink={vi.fn()} onOpenEntity={vi.fn()} />,
    );
    await user.type(screen.getByRole("combobox"), "Vendor");
    await user.click(screen.getByRole("option", { name: /Vendor delay/ }));
    expect(onLink).toHaveBeenCalledWith({ kind: "raid", id: 3, label: "Vendor delay" });
  });

  it("excludes already-linked candidates from the dropdown", async () => {
    const user = userEvent.setup();
    render(
      <DocumentLinksField lang="en-US" refs={[{ kind: "raid", id: 3 }]} lookups={lookups} candidates={candidates} onLink={vi.fn()} onUnlink={vi.fn()} onOpenEntity={vi.fn()} />,
    );
    await user.type(screen.getByRole("combobox"), "Vendor");
    expect(screen.queryByRole("option")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

```bash
npx vitest run src/app/document-links-field.test.tsx
```

Expected: FAIL — `Failed to resolve import "./document-links-field"`.

- [ ] **Step 3: Write the implementation**

Create `src/app/document-links-field.tsx`:

```tsx
"use client";

// src/app/document-links-field.tsx — the Documents pane's attach control.
//
// The ONE door that creates a document→entity reference (the entity-side door
// is a recorded follow-up, deliberately not built here). Built on the shared
// EntityLinkPicker rather than hand-rolled markup.

import { useMemo, useState } from "react";
import { EntityLinkPicker, type LinkPickerEntry } from "./entity-link-picker";
import {
  refKey,
  resolveDocRef,
  type DocEntityRef,
  type DocRefKind,
  type DocRefLookups,
} from "./document-ref";
import { type Lang, t } from "./i18n";

/** A linkable entity, flattened by the caller. */
export interface DocLinkCandidate {
  kind: DocRefKind;
  id: number;
  title: string;
}

/** Short monospace prefix per kind — also what makes each chip's remove button
 *  row-UNIQUE (WCAG 2.4.6), since ids collide across kinds. */
const CODE_PREFIX: Record<DocRefKind, string> = {
  task: "#",
  milestone: "M#",
  raid: "R#",
  change: "C#",
};

const codeOf = (kind: DocRefKind, id: number): string => `${CODE_PREFIX[kind]}${id}`;

interface DocumentLinksFieldProps {
  lang: Lang;
  refs: readonly DocEntityRef[];
  lookups: DocRefLookups;
  candidates: readonly DocLinkCandidate[];
  onLink: (ref: DocEntityRef) => void;
  onUnlink: (ref: Pick<DocEntityRef, "kind" | "id">) => void;
  onOpenEntity: (kind: DocRefKind, id: number) => void;
}

export function DocumentLinksField({
  lang,
  refs,
  lookups,
  candidates,
  onLink,
  onUnlink,
  onOpenEntity,
}: DocumentLinksFieldProps) {
  const [query, setQuery] = useState("");

  const linkedKeys = useMemo(() => new Set(refs.map((r) => refKey(r.kind, r.id))), [refs]);

  const selected: LinkPickerEntry[] = refs.map((ref) => {
    const { title, dangling } = resolveDocRef(ref, lookups);
    return {
      key: refKey(ref.kind, ref.id),
      id: ref.id,
      code: codeOf(ref.kind, ref.id),
      // A dangling ref with no stored label has nothing to show but its code.
      label: title || codeOf(ref.kind, ref.id),
      dangling,
    } as LinkPickerEntry & { dangling: boolean };
  });

  const options: LinkPickerEntry[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return candidates
      .filter((c) => !linkedKeys.has(refKey(c.kind, c.id)))
      .filter((c) => c.title.toLowerCase().includes(q) || codeOf(c.kind, c.id).toLowerCase().includes(q))
      .map((c) => ({ key: refKey(c.kind, c.id), id: c.id, code: codeOf(c.kind, c.id), label: c.title }));
  }, [candidates, linkedKeys, query]);

  const kindOf = (entry: LinkPickerEntry): DocRefKind =>
    (entry.key ?? "").split(":")[0] as DocRefKind;

  return (
    <div>
      <div className="mb-1 text-xs font-medium text-muted-foreground">
        {t(lang, "documentsLinkedEntities")}
      </div>
      <EntityLinkPicker
        selected={selected}
        options={options}
        query={query}
        onQueryChange={setQuery}
        onAdd={(entry) => {
          // ★ The tombstone label is captured HERE, at attach time — it is what
          // a chip falls back to once the entity is deleted. It is NEVER read
          // while the entity lives (resolveDocRef enforces that).
          onLink({ kind: kindOf(entry), id: entry.id, label: entry.label });
          setQuery("");
        }}
        onRemove={(entry) => onUnlink({ kind: kindOf(entry), id: entry.id })}
        onOpen={(id) => {
          const ref = refs.find((r) => r.id === id);
          if (ref) onOpenEntity(ref.kind, ref.id);
        }}
        searchLabel={t(lang, "documentsLinkedSearch")}
        placeholder={t(lang, "documentsLinkedPlaceholder")}
        removeLabel={t(lang, "documentsLinkedRemove")}
        clearLabel={t(lang, "documentsLinkedClear")}
      />
      {/* ★★ The dangling cue is a non-colour MARKER, not a tint: `title` is the
          accessible DESCRIPTION and is hover-only, so it discloses the state to
          a screen reader but closes nothing for WCAG 1.4.1. The glyph does.
          Mirrors ResourcePicker's data-dangling-marker. */}
      <div className="mt-1 flex flex-wrap gap-2">
        {selected
          .filter((entry) => (entry as LinkPickerEntry & { dangling: boolean }).dangling)
          .map((entry) => (
            <span
              key={entry.key}
              data-dangling-marker
              title={t(lang, "documentsLinkedDangling")}
              className="inline-flex items-center gap-1 text-xs text-muted-foreground"
            >
              <span aria-hidden="true">⚠</span>
              {entry.code}
            </span>
          ))}
      </div>
    </div>
  );
}
```

★ `onOpen` resolves the ref by bare `id`, which is ambiguous across kinds — the `refs.find` above takes the FIRST match. Accept it for this task: `EntityLinkPicker.onOpen` is id-only and both existing consumers are single-kind. If the ambiguity shows up in review, widen `onOpen` to take the entry in the same way `onAdd`/`onRemove` were widened in Task 5, and update the two existing callers.

- [ ] **Step 4: Run the tests and make sure they pass**

```bash
npx vitest run src/app/document-links-field.test.tsx; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app/document-links-field.tsx; echo "EXIT=$?"
npx tsc --noEmit; echo "EXIT=$?"
```

Expected: `EXIT=0` three times.

- [ ] **Step 5: Commit**

```bash
git add src/app/document-links-field.tsx src/app/document-links-field.test.tsx
git commit -m "feat(documents): add the attach field for entity links"
```

---

## Task 7: `DocumentBadge`

**Files:**
- Create: `src/app/document-badge.tsx`, `src/app/document-badge.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/app/document-badge.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DocumentBadge } from "./document-badge";

describe("DocumentBadge", () => {
  it("renders the count and calls onOpen", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(<DocumentBadge lang="en-US" count={2} entityTitle="Kickoff" onOpen={onOpen} />);
    await user.click(screen.getByRole("button"));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  // ★★★ THE ONLY POSSIBLE DETECTOR for this collision. Measured against
  // axe-core 4.12.1: no rule carrying the four tags e2e/a11y.spec.ts requests
  // flags two controls sharing an accessible name, at ANY seed size.
  it("gives two badges on different rows row-UNIQUE accessible names", () => {
    render(
      <>
        <DocumentBadge lang="en-US" count={2} entityTitle="Kickoff" onOpen={vi.fn()} />
        <DocumentBadge lang="en-US" count={2} entityTitle="Vendor delay" onOpen={vi.fn()} />
      </>,
    );
    const names = screen.getAllByRole("button").map((b) => b.getAttribute("aria-label"));
    expect(new Set(names).size).toBe(2);
    expect(names[0]).toContain("Kickoff");
  });

  it("renders nothing at count 0", () => {
    const { container } = render(<DocumentBadge lang="en-US" count={0} entityTitle="Kickoff" onOpen={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("stops the click from reaching the row", async () => {
    const user = userEvent.setup();
    const onRowClick = vi.fn();
    render(
      <div onClick={onRowClick}>
        <DocumentBadge lang="en-US" count={1} entityTitle="Kickoff" onOpen={vi.fn()} />
      </div>,
    );
    await user.click(screen.getByRole("button"));
    expect(onRowClick).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

```bash
npx vitest run src/app/document-badge.test.tsx
```

Expected: FAIL — `Failed to resolve import "./document-badge"`.

- [ ] **Step 3: Write the implementation**

Create `src/app/document-badge.tsx`:

```tsx
"use client";

// src/app/document-badge.tsx — "N documents reference this row".
//
// ★★ PROPS ONLY, no context. It renders inside the Kanban card, which sits
// OUTSIDE RowContextProvider, and `useWorkspaceTab` THROWS without a provider —
// either hook would crash a surface or an unwrapped test. The host supplies
// `onOpen`. Same rule, same reason, as task-raid-badge.tsx.

import { memo } from "react";
import { DocumentTextIcon } from "@heroicons/react/24/outline";
import { type Lang, t } from "./i18n";
import { INTERACTIVE } from "./interaction-styles";

interface DocumentBadgeProps {
  /** How many documents reference this entity. 0 renders nothing. */
  count: number;
  /** ★ Row-UNIQUE qualifier for the accessible name (WCAG 2.4.6). N identical
   *  "2 documents" names in a list is a failure the axe gate CANNOT see. */
  entityTitle: string;
  lang: Lang;
  onOpen: () => void;
}

function DocumentBadgeImpl({ count, entityTitle, lang, onOpen }: DocumentBadgeProps) {
  // A badge reading 0 is noise on every row of an unlinked project.
  if (count <= 0) return null;
  const name = `${t(lang, "documentsLinkedBadge", count)} – ${entityTitle}`;
  return (
    <button
      type="button"
      onClick={(e) => {
        // In-<tr> controls must stop propagation or the row's own handler fires.
        e.stopPropagation();
        onOpen();
      }}
      title={t(lang, "documentsLinkedBadge", count)}
      aria-label={name}
      className={`ml-1 inline-flex items-center gap-0.5 rounded bg-surface-muted px-1.5 py-0.5 text-[10px] font-medium text-foreground ${INTERACTIVE}`}
    >
      <DocumentTextIcon aria-hidden="true" className="h-3 w-3" />
      {count}
    </button>
  );
}

export const DocumentBadge = memo(DocumentBadgeImpl);
```

- [ ] **Step 4: Run the tests and make sure they pass**

```bash
npx vitest run src/app/document-badge.test.tsx; echo "EXIT=$?"
```

Expected: `EXIT=0`, 4 tests.

- [ ] **Step 5: Mutation-check the uniqueness test**

Temporarily drop the qualifier: `const name = t(lang, "documentsLinkedBadge", count);`
Run: `npx vitest run src/app/document-badge.test.tsx`
Expected: FAIL on "row-UNIQUE accessible names". **Revert.** A passing run here means the test is vacuous and nothing in the repo can see the collision.

- [ ] **Step 6: Commit**

```bash
git add src/app/document-badge.tsx src/app/document-badge.test.tsx
git commit -m "feat(documents): add the shared linked-documents row badge"
```

---

## Task 8: the deep-link request on `WorkspaceTabContext`

**Files:**
- Modify: `src/app/workspace-tab-context.tsx`
- Test: `src/app/workspace-tab-context.test.tsx` (create if absent)

This mirrors the two request/consume triples the context already carries (`requestChat`/`clearChatSeed`, `requestHelpConcept`/`clearHelpConcept`).

- [ ] **Step 1: Write the failing test**

Create or append to `src/app/workspace-tab-context.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { WorkspaceTabProvider, useWorkspaceTab } from "./workspace-tab-context";

describe("requestDocumentsForEntity", () => {
  it("switches to the documents view and arms the filter", () => {
    const { result } = renderHook(() => useWorkspaceTab(), { wrapper: WorkspaceTabProvider });
    act(() => result.current.requestDocumentsForEntity("raid", 3));
    expect(result.current.activeTab).toBe("documents");
    expect(result.current.pendingDocEntityFilter).toEqual({ kind: "raid", id: 3 });
  });

  it("clears the filter on consume", () => {
    const { result } = renderHook(() => useWorkspaceTab(), { wrapper: WorkspaceTabProvider });
    act(() => result.current.requestDocumentsForEntity("raid", 3));
    act(() => result.current.clearDocEntityFilter());
    expect(result.current.pendingDocEntityFilter).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

```bash
npx vitest run src/app/workspace-tab-context.test.tsx -t "requestDocumentsForEntity"
```

Expected: FAIL — `result.current.requestDocumentsForEntity is not a function`.

- [ ] **Step 3: Write the implementation**

In `src/app/workspace-tab-context.tsx`, add the import:

```ts
import type { DocRefKind } from "./document-ref";
```

Add to `WorkspaceTabContextValue`, beside the other pending/request/clear triples:

```ts
  /** Armed by a DocumentBadge; consumed by the Documents pane. */
  pendingDocEntityFilter: { kind: DocRefKind; id: number } | null;
  requestDocumentsForEntity: (kind: DocRefKind, id: number) => void;
  clearDocEntityFilter: () => void;
```

Add the state and callbacks beside `requestChat`:

```ts
  const [pendingDocEntityFilter, setPendingDocEntityFilter] = useState<{ kind: DocRefKind; id: number } | null>(null);
  const requestDocumentsForEntity = useCallback((kind: DocRefKind, id: number) => {
    setActiveTab("documents");
    setPendingDocEntityFilter({ kind, id });
  }, []);
  const clearDocEntityFilter = useCallback(() => setPendingDocEntityFilter(null), []);
```

Add all three to the provider's `value={{ … }}` object.

- [ ] **Step 4: Run the tests and make sure they pass**

```bash
npx vitest run src/app/workspace-tab-context.test.tsx; echo "EXIT=$?"
npx tsc --noEmit; echo "EXIT=$?"
```

Expected: `EXIT=0` for both.

- [ ] **Step 5: Commit**

```bash
git add src/app/workspace-tab-context.tsx src/app/workspace-tab-context.test.tsx
git commit -m "feat(documents): add the entity→documents deep-link request"
```

---

## Task 9: wire the Documents pane — attach field, filter, banner

**Files:**
- Modify: `src/app/documents-panel.tsx`
- Test: `src/app/documents-panel.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `src/app/documents-panel.test.tsx` (use the file's existing render helper and real-provider setup):

```tsx
describe("entity filter", () => {
  it("filters the list to documents linked to the pending entity, and clears on dismiss", async () => {
    const user = userEvent.setup();
    // Arrange: two documents, only the first linked to raid #3.
    renderPanelWithPendingFilter({
      documents: [
        { id: 1, title: "Risk memo", blocks: [], createdAt: ISO, updatedAt: ISO, linkedEntities: [{ kind: "raid", id: 3 }] },
        { id: 2, title: "Charter", blocks: [], createdAt: ISO, updatedAt: ISO },
      ],
      pendingDocEntityFilter: { kind: "raid", id: 3 },
    });

    expect(screen.getByText("Risk memo")).toBeInTheDocument();
    expect(screen.queryByText("Charter")).toBeNull();

    await user.click(screen.getByRole("button", { name: /show all documents/i }));
    expect(screen.getByText("Charter")).toBeInTheDocument();
  });

  it("HONORS a filter armed before this pane first mounted", () => {
    // ★★★ The remount-swallow trap: the modern shell renders only the active
    // view, so this pane mounts FRESH on arrival and the request is already
    // present in its first render. A handled-ref seeded from the LIVE prop
    // would treat it as already-consumed and show an unfiltered list.
    renderPanelWithPendingFilter({
      documents: [
        { id: 1, title: "Risk memo", blocks: [], createdAt: ISO, updatedAt: ISO, linkedEntities: [{ kind: "raid", id: 3 }] },
        { id: 2, title: "Charter", blocks: [], createdAt: ISO, updatedAt: ISO },
      ],
      pendingDocEntityFilter: { kind: "raid", id: 3 },
    });
    expect(screen.queryByText("Charter")).toBeNull();
  });
});
```

Add the helper beside the file's existing ones — it renders the panel inside the real `WorkspaceTabProvider` and arms the filter before the first render:

```tsx
function renderPanelWithPendingFilter({ documents, pendingDocEntityFilter }) {
  function Arm({ children }: { children: React.ReactNode }) {
    const { requestDocumentsForEntity } = useWorkspaceTab();
    const [armed, setArmed] = useState(false);
    if (!armed) {
      setArmed(true);
      requestDocumentsForEntity(pendingDocEntityFilter.kind, pendingDocEntityFilter.id);
    }
    return <>{children}</>;
  }
  return renderPanel({ documents, wrapper: Arm });
}
```

- [ ] **Step 2: Run it to make sure it fails**

```bash
npx vitest run src/app/documents-panel.test.tsx -t "entity filter"
```

Expected: FAIL — both documents render; no "Show all documents" button exists.

- [ ] **Step 3: Write the implementation**

In `src/app/documents-panel.tsx`:

Add imports:

```ts
import { indexDocumentsByEntity, refKey, resolveDocRef, type DocEntityRef, type DocRefKind, type DocRefLookups } from "./document-ref";
import { DocumentLinksField, type DocLinkCandidate } from "./document-links-field";
```

Read the request from the tab context (the pane already calls `useWorkspaceTab()` — destructure three more values):

```ts
  const { pendingDocEntityFilter, clearDocEntityFilter, requestOpen } = useWorkspaceTab();
```

Hold the applied filter in local state and reconcile at render time:

```ts
  const [entityFilter, setEntityFilter] = useState<{ kind: DocRefKind; id: number } | null>(null);
  // ★★★ SENTINEL SEED — `undefined` means "nothing handled yet", which is NOT
  // the same as `null` ("handled, and it was empty"). Seeding this from the
  // LIVE prop is the remount-swallow trap: this pane mounts fresh on arrival,
  // so the request is already present in its first render and a live seed would
  // classify it as consumed. Render-time reconcile, never a useEffect
  // (`set-state-in-effect` is fatal).
  const [handledFilter, setHandledFilter] = useState<
    { kind: DocRefKind; id: number } | null | undefined
  >(undefined);
  if (handledFilter !== pendingDocEntityFilter) {
    setHandledFilter(pendingDocEntityFilter);
    if (pendingDocEntityFilter) setEntityFilter(pendingDocEntityFilter);
  }
```

Build the lookups and the candidate list from the workspace the pane already receives.

★★ **The four display fields are NOT all called `title`** — verified against `sample-workspace-small.json` and `workspace.ts`, not assumed: a task's is **`taskName`**, a milestone's is **`name`**, and RAID and changes use `title`. ★★ `milestones` and `changes` are **optional** on `Workspace`, so every read needs `?? []` or the pane crashes on a project that has never had one.

```ts
  const lookups: DocRefLookups = useMemo(
    () => ({
      task: new Map((workspace.tasks ?? []).map((x) => [x.id, x.taskName])),
      milestone: new Map((workspace.milestones ?? []).map((x) => [x.id, x.name])),
      raid: new Map((workspace.raid ?? []).map((x) => [x.id, x.title])),
      change: new Map((workspace.changes ?? []).map((x) => [x.id, x.title])),
    }),
    [workspace.tasks, workspace.milestones, workspace.raid, workspace.changes],
  );

  const candidates: DocLinkCandidate[] = useMemo(
    () => [
      ...(workspace.tasks ?? []).map((x) => ({ kind: "task" as const, id: x.id, title: x.taskName })),
      ...(workspace.milestones ?? []).map((x) => ({ kind: "milestone" as const, id: x.id, title: x.name })),
      ...(workspace.raid ?? []).map((x) => ({ kind: "raid" as const, id: x.id, title: x.title })),
      ...(workspace.changes ?? []).map((x) => ({ kind: "change" as const, id: x.id, title: x.title })),
    ],
    [workspace.tasks, workspace.milestones, workspace.raid, workspace.changes],
  );
```

Filter the list the pane already sorts. Find where it computes its visible rows and wrap that array:

```ts
  const entityIndex = useMemo(() => indexDocumentsByEntity(documents), [documents]);
  const visibleDocuments = useMemo(() => {
    if (!entityFilter) return sortedDocuments;
    const allowed = new Set((entityIndex.get(refKey(entityFilter.kind, entityFilter.id)) ?? []).map((d) => d.id));
    return sortedDocuments.filter((d) => allowed.has(d.id));
  }, [sortedDocuments, entityFilter, entityIndex]);
```

Pass `visibleDocuments` to `<DocumentsList>` in place of the previous array.

Render the banner directly above the list:

```tsx
      {entityFilter && (
        <div className="mb-2 flex items-center gap-2 rounded border border-line bg-surface-muted px-2 py-1 text-xs">
          <span>
            {t(lang, "documentsFilteredBy", resolveDocRef({ kind: entityFilter.kind, id: entityFilter.id }, lookups).title || `#${entityFilter.id}`)}
          </span>
          <button
            type="button"
            onClick={() => {
              setEntityFilter(null);
              // Consume the parent's request too, or navigating away and back
              // re-applies it.
              clearDocEntityFilter();
            }}
            className={INTERACTIVE}
            aria-label={t(lang, "documentsFilterClear")}
          >
            ✕
          </button>
        </div>
      )}
      {entityFilter && visibleDocuments.length === 0 && (
        <p className="mb-2 text-xs text-muted-foreground">{t(lang, "documentsFilterEmpty")}</p>
      )}
```

Render the attach field for the selected document, beside the preview (inside whatever container currently holds the selected document's detail):

```tsx
      {selectedDocument && (
        <DocumentLinksField
          lang={lang}
          refs={selectedDocument.linkedEntities ?? []}
          lookups={lookups}
          candidates={candidates}
          onLink={(ref: DocEntityRef) => mutateDocuments({ kind: "link", id: selectedDocument.id, ref })}
          onUnlink={(ref) => mutateDocuments({ kind: "unlink", id: selectedDocument.id, ref })}
          onOpenEntity={(kind, id) => requestOpen(VIEW_BY_KIND[kind], id)}
        />
      )}
```

Add the view map beside the pane's other module-level constants:

```ts
/** Which view owns each linkable entity kind — for the chip's click-through. */
const VIEW_BY_KIND: Record<DocRefKind, AppView> = {
  task: "open-points",
  milestone: "milestones",
  raid: "raid",
  change: "changes",
};
```

(import `type AppView` from `./nav-config`; confirm each slug against `nav-config.ts` before committing.)

- [ ] **Step 4: Run the tests and make sure they pass**

```bash
npx vitest run src/app/documents-panel.test.tsx; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app/documents-panel.tsx; echo "EXIT=$?"
npx tsc --noEmit; echo "EXIT=$?"
```

Expected: `EXIT=0` three times.

- [ ] **Step 5: Check the file-size ratchet**

```bash
node -e "console.log(require('fs').readFileSync('src/app/documents-panel.tsx','utf8').split('\n').length)"
npm run size:check; echo "EXIT=$?"
```

Expected: `EXIT=0`. If the panel is now over its baseline, extract the banner into a small presentational sibling rather than raising the baseline — the gate counts `wc -l` **+ 1**, so budget from the number the node command prints.

- [ ] **Step 6: Commit**

```bash
git add src/app/documents-panel.tsx src/app/documents-panel.test.tsx
git commit -m "feat(documents): attach entities and filter documents by entity"
```

---

## Task 10: the badge on RAID, changes and milestones

**Files:**
- Modify: `src/app/raid-panel-rows.tsx`, `src/app/change-panel.tsx`, `src/app/milestones-panel.tsx`
- Test: `src/app/raid-panel.test.tsx`, `src/app/change-panel.test.tsx`, `src/app/milestones-panel.test.tsx`

These three panels already call `useWorkspaceTab` (via `useDeepLinkRowFlash`), so each builds its own callback locally — no prop threading.

- [ ] **Step 1: Write the failing test (RAID first)**

Append to `src/app/raid-panel.test.tsx`:

```tsx
it("shows a linked-documents badge that arms the documents filter", async () => {
  const user = userEvent.setup();
  renderPanel({
    raid: [raid(3, { title: "Vendor delay" }), raid(4, { title: "Scope creep" })],
    documents: [{ id: 1, title: "Risk memo", blocks: [], createdAt: ISO, updatedAt: ISO, linkedEntities: [{ kind: "raid", id: 3 }] }],
  });
  const badge = screen.getByRole("button", { name: /Vendor delay/ });
  expect(badge).toHaveAccessibleName(expect.stringContaining("1"));
  await user.click(badge);
  // The pane switched to Documents — assert via the provider the harness renders.
  expect(await screen.findByTestId("active-tab")).toHaveTextContent("documents");
});
```

★ If `raid-panel.test.tsx` has no `active-tab` probe, add a one-line consumer to its wrapper that renders `activeTab` into a `data-testid="active-tab"` span. Do not assert on `setActiveTab` being called — assert the observable state.

- [ ] **Step 2: Run it to make sure it fails**

```bash
npx vitest run src/app/raid-panel.test.tsx -t "linked-documents badge"
```

Expected: FAIL — no matching button.

- [ ] **Step 3: Implement in `raid-panel-rows.tsx`**

Compute the index once in the panel (`raid-panel.tsx`) and pass it to the rows:

```ts
  const documentsByEntity = useMemo(() => indexDocumentsByEntity(documents), [documents]);
```

In the row component, inside the title cell, after the existing title content:

```tsx
        <DocumentBadge
          lang={lang}
          count={documentsByEntity.get(refKey("raid", item.id))?.length ?? 0}
          entityTitle={item.title}
          onOpen={() => requestDocumentsForEntity("raid", item.id)}
        />
```

`requestDocumentsForEntity` comes from `useWorkspaceTab()` in `raid-panel.tsx` and is threaded to the rows as a prop, alongside the index.

- [ ] **Step 4: Run the RAID test and make sure it passes**

```bash
npx vitest run src/app/raid-panel.test.tsx; echo "EXIT=$?"
```

Expected: `EXIT=0`.

- [ ] **Step 5: Repeat for changes and milestones**

Same three edits per panel, with the kind and title field changed:
- `change-panel.tsx` — `refKey("change", item.id)`, `entityTitle={item.title}`, `requestDocumentsForEntity("change", item.id)`.
- `milestones-panel.tsx` — `refKey("milestone", item.id)`, `entityTitle={item.name}`, `requestDocumentsForEntity("milestone", item.id)`.

Write the equivalent test in each panel's suite first (copy the RAID test, change the fixture kind and the title), watch it fail, then implement.

- [ ] **Step 6: Run all three suites**

```bash
npx vitest run src/app/raid-panel.test.tsx src/app/change-panel.test.tsx src/app/milestones-panel.test.tsx; echo "EXIT=$?"
npx tsc --noEmit; echo "EXIT=$?"
```

Expected: `EXIT=0` for both.

- [ ] **Step 7: Commit**

```bash
git add src/app/raid-panel.tsx src/app/raid-panel-rows.tsx src/app/change-panel.tsx src/app/milestones-panel.tsx src/app/raid-panel.test.tsx src/app/change-panel.test.tsx src/app/milestones-panel.test.tsx
git commit -m "feat(documents): show the linked-documents badge on RAID, changes and milestones"
```

---

## Task 11: the badge on tasks (table row + Kanban)

**Files:**
- Modify: `src/app/task-manager.tsx`, `src/app/tasks-section.tsx`, `src/app/task-row.tsx`, `src/app/task-kanban-card.tsx`, `src/app/task-kanban-board.tsx`, `src/app/task-kanban-swimlanes.tsx`
- Test: `src/app/task-row.test.tsx`, `src/app/task-kanban-card.test.tsx`

Tasks are the one surface that needs threading, and the path already exists: `raidByTask` is built in `task-manager.tsx` with a `useMemo` and threaded to `tasks-section` → board/swimlanes → card, and to the row as a `raidRefs` prop. **Mirror it exactly** — same names, same layers, same optionality.

- [ ] **Step 1: Write the failing test**

Append to `src/app/task-row.test.tsx`:

```tsx
it("renders the linked-documents badge with a row-unique name", () => {
  // ★ A task's display field is `taskName`, not `title`.
  renderRow({ task: task(7, { taskName: "Kickoff" }), docCount: 2 });
  expect(screen.getByRole("button", { name: /Kickoff/ })).toHaveAccessibleName(expect.stringContaining("2"));
});

it("renders no badge when the task has no linked documents", () => {
  renderRow({ task: task(7, { taskName: "Kickoff" }), docCount: 0 });
  expect(screen.queryByRole("button", { name: /document/i })).toBeNull();
});
```

- [ ] **Step 2: Run it to make sure it fails**

```bash
npx vitest run src/app/task-row.test.tsx -t "linked-documents badge"
```

Expected: FAIL — the row takes no `docCount` prop.

- [ ] **Step 3: Build the map in `task-manager.tsx`**

Two values must be in scope first, and neither is today — verified, not assumed:

- **`documents`**: `task-manager.tsx` destructures `setDocuments` from the workspace context (around the `setInsights, setDocuments, setDocumentVersions` group) but **not** `documents`. Add `documents` to that same destructure; the context already exposes it.
- **`requestDocumentsForEntity`**: `task-manager.tsx` already calls `useWorkspaceTab()` once, destructuring `isPopout, activeTab, setActiveTab, requestOpen, …`. Add the new name to **that** destructure — do not add a second `useWorkspaceTab()` call.

Then, beside the existing `raidByTask` memo:

```ts
  // Mirrors raidByTask: built once here, threaded down. Counting per row would
  // rebuild the index on every row render.
  const docCountByTask = useMemo(() => {
    const index = indexDocumentsByEntity(documents);
    const out = new Map<number, number>();
    for (const task of tasks) {
      const n = index.get(refKey("task", task.id))?.length ?? 0;
      if (n > 0) out.set(task.id, n);
    }
    return out;
  }, [documents, tasks]);
```

Pass `docCountByTask={docCountByTask}` to `<TasksSection>` and to the Kanban board where `raidByTask` is already passed.

- [ ] **Step 4: Thread it through**

- `tasks-section.tsx`: add `docCountByTask: Map<number, number>` to the props interface, destructure it, and pass it to the board and the swimlanes exactly where `raidByTask` is passed; pass `docCount={docCountByTask.get(task.id) ?? 0}` to each row where `raidRefs` is passed.
- `task-kanban-board.tsx` and `task-kanban-swimlanes.tsx`: add `docCountByTask?: Map<number, number>`, and pass `docCount={docCountByTask?.get(task.id) ?? 0}` to the card where `raidRefs={raidByTask?.get(task.id)}` is passed.
- `task-row.tsx` and `task-kanban-card.tsx`: add `docCount: number` (row) / `docCount?: number` (card) plus `onOpenDocuments: (taskId: number) => void`, and render beside the existing `RaidBadge`:

```tsx
          <DocumentBadge
            lang={lang}
            count={docCount ?? 0}
            entityTitle={task.taskName}
            onOpen={() => onOpenDocuments(task.id)}
          />
```

- `onOpenDocuments` is built once in `task-manager.tsx` next to `onJumpToRaid`, using the `requestDocumentsForEntity` added to the existing `useWorkspaceTab()` destructure in Step 3:

```ts
  const onOpenDocuments = useCallback(
    (taskId: number) => requestDocumentsForEntity("task", taskId),
    [requestDocumentsForEntity],
  );
```

and threaded on the same path as `onJumpToRaid`.

- [ ] **Step 5: Run the task suites**

```bash
npx vitest run src/app/task-row.test.tsx src/app/task-kanban-card.test.tsx src/app/tasks-section.test.tsx src/app/task-manager.characterization.test.tsx; echo "EXIT=$?"
npx tsc --noEmit; echo "EXIT=$?"
```

Expected: `EXIT=0` for both. `task-manager.characterization.test.tsx` pins the task-manager→WorkspaceSection prop contract — if it fails, update it deliberately; that is what it is for.

- [ ] **Step 6: Commit**

```bash
git add src/app/task-manager.tsx src/app/tasks-section.tsx src/app/task-row.tsx src/app/task-kanban-card.tsx src/app/task-kanban-board.tsx src/app/task-kanban-swimlanes.tsx src/app/task-row.test.tsx src/app/task-kanban-card.test.tsx
git commit -m "feat(documents): show the linked-documents badge on task rows and cards"
```

---

## Task 12: sample data and goldens

**Files:**
- Modify: `sample-workspace-small.json` (the repo-root-relative path `git ls-files` reports), the generated `-big`/`-huge`, `src/app/__fixtures__/golden-workspace.md`, `src/app/__fixtures__/golden-workspace.csv`

The sample master carries exactly **1** document today and both goldens serialize it, so seeding one link is a real format change — regenerate, never hand-edit the derived files.

- [ ] **Step 1: Seed one link in the master**

```bash
node -e '
const fs = require("fs");
const p = "sample-workspace-small.json";
const w = JSON.parse(fs.readFileSync(p, "utf8"));
if (!w.documents || w.documents.length === 0) { console.error("NO DOCUMENT IN SAMPLE"); process.exit(1); }
const task = w.tasks[0];
// ★ `taskName`, not `title` — a task has no `title` field, and an undefined
//   label would be dropped by sanitizeDocEntityRefs, leaving the tombstone
//   half of this fixture untested.
w.documents[0].linkedEntities = [{ kind: "task", id: task.id, label: task.taskName }];
fs.writeFileSync(p, JSON.stringify(w, null, 2) + "\n", "utf8");
console.log("linked doc", w.documents[0].id, "to task", task.id, JSON.stringify(task.taskName));
'
```

Expected: one `linked doc … to task …` line.

★ Match the file's existing indentation and trailing-newline convention — check with `git diff --stat` that the diff is a handful of lines, not the whole file. If the whole file rewrites, re-read the original formatting and redo the write.

- [ ] **Step 2: Regenerate the scaled samples**

```bash
npx vite-node scripts/generate-sample-workspace.ts; echo "EXIT=$?"
```

Expected: `EXIT=0`.

- [ ] **Step 3: Regenerate the goldens**

```bash
npx vitest run src/app/golden-workspace.test.ts; echo "EXIT=$?"
```

Expected: FAIL on the byte comparison. Regenerate with whatever update flag that suite documents in its header (check the file — it names its own regeneration command), then re-run.

Expected after regeneration: `EXIT=0`.

- [ ] **Step 4: Read the diff before trusting it**

```bash
git diff --stat src/app/__fixtures__/
git diff src/app/__fixtures__/golden-workspace.csv | head -40
```

Expected: the diff touches the documents section only. A diff that reformats unrelated rows means a serializer changed — stop and investigate rather than committing.

- [ ] **Step 5: Commit**

```bash
git add sample-workspace-small.json src/app/__fixtures__/
git commit -m "test(documents): seed a document entity link and regenerate goldens"
```

---

## Task 13: e2e seed and the full gate run

**Files:**
- Modify: `e2e/seed.ts`

- [ ] **Step 1: Seed a link in the e2e fixture**

`e2e/seed.ts` appends its own e2e-only document (`id: 9001`, "Kickoff pack") on top of the sample's — deliberately, so a test-only row never forces a golden regen. Put the link on **that** document, not on the sample's, for the same reason.

In its object literal, after `updatedAt`, add:

```ts
      // Task #1 exists in every seeded workspace (the sample master's first
      // task). Without this the Documents scan renders an unlinked document and
      // the new chips never exist at scan time — a view being in A11Y_VIEWS is
      // not the same as that view being covered.
      linkedEntities: [{ kind: "task", id: 1 }],
```

The sample's own document already carries a link from Task 12, so both the label-bearing and the label-less shapes are seeded.

★ A view being in `A11Y_VIEWS` is not the same as being covered — the scan only sees what the seed put in IndexedDB. Without this, the Documents scan renders an unlinked document and the new chips never exist at scan time.

- [ ] **Step 2: Prove the seed still resolves**

```bash
npx playwright test e2e/a11y.spec.ts --list; echo "EXIT=$?"
```

Expected: `EXIT=0` and **91** tests listed. This also proves `e2e/seed.ts`'s module-top-level sample read still works — a stale path ENOENTs the whole e2e job and only fails in CI.

- [ ] **Step 3: Run axe on the two affected views**

```bash
npx playwright test e2e/a11y.spec.ts --project=chromium -g "Documents" --workers=1; echo "EXIT=$?"
npx playwright test e2e/a11y.spec.ts --project=chromium -g "Open Points" --workers=1; echo "EXIT=$?"
```

Expected: `EXIT=0` for both. **`--workers=1` is required** whenever more than one view is matched: CI runs axe serially and local runs it at CPU-count, and over-subscription produces `Test timeout of 60000ms exceeded` failures with no violation text. Warm the route first (`curl -o /dev/null http://localhost:3000/`) so the first navigation's Turbopack compile does not eat the 60s budget.

- [ ] **Step 4: Run the full local gate set, serially, unpiped**

```bash
npx eslint --max-warnings=0 src/app; echo "EXIT=$?"
npx tsc --noEmit; echo "EXIT=$?"
npm run test:run > /tmp/suite.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/suite.log
npm run test:shuffle > /tmp/shuffle.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/shuffle.log
npm run test:coverage > /tmp/cov.log 2>&1; echo "EXIT=$?"
npm run size:check; echo "EXIT=$?"
npm run dup:check; echo "EXIT=$?"
npm run docs:symbols:check; echo "EXIT=$?"
npm run docs:claims:check; echo "EXIT=$?"
```

Expected: `EXIT=0` for every one.

Notes on the two most likely failures:
- **`dup:check`** has only 0.56pp of headroom on the TOTAL duplicated-LINE figure, and this slice adds four near-identical badge call sites — exactly what it counts. If it fails, factor the repeated call site rather than raising the threshold.
- **`test:coverage`** gates `document-ref.ts` as a new coverage-counted `.ts`. That is correct — it holds real logic, not UI glue, so it must carry its own tests rather than being added to `coverage.exclude`.

- [ ] **Step 5: Commit**

```bash
git add e2e/seed.ts
git commit -m "test(e2e): seed a document entity link so the a11y scan sees the chips"
```

---

## Task 14: documentation

**Files:**
- Modify: `docs/AGENTS/documents.md`, `docs/open-followups.md`

- [ ] **Step 1: Document the field**

In `docs/AGENTS/documents.md`, add a section covering:
- `linkedEntities` is sparse and lives inside the `documents` meta-blob;
- ★★★ `sanitizeDocument` builds from an explicit field list, so a new persisted field must be added there or it is dropped on every load;
- `link`/`unlink` write no version and do not move `updatedAt`, and why;
- `resolveDocRef` is the only reader of `label`, and the tombstone rule;
- dangling references are left in place deliberately, with the undo argument.

Cite **symbols**, never `file:LINE` — `docs:claims:check` is a ratchet that fails on a NEW `path:LINE` citation, and a line cite is invalidated by the next insertion above it.

- [ ] **Step 2: Open the follow-up for door B**

Append a new numbered entry to `docs/open-followups.md` — take the next free number (the register's max is **§138** as of `ab085ef2`; re-check `grep -n "^## 1[0-9][0-9]\." docs/open-followups.md | tail -3` before writing, since another branch may have taken it). Record: entity-side attach was designed and deliberately deferred; the model is already shaped for it (`document-ref.ts` is a leaf, so the four editors can import it without a cycle); the reason one door shipped rather than two.

Add the matching row to the index table at the top of the file.

- [ ] **Step 3: Verify the doc gates**

```bash
npm run docs:symbols:check; echo "EXIT=$?"
npm run docs:claims:check; echo "EXIT=$?"
```

Expected: `EXIT=0` for both. `docs:symbols:check` fails if a backticked mixed-case name in either file does not exist in `src`/`scripts`/`e2e` — note it **skips every SCREAMING_CASE name**, so `MAX_LINKS_PER_DOC` is ungated and must be checked by hand.

- [ ] **Step 4: Commit**

```bash
git add docs/AGENTS/documents.md docs/open-followups.md
git commit -m "docs: record the entity-link model and defer the entity-side door"
```

---

## Release checklist (only when the user says to release)

This slice adds a user-visible feature, so it takes a version bump. Do **not** push, open an MR, or merge without an explicit instruction.

- [ ] Bump `src/app/version.ts` (`APP_VERSION` + `APP_BUILD_DATE` + milestone codename).
- [ ] Add the `CHANGELOG.md` entry. **No session URL in it.**
- [ ] Append any new `versionHighlight*` key to `APP_HIGHLIGHT_KEYS` with EN + DE strings.
- [ ] Bump the five ungated places in the SAME commit: `package.json` `version`, both `package-lock.json` occurrences (root and `packages[""]`), the README shields badge (version **and** codename), and the `<!-- Generated: … -->` header on all five `docs/CODEMAPS/*.md`.
- [ ] Run a code review before release.
