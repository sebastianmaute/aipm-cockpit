# Asset preview lightbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user look at an uploaded image full-size, from the image library and from an image already inserted in a document.

**Architecture:** One new modal component (`asset-preview-modal.tsx`) built on the shared `Modal` + `ModalHeader` primitives with `useDraggable` + `useResizable` for the window mechanics, copying `task-form-modal.tsx`. It is list-agnostic: callers hand it an ordered asset list and a start index. Byte loading is injected as a `loadImage` function prop, never a Turso config, so the component stays storage-agnostic and inherits Turso gating from its two call sites.

**Tech Stack:** React 19, Next 16, TypeScript, Tailwind v4, vitest + @testing-library/react.

**Branch:** `fix/turso-env-disclosure` at `15cf0149`, off `main` `2805ba57`. Fold into this branch — do NOT create a new one. No release, no version bump.

---

## Read before you start

- **`docs/AGENTS/ui-shell.md`, the "dismissal: Escape & Tab ownership" section.** It owns the Escape/Tab protocol for every modal in this app. You must NOT hand-roll dismissal. The shared `Modal` already joins `dismissal-stack.ts`, so Escape and the Tab trap are handled for you the moment you render inside it.
- **`src/app/task-form-modal.tsx:99-135` is the precedent to copy** — a draggable, resizable modal. It is `useDraggable(open, posKey)` → `{offset, reset, handleProps}` plus `useResizable(sizeKey)` → `{ref, reset}`, rendered as `<Modal>` → `<div data-modal-panel style={{transform: translate(offset)}} className="... resize ...">` → `<ModalHeader dragHandleProps={handleProps} onResetLayout={...}>`.
- **`src/app/asset-library-modal.tsx`** is the closest sibling (it is also a file you will modify) and shows the `ariaLabelledby` + `titleId` convention: the dialog's accessible name IS the heading a sighted user reads, so the two cannot drift.
- ★★ **`src/app/notes-window.tsx` is NOT the precedent, despite the spec naming it.** It is explicitly **NON-modal** — no backdrop, no focus trap — and it uses `useDraggableWindow` (a `onTitleBarMouseDown` mouse API) plus a hand-rolled conditional Escape claim, all three of which are correct *there* and wrong here. `ModalHeader` takes **pointer** handlers via `dragHandleProps`, which only `useDraggable` produces. Copying the notes-window block into a `Modal` child would register a second Escape claimer for one layer.
- **Do NOT use `EditModalShell`** (`edit-modal-chrome.tsx`). It is chrome for entity *edit* modals and carries `onSubmit`, `ModalFieldControls`, `useConfirm` and a save/delete footer. A lightbox is not a form.

## Repo landmines that apply to this work

- `src/app/*.ts(x)` and `e2e/*.ts` are **CRLF** (`i/lf w/crlf`). Use the **Edit** tool. **Never `Write`** on an existing file (it re-lines to LF) and **never `sed -i`** (it re-lines the whole file invisibly to `git diff`).
- **`src/app/i18n.de.ts` must never be touched with the Edit tool** — it corrupts umlauts and curls quotes. Patch it with a node utf8 write using `\r\n` anchors (exact recipe in Task 2).
- `npx tsc --noEmit` **exits 2** on diagnostics, not 1.
- `npm run lint` exits 1 from gitignored leftovers — use `npx eslint --max-warnings=0 src`.
- **Never read a gate's exit code through a pipe** — you get the pipe's status. Redirect to a file, echo `$?` unpiped, then grep the file.
- Never run two vitest processes at once. A vitest failure mentioning `Failed to start forks worker` is machine contention, not a red suite — re-run the file alone.
- Never `git add -A` or `git add .`. There is an untracked `not-in-use.env.local.bak` holding live credentials and a foreign-modified `sample-workspace-huge.json`. Stage named paths only.

## File Structure

| File | Responsibility |
|---|---|
| `src/app/asset-object-url.ts` | NEW. One exported function turning stored base64 + mime into an object URL or a typed refusal, so the lightbox does not reimplement the rule from scratch. ★★ It does NOT make the rule shared: no task here migrates `document-asset-images.ts`, which keeps its own inline copy, so the two agree by coincidence rather than by construction. Migrating it is a separate change — the two differ in check ORDER (this tests the blocked mime before decoding; `attachAssetImages` decodes first), so they disagree on bytes that are both undecodable and blocked. |
| `src/app/asset-object-url.test.ts` | NEW. Unit tests for the three outcomes. |
| `src/app/asset-preview-modal.tsx` | NEW. The lightbox: window chrome, image/unavailable states, prev/next, object-URL lifecycle. |
| `src/app/asset-preview-modal.test.tsx` | NEW. All behavioural tests including the revoke spy and the row-unique-names check. |
| `src/app/asset-library.tsx` | MODIFY. New optional `loadImage` prop; row image button opens the lightbox. |
| `src/app/documents-asset-section.tsx` | MODIFY. Thread the existing loader into `AssetLibrary`. |
| `src/app/asset-library-modal.tsx` | ★★ **NO CHANGE NEEDED.** `AssetLibraryModalProps extends AssetLibraryProps` and the component spreads `{...rest}` into `AssetLibrary`, so a new optional prop on the base interface reaches this mount for free. The plan listed it as MODIFY; it is not. |
| `src/app/document-preview.tsx` | MODIFY. Click/keyboard on an inserted `<img data-asset-id>` opens the lightbox. |
| `src/app/i18n.ts` / `src/app/i18n.de.ts` | MODIFY. New keys, EN/DE parity enforced by tsc. |

---

★★ **`git commit --only` CANNOT STAGE AN UNTRACKED FILE**, and every task here that CREATES one hits this. It fails with `error: pathspec '<path>' did not match any file(s) known to git`, which reads like a typo in the path. Two steps, both naming the paths explicitly — never `git add -A` or `git add .`, because this tree holds an untracked credentials file:

```bash
git add -- <exact paths>
git commit --only <exact paths> -m "..."
```

### Task 1: Shared object-URL helper

`document-asset-images.ts` already decodes stored base64 into an object URL, and its mime test is load-bearing: the check is **truthy** (`mime ? ... : ...`), not `!== undefined`, because an asset whose stored mime is `""` survives sanitising and has always rendered by content-sniffing. `isBlockedAssetMime` is a separate, third outcome. The lightbox must not reimplement this.

**Files:**
- Create: `src/app/asset-object-url.ts`
- Create: `src/app/asset-object-url.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/app/asset-object-url.test.ts`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { assetBytesToObjectUrl } from "./asset-object-url";

// A 1x1 transparent GIF, base64 — small, real, and decodes under jsdom's atob.
const TINY_GIF = "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

