# Documents view — card grid + source filter + enriched metadata

**Date:** 2026-06-30
**Status:** Approved design, pending implementation plan
**Area:** `src/app/documents-panel.tsx` and supporting pure modules

## Goal

Replace the flat two-column Documents table with a visual, metadata-rich **card
grid** filtered by source entity. Enrich each document with derived metadata
(file type, host, added date) that the data model already supports but the view
currently ignores.

## Scope decisions (locked during brainstorming)

- **Layout:** card grid (responsive) with a **top filter-chip bar** by source.
  (Rejected: grouped accordion, two-column master-detail, left source rail,
  enriched-table.)
- **Metadata — IN:**
  - **File type** icon + label, derived from filename extension (fallback
    `mimeType`). Universal — works for manual links too.
  - **Host badge**, derived from the URL hostname (SharePoint / Confluence /
    GitHub / OneDrive / Google / Jira / bare domain / "web"). Universal.
  - **Added date** (`addedAt`), newly captured on add. Forward-only; existing
    links render no date.
- **Metadata — OUT (Tier 2, dropped):** size, last-modified, author, thumbnail.
  SharePoint-only, stale at pick time, blank for manual links.
- **Name search:** included (a simple substring filter over doc name).
- **Sort:** Name / Added / Source / Type.

## Architecture

One-way dependency: pure i18n-free engine ← React panel. No new Workspace field,
no new persisted column, no new write path.

### New pure module `document-meta.ts` (+ `document-meta.test.ts`)

i18n-free, deterministic, no `Date`/`Math.random`.

- `hostLabel(url: string): string`
  - Parse hostname via `URL`. Map known hosts to a stable label:
    `*.sharepoint.com` → "SharePoint", `*.atlassian.net` + `/wiki` →
    "Confluence" else "Jira", `github.com` → "GitHub", `*-my.sharepoint.com` /
    `onedrive.live.com` → "OneDrive", `docs.google.com`/`drive.google.com` →
    "Google", else the bare hostname (stripped of `www.`). Unparseable → `""`
    (caller renders the `documentsHostWeb` fallback "web").
  - Returns a plain string; host names are NOT translated. Only the "web"
    fallback is an i18n key, resolved by the caller.
- `fileTypeOf(link: { name: string; kind: "file" | "folder"; mimeType?: string })
  : { icon: string; labelKey: DocTypeKey }`
  - `kind === "folder"` → Folder.
  - Else extension from `name` (lowercased, after last `.`): pdf → Pdf;
    doc/docx → Word; xls/xlsx/csv → Excel; ppt/pptx → Ppt; png/jpg/jpeg/gif/
    svg/webp → Image. No/unknown extension → consult `mimeType` (e.g.
    `application/pdf`, `…wordprocessingml…`, `…spreadsheetml…`,
    `…presentationml…`, `image/*`). Still unknown: if the URL has a host but no
    file extension treat as **Link**, else **File**.
  - `DocTypeKey = "Pdf"|"Word"|"Excel"|"Ppt"|"Image"|"Folder"|"Link"|"File"`.
    `icon` is an emoji constant per key (📕/📘/📗/📙/🖼️/📁/🔗/📄).
- `filterDocs(refs, { sourceKind, query }): DocRef[]` — narrows by selected
  source kind (`"all"` keeps all) and case-insensitive substring over
  `link.name`.
- `sortDocs(refs, by: DocSort): DocRef[]` — stable sort. `DocSort =
  "name"|"added"|"source"|"type"`. `added` sorts by `addedAt` (blank last,
  newest first); `source` by source-kind order then source name; `type` by
  type label; `name` A→Z.
- `sourceCounts(refs): Record<DocSourceKind | "all", number>` — chip counts.

### Capture `addedAt` (rides the existing JSON-in-cell blob — zero new write paths)

`DocumentLink.addedAt` already exists in the type, sanitizer, and serializers.
Today nothing writes it. Add capture at the two add sites:

- `documents-panel.tsx` `addManualLink` — set `addedAt: new Date().toISOString()`
  on the new link (event handler → `new Date()` is legal, not a render body).
- `sharepoint-graph.ts` `mapDriveItem` — set `addedAt` when mapping a picked
  driveItem. (Mapping runs in an async callback, not render.)

Existing links keep `addedAt === undefined` → the card renders no date line.
No migration, no fixture change (sample docs are manual and carry no `addedAt`).

### Rewrite `documents-panel.tsx`

Remove column machinery (no columns any more): `useColumnResize`,
`DOCS_COL_WIDTHS`, `DocCol`, `ColumnResizeHandle`, `ResetColWidthsButton`,
`startColResize`. Keep `useResizable` (pane size), `PrintButton`,
`ResetSizeButton`, the Add panel, and `requestOpen` deep-linking.

New panel state: `sourceFilter: DocSourceKind | "all"` (default `"all"`),
`query: string` (default `""`), `sort: DocSort` (default `"added"`).

Render order inside the existing `print-root` resizable pane:

1. **Header** — title, `+ Add` toggle, `PrintButton`, `ResetSizeButton`
   (drop reset-col-widths).
2. **Add panel** — unchanged (target select + manual name/url + SharePoint
   picker). Manual add now stamps `addedAt`.
