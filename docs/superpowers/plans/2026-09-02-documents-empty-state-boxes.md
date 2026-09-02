# Documents Empty-State Boxes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the Documents pane a clickable dashed empty-state box in each of its two sections — an empty document list offers "create", an empty image library offers "upload" — using the primitive eight other panels already share.

**Architecture:** No engine change and no new capability. `AddFirstItemButton` already exists; this slice adds Documents as a consumer in two places. One small extraction is required first: `FilePickerButton` owns the hidden-input-plus-click mechanism but hardcodes a `Button` as its trigger, so the mechanism moves into a `useFilePicker` hook that both it and the new box call.

**Tech Stack:** Next.js 16 / React 19, TypeScript, Tailwind v4, vitest + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-09-02-documents-empty-state-boxes-design.md`

---

## Before you start — environment rules that will bite

- **Every `src/app/*.ts(x)` file is CRLF** (`git ls-files --eol` reports `i/lf w/crlf`). Use the **Edit** tool, never **Write** — Write silently re-lines the file to LF, which `git diff` does not show and which breaks the next anchored edit. A new file you create is fine either way.
- ★★★ **Never touch `src/app/i18n.de.ts` with the Edit tool.** It corrupts umlauts and curls double-quotes, and it bites umlaut-free strings too. Patch it with a node utf8 read/replace/write whose anchor contains `\r\n` — a `\n`-only anchor matches nothing and no-ops silently. Both new DE strings in Task 2 carry umlauts.
- **Never read a gate's exit code through a pipe.** `npx vitest ... | tail -5` gives you `tail`'s status and discards the diagnostic. Redirect to a file, `echo "EXIT=$?"` on its own unpiped line, then grep the file.
- **`npx tsc --noEmit` exits 2 on diagnostics, not 1.** Run it after editing ANY test file — vitest never typechecks and `next build` skips tests, so a test-only type error passes both and fails CI.
- **`npx eslint src`**, not `npm run lint` (which exits 1 from unrelated gitignored leftovers). It runs `--max-warnings=0`, so an unused import or param is FATAL, not a warning.
- **Never run two vitest processes at once.** A failure log containing `Failed to start forks worker` is machine contention, not a red test — re-run that file alone and say so.
- **Never `git add -A` or `git add .`** — `not-in-use.env.local.bak` is untracked, un-gitignored and contains live Turso credentials; `sample-workspace-huge.json` belongs to a foreign writer. Stage exact paths only.
- Every commit ends with `Claude-Session: https://[session link removed]`. Use a Bash heredoc, never a PowerShell here-string.

## File structure

| File | Responsibility after this slice |
|---|---|
| `src/app/use-file-picker.ts` | NEW. Sole owner of the hidden-input file-dialog mechanism: the `open()` imperative and the input's props. |
| `src/app/file-picker-button.tsx` | The labelled `Button` trigger. Keeps its public props; its mechanism now comes from the hook. |
| `src/app/documents-list.tsx` | Renders the documents dashed box when `onCreate` is supplied, else the passive message. |
| `src/app/documents-panel.tsx` | Decides whether the box is offered at all (truly-empty AND writable) and passes `onCreate` accordingly. |
| `src/app/asset-library.tsx` | Renders the image dashed box at its existing empty branch. |
| `src/app/i18n.ts` / `i18n.de.ts` | Two new keys. |

---

## Task 1: Extract `useFilePicker` from `FilePickerButton`

**Files:**
- Create: `src/app/use-file-picker.ts`
- Modify: `src/app/file-picker-button.tsx`
- Test: `src/app/file-picker-button.test.tsx` — **do not edit it**

`FilePickerButton`'s docstring names three load-bearing properties, each closing a real defect: `sr-only` rather than `display:none` (a `display:none` input cannot be clicked in every browser); `tabIndex={-1}` + `aria-hidden` (else the input is a second tab stop announcing the same accessible name — and axe reports missing names, never duplicated ones); and a real `<button>` rather than a styled `<label>` (a `<label>` is not focusable, so its focus ring can never render, WCAG 2.4.7, and axe has no focus-visibility rule either).

★★ Moving them into the hook is what keeps ONE definition of all three. Hand-rolling a second hidden input beside the new dashed box instead would recreate exactly the divergence this component was built to end (`open-followups.md` §15 — "Replaces two hand-rolled shapes that had diverged onto the same settings surface").

★★★ **The existing `file-picker-button.test.tsx` must pass UNCHANGED.** That is the whole evidence this extraction was behaviour-preserving. If you find yourself wanting to edit it, the refactor is wrong — stop and report.

- [ ] **Step 1: Run the existing test to record the green baseline**

Run: `npx vitest run src/app/file-picker-button.test.tsx --maxWorkers=1`

Expected: PASS. Record the tally as `N failed / M passed` and the runtime test count vitest prints — you will compare against it in Step 4.

- [ ] **Step 2: Create the hook**

Create `src/app/use-file-picker.ts`:

```ts
"use client";

// Sole owner of the "hidden input + click it" file-dialog mechanism.
//
// ★★ Extracted from `file-picker-button.tsx` so a second trigger shape (the
// dashed empty-state box, which is an `AddFirstItemButton` and not a `Button`)
// can open a file dialog without hand-rolling a second input. Three properties
// below are load-bearing and each closes a real defect — they live here, once:
//   1. `sr-only`, never `display:none` — a display:none input cannot be
//      clicked in every browser.
//   2. `tabIndex={-1}` + `aria-hidden` — an sr-only input is otherwise a
//      SECOND tab stop announcing the same accessible name as its trigger.
//      axe reports missing names, never duplicated ones, so nothing automated
//      catches a regression here; the unit tests do.
//   3. The TRIGGER must be a real focusable control, never a styled <label>.
//      That is the caller's job, not this hook's — but it is why this hook
//      returns an imperative `open()` rather than rendering a label.
//
// Owns NO validation: mime/size/parse rules stay with the caller, which is why
// `onFile` hands back the raw File.

import { useRef, type ChangeEvent, type ComponentPropsWithRef } from "react";

export interface FilePicker {
  /** Open the file dialog. Wire to the trigger's `onClick`. */
  open: () => void;
  /** Spread onto a single `<input>` the caller renders beside its trigger. */
  inputProps: ComponentPropsWithRef<"input">;
}

