# Document-image disclosure — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the document-image surface reporting two false states — a healthy asset marked dangling by a late diff (§213), and a policy-declined asset wearing the missing-bytes marker while the library calls its row healthy (§230).

**Architecture:** Epoch-keyed suppression in `use-document-assets.ts` closes the §213 race without touching the diff effect's dependency array (which would break the §212 test). A shared `isBlockedAssetMime` predicate, exported once from `document-asset-upload.ts`, lets `document-asset-images.ts` and `asset-library.tsx` agree on what "refused" means; a new `data-asset-blocked` attribute splits the sink.

**Tech Stack:** Next.js 16 / React / TypeScript, vitest + Testing Library, Playwright (crossengine), Tailwind v4.

**Spec:** `docs/superpowers/specs/2026-08-31-document-image-disclosure-design.md`

---

## Standing constraints for every task

- **Every `src/app/*.ts(x)` file is CRLF.** Use the `Edit` tool, never `Write` (which re-lines to LF) and never `sed -i`.
- **`src/app/i18n.de.ts` must not be touched with `Edit` or `Write`** — it corrupts umlauts. Patch via a node UTF-8 write with `\r\n` anchors.
- Do not run two vitest processes at once. Never read a gate's exit code through a pipe — redirect, `echo "EXIT=$?"` unpiped, then read the file.
- `npx tsc --noEmit` exits **2** on diagnostics, not 1. Use `npx eslint --max-warnings=0 src` (not `npm run lint`, which trips on gitignored leftovers).
- Do not commit. The controller commits. Do not `git add -A`, stash, or amend.

---

## Task 1: §213 — epoch-keyed suppression of a late dangling diff

**Files:**
- Modify: `src/app/use-document-assets.ts`
- Test: `src/app/use-document-assets.test.tsx`

**Context you need:** `upload` commits the metadata row BEFORE writing the bytes (deliberate, §212). That `assets` change arms the dangling-diff effect while `saveAssetData` is still in flight. The diff's `loadAssetDataIds` correctly reports the new id as absent. If the save resolves first and the load second, the diff's `setDanglingIds` **replaces the whole set** and discards the success path's clear — and nothing re-runs it, because none of its deps (`[config, projectId, assets]`) change again.

**Do NOT** add a repair generation to the effect's deps. That is measured to turn the existing test `"re-writes the bytes over the SAME id when a dangling row is re-uploaded"` red, and "fixing" its fixture would let the drop-the-clear mutant survive.

- [ ] **Step 1: Write the failing test**

Add a `deferred` helper near the top of `src/app/use-document-assets.test.tsx` (after the existing imports), then the test. Put the test inside the same `describe` as the other upload tests.

```ts
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}
```

```ts
  it("does not re-mark a fresh upload when the dangling diff resolves AFTER the byte write", async () => {
    // ★★★ GATED PROMISES, NOT `waitFor` (§213). The defect is an ORDERING one,
    // so a test that merely awaits both passes under whichever order the
    // harness happens to produce — exactly how this went unnoticed. The mount's
    // own diff resolves normally; the one the metadata commit arms is HELD, and
    // released only after the byte write has already resolved and cleared.
    const load = deferred<string[]>();
    const save = deferred<void>();
    vi.mocked(loadAssetDataIds).mockResolvedValueOnce([]).mockReturnValueOnce(load.promise);
    vi.mocked(saveAssetData).mockReturnValueOnce(save.promise);

    const { result } = renderHook(() => useAssetsHost([]));

    let uploaded!: Promise<DocumentAsset | null>;
    await act(async () => {
      uploaded = result.current.upload(pngFile("chart.png"));
      await Promise.resolve();
    });

    await act(async () => { save.resolve(); await uploaded; });
    await act(async () => { load.resolve([]); await load.promise; });

    const asset = await uploaded;
    expect(result.current.danglingIds.has(asset!.id)).toBe(false);
  });
```

