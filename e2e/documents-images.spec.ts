// e2e/documents-images.spec.ts
//
// The ONLY layer that can see a document image fail to load.
//
// ★★★ WHY THIS FILE EXISTS. S3c-1 shipped with `img-src 'self' data:` in
// src/proxy.ts while every document image renders from `URL.createObjectURL` —
// a blob: URL, which 'self' does not match. Chromium refused the load in EVERY
// environment, dev and prod alike. Nothing caught it: jsdom enforces no CSP, so
// the unit suite is structurally blind, and no e2e spec touched document assets
// at all (`grep -rn "data-asset-id\|documentAssets" e2e/` returned nothing).
// The CSP is fixed; this spec is what stops it regressing silently.
//
// ★★★ `naturalWidth` IS THE ASSERTION AND NOTHING WEAKER WILL DO. A CSP-refused
// image is STILL IN THE DOM with its `src` attribute set — presence, visibility,
// a `toHaveAttribute("src", /^blob:/)` check and even a screenshot of the
// surrounding block all PASS against the exact bug this file exists to catch.
// Only a decoded bitmap has a non-zero naturalWidth.
//
// ★★ THE TWO FAILURE MODES ARE ASSERTED SEPARATELY ON PURPOSE, because they
// have completely different causes and a single combined assertion would not
// say which one happened:
//   - `data-asset-missing` present / no blob: src  => the BYTE STORE never
//     delivered (seed, route stub, or tursoConfig gate) — the image load was
//     never even attempted, so this says nothing about CSP.
//   - blob: src present but naturalWidth === 0     => the bytes arrived and the
//     BROWSER REFUSED OR FAILED THE LOAD. That is the CSP regression signature.
// Collapsing them would let a broken harness masquerade as a passing CSP test.
//
// ★★ IT ALSO GUARDS A SECOND, UNRELATED REGRESSION. The seed carries the image
// in BOTH shapes — a captioned figure and the image-ONLY paragraph the product
// actually inserts — and the image-only block only survives a load because of
// `d183be6d`, which added the survival predicate `sanitizeBlock` tests. Before
// that fix, every user-inserted image was silently deleted on the next load, on
// all six write paths. Revert it and this spec's second image simply is not in
// the DOM, so the suite reports it. See the seeded blocks' comments in seed.ts.
// ★ At `d183be6d` that predicate was `ASSET_IMG_RE`, module-private in
// `document-model.ts` — the spelling this comment used to carry, which greps to
// nothing today. It is now `ASSET_IMG_TEST_RE`, exported from
// `document-asset-patterns.ts`; `sanitizeBlock` still calls it.

import {
  test, expect, gotoApp, openView, installAssetByteStore,
  E2E_DOCUMENT_ASSET, E2E_DOCUMENT_ASSET_IMAGE_ONLY,
} from "./seed";

/** The e2e-only document seeded in seed.ts that carries the image blocks.
 *  Selected EXPLICITLY rather than relied upon by position: documents-panel.tsx
 *  falls back to `selectionPool[0]`, the UNSORTED `documents` array, which is
 *  the sample master's document — not this one. */
const DOC_TITLE = "Kickoff pack";

/** ★★ BOTH SEEDED SHAPES ARE ASSERTED, and they fail for different reasons.
 *  The CAPTIONED figure is valid whatever the block-drop rules do, so it is the
 *  stable carrier of the CSP/render assertion. The IMAGE-ONLY one is what
 *  documents-asset-section.tsx actually inserts and only survives a load
 *  because of `d183be6d` — revert that and this block is deleted before the
 *  page renders, so the locator finds nothing and the suite goes RED rather
 *  than losing user images silently again. ★ To mutate it WITHOUT reverting the
 *  commit, break the predicate that guard calls: `ASSET_IMG_TEST_RE` in
 *  `document-asset-patterns.ts`, read by `sanitizeBlock` in `document-model.ts`.
 *  It was named `ASSET_IMG_RE` and lived in `document-model.ts` at `d183be6d`,
 *  which is the spelling this comment used to name and which now greps to
 *  nothing.
 *  ★ Their dimensions differ (8x8 vs 4x4) on purpose: asserting each against
 *  its OWN size means a resolver that pointed both `<img>` elements at the same
 *  bytes could not pass. */
