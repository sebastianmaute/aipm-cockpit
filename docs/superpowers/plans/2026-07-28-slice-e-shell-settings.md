# Slice E — Shell/settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make project config reachable from Settings → General, turn the theme gallery into a file-only theme library (deleting the shipped AIPM/Dashboard assets), and give every resizable modal a working height axis.

**Architecture:** Three independent items sharing no code. Item 3 is a defaulted prop on `EditModalShell` plus className fixes at 7 consumer call sites. Item 2 extracts one shared `importSchemeText` routine, rewrites `theme-gallery.tsx` as a file-picker + user-scheme list, deletes `public/themes/`, and rebuilds the axe matrix on built-in schemes. Item 1 extracts the project-edit modal host from `projects-panel.tsx` into a shared module and mounts it from a new block in `general-section.tsx`.

**Tech Stack:** Next.js 16 / React 19 / TypeScript, Tailwind v4, vitest + Testing Library, Playwright + axe.

**Spec:** `docs/superpowers/specs/2026-07-28-slice-e-shell-settings-design.md`

**Task order:** items 3 → 2 → 1 → release. Smallest blast radius first, and item 2's deletions must land only after the gallery stops fetching the files it deletes. Task 3 front-loads **all** i18n so the CRLF/umlaut patch dance happens once.

---

## File Structure

**Created**

| File | Responsibility |
|---|---|
| `src/app/scheme-import.ts` | The single import routine: parse → dedup → add → carry `dark`/`supportsDark`/`structural` → Turso upsert → return the scheme id. Used by the gallery picker AND the editor picker. |
| `src/app/scheme-import.test.ts` | Unit tests for the above. Coverage-gated (a new pure `.ts`), so tested properly rather than excluded. |
| `src/app/project-edit-modal.tsx` | `ProjectModalShell` (Modal + resizable panel + `ModalHeader` + scroller) and `ProjectEditModal` (shell + `ProjectForm`). Presentational; all values/handlers are props. |
| `src/app/project-edit-modal.test.tsx` | Renders both exports, asserts the submit path. |

**Modified**

| File | Change |
|---|---|
| `src/app/edit-modal-chrome.tsx` | New `heightClassName` defaulted prop; `flex-1 min-h-0` in the default `formClassName`. |
| `src/app/absence-edit-modal.tsx` · `calendar-event-modal.tsx` · `milestone-edit-modal.tsx` · `raid-edit-modal.tsx` · `resource-edit-modal.tsx` | Drop the now-redundant `panelClassName="max-h-[95vh]"`. |
| `src/app/absence-edit-modal.tsx` · `calendar-event-modal.tsx` · `milestone-edit-modal.tsx` · `resource-edit-modal.tsx` | Add `flex-1 min-h-0` to each `formClassName` override. |
| `src/app/budget-bucket-modal.tsx` | Add `h-[640px] min-h-[400px]` to the panel. **762/800 lines — className edits only.** |
| `src/app/i18n.ts` · `i18n.de.ts` | All new keys (task 3). |
| `src/app/theme-gallery.tsx` | Rewritten: file picker + user-scheme list; `SHIPPED` and the `fetch` path deleted. |
| `src/app/theme-gallery.test.tsx` | Rewritten for the new behaviour. |
| `src/app/color-scheme-editor.tsx` | `onImportFile` routes through `importSchemeText`. |
| `src/app/settings-sections/appearance-section.tsx` | Pass `refresh` + `selectScheme` + the scheme list to the gallery. |
| `src/app/scheme-contrast-cues.test.ts` · `scheme-purple-hover.test.ts` | Strip the shipped-theme arms. |
| `e2e/a11y.spec.ts` | Matrix rebuilt on built-ins. |
| `src/app/projects-panel.tsx` | Modal host replaced by the shared components. |
| `src/app/settings-sections/general-section.tsx` | New Project block. |
| `src/app/settings-view.tsx` | Thread four new optional props. |
| `src/app/task-manager.tsx` | Pass them from values already in scope. |
| `src/app/version.ts` · `CHANGELOG.md` · `src/app/app-highlights.ts` | Release chain. |

**Deleted**

`public/themes/AIPM.json` · `public/themes/mockup.json` · `src/app/shipped-themes.test.ts`

---

## Task 1: EditModalShell gains a height axis

The shell's panel carries `resize` with **no height class**, violating `use-resizable.ts`'s documented contract, and its `<form>` is `overflow-y-auto` with no `flex-1 min-h-0` — so a dragged height opens dead space above a scroller that never grows.

★★ Five of the seven consumers already pin `panelClassName="max-h-[95vh]"`. The new default **contains** `max-h-[95vh]`, so those five must be removed in this same task — the primitives concatenate `className` with no tailwind-merge, so a leftover is resolved by Tailwind's output ordering, not by the call site.

★ Four consumers override `formClassName`; each carries its own `overflow-y-auto` and none carries `flex-1 min-h-0`. Adding those classes only to the shell's default would fix 2 of 7.

**Files:**
- Modify: `src/app/edit-modal-chrome.tsx:40-107`
- Modify: `src/app/absence-edit-modal.tsx:121-123`, `calendar-event-modal.tsx:182-184`, `milestone-edit-modal.tsx:133-135`, `raid-edit-modal.tsx:251`, `resource-edit-modal.tsx:134-136`
- Test: `src/app/edit-modal-chrome.test.tsx` (create if absent)

- [ ] **Step 1: Write the failing test**

Create or append to `src/app/edit-modal-chrome.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { EditModalShell } from "./edit-modal-chrome";

function renderShell(extra: Partial<React.ComponentProps<typeof EditModalShell>> = {}) {
  return render(
    <EditModalShell
      lang="en-US"
      title="Shell test"
      modalId="change"
      onClose={vi.fn()}
      onSubmit={vi.fn()}
      offset={{ x: 0, y: 0 }}
      dragHandleProps={{}}
      onDragReset={vi.fn()}
      sizeKey="test:shell-size"
      {...extra}
    >
      <p>body</p>
    </EditModalShell>,
  );
}

describe("EditModalShell height axis", () => {
  test("the panel carries a default height, min-height and max-height", () => {
    renderShell();
    const panel = document.querySelector("[data-modal-panel]") as HTMLElement;
    // Headline claim FIRST: a resizable panel needs a class-based default height
    // (use-resizable.ts's documented contract) or a dragged height is dead space.
    expect(panel.className).toContain("h-[720px]");
    expect(panel.className).toContain("min-h-[420px]");
    expect(panel.className).toContain("max-h-[95vh]");
  });

  test("the default form fills the panel so a dragged height reaches the scroller", () => {
    renderShell();
    const form = screen.getByText("body").closest("form") as HTMLElement;
    expect(form.className).toContain("flex-1");
    expect(form.className).toContain("min-h-0");
  });

  test("heightClassName overrides the default", () => {
    renderShell({ heightClassName: "h-[500px]" });
    const panel = document.querySelector("[data-modal-panel]") as HTMLElement;
    expect(panel.className).toContain("h-[500px]");
    expect(panel.className).not.toContain("h-[720px]");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/edit-modal-chrome.test.tsx`
Expected: FAIL — either `Property 'heightClassName' does not exist` at the type level, or `expect(panel.className).toContain("h-[720px]")` reporting a className with no `h-[` fragment.

- [ ] **Step 3: Add the prop and the default**

In `src/app/edit-modal-chrome.tsx`, add to `EditModalShellProps` immediately after the `widthClassName` doc block (around line 46):

```ts
  /** Panel height classes. Default `"h-[720px] min-h-[420px] max-h-[95vh]"` —
   *  `useResizable` needs a class-based default height or a dragged height opens
   *  dead space. Overriding replaces all three; the override must carry its own
   *  `max-h-` cap (there is no tailwind-merge, so a stray leftover would be
   *  resolved by Tailwind's output ordering, not by the call site). */
  heightClassName?: string;
```

Add to the destructure (immediately after `widthClassName = …`):

```ts
  heightClassName = "h-[720px] min-h-[420px] max-h-[95vh]",
```

Change the default `formClassName` default value from:

```ts
  formClassName = "grid grid-cols-1 gap-4 overflow-y-auto p-6 sm:grid-cols-2",
```

to:

```ts
  formClassName = "grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto p-6 sm:grid-cols-2",
```

Change the panel `className` from:

```tsx
        className={`relative flex ${widthClassName} max-w-[95vw] resize flex-col overflow-hidden rounded-xl border border-line bg-surface${panelClassName ? ` ${panelClassName}` : ""}`}
```

to:

```tsx
        className={`relative flex ${widthClassName} ${heightClassName} max-w-[95vw] resize flex-col overflow-hidden rounded-xl border border-line bg-surface${panelClassName ? ` ${panelClassName}` : ""}`}
```

- [ ] **Step 4: Run the shell test**

Run: `npx vitest run src/app/edit-modal-chrome.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Drop the five redundant `panelClassName` overrides**

Delete exactly this line from each of the five files — `absence-edit-modal.tsx:122`, `calendar-event-modal.tsx:183`, `milestone-edit-modal.tsx:134`, `raid-edit-modal.tsx:251`, `resource-edit-modal.tsx:135`:

```tsx
      panelClassName="max-h-[95vh]"
