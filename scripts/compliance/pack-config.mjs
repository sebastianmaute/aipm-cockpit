/** Register numbers the compliance pack cites as open gaps. Each must be an
 *  open entry of `docs/open-followups.md` (`gapViolations` in `pack-lib.mjs`). */
export const CITED_GAPS = [487, 562, 793, 794, 795, 796, 797, 798, 799, 800, 801, 802, 803, 804];

/** The generated blocks each pack file carries, in document order, the same in
 *  both languages. `check-compliance-pack.mjs` fails on a missing or extra one. */
export const BLOCKS_BY_FILE = Object.freeze({
  "README.md": ["open-gaps"],
  "vendor-touchpoints.md": ["browser-hosts", "server-destinations"],
  "dpia-input.md": ["ai-paths"],
  "record-of-processing-input.md": ["ai-paths", "server-destinations"],
  "works-council-annex.md": ["ai-paths-people", "ai-paths", "deployment-switches"],
  "ai-act-readiness.md": ["ai-paths-people", "ai-paths"],
  "tom-sheet.md": ["browser-hosts", "server-destinations", "deployment-switches"],
  "model-notices.md": ["ai-paths"],
  "ai-literacy.md": [],
});
