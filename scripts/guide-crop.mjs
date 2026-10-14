// The crop rectangle for the install guide's screenshots (§713), pure so it can be tested:
// e2e/guide-shots.spec.ts measures the boxes and takes the picture. No shebang: vitest imports it.

/** @typedef {{ x: number; y: number; width: number; height: number }} Box */

/**
 * The page clip covering `from`'s top to `to`'s bottom, padded and clamped to the viewport.
 * `across` (the union of its boxes) sets the width only; without it, `from` and `to` do.
 * Only the PADDING may be clamped: a region that itself runs past the viewport throws, rather
 * than letting a picture ship cut short. Half a pixel of slack, since boxes are fractional.
 *
 * @param {{ from: Box; to: Box; across?: Box[]; view: { width: number; height: number }; pad: number; padTop: number }} input
 * @returns {Box}
 */
export function cropClip({ from, to, across = [], view, pad, padTop }) {
  const xs = across.length > 0 ? across : [from, to];
  const region = {
    left: Math.min(...xs.map((r) => r.x)),
    top: Math.min(from.y, to.y),
    right: Math.max(...xs.map((r) => r.x + r.width)),
    bottom: Math.max(from.y + from.height, to.y + to.height),
  };
  if (region.left < -0.5 || region.top < -0.5 || region.right > view.width + 0.5 || region.bottom > view.height + 0.5) {
    throw new Error(`the region runs past the ${view.width}×${view.height} viewport: ${JSON.stringify(region)}`);
  }
  const x = Math.max(0, region.left - pad);
  const y = Math.max(0, region.top - padTop);
  const right = Math.min(view.width, region.right + pad);
  const bottom = Math.min(view.height, region.bottom + pad);
  return { x, y, width: right - x, height: bottom - y };
}