```

- [ ] **Step 6: Add `flex-1 min-h-0` to the four `formClassName` overrides**

`absence-edit-modal.tsx:123`, `calendar-event-modal.tsx:184`, `resource-edit-modal.tsx:136` — change:

```tsx
      formClassName="grid grid-cols-1 gap-4 overflow-y-auto p-5 sm:grid-cols-2"
```

to:

```tsx
      formClassName="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto p-5 sm:grid-cols-2"
```

`milestone-edit-modal.tsx:135` — change:

```tsx
      formClassName="flex flex-col gap-4 overflow-y-auto p-5"
```

to:

```tsx
      formClassName="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5"
```

- [ ] **Step 7: Run every consumer's suite**

Run: `npx vitest run src/app/absence-edit-modal src/app/calendar-event-modal src/app/milestone-edit-modal src/app/raid-edit-modal src/app/resource-edit-modal src/app/change-edit-modal src/app/stakeholder-edit-modal src/app/edit-modal-chrome`
Expected: PASS. If a test asserts an exact panel `className` string, update that assertion to the new string — do not revert the class.

- [ ] **Step 8: Typecheck and lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: exit 0 from both. A leftover unused import in a touched file is FATAL (`--max-warnings=0`).

- [ ] **Step 9: Commit**

```bash
git add src/app/edit-modal-chrome.tsx src/app/edit-modal-chrome.test.tsx src/app/absence-edit-modal.tsx src/app/calendar-event-modal.tsx src/app/milestone-edit-modal.tsx src/app/raid-edit-modal.tsx src/app/resource-edit-modal.tsx
git commit -m "fix(modals): give the shared edit-modal shell a real height axis"
```

---

## Task 2: budget-bucket-modal gets a default height

Its panel has `max-h-[95vh]` but no `h`/`min-h`, the same contract violation. Its content div at `:265` already carries `min-h-0 flex-1 overflow-y-auto`, so only the panel needs changing.

**Files:**
- Modify: `src/app/budget-bucket-modal.tsx:250`
- Test: `src/app/budget-bucket-modal.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `src/app/budget-bucket-modal.test.tsx`, inside the existing `describe("BudgetBucketModal", …)`. The file already defines a `setup(over?)` helper at line 90 that renders the modal inside the required `FiltersProvider`/`WorkspaceProvider` wrapper — use it:

```tsx
  test("the panel carries a default height and min-height, not just a max", () => {
    // Headline claim FIRST: useResizable needs a class-based default height or a
    // dragged height is dead space (same defect as the shared edit-modal shell).
    setup();
    const panel = document.querySelector("[data-modal-panel]") as HTMLElement;
    expect(panel.className).toContain("h-[640px]");
    expect(panel.className).toContain("min-h-[400px]");
    expect(panel.className).toContain("max-h-[95vh]");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/budget-bucket-modal.test.tsx -t "default height"`
Expected: FAIL — `expect(received).toContain("h-[640px]")` against a className holding only `max-h-[95vh]`.

- [ ] **Step 3: Add the classes**

`src/app/budget-bucket-modal.tsx:250` — change:

```tsx
        className="relative flex max-h-[95vh] w-[640px] min-w-[460px] max-w-[95vw] resize flex-col overflow-hidden rounded-xl border border-line bg-surface"
```

to:

```tsx
        className="relative flex h-[640px] min-h-[400px] max-h-[95vh] w-[640px] min-w-[460px] max-w-[95vw] resize flex-col overflow-hidden rounded-xl border border-line bg-surface"
```

- [ ] **Step 4: Run the test**

Run: `npx vitest run src/app/budget-bucket-modal.test.tsx`
Expected: PASS.

- [ ] **Step 5: Sweep for a third offender**

Run: `grep -rn "\bresize\b" src/app --include=*.tsx | grep -v "resize-none" | grep -v "\.test\."`

For each hit that is a modal/window panel (not a textarea or a column-resize handle), confirm the same `className` carries an `h-` or `min-h-` fragment. Known-compliant: `notes-window.tsx:229`, `help-menu.tsx:111`, `task-form-modal.tsx:115`, `jira-conflicts-modal.tsx:148`, `projects-panel.tsx:423`. If a genuinely new offender turns up, fix it the same way and note it in the commit body; otherwise state "no third offender" in the commit body.

- [ ] **Step 6: Typecheck, lint, commit**

Run: `npx tsc --noEmit && npm run lint`
Expected: exit 0.

```bash
git add src/app/budget-bucket-modal.tsx src/app/budget-bucket-modal.test.tsx
git commit -m "fix(budget): give the bucket modal a default height so a drag-resize is usable"
```

---

## Task 3: All new i18n keys, EN + DE

Front-loaded so the CRLF/umlaut patch happens once. `i18n.ts` (EN) and `i18n.de.ts` (DE) key sets must be **identical** — `tsc` enforces it.

★★ `i18n.de.ts` is **CRLF** and the Edit tool corrupts umlauts. Patch it via a node utf8 write whose newline is derived from the file, then grep-verify. `i18n.ts` is safe to Edit normally.

**Files:**
- Modify: `src/app/i18n.ts:356-359`
- Modify: `src/app/i18n.de.ts:360-363`

- [ ] **Step 1: Replace the EN theme-gallery keys**

In `src/app/i18n.ts`, replace lines 356-359:

```ts
  themeGalleryHeading: "Theme gallery",
  themeGalleryHint: "Import a shipped theme to customise or use as-is.",
  themeGalleryImport: "Import {0}",
  themeGalleryImportError: "Could not import that theme.",
```

with:

```ts
  themeGalleryHeading: "Theme gallery",
  themeGalleryHint: "Load a theme file to add it to your library, then apply or customise it.",
  themeGalleryImportError: "Could not import that theme.",
  themeGalleryLoadFile: "Load theme file…",
  themeGalleryEmpty: "No themes in your library yet.",
  themeGalleryApply: "Apply {0}",
  themeGalleryRemove: "Remove {0}",
  themeGalleryActive: "Active",
  settingsProjectHeading: "Project",
  settingsProjectNoProject: "No project is open.",
```

`themeGalleryImport` is deleted — its only two call sites go away in task 6, and nothing else references it (verified).

- [ ] **Step 2: Mirror in DE via a node script**

Write and run this script (it derives the newline from the file, per the documented CRLF trap):

```bash
node -e '
const fs = require("fs");
const p = "src/app/i18n.de.ts";
const s = fs.readFileSync(p, "utf8");
const nl = s.includes("\r\n") ? "\r\n" : "\n";
const oldLines = [
  "  themeGalleryHint: \"Ein mitgeliefertes Design importieren, um es anzupassen oder direkt zu verwenden.\",",
  "  themeGalleryImport: \"{0} importieren\",",
  "  themeGalleryImportError: \"Dieses Design konnte nicht importiert werden.\",",
];
const newLines = [
  "  themeGalleryHint: \"Designdatei laden, um sie zur Bibliothek hinzuzufügen, anzuwenden oder anzupassen.\",",
  "  themeGalleryImportError: \"Dieses Design konnte nicht importiert werden.\",",
  "  themeGalleryLoadFile: \"Designdatei laden…\",",
  "  themeGalleryEmpty: \"Noch keine Designs in der Bibliothek.\",",
  "  themeGalleryApply: \"{0} anwenden\",",
  "  themeGalleryRemove: \"{0} entfernen\",",
  "  themeGalleryActive: \"Aktiv\",",
  "  settingsProjectHeading: \"Projekt\",",
  "  settingsProjectNoProject: \"Kein Projekt geöffnet.\",",
];
const oldBlock = oldLines.join(nl);
if (!s.includes(oldBlock)) { console.error("ANCHOR MISSING"); process.exit(1); }
fs.writeFileSync(p, s.replace(oldBlock, newLines.join(nl)), "utf8");
console.log("patched");
'
```

Expected output: `patched`. If it prints `ANCHOR MISSING`, re-read lines 360-363 and rebuild the anchor array — do **not** switch to the Edit tool.

- [ ] **Step 3: Grep-verify the umlauts survived**

Run: `grep -n "hinzuzufügen\|geöffnet" src/app/i18n.de.ts`
Expected: two hits, with real `ü` and `ö` — not `ue`/`oe`, not mojibake. The `i18n-encoding` test bans ASCII substitutions.

- [ ] **Step 4: Verify key parity + encoding**

Run: `npx tsc --noEmit && npx vitest run src/app/i18n`
Expected: exit 0; the i18n suite passes. A tsc error naming a missing key means one dictionary drifted.

- [ ] **Step 5: Commit**

```bash
git add src/app/i18n.ts src/app/i18n.de.ts
git commit -m "i18n: add the slice E theme-library and project-block strings"
```

---

## Task 4: The shared `importSchemeText` routine

