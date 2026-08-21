# Slice E — Shell/settings: project config, theme files, resizable height

_Opened 2026-07-28, against 0.207.0 "Goss". Slice **E** of
`2026-07-27-ux-batch-roadmap-design.md` (order C → D → F → A → **E** → S6 → S7 → B).
Target release **0.208.0**._

★ **This file is gitignored** (`.gitignore:76:/docs/superpowers/`), local-only by explicit
decision. The **cumulative re-archive is mandatory at slice close** — merge the previous
archive's unique entries into the new zip (working tree wins on collision) and assert the
superset property before trusting it:

```python
missing = set(old.namelist()) - set(new.namelist())
assert not missing
```

---

## Scope

Three independent items, no shared code. Each ships on its own commits.

| # | Item | Blast radius |
|---|---|---|
| 1 | Project config reachable from Settings → General | `settings-view` · `general-section` · new shared project-edit modal · `projects-panel` |
| 2 | Theme gallery becomes a file-only theme library | `theme-gallery` · `color-scheme-editor` · `color-schemes` · 3 tests · `e2e/a11y.spec.ts` · `public/themes/` deleted |
| 3 | Resizable-window height audit | `edit-modal-chrome` (7 modals) · `budget-bucket-modal` = 8 |

**No persisted shape change. No new backend write path. No golden-fixture regeneration.**

---

## Grounding — verified against 0.207.0

Recorded so it is not re-derived during planning.

| Assumption | Actual |
|---|---|
| Project config is missing from Settings | `ProjectMeta` is editable only via Projects panel → Edit → `ProjectForm` hosted in a local `Modal` (`projects-panel.tsx:412-445`). Settings has 17 rail sections; General (100 lines) holds popout-reuse, workday-hours, reset, and folds Storage |
| Theme gallery has no file picker | A file picker **already exists**, in `color-scheme-editor.tsx:145` (`onImportFile`). It is **lossy**: `addScheme(name, light, branding)` drops `dark`, `supportsDark` and `structural`, so importing a full portable theme from disk silently degrades it to light-only. The gallery's `fetch` path (`theme-gallery.tsx:43-79`) is the complete one — `addScheme` **+** `updateScheme({supportsDark, dark, structural})`, plus name-dedup and `upsertSchemeAsync` |
| AIPM/Dashboard are hardcoded schemes | The **data** is two portable files in `public/themes/`; only the two-entry `SHIPPED` list in `theme-gallery.tsx:25-26` is hardcoded. They left `BUILTIN_SCHEMES` in release A (0.190.22) — `BUILTIN_SCHEMES` is `[harbor, meridian, umber]` |
| `public/themes/*.json` is gallery data only | **Four test files read it from the repo** via `readFileSync`: `e2e/a11y.spec.ts:9` (seeds AIPM + Mockup as user schemes → the 5-scheme axe matrix), `scheme-purple-hover.test.ts:137`, `scheme-contrast-cues.test.ts:73`, `shipped-themes.test.ts:5` |
| Only `EditModalShell` lacks a height | `budget-bucket-modal.tsx:250` also violates the contract — `max-h-[95vh]` with no `h`/`min-h`. Every other floating window complies: `notes-window` `h-[560px] min-h-72`, `help-menu` `h-[640px] min-h-72`, `task-form-modal` `h-[900px] max-h-[95vh] min-h-[480px]`, `jira-conflicts-modal` `h-[680px] max-h-[95vh] min-h-[320px]` |
| `SettingsView` would need a new prop chain for project meta | It would not. `projectStakeholderNames`, `projectAddressBook`, `projectResources` and `onUpdateCurrentProject` are all assembled in `task-manager.tsx:2287-2294`, and `<SettingsView>` renders at `task-manager.tsx:2464` — the same scope |

---

## Item 1 — Project config in Settings → General

### Shape: launcher, not inline form

`ProjectForm` is a 30-field form (`project-form.tsx` 207 lines + `project-form-fields.tsx` 715).
Rendering it inline in General would swamp a 100-line section, add ~30 controls to an
axe-scanned view, and duplicate the `Modal` + `ModalHeader` + `ProjectForm` host block that
`projects-panel.tsx` already owns — and `dup:check` is blocking.

So General gains:

- a **read-only summary line** of the current project (name · code · start–end · operating
  timezone), and
- an **"Edit project…"** button opening the shared project-edit modal.

### Shared modal

Extract the modal host from `projects-panel.tsx` into a presentational
`project-edit-modal.tsx` — the `Modal` + `ModalHeader` + `ProjectForm` trio, taking
`{lang, initial, stakeholderNames, addressBook, resources, onSubmit, onCancel}`. Both call
sites use it:

```
projects-panel.tsx   modal.mode === "edit"  ─┐
general-section.tsx  "Edit project…"        ─┴→ <ProjectEditModal …/>
```

`projects-panel`'s **create** mode keeps its own host (it renders `CreateProjectForm`, a
different component with format/opts arguments). Only the edit path is shared.

### Wiring

`SettingsViewProps` gains four optional fields, threaded from the values already in scope at
`task-manager.tsx:2464`:

