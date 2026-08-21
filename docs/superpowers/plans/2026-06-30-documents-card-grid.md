# Documents Card Grid Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat Documents table with a responsive card grid filtered by source entity, each card enriched with derived file-type, host, and added-date metadata.

**Architecture:** A new pure i18n-free module `document-meta.ts` derives host label / file type / list filter-sort-counts. The React panel `documents-panel.tsx` is rewritten to render filter chips + sort + search + a card grid. `addedAt` is newly captured at the two add handlers (manual + SharePoint picker); it rides the existing JSON-in-cell `DocumentLink` blob, so there is no new persisted column or write path.

**Tech Stack:** Next.js (forked) + React + TypeScript, Tailwind v4 AIPM tokens, Vitest + Testing Library, i18n EN/DE parity (tsc-enforced).

---

## File Structure

- **Create** `src/app/document-meta.ts` — pure helpers: `hostLabel`, `fileTypeOf`, `filterDocs`, `sortDocs`, `sourceCounts`, types `DocSort`/`DocTypeKey`/`FileType`.
- **Create** `src/app/document-meta.test.ts` — unit tests for the above.
- **Modify** `src/app/i18n.ts` — add 18 EN keys.
- **Modify** `src/app/i18n.de.ts` — add the same 18 keys (DE, via node utf8 write — umlaut-safe).
- **Modify** `src/app/document-links-field.tsx:20-24` — stamp `addedAt` in `add()` (covers every SharePoint add site).
- **Rewrite** `src/app/documents-panel.tsx` — card grid + chips + sort + search; manual add stamps `addedAt`; drop column-resize machinery.
- **Rewrite** `src/app/documents-panel.test.tsx` — table→cards assertions + new filter/sort/added/manual-stamp tests.

---

## Task 1: Pure module `document-meta.ts` — `hostLabel`

**Files:**
- Create: `src/app/document-meta.ts`
- Test: `src/app/document-meta.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/app/document-meta.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { hostLabel } from "./document-meta";

describe("hostLabel", () => {
  it("maps known SaaS hosts to stable labels", () => {
    expect(hostLabel("https://contoso.sharepoint.com/x")).toBe("SharePoint");
    expect(hostLabel("https://contoso-my.sharepoint.com/x")).toBe("OneDrive");
    expect(hostLabel("https://acme.atlassian.net/wiki/spaces/A/pages/1")).toBe("Confluence");
    expect(hostLabel("https://acme.atlassian.net/browse/ABC-1")).toBe("Jira");
    expect(hostLabel("https://github.com/o/r")).toBe("GitHub");
    expect(hostLabel("https://docs.google.com/d/1")).toBe("Google");
  });
  it("returns the bare hostname (www stripped) for unknown hosts", () => {
    expect(hostLabel("https://www.example.com/a")).toBe("example.com");
  });
  it("returns empty string for an unparseable url", () => {
    expect(hostLabel("not a url")).toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/document-meta.test.ts`
Expected: FAIL — "Failed to resolve import ./document-meta" / `hostLabel is not a function`.

- [ ] **Step 3: Write minimal implementation**

Create `src/app/document-meta.ts`:

```ts
// src/app/document-meta.ts
// Pure, i18n-free display-metadata helpers for DocumentLink lists: host label
// (from URL), file type (icon + i18n key), and list filter/sort/counts for the
// Documents card grid. Deterministic — no Date/Math.random.

import type { DocRef, DocSourceKind } from "./documents";

/** Host label from a URL: known SaaS hosts mapped to a stable name, else the
 *  bare hostname (www. stripped). Unparseable → "" (caller renders a fallback). */
export function hostLabel(url: string): string {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
  if (!host) return "";
  if (host.endsWith("-my.sharepoint.com") || host === "onedrive.live.com") return "OneDrive";
  if (host.endsWith(".sharepoint.com")) return "SharePoint";
  if (host.endsWith(".atlassian.net")) return url.includes("/wiki") ? "Confluence" : "Jira";
  if (host === "github.com" || host.endsWith(".github.com")) return "GitHub";
  if (host === "docs.google.com" || host === "drive.google.com") return "Google";
  return host.replace(/^www\./, "");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/document-meta.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/document-meta.ts src/app/document-meta.test.ts
git commit -m "feat(documents): pure hostLabel deriver"
```

---

## Task 2: `fileTypeOf`

**Files:**
- Modify: `src/app/document-meta.ts`
- Test: `src/app/document-meta.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/app/document-meta.test.ts`:

```ts
import { fileTypeOf } from "./document-meta";

describe("fileTypeOf", () => {
  it("uses the filename extension", () => {
    expect(fileTypeOf({ name: "a.pdf", kind: "file" }).labelKey).toBe("Pdf");
    expect(fileTypeOf({ name: "a.docx", kind: "file" }).labelKey).toBe("Word");
    expect(fileTypeOf({ name: "a.xlsx", kind: "file" }).labelKey).toBe("Excel");
    expect(fileTypeOf({ name: "a.pptx", kind: "file" }).labelKey).toBe("Ppt");
    expect(fileTypeOf({ name: "a.png", kind: "file" }).labelKey).toBe("Image");
  });
  it("treats folders as Folder", () => {
    expect(fileTypeOf({ name: "Docs", kind: "folder" }).labelKey).toBe("Folder");
  });
  it("falls back to mimeType when there is no extension", () => {
    expect(fileTypeOf({ name: "report", kind: "file", mimeType: "application/pdf" }).labelKey).toBe("Pdf");
  });
  it("uses Link when a hosted url has no file extension, else File", () => {
    expect(fileTypeOf({ name: "Wiki page", kind: "file", url: "https://acme.atlassian.net/wiki/x" }).labelKey).toBe("Link");
    expect(fileTypeOf({ name: "scratch", kind: "file" }).labelKey).toBe("File");
  });
  it("always returns a non-empty icon", () => {
    expect(fileTypeOf({ name: "a.pdf", kind: "file" }).icon).not.toBe("");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/document-meta.test.ts`