Today the **gallery** import is complete (`addScheme` + `updateScheme({supportsDark, dark, structural})` + name-dedup + `upsertSchemeAsync`) while the **editor** import at `color-scheme-editor.tsx:145` is lossy — `addScheme(name, light, branding)` alone, silently degrading a full portable theme to light-only. This task extracts the complete behaviour once so both call sites share it.

**Files:**
- Create: `src/app/scheme-import.ts`
- Test: `src/app/scheme-import.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/app/scheme-import.test.ts`:

```ts
import { beforeEach, describe, expect, test, vi } from "vitest";
import { importSchemeText } from "./scheme-import";
import { loadSchemes, addScheme } from "./color-schemes";

vi.mock("./color-schemes-store", () => ({
  upsertSchemeAsync: vi.fn(async () => {}),
}));
import { upsertSchemeAsync } from "./color-schemes-store";

const FULL_THEME = JSON.stringify({
  name: "Portable",
  supportsDark: true,
  light: { "--ui-dark-blue": "#004159", "--surface": "#ffffff" },
  dark: { "--ui-dark-blue": "#8fd3ea", "--surface": "#121619" },
  structural: { "--shadow-card": "none" },
  branding: {},
});

beforeEach(() => {
  window.localStorage.clear();
  vi.clearAllMocks();
});

describe("importSchemeText", () => {
  test("carries dark, supportsDark AND structural onto the created scheme", async () => {
    // Headline claim FIRST — this is the exact degradation the editor shipped.
    const id = await importSchemeText(FULL_THEME, null);
    expect(id).not.toBeNull();
    const created = loadSchemes().schemes.find((s) => s.id === id);
    expect(created?.supportsDark).toBe(true);
    expect(created?.dark?.["--surface"]).toBe("#121619");
    expect(created?.structural?.["--shadow-card"]).toBe("none");
  });

  test("a second import of the same name activates the existing scheme instead of duplicating", async () => {
    const first = await importSchemeText(FULL_THEME, null);
    const second = await importSchemeText(FULL_THEME, null);
    expect(second).toBe(first);
    expect(loadSchemes().schemes.filter((s) => s.name === "Portable")).toHaveLength(1);
  });

  test("malformed JSON returns null and writes nothing", async () => {
    const before = loadSchemes().schemes.length;
    expect(await importSchemeText("{ not json", null)).toBeNull();
    expect(loadSchemes().schemes).toHaveLength(before);
  });

  test("a light-only theme imports without a dark map", async () => {
    const id = await importSchemeText(
      JSON.stringify({ name: "LightOnly", supportsDark: false, light: { "--surface": "#ffffff" }, branding: {} }),
      null,
    );
    const created = loadSchemes().schemes.find((s) => s.id === id);
    expect(created?.supportsDark).toBe(false);
    expect(created?.dark).toBeUndefined();
  });

  test("passes the created scheme to the Turso upsert", async () => {
    const cfg = { httpUrl: "https://db.example", authToken: "tok" } as never;
    const id = await importSchemeText(FULL_THEME, cfg);
    expect(upsertSchemeAsync).toHaveBeenCalledWith(cfg, expect.objectContaining({ id }));
  });

  test("dedup also re-upserts, so a file-mode import survives a later Turso connect", async () => {
    await importSchemeText(FULL_THEME, null);
    vi.clearAllMocks();
    const cfg = { httpUrl: "https://db.example", authToken: "tok" } as never;
    await importSchemeText(FULL_THEME, cfg);
    expect(upsertSchemeAsync).toHaveBeenCalledTimes(1);
  });

  test("a scheme created in the editor is not treated as a duplicate of a different name", async () => {
    addScheme("Handmade", { "--surface": "#ffffff" }, {});
    const id = await importSchemeText(FULL_THEME, null);
    expect(loadSchemes().schemes).toHaveLength(2);
    expect(id).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/app/scheme-import.test.ts`
Expected: FAIL — `Failed to resolve import "./scheme-import"`.

- [ ] **Step 3: Write the implementation**

Create `src/app/scheme-import.ts`:

```ts
// The single import routine for a portable theme JSON, shared by the theme
// gallery's file picker and the scheme editor's file picker.
//
// It exists because those two diverged: the gallery carried dark + structural
// onto the created scheme while the editor called addScheme alone, silently
// degrading a full portable theme (light + dark + structural) to light-only.
// One routine, so they cannot drift again — and dup:check is blocking, so the
// second call site could not have copied it anyway.
import { importScheme, addScheme, updateScheme, loadSchemes, type ColorScheme } from "./color-schemes";
import { upsertSchemeAsync } from "./color-schemes-store";
import type { TursoConfig } from "./turso-config";

/**
 * Parse `text` as a portable theme and add it to the user library.
 *
 * Returns the id of the scheme to activate, or `null` when the text is not a
 * valid theme. Never throws.
 *
 * Name-dedup: re-importing a theme whose name already exists in the library
 * activates the existing scheme rather than creating a second identical copy.
 * The existing scheme is still upserted, which covers a file-mode import later
 * reopened with Turso configured.
 */
export async function importSchemeText(
  text: string,
  config: TursoConfig | null,
): Promise<string | null> {
  const parsed = importScheme(text);
  if (!parsed) return null;

  const existing = loadSchemes().schemes.find((s) => !s.builtIn && s.name === parsed.name);
  if (existing) {
    await upsertSchemeAsync(config, existing);
    return existing.id;
  }

  let store = addScheme(parsed.name, parsed.light, parsed.branding);
  const newId = store.activeId;
  if (!newId) return null;

  // addScheme creates a COLOR-ONLY scheme — carry over the rest of the portable
  // format. Dropping this is the exact bug this module was extracted to kill.
  if (parsed.supportsDark || parsed.dark || parsed.structural) {
    store = updateScheme(newId, {
      supportsDark: parsed.supportsDark,
      dark: parsed.dark,
      structural: parsed.structural,
    });
  }

  const created: ColorScheme | undefined = store.schemes.find((s) => s.id === newId);
  if (created) await upsertSchemeAsync(config, created);
  return newId;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/app/scheme-import.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Mutation-check the headline claim**

Temporarily delete the whole `if (parsed.supportsDark || parsed.dark || parsed.structural) { … }` block, then run the suite again.
Expected: the **first** test fails, reporting `expected undefined to be "#121619"` (or `expected false to be true`) — i.e. the assertion the test is named for. If a different test fails first, the first test is not proving its claim. Restore the block with `git checkout src/app/scheme-import.ts` **only because this file is committed in the next step and nothing else in the tree is uncommitted** — if you have uncommitted work elsewhere in this file, use a file copy instead (`cp` before, `cp` back).

- [ ] **Step 6: Typecheck, lint, commit**

Run: `npx tsc --noEmit && npm run lint`
Expected: exit 0.

```bash
git add src/app/scheme-import.ts src/app/scheme-import.test.ts
git commit -m "feat(themes): extract one complete theme-import routine"
```

---

## Task 5: The editor's file picker stops losing dark + structural

**Files:**
- Modify: `src/app/color-scheme-editor.tsx:145-163`
- Test: `src/app/color-scheme-editor.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `src/app/color-scheme-editor.test.tsx`. The file renders the component inline as `render(<ColorSchemeEditor lang="en-US" onApply={vi.fn()} />)` — match that. If it already mocks `./color-schemes-store`, reuse that mock rather than adding a second; add `userEvent`, `waitFor` and `loadSchemes` to its imports if missing.

```tsx
  test("importing a full portable theme keeps dark and structural", async () => {
    // Headline claim FIRST: the editor's picker used to call addScheme alone,
    // silently degrading a light+dark+structural theme to light-only.
    const user = userEvent.setup();
    render(<ColorSchemeEditor lang="en-US" onApply={vi.fn()} />);
    const file = new File(
      [JSON.stringify({
        name: "Portable",
        supportsDark: true,
        light: { "--surface": "#ffffff" },
        dark: { "--surface": "#121619" },
        structural: { "--shadow-card": "none" },
        branding: {},
      })],
      "portable.json",
      { type: "application/json" },
    );
    await user.upload(screen.getByLabelText(/import/i), file);

    await waitFor(() => {
      const s = loadSchemes().schemes.find((x) => x.name === "Portable");
      expect(s?.dark?.["--surface"]).toBe("#121619");
      expect(s?.structural?.["--shadow-card"]).toBe("none");
      expect(s?.supportsDark).toBe(true);
    });
  });
```

If `getByLabelText(/import/i)` does not resolve (the `<input>` is `sr-only` inside a `<label>` whose text is `schemeImport`), select it with `document.querySelector('input[type="file"]') as HTMLInputElement` and upload to that instead.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/color-scheme-editor.test.tsx -t "portable theme"`
Expected: FAIL — `expected undefined to be "#121619"`.

- [ ] **Step 3: Route through the shared routine**

In `src/app/color-scheme-editor.tsx`, add to the imports:

```ts
import { importSchemeText } from "./scheme-import";
```

Replace the whole `onImportFile` function (lines 145-163) with:

```tsx
  function onImportFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      // The complete import (dark + structural + dedup + DB upsert) lives in
      // scheme-import.ts, shared with the theme gallery's picker.
      void importSchemeText(String(reader.result), config).then((newId) => {
        if (!newId) { setImportError(t(lang, "schemeImportError")); return; }
        setImportError(null);
        const next = loadSchemes();
        const s = next.schemes.find((x) => x.id === newId);
        if (!s) return;
        persist(next);
        const full = { ...HARBOR_LIGHT, ...s.light };
        setName(s.name); setColors(full); setBranding(s.branding);
        applyResolved(full, s.branding); // importing applies the imported scheme
        onSchemeChange?.();
      });
    };
    reader.readAsText(file);
  }
