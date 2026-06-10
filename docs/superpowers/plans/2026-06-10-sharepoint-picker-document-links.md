# SharePoint Picker + Document Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a reusable custom Graph-browse SharePoint picker and attach SharePoint document links (files *or* folders) to all six workspace entities, plus a "Browse…" path for the SharePoint storage backend.

**Architecture:** Browser-only delegated Microsoft Graph, reusing the existing MSAL singleton (`use-ms-auth.ts`) and the pure-core + hook + component split (mirrors `outlook-calendar.ts`). A shared `DocumentLink` type is persisted losslessly through every serializer (JSON, CSV, Markdown, Turso) via a JSON-in-cell encoding, and surfaced through one reusable `<DocumentLinksField>` embedded in each entity editor.

**Tech Stack:** Next.js 16 / React 19 / TypeScript 5, Vitest 4 (+ `@testing-library/react`, `fast-check`, `fake-indexeddb`), Microsoft Graph v1.0, `@azure/msal-browser`.

**Spec:** `docs/superpowers/specs/2026-06-10-sharepoint-picker-document-links-design.md`

---

## Conventions for every task (read once, apply throughout)

- **TDD:** write the failing test first, run it red, implement, run it green, commit. Tests are co-located as `src/app/<name>.test.ts(x)`.
- **Run a single test file:** `npx vitest run src/app/<file>.test.ts` (expected output noted per task). Full suite: `npx vitest run`.
- **Coverage gate is 70%** (lines/functions/branches/statements) on the business-logic/data layer; `*.tsx` are excluded from the gate but still need component tests. Lint is `--max-warnings=0` (`npm run lint`).
- **i18n is build-enforced:** every key added to `enUS` in `src/app/i18n.ts` **must** have a matching key in `src/app/i18n.de.ts` (`de: Record<TranslationKey, string>`) or `tsc`/`next build` fails. Add both in the same task.
- **⚠️ `i18n.de.ts` editing landmine:** the Edit tool has previously corrupted ASCII `"` into curly quotes in `i18n.de.ts`. After editing it, run `git grep -nP '[\x{201C}\x{201D}]' src/app/i18n.de.ts` and expect **no** matches; prefer surgical edits and re-verify.
- **Vitest 4 mock landmines:** constructor mocks must be `function`/`class` (not arrow); type `vi.fn<Sig>()` when assigning to a typed prop.
- **AIPM palette only:** use existing tokens — `border-line`, `bg-surface`, `bg-surface-muted`, `text-foreground`, `text-muted-foreground`, `text-AIPM-dark-blue`, `dark:text-AIPM-light-grey`, `bg-AIPM-dark-blue/40`, `focus:ring-AIPM-green`, `text-AIPM-pink` (errors). No gradients/shadows/off-palette colors.
- **Commit style:** conventional commits (`feat:`, `test:`, `refactor:`, `docs:`). Attribution is disabled globally — do **not** add a `Co-Authored-By` trailer.
- **Branch:** all work lands on `feat-sharepoint-picker-document-links` (already created; the spec commit `a433c65` is its first commit).

---

## File Structure

**New files:**
- `src/app/document-link.ts` — `DocumentLink` type, `sanitizeDocumentLinks`, `isValidDocumentLink`, `encodeDocumentLinks`, `decodeDocumentLinks`. Pure, no imports from `types.ts` (leaf module, avoids cycles).
- `src/app/document-link.test.ts`, `src/app/document-link.property.test.ts`.
- `src/app/sharepoint-graph.ts` — Graph response types, URL builders, `driveItem`/`site` → `DocumentLink`/`SiteRef` mappers. Pure, no fetch/React.
- `src/app/sharepoint-graph.test.ts`, `src/app/sharepoint-graph.property.test.ts`.
- `src/app/use-sharepoint-browser.ts` — browse hook (token + fetch + navigation state).
- `src/app/use-sharepoint-browser.test.tsx`.
- `src/app/sharepoint-picker-modal.tsx` — reusable picker modal.
- `src/app/sharepoint-picker-modal.test.tsx`.
- `src/app/document-links-field.tsx` — reusable links editor.
- `src/app/document-links-field.test.tsx`.

**Modified files:** `types.ts`, `storage.ts`, `sanitize.ts`, `turso-schema.ts`, `turso-tenant-schema.ts`, `sharepoint-backend.ts`, `storage-config.tsx`, `settings-view.tsx`, `task-form-fields.tsx`, `task-form-context.tsx`, `use-task-submit.ts`, `raid-panel.tsx`, `change-edit-modal.tsx`, `change-panel.tsx`, `stakeholder-edit-modal.tsx`, `stakeholders-panel.tsx`, `milestone-edit-modal.tsx`, `milestones-panel.tsx`, `project-form-fields.tsx`, `project-form.tsx`, `activity-log.ts`, `i18n.ts`, `i18n.de.ts`, `version.ts`, `CHANGELOG.md`, `docs/CODEMAPS/*.md`, `README.md`.

---

## Task 1: `DocumentLink` foundation (type + sanitizer + cell codec)

**Files:**
- Create: `src/app/document-link.ts`
- Test: `src/app/document-link.test.ts`, `src/app/document-link.property.test.ts`

- [ ] **Step 1: Write the failing unit test**

Create `src/app/document-link.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import {
  sanitizeDocumentLinks,
  encodeDocumentLinks,
  decodeDocumentLinks,
  type DocumentLink,
} from "./document-link";

const file: DocumentLink = {
  id: "01ABC",
  name: "Spec.docx",
  url: "https://contoso.sharepoint.com/sites/proj/Shared%20Documents/Spec.docx",
  kind: "file",
  driveId: "b!drive",
  itemId: "01ABC",
  mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  addedAt: "2026-06-10T00:00:00.000Z",
};

describe("sanitizeDocumentLinks", () => {
  test("returns [] for non-arrays / nullish", () => {
    expect(sanitizeDocumentLinks(undefined)).toEqual([]);
    expect(sanitizeDocumentLinks(null)).toEqual([]);
    expect(sanitizeDocumentLinks("nope")).toEqual([]);
    expect(sanitizeDocumentLinks({})).toEqual([]);
  });

  test("drops entries missing a usable url or name", () => {
    const out = sanitizeDocumentLinks([
      { name: "", url: "https://x", kind: "file" },
      { name: "ok", url: "", kind: "file" },
      { name: "keep", url: "https://contoso.sharepoint.com/a", kind: "folder" },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("keep");
    expect(out[0].kind).toBe("folder");
  });

  test("clamps kind to the union and trims strings", () => {
    const out = sanitizeDocumentLinks([
      { name: "  trimmed  ", url: "  https://contoso.sharepoint.com/a  ", kind: "weird" },
    ]);
    expect(out[0].name).toBe("trimmed");
    expect(out[0].url).toBe("https://contoso.sharepoint.com/a");
    expect(out[0].kind).toBe("file"); // unknown kind defaults to "file"
  });

  test("preserves a fully-formed link verbatim", () => {
    expect(sanitizeDocumentLinks([file])).toEqual([file]);
  });

  test("generates an id when missing", () => {
    const out = sanitizeDocumentLinks([{ name: "n", url: "https://contoso.sharepoint.com/a", kind: "file" }]);
    expect(typeof out[0].id).toBe("string");
    expect(out[0].id.length).toBeGreaterThan(0);
  });
});

describe("encode/decode round-trip (JSON-in-cell)", () => {
  test("empty/undefined encodes to empty string (byte-stable)", () => {
    expect(encodeDocumentLinks(undefined)).toBe("");
    expect(encodeDocumentLinks([])).toBe("");
  });

  test("decode of empty string is []", () => {
    expect(decodeDocumentLinks("")).toEqual([]);
    expect(decodeDocumentLinks(undefined)).toEqual([]);
  });

  test("round-trips through encode -> decode", () => {
    const links = [file, { ...file, id: "02", name: "Folder", kind: "folder" as const }];
    expect(decodeDocumentLinks(encodeDocumentLinks(links))).toEqual(links);
  });

  test("decode tolerates malformed JSON", () => {
    expect(decodeDocumentLinks("{not json")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it red**

Run: `npx vitest run src/app/document-link.test.ts`
Expected: FAIL — `Cannot find module './document-link'`.

- [ ] **Step 3: Implement `src/app/document-link.ts`**

```ts
// src/app/document-link.ts
//
// Shared model for a referenced SharePoint document (file or folder) plus the
// lossless JSON-in-cell codec used by the CSV/Markdown/Turso serializers.
// Leaf module: imports nothing from the app so any entity type can depend on it.

export type DocumentLink = {
  /** Stable id: the Graph driveItem id, or a generated id for manual entries. */
  id: string;
  /** Display name (file or folder). */
  name: string;
  /** webUrl — opened in a new tab. */
  url: string;
  kind: "file" | "folder";
  /** Graph addressing for future re-browse / re-resolution. */
  driveId?: string;
  itemId?: string;
  /** File icon / type hint (files only). */
  mimeType?: string;
  /** ISO timestamp when the link was added. */
  addedAt?: string;
};