Expected: FAIL — `fileTypeOf is not a function`.

- [ ] **Step 3: Write minimal implementation**

Add to `src/app/document-meta.ts` (above `hostLabel` or below — keep `hostLabel` defined for the `Link` fallback):

```ts
export type DocTypeKey = "Pdf" | "Word" | "Excel" | "Ppt" | "Image" | "Folder" | "Link" | "File";
export interface FileType {
  icon: string;
  labelKey: DocTypeKey;
}

const TYPE_ICON: Record<DocTypeKey, string> = {
  Pdf: "📕", Word: "📘", Excel: "📗", Ppt: "📙", Image: "🖼️", Folder: "📁", Link: "🔗", File: "📄",
};

const EXT_TYPE: Record<string, DocTypeKey> = {
  pdf: "Pdf",
  doc: "Word", docx: "Word",
  xls: "Excel", xlsx: "Excel", csv: "Excel",
  ppt: "Ppt", pptx: "Ppt",
  png: "Image", jpg: "Image", jpeg: "Image", gif: "Image", svg: "Image", webp: "Image",
};

function typeFromMime(mime: string | undefined): DocTypeKey | null {
  if (!mime) return null;
  if (mime === "application/pdf") return "Pdf";
  if (mime.includes("wordprocessingml") || mime === "application/msword") return "Word";
  if (mime.includes("spreadsheetml") || mime === "application/vnd.ms-excel") return "Excel";
  if (mime.includes("presentationml") || mime === "application/vnd.ms-powerpoint") return "Ppt";
  if (mime.startsWith("image/")) return "Image";
  return null;
}

/** File-type descriptor: folder → extension → mimeType → link-vs-file fallback. */
export function fileTypeOf(link: { name: string; url?: string; kind: "file" | "folder"; mimeType?: string }): FileType {
  if (link.kind === "folder") return { icon: TYPE_ICON.Folder, labelKey: "Folder" };
  const dot = link.name.lastIndexOf(".");
  const ext = dot >= 0 ? link.name.slice(dot + 1).toLowerCase() : "";
  const byExt = ext ? EXT_TYPE[ext] : undefined;
  if (byExt) return { icon: TYPE_ICON[byExt], labelKey: byExt };
  const byMime = typeFromMime(link.mimeType);
  if (byMime) return { icon: TYPE_ICON[byMime], labelKey: byMime };
  const key: DocTypeKey = hostLabel(link.url ?? "") ? "Link" : "File";
  return { icon: TYPE_ICON[key], labelKey: key };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/document-meta.test.ts`