```

- [ ] **Step 4: Remove imports that are now unused**

`addScheme` and `importScheme` may no longer be referenced in this file. Check:

Run: `grep -n "addScheme\|importScheme\b\|upsertSchemeAsync" src/app/color-scheme-editor.tsx`

Remove from the import statement any name with **no** remaining use. `--max-warnings=0` makes an unused import FATAL. `dbUpsert` still uses `upsertSchemeAsync`, and `saveNew` still uses `addScheme` — confirm before deleting either.

- [ ] **Step 5: Run the test**

Run: `npx vitest run src/app/color-scheme-editor.test.tsx`
Expected: PASS, including the pre-existing tests.

- [ ] **Step 6: Typecheck, lint, commit**

Run: `npx tsc --noEmit && npm run lint`
Expected: exit 0.

```bash
git add src/app/color-scheme-editor.tsx src/app/color-scheme-editor.test.tsx
git commit -m "fix(themes): the editor's file import no longer drops dark + structural"
```

---

## Task 6: The gallery becomes a file-only theme library

`SHIPPED` and the `fetch` path go. The gallery renders a **"Load theme file…"** picker plus a **card list of every user scheme** (name · Active marker · Apply · Remove). Built-ins stay out — they are undeletable and already offered by the `<Select>` above.

★★ Apply and Remove appear once per row. The axe gate sees **missing** accessible names, never **duplicate** ones, so every row control takes the scheme name: `Apply {0}` / `Remove {0}`.

**Files:**
- Modify: `src/app/theme-gallery.tsx` (full rewrite)
- Modify: `src/app/settings-sections/appearance-section.tsx:103`
- Test: `src/app/theme-gallery.test.tsx` (full rewrite)

- [ ] **Step 1: Write the failing tests**

Replace the contents of `src/app/theme-gallery.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { ThemeGallery } from "./theme-gallery";
import { addScheme, loadSchemes } from "./color-schemes";

vi.mock("./color-schemes-store", () => ({
  upsertSchemeAsync: vi.fn(async () => {}),
  deleteSchemeAsync: vi.fn(async () => {}),
}));

const FULL_THEME = JSON.stringify({
  name: "Portable",
  supportsDark: true,
  light: { "--surface": "#ffffff" },
  dark: { "--surface": "#121619" },
  structural: { "--shadow-card": "none" },
  branding: {},
});

function renderGallery(over: Partial<React.ComponentProps<typeof ThemeGallery>> = {}) {
  const props = {
    lang: "en-US" as const,
    schemes: loadSchemes().schemes,
    activeId: loadSchemes().activeId,
    onImported: vi.fn(),
    onApply: vi.fn(),
    onRemove: vi.fn(),
    ...over,
  };
  render(<ThemeGallery {...props} />);
  return props;
}

beforeEach(() => {
  window.localStorage.clear();
  vi.clearAllMocks();
});