```ts
project?: ProjectMeta;
projectStakeholderNames?: readonly string[];
projectAddressBook?: readonly ContactPerson[];
onUpdateProject?: (meta: ProjectMeta) => void;   // = handleUpdateCurrentProjectByMode
```

`resources` is already a `SettingsViewProps` field (used by the Appearance "I am this
resource" picker) — reuse it, do not add a second.

All four are **optional**: `SettingsView` is also rendered in a popout, and the existing
settings tests construct it without them. The General block renders only when `project` and
`onUpdateProject` are both present, so a popout gets the summary at most, never an editor.
Writes go through `handleUpdateCurrentProjectByMode` — the same mode-aware writer (file vs
Turso portfolio) the Projects panel uses. No new persistence path.

---

## Item 2 — Theme gallery becomes a file-only theme library

### Nothing about AIPM or Dashboard stays in the app

- **Delete** `public/themes/AIPM.json` and `public/themes/mockup.json`.
- **Delete** the `SHIPPED` array and `importTheme`'s `fetch` path in `theme-gallery.tsx`.
- Update the now-stale comments in `builtin-schemes.ts:5`, `style-tokens.test.ts:14` and the
  `theme-gallery.tsx` header that point at `public/themes/*.json`.

The app then ships and serves no AIPM or Dashboard asset. A user who wants either supplies the
`.json` themselves.

### The gallery becomes a library

`theme-gallery.tsx` renders:

1. a **"Load theme file…"** picker (`<input type="file" accept="application/json">`), and
2. a **card list of every user scheme** — name, active marker, **Apply**, **Remove**.

This reads the store that already exists (`loadSchemes().schemes.filter(s => !s.builtIn)`) and
needs **no provenance field** — an editor-made scheme lists alongside an imported one, accepted
deliberately over adding a persisted `source` marker that would have to ride both the
localStorage cache and the Turso `schemes` table with no value for existing rows.

Built-ins stay out of the list — they are not removable and the `<Select>` in
`AppearanceSection` already offers them.

### One shared import routine

Both file entry points route through a single new function in `color-schemes.ts` (or a sibling
module beside it):

```ts
importSchemeText(text: string, config: TursoConfig | null): Promise<string | null>
//   parse via importScheme  →  null on failure
//   name-dedup: existing non-builtin with the same name  →  upsert + return its id
//   else addScheme(name, light, branding)
//        + updateScheme(id, { supportsDark, dark, structural })  when any is present
//        + upsertSchemeAsync(config, created)
//   → returns the scheme id to activate
```

Call sites: the gallery picker, and `color-scheme-editor.tsx`'s `onImportFile` — whose lossy
inline body is replaced. That closes the degradation bug and keeps `dup:check` clean.

The editor keeps its own post-import behaviour (seed `name`/`colors`/`branding` state and
`applyResolved`), which the gallery does not need.

### Test and gate fallout

| File | Change |
|---|---|
| `shipped-themes.test.ts` | **deleted** — its subject no longer exists |
| `scheme-purple-hover.test.ts` | strip the shipped-theme arm; the built-in arms and the custom-scheme direction cases stay |
| `scheme-contrast-cues.test.ts` | same |
| `e2e/a11y.spec.ts` | drop the `readFileSync("public/themes/…")` seeding; rebuild the matrix on built-ins |

**Axe matrix rebuilt at 5 combos, identical check count:**

```
harbor   light · dark
meridian light · dark
umber    light
→ 5 schemes × 16 views + 5 Kanban variants = 85 checks   (unchanged)
```

This scans three distinct palettes where the old matrix scanned two. Seeding stays the
documented shape — set `aipm-cockpit:color-schemes` `activeId` to the scheme under test
(scheme landmine 4: seeding only the boot keys is not enough, `syncScheme` overwrites the boot
paint on mount). Built-ins need no `schemes[]` entry — `reconcileBuiltins` injects them.

★ **Coverage note:** deleting the shipped theme files removes the AA guard's only non-built-in
subjects. `scheme-purple-hover.test.ts` documents that its purpose is catching a revert of the
`--ui-purple-strong` derivation reference; the built-in arms still do that. The loss is
fidelity coverage of two specific hand-tuned palettes, accepted with the deletion.

---

## Item 3 — Resizable-window height audit

`use-resizable.ts`'s own header states the contract: *"the element should carry `resize: both;
overflow: auto` plus class-based default `width`/`height` and reasonable min/max bounds."*

Two violators, both fixed by className changes plus one prop:

### `edit-modal-chrome.tsx` — `EditModalShell` (7 modals)

Today: `relative flex ${widthClassName} max-w-[95vw] resize flex-col overflow-hidden …` — **no
height on any axis**, and the `<form>` is `overflow-y-auto` with no `flex-1 min-h-0`, so a
dragged height opens dead space below a scroller that never grows.

```
+ heightClassName = "h-[720px] min-h-[420px] max-h-[95vh]"   // defaulted prop, mirrors widthClassName
+ formClassName default gains `flex-1 min-h-0`
```

`heightClassName` is a **defaulted, overridable prop** exactly like `widthClassName`, so a
modal that needs a different default overrides only that. Consumers:
`absence-edit-modal` · `calendar-event-modal` · `change-edit-modal` · `milestone-edit-modal` ·
`raid-edit-modal` · `resource-edit-modal` · `stakeholder-edit-modal`.

★★ **Five of the seven already pin a height fragment** via `panelClassName="max-h-[95vh]"` —
`absence-edit-modal:122` · `calendar-event-modal:183` · `milestone-edit-modal:134` ·
`raid-edit-modal:251` · `resource-edit-modal:135`. (`change-edit-modal` and
`stakeholder-edit-modal` pass none.) The new `heightClassName` default **already contains**
`max-h-[95vh]`, so those five overrides become redundant and must be **removed in the same
commit**, not left to fight the new class by CSS source order — the primitives concatenate
`className` with **no** tailwind-merge, so which one wins is decided by Tailwind's output
ordering, not by the call site.

★ Four consumers also override `formClassName` (three grid variants at `p-5`, milestone a
single-column `flex flex-col`). Each carries its own `overflow-y-auto` and none carries
`flex-1 min-h-0` — so adding those two classes to the **shell's default** fixes only the two
modals that use the default. Every overriding `formClassName` must gain `flex-1 min-h-0` too,
or those four keep the dead-space bug while the other two are fixed.

### `budget-bucket-modal.tsx:250`

```
  max-h-[95vh] w-[640px] min-w-[460px] max-w-[95vw] resize flex-col overflow-hidden
+ h-[640px] min-h-[400px]
```

★ This file is at **762 lines against the 800 ratchet** — className edits only, no new lines.

### Sweep

Grep every `resize` surface (`grep -rn "\bresize\b" src/app --include=*.tsx`) and confirm no
third element carries `resize` without a default height. Record the result; if a third is
found, fix it the same way.

---

## Testing

- **Item 1** — `ProjectEditModal` renders both call sites' fields; General's block is absent
  without `project`/`onUpdateProject`; the "Edit project…" button opens the modal and a submit
  calls `onUpdateProject` with the sanitized meta. ★ Assert the **write** direction, not just
  that the form renders (slice-C lesson: a read-only test left the whole suite green with both
  persistence calls removed).
- **Item 2** — `importSchemeText` carries `dark` + `supportsDark` + `structural` through
  (**the headline assertion, written first**); dedup returns the existing id without creating a
  second scheme; a malformed file yields `null` and surfaces the error. The gallery lists user
  schemes and not built-ins; Apply activates; Remove deletes. ★ Mutation-check the editor call
  site by reverting it to the old lossy `addScheme` — the dark/structural assertion must be the
  one that fails, and **read which assertion failed**.
- **Item 3** — the shell emits a height class and a `flex-1 min-h-0` form; `budget-bucket-modal`
  emits `h-`/`min-h-`. These are DOM-shape assertions; jsdom reports every rect as zero, so do
  not assert pixels.
- **Axe** — run the rebuilt matrix on a **fresh isolated server** (`PORT=3100 npm run dev`),
  never the reused long-running one. ★ A **cold** server failed the gate 5/5 in slice A and
  passed 5/5 once warm — re-run before debugging any failure.

---

## Constraints that bite this slice

- **i18n** — new EN+DE keys for the project block (summary labels + "Edit project…"), the file
  picker, and the gallery list (Apply / Remove / empty state). `themeGalleryImport` (takes a
  theme-name arg) and `themeGalleryHint` retire or are reworded. `i18n.de.ts` is **CRLF** and
  the Edit tool corrupts umlauts — patch via a node utf8 write whose newline is derived from
  the file, then grep-verify.
- **Axe duplicate names** — Settings is scanned, and this slice adds a **second** clear/apply-
  class control family to Appearance. The gate sees missing names, never duplicate ones. Qualify
  every label (`Apply – <scheme name>`, `Remove – <scheme name>`).
- **dup:check is blocking** — the shared `ProjectEditModal` and the shared `importSchemeText`
  exist for this reason. Extract before the second call site, not after.
- **Coverage gate** — a new pure `.ts` (the import routine) is coverage-gated; test it properly
  rather than excluding it. A new `.tsx` component is not.
- **Release chain** — bump `src/app/version.ts` (APP_VERSION + milestone), add a `CHANGELOG.md`
  entry, and append `versionHighlight0208` to `APP_HIGHLIGHT_KEYS` with EN+DE strings — all
  three items are user-visible. Codename must be unique: grep `CHANGELOG.md` for `"Name"`
  **with the quotes** (~147 used).
- **Archive** — cumulative re-archive at slice close, superset-asserted.

---

## Out of scope

- Rich text on RAID/milestone descriptions (slice B).
- Outlook push/pull for calendar events (S6/S7).
- Auditing the ~25 `VIEW_PANE_RESIZABLE_CLASS` panels for the same dead-space behaviour —
  considered and deliberately excluded; those panes are axe-scanned and several sit near the
  size ratchet.
- A provenance marker distinguishing file-imported from editor-made schemes.
