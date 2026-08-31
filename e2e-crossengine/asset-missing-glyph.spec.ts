import type { Page } from "@playwright/test";
import { test, expect, gotoApp } from "../e2e/seed";

/**
 * CROSS-ENGINE broken-document-image marker — the `::before` glyph in
 * `src/app/globals.css` (`img[data-asset-missing]`, `img[data-asset-blocked]`).
 *
 * ★★★ WHY THIS FILE IS NOT IN THE UNIT SUITE. The declaration is
 *
 *     img[data-asset-missing]::before,
 *     img[data-asset-blocked]::before { content: "\26A0\FE0E "; }
 *
 * `\26A0` is U+26A0 WARNING SIGN and `\FE0E` is VARIATION SELECTOR-15, which
 * REQUESTS text (monochrome) rather than colour-emoji presentation. jsdom has
 * no cascade for pseudo-element `content` and no rendering engine at all, so
 * NOTHING in vitest can see whether this paints, whether the trailing space
 * survives, or what the glyph ends up looking like. That is why register entry
 * §205 has sat open as an owed eye-verify: no automated layer could reach it.
 *
 * ★★★ THE THREE JUDGMENTS HERE ARE NOT EQUALLY ASSERTABLE, and that split is
 * the whole design of this file:
 *
 *   1. HARD ASSERT — something actually paints: the resolved `content` is
 *      non-empty, is neither `none` nor `normal`, and carries U+26A0.
 *   2. HARD ASSERT — the declaration's TRAILING SPACE survives into the
 *      resolved value, so the glyph cannot run into adjacent content.
 *   3. RECORD, NEVER ASSERT — monochrome text presentation vs colour emoji.
 *      U+FE0E is a REQUEST, not a guarantee: a font with no text-presentation
 *      form for U+26A0 falls back to the emoji form anyway, and which fonts are
 *      installed is a property of the MACHINE, not of this stylesheet. An
 *      assertion on it would turn the gate red on the wrong machines while
 *      saying nothing about the CSS. The second test below therefore MEASURES
 *      it, logs it and attaches it, and asserts only that the measurement was
 *      not vacuous.
 *
 * ★★ Consequently a green run here is NOT the eye-verify §205 asks for. It
 * proves the CSS resolves; a human still has to read the attached observation
 * (and, ideally, the pane) to say the marker looks right. §205 stays open.
 *
 * ★★★ THE FIRST RUN OF THIS FILE WAS RED ONCE PER ENGINE, FOR TWO UNRELATED
 * REAL REASONS. Neither was visible from any other layer in this repo, and both
 * were about `globals.css` rather than about this spec. One is now FIXED and
 * the other is PINNED AS A CHARACTERIZATION — read both before changing an
 * assertion, because the shape of each test below is the record of what it cost
 * to find them.
 *
 *   [chromium] FIXED. THE TRAILING SPACE DID NOT EXIST: it was consumed as the
 *   TERMINATOR of the `\FE0E` escape — CSS Syntax "consume an escaped code
 *   point" takes up to 6 hex digits and then, if the next input code point is
 *   whitespace, consumes that too. MEASURED: the resolved value was exactly
 *   `U+0022 U+26A0 U+FE0E U+0022`, and a declaration written with NO trailing
 *   space produced the identical value — which is what proved the byte inert
 *   rather than merely suspect. The glyph therefore butted straight against the
 *   `alt` text for three releases. `globals.css` now spells it
 *   `content: "\26A0\FE0E" " ";`, two concatenated strings, so the escape has
 *   nothing to eat. The trailing-space assertion below went RED before that
 *   change and GREEN after; that transition is the only evidence the fix did
 *   anything, since an assertion that was already green would prove nothing.
 *
 *   [firefox] NOT FIXABLE FROM CSS, so it is PINNED AS-IS below and recorded in
 *   §205's own body. THE GLYPH NEVER PAINTS AT ALL.
 *   Gecko's UA sheet puts `content: -moz-alt-content !important` on a BROKEN
 *   `<img>`, and a src-less `<img>` is broken — which is exactly the shape this
 *   marker is built on. MEASURED by two controls in the first test, and they
 *   are what make the diagnosis rather than a guess: an `<img>` with NO marker
 *   attribute resolves to `-moz-alt-content` too (so the author rule is not
 *   losing on specificity — the engine does this to every broken image), and an
 *   author `!important` rule inserted ahead of ours ALSO loses (UA-important
 *   outranks author-important, so `globals.css` cannot win this at any weight).
 *   Firefox therefore renders the frame — border, background and colour all
 *   still apply — with the block author's `alt` text inside it instead of the
 *   warning sign. Whether that degradation is acceptable is a product call, not
 *   something this file can assert; what it CAN do is assert that the surviving
 *   half is really there, which is the third assertion block below.
 *
 * ★ WHY A SYNTHETIC PROBE ELEMENT rather than the real Documents pane: that
 * surface is Turso-gated and the file-mode e2e seed cannot reach it (the same
 * blind spot AGENTS.md records for every Turso-gated view). Navigating to the
 * app first means the measurement still runs against the SHIPPED `globals.css`
 * — a hand-built copy of the rule would only prove the copy.
 *
 * ★ No guided-tour suppression (unlike `popover-focus.spec.ts`): nothing here
 * is a real pointer or keyboard interaction, so the tour's `fixed inset-0`
 * overlay has nothing to intercept.
 */