describe("ThemeGallery", () => {
  test("loading a theme file imports it and reports the new id", async () => {
    const user = userEvent.setup();
    const props = renderGallery();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, new File([FULL_THEME], "portable.json", { type: "application/json" }));
    await waitFor(() => expect(props.onImported).toHaveBeenCalledTimes(1));
    const created = loadSchemes().schemes.find((s) => s.name === "Portable");
    expect(created?.dark?.["--surface"]).toBe("#121619");
    expect(created?.structural?.["--shadow-card"]).toBe("none");
  });

  test("lists user schemes and excludes built-ins", () => {
    renderGallery({
      schemes: [
        { id: "harbor", name: "Harbor", builtIn: true, supportsDark: true, light: {}, branding: {} },
        { id: "u-1", name: "Mine", supportsDark: false, light: {}, branding: {} },
      ],
      activeId: "harbor",
    });
    expect(screen.getByText("Mine")).toBeInTheDocument();
    expect(screen.queryByText("Harbor")).not.toBeInTheDocument();
  });

  test("row controls carry the scheme NAME so two rows never share an accessible name", () => {
    renderGallery({
      schemes: [
        { id: "u-1", name: "Alpha", supportsDark: false, light: {}, branding: {} },
        { id: "u-2", name: "Beta", supportsDark: false, light: {}, branding: {} },
      ],
      activeId: null,
    });
    // Headline claim FIRST: axe cannot see duplicate names, only missing ones.
    expect(screen.getByRole("button", { name: "Apply Alpha" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply Beta" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove Alpha" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove Beta" })).toBeInTheDocument();
  });

  test("Apply and Remove call their handlers with the row's id", async () => {
    const user = userEvent.setup();
    const props = renderGallery({
      schemes: [{ id: "u-1", name: "Alpha", supportsDark: false, light: {}, branding: {} }],
      activeId: null,
    });
    await user.click(screen.getByRole("button", { name: "Apply Alpha" }));
    expect(props.onApply).toHaveBeenCalledWith("u-1");
    await user.click(screen.getByRole("button", { name: "Remove Alpha" }));
    expect(props.onRemove).toHaveBeenCalledWith("u-1");
  });

  test("the active scheme is marked and cannot be applied again", () => {
    renderGallery({
      schemes: [{ id: "u-1", name: "Alpha", supportsDark: false, light: {}, branding: {} }],
      activeId: "u-1",
    });
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply Alpha" })).toBeDisabled();
  });

  test("an empty library shows the empty message, not a bare list", () => {
    renderGallery({ schemes: [], activeId: null });
    expect(screen.getByText("No themes in your library yet.")).toBeInTheDocument();
  });

  test("a malformed file surfaces the import error and imports nothing", async () => {
    const user = userEvent.setup();
    const props = renderGallery();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, new File(["{ not json"], "bad.json", { type: "application/json" }));
    await waitFor(() => expect(screen.getByText("Could not import that theme.")).toBeInTheDocument());
    expect(props.onImported).not.toHaveBeenCalled();
  });

  test("a scheme already in the library is not duplicated by a re-import", async () => {
    addScheme("Portable", { "--surface": "#ffffff" }, {});
    const user = userEvent.setup();
    renderGallery();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, new File([FULL_THEME], "portable.json", { type: "application/json" }));
    await waitFor(() => expect(loadSchemes().schemes.filter((s) => s.name === "Portable")).toHaveLength(1));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/app/theme-gallery.test.tsx`
Expected: FAIL — the props `schemes`/`activeId`/`onApply`/`onRemove` do not exist, and there is no file input.

- [ ] **Step 3: Rewrite the gallery**

Replace the contents of `src/app/theme-gallery.tsx`:

```tsx
"use client";

// Theme library: load a portable theme JSON from disk, then apply, customise or
// remove it. AIPM and Dashboard no longer ship with the app in any form — a theme
// is whatever file the user supplies, so this surface is a file picker plus the
// list of what has been loaded.
//
// Presentational apart from the import itself: the scheme list, the active id
// and the apply/remove handlers are props, owned by AppearanceSection (which
// already holds useColorSchemes).

import { useRef, useState, type ChangeEvent } from "react";
import { type Lang, t } from "./i18n";
import type { ColorScheme } from "./color-schemes";
import { importSchemeText } from "./scheme-import";
import type { TursoConfig } from "./turso-config";
import { Button } from "./button";
import { FieldError } from "./field-feedback";

interface ThemeGalleryProps {
  lang: Lang;
  /** The full scheme store list; built-ins are filtered out here. */
  schemes: readonly ColorScheme[];
  activeId: string | null;
  /** Turso config → persist the imported scheme to the cross-device DB too (else
   *  the localStorage sync-cache only). Optional (defaults null) for file mode +
   *  tests. */
  config?: TursoConfig | null;
  /** Called with the scheme id after a successful import (parent applies it). */
  onImported: (newId: string) => void;
  onApply: (id: string) => void;
  onRemove: (id: string) => void;
}

export function ThemeGallery({
  lang, schemes, activeId, config = null, onImported, onApply, onRemove,
}: ThemeGalleryProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const userSchemes = schemes.filter((s) => !s.builtIn);

  function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    setError(null);
    const reader = new FileReader();
    reader.onload = () => {
      void importSchemeText(String(reader.result), config)
        .then((newId) => {
          if (!newId) { setError(t(lang, "themeGalleryImportError")); return; }
          onImported(newId);
        })
        .finally(() => setBusy(false));
    };
    reader.onerror = () => { setError(t(lang, "themeGalleryImportError")); setBusy(false); };
    reader.readAsText(file);
  }

  return (
    <div className="mt-3 flex flex-col gap-2">
      <p className="text-sm font-medium text-foreground">{t(lang, "themeGalleryHeading")}</p>
      <p className="text-xs text-muted-foreground">{t(lang, "themeGalleryHint")}</p>

      <div>
        <Button
          variant="secondary"
          size="sm"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          {t(lang, "themeGalleryLoadFile")}
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept="application/json,.json"
          className="sr-only"
          aria-label={t(lang, "themeGalleryLoadFile")}
          onChange={onFile}
        />
      </div>

      {userSchemes.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t(lang, "themeGalleryEmpty")}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {userSchemes.map((s) => (
            <li
              key={s.id}
              className="flex items-center justify-between gap-2 rounded-md border border-line px-3 py-2"
            >
              <span className="min-w-0 flex-1 truncate text-sm text-foreground">{s.name}</span>
              {s.id === activeId && (
                <span className="text-xs text-muted-foreground">{t(lang, "themeGalleryActive")}</span>
              )}
              {/* Row controls carry the scheme NAME: N rows with an identical
                  "Apply" would be a WCAG 2.4.6 fail that the axe gate cannot
                  see (it reports missing names, never duplicate ones). */}
              <Button
                variant="ghost"
                size="xs"
                disabled={s.id === activeId}
                aria-label={t(lang, "themeGalleryApply", s.name)}
                onClick={() => onApply(s.id)}
              >
                {t(lang, "themeGalleryApply", s.name)}
              </Button>
              <Button
                variant="ghost"
                size="xs"
                aria-label={t(lang, "themeGalleryRemove", s.name)}
                onClick={() => onRemove(s.id)}
              >
                {t(lang, "themeGalleryRemove", s.name)}
              </Button>
            </li>
          ))}
        </ul>
      )}

      <FieldError>{error}</FieldError>
    </div>
  );
}
```

- [ ] **Step 4: Run the gallery tests**

Run: `npx vitest run src/app/theme-gallery.test.tsx`
Expected: PASS (8 tests).

- [ ] **Step 5: Wire the new props in AppearanceSection**

In `src/app/settings-sections/appearance-section.tsx`, add to the imports:

```ts
import { removeScheme } from "../color-schemes";
import { deleteSchemeAsync } from "../color-schemes-store";
```

(`mergeAppliedBranding` is already imported from `../color-schemes` — extend that statement rather than adding a second import of the same module, which `lint` flags.)

Replace line 103:

```tsx
        <ThemeGallery lang={lang} config={config} onImported={(id) => selectScheme(id)} />
```

with:

```tsx
        <ThemeGallery
          lang={lang}
          config={config}
          schemes={store.schemes}
          activeId={store.activeId}
          onImported={(id) => { refresh(); selectScheme(id); }}
          onApply={(id) => selectScheme(id)}
          onRemove={(id) => {
            removeScheme(id);
            void deleteSchemeAsync(config, id);
            refresh();
            window.dispatchEvent(new Event("aipm-cockpit-scheme-change"));
          }}
        />
```

- [ ] **Step 6: Run the appearance suite**

Run: `npx vitest run src/app/settings-sections/appearance-section.test.tsx`
Expected: PASS. If a test asserted an "Import AIPM"/"Import Dashboard" button, replace that assertion with the "Load theme file…" button — those buttons are gone by design.

- [ ] **Step 7: Typecheck, lint, commit**

Run: `npx tsc --noEmit && npm run lint`
Expected: exit 0.

```bash
git add src/app/theme-gallery.tsx src/app/theme-gallery.test.tsx src/app/settings-sections/appearance-section.tsx
git commit -m "feat(themes): the gallery becomes a file-loaded theme library"
```

---

## Task 7: Delete the shipped theme files and rebuild the axe matrix

Nothing about AIPM or Dashboard stays in the app. Four places read `public/themes/*.json` from the repo and all four change here.

★ The rebuilt matrix keeps the **same 85 checks** (5 schemes × 16 views + 5 Kanban variants) and scans three distinct palettes where the old one scanned two.

**Files:**
- Delete: `public/themes/AIPM.json`, `public/themes/mockup.json`, `src/app/shipped-themes.test.ts`
- Modify: `src/app/scheme-contrast-cues.test.ts:69-80`, `src/app/scheme-purple-hover.test.ts:132-145`
- Modify: `e2e/a11y.spec.ts:1-104`
- Modify: `src/app/builtin-schemes.ts:5`, `src/app/style-tokens.test.ts:14` (stale comments)

- [ ] **Step 1: Rebuild the axe matrix**

In `e2e/a11y.spec.ts`, delete the `readFileSync` import, the `SchemeStructuralMap`/`SchemeColorMap` type import if it becomes unused, the `loadTheme` helper and the `ICC_THEME`/`MOCKUP_THEME` consts (lines 3-16), and replace the header block with:

```ts
import AxeBuilder from "@axe-core/playwright";
import { test, expect, gotoApp, openView, waitForViewSettled } from "./seed";
import {
  HARBOR_DARK, HARBOR_LIGHT,
  MERIDIAN_DARK, MERIDIAN_LIGHT,
  UMBER_DARK, UMBER_LIGHT,
} from "../src/app/builtin-schemes";
import { resolveSchemeColors } from "../src/app/scheme-tokens";
import type { SchemeColorMap } from "../src/app/scheme-apply";
```

Replace the `COMBOS` const and its comment with:

```ts
// AIPM and Dashboard no longer exist in the app in any form — a theme is a file
// the user loads. The matrix therefore runs on the three BUILT-IN schemes, which
// keeps the check count identical (5 × 16 views + 5 Kanban = 85) while scanning
// three distinct palettes instead of two. All three are dark-capable; Umber runs
// light-only to hold the count at five.
const COMBOS = [
  { scheme: "harbor",   dark: false },
  { scheme: "harbor",   dark: true  },
  { scheme: "meridian", dark: false },
  { scheme: "meridian", dark: true  },
  { scheme: "umber",    dark: false },
] as const;
```

Replace the `SCHEME_SEED` const and its comment with:

```ts
// Per-scheme maps, resolved node-side at seed time (mirrors how the app persists
// them). Built-ins carry no structural map.
const SCHEME_SEED: Record<
  (typeof COMBOS)[number]["scheme"],
  { light: SchemeColorMap; dark?: SchemeColorMap }
> = {
  harbor:   { light: HARBOR_LIGHT,   dark: HARBOR_DARK },
  meridian: { light: MERIDIAN_LIGHT, dark: MERIDIAN_DARK },
  umber:    { light: UMBER_LIGHT,    dark: UMBER_DARK },
};
```

★ `UMBER_DARK` is imported even though no combo selects it — `SCHEME_SEED` is typed over all three schemes, so omitting Umber's dark map would be a type error.

Replace the whole `seedScript` body from `const spec = …` to the `return [...]` with:

```ts
  const spec = SCHEME_SEED[combo.scheme];
  const useDark = combo.dark && !!spec.dark;
  const map = resolveSchemeColors(useDark && spec.dark ? spec.dark : spec.light);
  // Every combo is a BUILT-IN now, so an empty schemes[] plus the activeId is
  // enough — reconcileBuiltins injects the scheme. Seeding aipm-cockpit:color-schemes
  // is still essential: post-mount, use-style.syncScheme re-resolves from it and
  // would otherwise overwrite the boot paint (scheme landmine 4).
  const store = { schemes: [], activeId: combo.scheme };
  return [
    `localStorage.setItem("aipm-cockpit-style", "custom");`,
    `localStorage.setItem("aipm-cockpit-theme", ${JSON.stringify(combo.dark ? "dark" : "light")});`,
    `localStorage.setItem("aipm-cockpit-scheme-supports-dark", "1");`,
    `localStorage.setItem("aipm-cockpit-active-scheme-colors", ${JSON.stringify(JSON.stringify(map))});`,
    `localStorage.setItem("aipm-cockpit-active-scheme-structural", ${JSON.stringify(JSON.stringify({}))});`,
    `localStorage.setItem("aipm-cockpit:color-schemes", ${JSON.stringify(JSON.stringify(store))});`,
  ].join("\n");
```

- [ ] **Step 2: Verify the spec still lists 80 view tests**

Run: `npx playwright test e2e/a11y.spec.ts --list | wc -l`
Expected: **80** listed tests (5 combos × 16 views). This also proves the file's module-level code executes without the deleted JSON — a `--list` run triggers every top-level `readFileSync`, so a missed one ENOENTs here rather than only in CI.

- [ ] **Step 3: Strip the shipped-theme arm from `scheme-contrast-cues.test.ts`**

Delete lines 67-80 — the comment block plus the whole `for (const file of ["AIPM", "mockup"]) { … }` loop.

Then delete line 22, `import { readFileSync } from "node:fs";` — it has no remaining use in this file and `--max-warnings=0` makes an unused import FATAL.

Run: `grep -n "readFileSync" src/app/scheme-contrast-cues.test.ts`
Expected: no output.

- [ ] **Step 4: Strip the shipped-theme arm from `scheme-purple-hover.test.ts`**

Delete lines 131-145 — the comment block plus the `for (const file of ["AIPM", "mockup"]) { … }` loop.

★ **Keep** the `readFileSync` import here — line 116 still reads `src/app/globals.css`.

Run: `grep -n "readFileSync" src/app/scheme-purple-hover.test.ts`
Expected: two hits (the import and the `globals.css` read).

- [ ] **Step 5: Delete the files**

```bash
git rm public/themes/AIPM.json public/themes/mockup.json src/app/shipped-themes.test.ts
```

- [ ] **Step 6: Fix the stale comments**

`src/app/builtin-schemes.ts:5` — replace the phrase `ship as importable theme files (public/themes/*.json)` with `ship as importable theme files the user supplies (Settings → Appearance → Theme gallery)`.

`src/app/style-tokens.test.ts:14` — apply the same replacement to its `(public/themes/*.json)` mention.

Run: `grep -rn "public/themes" src/ e2e/ scripts/`
Expected: no output. Any remaining hit is a reference to a file that no longer exists.

- [ ] **Step 7: Run the full unit suite**

Run: `npm run test:run`
Expected: PASS. ★ A suspiciously LOW file count means workers crashed, not that tests were skipped — re-run before concluding.

- [ ] **Step 8: Run the rebuilt axe matrix on a FRESH server**

```bash
PORT=3100 npx playwright test e2e/a11y.spec.ts --project=chromium -g "Settings"
```

Expected: 5 passed. ★★ A **cold** dev server has failed this gate wholesale before — if the first run fails, re-run it before debugging anything. Stop the server afterwards with `PORT=3100 npm run stop`.

- [ ] **Step 9: Typecheck, lint, commit**

Run: `npx tsc --noEmit && npm run lint`
Expected: exit 0.

```bash
git add -A public/themes src/app e2e
git commit -m "refactor(themes): remove the shipped AIPM/Dashboard theme files"
```

---

## Task 8: Extract the shared project-edit modal

`projects-panel.tsx:411-457` hosts **one** `Modal` whose body is a create/edit ternary. Settings needs the edit half. Extracting a shell used by both branches keeps the DOM identical and gives Settings a one-line mount — and `dup:check` is blocking, so copying the host into `general-section.tsx` is not an option.

This task is a **pure refactor**: no user-visible change.

**Files:**
- Create: `src/app/project-edit-modal.tsx`, `src/app/project-edit-modal.test.tsx`
- Modify: `src/app/projects-panel.tsx:410-457`

- [ ] **Step 1: Write the failing test**

Create `src/app/project-edit-modal.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import { ProjectEditModal, ProjectModalShell } from "./project-edit-modal";
import type { ProjectMeta } from "./types";

const META = {
  name: "Apollo",
  code: "APL",
  projectManager: "",
  keyStakeholdersInternal: [],
  keyStakeholdersExternal: [],
  customer: "",
  naceSection: "",
  identityTypes: [],
  products: "",
  deployment: "",
  startDate: "2026-01-01",
  endDate: "2026-12-31",
  profitCenter: "",
  contactPersons: [],
  regulatory: [],
} as unknown as ProjectMeta;

describe("ProjectModalShell", () => {
  test("renders its title and children inside a resizable modal panel", () => {
    render(
      <ProjectModalShell lang="en-US" title="Shell title" sizeKey="test:pm" onClose={vi.fn()}>
        <p>shell body</p>
      </ProjectModalShell>,
    );
    expect(screen.getByText("shell body")).toBeInTheDocument();
    const panel = document.querySelector("[data-modal-panel]") as HTMLElement;
    expect(panel.className).toContain("resize");
    expect(panel.className).toContain("min-h-[420px]");
  });
});

describe("ProjectEditModal", () => {
  test("prefills from the given meta and submits a sanitized meta", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <ProjectEditModal
        lang="en-US"
        initial={META}
        stakeholderNames={[]}
        addressBook={[]}
        resources={[]}
        sizeKey="test:pem"
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByDisplayValue("Apollo")).toBeInTheDocument();
    // Headline claim: the WRITE direction reaches the caller.
    await user.click(screen.getByRole("button", { name: /edit project/i }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ name: "Apollo", code: "APL" });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/app/project-edit-modal.test.tsx`
Expected: FAIL — `Failed to resolve import "./project-edit-modal"`.

- [ ] **Step 3: Write the module**

Create `src/app/project-edit-modal.tsx`:

```tsx
"use client";

// The project modal host, shared by the Projects panel (create + edit) and the
// Settings → General project block (edit). Extracted so Settings does not have
// to copy the Modal + panel + header + scroller block — dup:check is blocking,
// and two copies would drift on chrome, sizing and dismissal behaviour.
//
// Presentational: every value and handler is a prop.

import type { ReactNode } from "react";
import { type Contact } from "./contacts";
import { t, type Lang } from "./i18n";
import { Modal } from "./modal";
import { ModalHeader } from "./modal-header";
import { ProjectForm } from "./project-form";
import { ResetSizeButton } from "./task-manager-ui";
import { useResizable } from "./use-resizable";
import { type ProjectMeta, type Resource } from "./types";

interface ProjectModalShellProps {
  lang: Lang;
  title: string;
  /** localStorage key for the persisted panel size (see `useResizable`). */
  sizeKey: string;
  onClose: () => void;
  children: ReactNode;
}