function asTrimmedString(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function optionalString(v: unknown): string | undefined {
  const s = asTrimmedString(v);
  return s === "" ? undefined : s;
}

/** A counter so generated ids are unique within one sanitize call without
 *  Date.now()/Math.random() (kept deterministic + test-friendly). */
function makeIdFactory(): () => string {
  let n = 0;
  return () => `dl-${(n += 1)}`;
}

export function isValidDocumentLink(v: unknown): v is { name: string; url: string } {
  if (typeof v !== "object" || v === null) return false;
  const rec = v as Record<string, unknown>;
  return asTrimmedString(rec.name) !== "" && asTrimmedString(rec.url) !== "";
}

export function sanitizeDocumentLinks(raw: unknown): DocumentLink[] {
  if (!Array.isArray(raw)) return [];
  const nextId = makeIdFactory();
  const out: DocumentLink[] = [];
  for (const entry of raw) {
    if (!isValidDocumentLink(entry)) continue;
    const rec = entry as Record<string, unknown>;
    const link: DocumentLink = {
      id: optionalString(rec.id) ?? nextId(),
      name: asTrimmedString(rec.name),
      url: asTrimmedString(rec.url),
      kind: rec.kind === "folder" ? "folder" : "file",
    };
    const driveId = optionalString(rec.driveId);
    const itemId = optionalString(rec.itemId);
    const mimeType = optionalString(rec.mimeType);
    const addedAt = optionalString(rec.addedAt);
    if (driveId) link.driveId = driveId;
    if (itemId) link.itemId = itemId;
    if (mimeType) link.mimeType = mimeType;
    if (addedAt) link.addedAt = addedAt;
    out.push(link);
  }
  return out;
}

/** Encode for a single CSV/MD/Turso cell. Empty/undefined -> "" so entities
 *  with no links stay byte-identical to legacy serialized data. */
export function encodeDocumentLinks(links: readonly DocumentLink[] | undefined): string {
  return links && links.length ? JSON.stringify(links) : "";
}

/** Inverse of encodeDocumentLinks; tolerates empty/malformed cells. */
export function decodeDocumentLinks(cell: string | undefined): DocumentLink[] {
  if (!cell) return [];
  try {
    return sanitizeDocumentLinks(JSON.parse(cell));
  } catch {
    return [];
  }
}
```

> Note: the round-trip test in Step 1 compares against `file` which carries a string `id`; `sanitizeDocumentLinks` preserves a present `id`, so the round-trip is exact. The "generates an id" test uses a link with no `id`, getting `dl-1`.

- [ ] **Step 4: Run it green**

Run: `npx vitest run src/app/document-link.test.ts`
Expected: PASS (all assertions).

- [ ] **Step 5: Write the property test**

Create `src/app/document-link.property.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import fc from "fast-check";
import { sanitizeDocumentLinks, encodeDocumentLinks, decodeDocumentLinks } from "./document-link";

const linkArb = fc.record({
  id: fc.string({ minLength: 1 }),
  name: fc.string({ minLength: 1 }).map((s) => s.trim()).filter((s) => s.length > 0),
  url: fc.webUrl(),
  kind: fc.constantFrom("file" as const, "folder" as const),
});

describe("document-link properties", () => {
  test("sanitizeDocumentLinks never throws and always returns an array", () => {
    fc.assert(
      fc.property(fc.anything(), (input) => {
        expect(Array.isArray(sanitizeDocumentLinks(input))).toBe(true);
      }),
    );
  });

  test("encode -> decode is a fixed point on sanitized input", () => {
    fc.assert(
      fc.property(fc.array(linkArb), (links) => {
        const clean = sanitizeDocumentLinks(links);
        expect(decodeDocumentLinks(encodeDocumentLinks(clean))).toEqual(clean);
      }),
    );
  });
});
```

- [ ] **Step 6: Run the property test**

Run: `npx vitest run src/app/document-link.property.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app/document-link.ts src/app/document-link.test.ts src/app/document-link.property.test.ts
git commit -m "feat: DocumentLink model + lossless JSON-in-cell codec"
```

---

## Task 2: Add `documentLinks` field to the six entity types

**Files:**
- Modify: `src/app/types.ts` (Task ~76, Milestone ~191, RaidItem ~179, ChangeItem ~228, Stakeholder ~264, ProjectMeta ~558)

- [ ] **Step 1: Add the import at the top of `types.ts`**

```ts
import type { DocumentLink } from "./document-link";
```

- [ ] **Step 2: Add the field to each entity type**

Add this line as the last field of each of the six `type` blocks (immediately before the closing `};`):

```ts
  /** SharePoint files/folders linked to this record. Always optional; absent
   *  on legacy data, defaults to [] at the editor boundary. */
  documentLinks?: DocumentLink[];
```

- `Task` — after `healthOverride?: "R" | "A" | "G";` (types.ts:76).
- `RaidItem` — after `stakeholderIds: number[];` (types.ts:179).
- `Milestone` — after `localModifiedAt?: string;` (types.ts:192).
- `ChangeItem` — after `localModifiedAt?: string;` (types.ts:229).
- `Stakeholder` — after `localModifiedAt?: string;` (types.ts:265 area).
- `ProjectMeta` — after the last field (types.ts:~558).

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS (additive optional field; no existing code breaks).

- [ ] **Step 4: Commit**

```bash
git add src/app/types.ts
git commit -m "feat: add optional documentLinks to the six workspace entities"
```

---

## Task 3: Persist `documentLinks` on **Task** (CSV/MD)

**Files:**
- Modify: `src/app/storage.ts` (`CSV_COLUMNS` :388, `MD_COLUMNS` :1953, `fieldToString` :874, `buildTaskFromObj` :1895, `markdownToTasks` colMap :2740)
- Test: `src/app/storage.documentlinks.test.ts` (new, shared by Tasks 3-8)

- [ ] **Step 1: Write the failing round-trip test**

Create `src/app/storage.documentlinks.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import {
  emptyWorkspace,
  workspaceToCsv, csvToWorkspace,
  workspaceToMarkdown, markdownToWorkspace,
  workspaceToJson, jsonToWorkspace,
} from "./storage";
import type { DocumentLink } from "./document-link";
import type { Workspace } from "./storage";

const links: DocumentLink[] = [
  { id: "01", name: "Spec, v2.docx", url: "https://c.sharepoint.com/sites/p/Docs/Spec.docx", kind: "file", driveId: "b!d", itemId: "01" },
  { id: "02", name: "Evidence folder", url: "https://c.sharepoint.com/sites/p/Docs/Evidence", kind: "folder" },
];

function wsWithTaskLinks(): Workspace {
  const ws = emptyWorkspace();
  ws.tasks = [{
    id: 1, taskName: "T", assignee: "A", assigneeEmail: "", dueDate: "2026-01-01",
    lastUpdateDate: "2026-01-01", priority: "Medium", blockers: "", notes: "",
    documentLinks: links,
  }];
  return ws;
}