/** U+26A0 WARNING SIGN, spelled as an ESCAPE rather than the literal glyph.
 *  ★ Deliberate: this repo has a recorded history of editing tools corrupting
 *  non-ASCII bytes in source files, and the whole subject of this file is which
 *  code points survive — a mangled literal here would silently make the check
 *  assert something other than what it says. */
const WARNING_SIGN = "\u26A0";

/** The computed-colour spellings that mean "nothing is painted here".
 *  ★ Both engines serialize a fully transparent colour as `rgba(0, 0, 0, 0)`
 *  rather than the `transparent` keyword, but the keyword is kept in the set so
 *  a future engine that serializes it the other way is caught rather than
 *  passed. Compared as whole strings, not by substring: `rgba(0, 0, 0, 0.9)`
 *  starts the same way and is nearly opaque. */
const TRANSPARENT = new Set(["transparent", "rgba(0, 0, 0, 0)"]);

/** Both markers share ONE declaration; the slice that added the second one is
 *  what this pair pins — a rule split back into two would still pass the first
 *  half and quietly drop the second. */
const MARKERS = ["data-asset-missing", "data-asset-blocked"] as const;

/**
 * Append a bare `<img>` carrying `attr`, read its `::before` `content`, remove
 * it again.
 *
 * ★ NO `src`, deliberately: an `<img>` that resolves an image is a REPLACED
 * element and generates no pseudo-element content. `globals.css` says so at the
 * rule itself — the whole "style a broken image" trick depends on there being
 * nothing to replace it with.
 */
/** What one probe measures: the `::before` value, and the FRAME the marked
 *  element itself draws. The frame is the half that survives in every engine —
 *  see the third assertion block in the first test. */
type Probe = {
  raw: string;
  codePoints: string[];
  frame: {
    borderTopStyle: string;
    borderTopColor: string;
    backgroundColor: string;
    color: string;
  };
};