3. **Controls row** (`print:hidden`): filter chips + sort `<select>` + search
   `<input>`.
   - **Filter chips:** "All" + one `<button>` per source kind that has ≥1 doc,
     each showing its count. Single-select. `aria-pressed={active}`; accessible
     name = source label (NOT a flipping label). Active style
     `bg-AIPM-dark-blue text-white`, inactive `bg-surface-muted`. `INTERACTIVE`
     atoms; keyboard-native buttons.
   - **Sort:** `<select>` with `aria-label={documentsSortBy}`, four options.
     `FOCUS_RING` + `TRANSITION`.
   - **Search:** `<input>` with `aria-label={documentsSearchDocs}` (placeholder
     alone is not an accessible name).
4. **Grid / empty:**
   - No docs at all → keep the current gantt-style dashed clickable add box.
   - Docs exist but filter/search yields zero → muted
     `documentsNoneForSource` text (not the add affordance).
   - Else **responsive grid**: `grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`
     with token gaps. Cards built from `sortDocs(filterDocs(docs, …), sort)`.

**Card contents** (per `DocRef`):

- Type icon (`aria-hidden` — label conveys meaning).
- Doc name as the link: `<a target="_blank" rel="noopener noreferrer">` with the
  `↗` affordance, when `isSafeHttpUrl`; else a plain `<span>`. Accessible name =
  doc name.
- Source chip: `<button>` → `requestOpen(source.view, source.id)`, accessible
  name `"<sourceLabel>: <sourceName>"` (kept from today).
- Host badge: derived `hostLabel(url) || t(documentsHostWeb)`,
  `bg-AIPM-dark-blue text-white` token.
- Type label + "Added <date>" meta line (date only when `addedAt` present),
  formatted with the existing display-locale helper used elsewhere in the view.
- Remove `✕` `<button>` — row-unique `aria-label={documentsRemove – name}`
  (kept).

**Print:** keep `print-root`; `print:hidden` the controls row + add panel; cards
print. Card grid uses `print:` overrides only if a max-height clips (it does not
here).

## Palette / a11y

- Tokens only — host badge `bg-AIPM-dark-blue text-white`, chips
  `bg-surface-muted`, active chip `bg-AIPM-dark-blue text-white`, `INTERACTIVE`/
  `FOCUS_RING`/`TRANSITION` atoms. No shadow/gradient/off-palette.
- Documents is **not** in `A11Y_VIEWS` → eye-verify: chip labels + `aria-pressed`
  coherence, sort/search `aria-label`s, card link names, row-unique remove +
  source-chip labels, icon `aria-hidden`.
- Responsive grid carries a `grid-cols-1` mobile base (per the responsive-grid
  convention) and widens at `sm:`/`lg:`.

## i18n (EN `i18n.ts` + DE `i18n.de.ts`, parity tsc-enforced)

New keys (EN + real-umlaut DE, DE patched via node utf8 write):

- `documentsFilterAll`
- `documentsSortBy`, `documentsSortName`, `documentsSortAdded`,
  `documentsSortSource`, `documentsSortType`
- `documentsTypePdf`, `documentsTypeWord`, `documentsTypeExcel`,
  `documentsTypePpt`, `documentsTypeImage`, `documentsTypeFolder`,
  `documentsTypeLink`, `documentsTypeFile`
- `documentsAdded` (positional `{0}` → "Added {0}")
- `documentsSearchDocs` (aria-label)
- `documentsNoneForSource`
- `documentsHostWeb`

Reuse existing `SOURCE_LABEL` map for source chips/labels.

## Tests

- **`document-meta.test.ts`** (new): `hostLabel` for each known host + bare
  domain + unparseable → `""`; `fileTypeOf` for each extension, mimeType
  fallback, folder, link-vs-file fallback; `filterDocs`/`sortDocs`/
  `sourceCounts` behaviour.
- **`documents-panel.test.tsx`** (rewrite table→cards): renders one card per
  doc; clicking a source chip narrows the set + sets `aria-pressed`; sort select
  reorders; search narrows; manual add stamps `addedAt` (asserted via the
  rendered "Added …" line and/or the persisted link); type icon + host badge
  present; remove removes; filtered-to-zero shows `documentsNoneForSource`;
  truly-empty shows the dashed add box.
- Run `npx tsc --noEmit` (test type-safety + i18n parity), `npm run lint`
  (`--max-warnings=0`), `npm run test:run`.

## Out of scope

Tier-2 metadata (size/modified/author/thumbnail); multi-select filter;
per-file-type filter; re-resolving stale SharePoint metadata; Documents view
into `A11Y_VIEWS`.

## Risk / landmines

- No new persisted field — `addedAt` rides the existing JSON-in-cell
  `DocumentLink` blob; CSV/MD/Turso/IDB unaffected; golden fixtures byte-stable.
- DE edits corrupt umlauts/quotes via the Edit tool → patch `i18n.de.ts` via
  node utf8 write, CRLF-aware, grep-verify.
- `lint --max-warnings=0` is fatal — remove every now-unused import
  (`useColumnResize`, `ColumnResizeHandle`, `ResetColWidthsButton`, etc.).
- Hoist any `obj.member`/`?.length` out of `useMemo` dep arrays to a scalar
  local (exhaustive-deps rejects member deps).
- Chip is a real toggle button → pin the label to the source name and let
  `aria-pressed` track selection (do not flip the visible label).