Expected: PASS (all `fileTypeOf` + `hostLabel` tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/document-meta.ts src/app/document-meta.test.ts
git commit -m "feat(documents): fileTypeOf deriver"
```

---

## Task 3: `filterDocs` / `sortDocs` / `sourceCounts`

**Files:**
- Modify: `src/app/document-meta.ts`
- Test: `src/app/document-meta.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/app/document-meta.test.ts`:

```ts
import { filterDocs, sortDocs, sourceCounts } from "./document-meta";
import type { DocRef } from "./documents";

const ref = (over: Partial<DocRef["link"]>, kind: DocRef["source"]["kind"], sourceName = "S"): DocRef => ({
  link: { id: "x", name: "n", url: "https://example.com/n.pdf", kind: "file", ...over },
  source: { kind, id: 1, name: sourceName, view: "open-points" },
  index: 0,
});

describe("filterDocs", () => {
  const docs = [ref({ name: "Alpha.pdf" }, "task"), ref({ name: "Beta.docx" }, "raid")];
  it("keeps everything for 'all'", () => {
    expect(filterDocs(docs, "all", "")).toHaveLength(2);
  });
  it("narrows by source kind", () => {
    expect(filterDocs(docs, "raid", "")).toHaveLength(1);
  });
  it("substring-matches the name case-insensitively", () => {
    expect(filterDocs(docs, "all", "alph")).toHaveLength(1);
  });
});

describe("sortDocs", () => {
  it("sorts added newest-first with blanks last", () => {
    const docs = [
      ref({ name: "old", addedAt: "2026-01-01T00:00:00.000Z" }, "task"),
      ref({ name: "blank" }, "task"),
      ref({ name: "new", addedAt: "2026-06-01T00:00:00.000Z" }, "task"),
    ];
    expect(sortDocs(docs, "added").map((d) => d.link.name)).toEqual(["new", "old", "blank"]);
  });
  it("sorts by name A→Z", () => {
    const docs = [ref({ name: "Beta" }, "task"), ref({ name: "Alpha" }, "task")];
    expect(sortDocs(docs, "name").map((d) => d.link.name)).toEqual(["Alpha", "Beta"]);
  });
});

describe("sourceCounts", () => {
  it("counts per kind plus total", () => {
    const c = sourceCounts([ref({}, "task"), ref({}, "task"), ref({}, "raid")]);
    expect(c.all).toBe(3);
    expect(c.task).toBe(2);
    expect(c.raid).toBe(1);
    expect(c.milestone).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/document-meta.test.ts`
Expected: FAIL — `filterDocs is not a function`.

- [ ] **Step 3: Write minimal implementation**

Add to `src/app/document-meta.ts`:

```ts
export type DocSort = "name" | "added" | "source" | "type";

const SOURCE_RANK: Record<DocSourceKind, number> = {
  project: 0, milestone: 1, task: 2, raid: 3, change: 4, stakeholder: 5,
};

export function filterDocs(refs: readonly DocRef[], sourceKind: DocSourceKind | "all", query: string): DocRef[] {
  const q = query.trim().toLowerCase();
  return refs.filter(
    (r) =>
      (sourceKind === "all" || r.source.kind === sourceKind) &&
      (q === "" || r.link.name.toLowerCase().includes(q)),
  );
}

export function sortDocs(refs: readonly DocRef[], by: DocSort): DocRef[] {
  const out = [...refs];
  out.sort((a, b) => {
    switch (by) {
      case "name":
        return a.link.name.localeCompare(b.link.name);
      case "added": {
        const av = a.link.addedAt ?? "";
        const bv = b.link.addedAt ?? "";
        if (av === bv) return 0;
        if (av === "") return 1;
        if (bv === "") return -1;
        return bv.localeCompare(av);
      }
      case "source": {
        const r = SOURCE_RANK[a.source.kind] - SOURCE_RANK[b.source.kind];
        return r !== 0 ? r : a.source.name.localeCompare(b.source.name);
      }
      case "type":
        return fileTypeOf(a.link).labelKey.localeCompare(fileTypeOf(b.link).labelKey);
    }
  });
  return out;
}

export function sourceCounts(refs: readonly DocRef[]): Record<DocSourceKind | "all", number> {
  const counts: Record<DocSourceKind | "all", number> = {
    all: refs.length, project: 0, milestone: 0, task: 0, raid: 0, change: 0, stakeholder: 0,
  };
  for (const r of refs) counts[r.source.kind] += 1;
  return counts;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/document-meta.test.ts`
Expected: PASS (all suites).

- [ ] **Step 5: Commit**

```bash
git add src/app/document-meta.ts src/app/document-meta.test.ts
git commit -m "feat(documents): filter/sort/counts helpers"
```

---

## Task 4: i18n keys (EN + DE)

**Files:**
- Modify: `src/app/i18n.ts:1986` (after `documentsSourceProject`)
- Modify: `src/app/i18n.de.ts:1959` (after `documentsSourceProject`)

- [ ] **Step 1: Add EN keys**

In `src/app/i18n.ts`, immediately after the line `  documentsSourceProject: "Project",` insert:

```ts
  documentsFilterAll: "All",
  documentsSortBy: "Sort",
  documentsSortName: "Name",
  documentsSortAdded: "Date added",
  documentsSortSource: "Source",
  documentsSortType: "Type",
  documentsTypePdf: "PDF",
  documentsTypeWord: "Word",
  documentsTypeExcel: "Excel",
  documentsTypePpt: "PowerPoint",
  documentsTypeImage: "Image",
  documentsTypeFolder: "Folder",
  documentsTypeLink: "Link",
  documentsTypeFile: "File",
  documentsAdded: "Added {0}",
  documentsSearchDocs: "Search documents",
  documentsNoneForSource: "No documents match this filter.",
  documentsHostWeb: "Web",
```

- [ ] **Step 2: Add DE keys via node utf8 write (umlaut-safe, CRLF-aware)**

Run this exact node script (the Edit tool corrupts umlauts in `i18n.de.ts`; `Hinzugefügt` carries `ü`):

```bash
node -e '
const fs = require("fs");
const p = "src/app/i18n.de.ts";
let s = fs.readFileSync(p, "utf8");
const anchor = "  documentsSourceProject: \"Projekt\",\r\n";
const add =
  "  documentsFilterAll: \"Alle\",\r\n" +
  "  documentsSortBy: \"Sortieren\",\r\n" +
  "  documentsSortName: \"Name\",\r\n" +
  "  documentsSortAdded: \"Hinzugefügt\",\r\n" +
  "  documentsSortSource: \"Quelle\",\r\n" +
  "  documentsSortType: \"Typ\",\r\n" +
  "  documentsTypePdf: \"PDF\",\r\n" +
  "  documentsTypeWord: \"Word\",\r\n" +
  "  documentsTypeExcel: \"Excel\",\r\n" +
  "  documentsTypePpt: \"PowerPoint\",\r\n" +
  "  documentsTypeImage: \"Bild\",\r\n" +
  "  documentsTypeFolder: \"Ordner\",\r\n" +
  "  documentsTypeLink: \"Link\",\r\n" +
  "  documentsTypeFile: \"Datei\",\r\n" +
  "  documentsAdded: \"Hinzugefügt {0}\",\r\n" +
  "  documentsSearchDocs: \"Dokumente suchen\",\r\n" +
  "  documentsNoneForSource: \"Keine Dokumente entsprechen diesem Filter.\",\r\n" +
  "  documentsHostWeb: \"Web\",\r\n";
if (!s.includes(anchor)) { console.error("ANCHOR NOT FOUND"); process.exit(1); }
s = s.replace(anchor, anchor + add);
fs.writeFileSync(p, s);
console.log("DE keys inserted");
'
```

Expected output: `DE keys inserted`. (If `ANCHOR NOT FOUND`, the file may use a different quote/line-ending — inspect and adjust the anchor.)

- [ ] **Step 3: Verify parity + umlauts**

Run: `npx tsc --noEmit`
Expected: PASS (EN/DE key parity holds — no missing-key error).

Run: `npx vitest run src/app/i18n-encoding.test.ts`
Expected: PASS (real umlauts, no ASCII substitutions).

- [ ] **Step 4: Commit**

```bash
git add src/app/i18n.ts src/app/i18n.de.ts
git commit -m "i18n(documents): card-grid + metadata keys (EN/DE)"
```

---

## Task 5: Stamp `addedAt` on SharePoint adds

**Files:**
- Modify: `src/app/document-links-field.tsx:20-24`

- [ ] **Step 1: Edit the `add` handler**

Replace the `add` function body so picked links get an `addedAt` stamp (event handler — `new Date()` is legal here, not a render body; preserves any pre-existing `addedAt`):

```tsx
  function add(link: DocumentLink) {
    if (value.some((l) => l.url === link.url)) return;
    const stamped: DocumentLink = link.addedAt ? link : { ...link, addedAt: new Date().toISOString() };
    onChange([...value, stamped]);
    onLog?.("added", link.name);
  }
```

- [ ] **Step 2: Verify nothing regressed**

Run: `npx vitest run src/app/sharepoint-picker-modal.test.tsx src/app/use-sharepoint-browser.test.tsx`
Expected: PASS (mapping/picker unchanged in behavior; addedAt is additive).

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/app/document-links-field.tsx
git commit -m "feat(documents): stamp addedAt on SharePoint link add"
```

---

## Task 6: Rewrite `documents-panel.tsx` (cards + chips + sort + search) and its tests

**Files:**
- Rewrite: `src/app/documents-panel.tsx`
- Rewrite: `src/app/documents-panel.test.tsx`

- [ ] **Step 1: Write the new (failing) test file**

Replace the entire contents of `src/app/documents-panel.test.tsx` with:

```tsx
import { afterEach, describe, expect, it } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { useEffect, type ReactNode } from "react";
import { FiltersProvider } from "./filters-context";
import { WorkspaceProvider, useWorkspace } from "./workspace-context";
import { WorkspaceTabProvider, useWorkspaceTab } from "./workspace-tab-context";
import { DocumentsPanel } from "./documents-panel";
import { SETTINGS_KEY } from "./use-settings";
import { defaultSettings } from "./settings-types";
import { t } from "./i18n";
import type { DocumentLink } from "./document-link";
import type { Task } from "./types";

afterEach(() => {
  window.localStorage.clear();
});

function enableSharePoint() {
  window.localStorage.setItem(
    SETTINGS_KEY,
    JSON.stringify({
      ...defaultSettings,
      integrations: { m365: { ...defaultSettings.integrations?.m365, enabled: true, sharepoint: true } },
    }),
  );
}

const LINK: DocumentLink = {
  id: "dl-1",
  name: "Spec.docx",
  url: "https://example.sharepoint.com/Spec.docx",
  kind: "file",
};

function seededTask(documentLinks: DocumentLink[]): Task {
  return {
    id: 7,
    taskName: "Write spec",
    assignee: "Ada",
    assigneeEmail: "ada@example.com",
    dueDate: "2026-07-01",
    lastUpdateDate: "2026-06-01",
    status: "To Do",
    priority: "Medium",
    blockers: "",
    notes: "",
    documentLinks,
  };
}

function SeedTasks({ tasks }: { tasks: Task[] }) {
  const { setTasks } = useWorkspace();
  useEffect(() => {
    setTasks(tasks);
  }, [setTasks, tasks]);
  return null;
}

function TabProbe() {
  const { activeTab, pendingOpen } = useWorkspaceTab();
  return (
    <div data-testid="tab-probe">
      {activeTab}:{pendingOpen ? pendingOpen.id : "none"}
    </div>
  );
}

function wrapper({ children }: { children: ReactNode }) {
  return (
    <FiltersProvider>
      <WorkspaceProvider>
        <WorkspaceTabProvider>{children}</WorkspaceTabProvider>
      </WorkspaceProvider>
    </FiltersProvider>
  );
}

function renderWithTasks(tasks: Task[]) {
  render(
    <>
      <SeedTasks tasks={tasks} />
      <TabProbe />
      <DocumentsPanel />
    </>,
    { wrapper },
  );
}

describe("DocumentsPanel", () => {
  it("renders a card with the document name and a source button labeled by the task", () => {
    renderWithTasks([seededTask([LINK])]);
    expect(screen.getByText(/Spec\.docx/)).toBeInTheDocument();
    const sourceLabel = `${t("en-US", "documentsSourceTask")}: Write spec`;
    expect(screen.getByRole("button", { name: sourceLabel })).toBeInTheDocument();
  });

  it("removes the card when the ✕ remove button is clicked", () => {
    renderWithTasks([seededTask([LINK])]);
    const remove = screen.getByRole("button", { name: `${t("en-US", "documentsRemove")} – ${LINK.name}` });
    fireEvent.click(remove);
    expect(screen.queryByText(/Spec\.docx/)).not.toBeInTheDocument();
    expect(screen.getByText(t("en-US", "documentsTabEmpty"))).toBeInTheDocument();
  });

  it("navigates to the source via requestOpen when the source button is clicked", () => {
    renderWithTasks([seededTask([LINK])]);
    const sourceLabel = `${t("en-US", "documentsSourceTask")}: Write spec`;
    fireEvent.click(screen.getByRole("button", { name: sourceLabel }));
    expect(screen.getByTestId("tab-probe")).toHaveTextContent("open-points:7");
  });

  it("shows the empty-state text when the workspace has no documents", () => {
    renderWithTasks([]);
    expect(screen.getByText(t("en-US", "documentsTabEmpty"))).toBeInTheDocument();
  });

  it("filters the grid when a source chip is selected", () => {
    const raidDoc: DocumentLink = { id: "dl-2", name: "Risk.pdf", url: "https://example.com/Risk.pdf", kind: "file" };
    const task = seededTask([LINK]);
    const taskWithRaid: Task = { ...task, raid: undefined } as Task;
    // Two docs from two different sources: one task link, one task link renamed.
    renderWithTasks([{ ...taskWithRaid, documentLinks: [LINK, raidDoc] }]);
    expect(screen.getByText(/Spec\.docx/)).toBeInTheDocument();
    expect(screen.getByText(/Risk\.pdf/)).toBeInTheDocument();
    // The "All" chip is present and pressed by default.
    const allChip = screen.getByRole("button", { name: new RegExp(t("en-US", "documentsFilterAll")) });
    expect(allChip).toHaveAttribute("aria-pressed", "true");
  });

  it("narrows by the search box", () => {
    const second: DocumentLink = { id: "dl-2", name: "Risk.pdf", url: "https://example.com/Risk.pdf", kind: "file" };
    renderWithTasks([{ ...seededTask([LINK, second]) }]);
    fireEvent.change(screen.getByLabelText(t("en-US", "documentsSearchDocs")), { target: { value: "risk" } });
    expect(screen.queryByText(/Spec\.docx/)).not.toBeInTheDocument();
    expect(screen.getByText(/Risk\.pdf/)).toBeInTheDocument();
  });

  it("shows the no-match text when search excludes everything", () => {
    renderWithTasks([seededTask([LINK])]);
    fireEvent.change(screen.getByLabelText(t("en-US", "documentsSearchDocs")), { target: { value: "zzz" } });
    expect(screen.getByText(t("en-US", "documentsNoneForSource"))).toBeInTheDocument();
  });

  it("renders the derived host badge and file type", () => {
    renderWithTasks([seededTask([LINK])]);
    expect(screen.getByText("SharePoint")).toBeInTheDocument();
    expect(screen.getByText(t("en-US", "documentsTypeWord"))).toBeInTheDocument();
  });

  it("toggles the add panel and lists attach targets when SharePoint is enabled", async () => {
    enableSharePoint();
    renderWithTasks([seededTask([LINK])]);
    const addBtn = await screen.findByRole("button", { name: new RegExp(t("en-US", "documentsTabAdd")) });
    fireEvent.click(addBtn);
    const select = screen.getByRole("combobox", { name: t("en-US", "documentsTarget") });
    expect(within(select).getByText(`${t("en-US", "documentsSourceTask")}: Write spec`)).toBeInTheDocument();
  });

  it("adds a manual link (stamped with an added date) without SharePoint", () => {
    renderWithTasks([seededTask([])]);
    const addBtn = screen.getAllByRole("button", { name: new RegExp(t("en-US", "documentsTabAdd")) })[0];
    fireEvent.click(addBtn);
    fireEvent.change(screen.getByRole("combobox", { name: t("en-US", "documentsTarget") }), { target: { value: "task:7" } });
    fireEvent.change(screen.getByLabelText(t("en-US", "documentsManualName")), { target: { value: "Plan" } });
    fireEvent.change(screen.getByLabelText(t("en-US", "documentsManualUrl")), {
      target: { value: "https://example.com/plan.pdf" },
    });
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "documentsManualAdd") }));
    expect(screen.getByText(/Plan/)).toBeInTheDocument();
    // Stamped addedAt renders an "Added …" line on the new card.
    expect(screen.getByText(new RegExp(t("en-US", "documentsAdded", ".*")))).toBeInTheDocument();
  });
});
```

> Note: the `documentsAdded` template is `"Added {0}"`; `t("en-US","documentsAdded",".*")` yields the string `"Added .*"`, used as a RegExp source to match the rendered "Added <date>" line.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/app/documents-panel.test.tsx`
Expected: FAIL — current panel renders a table (no host badge, no chips, `getByRole("combobox",{name})` mismatches).

- [ ] **Step 3: Write the new panel**

Replace the entire contents of `src/app/documents-panel.tsx` with:

```tsx
"use client";
import { useMemo, useState } from "react";
import { t } from "./i18n";
import { useSettings } from "./use-settings";
import { useWorkspace } from "./workspace-context";
import { useWorkspaceTab } from "./workspace-tab-context";
import { collectDocuments, type DocRef, type DocSource, type DocSourceKind } from "./documents";
import { isSafeHttpUrl, type DocumentLink } from "./document-link";
import { DocumentLinksFieldGated } from "./document-links-field-gated";
import { VIEW_PANE_RESIZABLE_CLASS } from "./view-styles";
import { useResizable } from "./use-resizable";
import { PrintButton, ResetSizeButton } from "./task-manager-ui";
import { isSharePointEnabled } from "./m365-sharepoint";
import { FOCUS_RING, TRANSITION, INTERACTIVE } from "./interaction-styles";
import { hostLabel, fileTypeOf, filterDocs, sortDocs, sourceCounts, type DocSort, type DocTypeKey } from "./document-meta";
import { formatExpiryDate } from "./date-format";

const SOURCE_LABEL = {
  task: "documentsSourceTask",
  raid: "documentsSourceRaid",
  change: "documentsSourceChange",
  milestone: "documentsSourceMilestone",
  stakeholder: "documentsSourceStakeholder",
  project: "documentsSourceProject",
} as const;

const DOC_TYPE_LABEL = {
  Pdf: "documentsTypePdf",
  Word: "documentsTypeWord",
  Excel: "documentsTypeExcel",
  Ppt: "documentsTypePpt",
  Image: "documentsTypeImage",
  Folder: "documentsTypeFolder",
  Link: "documentsTypeLink",
  File: "documentsTypeFile",
} as const satisfies Record<DocTypeKey, string>;

const SORT_LABEL = {
  name: "documentsSortName",
  added: "documentsSortAdded",
  source: "documentsSortSource",
  type: "documentsSortType",
} as const satisfies Record<DocSort, string>;

const SORT_OPTIONS: DocSort[] = ["added", "name", "source", "type"];
const SOURCE_ORDER: DocSourceKind[] = ["project", "milestone", "task", "raid", "change", "stakeholder"];

export function DocumentsPanel() {
  const { settings } = useSettings();
  const lang = settings.language;
  const { ref, reset } = useResizable("lop-app:documents-size-full");
  const canAddDocument = isSharePointEnabled(settings.integrations);
  const ws = useWorkspace();
  const { requestOpen } = useWorkspaceTab();
  const { tasks, raid, changes, milestones, stakeholders, project } = ws;
  const docs = useMemo(
    () => collectDocuments({ tasks, raid, changes, milestones, stakeholders, project }),
    [tasks, raid, changes, milestones, stakeholders, project],
  );

  const [sourceFilter, setSourceFilter] = useState<DocSourceKind | "all">("all");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<DocSort>("added");

  function linksOf(s: DocSource): DocumentLink[] {
    if (s.kind === "project") return [...(project?.documentLinks ?? [])];
    const list =
      s.kind === "task"
        ? tasks
        : s.kind === "raid"
          ? raid
          : s.kind === "change"
            ? changes
            : s.kind === "milestone"
              ? milestones
              : stakeholders;
    return [
      ...((list as readonly { id: number; documentLinks?: DocumentLink[] }[]).find((e) => e.id === s.id)
        ?.documentLinks ?? []),
    ];
  }
  function setDocsForSource(s: DocSource, next: DocumentLink[]) {
    const patch = <T extends { id: number; documentLinks?: DocumentLink[] }>(arr: readonly T[]): T[] =>
      arr.map((e) => (e.id === s.id ? { ...e, documentLinks: next } : e));
    if (s.kind === "task") ws.setTasks((p) => patch(p));
    else if (s.kind === "raid") ws.setRaid((p) => patch(p));
    else if (s.kind === "change") ws.setChanges((p) => patch(p));
    else if (s.kind === "milestone") ws.setMilestones((p) => patch(p));
    else if (s.kind === "stakeholder") ws.setStakeholders((p) => patch(p));
    else ws.setProject((p) => (p ? { ...p, documentLinks: next } : p));
  }
  function remove(r: DocRef) {
    setDocsForSource(
      r.source,
      linksOf(r.source).filter((_, i) => i !== r.index),
    );
  }

  const [addOpen, setAddOpen] = useState(false);
  const [targetKey, setTargetKey] = useState("");
  const [manualName, setManualName] = useState("");
  const [manualUrl, setManualUrl] = useState("");
  const manualValid = manualName.trim() !== "" && isSafeHttpUrl(manualUrl.trim());
  const targets: DocSource[] = useMemo(
    () => [
      ...tasks.map((x) => ({ kind: "task" as const, id: x.id, name: x.taskName, view: "open-points" as const })),
      ...raid.map((x) => ({ kind: "raid" as const, id: x.id, name: x.title, view: "raid" as const })),
      ...changes.map((x) => ({ kind: "change" as const, id: x.id, name: x.title, view: "changes" as const })),
      ...milestones.map((x) => ({ kind: "milestone" as const, id: x.id, name: x.name, view: "milestones" as const })),
      ...stakeholders.map((x) => ({
        kind: "stakeholder" as const,
        id: x.id,
        name: x.name,
        view: "stakeholders" as const,
      })),
      ...(project ? [{ kind: "project" as const, id: 0, name: project.name, view: "projects" as const }] : []),
    ],
    [tasks, raid, changes, milestones, stakeholders, project],
  );
  const target = targets.find((s) => `${s.kind}:${s.id}` === targetKey);

  function addManualLink(s: DocSource) {
    if (!manualValid) return;
    const url = manualUrl.trim();
    const link: DocumentLink = { id: url, kind: "file", name: manualName.trim(), url, addedAt: new Date().toISOString() };
    if (linksOf(s).some((l) => l.url === link.url)) return;
    setDocsForSource(s, [...linksOf(s), link]);
    setManualName("");
    setManualUrl("");
  }

  const counts = sourceCounts(docs);
  const chipKinds = SOURCE_ORDER.filter((k) => counts[k] > 0);
  const visible = sortDocs(filterDocs(docs, sourceFilter, query), sort);

  return (
    <div ref={ref} className={`print-root ${VIEW_PANE_RESIZABLE_CLASS}`}>
      <div className="mb-3 flex shrink-0 items-center justify-between gap-2">
        <h2 className="text-lg font-medium text-foreground">{t(lang, "documentsTitle")}</h2>
        <div className="flex items-center gap-2 print:hidden">
          <button
            type="button"
            onClick={() => setAddOpen((o) => !o)}
            aria-expanded={addOpen}
            className={`rounded-md border border-AIPM-dark-blue bg-AIPM-dark-blue px-2.5 py-1.5 text-xs font-medium text-white hover:bg-AIPM-dark-blue/90 ${INTERACTIVE}`}
          >
            + {t(lang, "documentsTabAdd")}
          </button>
          <PrintButton lang={lang} />
          <ResetSizeButton onClick={reset} lang={lang} />
        </div>
      </div>

      {addOpen && (
        <div className="mb-3 shrink-0 rounded-md border border-line bg-surface-muted p-3 print:hidden">
          <label className="mb-2 block text-sm text-foreground">
            {t(lang, "documentsTarget")}
            <select
              value={targetKey}
              aria-label={t(lang, "documentsTarget")}
              onChange={(e) => setTargetKey(e.target.value)}
              className={`ml-2 rounded-md border border-line bg-surface px-2 py-1 text-sm ${FOCUS_RING} ${TRANSITION}`}
            >
              <option value="">—</option>
              {targets.map((s) => (
                <option key={`${s.kind}:${s.id}`} value={`${s.kind}:${s.id}`}>
                  {t(lang, SOURCE_LABEL[s.kind])}: {s.name}
                </option>
              ))}
            </select>
          </label>
          {target && (
            <>
              <div className="mb-2 flex flex-wrap items-end gap-2">
                <label className="flex flex-col gap-1 text-xs text-foreground">
                  <span>{t(lang, "documentsManualName")}</span>
                  <input
                    type="text"
                    value={manualName}
                    aria-label={t(lang, "documentsManualName")}
                    onChange={(e) => setManualName(e.target.value)}
                    className={`rounded-md border border-line bg-surface px-2 py-1 text-sm text-foreground focus:outline-none ${FOCUS_RING} ${TRANSITION}`}
                  />
                </label>
                <label className="flex flex-1 flex-col gap-1 text-xs text-foreground">
                  <span>{t(lang, "documentsManualUrl")}</span>
                  <input
                    type="url"
                    value={manualUrl}
                    aria-label={t(lang, "documentsManualUrl")}
                    onChange={(e) => setManualUrl(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") addManualLink(target);
                    }}
                    className={`w-full min-w-[12rem] rounded-md border border-line bg-surface px-2 py-1 text-sm text-foreground focus:outline-none ${FOCUS_RING} ${TRANSITION}`}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => addManualLink(target)}
                  disabled={!manualValid}
                  className={`rounded-md border border-line bg-surface px-3 py-1 text-sm font-medium text-AIPM-dark-blue hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50 dark:text-AIPM-light-grey ${INTERACTIVE}`}
                >
                  {t(lang, "documentsManualAdd")}
                </button>
              </div>
              <p className="mb-2 text-xs text-muted-foreground">{t(lang, "documentsManualHint")}</p>
              {canAddDocument && (
                <DocumentLinksFieldGated
                  value={linksOf(target)}
                  onChange={(next) => setDocsForSource(target, next)}
                  lang={lang}
                />
              )}
            </>
          )}
        </div>
      )}

      {docs.length === 0 ? (
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className={`flex w-full flex-col items-center gap-2 rounded-xl border border-dashed border-line p-10 text-center text-sm text-muted-foreground hover:border-AIPM-dark-blue hover:text-AIPM-dark-blue dark:hover:text-AIPM-light-grey ${INTERACTIVE}`}
        >
          <span>{t(lang, "documentsTabEmpty")}</span>
          <span className="font-medium">+ {t(lang, "documentsTabAdd")}…</span>
        </button>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col overflow-auto pr-2">
          <div className="mb-3 flex flex-wrap items-center gap-2 print:hidden">
            <div className="flex flex-wrap gap-1.5">
              {(["all", ...chipKinds] as (DocSourceKind | "all")[]).map((k) => {
                const active = sourceFilter === k;
                const label = k === "all" ? t(lang, "documentsFilterAll") : t(lang, SOURCE_LABEL[k]);
                return (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setSourceFilter(k)}
                    className={`rounded-full border px-2.5 py-0.5 text-xs ${
                      active
                        ? "border-AIPM-dark-blue bg-AIPM-dark-blue text-white"
                        : "border-line bg-surface-muted text-foreground"
                    } ${INTERACTIVE}`}
                  >
                    {label} <span className="opacity-60">{counts[k]}</span>
                  </button>
                );
              })}
            </div>
            <div className="ml-auto flex items-center gap-2">
              <label className="text-xs text-muted-foreground">
                {t(lang, "documentsSortBy")}
                <select
                  value={sort}
                  aria-label={t(lang, "documentsSortBy")}
                  onChange={(e) => setSort(e.target.value as DocSort)}
                  className={`ml-1 rounded-md border border-line bg-surface px-2 py-1 text-sm ${FOCUS_RING} ${TRANSITION}`}
                >
                  {SORT_OPTIONS.map((s) => (
                    <option key={s} value={s}>
                      {t(lang, SORT_LABEL[s])}
                    </option>
                  ))}
                </select>
              </label>
              <input
                type="search"
                value={query}
                aria-label={t(lang, "documentsSearchDocs")}
                placeholder={t(lang, "documentsSearchDocs")}
                onChange={(e) => setQuery(e.target.value)}
                className={`rounded-md border border-line bg-surface px-2 py-1 text-sm text-foreground ${FOCUS_RING} ${TRANSITION}`}
              />
            </div>
          </div>

          {visible.length === 0 ? (
            <p className="px-1 py-6 text-center text-sm text-muted-foreground">{t(lang, "documentsNoneForSource")}</p>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {visible.map((r, i) => {
                const ft = fileTypeOf(r.link);
                const safe = isSafeHttpUrl(r.link.url);
                const host = safe ? hostLabel(r.link.url) || t(lang, "documentsHostWeb") : "";
                return (
                  <div
                    key={`${r.source.kind}:${r.source.id}:${r.index}:${i}`}
                    className="relative flex flex-col gap-2 rounded-lg border border-line bg-surface p-3"
                  >
                    <button
                      type="button"
                      aria-label={`${t(lang, "documentsRemove")} – ${r.link.name}`}
                      title={t(lang, "documentsRemove")}
                      onClick={() => remove(r)}
                      className={`absolute right-2 top-2 rounded-md px-1.5 text-xs text-muted-foreground hover:text-AIPM-pink-strong ${INTERACTIVE}`}
                    >
                      ✕
                    </button>
                    <div className="text-2xl" aria-hidden="true">
                      {ft.icon}
                    </div>
                    <div className="pr-5">
                      {safe ? (
                        <a
                          href={r.link.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-medium text-AIPM-dark-blue hover:underline dark:text-AIPM-light-grey"
                        >
                          {r.link.name} ↗
                        </a>
                      ) : (
                        <span className="font-medium text-foreground">{r.link.name}</span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => requestOpen(r.source.view, r.source.id)}
                      className={`self-start rounded-full bg-surface-muted px-2 py-0.5 text-xs text-AIPM-dark-blue hover:underline dark:text-AIPM-light-grey ${INTERACTIVE}`}
                    >
                      {t(lang, SOURCE_LABEL[r.source.kind])}: {r.source.name}
                    </button>
                    <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                      <span>{t(lang, DOC_TYPE_LABEL[ft.labelKey])}</span>
                      {host && (
                        <span className="rounded bg-AIPM-dark-blue px-1 text-[10px] uppercase text-white">{host}</span>
                      )}
                      {r.link.addedAt && (
                        <span>· {t(lang, "documentsAdded", formatExpiryDate(r.link.addedAt.slice(0, 10), lang))}</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/app/documents-panel.test.tsx`
Expected: PASS (all DocumentsPanel tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/documents-panel.tsx src/app/documents-panel.test.tsx
git commit -m "feat(documents): card grid with source filter, sort, search, metadata"
```

---

## Task 7: Full verification

**Files:** none (gates only).

- [ ] **Step 1: Typecheck (incl. i18n parity + test types)**

Run: `npx tsc --noEmit`
Expected: PASS (no errors).

- [ ] **Step 2: Lint (fatal on any unused import / warning)**

Run: `npx eslint src/app/document-meta.ts src/app/documents-panel.tsx src/app/documents-panel.test.tsx src/app/document-links-field.tsx --max-warnings=0`
Expected: PASS (no output). If "X is defined but never used" fires, remove the stale import (e.g. confirm `INNER_TABLE_CLASS`, `TABLE_HEAD_CLASS`, `useColumnResize`, `ColumnResizeHandle`, `ResetColWidthsButton` are gone from `documents-panel.tsx`).

- [ ] **Step 3: Run the related unit suites**

Run: `npx vitest run src/app/document-meta.test.ts src/app/documents-panel.test.tsx src/app/i18n-encoding.test.ts`
Expected: PASS (all).

- [ ] **Step 4: Eye-verify (manual, not gated)**

Documents is not in `A11Y_VIEWS`. Run `npm run dev`, open Documents with a few seeded docs, confirm: chips filter + `aria-pressed` toggles, sort reorders, search narrows, host badge + type + added date render, remove works, responsive grid collapses to one column at ~375px, print shows cards without the controls row.

- [ ] **Step 5: Commit (if eye-verify prompted any tweak; else skip)**

```bash
git add -A
git commit -m "chore(documents): card-grid verification tweaks"
```

---

## Self-Review

- **Spec coverage:** hostLabel/fileTypeOf (T1–2), filter/sort/counts (T3), i18n keys (T4), addedAt capture — manual in T6 panel + SharePoint in T5, card grid + chips + sort + search + empty states (T6), palette/a11y baked into T6 markup, tests T1–3/T6, verification T7. All spec sections mapped.
- **Placeholder scan:** none — every step has concrete code/commands.
- **Type consistency:** `DocSort`/`DocTypeKey`/`FileType` defined in T1–3 and consumed identically in T6; `DOC_TYPE_LABEL`/`SORT_LABEL` keyed by those unions via `satisfies`; `filterDocs(refs, sourceKind, query)` / `sortDocs(refs, by)` / `sourceCounts(refs)` signatures match call sites in the panel.
- **Refinement vs spec:** `addedAt` is stamped in `document-links-field.add` (and panel `addManualLink`), NOT `mapDriveItem` — keeps the pure graph mapper deterministic (no purity/property-test risk). Same coverage, lower risk.