async function readMarkerContent(page: Page, attr: string | null): Promise<Probe> {
  return page.evaluate((name) => {
    const img = document.createElement("img");
    // `null` builds the CONTROL probe: an identical bare `<img>` carrying no
    // marker attribute, so the author rule cannot match it. That separates "our
    // declaration lost the cascade" from "this engine puts its own content on
    // every broken `<img>`" — two very different findings that look identical
    // from a single probe. It is not hypothetical: see the file header.
    if (name !== null) img.setAttribute(name, "true");
    img.setAttribute("alt", "asset marker probe");
    document.body.appendChild(img);
    // Force layout before reading, so the read cannot race the style recalc.
    void img.offsetWidth;
    const raw = getComputedStyle(img, "::before").content;
    const own = getComputedStyle(img);
    const frame = {
      borderTopStyle: own.borderTopStyle,
      borderTopColor: own.borderTopColor,
      backgroundColor: own.backgroundColor,
      color: own.color,
    };
    img.remove();
    return {
      raw,
      frame,
      codePoints: [...raw].map(
        (c) => `U+${(c.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, "0")}`,
      ),
    };
  }, attr);
}

/**
 * The same probe, with an AUTHOR `!important` declaration inserted ahead of it.
 *
 * ★★ This is the probe that says whether a stylesheet can fix the finding at
 * all. A UA `!important` declaration outranks an author `!important` one (that
 * inversion is the whole point of the important layers in the cascade), so if
 * this still comes back with the engine's own value, no edit to `globals.css`
 * can win — the marker has to be built some other way in that engine.
 *
 * ★ Inserted through CSSOM rather than by appending a `<style>` element: an
 * injected `<style>` is subject to `style-src-elem`, which is nonce-only in
 * production (`src/proxy.ts`), and this probe would then quietly measure a
 * blocked stylesheet instead of an outranked one. CSSOM insertion is not
 * CSP-gated. This spec only ever runs against the dev server, but a probe whose
 * failure mode is a silent wrong answer is not worth keeping either way.
 */
async function readWithAuthorImportant(page: Page): Promise<Probe> {
  return page.evaluate(() => {
    const sentinel = "AUTHOR-IMPORTANT";
    const NO_FRAME = {
      borderTopStyle: "(not measured)",
      borderTopColor: "(not measured)",
      backgroundColor: "(not measured)",
      color: "(not measured)",
    };
    const sheet = [...document.styleSheets].find((s) => {
      try {
        void s.cssRules;
        return true;
      } catch {
        return false; // cross-origin sheet — cannot be written to.
      }
    });
    if (!sheet) return { raw: "(no writable stylesheet)", codePoints: [], frame: NO_FRAME };
    const index = sheet.insertRule(
      `img[data-asset-missing]::before{content:"${sentinel}"!important}`,
      sheet.cssRules.length,
    );
    const img = document.createElement("img");
    img.setAttribute("data-asset-missing", "true");
    img.setAttribute("alt", "asset marker probe");
    document.body.appendChild(img);
    void img.offsetWidth;
    const raw = getComputedStyle(img, "::before").content;
    img.remove();
    sheet.deleteRule(index);
    return {
      raw,
      frame: NO_FRAME,
      codePoints: [raw.includes(sentinel) ? "(author !important won)" : "(author !important lost)"],
    };
  });
}

/**
 * Strip the quotes a browser wraps a resolved `content` string in.
 *
 * ★★ REQUIRED for the trailing-space check, and the reason it is a helper
 * rather than a `slice(1, -1)`: the two engines are NOT contractually the same
 * here — the quote CHARACTER, and whether the value is quoted at all, is
 * serialization detail. Anything unquoted is returned unchanged rather than
 * silently losing its first and last character. The RAW value is reported by
 * both tests, so a divergence shows up as a finding instead of as a pass.
 */
function unquoteContent(resolved: string): string {
  const double = /^"([\s\S]*)"$/.exec(resolved);
  if (double) return double[1];
  const single = /^'([\s\S]*)'$/.exec(resolved);
  if (single) return single[1];
  return resolved;
}