**If the mock ordering does not line up** — because the mount diff and the upload diff are not the two calls you expect — do NOT loosen the test into a `waitFor`. Instrument with `vi.mocked(loadAssetDataIds).mock.calls.length` to find the real call order and adjust the `Once` chain. The gated shape is the point of the test.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/app/use-document-assets.test.tsx -t "does not re-mark a fresh upload" --reporter=dot > /tmp/t1.log 2>&1; echo "EXIT=$?"`
Expected: FAIL — `danglingIds.has(...)` is `true`, because the late diff replaced the set.

- [ ] **Step 3: Add the refs**

In `src/app/use-document-assets.ts`, immediately after the `danglingRef` / `commitDangling` block and before the diff effect:

```ts
  // ★★★ §213 — WHY A BARE "ids this session wrote" SET IS NOT ENOUGH, AND THE
  // REGISTER'S OWN CANDIDATE WAS ONE. `upload` commits metadata BEFORE the
  // bytes, so the `assets` change arms the diff below while `saveAssetData` is
  // still in flight. If the save resolves first and the load second, the diff
  // REPLACES the whole set and discards the clear — and nothing re-runs it,
  // because none of its deps changed again. Suppressing every id this session
  // wrote closes that and opens a worse hole: the id stays suppressed for the
  // rest of the session, so a byte row that later vanishes (§207 desync,
  // another tab, a failed remove) would read HEALTHY forever — a false
  // "fine" in place of a false "broken", which is the worse direction because
  // the user is given no signal at all. Keying on a monotonic epoch makes the
  // suppression SELF-EVICTING: it holds only for a diff whose snapshot
  // predates the write, which is precisely the race and nothing else.
  const writtenRef = useRef<Map<string, number>>(new Map());
  const epochRef = useRef(0);