export function useFilePicker(
  onFile: (file: File) => void,
  accept: string,
  disabled = false,
): FilePicker {
  const inputRef = useRef<HTMLInputElement | null>(null);

  function onChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // Reset BEFORE dispatching so re-picking the same file fires again.
    e.target.value = "";
    if (!file) return;
    onFile(file);
  }

  return {
    open: () => inputRef.current?.click(),
    inputProps: {
      ref: inputRef,
      type: "file",
      accept,
      disabled,
      className: "sr-only",
      tabIndex: -1,
      "aria-hidden": "true",
      onChange,
    },
  };
}
```

- [ ] **Step 3: Rewrite `FilePickerButton` onto the hook**

In `src/app/file-picker-button.tsx`, replace the `useRef` import, the `onChange` function and the returned JSX so the component reads:

```tsx
import { useFilePicker } from "./use-file-picker";
import { Button, type ButtonSize, type ButtonVariant } from "./button";

export interface FilePickerButtonProps {
  /** Visible button text AND its accessible name. Caller translates. */
  label: string;
  /** Forwarded verbatim to the input's `accept`. */
  accept: string;
  onFile: (file: File) => void;
  disabled?: boolean;
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export function FilePickerButton({
  label, accept, onFile, disabled = false, variant = "secondary", size = "sm",
}: FilePickerButtonProps) {
  const { open, inputProps } = useFilePicker(onFile, accept, disabled);

  return (
    <>
      <Button variant={variant} size={size} disabled={disabled} onClick={open}>
        {label}
      </Button>
      <input {...inputProps} />
    </>
  );
}
```

Keep the file's existing header comment block. Update only its final paragraph to say the mechanism now lives in `use-file-picker.ts`; leave the three numbered properties described where a reader of this file will still find them, with a pointer to the hook.

- [ ] **Step 4: Run the untouched test to verify the refactor preserved behaviour**

Run: `npx vitest run src/app/file-picker-button.test.tsx --maxWorkers=1`

Expected: PASS, with the SAME tally and the same runtime test count you recorded in Step 1, against a test file you did not edit.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit; echo "EXIT=$?"` — expect `EXIT=0`. (This exits **2** on diagnostics, not 1.)

- [ ] **Step 6: Commit**

```bash
git add src/app/use-file-picker.ts src/app/file-picker-button.tsx
```

Commit message: `refactor(files): extract useFilePicker so a second trigger can open a dialog` plus the session trailer.

---

## Task 2: Add the two i18n keys

**Files:**
- Modify: `src/app/i18n.ts`
- Modify: `src/app/i18n.de.ts` — **node write only, never the Edit tool**

★★★ **Neither key may repeat the label of the control that stays mounted beside its box.** In both sections the existing control is still on screen when the box renders: the toolbar's New button (`documentsNew`) sits above the empty document list, and the `upload`-labelled `FilePickerButton` sits directly above the empty image library. `documents-panel.tsx`'s `handleCreate` carries a ★★ comment recording that this pane once held **two buttons called "New document"** for exactly this reason. The strings below are deliberately longer than their neighbours so no collision is possible.

- [ ] **Step 1: Add the EN keys**

In `src/app/i18n.ts`, beside the existing `documentsNoneYet` entry, add:

```ts
  documentsCreateFirst: "Create your first document",
```

and beside the existing `assetLibraryEmpty` entry, add:

```ts
  assetLibraryUploadFirst: "Upload your first image",
```

- [ ] **Step 2: Add the DE keys by node write**

`i18n.de.ts` is CRLF and the Edit tool corrupts it. Anchor on the existing lines, which you must first confirm are unique. Run this, and confirm both counts print `1`:

```bash
node -e "const fs=require('fs');const s=fs.readFileSync('src/app/i18n.de.ts','utf8');
for (const a of ['  documentsNoneYet:','  assetLibraryEmpty:']) {
  console.log(a, s.split(a).length - 1);
}"
```

Then write:

```bash
node -e "const fs=require('fs');const p='src/app/i18n.de.ts';let s=fs.readFileSync(p,'utf8');
const edits=[
 [/(  documentsNoneYet: \"[^\"]*\",\r\n)/, '\$1  documentsCreateFirst: \"Erstes Dokument erstellen\",\r\n'],
 [/(  assetLibraryEmpty: \"[^\"]*\",\r\n)/, '\$1  assetLibraryUploadFirst: \"Erstes Bild hochladen\",\r\n'],
];
for (const [re, rep] of edits) { if (!re.test(s)) throw new Error('anchor missed: '+re); s = s.replace(re, rep); }
fs.writeFileSync(p, s, 'utf8'); console.log('written');"
```

Note the `\r\n` in both the anchor and the replacement. A `\n`-only anchor matches nothing and the script would report success having changed nothing — which is why the `throw` above is not optional.

- [ ] **Step 3: Verify the DE bytes and the line endings survived**

```bash
node -e "const s=require('fs').readFileSync('src/app/i18n.de.ts','utf8');
for (const k of ['documentsCreateFirst','assetLibraryUploadFirst']) {
  console.log(k, JSON.stringify(s.match(new RegExp(k+': \"([^\"]*)\"'))[1]));
}
console.log('LF-without-CR count:', (s.match(/(?<!\r)\n/g)||[]).length);"
```

Expected: the two strings print with real umlauts, and the LF-without-CR count is **0**. The `i18n-encoding` test bans ASCII substitutions (`fuer`/`druecken`) and `\u00XX` escapes, so a corrupted write fails it.

- [ ] **Step 4: Typecheck — this is what enforces EN/DE key parity**

Run: `npx tsc --noEmit; echo "EXIT=$?"` — expect `EXIT=0`. A key added to one dictionary and not the other fails here, not at runtime.

- [ ] **Step 5: Run the encoding test**

Run: `npx vitest run src/app/i18n-encoding.test.ts --maxWorkers=1` — expect PASS. Report the tally.

- [ ] **Step 6: Commit**

```bash
git add src/app/i18n.ts src/app/i18n.de.ts
```

Commit message: `i18n: add the two empty-state CTA keys for the Documents pane` plus the session trailer.

---

## Task 3: The documents dashed box

**Files:**
- Modify: `src/app/documents-list.tsx`
- Modify: `src/app/documents-panel.tsx`
- Test: `src/app/documents-panel.test.tsx`

★★★ **THE GATE LIVES IN THE ORCHESTRATOR, NOT IN THE LIST, AND THIS IS THE TRAP OF THE WHOLE TASK.** `DocumentsList` receives `visibleRows` — already **filtered** by `useDocumentEntityFilter`. So `documents.length === 0` inside the list is ALSO true when a filter is active and matches nothing, while the register holds documents. `AddFirstItemButton`'s docstring restricts it to "a truly-empty register (never filtered-empty); the panel keeps its own empty-vs-filtered branching". Rendering the box on the list's own length check would offer "Create your first document" to someone who has twenty and a filter applied.

★ The mechanism is the repo's existing optional-handler convention, which AGENTS.md states for `SortResizeTh`: *"`onResize` is OPTIONAL — omit it for a table that sorts but stores no column widths and NO handle renders. Never pass a no-op instead: that draws a grip which looks draggable and does nothing."* Same rule here — omit `onCreate` and the passive message renders. **Never pass a no-op.**

- [ ] **Step 1: Write the failing tests**

In `src/app/documents-panel.test.tsx`, add this block. Read the file first and adapt the fixture helpers to the real ones it already defines (the render host, the empty-workspace factory, the inert mutate stub); do NOT invent a fixture that does not exist — if something is genuinely missing, stop and report rather than fabricating it.

```tsx
describe("DocumentsPanel — the documents empty-state box", () => {
  it("offers the create box when the register is truly empty", () => {
    renderPanel({ documents: [] });
    expect(
      screen.getByRole("button", { name: t(EN, "documentsCreateFirst") }),
    ).toBeInTheDocument();
  });

  it("creates a document when the box is clicked", async () => {
    const user = userEvent.setup();
    const mutate = vi.fn();
    renderPanel({ documents: [], mutateDocuments: mutate });
    await user.click(screen.getByRole("button", { name: t(EN, "documentsCreateFirst") }));
    expect(mutate).toHaveBeenCalledWith(expect.objectContaining({ kind: "create" }));
  });

  // ★★★ A popout is a read-only mirror whose create affordance is inert by
  // design. The passive message is the positive observable, so this cannot
  // pass against a box that never renders under any conditions.
  it("shows the passive message instead of the box when read-only", () => {
    renderPanel({ documents: [], isReadOnly: true });
    expect(
      screen.queryByRole("button", { name: t(EN, "documentsCreateFirst") }),
    ).toBeNull();
    expect(screen.getByText(t(EN, "documentsNoneYet"))).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/app/documents-panel.test.tsx --maxWorkers=1`

Expected: the first two FAIL (no such button yet); the third PASSES already, because today's empty state is the passive message in every case. Record the tally as `N failed / M passed` — N + M must equal the file's runtime test count, which vitest prints. Report all three numbers.

★ The third test passing here is correct, not a mistake: it is a regression pin for the read-only branch, and Task 6 mutation-proves it separately.

- [ ] **Step 3: Add the optional prop to the list**

In `src/app/documents-list.tsx`, add to `DocumentsListProps`, immediately after the `isReadOnly` member:

```tsx
  /** Offered ONLY for a truly-empty register. ★★★ The orchestrator decides:
   *  this component receives `visibleRows`, which is FILTERED, so its own
   *  `documents.length === 0` is also true for a filtered-empty list — and
   *  `AddFirstItemButton` is contractually never rendered filtered-empty.
   *  Omit to render the passive message; NEVER pass a no-op, which would draw
   *  a box that looks clickable and does nothing. */
  onCreate?: () => void;
```

Add `onCreate` to the destructured parameter list, add `import { AddFirstItemButton } from "./add-first-item-button";` beside the other imports, and replace the empty branch:

```tsx
  if (documents.length === 0) {
    return <EmptyState title={t(lang, "documentsNoneYet")} />;
  }
```

with:

```tsx
  if (documents.length === 0) {
    if (!onCreate) return <EmptyState title={t(lang, "documentsNoneYet")} />;
    return (
      <AddFirstItemButton
        onAdd={onCreate}
        text={t(lang, "documentsNoneYet")}
        addLabel={`+ ${t(lang, "documentsCreateFirst")}…`}
        ariaLabel={t(lang, "documentsCreateFirst")}
        rounded="xl"
      />
    );
  }
```

★ `ariaLabel` is passed explicitly so the accessible name is the CTA alone — the behaviour `AddFirstItemButton`'s own 2026-08-26 decision block specifies for the `text` variant, and what keeps the name short and distinct.

- [ ] **Step 4: Wire the orchestrator**

In `src/app/documents-panel.tsx`, at the `<DocumentsList …/>` call site, add one prop after `isReadOnly={isReadOnly}`:

```tsx
          onCreate={documents.length === 0 && !isReadOnly ? handleCreate : undefined}
```

★★ The condition reads `documents`, the UNFILTERED array, not `visibleRows`. That is the whole point of Step 3's docstring — read it again before changing this line.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/app/documents-panel.test.tsx --maxWorkers=1` — expect all green. Report the tally.

- [ ] **Step 6: Typecheck and lint**

Run: `npx tsc --noEmit; echo "EXIT=$?"` then `npx eslint src; echo "EXIT=$?"` — expect `EXIT=0` from both.

- [ ] **Step 7: Commit**

```bash
git add src/app/documents-list.tsx src/app/documents-panel.tsx src/app/documents-panel.test.tsx
```

Commit message: `feat(documents): offer a create box when the document list is empty` plus the session trailer.

---

## Task 4: The image dashed box

**Files:**
- Modify: `src/app/asset-library.tsx`
- Test: `src/app/asset-library.test.tsx`

★★★ **PUT IT AT `asset-library.tsx`'s EXISTING EMPTY BRANCH, AND NOWHERE ELSE.** `documents-asset-section.tsx` returns early with a `compact` `EmptyState` when `!enabled` (`tursoConfig !== null && !isReadOnly`), choosing between two deliberately distinct messages — `assetLibraryTursoOnly` and `assetLibraryReadOnly` — under a ★★ comment warning never to conflate them. `AssetLibrary` therefore only ever renders when assets are **enabled**, so placing the box here inherits the Turso and read-only gating for free. **Do not add a box to the `!enabled` branch and do not touch those two messages** — a clickable upload box on a non-Turso backend or a read-only popout is a false affordance that cannot work.

- [ ] **Step 1: Write the failing test**

In `src/app/asset-library.test.tsx`, add. Adapt the render helper and props to the real ones the file already defines:

```tsx
describe("AssetLibrary — the upload empty-state box", () => {
  it("offers the upload box when the library is empty", () => {
    renderLibrary({ assets: [] });
    expect(
      screen.getByRole("button", { name: t(EN, "assetLibraryUploadFirst") }),
    ).toBeInTheDocument();
  });

  // ★★ Assert the DIALOG is opened, not that a File arrives — jsdom cannot
  // produce a real file-picker selection, so a test asserting `onUpload` fired
  // would be asserting something the harness cannot cause.
  it("opens the file dialog when the box is clicked", async () => {
    const user = userEvent.setup();
    renderLibrary({ assets: [] });
    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    if (!input) throw new Error("no file input rendered");
    const click = vi.spyOn(input, "click");
    await user.click(screen.getByRole("button", { name: t(EN, "assetLibraryUploadFirst") }));
    expect(click).toHaveBeenCalled();
  });

  it("does not offer the box once the library has an asset", () => {
    renderLibrary({ assets: [asset("a1", "Diagram.png")] });
    expect(
      screen.queryByRole("button", { name: t(EN, "assetLibraryUploadFirst") }),
    ).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run src/app/asset-library.test.tsx --maxWorkers=1`

Expected: the first two FAIL, the third PASSES (nothing renders that name yet). Record `N failed / M passed` and the runtime test count.

- [ ] **Step 3: Render the box**

In `src/app/asset-library.tsx`, add `import { AddFirstItemButton } from "./add-first-item-button";` and `import { useFilePicker } from "./use-file-picker";` beside the other imports.

The component already renders a `FilePickerButton` in its toolbar row. Add a hook call in the component body for the BOX's own dialog:

```tsx
  const boxPicker = useFilePicker(onUpload, ASSET_MIME_ALLOWED.join(","), busyId !== null);
```

Then replace the empty branch:

```tsx
      {assets.length === 0 ? (
        <EmptyState title={t(lang, "assetLibraryEmpty")} />
      ) : (
```

with:

```tsx
      {assets.length === 0 ? (
        <>
          <AddFirstItemButton
            onAdd={boxPicker.open}
            text={t(lang, "assetLibraryEmpty")}
            addLabel={`+ ${t(lang, "assetLibraryUploadFirst")}…`}
            ariaLabel={t(lang, "assetLibraryUploadFirst")}
            rounded="xl"
          />
          <input {...boxPicker.inputProps} />
        </>
      ) : (
```

★ The box gets its OWN picker rather than sharing the toolbar button's, because each `useFilePicker` owns exactly one input element and the toolbar's belongs to `FilePickerButton`. Both inputs are `sr-only`, `tabIndex={-1}` and `aria-hidden`, so neither is a tab stop and neither carries an accessible name — the reason two of them cost nothing is precisely the three properties Task 1 centralised.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/app/asset-library.test.tsx --maxWorkers=1` — expect all green. Report the tally.

- [ ] **Step 5: Pin that NEITHER disabled branch offers a box**

The image box's Turso and read-only gating is inherited: `AssetLibrary` renders only when `documents-asset-section.tsx` has passed its `!enabled` early return. Inherited is not the same as tested, and nothing so far proves the box stays out of those two branches.

Add to `src/app/documents-asset-section.test.tsx` — read the file's existing helpers for supplying a null vs non-null `tursoConfig` and follow them:

```tsx
describe("DocumentsAssetSection — the upload box stays out of the disabled branches", () => {
  it("offers no box and keeps its own message on a non-Turso backend", () => {
    renderSection({ tursoConfig: null, isReadOnly: false });
    expect(
      screen.queryByRole("button", { name: t(EN, "assetLibraryUploadFirst") }),
    ).toBeNull();
    expect(screen.getByText(t(EN, "assetLibraryTursoOnly"))).toBeInTheDocument();
  });

  // ★★ A DIFFERENT message, deliberately: `assetLibraryTursoOnly` is simply
  // untrue for a read-only popout on a fully configured Turso project, and
  // would send the reader off to check storage settings that are correct.
  it("offers no box and keeps its own message in a read-only popout", () => {
    renderSection({ tursoConfig: someConfig, isReadOnly: true });
    expect(
      screen.queryByRole("button", { name: t(EN, "assetLibraryUploadFirst") }),
    ).toBeNull();
    expect(screen.getByText(t(EN, "assetLibraryReadOnly"))).toBeInTheDocument();
  });
});
```

Each assertion pairs the absence with a positive observable — the branch's own message — so neither can pass against a section that rendered nothing at all.

Run: `npx vitest run src/app/documents-asset-section.test.tsx --maxWorkers=1` — expect PASS. Report the tally.

- [ ] **Step 6: Confirm you did not touch the gated branch's source**

Run: `git diff --stat src/app/documents-asset-section.tsx`

Expected: **no output**. Only its TEST file changes in this task; the component itself must be untouched. If the component has a diff, revert it and report.

- [ ] **Step 7: Typecheck and lint**

`npx tsc --noEmit; echo "EXIT=$?"` and `npx eslint src; echo "EXIT=$?"` — expect `EXIT=0` from both.

- [ ] **Step 8: Commit**

```bash
git add src/app/asset-library.tsx src/app/asset-library.test.tsx src/app/documents-asset-section.test.tsx
```

Commit message: `feat(documents): offer an upload box when the image library is empty` plus the session trailer.

---

## Task 5: Pin that the two boxes never share an accessible name

**Files:**
- Test: `src/app/documents-panel.test.tsx`

★★★ **THIS IS THE ONLY POSSIBLE DETECTOR AND IT EXISTS FOR A MEASURED REASON.** On an empty Turso project BOTH boxes render at once in one pane. Two buttons sharing an accessible name is a WCAG 2.4.6 failure, and the axe gate is measurably blind to duplicate accessible names in every view at every seed size — of axe 4.12.1's 105 rules, the 69 carrying one of the four tags `e2e/a11y.spec.ts` requests, not one flags two controls sharing a name. Documents IS an axe-scanned view, so a fully green axe run says nothing here. A unit test is the entire coverage.

- [ ] **Step 1: Write the test**

Add to `src/app/documents-panel.test.tsx`. It must render the pane with BOTH sections empty and assets ENABLED (a non-null `tursoConfig` and not read-only) — read how the file's existing asset-aware tests supply that and follow them; if the existing fixtures cannot enable assets, stop and report rather than inventing a config.

```tsx
it("gives the two empty-state boxes distinct accessible names", () => {
  renderPanelWithAssets({ documents: [], assets: [] });

  // Both boxes must actually be on screen, or the uniqueness claim is vacuous.
  expect(
    screen.getByRole("button", { name: t(EN, "documentsCreateFirst") }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: t(EN, "assetLibraryUploadFirst") }),
  ).toBeInTheDocument();

  // ★★ The shared helper, never a hand-rolled enumeration: its `buttonIndex`
  // throws when a key matches zero or several controls, where a findIndex
  // silently takes the first.
  // ★ `requireCollisionSeed` stays OFF: this is a distinct-name regression
  // pin, not a test certifying a collision fixture. Turning it on would make
  // the assertion throw against correct code.
  expectRowUniqueNames({ minControls: 2 });
});
```

Add `import { expectRowUniqueNames } from "../test/row-unique-names";` beside the other imports.

★ Set `minControls` to the value you MEASURE for this scope, not to 2, if the pane renders more controls than that — the floor is what stops a silently narrowed scope passing, and a loose floor lets that back in. Report the number you measured and used.

- [ ] **Step 2: Run it**

Run: `npx vitest run src/app/documents-panel.test.tsx --maxWorkers=1` — expect PASS (the names are already distinct by Task 2's design). Report the tally.

- [ ] **Step 3: Prove it is not vacuous**

Temporarily change `ariaLabel={t(lang, "assetLibraryUploadFirst")}` in `src/app/asset-library.tsx` to `ariaLabel={t(lang, "documentsCreateFirst")}`. Confirm the mutant landed with `grep -n "documentsCreateFirst" src/app/asset-library.tsx` (expect one hit where there were none).

Run the file again. Expected: FAIL, naming this test, with a real assertion diff from `expectRowUniqueNames`. Record `N failed / M passed`; N + M must equal the file's runtime test count.

Then revert by an inverse anchored edit whose anchor is as unique as the one that applied it — assert the grep count in BOTH directions — and prove the tree is clean:

```bash
git diff --stat src/app/asset-library.tsx
```

Expected: no output. ★ `git checkout -- <file>` is DENY-BLOCKED in this repo; you cannot revert that way.

- [ ] **Step 4: Commit**

```bash
git add src/app/documents-panel.test.tsx
```

Commit message: `test(documents): pin the two empty-state boxes to distinct names` plus the session trailer.

---

## Task 6: Mutation-prove the two suppression guards

**Files:** modify temporarily, then revert — `src/app/documents-panel.tsx`

**This task produces NO commit.** A guard that has never failed for the reason it claims is not coverage. For each mutant: apply it, **confirm it landed by grep BEFORE running anything** (a mutant that silently failed to apply yields a green run that reads as "the test is vacuous" — the most expensive misreading available), run, record `N failed / M passed` with the sum equal to the file's runtime test count, confirm the failure is a real assertion diff naming the expected test rather than a crash or contention, revert by inverse anchored edit with uniqueness asserted both directions, and end on `git diff --stat` printing nothing.

- [ ] **Step 1: Mutant A — drop the read-only suppression**

In `src/app/documents-panel.tsx` change:

```tsx
          onCreate={documents.length === 0 && !isReadOnly ? handleCreate : undefined}