describe("Task documentLinks round-trips", () => {
  test("CSV", () => {
    const back = csvToWorkspace(workspaceToCsv(wsWithTaskLinks()));
    expect(back.tasks[0].documentLinks).toEqual(links);
  });
  test("Markdown", () => {
    const back = markdownToWorkspace(workspaceToMarkdown(wsWithTaskLinks()));
    expect(back.tasks[0].documentLinks).toEqual(links);
  });
  test("JSON", () => {
    const back = jsonToWorkspace(workspaceToJson(wsWithTaskLinks()));
    expect(back.tasks[0].documentLinks).toEqual(links);
  });
  test("empty documentLinks serializes to an empty cell (byte-stable)", () => {
    const ws = emptyWorkspace();
    ws.tasks = [{ id: 1, taskName: "T", assignee: "A", assigneeEmail: "", dueDate: "2026-01-01", lastUpdateDate: "2026-01-01", priority: "Medium", blockers: "", notes: "" }];
    const csv = workspaceToCsv(ws);
    // The header gains a DocumentLinks column, but the value cell is empty.
    expect(csv).toContain("DocumentLinks");
    const back = csvToWorkspace(csv);
    expect(back.tasks[0].documentLinks ?? []).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it red**

Run: `npx vitest run src/app/storage.documentlinks.test.ts -t Task`
Expected: FAIL — `documentLinks` is `undefined` after CSV/MD round-trip (JSON may already pass via raw cast).

- [ ] **Step 3: Add the import in `storage.ts`**

Near the other imports:

```ts
import { encodeDocumentLinks, decodeDocumentLinks } from "./document-link";
```

- [ ] **Step 4: Add the column to `CSV_COLUMNS` and `MD_COLUMNS`**

In `CSV_COLUMNS` (storage.ts:388), append `"documentLinks"` as the last key. In `MD_COLUMNS` (storage.ts:1953), append `{ key: "documentLinks", label: "DocumentLinks" }` as the last entry.

- [ ] **Step 5: Encode in `fieldToString` (storage.ts:874)**

```ts
export function fieldToString(t: Task, c: keyof Task): string {
  if (c === "labels") return Array.isArray(t.labels) ? t.labels.join("|") : "";
  if (c === "dependencies") return serializeDependencies(t.dependencies);
  if (c === "documentLinks") return encodeDocumentLinks(t.documentLinks);
  return String(t[c] ?? "");
}
```

- [ ] **Step 6: Decode in `buildTaskFromObj` (storage.ts:1895)**

Add to the returned object literal (alongside `labels: sanitizeLabels(obj.labels)`):

```ts
    documentLinks: decodeDocumentLinks(obj.documentLinks),
```

If `documentLinks` is empty, `decodeDocumentLinks("")` returns `[]`. To keep `emptyWorkspace` tasks byte-stable on re-serialize, that is acceptable (the empty-cell test asserts `?? []`).

- [ ] **Step 7: Add the Markdown import alias in `markdownToTasks` (storage.ts:2740 colMap)**

In the colMap-building loop, add:

```ts
      else if (norm === "documentlinks") colMap[idx] = "documentLinks";
```

(`csvToTasks` keys by raw header, so no CSV alias is needed — the header is literally `documentLinks` via the column key.)

- [ ] **Step 8: Run it green**

Run: `npx vitest run src/app/storage.documentlinks.test.ts -t Task`
Expected: PASS (CSV, Markdown, JSON, empty-cell).

- [ ] **Step 9: Commit**

```bash
git add src/app/storage.ts src/app/storage.documentlinks.test.ts
git commit -m "feat: persist Task.documentLinks across CSV/MD/JSON"
```

---

## Task 4: Persist `documentLinks` on **RaidItem** (CSV/MD)

**Files:**
- Modify: `storage.ts` (`RAID_CSV_COLUMNS` :426, `RAID_MD_COLUMNS` :447, `raidFieldToString` :695, `buildRaidItemFromObj` :716, `markdownToRaid` colMap :2648, **`csvToRaid` colMap :1837**)
- Test: append to `src/app/storage.documentlinks.test.ts`

- [ ] **Step 1: Add the failing test (append)**

```ts
import type { RaidItem } from "./types";

describe("RaidItem documentLinks round-trips", () => {
  function ws() {
    const w = emptyWorkspace();
    const r: RaidItem = {
      id: 1, category: "R", title: "Risk", status: "Open",
      linkedTaskIds: [], causedByRaidIds: [], stakeholderIds: [], raisedDate: "2026-01-01",
      documentLinks: links,
    };
    w.raid = [r];
    return w;
  }
  test("CSV", () => { expect(csvToWorkspace(workspaceToCsv(ws())).raid[0].documentLinks).toEqual(links); });
  test("Markdown", () => { expect(markdownToWorkspace(workspaceToMarkdown(ws())).raid[0].documentLinks).toEqual(links); });
  test("JSON", () => { expect(jsonToWorkspace(workspaceToJson(ws())).raid[0].documentLinks).toEqual(links); });
});
```

- [ ] **Step 2: Run it red**

Run: `npx vitest run src/app/storage.documentlinks.test.ts -t RaidItem`
Expected: FAIL on CSV/MD.

- [ ] **Step 3: Columns** — append `"documentLinks"` to `RAID_CSV_COLUMNS` (:426) and `{ key: "documentLinks", label: "DocumentLinks" }` to `RAID_MD_COLUMNS` (:447).

- [ ] **Step 4: Encode** — in `raidFieldToString` (:695), add before the final `return`:

```ts
  if (c === "documentLinks") return encodeDocumentLinks(r.documentLinks);
```

- [ ] **Step 5: Decode** — in `buildRaidItemFromObj` (:716), add to the returned object:

```ts
    documentLinks: decodeDocumentLinks(obj.documentLinks),
```

- [ ] **Step 6: MD alias** — in `markdownToRaid` colMap (:2648), add `else if (norm === "documentlinks") colMap[idx] = "documentLinks";`.

- [ ] **Step 7: CSV alias** — RAID is the one entity whose CSV parser `csvToRaid` (:1837) builds its own header colMap. Read `:1837-1875`, find the normalization chain, and add the matching `else if (norm === "documentlinks") colMap[idx] = "documentLinks";` there too. Verify the existing `stakeholderIds` alias in that block as the pattern to copy.

- [ ] **Step 8: Run it green**

Run: `npx vitest run src/app/storage.documentlinks.test.ts -t RaidItem`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/app/storage.ts src/app/storage.documentlinks.test.ts
git commit -m "feat: persist RaidItem.documentLinks across CSV/MD/JSON"
```

---

## Task 5: Persist `documentLinks` on **ChangeItem** (CSV/MD + sanitizer)

**Files:**
- Modify: `storage.ts` (`CHANGES_CSV_COLUMNS` :797, `CHANGES_MD_COLUMNS` :2121, `changeFieldToString` :803, `buildChangeFromObj` :811, `markdownToChanges` colMap :2155); `sanitize.ts` (`sanitizeChangeItem`)
- Test: append to `storage.documentlinks.test.ts`

- [ ] **Step 1: Add the failing test (append)**

```ts
import type { ChangeItem } from "./types";

describe("ChangeItem documentLinks round-trips", () => {
  function ws() {
    const w = emptyWorkspace();
    const c: ChangeItem = {
      id: 1, title: "C", description: "d", type: "Scope", status: "Proposed",
      linkedTaskIds: [], linkedRaidIds: [], stakeholderIds: [], raisedDate: "2026-01-01",
      documentLinks: links,
    };
    w.changes = [c];
    return w;
  }
  test("CSV", () => { expect(csvToWorkspace(workspaceToCsv(ws())).changes[0].documentLinks).toEqual(links); });
  test("Markdown", () => { expect(markdownToWorkspace(workspaceToMarkdown(ws())).changes[0].documentLinks).toEqual(links); });
  test("JSON", () => { expect(jsonToWorkspace(workspaceToJson(ws())).changes[0].documentLinks).toEqual(links); });
});
```

- [ ] **Step 2: Run it red** — `npx vitest run src/app/storage.documentlinks.test.ts -t ChangeItem`. Expected FAIL (JSON also fails here because `buildChangeFromObj`/`jsonToWorkspace` route through `sanitizeChangeItem`, which strips unknown fields).

- [ ] **Step 3: Columns** — append `"documentLinks"` to `CHANGES_CSV_COLUMNS` (:797) and `{ key: "documentLinks", label: "DocumentLinks" }` to `CHANGES_MD_COLUMNS` (:2121).

- [ ] **Step 4: Encode** — in `changeFieldToString` (:803), add before the `const v = c[col];` line:

```ts
  if (col === "documentLinks") return encodeDocumentLinks(c.documentLinks);
```

- [ ] **Step 5: Decode** — in `buildChangeFromObj` (:811), add inside the object passed to `sanitizeChangeItem`:

```ts
    documentLinks: decodeDocumentLinks(obj.documentLinks),
```

- [ ] **Step 6: Preserve in `sanitizeChangeItem`** — open `sanitize.ts`, find `sanitizeChangeItem`. After it builds the validated `ChangeItem`, add a passthrough so a present array survives (mirroring how it handles `stakeholderIds`):

```ts
  const documentLinks = sanitizeDocumentLinks((raw as Record<string, unknown>).documentLinks);
  if (documentLinks.length) item.documentLinks = documentLinks;
```

Add `import { sanitizeDocumentLinks } from "./document-link";` to `sanitize.ts` if absent. Use the exact local variable name the function uses for its result object (it may be `item`, `out`, or a literal — adapt the assignment to the real shape; if it returns an object literal directly, add `documentLinks: sanitizeDocumentLinks(...)` as a conditional spread `...(dl.length ? { documentLinks: dl } : {})`).

- [ ] **Step 7: MD alias** — in `markdownToChanges` colMap (:2155), add `else if (norm === "documentlinks") colMap[idx] = "documentLinks";`. (`csvToChanges` raw-keys by header — no CSV alias.)

- [ ] **Step 8: Run it green** — `npx vitest run src/app/storage.documentlinks.test.ts -t ChangeItem`. Expected PASS.

- [ ] **Step 9: Commit**

```bash
git add src/app/storage.ts src/app/sanitize.ts src/app/storage.documentlinks.test.ts
git commit -m "feat: persist ChangeItem.documentLinks (CSV/MD/JSON + sanitizer)"
```

---

## Task 6: Persist `documentLinks` on **Stakeholder** (CSV/MD + sanitizer)

**Files:**
- Modify: `storage.ts` (`STAKEHOLDERS_CSV_COLUMNS` :823, `STAKEHOLDERS_MD_COLUMNS` :2183, `stakeholderFieldToString` :828, `buildStakeholderFromObj` :835, `markdownToStakeholders` colMap :2211); `sanitize.ts` (`sanitizeStakeholder`)
- Test: append to `storage.documentlinks.test.ts`

- [ ] **Step 1: Failing test (append)**

```ts
import type { Stakeholder } from "./types";

describe("Stakeholder documentLinks round-trips", () => {
  function ws() {
    const w = emptyWorkspace();
    const s: Stakeholder = {
      id: 1, name: "S", category: "Internal", influence: "Low", interest: "Low",
      raci: {}, documentLinks: links,
    };
    w.stakeholders = [s];
    return w;
  }
  test("CSV", () => { expect(csvToWorkspace(workspaceToCsv(ws())).stakeholders[0].documentLinks).toEqual(links); });
  test("Markdown", () => { expect(markdownToWorkspace(workspaceToMarkdown(ws())).stakeholders[0].documentLinks).toEqual(links); });
  test("JSON", () => { expect(jsonToWorkspace(workspaceToJson(ws())).stakeholders[0].documentLinks).toEqual(links); });
});
```

- [ ] **Step 2: Run it red** — `-t Stakeholder`. Expected FAIL.
- [ ] **Step 3: Columns** — append `"documentLinks"` to `STAKEHOLDERS_CSV_COLUMNS` (:823) + `{ key: "documentLinks", label: "DocumentLinks" }` to `STAKEHOLDERS_MD_COLUMNS` (:2183).
- [ ] **Step 4: Encode** — in `stakeholderFieldToString` (:828), add before `const v = s[col];`:

```ts
  if (col === "documentLinks") return encodeDocumentLinks(s.documentLinks);
```

- [ ] **Step 5: Decode** — in `buildStakeholderFromObj` (:835), add to the object passed to `sanitizeStakeholder`: `documentLinks: decodeDocumentLinks(obj.documentLinks),`.
- [ ] **Step 6: Preserve in `sanitizeStakeholder`** (sanitize.ts) — same pattern as Task 6 Step 6 for ChangeItem.
- [ ] **Step 7: MD alias** — in `markdownToStakeholders` colMap (:2211), add the `documentlinks` branch. (`csvToStakeholders` raw-keys — no CSV alias.)
- [ ] **Step 8: Run it green** — `-t Stakeholder`. PASS.
- [ ] **Step 9: Commit**

```bash
git add src/app/storage.ts src/app/sanitize.ts src/app/storage.documentlinks.test.ts
git commit -m "feat: persist Stakeholder.documentLinks (CSV/MD/JSON + sanitizer)"
```

---

## Task 7: Persist `documentLinks` on **Milestone** (CSV/MD + sanitizer)

**Files:**
- Modify: `storage.ts` (`MILESTONES_CSV_COLUMNS` :538, `MILESTONES_MD_COLUMNS` :2081, `milestoneFieldToString` :778, `buildMilestoneFromObj` :783, `markdownToMilestones` colMap :2104); `sanitize.ts` (`sanitizeMilestone`)
- Test: append to `storage.documentlinks.test.ts`

- [ ] **Step 1: Failing test (append)**

```ts
import type { Milestone } from "./types";

describe("Milestone documentLinks round-trips", () => {
  function ws() {
    const w = emptyWorkspace();
    const m: Milestone = { id: 1, name: "M", date: "2026-01-01", linkedTaskIds: [], documentLinks: links };
    w.milestones = [m];
    return w;
  }
  test("CSV", () => { expect(csvToWorkspace(workspaceToCsv(ws())).milestones[0].documentLinks).toEqual(links); });
  test("Markdown", () => { expect(markdownToWorkspace(workspaceToMarkdown(ws())).milestones[0].documentLinks).toEqual(links); });
  test("JSON", () => { expect(jsonToWorkspace(workspaceToJson(ws())).milestones[0].documentLinks).toEqual(links); });
});
```

- [ ] **Step 2: Run it red** — `-t Milestone`. FAIL.
- [ ] **Step 3: Columns** — append to `MILESTONES_CSV_COLUMNS` (:538) + `MILESTONES_MD_COLUMNS` (:2081).
- [ ] **Step 4: Encode** — in `milestoneFieldToString` (:778):

```ts
  if (c === "documentLinks") return encodeDocumentLinks(m.documentLinks);
```

- [ ] **Step 5: Decode** — in `buildMilestoneFromObj` (:783), after the existing conditional optionals, add:

```ts
  const dl = decodeDocumentLinks(obj.documentLinks);
  if (dl.length) m.documentLinks = dl;
```

- [ ] **Step 6: Preserve in `sanitizeMilestone`** (sanitize.ts) — same passthrough pattern.
- [ ] **Step 7: MD alias** — in `markdownToMilestones` colMap (:2104), add the `documentlinks` branch. (`csvToMilestones` raw-keys — no CSV alias.)
- [ ] **Step 8: Run it green** — `-t Milestone`. PASS.
- [ ] **Step 9: Commit**

```bash
git add src/app/storage.ts src/app/sanitize.ts src/app/storage.documentlinks.test.ts
git commit -m "feat: persist Milestone.documentLinks (CSV/MD/JSON + sanitizer)"
```

---

## Task 8: Persist `documentLinks` on **ProjectMeta** (CSV/MD + sanitizer)

**Files:**
- Modify: `storage.ts` (`PROJECT_CSV_COLUMNS` :1185, `projectFieldToString` :1326, `decodeProjectObj` :1341); `sanitize.ts` (`sanitizeProjectMeta`)
- Test: append to `storage.documentlinks.test.ts`

- [ ] **Step 1: Failing test (append)** — ProjectMeta is emitted in CSV/MD only when `config === undefined` (storage round-trip) and a project is set. Use the project round-trip helpers:

```ts
import type { ProjectMeta } from "./types";

describe("ProjectMeta documentLinks round-trips", () => {
  function ws() {
    const w = emptyWorkspace();
    // Minimal valid ProjectMeta — match the shape sanitizeProjectMeta requires.
    w.project = { id: "p1", name: "Proj", documentLinks: links } as ProjectMeta;
    return w;
  }
  test("Markdown (project block)", () => {
    const back = markdownToWorkspace(workspaceToMarkdown(ws()));
    expect(back.project?.documentLinks).toEqual(links);
  });
  test("JSON", () => {
    const back = jsonToWorkspace(workspaceToJson(ws()));
    expect(back.project?.documentLinks).toEqual(links);
  });
});
```

> If `sanitizeProjectMeta` rejects the minimal `{id,name}` shape, populate the required fields it enforces (read its implementation) so the project survives sanitization; keep `documentLinks: links`.

- [ ] **Step 2: Run it red** — `-t ProjectMeta`. FAIL.
- [ ] **Step 3: Column** — append `"documentLinks"` to `PROJECT_CSV_COLUMNS` (:1185). (It is **not** a string-list, so do **not** add it to `PROJECT_ARRAY_COLUMNS`.)
- [ ] **Step 4: Encode** — in `projectFieldToString` (:1326), add as the first branch (before the `PROJECT_ARRAY_COLUMNS` check):

```ts
  if (col === "documentLinks") return encodeDocumentLinks(p.documentLinks);
```

- [ ] **Step 5: Decode** — in `decodeProjectObj` (:1341), add alongside `contactPersons: decodeContactPersons(...)`:

```ts
    documentLinks: decodeDocumentLinks(obj.documentLinks ?? ""),
```

- [ ] **Step 6: Preserve in `sanitizeProjectMeta`** (sanitize.ts) — ensure the field is carried through to the returned object (same passthrough pattern; `sanitizeProjectMeta` currently drops unknown keys).
- [ ] **Step 7: Run it green** — `-t ProjectMeta`. PASS. Then run the whole file: `npx vitest run src/app/storage.documentlinks.test.ts` (all six entities green).
- [ ] **Step 8: Commit**

```bash
git add src/app/storage.ts src/app/sanitize.ts src/app/storage.documentlinks.test.ts
git commit -m "feat: persist ProjectMeta.documentLinks (CSV/MD/JSON + sanitizer)"
```

---

## Task 9: Backend round-trips (Turso + BrowserBackend) + schema-version bumps

**Files:**
- Modify: `storage.ts` (`SCHEMA_VERSION` :99 `9`→`10`), `turso-schema.ts` (`SCHEMA_VERSION` :129 `"9"`→`"10"`), `turso-tenant-schema.ts` (`SCHEMA_VERSION` :29 `"10"`→`"11"`)
- Test: `src/app/storage.documentlinks.backends.test.ts` (new)

> The Turso column flows automatically because both schema files derive columns from the `*_CSV_COLUMNS` constants edited in Tasks 3-8 (DDL, INSERT, SELECT). This task only bumps versions and proves the field survives the Turso statement round-trip and the BrowserBackend (IndexedDB) round-trip.

- [ ] **Step 1: Write the failing test**

Create `src/app/storage.documentlinks.backends.test.ts`. Use `fake-indexeddb` exactly as the existing storage backend tests do (check an existing `*.test.ts` that imports `BrowserBackend` for the precise setup — mirror its imports, e.g. `import "fake-indexeddb/auto";`). Assert a Task with `documentLinks` survives a `BrowserBackend` save→load, and that the Turso `workspaceToStatements`/`rowsToWorkspace` (or the multi-tenant equivalents) round-trip `documentLinks`. Model it on the existing Turso schema test (find it: `turso-schema.test.ts` or similar) and the BrowserBackend test.

```ts
import { describe, expect, test } from "vitest";
import "fake-indexeddb/auto";
// Mirror the EXACT imports the existing BrowserBackend + turso-schema tests use.
```

(The implementer reads the two existing tests, copies their setup, and asserts `documentLinks` equality after each round-trip.)

- [ ] **Step 2: Run it red** — `npx vitest run src/app/storage.documentlinks.backends.test.ts`. Expected FAIL only if a backend strips the field; if columns already flow, the test may pass — in that case it is a regression guard. (Either outcome is acceptable; the test must exist and pass after Step 3.)

- [ ] **Step 3: Bump the three schema versions** as listed in Files.

- [ ] **Step 4: Run it green** — `npx vitest run src/app/storage.documentlinks.backends.test.ts`. PASS.

- [ ] **Step 5: Run the full storage suite** — `npx vitest run src/app/storage` (all storage tests). Expected PASS (no byte-stability regressions on existing fixtures).

- [ ] **Step 6: Commit**

```bash
git add src/app/storage.ts src/app/turso-schema.ts src/app/turso-tenant-schema.ts src/app/storage.documentlinks.backends.test.ts
git commit -m "feat: documentLinks Turso/IDB round-trip + schema-version bumps"
```

---

## Task 10: `sharepoint-graph.ts` — pure Graph core

**Files:**
- Create: `src/app/sharepoint-graph.ts`, `src/app/sharepoint-graph.test.ts`, `src/app/sharepoint-graph.property.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/app/sharepoint-graph.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import {
  GRAPH_BASE,
  searchSitesUrl,
  siteDrivesUrl,
  driveRootChildrenUrl,
  folderChildrenUrl,
  mapSite,
  mapDriveItem,
  type GraphDriveItem,
} from "./sharepoint-graph";

describe("URL builders", () => {
  test("searchSitesUrl encodes the query", () => {
    expect(searchSitesUrl("my proj")).toBe(`${GRAPH_BASE}/sites?search=my%20proj`);
  });
  test("siteDrivesUrl", () => {
    expect(siteDrivesUrl("site-id")).toBe(`${GRAPH_BASE}/sites/site-id/drives`);
  });
  test("driveRootChildrenUrl", () => {
    expect(driveRootChildrenUrl("d1")).toBe(`${GRAPH_BASE}/drives/d1/root/children`);
  });
  test("folderChildrenUrl", () => {
    expect(folderChildrenUrl("d1", "item9")).toBe(`${GRAPH_BASE}/drives/d1/items/item9/children`);
  });
});

describe("mappers", () => {
  test("mapSite -> SiteRef", () => {
    const s = mapSite({ id: "s1", displayName: "Proj", webUrl: "https://c.sharepoint.com/sites/proj" });
    expect(s).toEqual({ id: "s1", name: "Proj", webUrl: "https://c.sharepoint.com/sites/proj" });
  });
  test("mapDriveItem (file) -> DocumentLink", () => {
    const raw: GraphDriveItem = {
      id: "01", name: "Spec.docx",
      webUrl: "https://c.sharepoint.com/sites/proj/Docs/Spec.docx",
      file: { mimeType: "application/msword" },
      parentReference: { driveId: "d1" },
    };
    expect(mapDriveItem(raw)).toEqual({
      id: "01", name: "Spec.docx",
      url: "https://c.sharepoint.com/sites/proj/Docs/Spec.docx",
      kind: "file", driveId: "d1", itemId: "01",
      mimeType: "application/msword",
    });
  });
  test("mapDriveItem (folder) -> DocumentLink kind folder", () => {
    const raw: GraphDriveItem = {
      id: "02", name: "Docs", webUrl: "https://c.sharepoint.com/sites/proj/Docs",
      folder: { childCount: 3 }, parentReference: { driveId: "d1" },
    };
    const link = mapDriveItem(raw);
    expect(link.kind).toBe("folder");
    expect(link.mimeType).toBeUndefined();
  });
  test("isFolder helper distinguishes the two", () => {
    // exercised indirectly via mapDriveItem above
    expect(mapDriveItem({ id: "x", name: "n", webUrl: "u", folder: {} }).kind).toBe("folder");
  });
});
```

- [ ] **Step 2: Run it red** — `npx vitest run src/app/sharepoint-graph.test.ts`. FAIL (module missing).

- [ ] **Step 3: Implement `src/app/sharepoint-graph.ts`**

```ts
// src/app/sharepoint-graph.ts
//
// Pure core for the SharePoint browse picker: Graph response types, URL
// builders, and mappers to the app's DocumentLink / SiteRef. No fetch, no
// React, no window — the hook (use-sharepoint-browser.ts) owns I/O.

import type { DocumentLink } from "./document-link";

export const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

export interface GraphSite {
  id?: string;
  displayName?: string | null;
  name?: string | null;
  webUrl?: string | null;
}

export interface GraphDrive {
  id?: string;
  name?: string | null;
  driveType?: string | null;
}

export interface GraphDriveItem {
  id?: string;
  name?: string | null;
  webUrl?: string | null;
  file?: { mimeType?: string | null } | null;
  folder?: { childCount?: number } | null;
  parentReference?: { driveId?: string | null } | null;
}

export interface SiteRef {
  id: string;
  name: string;
  webUrl: string;
}

export interface DriveRef {
  id: string;
  name: string;
}

export function searchSitesUrl(query: string): string {
  return `${GRAPH_BASE}/sites?search=${encodeURIComponent(query)}`;
}

export function siteDrivesUrl(siteId: string): string {
  return `${GRAPH_BASE}/sites/${siteId}/drives`;
}

export function driveRootChildrenUrl(driveId: string): string {
  return `${GRAPH_BASE}/drives/${driveId}/root/children`;
}

export function folderChildrenUrl(driveId: string, itemId: string): string {
  return `${GRAPH_BASE}/drives/${driveId}/items/${itemId}/children`;
}

/** Resolve a site addressed by hostname + server-relative path (paste fallback). */
export function siteByPathUrl(hostname: string, sitePath: string): string {
  return `${GRAPH_BASE}/sites/${hostname}:${sitePath}`;
}

export function isFolder(item: GraphDriveItem): boolean {
  return item.folder != null;
}

export function mapSite(raw: GraphSite): SiteRef {
  return {
    id: typeof raw.id === "string" ? raw.id : "",
    name: (raw.displayName ?? raw.name ?? "").trim(),
    webUrl: (raw.webUrl ?? "").trim(),
  };
}

export function mapDrive(raw: GraphDrive): DriveRef {
  return {
    id: typeof raw.id === "string" ? raw.id : "",
    name: (raw.name ?? "").trim(),
  };
}

export function mapDriveItem(raw: GraphDriveItem): DocumentLink {
  const folder = isFolder(raw);
  const link: DocumentLink = {
    id: typeof raw.id === "string" ? raw.id : "",
    name: (raw.name ?? "").trim(),
    url: (raw.webUrl ?? "").trim(),
    kind: folder ? "folder" : "file",
  };
  const driveId = raw.parentReference?.driveId;
  if (typeof driveId === "string" && driveId) link.driveId = driveId;
  if (link.id) link.itemId = link.id;
  const mime = raw.file?.mimeType;
  if (!folder && typeof mime === "string" && mime) link.mimeType = mime;
  return link;
}

/** Graph list responses wrap items in `value` + an optional `@odata.nextLink`. */
export interface GraphListResponse<T> {
  value?: T[];
  "@odata.nextLink"?: string;
}

export function readList<T>(json: unknown): { items: T[]; nextLink?: string } {
  const r = (json ?? {}) as GraphListResponse<T>;
  return {
    items: Array.isArray(r.value) ? r.value : [],
    nextLink: typeof r["@odata.nextLink"] === "string" ? r["@odata.nextLink"] : undefined,
  };
}
```

- [ ] **Step 4: Run it green** — `npx vitest run src/app/sharepoint-graph.test.ts`. PASS.

- [ ] **Step 5: Property test** — create `src/app/sharepoint-graph.property.test.ts` asserting `mapDriveItem` never throws on arbitrary partial input and always yields `kind ∈ {file,folder}`:

```ts
import { describe, expect, test } from "vitest";
import fc from "fast-check";
import { mapDriveItem } from "./sharepoint-graph";

describe("mapDriveItem properties", () => {
  test("never throws; kind is always file|folder", () => {
    fc.assert(
      fc.property(
        fc.record({
          id: fc.option(fc.string(), { nil: undefined }),
          name: fc.option(fc.string(), { nil: undefined }),
          webUrl: fc.option(fc.string(), { nil: undefined }),
          folder: fc.option(fc.record({}), { nil: undefined }),
        }),
        (raw) => {
          const link = mapDriveItem(raw);
          expect(["file", "folder"]).toContain(link.kind);
        },
      ),
    );
  });
});
```

- [ ] **Step 6: Run it** — `npx vitest run src/app/sharepoint-graph.property.test.ts`. PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app/sharepoint-graph.ts src/app/sharepoint-graph.test.ts src/app/sharepoint-graph.property.test.ts
git commit -m "feat: sharepoint-graph pure core (URL builders + mappers)"
```

---

## Task 11: `parseSharePointSiteUrl` sibling (paste-a-site fallback)

**Files:**
- Modify: `src/app/sharepoint-backend.ts` (add export next to `parseSharePointFileUrl` :144)
- Test: append to `src/app/sharepoint-backend.test.ts` (existing) or create if absent

- [ ] **Step 1: Failing test (append)**

```ts
import { parseSharePointSiteUrl } from "./sharepoint-backend";

describe("parseSharePointSiteUrl", () => {
  test("accepts a site URL (no file)", () => {
    expect(parseSharePointSiteUrl("https://c.sharepoint.com/sites/proj")).toEqual({
      hostname: "c.sharepoint.com",
      sitePath: "/sites/proj",
    });
  });
  test("accepts a trailing slash and a library subpath (keeps site only)", () => {
    expect(parseSharePointSiteUrl("https://c.sharepoint.com/sites/proj/Shared%20Documents/")).toEqual({
      hostname: "c.sharepoint.com",
      sitePath: "/sites/proj",
    });
  });
  test("rejects OneDrive and non-sharepoint hosts", () => {
    expect(parseSharePointSiteUrl("https://c-my.sharepoint.com/personal/x")).toBeNull();
    expect(parseSharePointSiteUrl("https://example.com/sites/proj")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it red** — `npx vitest run src/app/sharepoint-backend.test.ts -t parseSharePointSiteUrl`. FAIL.

- [ ] **Step 3: Implement** in `sharepoint-backend.ts` (after `parseSharePointFileUrl`):

```ts
export interface SpSiteLocation {
  hostname: string;
  sitePath: string;
}

/** Parse a SharePoint SITE or library URL into a Graph-addressable site path.
 *  Relaxes the file-specific checks of parseSharePointFileUrl: a site URL has
 *  only `/sites/<site>` (2 segments) and may end in a slash. Extra trailing
 *  segments (library/folder) are ignored — only the site path is returned. */
export function parseSharePointSiteUrl(url: string): SpSiteLocation | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  if (!parsed.hostname.endsWith(".sharepoint.com")) return null;
  const hostLocal = parsed.hostname.replace(/\.sharepoint\.com$/, "");
  if (hostLocal === "my" || hostLocal.endsWith("-my")) return null;

  const segments = parsed.pathname.split("/").filter((s) => s !== "");
  if (segments.length < 2) return null;
  if (segments[0] !== "sites") return null;

  const decoded = segments.slice(0, 2).map((s) => decodeURIComponent(s));
  return { hostname: parsed.hostname, sitePath: `/${decoded[0]}/${decoded[1]}` };
}
```

- [ ] **Step 4: Run it green** — PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/sharepoint-backend.ts src/app/sharepoint-backend.test.ts
git commit -m "feat: parseSharePointSiteUrl for the picker paste-fallback"
```

---

## Task 12: `use-sharepoint-browser.ts` — browse hook

**Files:**
- Create: `src/app/use-sharepoint-browser.ts`, `src/app/use-sharepoint-browser.test.tsx`

The hook takes an injected `acquireToken` (same shape `sharepoint-backend.ts` uses) so it is testable without MSAL. It exposes navigation state + actions and maps Graph errors to messages.

- [ ] **Step 1: Write the failing test**

Create `src/app/use-sharepoint-browser.test.tsx`:

```tsx
import { describe, expect, test, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { useSharePointBrowser } from "./use-sharepoint-browser";

const acquire = vi.fn<(scopes: readonly string[], o?: { interactive?: boolean }) => Promise<string | null>>();

function mockFetchSequence(...responses: Array<{ status?: number; body?: unknown }>) {
  const fetchMock = vi.fn();
  for (const r of responses) {
    fetchMock.mockResolvedValueOnce({
      ok: (r.status ?? 200) < 400,
      status: r.status ?? 200,
      json: async () => r.body ?? {},
    });
  }
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  acquire.mockReset().mockResolvedValue("token-123");
  vi.unstubAllGlobals();
});

describe("useSharePointBrowser", () => {
  test("searchSites populates sites", async () => {
    mockFetchSequence({ body: { value: [{ id: "s1", displayName: "Proj", webUrl: "https://c.sharepoint.com/sites/proj" }] } });
    const { result } = renderHook(() => useSharePointBrowser(acquire));
    await act(async () => { await result.current.searchSites("proj"); });
    await waitFor(() => expect(result.current.sites).toHaveLength(1));
    expect(result.current.sites[0].name).toBe("Proj");
    expect(acquire).toHaveBeenCalledWith(["Files.ReadWrite.All", "Sites.Read.All"], { interactive: true });
  });

  test("401 sets a re-auth error and does not throw", async () => {
    mockFetchSequence({ status: 401 });
    const { result } = renderHook(() => useSharePointBrowser(acquire));
    await act(async () => { await result.current.searchSites("x"); });
    await waitFor(() => expect(result.current.error).toMatch(/re-authenticate|expired/i));
  });

  test("openDrive then openFolder navigates and tracks breadcrumb", async () => {
    mockFetchSequence(
      { body: { value: [{ id: "d1", name: "Documents" }] } },                 // siteDrives
      { body: { value: [{ id: "01", name: "Sub", folder: {}, parentReference: { driveId: "d1" } }] } }, // root children
    );
    const { result } = renderHook(() => useSharePointBrowser(acquire));
    await act(async () => { await result.current.openSite({ id: "s1", name: "Proj", webUrl: "u" }); });
    await waitFor(() => expect(result.current.drives).toHaveLength(1));
    await act(async () => { await result.current.openDrive({ id: "d1", name: "Documents" }); });
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    expect(result.current.breadcrumb.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run it red** — `npx vitest run src/app/use-sharepoint-browser.test.tsx`. FAIL (module missing).

- [ ] **Step 3: Implement `src/app/use-sharepoint-browser.ts`**

```ts
// src/app/use-sharepoint-browser.ts
"use client";

import { useCallback, useState } from "react";
import type { DocumentLink } from "./document-link";
import {
  searchSitesUrl, siteDrivesUrl, driveRootChildrenUrl, folderChildrenUrl,
  mapSite, mapDrive, mapDriveItem, readList,
  type GraphSite, type GraphDrive, type GraphDriveItem, type SiteRef, type DriveRef,
} from "./sharepoint-graph";

export type AcquireToken = (
  scopes: readonly string[],
  options?: { interactive?: boolean },
) => Promise<string | null>;

/** Delegated scopes: file R/W (drive items + storage) + site search/read. */
export const PICKER_SCOPES = ["Files.ReadWrite.All", "Sites.Read.All"] as const;

interface Crumb { driveId: string; itemId: string | null; name: string; }

interface BrowserState {
  loading: boolean;
  error: string | null;
  sites: SiteRef[];
  drives: DriveRef[];
  items: DocumentLink[];
  breadcrumb: Crumb[];
  currentDriveId: string | null;
}

const INITIAL: BrowserState = {
  loading: false, error: null, sites: [], drives: [], items: [],
  breadcrumb: [], currentDriveId: null,
};

function messageForStatus(status: number): string {
  if (status === 401) return "spPickerErrorAuth";
  if (status === 403) return "spPickerErrorForbidden";
  if (status === 404) return "spPickerErrorNotFound";
  return "spPickerErrorGeneric";
}

export function useSharePointBrowser(acquireToken: AcquireToken) {
  const [state, setState] = useState<BrowserState>(INITIAL);

  const call = useCallback(async <T,>(url: string): Promise<T | null> => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const token = await acquireToken([...PICKER_SCOPES], { interactive: true });
      if (!token) {
        setState((s) => ({ ...s, loading: false, error: "spPickerErrorSignIn" }));
        return null;
      }
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) {
        setState((s) => ({ ...s, loading: false, error: messageForStatus(res.status) }));
        return null;
      }
      const json = (await res.json()) as T;
      setState((s) => ({ ...s, loading: false }));
      return json;
    } catch {
      setState((s) => ({ ...s, loading: false, error: "spPickerErrorGeneric" }));
      return null;
    }
  }, [acquireToken]);

  const searchSites = useCallback(async (query: string) => {
    const json = await call<unknown>(searchSitesUrl(query));
    if (!json) return;
    const { items } = readList<GraphSite>(json);
    setState((s) => ({ ...s, sites: items.map(mapSite).filter((x) => x.id), drives: [], items: [], breadcrumb: [], currentDriveId: null }));
  }, [call]);

  const openSite = useCallback(async (site: SiteRef) => {
    const json = await call<unknown>(siteDrivesUrl(site.id));
    if (!json) return;
    const { items } = readList<GraphDrive>(json);
    setState((s) => ({ ...s, drives: items.map(mapDrive).filter((d) => d.id), items: [], breadcrumb: [], currentDriveId: null }));
  }, [call]);

  const openDrive = useCallback(async (drive: DriveRef) => {
    const json = await call<unknown>(driveRootChildrenUrl(drive.id));
    if (!json) return;
    const { items } = readList<GraphDriveItem>(json);
    setState((s) => ({
      ...s, currentDriveId: drive.id, items: items.map(mapDriveItem),
      breadcrumb: [{ driveId: drive.id, itemId: null, name: drive.name }],
    }));
  }, [call]);

  const openFolder = useCallback(async (link: DocumentLink) => {
    if (!link.driveId || !link.itemId) return;
    const json = await call<unknown>(folderChildrenUrl(link.driveId, link.itemId));
    if (!json) return;
    const { items } = readList<GraphDriveItem>(json);
    setState((s) => ({
      ...s, items: items.map(mapDriveItem),
      breadcrumb: [...s.breadcrumb, { driveId: link.driveId!, itemId: link.itemId!, name: link.name }],
    }));
  }, [call]);

  const reset = useCallback(() => setState(INITIAL), []);

  return { ...state, searchSites, openSite, openDrive, openFolder, reset };
}
```

> Note: error fields hold **i18n keys**, not literal English — the modal resolves them via `t(lang, key)`. The test matches `spPickerErrorAuth`'s eventual rendered text in the modal task; here it asserts the key contains `auth`/`expired` — adjust the test regex to match the KEY string `spPickerErrorAuth` instead, i.e. `expect(result.current.error).toBe("spPickerErrorAuth")`.

Correct the 401 test assertion to `expect(result.current.error).toBe("spPickerErrorAuth")`.

- [ ] **Step 4: Run it green** — `npx vitest run src/app/use-sharepoint-browser.test.tsx`. PASS (with the corrected assertion).

- [ ] **Step 5: Commit**

```bash
git add src/app/use-sharepoint-browser.ts src/app/use-sharepoint-browser.test.tsx
git commit -m "feat: useSharePointBrowser hook (search/drives/folders + errors)"
```

---

## Task 13: `sharepoint-picker-modal.tsx` — picker UI

**Files:**
- Create: `src/app/sharepoint-picker-modal.tsx`, `src/app/sharepoint-picker-modal.test.tsx`
- Modify: `src/app/i18n.ts` + `src/app/i18n.de.ts` (picker keys)

Reuses the shared `<Modal>` + `<ModalHeader>` shell (see `change-edit-modal.tsx`). Two modes: `"location"` (file only → returns `SpFileLocation`-shaped selection) and `"link"` (file or folder → returns `DocumentLink`).

- [ ] **Step 1: Add i18n keys (EN + DE)**

In `src/app/i18n.ts` `enUS`, add (place near other integration keys):

```ts
    spPickerTitle: "Browse SharePoint",
    spPickerSearchPlaceholder: "Search sites…",
    spPickerSearchButton: "Search",
    spPickerPasteUrl: "…or paste a site URL",
    spPickerSelectFile: "Select",
    spPickerOpenFolder: "Open",
    spPickerUse: "Use this folder",
    spPickerEmptySites: "No sites found. Try another search or paste a site URL.",
    spPickerEmptyFolder: "This folder is empty.",
    spPickerBack: "Back",
    spPickerErrorSignIn: "Sign in to Microsoft first.",
    spPickerErrorAuth: "Sign-in expired. Re-authenticate from Settings.",
    spPickerErrorForbidden: "Permission denied — you lack access to this site or file.",
    spPickerErrorNotFound: "Site or file not found.",
    spPickerErrorGeneric: "SharePoint is busy — try again later.",
