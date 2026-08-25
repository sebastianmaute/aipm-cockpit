// Probe for docs/superpowers/specs/2026-08-25-asset-id-extraction-design.md.
//
// Emits the spec's "Measured behaviour" table. The three patterns below are
// COPIES, not imports: the spec compares the CURRENT ASSET_ID_RE against a
// PROPOSED replacement, and only one of those can exist in src at a time. Once
// the slice lands, the OLD column is the historical half and only the NEW
// column is reproducible from src — re-derive it with
// `grep -n "ANY_TAG_ASSET_ID_RE = " src/app/document-asset-patterns.ts`.
//
// Run: node docs/superpowers/specs/_probes/asset-id-extraction.mjs

/** Today's cap/usage scanner (document-asset-usage.ts). */
const OLD = /data-asset-id="([^"]*)"/g;
/** The proposed replacement: attribute inside ANY start tag, quote-aware. */
const NEW = /<[a-zA-Z][^\s/>]*(?:[^>"']|"[^"]*"|'[^']*')*?\bdata-asset-id="([^"]*)"/g;
/** Unchanged by this slice — the export scanner (document-export-assets.ts). */
const IMG =
  /<img\b(?:[^>"']|"[^"]*"|'[^']*')*\bdata-asset-id="([^"]*)"(?:[^>"']|"[^"]*"|'[^']*')*>/g;

// The `.filter(id => id.length > 0)` mirrors assetIdsInBlock's call site: the
// patterns admit an empty id and the caller is what rejects it.
const ids = (re, s) => [...s.matchAll(re)].map((m) => m[1]).filter((x) => x.length > 0);

/** The spec's table, in spec order. */
const TABLE = [
  `<img data-asset-id="real" alt="x">`,
  `<span data-asset-id="x">t</span>`,
  `<p>data-asset-id="abc"</p>`,
  `<img alt="data-asset-id=" data-asset-id="real">`,
  `<img data-asset-id="r1" alt="data-asset-id="><img data-asset-id="r2" alt="x">`,
  `<img data-asset-id='sq'>`,
  `<IMG DATA-ASSET-ID="d">`,
  `<IMG data-asset-id="up">`,
  `<img data-asset-id="">`,
  `<img alt="a>b" data-asset-id="real">`,
];

/** The shapes carried as ★ notes rather than table rows. */
const NOTES = [
  [`<imgdata-asset-id="x">`, "third narrowing: malformed, counted today, not after"],
  [`<!-- <img data-asset-id="c"> -->`, "comment: unchanged by this slice"],
  [`<img\n  data-asset-id="nl">`, "newline inside the tag: unchanged"],
];

const j = (v) => JSON.stringify(v);

console.log("| input | `all` today | `all` after | `drawable` (unchanged) |");
console.log("|---|---|---|---|");
for (const html of TABLE) {
  console.log(`| \`${html}\` | \`${j(ids(OLD, html))}\` | \`${j(ids(NEW, html))}\` | \`${j(ids(IMG, html))}\` |`);
}

console.log("\n-- note shapes --");
for (const [html, why] of NOTES) {
  console.log(`${j(html)}\n  OLD ${j(ids(OLD, html))}  NEW ${j(ids(NEW, html))}  -- ${why}`);
}

// The relationship the cap message's arithmetic depends on. Not a guarantee by
// construction (two patterns over raw HTML); this asserts no row above breaks it.
console.log("\n-- drawable subset of NEW all, every row --");
let ok = true;
for (const html of [...TABLE, ...NOTES.map(([h]) => h)]) {
  const all = new Set(ids(NEW, html));
  const bad = ids(IMG, html).filter((x) => !all.has(x));
  if (bad.length) {
    ok = false;
    console.log(`  FAIL ${j(html)} -> drawable ids absent from all: ${j(bad)}`);
  }
}
console.log(ok ? "  holds on every row" : "  VIOLATED -- the spec's claim is stale");
process.exit(ok ? 0 : 1);