export function ProjectModalShell({ lang, title, sizeKey, onClose, children }: ProjectModalShellProps) {
  const { ref: sizeRef, reset: resetSize } = useResizable(sizeKey);
  return (
    <Modal
      open
      onClose={onClose}
      ariaLabel={title}
      align="center"
      backdropClassName="bg-ui-dark-blue/40"
      zIndex={50}
    >
      <div
        ref={sizeRef}
        data-modal-panel
        className="relative flex max-h-[90vh] min-h-[420px] w-[960px] min-w-[360px] max-w-[95vw] resize flex-col overflow-hidden rounded-xl border border-line bg-surface"
      >
        <ModalHeader
          lang={lang}
          title={title}
          onClose={onClose}
          headerExtra={<ResetSizeButton onClick={resetSize} lang={lang} />}
        />
        <div className="min-h-0 flex-1 overflow-y-auto p-6">{children}</div>
      </div>
    </Modal>
  );
}

interface ProjectEditModalProps {
  lang: Lang;
  /** The project being edited (prefills the form). */
  initial: ProjectMeta;
  /** Suggestions for the key-stakeholder inputs. */
  stakeholderNames: readonly string[];
  /** Address book for the contact picker. */
  addressBook: readonly Contact[];
  /** Registry resources for the link-only contact-person picker. */
  resources: readonly Resource[];
  sizeKey: string;
  onSubmit: (meta: ProjectMeta) => void;
  onCancel: () => void;
}

/** The shell wrapped around a prefilled `ProjectForm` — the edit flow, mounted
 *  from both the Projects panel and Settings → General. */
export function ProjectEditModal({
  lang, initial, stakeholderNames, addressBook, resources, sizeKey, onSubmit, onCancel,
}: ProjectEditModalProps) {
  return (
    <ProjectModalShell lang={lang} title={t(lang, "projectsEdit")} sizeKey={sizeKey} onClose={onCancel}>
      <ProjectForm
        initial={initial}
        stakeholderNames={[...stakeholderNames]}
        addressBook={[...addressBook]}
        resources={resources}
        lang={lang}
        onSubmit={onSubmit}
        onCancel={onCancel}
      />
    </ProjectModalShell>
  );
}
```

★ `stakeholderNames`/`addressBook` are spread into fresh arrays because `ProjectForm` types them as mutable `string[]` / `Contact[]` while this component accepts `readonly`. If `ProjectForm`'s props are already `readonly`, drop the spreads.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/app/project-edit-modal.test.tsx`
Expected: PASS (2 tests). If the submit button's name is not `/edit project/i`, read the label `ProjectForm` renders (its `submitLabel` defaults to the `projectsEdit` string in edit mode) and use that.

- [ ] **Step 5: Rewire projects-panel onto the shared components**

In `src/app/projects-panel.tsx`, replace the whole block at lines 410-457 (from the `{/* Create / edit modal … */}` comment through the closing `)}`) with:

```tsx
      {/* Create / edit modal ------------------------------------------- */}
      {modal.mode === "create" && (
        <ProjectModalShell
          lang={lang}
          title={t(lang, "projectsNew")}
          sizeKey="aipm-cockpit:create-modal-size"
          onClose={closeModal}
        >
          <CreateProjectWizard
            lang={lang}
            stakeholderNames={stakeholderNames}
            addressBook={addressBook}
            resources={resources}
            settings={settings}
            onChangeSettings={onChangeSettings}
            onCreate={handleCreate}
            onCancel={closeModal}
            hideFormat={isTurso}
          />
        </ProjectModalShell>
      )}
      {modal.mode === "edit" && currentProject && (
        <ProjectEditModal
          lang={lang}
          initial={currentProject}
          stakeholderNames={stakeholderNames}
          addressBook={addressBook}
          resources={resources}
          sizeKey="aipm-cockpit:create-modal-size"
          onSubmit={handleEditSubmit}
          onCancel={closeModal}
        />
      )}
```