```

In `src/app/i18n.de.ts` `de`, add the matching keys (German). After editing, run the curly-quote guard:

```ts
    spPickerTitle: "SharePoint durchsuchen",
    spPickerSearchPlaceholder: "Sites suchen…",
    spPickerSearchButton: "Suchen",
    spPickerPasteUrl: "…oder Site-URL einfügen",
    spPickerSelectFile: "Auswählen",
    spPickerOpenFolder: "Öffnen",
    spPickerUse: "Diesen Ordner verwenden",
    spPickerEmptySites: "Keine Sites gefunden. Andere Suche versuchen oder Site-URL einfügen.",
    spPickerEmptyFolder: "Dieser Ordner ist leer.",
    spPickerBack: "Zurück",
    spPickerErrorSignIn: "Zuerst bei Microsoft anmelden.",
    spPickerErrorAuth: "Anmeldung abgelaufen. In den Einstellungen neu anmelden.",
    spPickerErrorForbidden: "Zugriff verweigert — kein Zugriff auf diese Site oder Datei.",
    spPickerErrorNotFound: "Site oder Datei nicht gefunden.",
    spPickerErrorGeneric: "SharePoint ist ausgelastet — später erneut versuchen.",
```

Run: `git grep -nP '[\x{201C}\x{201D}]' src/app/i18n.de.ts` → expect no output.

- [ ] **Step 2: Write the failing component test**

Create `src/app/sharepoint-picker-modal.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SharePointPickerModal } from "./sharepoint-picker-modal";