```

to:

```tsx
          onCreate={documents.length === 0 ? handleCreate : undefined}
```

Verify: `grep -c "!isReadOnly ? handleCreate" src/app/documents-panel.tsx` drops from 1 to 0.

- [ ] **Step 2: Run and record**

Run: `npx vitest run src/app/documents-panel.test.tsx --maxWorkers=1`

Expected: FAIL — `shows the passive message instead of the box when read-only`. Record the tally.

- [ ] **Step 3: Revert Mutant A and prove clean**

Restore the line exactly, then `git diff --stat src/app/documents-panel.tsx` — expect no output.

- [ ] **Step 4: Mutant B — gate on the FILTERED list instead of the register**

Change the same line to:

```tsx
          onCreate={visibleRows.length === 0 && !isReadOnly ? handleCreate : undefined}
```

Verify it landed: `grep -c "visibleRows.length === 0 && !isReadOnly" src/app/documents-panel.tsx` returns 1.

★★★ **This mutant may SURVIVE, and that is information, not a failure of the task.** It is the exact defect the Task 3 docstring warns about, and no test written so far seeds an active entity filter over a non-empty register. If it survives, DO NOT fix the code — the code is already right. Report it, and add the missing test: a panel with documents present and an `entityFilter` matching none of them must show NO create box. Then re-run this mutant and confirm it now fails.

- [ ] **Step 5: Run, record, and act on the outcome**

Run the file. Record the tally and state plainly whether the mutant was killed or survived. If it survived, follow Step 4's instruction, commit the new test on its own (`test(documents): pin the create box to the unfiltered register`, plus the trailer), and re-run.

- [ ] **Step 6: Revert Mutant B and prove clean**

Restore the line, then `git diff --stat src/app/documents-panel.tsx` — expect no output.

- [ ] **Step 7: Mutant C — remove the image box's inherited read-only gate**

The image box has no guard of its own; it inherits one. Prove the inheritance is real rather than assumed. In `src/app/documents-asset-section.tsx` change the early return's condition:

```tsx
  const enabled = tursoConfig !== null && !isReadOnly;