```

- [ ] **Step 4: Subtract in the diff**

In the same file, inside the diff effect's async IIFE. Capture the epoch **before** the await — capturing it after would read a value the write has already bumped, which is the bug.

```ts
    const startEpoch = epochRef.current;
    try {
      const presentIds = await loadAssetDataIds(config, projectId);
      if (cancelled) return;
      const present = new Set(presentIds);
      const next = new Set<string>();
      for (const a of assets) {
        if (present.has(a.id)) continue;
        // Bytes written AFTER this diff's snapshot began cannot appear in its
        // result, so their absence here is not evidence of anything.
        const wroteAt = writtenRef.current.get(a.id);
        if (wroteAt !== undefined && wroteAt > startEpoch) continue;
        next.add(a.id);
      }
      setDanglingIds((prev) => (setsEqual(prev, next) ? prev : next));
    } catch {
```

Leave the dependency array exactly as it is: `[config, projectId, assets]`.

- [ ] **Step 5: Record the write**

In `upload`, immediately after the `await saveAssetData(...)` line and **before** the `const wasDangling = ...` read:

```ts
      // §213 — record the write against a monotonic epoch. Any diff whose
      // snapshot began earlier cannot have observed these bytes, so it must
      // not conclude this id is dangling. Recorded only on SUCCESS: a failed
      // write is the dangling case and must stay visible.
      epochRef.current += 1;
      writtenRef.current.set(asset.id, epochRef.current);
```

- [ ] **Step 6: Run the new test and the whole file**

Run: `npx vitest run src/app/use-document-assets.test.tsx --reporter=dot > /tmp/t1.log 2>&1; echo "EXIT=$?"; grep -E "Tests |Test Files" /tmp/t1.log`
Expected: PASS, **25 tests** (24 existing + 1 new), 0 failed.

**Check the §212 test by name, not just the total.** Run:
`npx vitest run src/app/use-document-assets.test.tsx -t "re-writes the bytes over the SAME id" --reporter=dot > /tmp/t1b.log 2>&1; echo "EXIT=$?"`
Expected: PASS. If it is red, the fix reached the effect's deps — revert and re-read Step 4.

- [ ] **Step 7: Mutation-prove the new test**

Revert ONLY the two-line skip in Step 4 (the `wroteAt` lookup and its `continue`), re-run the new test, confirm it FAILS, then restore. Report the mutant as `N failed / M passed`; the sum must equal 25.

- [ ] **Step 8: Typecheck and lint**

Run: `npx tsc --noEmit; echo "EXIT=$?"` (expect 0) then `npx eslint --max-warnings=0 src; echo "EXIT=$?"` (expect 0).

- [ ] **Step 9: Report** — do not commit. Report files changed, test counts, and the mutation result.

---

## Task 2: The shared blocked-mime predicate

**Files:**
- Modify: `src/app/document-asset-upload.ts`
- Test: `src/app/document-asset-upload.test.ts`

**Context:** §230 needs "is this stored mime refused?" in two places — the images module that declines the render, and the library row that must stop reporting healthy. Spelled twice it will drift from the truthy form §225 exists to protect.

- [ ] **Step 1: Write the failing test**

In `src/app/document-asset-upload.test.ts`:

```ts
describe("isBlockedAssetMime", () => {
  it("blocks a stored mime outside the allowlist", () => {
    expect(isBlockedAssetMime("image/svg+xml")).toBe(true);
  });

  // ★★★ §225 — THE EMPTY STRING MUST FALL THROUGH. `sanitizeDocumentAsset`
  // runs its mime through `sanitizeText`, which returns "" for anything
  // non-string, so a missing/blank/non-string mime survives every load path as
  // "" and such an asset has always rendered by content-sniffing. A
  // `!== undefined` spelling would refuse an image the user can see working.
  it("does NOT block the empty-string mime that real rows carry", () => {
    expect(isBlockedAssetMime("")).toBe(false);
  });

  it("does NOT block an absent mime", () => {
    expect(isBlockedAssetMime(undefined)).toBe(false);
  });

  it("does not block an allowed mime", () => {
    expect(isBlockedAssetMime("image/png")).toBe(false);
  });
});
```

Add `isBlockedAssetMime` to that file's existing import from `./document-asset-upload`.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/app/document-asset-upload.test.ts --reporter=dot > /tmp/t2.log 2>&1; echo "EXIT=$?"`
Expected: FAIL — `isBlockedAssetMime is not a function`.

- [ ] **Step 3: Implement**

In `src/app/document-asset-upload.ts`, directly beneath `isAllowedAssetMime`:

```ts
/** §230/§225 — the ONE spelling of "this STORED mime is refused".
 *
 *  ★★★ TRUTHY, NOT `mime !== undefined`, AND THE DIFFERENCE BREAKS WORKING
 *  IMAGES. `sanitizeDocumentAsset` requires only an `id` and runs its mime
 *  through `sanitizeText`, which returns "" for anything non-string — so a
 *  missing, blank or non-string mime SURVIVES sanitising as "" on every load
 *  path, and such an asset has always rendered by content-sniffing.
 *  `isAllowedAssetMime("")` is false, so the stricter spelling would refuse an
 *  image the user can see working. §225 exists to stop exactly that tightening;
 *  read it before touching this line.
 *
 *  Exported so `document-asset-images.ts` (which declines the render) and
 *  `asset-library.tsx` (which discloses it on the row) cannot drift apart. */
export function isBlockedAssetMime(mime: string | undefined): boolean {
  return !!mime && !isAllowedAssetMime(mime);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run src/app/document-asset-upload.test.ts --reporter=dot > /tmp/t2.log 2>&1; echo "EXIT=$?"`
Expected: PASS.

- [ ] **Step 5: Report** — do not commit.

---

## Task 3: §230 — split the declined sink from the missing sink

**Files:**
- Modify: `src/app/document-asset-images.ts`
- Test: `src/app/document-asset-images.test.ts`

**Context:** `data-asset-missing` currently has FIVE producers: bytes null, load threw, whitespace-only byte row, `atob` reject, and declined mime. Only the fifth is being split out — the other four are all genuine "these bytes will not render". The decline currently returns before `urls.set`, and the apply loop stamps `data-asset-missing` on any element with no url, so the fix must carry a REASON forward to that loop.

- [ ] **Step 1: Update the existing decline test and add two new ones**

In `src/app/document-asset-images.test.ts`, change the existing test `"declines an asset whose stored mime is outside the allowlist"` so its marker assertions read:

```ts
    expect(img?.hasAttribute("src")).toBe(false);
    expect(img?.getAttribute("data-asset-blocked")).toBe("true");
    // §230 — NOT the missing sink. The bytes are present and intact; the
    // library shows this row healthy, so telling the reader "missing" was a
    // contradiction one pane away.
    expect(img?.hasAttribute("data-asset-missing")).toBe(false);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
```

Then add:

```ts
  it("keeps a missing-bytes row on the missing marker, not the blocked one", async () => {
    const el = root('<img data-asset-id="gone">');
    const detach = await attachAssetImages(el, async () => null, () => "image/png");
    const img = el.querySelector("img");
    expect(img?.getAttribute("data-asset-missing")).toBe("true");
    expect(img?.hasAttribute("data-asset-blocked")).toBe(false);
    detach();
  });

  it("clears a stale blocked marker when a later run resolves the same element", async () => {
    // Same reason the missing marker is cleared: this function re-runs over the
    // SAME elements when a repair lands, and a marker left behind draws the
    // broken frame around an image that now renders.
    const el = root('<img data-asset-id="a1">');
    el.querySelector("img")!.setAttribute("data-asset-blocked", "true");
    const detach = await attachAssetImages(el, async () => "QUJD", () => "image/png");
    const img = el.querySelector("img");
    expect(img?.getAttribute("src")).toMatch(/^blob:/);
    expect(img?.hasAttribute("data-asset-blocked")).toBe(false);
    detach();
  });
```

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run src/app/document-asset-images.test.ts --reporter=dot > /tmp/t3.log 2>&1; echo "EXIT=$?"`
Expected: FAIL on the blocked assertions.

- [ ] **Step 3: Collect the blocked ids**

In `src/app/document-asset-images.ts`, beside the existing `urls` map declaration, add:

```ts
  const blocked = new Set<string>();
```

Replace the decline line `if (mime && !isAllowedAssetMime(mime)) return;` with:

```ts
      // §230 — record WHY, so the apply loop can tell a refused row from a
      // missing one. The predicate is shared with `asset-library.tsx` so the
      // render and the library row cannot disagree; its truthy spelling is
      // load-bearing (§225) and documented at its definition.
      if (isBlockedAssetMime(mime)) { blocked.add(id); return; }
```

Update the import to bring in `isBlockedAssetMime` from `./document-asset-upload`. Leave the long comment block above that line in place, but change its `(c) lookup hit a DISALLOWED mime → e.g. image/svg+xml → DECLINE` line to end `→ DECLINE, marked blocked`.

- [ ] **Step 4: Give the apply loop a third branch**

```ts
  for (const img of imgs) {
    const id = img.getAttribute("data-asset-id") ?? "";
    const url = urls.get(id);
    if (url) {
      img.setAttribute("src", url);
      img.removeAttribute("data-asset-missing");
      img.removeAttribute("data-asset-blocked");
    } else if (blocked.has(id)) {
      img.setAttribute("data-asset-blocked", "true");
      img.removeAttribute("data-asset-missing");
    } else {
      img.setAttribute("data-asset-missing", "true");
      img.removeAttribute("data-asset-blocked");
    }
  }
```

Every branch clears the marker it is not setting, for the reason the existing ★★★ comment above this loop gives — leave that comment in place.

- [ ] **Step 5: Run to verify**

Run: `npx vitest run src/app/document-asset-images.test.ts --reporter=dot > /tmp/t3.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/t3.log`
Expected: PASS, **21 tests** (19 existing + 2 new).

- [ ] **Step 6: Mutation-prove the split**

Change the `else if (blocked.has(id))` branch body to stamp `data-asset-missing` instead. Confirm the updated decline test FAILS. Restore. Report `N failed / M passed`, sum 21.

- [ ] **Step 7: Typecheck + lint, then report** — do not commit.

---

## Task 4: The blocked marker's CSS and strings

**Files:**
- Modify: `src/app/globals.css`
- Modify: `src/app/i18n.ts`
- Modify: `src/app/i18n.de.ts` (**node UTF-8 write only**)

- [ ] **Step 1: Share the frame between both markers**

In `src/app/globals.css`, replace the two existing `img[data-asset-missing]` rules with selector lists so the two markers cannot drift visually:

```css
img[data-asset-missing],
img[data-asset-blocked] {
  display: inline-block;
  min-width: 3rem;
  min-height: 2rem;
  border: 1px dashed var(--rag-red-text);
  background-color: var(--surface-muted);
  color: var(--rag-red-text);
  font-size: 0.75rem;
}
img[data-asset-missing]::before,
img[data-asset-blocked]::before {
  content: "\26A0\FE0E ";
}
```

Preserve `\26A0\FE0E ` byte-for-byte, **including the trailing space** — it separates the glyph from adjacent content and §205's owed check asserts it.

- [ ] **Step 2: Add the EN string**

In `src/app/i18n.ts`, directly after `assetLibraryDangling`:

```ts
  assetLibraryBlocked: "Image format no longer supported",
```

- [ ] **Step 3: Add the DE string**

`src/app/i18n.de.ts` is CRLF and the Edit/Write tools corrupt its umlauts. Use a node UTF-8 write with `\r\n` anchors:

```bash
node -e "
const fs=require('fs');
const p='src/app/i18n.de.ts';
let s=fs.readFileSync(p,'utf8');
const anchor='  assetLibraryDangling: \"Bilddaten fehlen\",\r\n';
if(!s.includes(anchor)) { console.error('ANCHOR MISS'); process.exit(1); }
if(s.includes('assetLibraryBlocked')) { console.error('ALREADY PRESENT'); process.exit(1); }
s=s.replace(anchor, anchor+'  assetLibraryBlocked: \"Bildformat wird nicht mehr unterstützt\",\r\n');
fs.writeFileSync(p,s,'utf8');
console.log('OK');
"
```

- [ ] **Step 4: Verify the umlaut survived and the file is still CRLF**

```bash
node -e "const s=require('fs').readFileSync('src/app/i18n.de.ts','utf8');const m=s.match(/assetLibraryBlocked: \"([^\"]+)\"/);console.log(JSON.stringify(m&&m[1]));console.log('LF_ONLY:',(s.match(/(?<!\r)\n/g)||[]).length)"
```
Expected: `"Bildformat wird nicht mehr unterstützt"` and `LF_ONLY: 0`.

Also run `git ls-files --eol src/app/i18n.de.ts` — expect `i/lf w/crlf`.

- [ ] **Step 5: Key parity**

Run: `npx tsc --noEmit; echo "EXIT=$?"` — expect 0. tsc enforces EN/DE key parity, so a missing side fails here.

- [ ] **Step 6: Report** — do not commit.

---

## Task 5: §230 — the library row stops reporting a blocked asset healthy

**Files:**
- Modify: `src/app/asset-library.tsx`
- Test: `src/app/asset-library.test.tsx`

**Context:** the row derives `isDangling` from `danglingIds`, which is built by diffing metadata ids against the byte table. A declined asset HAS a byte row, so it is never dangling and the row shows healthy — the contradiction §230 is about. Blocked is derivable from metadata alone.

- [ ] **Step 1: Write the failing test**

```ts
  it("marks a row whose stored mime is no longer supported, and says so distinctly", async () => {
    // §230 — the bytes are PRESENT, so this row is not dangling and the diff
    // will never flag it. Without this the library reports it healthy while
    // the document renders a broken frame.
    renderLibrary({ assets: [asset({ id: "a1", name: "old.svg", mime: "image/svg+xml" })], danglingIds: new Set() });
    expect(screen.getByText("Image format no longer supported")).toBeInTheDocument();
    expect(screen.queryByText("Image data missing")).not.toBeInTheDocument();
  });

  it("still reports a dangling row as missing data, not as an unsupported format", () => {
    renderLibrary({ assets: [asset({ id: "a1", name: "chart.png", mime: "image/png" })], danglingIds: new Set(["a1"]) });
    expect(screen.getByText("Image data missing")).toBeInTheDocument();
    expect(screen.queryByText("Image format no longer supported")).not.toBeInTheDocument();
  });
```

Adapt `renderLibrary` / `asset` to whatever helpers that test file already uses — read it first and match its existing shape rather than introducing new ones.

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run src/app/asset-library.test.tsx --reporter=dot > /tmp/t5.log 2>&1; echo "EXIT=$?"`

- [ ] **Step 3: Implement**

Import `isBlockedAssetMime` from `./document-asset-upload`. Beside `const isDangling = danglingIds.has(asset.id);`:

```tsx
  // §230 — a refused mime is NOT dangling: the byte row exists, so the diff
  // that builds `danglingIds` will never flag it. Derived from metadata here
  // because that is the only place the mime is visible.
  const isBlocked = !isDangling && isBlockedAssetMime(asset.mime);
```

Dangling takes precedence — missing bytes is the more actionable of the two, and a row cannot usefully say both.

Render the blocked marker with the same span shape the dangling one uses, swapping the string for `t(lang, "assetLibraryBlocked")`.

**Do NOT offer a re-upload affordance on a blocked row.** §230 measured that a healthy duplicate matched by content hash returns early with no metadata write, so the stale mime is never corrected — the control would silently do nothing.

- [ ] **Step 4: Run to verify** — expect PASS.

- [ ] **Step 5: Row-unique names**

If the blocked marker introduces any new per-row *control* (it should not — it is a marker span plus `sr-only` text), it needs a row-unique accessible name via `src/test/row-unique-names.ts`. If it adds no control, state that explicitly in your report.

- [ ] **Step 6: Typecheck + lint, then report** — do not commit.

---

## Task 6: §230's second item — normalise the history modal's project id

**Files:**
- Modify: `src/app/documents-history-modal.tsx`
- Test: `src/app/documents-history-modal.test.tsx`

**Context:** this is the only asset consumer of four that reads `assetAccess?.projectId` bare. `document-edit-mode.tsx`, `documents-asset-section.tsx` and `document-preview.tsx` all normalise to `ASSET_PARTITION_FALLBACK`. Not reachable today — the production caller already normalises — but a caller passing `""` would query `project_id = ""`, match nothing, and stamp every image in a version preview as missing.

- [ ] **Step 1: Write the failing test** — render the modal with `assetAccess={{ projectId: "", assets: [...] }}` and assert the asset load is invoked with `ASSET_PARTITION_FALLBACK`, not `""`. Match the file's existing mocking style.

- [ ] **Step 2: Run and watch it fail.**

- [ ] **Step 3: Implement** — change the bare read to:

```tsx
  const assetProjectId = assetAccess ? assetAccess.projectId || ASSET_PARTITION_FALLBACK : undefined;
```

Keep the `assetProjectId === undefined` guard working: a caller that omits the bag entirely must still short-circuit, so the ternary preserves `undefined` rather than collapsing it to the fallback.

- [ ] **Step 4: Run to verify** — expect PASS, and confirm the existing "no bag" test still passes.

- [ ] **Step 5: Typecheck + lint, then report** — do not commit.

---

## Task 7: §205 — measure the missing-image glyph in both engines

**Files:**
- Create: `e2e-crossengine/asset-missing-glyph.spec.ts`

**Context:** `globals.css` draws the marker with `content: "\26A0\FE0E "`. `\FE0E` is VARIATION SELECTOR-15, requesting TEXT presentation rather than colour emoji. jsdom has no rendering engine, so nothing in the unit suite can see any of this. The existing crossengine harness (`playwright.crossengine.config.ts`, port 3300, chromium + firefox, workers 1) is the vehicle.

**Three judgments, and they are NOT equally assertable:**
- **Hard assert:** something paints in the `::before`.
- **Hard assert:** the declaration's trailing space is present, separating the glyph from adjacent content.
- **Record, do NOT assert:** monochrome vs colour emoji. A font with no text-presentation form for U+26A0 falls back to emoji anyway — a platform finding, not a CSS bug. Asserting it hard turns the gate red on the wrong machines.

- [ ] **Step 1: Write the spec**

Build a probe page rather than driving the Turso-gated Documents surface (which the file-mode seed cannot reach). Inject an `<img data-asset-missing="true">` into the live app's DOM so the real `globals.css` applies, read `getComputedStyle(img, "::before").content`, and assert it is non-empty and ends with a space. For the presentation observation, rasterise two probe spans — `⚠` alone and `⚠︎` — and report whether their pixels differ, plus `navigator.userAgent`, via `console.log` and `testInfo.attach`.

- [ ] **Step 2: Run in both engines**

Run: `npm run e2e:crossengine -- -g "asset missing glyph" > /tmp/t7.log 2>&1; echo "EXIT=$?"; grep -E "passed|failed" /tmp/t7.log`
Expected: PASS in both chromium and firefox.

- [ ] **Step 3: Surface the observation**

Copy the recorded presentation finding and the user agent into your report verbatim. **§205 stays OPEN** — a spec that runs is not an eye-verify; a human still has to read what it observed.

- [ ] **Step 4: Report** — do not commit.

---

## Task 8: Register, changelog, version

**Files:**
- Modify: `docs/open-followups.md`
- Modify: `CHANGELOG.md`
- Modify: `src/app/version.ts`

**★ `docs/open-followups.md` is scanned by the doc-claims ratchet.** Cite SYMBOLS and grep commands, never new `path:LINE` citations, or `npm run docs:claims:check` fails.

- [ ] **Step 1: Close §213 and §230 — the FOUR-PLACE closure rule**

Each closure touches: the heading marker, the summary-table STATUS cell, the summary-table ANCHOR, and the `**Status:**` line. Missing one leaves the register self-contradictory.

- [ ] **Step 2: Repoint §225's text** at `isBlockedAssetMime` as the single definition. **§225 stays OPEN** — its closure is recording the mime alongside the bytes, which is not in this slice.

- [ ] **Step 3: Update §205's Status line** with what Task 7 measured and the date, and leave it OPEN pending a human reading it.

- [ ] **Step 4: Version bump**

`src/app/version.ts`: `APP_VERSION = "0.271.0"`, `APP_BUILD_DATE = "2026-08-31"`, add the codename to the docstring list **and** set `export const APP_MILESTONE`.

**★★★ `APP_MILESTONE` IS THE SOURCE OF TRUTH, NOT THE DOCSTRING.** `version:sync` reads `/export const APP_MILESTONE = "([^"]+)"/`. Editing only the docstring propagates the OLD codename to all eight satellites and `version-sync-check` still passes, because every satellite agrees with a source that is itself wrong.

Codename must be absent from the existing list — enumerate with:
`grep -oE '^## \[0\.[0-9]+\.[0-9]+\] - [0-9-]+ "[A-Za-z]+"' CHANGELOG.md | grep -oE '"[A-Za-z]+"' | sort -u`

- [ ] **Step 5: CHANGELOG entry** — `## [0.271.0] - 2026-08-31 "<codename>"`, user-facing wording, no session URLs.

- [ ] **Step 6: Propagate and verify**

Run: `npm run version:sync; echo "EXIT=$?"` then `npm run version:check; echo "EXIT=$?"`
**Read the codename off `version:check`'s printed reading line** — do not trust the exit code alone. Exit 1 is drift; exit 2 is the gate unable to scan.

- [ ] **Step 7: Report** — do not commit.

---

## Final gates (controller runs these, after all tasks)

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src; echo "EXIT=$?"
npm run test:run > /tmp/full.log 2>&1; echo "FULL_EXIT=$?"; grep -E "Test Files|Tests " /tmp/full.log
npm run docs:claims:check; echo "EXIT=$?"
npm run docs:symbols:check; echo "EXIT=$?"
npm run followups:status:check; echo "EXIT=$?"
npm run version:check; echo "EXIT=$?"
npm run size:check; echo "EXIT=$?"
npm run dup:check; echo "EXIT=$?"
```

Then a cold code review before any release, per standing policy.