const acquire = vi.fn(async () => "tok");

function mockFetch(body: unknown) {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, status: 200, json: async () => body })));
}

describe("SharePointPickerModal", () => {
  it("searches sites and lists results", async () => {
    mockFetch({ value: [{ id: "s1", displayName: "Proj", webUrl: "https://c.sharepoint.com/sites/proj" }] });
    render(<SharePointPickerModal mode="link" lang="en-US" acquireToken={acquire} onSelect={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText(/search sites/i), { target: { value: "proj" } });
    fireEvent.click(screen.getByText(/^Search$/));
    await waitFor(() => expect(screen.getByText("Proj")).toBeInTheDocument());
  });

  it("calls onClose from the modal header close button", () => {
    mockFetch({ value: [] });
    const onClose = vi.fn();
    render(<SharePointPickerModal mode="link" lang="en-US" acquireToken={acquire} onSelect={vi.fn()} onClose={onClose} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run it red** — FAIL (module missing).

- [ ] **Step 4: Implement `src/app/sharepoint-picker-modal.tsx`**

Build it from the `change-edit-modal.tsx` shell pattern: `<Modal open onClose={onClose} ariaLabel={t(lang,"spPickerTitle")} backdropClassName="bg-AIPM-dark-blue/40" zIndex={60}>` wrapping a `data-modal-panel` div + `<ModalHeader lang title onClose>`; body has a search row (input + Search button), an optional paste-URL row (uses `parseSharePointSiteUrl` → `openSite` with a synthesized `SiteRef` via `siteByPathUrl` resolution), a results list driven by `useSharePointBrowser`, and per-row actions: files show **Select** (`onSelect(link)` then `onClose()`); folders show **Open** (`openFolder`) and, in `mode==="link"`, **Use this folder** (`onSelect(folderLink)`). Errors render `t(lang, error)` in `text-AIPM-pink`. Empty states use `spPickerEmptySites`/`spPickerEmptyFolder`. Props:

```tsx
export interface SharePointPickerModalProps {
  mode: "location" | "link";
  lang: Lang;
  acquireToken: AcquireToken;
  onSelect: (link: DocumentLink) => void;
  onClose: () => void;
}
```

In `"location"` mode, hide the folder **Use this folder** action and only allow file selection (the caller converts the returned `DocumentLink.url` via `parseSharePointFileUrl`). Keep the component under ~200 lines; extract a `<ResultRow>` sub-component if it grows.

- [ ] **Step 5: Run it green** — `npx vitest run src/app/sharepoint-picker-modal.test.tsx`. PASS.

- [ ] **Step 6: Lint + type-check** — `npm run lint && npx tsc --noEmit`. PASS.

- [ ] **Step 7: Commit**

```bash
git add src/app/sharepoint-picker-modal.tsx src/app/sharepoint-picker-modal.test.tsx src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat: SharePoint picker modal (search/browse/select)"
```

---

## Task 14: `document-links-field.tsx` — reusable links editor

**Files:**
- Create: `src/app/document-links-field.tsx`, `src/app/document-links-field.test.tsx`
- Modify: `src/app/i18n.ts` + `src/app/i18n.de.ts` (field keys); `src/app/activity-log.ts` (+ `use-activity-log` consumers via optional `onLog`)

The field is controlled (`value`/`onChange`), renders each link with a file/folder icon, an open-in-new-tab anchor, and a remove button; an "Add from SharePoint" button opens the picker. It accepts `acquireToken` + `lang`, and an optional `onLog?: (action: "added" | "removed", name: string) => void`.

- [ ] **Step 1: Add i18n keys (EN + DE)**

`enUS`:

```ts
    documents: "Documents",
    documentsAdd: "Add from SharePoint",
    documentsEmpty: "No linked documents.",
    documentsOpen: "Open in new tab",
    documentsRemove: "Remove link",
    documentsNeedsSharePoint: "Enable Microsoft 365 + SharePoint in Settings to link documents.",
```

`de` (then run the curly-quote guard):

```ts
    documents: "Dokumente",
    documentsAdd: "Aus SharePoint hinzufügen",
    documentsEmpty: "Keine verknüpften Dokumente.",
    documentsOpen: "In neuem Tab öffnen",
    documentsRemove: "Verknüpfung entfernen",
    documentsNeedsSharePoint: "Microsoft 365 + SharePoint in den Einstellungen aktivieren, um Dokumente zu verknüpfen.",
```

- [ ] **Step 2: (optional logging) Add activity kinds** — in `src/app/activity-log.ts`, add `"doc.linkAdded"` and `"doc.linkRemoved"` to the `ActivityKind` union and matching entries to `ACTIVITY_KIND_TO_KEY` mapping to new keys `activityDocLinkAdded` / `activityDocLinkRemoved`; add those two i18n keys to EN + DE (e.g. EN `"Linked document {0}"` / `"Removed document link {0}"`). The `Record<ActivityKind, TranslationKey>` is exhaustive — the build fails if you miss one.

- [ ] **Step 3: Write the failing component test**

Create `src/app/document-links-field.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DocumentLinksField } from "./document-links-field";
import type { DocumentLink } from "./document-link";

const links: DocumentLink[] = [
  { id: "1", name: "Spec.docx", url: "https://c.sharepoint.com/x", kind: "file" },
];
const acquire = vi.fn(async () => "tok");

describe("DocumentLinksField", () => {
  it("renders empty state when no links", () => {
    render(<DocumentLinksField value={[]} onChange={vi.fn()} lang="en-US" acquireToken={acquire} />);
    expect(screen.getByText(/no linked documents/i)).toBeInTheDocument();
  });

  it("renders a link with an open anchor and a remove button", () => {
    render(<DocumentLinksField value={links} onChange={vi.fn()} lang="en-US" acquireToken={acquire} />);
    expect(screen.getByText("Spec.docx")).toBeInTheDocument();
    const anchor = screen.getByRole("link", { name: /open in new tab/i });
    expect(anchor).toHaveAttribute("href", "https://c.sharepoint.com/x");
    expect(anchor).toHaveAttribute("target", "_blank");
  });

  it("removes a link via onChange and logs", () => {
    const onChange = vi.fn();
    const onLog = vi.fn();
    render(<DocumentLinksField value={links} onChange={onChange} lang="en-US" acquireToken={acquire} onLog={onLog} />);
    fireEvent.click(screen.getByRole("button", { name: /remove link/i }));
    expect(onChange).toHaveBeenCalledWith([]);
    expect(onLog).toHaveBeenCalledWith("removed", "Spec.docx");
  });

  it("opens the picker when Add is clicked", () => {
    render(<DocumentLinksField value={[]} onChange={vi.fn()} lang="en-US" acquireToken={acquire} />);
    fireEvent.click(screen.getByRole("button", { name: /add from sharepoint/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Run it red** — FAIL (module missing).

- [ ] **Step 5: Implement `src/app/document-links-field.tsx`**

```tsx
"use client";

import { useState } from "react";
import { type Lang, t } from "./i18n";
import type { DocumentLink } from "./document-link";
import { SharePointPickerModal } from "./sharepoint-picker-modal";
import type { AcquireToken } from "./use-sharepoint-browser";

export interface DocumentLinksFieldProps {
  value: DocumentLink[];
  onChange: (next: DocumentLink[]) => void;
  lang: Lang;
  acquireToken: AcquireToken;
  onLog?: (action: "added" | "removed", name: string) => void;
}

export function DocumentLinksField({ value, onChange, lang, acquireToken, onLog }: DocumentLinksFieldProps) {
  const [pickerOpen, setPickerOpen] = useState(false);

  function add(link: DocumentLink) {
    if (value.some((l) => l.url === link.url)) return; // dedupe by url
    onChange([...value, link]);
    onLog?.("added", link.name);
  }

  function remove(url: string) {
    const removed = value.find((l) => l.url === url);
    onChange(value.filter((l) => l.url !== url));
    if (removed) onLog?.("removed", removed.name);
  }

  return (
    <div className="flex flex-col gap-2">
      {value.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t(lang, "documentsEmpty")}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {value.map((link) => (
            <li key={link.url} className="flex items-center gap-2 rounded border border-line bg-surface px-2 py-1 text-sm">
              <span aria-hidden className="text-muted-foreground">{link.kind === "folder" ? "📁" : "📄"}</span>
              <a
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={t(lang, "documentsOpen")}
                className="flex-1 truncate text-AIPM-dark-blue underline hover:opacity-80 dark:text-AIPM-light-grey"
              >
                {link.name}
              </a>
              <button
                type="button"
                onClick={() => remove(link.url)}
                aria-label={t(lang, "documentsRemove")}
                className="rounded px-1 text-AIPM-pink hover:bg-surface-muted"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      <div>
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          className="rounded-md border border-line bg-surface px-3 py-1.5 text-xs font-medium text-foreground hover:bg-surface-muted"
        >
          {t(lang, "documentsAdd")}
        </button>
      </div>
      {pickerOpen && (
        <SharePointPickerModal
          mode="link"
          lang={lang}
          acquireToken={acquireToken}
          onSelect={(link) => { add(link); setPickerOpen(false); }}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 6: Run it green** — `npx vitest run src/app/document-links-field.test.tsx`. PASS.

- [ ] **Step 7: Lint + type-check** — `npm run lint && npx tsc --noEmit`. PASS.

- [ ] **Step 8: Commit**

```bash
git add src/app/document-links-field.tsx src/app/document-links-field.test.tsx src/app/activity-log.ts src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat: reusable DocumentLinksField + activity kinds"
```

---

## Task 15: Standardize scope + add "Browse…" to storage config

**Files:**
- Modify: `src/app/sharepoint-backend.ts` (:64, :80 + comment :78-79), `src/app/storage-config.tsx` (SP branch :247-265, add picker), `src/app/proxy.test.ts` (verify, no change expected)
- Test: `src/app/sharepoint-backend.test.ts` (scope assertion), `src/app/storage-config.test.tsx` (existing or new)

- [ ] **Step 1: Failing test — scope standardization**

Append to `src/app/sharepoint-backend.test.ts` a test asserting `isReady()`/`save()` request `Files.ReadWrite.All`:

```ts
it("requests the consolidated Files.ReadWrite.All scope", async () => {
  const acquire = vi.fn(async () => "tok");
  const be = new SharePointBackend({ kind: "sp-json", hostname: "c.sharepoint.com", sitePath: "/sites/p", itemPath: "f.json" }, acquire);
  await be.isReady();
  expect(acquire).toHaveBeenCalledWith(["Files.ReadWrite.All"]);
});
```

- [ ] **Step 2: Run it red** — FAIL (currently `["Files.ReadWrite"]`).

- [ ] **Step 3: Implement** — in `sharepoint-backend.ts`, change line 64 to `["Files.ReadWrite.All"]`, line 80 to `["Files.ReadWrite.All"], { interactive: true }`, and update the comment on lines 78-79 to reference `Files.ReadWrite.All`.

- [ ] **Step 4: Run it green** — PASS. Run `npx vitest run src/app/proxy.test.ts` to confirm CSP still allows `graph.microsoft.com` (no change needed — already allowlisted).

- [ ] **Step 5: Add the "Browse…" button to `storage-config.tsx`**

In the `isSp && spGateOk && auth.account` block (storage-config.tsx:247-265), under the spUrl input, add a Browse button that opens the picker in `"location"` mode. Add local state `const [spPickerOpen, setSpPickerOpen] = useState(false);`. On select, convert the file link to the SP config via `parseSharePointFileUrl(link.url)` and call `onChange({ kind: config.kind, ...parsed })` (the same convergence point as `handleSpUrlBlur`). Reuse the in-scope `auth.acquireToken`:

```tsx
<button
  type="button"
  onClick={() => setSpPickerOpen(true)}
  className="mt-1 rounded-md border border-line bg-surface px-3 py-1.5 text-xs font-medium text-foreground hover:bg-surface-muted"
>
  {t(lang, "spStorageBrowse")}
</button>
{spPickerOpen && (
  <SharePointPickerModal
    mode="location"
    lang={lang}
    acquireToken={auth.acquireToken}
    onSelect={(link) => {
      const parsed = parseSharePointFileUrl(link.url);
      if (parsed && (config.kind === "sp-json" || config.kind === "sp-csv")) {
        onChange({ kind: config.kind, ...parsed });
        setSpUrl(`https://${parsed.hostname}${parsed.sitePath}/${parsed.itemPath}`);
      }
      setSpPickerOpen(false);
    }}
    onClose={() => setSpPickerOpen(false)}
  />
)}
```

Add imports: `import { SharePointPickerModal } from "./sharepoint-picker-modal";` and `useState` (already imported). Add i18n key `spStorageBrowse` ("Browse…" / "Durchsuchen…") to EN + DE.

> Note: if `parseSharePointFileUrl(link.url)` returns null (e.g. an encoded webUrl that doesn't match the `/sites/<site>/<lib>/...` shape), fall back to setting `spUrl` to the raw url and surfacing `spStorageInvalidUrl` so the user can adjust — do **not** silently drop the selection.

- [ ] **Step 6: Test the Browse wiring** — add/extend `src/app/storage-config.test.tsx` to render the SP branch with a signed-in mock auth + `sharepointEnabled`, click Browse, and assert the dialog appears. Mirror the RTL setup from `change-edit-modal.test.tsx`. Run it green.

- [ ] **Step 7: Lint + type-check + commit**

```bash
npm run lint && npx tsc --noEmit
git add src/app/sharepoint-backend.ts src/app/storage-config.tsx src/app/storage-config.test.tsx src/app/sharepoint-backend.test.ts src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat: Browse button in storage config + Files.ReadWrite.All scope"
```

---

## Task 16: Embed `<DocumentLinksField>` in the **Task** editor

**Files:**
- Modify: `task-form-context.tsx` (`emptyForm` :18-41), `task-form-fields.tsx` (after `notes` Field :503), `use-task-submit.ts` (`payload` :123-139, `openEditModal` :215-232)
- Test: `src/app/task-form-modal.test.tsx` (existing) — add a case

- [ ] **Step 1: Failing test (append to `task-form-modal.test.tsx`)** — render the task form, assert the Documents field renders (the "Add from SharePoint" button is present). Mirror the file's existing render helper.

```tsx
it("shows the Documents field", () => {
  // use the file's existing render helper for the task form
  renderTaskForm();
  expect(screen.getByRole("button", { name: /add from sharepoint/i })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run it red** — FAIL.

- [ ] **Step 3: Implement**

In `task-form-context.tsx` `emptyForm()` add `documentLinks: [] as DocumentLink[],` (import the type). In `task-form-fields.tsx`, after the `notes` `<Field>` (line 503), inside section 5, add:

```tsx
<Field label={t(lang, "documents")} className="sm:col-span-2">
  <DocumentLinksField
    value={form.documentLinks}
    onChange={(documentLinks) => setForm((prev) => ({ ...prev, documentLinks }))}
    lang={lang}
    acquireToken={acquireToken}
  />
</Field>
```

`acquireToken` must reach this component. `task-form-fields.tsx` is gated behind the M365 toggle for this field; obtain `acquireToken` from `useMsAuth(m365Enabled)` at the form root (where `lang`/settings are available) and thread it down, OR call `useMsAuth` inside `task-form-fields.tsx` reading the M365-enabled flag from settings/context. Match however the form already accesses settings (the form reads `lang` — extend that prop path to also pass `acquireToken`). Gate the field: if M365+SharePoint are not enabled, render `t(lang,"documentsNeedsSharePoint")` instead.

In `use-task-submit.ts`: add `documentLinks: form.documentLinks` to the `payload` literal (:123-139); in `openEditModal` (:215-232) add `documentLinks: task.documentLinks ?? []` when seeding the form from a Task.

- [ ] **Step 4: Run it green** — PASS. Add a second test: edit a task with `documentLinks`, save, assert the saved task carries them (use the form's existing submit assertion pattern).

- [ ] **Step 5: Lint + type-check + commit**

```bash
npm run lint && npx tsc --noEmit
git add src/app/task-form-context.tsx src/app/task-form-fields.tsx src/app/use-task-submit.ts src/app/task-form-modal.test.tsx
git commit -m "feat: document links on the Task editor"
```

---

## Task 17: Embed in the **RAID** editor

**Files:**
- Modify: `raid-panel.tsx` (`RaidEditModal` after `mitigation` :1150; `openNew` default :265-280)
- Test: `src/app/raid-panel.test.tsx` (existing) — add a case

- [ ] **Step 1: Failing test** — render `RaidEditModal` (mirror existing raid tests' render), assert the "Add from SharePoint" button is present.
- [ ] **Step 2: Run it red** — FAIL.
- [ ] **Step 3: Implement** — in `openNew` (:265-280) add `documentLinks: []` to the new draft. After the `mitigation` block (:1150) add:

```tsx
<label className="flex flex-col gap-1 text-sm sm:col-span-2">
  <span className="font-medium text-foreground">{t(lang, "documents")}</span>
  <DocumentLinksField
    value={draft.documentLinks ?? []}
    onChange={(documentLinks) => onChange({ ...draft, documentLinks })}
    lang={lang}
    acquireToken={acquireToken}
  />
</label>
```

Thread `acquireToken` into `RaidEditModal` (add to its props; the parent `RaidPanel` supplies it from `useMsAuth(m365Enabled)`). Gate behind the M365+SharePoint flags as in Task 16.

- [ ] **Step 4: Run it green** — PASS.
- [ ] **Step 5: Lint + type-check + commit**

```bash
npm run lint && npx tsc --noEmit
git add src/app/raid-panel.tsx src/app/raid-panel.test.tsx
git commit -m "feat: document links on the RAID editor"
```

---

## Task 18: Embed in the **Change** editor

**Files:**
- Modify: `change-edit-modal.tsx` (after `resolutionNotes` :488, use the `update` helper :137-140), `change-panel.tsx` (`openNew` :158-171 default; `openEdit` clone :174-177)
- Test: `src/app/change-edit-modal.test.tsx` (existing) — add a case

- [ ] **Step 1: Failing test** — render `ChangeEditModal` with the existing `renderModal` helper, assert the "Add from SharePoint" button is present.
- [ ] **Step 2: Run it red** — FAIL.
- [ ] **Step 3: Implement** — in `change-panel.tsx` `openNew` (:159-169) add `documentLinks: []`; if `openEdit` deep-clones arrays, add `documentLinks: [...(item.documentLinks ?? [])]`. In `change-edit-modal.tsx` after `resolutionNotes` (:488):

```tsx
<label className="flex flex-col gap-1 text-sm sm:col-span-2">
  <span className="font-medium text-foreground">{t(lang, "documents")}</span>
  <DocumentLinksField
    value={draft.documentLinks ?? []}
    onChange={(links) => update("documentLinks", links)}
    lang={lang}
    acquireToken={acquireToken}
  />
</label>
```

Thread `acquireToken` from `change-panel.tsx` (`useMsAuth`) into the modal props; gate behind M365+SharePoint.

- [ ] **Step 4: Run it green** — PASS.
- [ ] **Step 5: Lint + type-check + commit**

```bash
npm run lint && npx tsc --noEmit
git add src/app/change-edit-modal.tsx src/app/change-panel.tsx src/app/change-edit-modal.test.tsx
git commit -m "feat: document links on the Change editor"
```

---

## Task 19: Embed in the **Stakeholder** editor

**Files:**
- Modify: `stakeholder-edit-modal.tsx` (after `notes` :271, `update` helper :93-96), `stakeholders-panel.tsx` (`openNew` :121-130 default)
- Test: `src/app/stakeholder-edit-modal.test.tsx` (existing or create) — add a case

- [ ] **Step 1: Failing test** — render the stakeholder modal, assert the Add button present.
- [ ] **Step 2: Run it red** — FAIL.
- [ ] **Step 3: Implement** — `openNew` (:122-128) add `documentLinks: []`. After `notes` (:271):

```tsx
<label className="flex flex-col gap-1 text-sm sm:col-span-2">
  <span className="font-medium text-foreground">{t(lang, "documents")}</span>
  <DocumentLinksField
    value={draft.documentLinks ?? []}
    onChange={(links) => update("documentLinks", links)}
    lang={lang}
    acquireToken={acquireToken}
  />
</label>
```

Thread `acquireToken` from `stakeholders-panel.tsx`; gate behind M365+SharePoint.

- [ ] **Step 4: Run it green** — PASS.
- [ ] **Step 5: Lint + type-check + commit**

```bash
npm run lint && npx tsc --noEmit
git add src/app/stakeholder-edit-modal.tsx src/app/stakeholders-panel.tsx src/app/stakeholder-edit-modal.test.tsx
git commit -m "feat: document links on the Stakeholder editor"
```

---

## Task 20: Embed in the **Milestone** editor

**Files:**
- Modify: `milestone-edit-modal.tsx` (after `description` :164, `update` helper :49-52; `handleSubmit` :67-82), `milestones-panel.tsx` (`openNew` :96-99 default)
- Test: `src/app/milestone-edit-modal.test.tsx` (existing or create) — add a case

- [ ] **Step 1: Failing test** — render the milestone modal, assert Add button present.
- [ ] **Step 2: Run it red** — FAIL.
- [ ] **Step 3: Implement** — `openNew` (:98) add `documentLinks: []`. After `description` (:164):

```tsx
<label className="flex flex-col gap-1 text-sm">
  <span className="font-medium text-foreground">{t(lang, "documents")}</span>
  <DocumentLinksField
    value={draft.documentLinks ?? []}
    onChange={(links) => update("documentLinks", links)}
    lang={lang}
    acquireToken={acquireToken}
  />
</label>
```

`handleSubmit` (:67-82) already spreads `...draft`, so `documentLinks` rides along. Thread `acquireToken` from `milestones-panel.tsx`; gate behind M365+SharePoint.

- [ ] **Step 4: Run it green** — PASS.
- [ ] **Step 5: Lint + type-check + commit**

```bash
npm run lint && npx tsc --noEmit
git add src/app/milestone-edit-modal.tsx src/app/milestones-panel.tsx src/app/milestone-edit-modal.test.tsx
git commit -m "feat: document links on the Milestone editor"
```

---

## Task 21: Embed project-level Documents in the **Project** form

**Files:**
- Modify: `project-form-fields.tsx` (`emptyProjectDraft` :51-79; `ProjectFormDraft` :40-48; after `docRepoLocation` Field :495), `project-form.tsx` (`draftFromMeta` :44-72, `handleSubmit` :101-141)
- Test: `src/app/project-form.test.tsx` (existing or create) — add a case

- [ ] **Step 1: Failing test** — render the project form, assert the Documents field's Add button is present.
- [ ] **Step 2: Run it red** — FAIL.
- [ ] **Step 3: Implement** — add `documentLinks: DocumentLink[]` to `ProjectFormDraft` and `documentLinks: []` to `emptyProjectDraft()`. In `draftFromMeta()` add `documentLinks: meta.documentLinks ?? []`. In `handleSubmit` add `documentLinks: draft.documentLinks` to the object passed to `sanitizeProjectMeta`. After the `docRepoLocation` Field (:495), inside `CustomerFields`:

```tsx
<Field label={t(lang, "documents")} className="sm:col-span-2">
  <DocumentLinksField
    value={draft.documentLinks}
    onChange={(documentLinks) => setDraft((p) => ({ ...p, documentLinks }))}
    lang={lang}
    acquireToken={acquireToken}
  />
</Field>
```

Thread `acquireToken` into the project form (from its container via `useMsAuth`); gate behind M365+SharePoint. (`sanitizeProjectMeta` already preserves `documentLinks` from Task 8.)

- [ ] **Step 4: Run it green** — PASS.
- [ ] **Step 5: Lint + type-check + commit**

```bash
npm run lint && npx tsc --noEmit
git add src/app/project-form-fields.tsx src/app/project-form.tsx src/app/project-form.test.tsx
git commit -m "feat: project-level Documents list on the project form"
```

---

## Task 22: Release wiring — version, CHANGELOG, CODEMAPS, README, full suite

**Files:**
- Modify: `version.ts` (:754-762, comment :1, `APP_HIGHLIGHT_KEYS` :826-830), `i18n.ts` + `i18n.de.ts` (one `versionHighlight*` key), `CHANGELOG.md`, `docs/CODEMAPS/*.md`, `README.md`

- [ ] **Step 1: Bump `version.ts`** — set `APP_VERSION = "0.60.0"`, `APP_BUILD_DATE = "2026-06-10"`, choose the next sci-fi `APP_MILESTONE` codename, prepend a `//` milestone comment at line 1 summarizing "SharePoint picker + document links", and append one new key to `APP_HIGHLIGHT_KEYS` (e.g. `"versionHighlightSpDocLinks"`). Add that key to EN + DE in `i18n.ts`/`i18n.de.ts` (e.g. EN `"Link SharePoint files & folders to tasks, RAID, changes, stakeholders, milestones and projects — with a built-in browser."`).

- [ ] **Step 2: Update `CHANGELOG.md`** — prepend a `## [0.60.0] - 2026-06-10` entry (Added: SharePoint browse picker; document links on all six entities; Browse button in storage config; consolidated `Files.ReadWrite.All` scope. Changed: SharePoint storage scope → `Files.ReadWrite.All`).

- [ ] **Step 3: Regenerate CODEMAPS** — update `docs/CODEMAPS/data.md` (new `documentLinks` field + `document-link.ts` + schema-version bumps 10/10/11), `frontend.md` (new modules: `sharepoint-picker-modal.tsx`, `document-links-field.tsx`, `use-sharepoint-browser.ts`; field in 6 editors), `backend.md` / `architecture.md` (new `sharepoint-graph.ts` core + picker scopes `Files.ReadWrite.All` + `Sites.Read.All`), and `dependencies.md` if needed (no new deps). Keep the regen date `2026-06-10`.

- [ ] **Step 4: Update `README.md`** — add a Features-table row for SharePoint document linking (short description + the collapsible `<details>` block per the README convention).

- [ ] **Step 5: Run the FULL suite + lint + build**

Run:
```bash
npm run lint
npx tsc --noEmit
npx vitest run
npm run build
```
Expected: lint clean (`--max-warnings=0`); type-check clean; all tests pass; build succeeds (the `prebuild` script `sync-script-docs.mjs --check` passes — no package.json script changes were made).

- [ ] **Step 6: Commit**

```bash
git add src/app/version.ts src/app/i18n.ts src/app/i18n.de.ts CHANGELOG.md docs/CODEMAPS README.md
git commit -m "docs: release 0.60.0 — SharePoint picker + document links"
```

---

## Self-Review (filled in by the plan author)

**1. Spec coverage:**
- Custom Graph-browse picker → Tasks 10 (core), 12 (hook), 13 (modal). ✓
- Tenant-wide search + paste fallback → Task 12 (`searchSites`), Task 11 (`parseSharePointSiteUrl`), Task 13 (paste row). ✓
- Two scopes `Files.ReadWrite.All` + `Sites.Read.All` → Task 12 (`PICKER_SCOPES`), Task 15 (backend standardization). ✓
- `DocumentLink` model + sanitizer → Task 1. ✓
- Field on all six entities → Task 2 (types) + Tasks 3-8 (persistence) + Tasks 16-21 (editors). ✓
- Lossless JSON-in-cell across JSON/CSV/MD/Turso + empty-cell stability → Tasks 1, 3-9 (round-trip + empty-cell tests). ✓
- Reuse in storage-config (Browse) → Task 15. ✓
- Reusable `<DocumentLinksField>` → Task 14. ✓
- i18n EN+DE → folded into Tasks 13, 14, 15, 22. ✓
- Activity log add/remove → Task 14 (kinds + optional `onLog`). ✓
- version/CODEMAPS → Task 22. ✓
- Error handling (401/403/404/429/5xx/empty/cancel) → Task 12 (`messageForStatus`) + Task 13 (rendering). ✓
- No CSP change → confirmed in Task 15 Step 4. ✓

**2. Placeholder scan:** No "TBD/handle errors/etc." Two intentional "read the existing test/function and mirror" instructions (Task 9 backend test setup; Task 5/6/7/8 sanitizer assignment shape) are necessary because those exact internals weren't captured verbatim — each names the exact function and the pattern to copy.

**3. Type consistency:** `DocumentLink`, `sanitizeDocumentLinks`, `encodeDocumentLinks`, `decodeDocumentLinks`, `AcquireToken`, `PICKER_SCOPES`, `SharePointPickerModal` (props `mode`/`lang`/`acquireToken`/`onSelect`/`onClose`), `DocumentLinksField` (props `value`/`onChange`/`lang`/`acquireToken`/`onLog`), and `useSharePointBrowser(acquireToken)` are used consistently across all tasks. The hook's error fields carry i18n KEYS (corrected in Task 12 Step 3 note + test assertion).

---

## Known follow-ups (out of scope for this plan)
- Live Turso DBs created before this release won't gain the `documentLinks` column automatically (`CREATE TABLE IF NOT EXISTS`, no `ALTER`) — same accepted no-migration gap as prior Turso schema changes. New/empty DBs are fine.
- A standalone "Documents" navigation tab (links live in editors + the project form for v1).
- The other three M365 sub-projects: Teams messaging + channel/chat picker, Microsoft Planner sync, Teams calling (ACS).