const CASES = [
  { label: "captioned figure", asset: E2E_DOCUMENT_ASSET },
  { label: "image-only paragraph", asset: E2E_DOCUMENT_ASSET_IMAGE_ONLY },
] as const;

/** CSP violations reported by the page itself.
 *
 *  ★★ THE DOM EVENT, NOT CONSOLE TEXT-MATCHING, is the primary detector:
 *  `securitypolicyviolation` carries the violated directive as a field, so it
 *  cannot be defeated by Chromium rewording its console message. Console errors
 *  are collected too, but only as a secondary diagnostic in the failure text. */
declare global {
  interface Window {
    __cspViolations?: { directive: string; blockedURI: string }[];
  }
}

test.describe("document images", () => {
  test("renders a seeded document image from a blob: URL with no CSP violation", async ({ page }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });

    // Must be installed before ANY navigation — the listener has to exist
    // before the app boots or the violation fires with nothing watching.
    await page.addInitScript(() => {
      window.__cspViolations = [];
      document.addEventListener("securitypolicyviolation", (e) => {
        window.__cspViolations?.push({
          directive: e.effectiveDirective || e.violatedDirective,
          blockedURI: e.blockedURI,
        });
      });
    });
    await installAssetByteStore(page);

    await gotoApp(page);
    await openView(page, "Documents");

    // ★★ A DOM CLICK, mirroring e2e/a11y.spec.ts — the auto-launched guided
    // tour drops a `fixed inset-0` overlay that intercepts a real pointer
    // click, and a `.click()` here retries against it until the test times out
    // (measured: that is exactly how the first cut of this spec failed).
    // ★ EXACT text match, not substring: every per-row control in
    // documents-list.tsx is named "<action> – <title>", so a loose match would
    // also hit Delete.
    // ★ Asserted found, per the same house rule — a silently missing button
    // would leave the master document selected, which carries NO image, and
    // the whole spec would fail for a reason that reads like a product bug.
    const clickedDoc = await page.evaluate((title) => {
      const btn = [...document.querySelectorAll("button")].find(
        (b) => (b.textContent || "").trim() === title,
      );
      if (!btn) return false;
      (btn as HTMLElement).click();
      return true;
    }, DOC_TITLE);
    expect(clickedDoc, `Document row "${DOC_TITLE}" not found in the documents list`).toBe(true);

    for (const { label, asset } of CASES) {
      const img = page.locator(`img[data-asset-id="${asset.id}"]`);

      // A missing locator here is itself a finding: for the image-only case it
      // means the block was dropped at load (the d183be6d regression), not that
      // anything is wrong with rendering.
      await expect(img, `${label}: no <img> for ${asset.id} — was the block dropped at load?`)
        .toBeVisible();

      // ── The byte store delivered ──────────────────────────────────────────
      // attachAssetImages stamps this when the loader yields nothing; it is the
      // dangling case and means the image load was never attempted.
      await expect(img, `${label}: marked dangling`).not.toHaveAttribute("data-asset-missing", "true");
      await expect(img, `${label}: no blob: src`).toHaveAttribute("src", /^blob:/);

      // ── The browser actually loaded and decoded it ────────────────────────
      // Polled: attachAssetImages resolves asynchronously (fetch -> base64 ->
      // Blob -> object URL) and the decode lands after that again.
      await expect
        .poll(
          () => img.evaluate((el: HTMLImageElement) => ({ w: el.naturalWidth, h: el.naturalHeight })),
          {
            message:
              `${label}: document image never decoded. A blob: src with naturalWidth 0 is the ` +
              "CSP img-src regression signature — check that src/proxy.ts still grants blob:. " +
              `Console errors: ${JSON.stringify(consoleErrors)}`,
          },
        )
        .toEqual({ w: asset.width, h: asset.height });
    }

    // ── Nothing was refused by the policy ───────────────────────────────────
    // Belt to the naturalWidth brace: this catches a violation on ANY directive
    // (a future connect-src or style-src narrowing), not just img-src.
    const violations = await page.evaluate(() => window.__cspViolations ?? []);
    expect(violations, `CSP violations reported by the page: ${JSON.stringify(violations)}`).toEqual([]);
  });
});
