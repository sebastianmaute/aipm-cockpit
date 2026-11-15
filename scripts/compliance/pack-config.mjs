/** Register numbers the compliance pack cites as open gaps. Each must be an
 *  open entry of `docs/open-followups.md` (`gapViolations` in `pack-lib.mjs`). */
export const CITED_GAPS = [487, 562, 793, 794, 795, 796, 798, 799, 800, 801, 802, 804, 810, 811, 812, 813, 814];

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

/** The generated blocks each AI-brief file carries (`docs/briefs/{en,de}/`), in document order, the same in both
 *  languages. Only the appendix has any; the pages are prose. Checked like BLOCKS_BY_FILE. */
export const BRIEF_BLOCKS_BY_FILE = Object.freeze({
  "ceo.md": [],
  "cio.md": [],
  "ciso.md": [],
  "caio.md": [],
  "coo.md": [],
  "dpo.md": [],
  "pm.md": [],
  "appendix.md": [
    "ai-paths-people",
    "ai-paths",
    "server-destinations",
    "browser-hosts",
    "deployment-switches",
    "open-gaps",
    "figures",
    "team-month",
  ],
});
