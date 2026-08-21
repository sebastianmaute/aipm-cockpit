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

import { test, expect, gotoApp, openView, installAssetByteStore, E2E_DOCUMENT_ASSET } from "./seed";

/** The e2e-only document seeded in seed.ts that carries the image block.
 *  Selected EXPLICITLY rather than relied upon by position: documents-panel.tsx
 *  falls back to `selectionPool[0]`, the UNSORTED `documents` array, which is
 *  the sample master's document — not this one. */
const DOC_TITLE = "Kickoff pack";

const IMG = `img[data-asset-id="${E2E_DOCUMENT_ASSET.id}"]`;

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

    const img = page.locator(IMG);
    await expect(img).toBeVisible();

    // ── The byte store delivered ────────────────────────────────────────────
    // attachAssetImages stamps this when the loader yields nothing; it is the
    // dangling case and means the image load was never attempted.
    await expect(img).not.toHaveAttribute("data-asset-missing", "true");
    await expect(img).toHaveAttribute("src", /^blob:/);

    // ── The browser actually loaded and decoded it ──────────────────────────
    // Polled: attachAssetImages resolves asynchronously (fetch -> base64 ->
    // Blob -> object URL) and the decode lands after that again.
    await expect
      .poll(
        () => img.evaluate((el: HTMLImageElement) => ({ w: el.naturalWidth, h: el.naturalHeight })),
        {
          message:
            "Document image never decoded. A blob: src with naturalWidth 0 is the CSP " +
            "img-src regression signature — check that src/proxy.ts still grants blob:. " +
            `Console errors: ${JSON.stringify(consoleErrors)}`,
        },
      )
      .toEqual({ w: E2E_DOCUMENT_ASSET.width, h: E2E_DOCUMENT_ASSET.height });

    // ── Nothing was refused by the policy ───────────────────────────────────
    // Belt to the naturalWidth brace: this catches a violation on ANY directive
    // (a future connect-src or style-src narrowing), not just img-src.
    const violations = await page.evaluate(() => window.__cspViolations ?? []);
    expect(violations, `CSP violations reported by the page: ${JSON.stringify(violations)}`).toEqual([]);
  });
});