★ The `sizeKey` stays `aipm-cockpit:create-modal-size` in **both** branches — that is the key this panel already uses, and changing it would silently discard every existing user's dragged size.

Update the imports: add

```ts
import { ProjectEditModal, ProjectModalShell } from "./project-edit-modal";
```

and remove `Modal`, `ModalHeader` and `ProjectForm` **only if** nothing else in the file still uses them.

Run: `grep -n "Modal\b\|ModalHeader\|ProjectForm\|ResetSizeButton\|useResizable" src/app/projects-panel.tsx`

`ResetSizeButton` and `useResizable` are still used by the pane (`resetPaneSize`, `paneSizeRef`), so keep those. Delete the line `const { ref: sizeRef, reset: resetSize } = useResizable("aipm-cockpit:create-modal-size");` at `:133` — the shell owns it now, and an unused binding is a FATAL lint error.

- [ ] **Step 6: Run the projects-panel suite**

Run: `npx vitest run src/app/projects-panel.test.tsx src/app/project-edit-modal.test.tsx`
Expected: PASS. This refactor must not change behaviour — if a projects-panel test fails, the refactor is wrong, not the test.

- [ ] **Step 7: Typecheck, lint, commit**

Run: `npx tsc --noEmit && npm run lint && npm run dup:check`
Expected: exit 0 from all three. `dup:check` is the point of this task.

```bash
git add src/app/project-edit-modal.tsx src/app/project-edit-modal.test.tsx src/app/projects-panel.tsx
git commit -m "refactor(projects): extract the shared project modal shell"
```

---

## Task 9: The Project block in Settings → General

**Files:**
- Modify: `src/app/settings-sections/general-section.tsx`
- Modify: `src/app/settings-view.tsx:69-83` (props) and `:309-311` (render)
- Modify: `src/app/task-manager.tsx:2464-2494` (call site)
- Test: `src/app/settings-sections/general-section.test.tsx`

- [ ] **Step 1: Write the failing tests**