test.describe("asset missing glyph, in a real engine", () => {
  test("resolves a warning glyph with its trailing space on both markers", async ({
    page,
  }, testInfo) => {
    await gotoApp(page);

    // ★★ MEASURE EVERYTHING FIRST, then log, then assert. A failing `expect`
    // aborts the test at that line, so an assert-as-you-go loop reports the
    // FIRST bad marker and stays silent about every later one — and about the
    // control probe, which is the reading that says WHY. Both engines fail this
    // test today for different reasons (file header), and neither reason was
    // legible until the evidence was emitted ahead of the assertions.
    const observed: Record<string, Probe> = {};
    for (const attr of MARKERS) observed[attr] = await readMarkerContent(page, attr);
    observed["(control) img with no marker attribute"] = await readMarkerContent(page, null);
    observed["(control) author !important override"] = await readWithAuthorImportant(page);

    // ★ U+FE0E is deliberately NOT asserted. Whether a variation selector is
    // preserved in a serialized `content` value is engine detail, and its
    // EFFECT is the platform question test 2 records. It is reported here so a
    // reader can see which engine kept it.
    const summary = JSON.stringify({ project: testInfo.project.name, markers: observed }, null, 2);
    console.log(`[asset missing glyph] resolved content:\n${summary}`);
    await testInfo.attach("asset-marker-resolved-content", {
      body: summary,
      contentType: "application/json",
    });

    // ★ An unknown project takes NEITHER branch by accident. Adding a `webkit`
    // project without deciding which of the two behaviours it has would
    // otherwise silently inherit whichever branch the `else` happened to be,
    // and a characterization test that quietly re-characterizes is worthless.
    const engine = testInfo.project.name;
    if (engine !== "chromium" && engine !== "firefox") {
      throw new Error(
        `unhandled project "${engine}": decide whether it paints the glyph or replaces it, then add a branch`,
      );
    }

    for (const attr of MARKERS) {
      const { raw, frame } = observed[attr];

      // (1) Something resolved at all — true of both engines, and the one
      // reading that is not engine-specific.
      expect(raw, `${attr}: no resolved ::before content`).not.toBe("");

      if (engine === "firefox") {
        // ★★★ CHARACTERIZATION, NOT AN ENDORSEMENT. Gecko's UA sheet puts
        // `content: -moz-alt-content !important` on a broken `<img>`, and a
        // src-less `<img>` — the shape this marker is built on — is broken. The
        // two controls above are what make this a diagnosis rather than a
        // guess, and both belong in any future reading of this line: an `<img>`
        // with NO marker attribute resolves the same way (so the author rule is
        // not losing on SPECIFICITY — the engine does this to every broken
        // image), and an author `!important` rule inserted ahead of ours ALSO
        // loses (UA-important outranks author-important, so `globals.css`
        // cannot win this at any weight).
        //
        // So this pins the platform, not the product: if Gecko ever stops doing
        // it, this goes RED and someone revisits §205 — which is the correct
        // outcome, because the glyph would then be paintable in Firefox and the
        // register entry's Firefox half would be stale.
        expect(raw, `${attr}: firefox no longer replaces the ::before — revisit §205`).toBe(
          "-moz-alt-content",
        );
      } else {
        // `none` is what an unmatched selector gives and `normal` is the
        // initial value — either would mean the rule never applied.
        expect(raw, `${attr}: ::before content resolved to none`).not.toBe("none");
        expect(raw, `${attr}: ::before content resolved to normal`).not.toBe("normal");
        expect(
          raw.includes(WARNING_SIGN),
          `${attr}: resolved content ${JSON.stringify(raw)} carries no U+26A0`,
        ).toBe(true);

        // (2) The trailing space survives, so the glyph cannot butt straight
        // against the alt text. ★★ THIS ASSERTION WAS RED until the escape was
        // respelled as `"\26A0\FE0E" " "` — the space in `"\26A0\FE0E "` was
        // the escape's TERMINATOR, not content (file header). Do NOT "fix" a
        // future red here by deleting it or relaxing it to `.trimEnd()`; a red
        // means the declaration regressed to a form the parser eats.
        expect(
          unquoteContent(raw).endsWith(" "),
          `${attr}: resolved content ${JSON.stringify(raw)} lost its trailing space`,
        ).toBe(true);
      }

      // (3) THE FRAME, in BOTH engines — and in Firefox it is the ONLY part of
      // the marker that survives, which is exactly why it is asserted here and
      // not left to the eye. Nothing in any other layer pins it: jsdom resolves
      // no cascade, and the axe gate never reaches Documents in a state that
      // renders one of these.
      //
      // ★ Deliberately NOT pinned to palette values. `--rag-red-text` and
      // `--surface-muted` legitimately differ per colour scheme, so asserting
      // the exact `rgb(...)` would go red on a theme change that broke nothing.
      // What must hold is that a frame is DRAWN: dashed, and neither the border
      // nor the fill invisible.
      // ★ Longhands, not the `border-style` shorthand: its serialization
      // differs across engines once the four sides diverge, so a shorthand read
      // is an engine comparison rather than a product one.
      // ★★ NOT VACUOUS, and the attached evidence proves it without a mutant:
      // the no-marker control `<img>` measures `solid` / `rgba(0, 0, 0, 0)` in
      // BOTH engines, so all three of these assertions fail on an element the
      // rule does not reach. Read that row before assuming a green here means
      // anything less than the frame actually being applied.
      expect(frame.borderTopStyle, `${attr}: marker frame is not dashed`).toBe("dashed");
      expect(
        TRANSPARENT.has(frame.borderTopColor),
        `${attr}: marker border colour is invisible (${frame.borderTopColor})`,
      ).toBe(false);
      expect(
        TRANSPARENT.has(frame.backgroundColor),
        `${attr}: marker background is invisible (${frame.backgroundColor})`,
      ).toBe(false);
    }
  });

  test("records whether U+FE0E changes the rendered glyph (observation only)", async ({
    page,
  }, testInfo) => {
    // ★★★ NOTHING IN THIS TEST MAY BECOME AN ASSERTION ABOUT PRESENTATION.
    // U+FE0E asks for the text form; a machine whose font stack has no text
    // form for U+26A0 renders the emoji form regardless, and that is a correct
    // outcome of a correct stylesheet. Asserting "the two differ" would fail on
    // machines with only a text form; asserting "they are identical" would fail
    // on machines with a colour font. Both reds would be about the machine.
    //
    // What IS asserted below is anti-vacuity: that both probes actually put ink
    // on their canvas. Two blank canvases compare equal, so without that guard
    // "the variation selector changed nothing" would be indistinguishable from
    // "nothing was drawn at all" — an observation that agrees with a plausible
    // prior for the wrong reason is worse than no observation.
    await gotoApp(page);

    const observation = await page.evaluate(() => {
      const BARE = "\u26A0";
      const VS15 = "\u26A0\uFE0E";

      // Off-screen host: real DOM layout, so the widths below are the ones the
      // marker would actually occupy.
      const host = document.createElement("div");
      host.style.cssText = "position:absolute;left:-9999px;top:0;font-size:64px;";
      const mkSpan = (text: string): HTMLSpanElement => {
        const span = document.createElement("span");
        span.textContent = text;
        span.style.whiteSpace = "pre";
        host.appendChild(span);
        return span;
      };
      const bareSpan = mkSpan(BARE);
      const vs15Span = mkSpan(VS15);
      document.body.appendChild(host);

      // ★ Built from longhands, not the `font` shorthand: computed `font` is
      // allowed to serialize empty when the used font is not expressible as one
      // shorthand, and an empty `ctx.font` assignment is silently ignored —
      // which would rasterise both probes in the canvas default face and make
      // the comparison meaningless while looking fine.
      const cs = getComputedStyle(bareSpan);
      const font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      const domWidthBare = bareSpan.getBoundingClientRect().width;
      const domWidthVs15 = vs15Span.getBoundingClientRect().width;

      const W = 128;
      const H = 96;
      const draw = (text: string): { data: Uint8ClampedArray; width: number } => {
        const canvas = document.createElement("canvas");
        canvas.width = W;
        canvas.height = H;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("no 2d canvas context in this engine");
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, W, H);
        ctx.font = font;
        ctx.textBaseline = "top";
        ctx.fillStyle = "#000000";
        const width = ctx.measureText(text).width;
        ctx.fillText(text, 8, 8);
        return { data: ctx.getImageData(0, 0, W, H).data, width };
      };

      const bare = draw(BARE);
      const vs15 = draw(VS15);

      // "Coloured" = the pixel is not on the grey axis, i.e. it cannot have come
      // from a monochrome glyph drawn in black on white. The tolerance absorbs
      // subpixel antialiasing, which tints edge pixels slightly in both engines.
      const isColoured = (d: Uint8ClampedArray, i: number): boolean =>
        Math.abs(d[i] - d[i + 1]) > 24 ||
        Math.abs(d[i + 1] - d[i + 2]) > 24 ||
        Math.abs(d[i] - d[i + 2]) > 24;
      // "Ink" = anything that is not the white ground.
      const isInk = (d: Uint8ClampedArray, i: number): boolean =>
        d[i] < 245 || d[i + 1] < 245 || d[i + 2] < 245;

      let differingPixels = 0;
      let colouredBare = 0;
      let colouredVs15 = 0;
      let inkBare = 0;
      let inkVs15 = 0;
      for (let i = 0; i < bare.data.length; i += 4) {
        if (
          bare.data[i] !== vs15.data[i] ||
          bare.data[i + 1] !== vs15.data[i + 1] ||
          bare.data[i + 2] !== vs15.data[i + 2] ||
          bare.data[i + 3] !== vs15.data[i + 3]
        ) {
          differingPixels += 1;
        }
        if (isColoured(bare.data, i)) colouredBare += 1;
        if (isColoured(vs15.data, i)) colouredVs15 += 1;
        if (isInk(bare.data, i)) inkBare += 1;
        if (isInk(vs15.data, i)) inkVs15 += 1;
      }

      host.remove();

      return {
        userAgent: navigator.userAgent,
        font,
        domWidthBare,
        domWidthVs15,
        canvasWidthBare: bare.width,
        canvasWidthVs15: vs15.width,
        differingPixels,
        pixelsDiffer: differingPixels > 0,
        colouredPixelsBare: colouredBare,
        colouredPixelsVs15: colouredVs15,
        inkPixelsBare: inkBare,
        inkPixelsVs15: inkVs15,
      };
    });

    const summary = JSON.stringify(
      { project: testInfo.project.name, ...observation },
      null,
      2,
    );
    console.log(`[asset missing glyph] U+FE0E presentation observation:\n${summary}`);
    await testInfo.attach("u26a0-presentation-observation", {
      body: summary,
      contentType: "application/json",
    });

    // ANTI-VACUITY ONLY — see this test's opening comment. These say "the probe
    // rendered", never "it rendered the right way".
    //
    // ★★ SCOPE: this test measures U+26A0 in a plain `<span>`, i.e. what the
    // FONT STACK does with the variation selector. In Firefox that is NOT what
    // the marker renders — the UA sheet replaces the whole `::before` there
    // (file header) — so a Firefox reading here describes the platform's font
    // handling and says nothing about the marker on that engine.
    expect(observation.inkPixelsBare, "bare U+26A0 drew nothing").toBeGreaterThan(0);
    expect(observation.inkPixelsVs15, "U+26A0 U+FE0E drew nothing").toBeGreaterThan(0);
    expect(observation.domWidthBare, "bare U+26A0 span has zero width").toBeGreaterThan(0);
    expect(observation.domWidthVs15, "U+26A0 U+FE0E span has zero width").toBeGreaterThan(0);
  });
});