```

to:

```tsx
  const enabled = tursoConfig !== null;
```

Verify it landed: `grep -c "tursoConfig !== null && !isReadOnly" src/app/documents-asset-section.tsx` drops from 1 to 0.

Run: `npx vitest run src/app/documents-asset-section.test.tsx --maxWorkers=1`

Expected: FAIL — `offers no box and keeps its own message in a read-only popout` (Task 4 Step 5). Record the tally. ★ Other tests in that file may also go red; that is fine and expected, since this mutant removes a real guard several assertions depend on. What matters is that the box-absence test is among the failures.

Revert by inverse anchored edit, assert the grep count returns to 1, and prove `git diff --stat src/app/documents-asset-section.tsx` prints nothing.

- [ ] **Step 8: Report**

Report all three tallies, the failing test names, and whether Mutant B needed a new test. If any mutant survived and you could not close it, stop rather than proceeding to Task 7.

---

## Task 7: Full gates

**Files:** none modified. This task produces no diff; if it produces one, something in Tasks 1-6 was left unreverted — find it rather than commit it.

- [ ] **Step 1: Typecheck**

`npx tsc --noEmit; echo "EXIT=$?"` → expect `EXIT=0`.

- [ ] **Step 2: Lint**

`npx eslint src; echo "EXIT=$?"` → expect `EXIT=0`.

- [ ] **Step 3: The touched test files**

Write the log to your own session scratchpad — never `/tmp`, which is shared across sessions and checkouts, where a peer's run has previously overwritten another agent's gate log and been read as its own result.

```bash
LOG="$SCRATCHPAD/gates.log"   # your session scratchpad path
npx vitest run src/app/documents-panel.test.tsx src/app/asset-library.test.tsx src/app/file-picker-button.test.tsx src/app/documents-asset-section.test.tsx src/app/i18n-encoding.test.ts --maxWorkers=1 > "$LOG" 2>&1
echo "EXIT=$?"
grep -E "Test Files|Tests " "$LOG"
```

Expected `EXIT=0`. The `echo` is on its own unpiped line — reading this through a pipe gives the pipe's status. Report the two lines verbatim.

- [ ] **Step 4: The size ratchet**

`npm run size:check; echo "EXIT=$?"` → expect `EXIT=0`. ★ NEVER run it with `--update`. For reference the starting counts were `documents-panel.tsx` 758, `asset-library.tsx` 402, `documents-list.tsx` 238, none with a `file-sizes.json` baseline, all against the 800 cap. Report `documents-panel.tsx`'s count measured the way the gate measures it, which is one MORE than `wc -l`:

```bash
node -e "console.log(require('fs').readFileSync('src/app/documents-panel.tsx','utf8').split('\n').length)"
```

- [ ] **Step 5: Prove the tree is clean**

```bash
git status --short
git diff --stat
```

Expected: only `M sample-workspace-huge.json` (a foreign writer's change) and `?? not-in-use.env.local.bak` (untracked, contains live secrets — do not stage it, do not open it, do not print its contents). Nothing else.

---

## Out of scope — do not add these

- **No change to the two `!enabled` asset messages** (`assetLibraryTursoOnly` / `assetLibraryReadOnly`) and no box in that branch.
- **No drag-and-drop onto either box.** `AssetLibrary` already has its own `onDrop`; a second drop target is a separate decision.
- **No image preview / lightbox.** That is the companion spec, `2026-09-02-asset-preview-lightbox-design.md`, and ships independently.
- **No change to `handleCreate`, `onUpload`, or any engine.**
- **No version bump, no `CHANGELOG.md` entry, no release.** This plan ends at Task 7.