Append to `src/app/settings-sections/general-section.test.tsx` (reuse the file's existing `renderSection` helper if it has one; otherwise define the props inline as below):

```tsx
import { ProjectMeta } from "../types";

const META = {
  name: "Apollo",
  code: "APL",
  projectManager: "",
  keyStakeholdersInternal: [],
  keyStakeholdersExternal: [],
  customer: "",
  naceSection: "",
  identityTypes: [],
  products: "",
  deployment: "",
  startDate: "2026-01-01",
  endDate: "2026-12-31",
  profitCenter: "",
  contactPersons: [],
  regulatory: [],
  operatingTimezone: "Europe/Berlin",
} as unknown as ProjectMeta;

describe("GeneralSection project block", () => {
  test("shows the current project's summary", () => {
    render(
      <GeneralSection
        lang="en-US"
        settings={defaultSettings}
        onChange={vi.fn()}
        project={META}
        stakeholderNames={[]}
        addressBook={[]}
        resources={[]}
        onUpdateProject={vi.fn()}
      />,
    );
    expect(screen.getByText("Apollo")).toBeInTheDocument();
    expect(screen.getByText("APL")).toBeInTheDocument();
    expect(screen.getByText("Europe/Berlin")).toBeInTheDocument();
  });

  test("the edit button opens the project modal and a submit reaches onUpdateProject", async () => {
    // Headline claim FIRST: the WRITE direction. A render-only assertion would
    // stay green with the whole save path removed.
    const user = userEvent.setup();
    const onUpdateProject = vi.fn();
    render(
      <GeneralSection
        lang="en-US"
        settings={defaultSettings}
        onChange={vi.fn()}
        project={META}
        stakeholderNames={[]}
        addressBook={[]}
        resources={[]}
        onUpdateProject={onUpdateProject}
      />,
    );
    await user.click(screen.getByRole("button", { name: /edit project/i }));
    const submits = screen.getAllByRole("button", { name: /edit project/i });
    await user.click(submits[submits.length - 1]);
    expect(onUpdateProject).toHaveBeenCalledTimes(1);
    expect(onUpdateProject.mock.calls[0][0]).toMatchObject({ name: "Apollo" });
  });

  test("without a project the block renders a placeholder and no edit button", () => {
    render(<GeneralSection lang="en-US" settings={defaultSettings} onChange={vi.fn()} />);
    expect(screen.getByText("No project is open.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /edit project/i })).not.toBeInTheDocument();
  });

  test("without onUpdateProject (popout) the summary shows but editing is unavailable", () => {
    render(
      <GeneralSection lang="en-US" settings={defaultSettings} onChange={vi.fn()} project={META} />,
    );
    expect(screen.getByText("Apollo")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /edit project/i })).not.toBeInTheDocument();
  });
});
```

`defaultSettings` comes from `../settings-types` — import it if the test file does not already.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/app/settings-sections/general-section.test.tsx`
Expected: FAIL — the props do not exist on `GeneralSectionProps`.

- [ ] **Step 3: Add the block to GeneralSection**

In `src/app/settings-sections/general-section.tsx`, extend the imports:

```ts
import type { Contact } from "../contacts";
import type { ProjectMeta, Resource } from "../types";
import { ProjectEditModal } from "../project-edit-modal";
import { Button } from "../button";
```

Extend the props interface:

```ts
interface GeneralSectionProps {
  lang: Lang;
  settings: Settings;
  onChange: (s: Settings) => void;
  /** The open project. Absent in a popout or before a project is loaded — the
   *  block then renders a placeholder instead of an editor. */
  project?: ProjectMeta;
  stakeholderNames?: readonly string[];
  addressBook?: readonly Contact[];
  resources?: readonly Resource[];
  /** Save edited metadata. Absent (popout / no project) hides the edit button —
   *  this surface is read-only without it. */
  onUpdateProject?: (meta: ProjectMeta) => void;
}
```

Extend the destructure:

```ts
export function GeneralSection({
  lang, settings, onChange,
  project, stakeholderNames = [], addressBook = [], resources = [], onUpdateProject,
}: GeneralSectionProps) {
  const [resetOpen, setResetOpen] = useState(false);
  const [projectOpen, setProjectOpen] = useState(false);
```

Insert this block as the FIRST child of the returned fragment, immediately after `<>` and before the existing popout-reuse `<div className="mb-4">`:

```tsx
      {/* Project — the open project's metadata, editable without leaving
          Settings. The editor is the SAME modal the Projects panel opens. */}
      <div className="mb-4">
        <h3 className="mb-2 text-sm font-semibold text-foreground">
          {t(lang, "settingsProjectHeading")}
        </h3>
        {project ? (
          <>
            <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">{t(lang, "projectName")}</dt>
                <dd className="truncate text-foreground">{project.name}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">{t(lang, "projectCode")}</dt>
                <dd className="truncate text-foreground">{project.code}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">{t(lang, "projectStartDate")}</dt>
                <dd className="text-foreground">{project.startDate}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">{t(lang, "projectEndDate")}</dt>
                <dd className="text-foreground">{project.endDate}</dd>
              </div>
              {project.operatingTimezone && (
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">{t(lang, "projectOperatingTimezone")}</dt>
                  <dd className="truncate text-foreground">{project.operatingTimezone}</dd>
                </div>
              )}
            </dl>
            {onUpdateProject && (
              <Button variant="secondary" size="sm" className="mt-3" onClick={() => setProjectOpen(true)}>
                {t(lang, "projectsEdit")}
              </Button>
            )}
          </>
        ) : (
          <FieldHint>{t(lang, "settingsProjectNoProject")}</FieldHint>
        )}
      </div>

      {projectOpen && project && onUpdateProject && (
        <ProjectEditModal
          lang={lang}
          initial={project}
          stakeholderNames={stakeholderNames}
          addressBook={addressBook}
          resources={resources}
          sizeKey="aipm-cockpit:project-edit-modal-size"
          onSubmit={(meta) => { onUpdateProject(meta); setProjectOpen(false); }}
          onCancel={() => setProjectOpen(false)}
        />
      )}

      <hr className="my-4 border-line" />
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/app/settings-sections/general-section.test.tsx`
Expected: PASS. If the second test's "click the submit" step is ambiguous, scope it to the modal panel: `within(document.querySelector("[data-modal-panel]") as HTMLElement).getByRole("button", { name: /edit project/i })`.

- [ ] **Step 5: Thread the props through SettingsView**

In `src/app/settings-view.tsx`, add to `SettingsViewProps` after the existing `resources` field:

```ts
  /** The open project, for the General → Project block. Absent in popouts. */
  project?: import("./types").ProjectMeta;
  /** Suggestions for the project form's key-stakeholder inputs. */
  projectStakeholderNames?: readonly string[];
  /** Address book for the project form's contact picker. */
  projectAddressBook?: readonly import("./contacts").Contact[];
  /** Save edited project metadata. Absent → the General block is read-only. */
  onUpdateProject?: (meta: import("./types").ProjectMeta) => void;
```

Replace line 311:

```tsx
            <GeneralSection lang={lang} settings={settings} onChange={onChange} />
```

with:

```tsx
            <GeneralSection
              lang={lang}
              settings={settings}
              onChange={onChange}
              project={props.project}
              stakeholderNames={props.projectStakeholderNames}
              addressBook={props.projectAddressBook}
              resources={props.resources}
              onUpdateProject={props.onUpdateProject}
            />
```

- [ ] **Step 6: Pass them from task-manager**

In `src/app/task-manager.tsx`, add to the `<SettingsView …>` call at `:2464`, immediately after `resources={resources}`:

```tsx
      project={project}
      projectStakeholderNames={stakeholders.map((s) => s.name)}
      projectAddressBook={contactsList}
      onUpdateProject={isPopout ? undefined : handleUpdateCurrentProjectByMode}
```

★ `isPopout ? undefined` mirrors every other write handler on this call site — a popout must never mutate.

★ These are the exact values already assembled for the Projects panel at `:2287-2294`; do not build new ones.

- [ ] **Step 7: Run the affected suites**

Run: `npx vitest run src/app/settings-view src/app/settings-sections/general-section src/app/task-manager`
Expected: PASS.

- [ ] **Step 8: Mutation-check the thread**

Temporarily delete the `onUpdateProject={…}` line from the `task-manager.tsx` call site and re-run `npx vitest run src/app/task-manager`.

Expected: **probably still green** — the prop thread is not asserted end to end (the same gap slice A recorded for `budgetLink`). Record the result in the commit body. Then restore the line with a file copy, **not** `git checkout src/app/task-manager.tsx` — that command has twice wiped uncommitted work in this file:

```bash
cp src/app/task-manager.tsx /tmp/tm.bak   # BEFORE deleting the line
# … mutate, test …
cp /tmp/tm.bak src/app/task-manager.tsx   # restore
grep -c "onUpdateProject" src/app/task-manager.tsx   # expect 1
```

- [ ] **Step 9: Axe-check Settings on a fresh server**

```bash
PORT=3100 npx playwright test e2e/a11y.spec.ts --project=chromium -g "Settings"
```

Expected: 5 passed. Re-run once before debugging a first-run failure (cold-server landmine). Stop with `PORT=3100 npm run stop`.

- [ ] **Step 10: Typecheck, lint, size, commit**

Run: `npx tsc --noEmit && npm run lint && npm run size:check`
Expected: exit 0 from all three.

```bash
git add src/app/settings-sections/general-section.tsx src/app/settings-sections/general-section.test.tsx src/app/settings-view.tsx src/app/task-manager.tsx
git commit -m "feat(settings): edit the open project from Settings → General"
```

---

## Task 10: Release chain

**Files:**
- Modify: `src/app/version.ts` (holds BOTH `APP_VERSION` and `APP_HIGHLIGHT_KEYS:22`)
- Modify: `CHANGELOG.md`
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts`

- [ ] **Step 1: Pick a unique codename**

Run: `grep -c '"' CHANGELOG.md` then `grep -o '"[A-Z][a-z]*"' CHANGELOG.md | sort -u`

Choose a surname not in that list (≈147 used). ★ Grep **with** the quotes — a bare word match produces false positives from prose.

- [ ] **Step 2: Bump the version**

In `src/app/version.ts`, set `APP_VERSION` to `"0.208.0"` and the milestone to the chosen codename, matching the shape of the existing values.

- [ ] **Step 3: Add the highlight key**

`APP_HIGHLIGHT_KEYS` is the array at `src/app/version.ts:22` (consumed by `version-info.tsx:67`).
Append `"versionHighlight0208"` to it, then add the string to both dictionaries. EN, in `src/app/i18n.ts` beside the other `versionHighlight*` keys:

```ts
  versionHighlight0208: "Edit the open project from Settings → General, load your own theme files, and resize any edit modal vertically.",
```

DE, via the node-write pattern from Task 3 (derive the newline from the file; do **not** use the Edit tool):

```ts
  versionHighlight0208: "Das geöffnete Projekt in Einstellungen → Allgemein bearbeiten, eigene Designdateien laden und jedes Bearbeitungsfenster in der Höhe anpassen.",
```

Run: `grep -n "geöffnete\|Höhe" src/app/i18n.de.ts`
Expected: real `ö` characters, no ASCII substitutions.

- [ ] **Step 4: Write the CHANGELOG entry**

Insert directly above the `## [0.207.0] - 2026-07-28 "Goss"` heading (the newest entry), matching its format — an `##` heading, a short prose lead, then the detail:

```markdown
## [0.208.0] - 2026-07-28 "<Codename>"

The open project is now editable without leaving Settings, themes are files you
load rather than a fixed pair, and every edit modal can finally be resized
vertically.

- **Project config in Settings → General.** A Project block shows the open
  project's name, code, dates and operating timezone, with an Edit button that
  opens the same editor the Projects panel uses. Read-only in pop-out windows.
- **Themes are files.** The theme gallery is now a library: load any portable
  theme `.json` from disk, then apply, customise or remove it. The AIPM and
  Dashboard themes no longer ship with the app — load them as files if you want
  them. Importing from the scheme editor no longer drops a theme's dark mode or
  its shadow/gradient settings.
- **Edit modals resize vertically.** The seven shared edit modals and the budget
  bucket modal now open at a sensible height and grow their content when you
  drag the corner, instead of leaving empty space.
```

★ Replace `<Codename>` with the name chosen in Step 1 — it must match `version.ts` exactly.

- [ ] **Step 5: Run the whole gate**

```bash
npx tsc --noEmit
npm run lint
npm run test:run
npm run test:coverage
npm run dup:check
npm run size:check
npm run build
```

Expected: exit 0 from every command. ★ `test:coverage` floors are blocking in CI and `test:run` does **not** enforce them — `scheme-import.ts` is a new coverage-gated pure `.ts`, so check its numbers specifically.

- [ ] **Step 6: Run the full axe gate on a fresh server**

```bash
PORT=3100 npx playwright test e2e/a11y.spec.ts --project=chromium
```

Expected: 85 passed (5 combos × 16 views + 5 Kanban). Stop with `PORT=3100 npm run stop`.

- [ ] **Step 7: Commit**

```bash
git add src/app/version.ts CHANGELOG.md src/app/i18n.ts src/app/i18n.de.ts
git commit -m "chore(release): 0.208.0 <Codename>"
```

- [ ] **Step 8: Re-archive the slice docs — CUMULATIVE**

★★★ A plain walk-the-tree zip produces a **subset** of the previous archive, because ~298 historical documents exist only inside it. Merge and assert:

```bash
python - <<'PY'
import zipfile, glob, os
old = sorted(glob.glob("docs/superpowers/_archive-slice-docs-*.zip"))[-1]
new = "docs/superpowers/_archive-slice-docs-2026-07-28-slice-e.zip"
with zipfile.ZipFile(old) as o, zipfile.ZipFile(new, "w", zipfile.ZIP_DEFLATED) as n:
    tree = {}
    for root, _, files in os.walk("docs/superpowers"):
        for f in files:
            p = os.path.join(root, f)
            if p.endswith(".zip"):
                continue
            tree[os.path.relpath(p, "docs/superpowers").replace("\\", "/")] = p
    for name, path in tree.items():
        n.write(path, name)                      # working tree wins
    for name in o.namelist():
        if name not in tree:
            n.writestr(name, o.read(name))       # carry forward the rest
with zipfile.ZipFile(old) as o, zipfile.ZipFile(new) as n:
    missing = set(o.namelist()) - set(n.namelist())
    assert not missing, f"LOST {len(missing)} entries: {sorted(missing)[:5]}"
    print(f"ok: {len(n.namelist())} entries, superset of {old}")
PY
```

Expected: `ok: <N> entries, superset of …` with N ≥ the previous archive's count. A raised `AssertionError` means the archive is unsafe — do not proceed.

- [ ] **Step 9: Stop**

Do **not** push, open an MR, or merge. Those happen only on an explicit instruction from the user.

---

## Verification checklist

Run before declaring the slice done:

- [ ] `npx tsc --noEmit` → exit 0
- [ ] `npm run lint` → exit 0 (`--max-warnings=0`; an unused import is fatal)
- [ ] `npm run test:run` → all green, file count in the expected range
- [ ] `npm run test:coverage` → floors met, `scheme-import.ts` covered
- [ ] `npm run dup:check` → under threshold
- [ ] `npm run size:check` → `budget-bucket-modal.tsx` still under 800
- [ ] `npm run build` → exit 0
- [ ] `PORT=3100 npx playwright test e2e/a11y.spec.ts --project=chromium` → 85 passed
- [ ] `grep -rn "public/themes" src/ e2e/ scripts/` → no output
- [ ] Eye-verify Settings → Appearance: the theme list, the file picker, and a loaded theme's Apply/Remove (Settings is axe-scanned, but axe cannot see duplicate accessible names)
- [ ] Eye-verify: drag the bottom-right corner of a RAID edit modal downward — the form scroller grows with the panel, no dead space