describe("assetBytesToObjectUrl", () => {
  beforeEach(() => {
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => "blob:stub-url"),
      revokeObjectURL: vi.fn(),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("returns an object URL for an allowed mime", () => {
    const r = assetBytesToObjectUrl(TINY_GIF, "image/png");
    expect(r).toEqual({ kind: "ok", url: "blob:stub-url" });
  });

  // ★★★ THE CASE A `!== undefined` TEST GETS WRONG. A blank mime survives
  // sanitising and such an asset has always rendered by content-sniffing, so
  // it must produce a URL, not a refusal.
  it("still returns a URL when the stored mime is blank", () => {
    const r = assetBytesToObjectUrl(TINY_GIF, "");
    expect(r).toEqual({ kind: "ok", url: "blob:stub-url" });
  });

  it("refuses a blocked mime without minting a URL", () => {
    const r = assetBytesToObjectUrl(TINY_GIF, "image/svg+xml");
    expect(r).toEqual({ kind: "blocked" });
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("reports undecodable bytes rather than throwing", () => {
    const r = assetBytesToObjectUrl("!!!not base64!!!", "image/png");
    expect(r).toEqual({ kind: "unavailable" });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run src/app/asset-object-url.test.ts --reporter=dot
```
Expected: FAIL — `Failed to resolve import "./asset-object-url"`.

- [ ] **Step 3: Write the implementation**

Create `src/app/asset-object-url.ts`:

```ts
// One decode for stored asset bytes, shared by the document preview's
// `attachAssetImages` and the asset preview lightbox.
//
// ★★★ THE MIME TEST IS TRUTHY, NOT `!== undefined`, AND THE DIFFERENCE BREAKS
// WORKING IMAGES. `sanitizeDocumentAsset` requires only an `id`; its mime is
// `sanitizeText(...)`, which yields "" for anything non-string — so a missing,
// blank or non-string mime survives every load path as "", and such an asset
// has always rendered by content-sniffing. Declining it would stamp a repair
// marker on an image that works.
// Both come from ONE module. `safeBase64ToBytes` (not `base64ToBytes`) is the
// variant `document-asset-images.ts` already uses: it returns null for a
// malformed row AND for an empty one, so no try/catch is needed here.
import { isBlockedAssetMime, safeBase64ToBytes } from "./document-asset-upload";

export type AssetObjectUrl =
  | { kind: "ok"; url: string }
  /** Metadata says a format we refuse to render (e.g. image/svg+xml). */
  | { kind: "blocked" }
  /** Bytes absent or undecodable — the dangling case. */
  | { kind: "unavailable" };

export function assetBytesToObjectUrl(base64: string, mime: string | undefined): AssetObjectUrl {
  if (isBlockedAssetMime(mime)) return { kind: "blocked" };
  const decoded = safeBase64ToBytes(base64);
  if (decoded === null) return { kind: "unavailable" };
  // Re-wrap onto a fresh, non-shared ArrayBuffer: the decoder returns
  // `Uint8Array<ArrayBufferLike>`, which admits SharedArrayBuffer and so does
  // not satisfy BlobPart on its own (mirrors use-document-assets.ts).
  const bytes = new Uint8Array(decoded);
  const blob = mime ? new Blob([bytes], { type: mime }) : new Blob([bytes]);
  return { kind: "ok", url: URL.createObjectURL(blob) };
}
```

★ Verified 2026-09-02: `isBlockedAssetMime` (`document-asset-upload.ts:51`) and `safeBase64ToBytes` (`:381`) both live in `./document-asset-upload`, and `document-asset-images.ts:13` imports exactly that pair. Do NOT hand-roll an `atob` loop and do NOT reach for `base64ToBytes`, which throws.

- [ ] **Step 4: Run the test**

```bash
npx vitest run src/app/asset-object-url.test.ts --reporter=dot
```
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/app/asset-object-url.ts src/app/asset-object-url.test.ts
git commit -m "refactor(assets): extract the stored-bytes to object-URL decode"
```

---

### Task 2: The i18n keys, EN and DE

**Files:**
- Modify: `src/app/i18n.ts` (near the existing `assetLibrary*` block, ~line 4268)
- Modify: `src/app/i18n.de.ts` (node write only — see the landmine)

- [ ] **Step 1: Add the EN keys**

Use the **Edit** tool on `src/app/i18n.ts`. Insert after `assetLibraryPasteDropZone`:

```ts
  assetPreviewTitle: "Preview – {0}",
  assetPreviewOpen: "Preview image – {0}",
  assetPreviewPrev: "Previous image",
  assetPreviewNext: "Next image",
  assetPreviewPosition: "{0} of {1}",
  assetPreviewUnavailable: "This image's data is missing, so it cannot be shown.",
  assetPreviewBlocked: "This image's format is no longer supported, so it cannot be shown.",
```

★ Placeholders are 0-based positional: `t(lang, "assetPreviewPosition", i + 1, total)` → `{0}`/`{1}`.

- [ ] **Step 2: Add the DE keys by node write, NEVER the Edit tool**

`i18n.de.ts` is CRLF and the Edit tool corrupts umlauts and curls quotes there. Both new DE strings below carry umlauts, so this is not optional. Run from the repo root:

```bash
node -e '
const fs = require("fs");
const p = "src/app/i18n.de.ts";
const s = fs.readFileSync(p, "utf8");
const anchor = "  assetLibraryPasteDropZone:";
if (s.split(anchor).length !== 2) throw new Error("anchor not unique: " + (s.split(anchor).length - 1));
const line = s.slice(s.indexOf(anchor)).split("\r\n")[0];
const add = [
  "  assetPreviewTitle: \"Vorschau – {0}\",",
  "  assetPreviewOpen: \"Bild anzeigen – {0}\",",
  "  assetPreviewPrev: \"Vorheriges Bild\",",
  "  assetPreviewNext: \"Nächstes Bild\",",
  "  assetPreviewPosition: \"{0} von {1}\",",
  "  assetPreviewUnavailable: \"Die Bilddaten fehlen, daher kann das Bild nicht angezeigt werden.\",",
  "  assetPreviewBlocked: \"Das Bildformat wird nicht mehr unterstützt, daher kann das Bild nicht angezeigt werden.\",",
].join("\r\n");
const out = s.replace(line, line + "\r\n" + add);
if (out === s) throw new Error("no replacement made");
fs.writeFileSync(p, out, "utf8");
console.log("ok");
'
```

- [ ] **Step 3: Verify the umlauts survived and the file is still CRLF**

```bash
node -e "const s=require('fs').readFileSync('src/app/i18n.de.ts','utf8');for(const k of ['assetPreviewNext','assetPreviewUnavailable','assetPreviewBlocked'])console.log(k, JSON.stringify(s.match(new RegExp(k+': \"([^\"]*)\"'))[1]));"
git ls-files --eol src/app/i18n.de.ts
node -e "const s=require('fs').readFileSync('src/app/i18n.de.ts','utf8');console.log('lone LF:',(s.match(/(?<!\r)\n/g)||[]).length)"
```
Expected: `"Nächstes Bild"` and the two long sentences (`"Die Bilddaten fehlen…"`, `"Das Bildformat wird nicht mehr unterstützt…"`) — real `ä`, straight `"` quotes; `w/crlf`; lone LF `0`. ★ Those three keys are exactly what the probe reads; there is no close key to check (see Task 3's note on `alertModalClose`).

- [ ] **Step 4: Typecheck — this is what enforces EN/DE parity**

```bash
npx tsc --noEmit > C:/Users/SEBAST~1.MAU/AppData/Local/Temp/claude/C--Projects-aipm-cockpit/628bd54e-9e78-4bdb-86f3-b2e46f1a8c77/scratchpad/tsc.log 2>&1; echo "EXIT=$?"
grep -E "^(src|e2e)/" C:/Users/SEBAST~1.MAU/AppData/Local/Temp/claude/C--Projects-aipm-cockpit/628bd54e-9e78-4bdb-86f3-b2e46f1a8c77/scratchpad/tsc.log || echo "no source diagnostics"
```
Expected: EXIT=0. A missing DE key fails here with a key-parity error.

- [ ] **Step 5: Commit**

```bash
git add src/app/i18n.ts src/app/i18n.de.ts
git commit -m "i18n: add the asset preview lightbox keys"
```

---

### Task 3: The lightbox shell — opens, closes, is labelled

Build the window chrome first, with a stub body. No image loading yet.

**Files:**
- Create: `src/app/asset-preview-modal.tsx`
- Create: `src/app/asset-preview-modal.test.tsx`

- [ ] **Step 1: Write the failing test**

★★★ **THE FIXTURE MIME MUST BE ON THE ALLOWLIST, AND `image/gif` IS NOT.** `ASSET_MIME_ALLOWED` (`document-asset-upload.ts:15`) is PNG + JPEG + WebP only — GIF is excluded deliberately ("downscaling re-encodes and would silently destroy animation"), so `isBlockedAssetMime("image/gif")` is `true`. Every fixture here therefore declares `image/png` while carrying GIF bytes, which is legitimate: the decode trusts the passed mime string and never sniffs content. Defaulting the fixture to `image/gif` (as an earlier revision of this plan did) makes every "shows the image" test in Tasks 3-6 render the BLOCKED state instead, which reads as a broken component rather than a bad fixture.


Create `src/app/asset-preview-modal.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AssetPreviewModal } from "./asset-preview-modal";
import { t } from "./i18n";
import type { DocumentAsset } from "./document-asset";

const TINY_GIF = "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

// ★ Every REQUIRED field of `DocumentAsset` (`document-asset.ts:27`), so no
// `as DocumentAsset` cast is needed — a cast would hide a field the real type
// gains later. `hash` is required; `width`/`height` are the only optionals.
function asset(id: string, name: string, mime = "image/png"): DocumentAsset {
  return { id, name, mime, size: 42, hash: `hash-${id}`, createdAt: "2026-01-01T00:00:00.000Z" };
}

function renderModal(over: Partial<Parameters<typeof AssetPreviewModal>[0]> = {}) {
  const onClose = vi.fn();
  const utils = render(
    <AssetPreviewModal
      lang="en-US"
      open
      onClose={onClose}
      assets={[asset("a", "Alpha"), asset("b", "Beta")]}
      startIndex={0}
      loadImage={vi.fn(async () => TINY_GIF)}
      {...over}
    />,
  );
  return { ...utils, onClose };
}

describe("AssetPreviewModal — shell", () => {
  it("renders nothing when closed", () => {
    renderModal({ open: false });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("labels the dialog with the current asset name", async () => {
    renderModal();
    expect(await screen.findByRole("dialog", { name: /Alpha/ })).toBeInTheDocument();
  });

  // ★ The ✕ is the SHARED ModalHeader's, named by the existing
  //   `alertModalClose` key — this component adds no close key of its own.
  it("closes from the shared header's close control", async () => {
    const { onClose } = renderModal();
    await userEvent.click(await screen.findByRole("button", { name: t("en-US", "alertModalClose") }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // ★★ Escape is handled by the shared `Modal` via dismissal-stack.ts. This
  // asserts we are INSIDE that machinery — it is not a test of our own key
  // handler, because we must not have one.
  it("closes on Escape through the shared modal machinery", async () => {
    const { onClose } = renderModal();
    await screen.findByRole("dialog");
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run src/app/asset-preview-modal.test.tsx --reporter=dot
```
Expected: FAIL — cannot resolve `./asset-preview-modal`.

- [ ] **Step 3: Write the shell**

Create `src/app/asset-preview-modal.tsx`. ★ Before writing, read `src/app/task-form-modal.tsx:99-135` for the drag/resize wiring — **not** `notes-window.tsx`, whose mouse-event API does not fit `ModalHeader` (see "Read before you start") — and `src/app/modal.tsx`'s `Modal` signature (`open`, `onClose`, `ariaLabel`, `ariaLabelledby`, `initialFocusRef`, `align`, `zIndex`). Confirm `ModalHeader`'s exact props with `grep -n "export function ModalHeader" -A 20 src/app/modal-header.tsx` — it lives in `modal-header.tsx`, so the same grep against `modal.tsx` returns nothing and reads as "no such export".

```tsx
"use client";

// The asset preview lightbox: a draggable, resizable modal that shows ONE
// uploaded image at a time and steps through the list the caller handed it.
//
// ★★★ DISMISSAL IS THE SHARED `Modal`'S JOB, NOT OURS. It joins
// `dismissal-stack.ts`, so Escape routing and the Tab trap are already correct
// and already stack-aware for a nested layer. Do NOT add a `useDismissable`,
// a `useFocusTrap`, or a document-level Escape listener here — a second
// claimer for one layer is exactly the double-fire the stack exists to stop.
// `notes-window.tsx` DOES hand-roll a conditional Escape claim; that is
// correct THERE because it is non-modal and stays open while the user works
// elsewhere. Do NOT copy its drag wiring either: it is `useDraggableWindow`'s
// mouse API, and `ModalHeader` takes only `useDraggable`'s pointer handlers.
// `task-form-modal.tsx` is the precedent for the window mechanics below.
//
// ★★ LIST-AGNOSTIC ON PURPOSE. "Next" means next in the list you opened this
// from — the library's current sort, or a document's visual order. A single
// global ordering would make "next" jump to an image that is not visible
// where the user clicked.
import { useCallback, useEffect, useRef, useState } from "react";
import { type Lang, t } from "./i18n";
import type { DocumentAsset } from "./document-asset";
import { Modal } from "./modal";
import { ModalHeader } from "./modal-header";
import { Button } from "./button";
import { useResizable } from "./use-resizable";
import { useDraggable } from "./use-draggable";
import { assetBytesToObjectUrl } from "./asset-object-url";

// ★ Both follow the established conventions and neither collides: the size
// keys in use are task-form / budget-bucket / sharepoint / shift-edit plus the
// `sizeKey` values passed through EditModalShell (absence-edit, calendar-event,
// change-edit, milestone-edit, raid-edit, resource-edit-v2, stakeholder-edit).
// Verify before changing either:
//   grep -rn "modal-size:\|modal-pos:" src/app --include=*.tsx | grep -v test
const STORAGE_KEY_POS = "aipm-cockpit:modal-pos:asset-preview";
const STORAGE_KEY_SIZE = "aipm-cockpit:modal-size:asset-preview";

const TITLE_ID = "asset-preview-modal-title";

export interface AssetPreviewModalProps {
  lang: Lang;
  open: boolean;
  onClose: () => void;
  /** The caller's own order. Prev/next walk THIS list, and do not wrap. */
  assets: readonly DocumentAsset[];
  startIndex: number;
  /** Injected byte loader — never a TursoConfig. Keeps this component
   *  storage-agnostic, and Turso gating stays inherited from the call site. */
  loadImage: (id: string) => Promise<string | null>;
}

export function AssetPreviewModal({
  lang, open, onClose, assets, startIndex, loadImage,
}: AssetPreviewModalProps) {
  const [index, setIndex] = useState(startIndex);
  const { offset, reset: dragReset, handleProps } = useDraggable(open, STORAGE_KEY_POS);
  const { ref: sizeRef, reset: sizeReset } = useResizable(STORAGE_KEY_SIZE);

  // Re-seed when a fresh open targets a different asset. Render-time reconcile,
  // NOT a useEffect — `react-hooks/set-state-in-effect` is banned and fatal.
  const [seenStart, setSeenStart] = useState(startIndex);
  if (startIndex !== seenStart) {
    setSeenStart(startIndex);
    setIndex(startIndex);
  }

  const current = assets[index];

  return (
    // `ariaLabelledby` over `ariaLabel` so the dialog's accessible name IS the
    // heading a sighted user reads and the two cannot drift — the convention
    // `asset-library-modal.tsx` states at its own Modal.
    <Modal open={open} onClose={onClose} ariaLabelledby={TITLE_ID} align="center">
      <div
        ref={sizeRef}
        data-modal-panel
        style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
        className="relative flex h-[720px] max-h-[95vh] min-h-[360px] w-[900px] min-w-[380px] max-w-[95vw] resize flex-col overflow-hidden rounded-xl border border-line bg-surface"
      >
        <ModalHeader
          lang={lang}
          title={t(lang, "assetPreviewTitle", current?.name ?? "")}
          titleId={TITLE_ID}
          onClose={onClose}
          dragHandleProps={handleProps}
          onResetLayout={() => { dragReset(); sizeReset(); }}
        />
        <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
          {/* body arrives in Task 4 */}
        </div>
      </div>
    </Modal>
  );
}
```

★ Verified 2026-09-02 against `task-form-modal.tsx:99-135`: `useDraggable(open, key)` returns `{offset, reset, handleProps}`; `useResizable(key)` returns `{ref, reset}`; `ModalHeader` (from `./modal-header`) takes `lang`, `title`, `titleId?`, `onClose`, `dragHandleProps?`, `headerExtra?`, `onResetLayout?`. It has **no** `closeLabel`: the ✕ is named by the existing `alertModalClose` key and the reset-layout button by `modalResetSize`, both supplied by the shared header. That is why Task 2 adds **no** close key — do not reintroduce one, and note both header buttons count toward Task 7's `minControls`.

- [ ] **Step 4: Run the test**

```bash
npx vitest run src/app/asset-preview-modal.test.tsx --reporter=dot
```
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add src/app/asset-preview-modal.tsx src/app/asset-preview-modal.test.tsx
git commit -m "feat(assets): add the asset preview lightbox shell"
```

---

### Task 4: Load the image, and revoke every object URL

★★★ **TASKS 4 AND 5 MUST BE DONE AS ONE UNIT.** Task 4's central test — "revokes the previous object URL when navigating" — clicks the `assetPreviewNext` button, which Task 5 is what creates. Split, Task 4 cannot go green on its own, and an implementer following the steps literally hits a red run that looks like a broken effect and is nothing of the kind. Implement Task 5's prev/next controls first (or both before running anything), then run the two suites together. They may land as one commit or two; the ordering below is narrative, not a dependency order.

★★★ A leaked object URL is invisible to every assertion except an explicit `revokeObjectURL` spy. Every arrow-press mints a new URL, so revoking only on close leaks one per navigation for the life of the session.

**Files:**
- Modify: `src/app/asset-preview-modal.tsx`
- Modify: `src/app/asset-preview-modal.test.tsx`

- [ ] **Step 1: Write the failing tests**

Append to `asset-preview-modal.test.tsx`:

```tsx
describe("AssetPreviewModal — object URL lifecycle", () => {
  let created: string[];
  let revoked: string[];
  beforeEach(() => {
    created = [];
    revoked = [];
    let n = 0;
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => { const u = `blob:${++n}`; created.push(u); return u; }),
      revokeObjectURL: vi.fn((u: string) => { revoked.push(u); }),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("shows the image with the asset name as alt text", async () => {
    renderModal();
    const img = await screen.findByRole("img", { name: "Alpha" });
    expect(img).toHaveAttribute("src", created[0]);
  });

  // ★★★ THE LEAK TEST. Navigating mints a new URL; the previous one must be
  // revoked at that moment, not merely at close.
  it("revokes the previous object URL when navigating", async () => {
    renderModal();
    await screen.findByRole("img", { name: "Alpha" });
    await userEvent.click(screen.getByRole("button", { name: t("en-US", "assetPreviewNext") }));
    await screen.findByRole("img", { name: "Beta" });
    expect(revoked).toContain(created[0]);
  });

  it("revokes the current object URL on close", async () => {
    const { rerender } = renderModal();
    await screen.findByRole("img", { name: "Alpha" });
    rerender(
      <AssetPreviewModal
        lang="en-US" open={false} onClose={vi.fn()}
        assets={[asset("a", "Alpha"), asset("b", "Beta")]}
        startIndex={0} loadImage={vi.fn(async () => TINY_GIF)}
      />,
    );
    expect(revoked).toContain(created[created.length - 1]);
  });
});
```

- [ ] **Step 2: Run and watch them fail**

```bash
npx vitest run src/app/asset-preview-modal.test.tsx --reporter=dot
```
Expected: FAIL — no `img` role found (body is still a stub).

- [ ] **Step 3: Implement loading + revocation**

Add to `asset-preview-modal.tsx`, inside the component above the `return`:

```tsx
  const [view, setView] = useState<{ kind: "ok"; url: string } | { kind: "blocked" } | { kind: "unavailable" } | null>(null);
  // Holds the URL currently minted so cleanup revokes exactly one thing.
  const urlRef = useRef<string | null>(null);

  const release = useCallback(() => {
    if (urlRef.current) { URL.revokeObjectURL(urlRef.current); urlRef.current = null; }
  }, []);

  // ★★★ REVOKE ON NAVIGATE **AND** ON CLOSE. This effect's cleanup covers
  // both: it runs when `id` changes (navigate) and on unmount/close. Revoking
  // only in a close handler leaks one URL per arrow-press for the whole
  // session, and nothing but a revokeObjectURL spy can see it.
  const id = current?.id;
  useEffect(() => {
    if (!open || !id) return;
    let cancelled = false;
    void (async () => {
      // ★★★ `setView(null)` MUST BE INSIDE THIS IIFE, NOT ABOVE IT. As a bare
      // statement in the effect body it is a FATAL `react-hooks/set-state-in-
      // effect` error, not a warning. Nesting it changes NOTHING at runtime —
      // an async function body runs synchronously up to its first `await`, so
      // this still clears the stale image on the effect's own tick; it only
      // changes what the rule can see. Do not "simplify" it back out.
      setView(null);
      const base64 = await loadImage(id).catch(() => null);
      if (cancelled) return;
      if (base64 === null) { setView({ kind: "unavailable" }); return; }
      const r = assetBytesToObjectUrl(base64, current?.mime);
      if (cancelled) { if (r.kind === "ok") URL.revokeObjectURL(r.url); return; }
      if (r.kind === "ok") urlRef.current = r.url;
      setView(r);
    })();
    return () => { cancelled = true; release(); };
    // `current?.mime` is intentionally read inside; `id` identifies the asset.
  }, [open, id, loadImage, release, current?.mime]);
```

And replace the body placeholder with:

```tsx
          {view?.kind === "ok" && (
            // eslint-disable-next-line @next/next/no-img-element -- a blob: URL has nothing for next/image to optimise
            <img src={view.url} alt={current?.name ?? ""} className="min-h-0 flex-1 object-contain" />
          )}
          {view?.kind === "unavailable" && (
            <p className="flex-1 p-4 text-sm text-muted-foreground">{t(lang, "assetPreviewUnavailable")}</p>
          )}
          {view?.kind === "blocked" && (
            <p className="flex-1 p-4 text-sm text-muted-foreground">{t(lang, "assetPreviewBlocked")}</p>
          )}
```

★★ **THREE THINGS IN THIS SNIPPET FAIL THE GATES AS WRITTEN, all fatal under `--max-warnings=0`.** (a) The test file's vitest import must be widened to include `beforeEach`/`afterEach` — Task 3 correctly trimmed them as unused, so pasting the block above throws `ReferenceError: beforeEach is not defined` and collects ZERO tests, which reads as a broken suite rather than a missing import. (b) `setView(null)` in the effect body is a fatal `react-hooks/set-state-in-effect` error (fixed inline above). (c) The `<img>` trips `@next/next/no-img-element`, a WARNING and therefore fatal here — the repo's established answer is a targeted disable, as in `branding-image-input.tsx`, `app-header.tsx`, `sidebar.tsx` and `project-empty-state.tsx`.

★ If `react-hooks/exhaustive-deps` objects to `current?.mime` as a member expression, hoist it: `const currentMime = current?.mime;` and depend on `currentMime`. That rule is **fatal** here (`--max-warnings=0`).

- [ ] **Step 4: Run the tests**

```bash
npx vitest run src/app/asset-preview-modal.test.tsx --reporter=dot
```
Expected: PASS (Task 3's 4 + these 3; the navigate test needs Task 5's button, so if `assetPreviewNext` does not exist yet, do Task 5 first and re-run — the two are ordered this way only for narrative).

- [ ] **Step 5: Commit**

```bash
git add src/app/asset-preview-modal.tsx src/app/asset-preview-modal.test.tsx
git commit -m "feat(assets): load preview bytes and revoke every object URL"
```

---

### Task 5: Prev/next that do not wrap

**Files:**
- Modify: `src/app/asset-preview-modal.tsx`
- Modify: `src/app/asset-preview-modal.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
describe("AssetPreviewModal — navigation", () => {
  it("disables previous at the first item and next at the last", async () => {
    renderModal({ startIndex: 0 });
    await screen.findByRole("dialog");
    expect(screen.getByRole("button", { name: t("en-US", "assetPreviewPrev") })).toBeDisabled();
    expect(screen.getByRole("button", { name: t("en-US", "assetPreviewNext") })).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: t("en-US", "assetPreviewNext") }));
    expect(screen.getByRole("button", { name: t("en-US", "assetPreviewNext") })).toBeDisabled();
    expect(screen.getByRole("button", { name: t("en-US", "assetPreviewPrev") })).toBeEnabled();
  });

  // ★★ NO WRAPPING, DECIDED DELIBERATELY. With two images, wrapping makes
  // "next" and "previous" land on the same picture, which reads as a broken
  // control.
  it("does not wrap past the end", async () => {
    renderModal({ startIndex: 1 });
    await screen.findByRole("dialog");
    const next = screen.getByRole("button", { name: t("en-US", "assetPreviewNext") });
    expect(next).toBeDisabled();
    await userEvent.click(next);
    expect(await screen.findByRole("dialog", { name: /Beta/ })).toBeInTheDocument();
  });

  it("renders position as 'n of total'", async () => {
    renderModal({ startIndex: 0 });
    expect(await screen.findByText(t("en-US", "assetPreviewPosition", 1, 2))).toBeInTheDocument();
  });

  it("renders inert navigation for a single-asset list", async () => {
    renderModal({ assets: [asset("solo", "Solo")], startIndex: 0 });
    await screen.findByRole("dialog");
    expect(screen.getByRole("button", { name: t("en-US", "assetPreviewPrev") })).toBeDisabled();
    expect(screen.getByRole("button", { name: t("en-US", "assetPreviewNext") })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run and watch them fail**

```bash
npx vitest run src/app/asset-preview-modal.test.tsx -t "navigation" --reporter=dot
```
Expected: FAIL — no prev/next buttons.

- [ ] **Step 3: Implement**

Add above the `return`:

```tsx
  const atFirst = index <= 0;
  const atLast = index >= assets.length - 1;
  const go = useCallback((delta: number) => {
    setIndex((i) => Math.min(Math.max(i + delta, 0), assets.length - 1));
  }, [assets.length]);
```

Add into the body, below the image block:

```tsx
          <div className="flex items-center justify-between gap-2">
            <Button variant="secondary" size="sm" onClick={() => go(-1)} disabled={atFirst}
              aria-label={t(lang, "assetPreviewPrev")}>
              {t(lang, "assetPreviewPrev")}
            </Button>
            <span className="text-xs tabular-nums text-muted-foreground">
              {t(lang, "assetPreviewPosition", index + 1, assets.length)}
            </span>
            <Button variant="secondary" size="sm" onClick={() => go(1)} disabled={atLast}
              aria-label={t(lang, "assetPreviewNext")}>
              {t(lang, "assetPreviewNext")}
            </Button>
          </div>
```

★★ **Do NOT add a document-level Left/Right key listener.** Put arrow handling on the panel element (`onKeyDown` on the `div ref={panelRef}`) so it cannot fight the modal's focus trap, and call `e.preventDefault()` only when you actually consume the key. A disabled button dispatches no events, so the end state is carried by `disabled`, which is also visible before it is pressed.

- [ ] **Step 4: Run the tests**

```bash
npx vitest run src/app/asset-preview-modal.test.tsx --reporter=dot
```
Expected: PASS, all of Tasks 3-5.

- [ ] **Step 5: Commit**

```bash
git add src/app/asset-preview-modal.tsx src/app/asset-preview-modal.test.tsx
git commit -m "feat(assets): step through the preview list without wrapping"
```

---

### Task 6: Unavailable and blocked states, and navigating past them

**Files:**
- Modify: `src/app/asset-preview-modal.test.tsx`

The rendering already landed in Task 4; this task proves it and proves navigation survives it.

- [ ] **Step 1: Write the failing tests**

```tsx
describe("AssetPreviewModal — degraded assets", () => {
  it("states that the data is missing rather than rendering a broken image", async () => {
    renderModal({ loadImage: vi.fn(async () => null) });
    expect(await screen.findByText(t("en-US", "assetPreviewUnavailable"))).toBeInTheDocument();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("states that the format is unsupported for a blocked mime", async () => {
    renderModal({ assets: [asset("a", "Alpha", "image/svg+xml"), asset("b", "Beta")] });
    expect(await screen.findByText(t("en-US", "assetPreviewBlocked"))).toBeInTheDocument();
    expect(screen.queryByRole("img")).toBeNull();
  });

  // ★★ Navigation must still work PAST a broken asset — otherwise one missing
  // image strands the user on it.
  it("navigates past an unavailable asset", async () => {
    const loadImage = vi.fn(async (id: string) => (id === "a" ? null : TINY_GIF));
    renderModal({ loadImage });
    await screen.findByText(t("en-US", "assetPreviewUnavailable"));
    await userEvent.click(screen.getByRole("button", { name: t("en-US", "assetPreviewNext") }));
    expect(await screen.findByRole("img", { name: "Beta" })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run**

```bash
npx vitest run src/app/asset-preview-modal.test.tsx -t "degraded" --reporter=dot
```
Expected: PASS if Task 4 is correct. If the blocked case fails, check that `mime` is being passed into `assetBytesToObjectUrl` — a missed pass makes blocked and ok indistinguishable.

- [ ] **Step 3: Commit**

```bash
git add src/app/asset-preview-modal.test.tsx
git commit -m "test(assets): pin the preview's unavailable and blocked states"
```

---

### Task 7: Row-unique accessible names

★★★ The axe gate **cannot** see two controls sharing an accessible name, in any view, at any seed size. A unit test is the only possible detector. Use the shared helper — never a hand-rolled enumeration.

**Files:**
- Modify: `src/app/asset-preview-modal.test.tsx`

- [ ] **Step 1: Read the helper's contract first**

```bash
sed -n '1,60p' src/test/row-unique-names.ts
```
Note what `minControls` proves (only non-emptiness — it counts controls of the requested roles over the whole document unless `scope` is passed) and what `requireCollisionSeed` does.

- [ ] **Step 2: Write the test**

```tsx
import { expectRowUniqueNames } from "../test/row-unique-names";

describe("AssetPreviewModal — accessible names", () => {
  it("gives every control in the dialog a distinct accessible name", async () => {
    renderModal();
    const dialog = await screen.findByRole("dialog");
    // ★ `scope` is load-bearing: without it the helper counts every button in
    // the document. `minControls` is the MEASURED count for this dialog —
    // prev, next, plus the shared ModalHeader's ✕ (`alertModalClose`) and its
    // reset-layout button (`modalResetSize`), which `onResetLayout` renders.
    // Keep it exact; a floor set too low passes silently.
    expectRowUniqueNames({ scope: dialog, minControls: 4, roles: ["button"] });
  });

  // ★★★ NOTHING ELSE PINS `ariaLabelledby` OVER `ariaLabel`, and the obvious
  // test does not. Task 3's "labels the dialog with the current asset name"
  // matches on the COMPUTED accessible name, so switching the component to
  // `ariaLabel` with the identical string passes it unchanged. `ModalProps` is
  // a discriminated union, so the compiler forces you to pass exactly one of
  // the two — but it does not care WHICH, and the entire reason for choosing
  // `ariaLabelledby` is that the dialog's name and the heading a sighted user
  // reads then CANNOT drift apart. Assert the mechanism, not the string.
  it("names the dialog FROM its visible heading, so the two cannot drift", async () => {
    renderModal();
    const dialog = await screen.findByRole("dialog");
    const labelledBy = dialog.getAttribute("aria-labelledby");
    expect(labelledBy, "the dialog must be labelled BY an element, not by a bare string").toBeTruthy();
    const heading = document.getElementById(labelledBy!);
    expect(heading, `no element with id "${labelledBy}"`).not.toBeNull();
    // The heading a sighted user reads carries the asset name, and it is the
    // SAME node the accessible name resolves to.
    expect(heading).toHaveTextContent("Alpha");
  });
});
```

- [ ] **Step 3: Run, and measure the real floor**

```bash
npx vitest run src/app/asset-preview-modal.test.tsx -t "accessible names" --reporter=dot
```
If it fails with `minControls is 3 but the scope rendered N`, **set `minControls` to N** — the helper's rule is that the floor sits at its exact measured value. Do not round it down to make it pass.

- [ ] **Step 4: Commit**

```bash
git add src/app/asset-preview-modal.test.tsx
git commit -m "test(assets): pin the preview controls to distinct accessible names"
```

---

### Task 7b: Two fixes that MUST land before Task 8 wires a real call site

Both were found reviewing Tasks 4+5. Both are cheap now and expensive later.

**1. ★★★ `loadImage` MUST COME OUT OF THE EFFECT'S DEPENDENCY ARRAY.** It is a FUNCTION prop, and the natural way to write either call site — `loadImage={(id) => loadAssetData(cfg, id, projectId)}` — is a NEW IDENTITY on every render of the parent. With it in the deps, any incidental parent re-render while the modal is open fires the cleanup, which revokes **the URL currently on screen**, blanks the image and refetches. That is not a leak; it is the opposite, a revoke that happens neither on navigate nor on close, and it reaches a user as "the preview flickers sometimes".

It is unreachable TODAY only because no call site exists yet (`grep -rn "AssetPreviewModal" src/app --include=*.tsx | grep -v asset-preview-modal` returns nothing). Task 8 is what makes it reachable, so it is fixed first.

Use a latest-ref so the effect always calls the current loader without depending on its identity:

```tsx
const loadImageRef = useRef(loadImage);
useEffect(() => { loadImageRef.current = loadImage; });
```
then call `loadImageRef.current(id)` in the loading effect and drop `loadImage` from its deps. `react-hooks/exhaustive-deps` does not flag `.current` reads, so this needs no disable comment — ★ but VERIFY that against `npx eslint --max-warnings=0`, because every warning is fatal here. If assigning the ref during render passes the gates it is shorter, but the effect form above is the one that cannot trip a render-purity rule; use whichever is green and say which.

★★ Do NOT "fix" this by asking Tasks 8 and 9 to wrap their loaders in `useCallback`. Nothing enforces that, it silently regresses the first time someone writes the obvious inline arrow, and the failure is invisible until a user reports flicker.

**2. `view`'s state type duplicates `AssetObjectUrl` verbatim.** That type is exported by `./asset-object-url` and already imported in this file for `assetBytesToObjectUrl`. Replace the inline union with `useState<AssetObjectUrl | null>(null)` plus `import type { AssetObjectUrl } from "./asset-object-url";`. Structurally identical today, so nothing breaks — the point is that a third outcome added to the helper must not be able to leave this component silently behind.

**Optional, if cheap:** `loadImage(id).catch(() => null)` collapses a thrown loader error and "no bytes stored" into one indistinguishable state with no diagnostics. The user-facing side is covered by the unavailable message, so no toast — but a `reportSilentFailure` (`guard-feedback.ts:11`) or a `console.error` on the catch keeps a real loader failure legible in the diagnostics ring.

---

### Task 8: Entry point A — open from an image library row

`AssetLibrary` has **no** `tursoConfig` and **no** `projectId`, so it cannot call `loadAssetData` itself. Thread the loader instead.

★★★ **THREE THINGS ALREADY EXIST THAT THIS TASK WAS ABOUT TO REINVENT.**

1. **The type.** `AssetByteLoader` (`document-asset-images.ts:15`) is `(id: string) => Promise<string | null>` — byte-identical to the `loadImage` signature this plan invented. Import it; do not redeclare it. `AssetPreviewModal`'s own prop should use it too.
2. **The loader, gated.** `assetPaneLoader(pane)` (`documents-asset-section.tsx:102`, exported and already used twice by `documents-panel.tsx` for downloads) returns `AssetByteLoader | undefined`, returning `undefined` when the config or project id is missing. That `undefined` IS the Turso gate — Decision 6's "inherited, never re-implemented" is satisfied by using it rather than writing a new check.
3. **The second mount needs no code.** See the File Structure note on `asset-library-modal.tsx`.

★★ **BUT `assetPaneLoader` AND THE SECTION DISAGREE ABOUT A BLANK PROJECT ID, and the preview is where it would show.** `assetPaneLoader` bails on a falsy `projectId`; `DocumentsAssetSection` normalises it (`assetPane?.projectId || ASSET_PARTITION_FALLBACK`, and the comment above that line explains at length why the blank case must not open a second partition). So for a blank id, upload/rename/delete all work against the fallback partition while `assetPaneLoader` returns `undefined` — the preview affordance would silently not render on a pane where every other asset control works.

Prefer building the loader from the section's OWN already-normalised `tursoConfig` and `projectId` locals, so the preview cannot disagree with the surface it sits on. If you instead reuse `assetPaneLoader`, say so and say why. Either way, REPORT the divergence — it is pre-existing and affects downloads today, and it is not this task's job to fix it.

**Files:**
- Modify: `src/app/asset-library.tsx`
- Modify: `src/app/documents-asset-section.tsx`
- Modify: `src/app/asset-library-modal.tsx`
- Modify: `src/app/asset-library.test.tsx`

- [ ] **Step 1: Confirm the loader already exists at the section level**

```bash
sed -n '100,110p' src/app/documents-asset-section.tsx
grep -rn "<AssetLibrary" src/app --include=*.tsx | grep -v test
```
Expected: a `(id: string) => loadAssetData(config, id, projectId)` builder, and **two** mount sites.

- [ ] ★★★ **THE TWO SNIPPETS BELOW ARE BOTH WRONG, and the second is a WCAG 2.4.6 VIOLATION the axe gate cannot see.** `asset-library.test.tsx`'s fixture deliberately gives BOTH assets the name `"image.png"` — it is that file's collision fixture, and the collision is the point.

So: (a) `findByRole("dialog", { name: new RegExp(assets[1].name) })` matches whichever row you clicked, and cannot prove `startIndex` tracked the right one — assert on the position text (`assetPreviewPosition`, "2 of 2") instead. (b) `aria-label={t(lang, "assetPreviewOpen", asset.name)}` gives the two rows an IDENTICAL accessible name, which is the exact defect the rest of this file exists to prevent, and no gate in this repo would report it.

Use the row TOKEN, not the raw name. `asset-library.tsx` already computes `buildRowTokens(sorted)` and every existing per-row control is named from it; the new control must use the same map. Substituting the token into `assetPreviewOpen` yields the same `"verb – token"` shape `rowLabel` produces, so it is that mechanism, not a second one.

**Step 2: Write the failing test**

Append to `src/app/asset-library.test.tsx`:

```tsx
it("opens the preview from a row and starts on that row's image", async () => {
  render(<AssetLibrary {...base} loadImage={vi.fn(async () => "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7")} />);
  const openers = screen.getAllByRole("button", { name: /^Preview image – / });
  expect(openers.length).toBe(base.assets.length);
  await userEvent.click(openers[1]);
  expect(await screen.findByRole("dialog", { name: new RegExp(base.assets[1].name) })).toBeInTheDocument();
});

// ★ Without a loader there is nothing to show, so no false affordance.
it("offers no preview control when no loader is supplied", () => {
  render(<AssetLibrary {...base} />);
  expect(screen.queryByRole("button", { name: /^Preview image – / })).toBeNull();
});
```

- [ ] **Step 3: Run and watch it fail**

```bash
npx vitest run src/app/asset-library.test.tsx --reporter=dot
```
Expected: FAIL — no matching buttons.

- [ ] **Step 4: Implement**

In `asset-library.tsx`, add to `AssetLibraryProps`:

```tsx
  /** Injected byte loader. Absent → no preview affordance renders (there
   *  would be nothing to show). Turso gating is INHERITED: the only mounts
   *  that can supply this already require `tursoConfig !== null`. */
  loadImage?: (id: string) => Promise<string | null>;
```

Add state and the modal mount, and a per-row opener button whose name is row-unique (`t(lang, "assetPreviewOpen", asset.name)`); render it only when `loadImage` is supplied. Preview is **not** gated on `isReadOnly` or `busyId` — it mutates nothing.

In `documents-asset-section.tsx`, pass the existing loader to both `AssetLibrary` mounts. In `asset-library-modal.tsx`, forward a `loadImage` prop through so the modal mount behaves identically.

- [ ] **Step 5: Run**

```bash
npx vitest run src/app/asset-library.test.tsx src/app/documents-asset-section.test.tsx --reporter=dot
```
Expected: PASS, including the pre-existing tests unchanged.

- [ ] **Step 6: Commit**

```bash
git add src/app/asset-library.tsx src/app/asset-library.test.tsx src/app/documents-asset-section.tsx src/app/asset-library-modal.tsx
git commit -m "feat(assets): open the preview from an image library row"
```

---

### Task 9: Entry point B — open from an inserted image

**Files:**
- Modify: `src/app/document-preview.tsx`
- Modify: `src/app/document-preview.test.tsx`

- [ ] **Step 1: Read how images are attached**

```bash
sed -n '120,150p' src/app/document-preview.tsx
```
`attachAssetImages` resolves `<img data-asset-id>` inside a ref'd container. The images are injected into DOM the component does not render declaratively, so the opener must be a delegated listener on the container, not a React `onClick` per image.

- [ ] **Step 2: Write the failing test**

```tsx
it("opens the preview when an inserted image is activated", async () => {
  // Render a document containing one asset image, then click it.
  // (Mirror the fixture the existing image tests in this file use.)
  renderPreview(/* doc with an <img data-asset-id="a"> block */);
  const img = await screen.findByRole("img", { name: /Alpha/ });
  await userEvent.click(img);
  expect(await screen.findByRole("dialog", { name: /Alpha/ })).toBeInTheDocument();
});
```

★ Match the existing fixture helpers in `document-preview.test.tsx` rather than inventing one — read the file's existing image tests first and reuse their document shape.

- [ ] **Step 3: Implement**

Add a delegated `click` handler on the preview container that finds `closest("img[data-asset-id]")`, collects the ordered ids of every `img[data-asset-id]` in the container (that IS the document's visual order — the correct list for this surface), and opens `AssetPreviewModal` at the clicked index with a loader built from the `tursoConfig`/`projectId` already in scope.

★★ **Keyboard reachability is required** — a click-only region fails the spec's trigger rule. Give each asset image `tabIndex=0`, `role="button"` and an Enter/Space handler, or wrap it in a real button during attach. Verify with `userEvent.tab()`, never `.focus()`.

- [ ] **Step 4: Run**

```bash
npx vitest run src/app/document-preview.test.tsx --reporter=dot
```

- [ ] **Step 5: Commit**

```bash
git add src/app/document-preview.tsx src/app/document-preview.test.tsx
git commit -m "feat(assets): open the preview from an inserted document image"
```

---

### Task 10: Focus returns to the opener

**Files:**
- Modify: `src/app/asset-library.test.tsx`

- [ ] **Step 1: Write the test**

```tsx
it("returns focus to the row control that opened the preview", async () => {
  render(<AssetLibrary {...base} loadImage={vi.fn(async () => TINY_GIF)} />);
  const opener = screen.getAllByRole("button", { name: /^Preview image – / })[0];
  await userEvent.click(opener);
  await screen.findByRole("dialog");
  await userEvent.keyboard("{Escape}");
  expect(opener).toHaveFocus();
});
```

- [ ] **Step 2: Run**

```bash
npx vitest run src/app/asset-library.test.tsx -t "returns focus" --reporter=dot
```

- [ ] **Step 3: Implement if red**

Keep a ref to the opening element and restore focus in the close handler. ★ Check whether the shared `Modal` already restores focus to the previously-focused element before adding your own — if it does, this test simply passes and you add nothing.

- [ ] **Step 4: Commit**

```bash
git add src/app/asset-library.tsx src/app/asset-library.test.tsx
git commit -m "test(assets): pin focus returning to the preview's opener"
```

---

### Task 11: Full gates

- [ ] **Step 1: Typecheck**

```bash
npx tsc --noEmit > C:/Users/SEBAST~1.MAU/AppData/Local/Temp/claude/C--Projects-aipm-cockpit/628bd54e-9e78-4bdb-86f3-b2e46f1a8c77/scratchpad/tsc.log 2>&1; echo "EXIT=$? (2 means diagnostics)"
grep -E "^(src|e2e)/" C:/Users/SEBAST~1.MAU/AppData/Local/Temp/claude/C--Projects-aipm-cockpit/628bd54e-9e78-4bdb-86f3-b2e46f1a8c77/scratchpad/tsc.log || echo "no source diagnostics"
```
★ Diagnostics under `.next/` are a corrupted dev cache, not your code — clear with PowerShell `Remove-Item -Recurse -Force .next` (never `rm -rf`, it is gate-blocked) with the dev server stopped.

- [ ] **Step 2: Lint at CI strictness**

```bash
npx eslint --max-warnings=0 src; echo "EXIT=$?"
```
Expected: 0. Warnings are fatal in CI.

- [ ] **Step 3: Touched unit files**

```bash
npx vitest run src/app/asset-object-url.test.ts src/app/asset-preview-modal.test.tsx src/app/asset-library.test.tsx src/app/documents-asset-section.test.tsx src/app/document-preview.test.tsx --reporter=dot > C:/Users/SEBAST~1.MAU/AppData/Local/Temp/claude/C--Projects-aipm-cockpit/628bd54e-9e78-4bdb-86f3-b2e46f1a8c77/scratchpad/units.log 2>&1
echo "EXIT=$?"
grep -E "Test Files|Tests " C:/Users/SEBAST~1.MAU/AppData/Local/Temp/claude/C--Projects-aipm-cockpit/628bd54e-9e78-4bdb-86f3-b2e46f1a8c77/scratchpad/units.log
```

- [ ] **Step 4: Size ratchet**

```bash
npm run size:check; echo "EXIT=$?"
```
`asset-library.tsx` and `documents-asset-section.tsx` both grow here. Measure with the gate's own arithmetic if it fails:
```bash
node -e "console.log(require('fs').readFileSync('src/app/asset-library.tsx','utf8').split('\n').length)"
```

- [ ] **Step 5: Commit any fixes**

```bash
git add <named paths>
git commit -m "fix(assets): satisfy the gates for the preview lightbox"
```

---

## Self-review notes

**Spec coverage.** Decision 1 (modal not popout) → Task 3. Decision 2 (drag/resize on existing hooks, correct storage key) → Task 3. Decision 3 (both entry points, caller-supplied order) → Tasks 8, 9. Decision 4 (revoke on navigate and close) → Task 4. Decision 5 (missing renders a message, navigation works past it) → Task 6. Decision 6 (available in read-only, Turso inherited) → Task 8, via the `loadImage` injection. Decision 7 (accessible name, keyboard, unique names, alt) → Tasks 3, 5, 7, 9, 10.

**Deviations from the spec, and why.**
1. The spec models two failure states; the code has **three**. `isBlockedAssetMime` is a distinct outcome the library already surfaces as `assetLibraryBlocked`, so the plan adds `assetPreviewBlocked` rather than showing a blocked image as "data missing", which would be a false statement to the user.
2. The spec says `AssetLibrary` opens the lightbox but does not say how it gets bytes. It has neither `tursoConfig` nor `projectId`. The plan injects a `loadImage` function — which is also what keeps Turso gating *inherited* rather than re-implemented, as Decision 6 requires.
3. **The spec's named precedent is wrong and the plan replaces it.** `notes-window.tsx` is non-modal and uses `useDraggableWindow`, a mouse-event API; `ModalHeader` accepts only `dragHandleProps` **pointer** handlers, which `useDraggable` produces. The precedent is `task-form-modal.tsx` — the app's actual draggable+resizable modal. The spec was right that the hooks are `useDraggable`/`useResizable`; only its example file was wrong.
4. The spec implies a bespoke close control. The shared `ModalHeader` already renders the ✕ (named by the existing `alertModalClose` key) and a reset-layout button, so this component adds **no** close key of its own — an `assetPreviewClose` key was drafted and then removed rather than shipped unused.

**API facts verified 2026-09-02, not assumed.** `isBlockedAssetMime` `document-asset-upload.ts:51` · `safeBase64ToBytes` `:381` (returns null for malformed AND empty) · `ModalHeader` lives in `./modal-header`, not `./modal` · `useDraggable(open, key) → {offset, reset, handleProps}` · `useResizable(key) → {ref, reset}` · `AssetLibrary` has two mount sites and neither `tursoConfig` nor `projectId` in its props.

**Known gap.** `document-preview.tsx` injects images imperatively via `attachAssetImages`, so Task 9's opener is a delegated listener plus added keyboard affordances on nodes React does not own. That is the least-specified task here; read the existing image tests in `document-preview.test.tsx` before writing it, and expect to adjust the fixture shape.
