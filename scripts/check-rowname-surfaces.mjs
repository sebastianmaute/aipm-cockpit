// Enumerates the places a per-row control's accessible name is composed, and
// says which of them a unit test asserts are distinct (WCAG 2.4.6).
//
// ★★★ A REPORT, NOT A GATE. It always exits 0 on a successful scan. It is
// deliberately absent from `.gitlab-ci.yml`, and adding it there would be a
// mistake: a real gate would have to RENDER each panel against a collision
// fixture and read the accessible names off the tree, which nothing static can
// do — whether two names collide depends on the DATA, and the data is not in
// the source.
//
// ★★★ A CLEAN LINE IS NOT EVIDENCE OF CORRECTNESS. `COVERED` means only that a
// test file mentioning the module also contains a row-unique assertion. It does
// not mean the assertion reaches THIS control, that the fixture can express a
// collision, or that the test is not vacuous — `src/test/row-unique-names.ts`
// records at three stars how a floor-guarded assertion still passed against a
// zero-row fixture.
//
// It exists because the enumeration method it replaces is provably incomplete:
// two rounds of these fixes were scoped by grepping for `aria-label`, and each
// round believed it had found them all.
//
// Usage:
//   node scripts/check-rowname-surfaces.mjs             summary + every GAP in
//                                                       full, covered files as
//                                                       one line each
//   node scripts/check-rowname-surfaces.mjs --all       every site, covered too
//   node scripts/check-rowname-surfaces.mjs --gaps      the GAP files alone
//   node scripts/check-rowname-surfaces.mjs --json out.json
import { writeFileSync } from "node:fs";
import path from "node:path";
import url from "node:url";

import { buildReport, collectSources } from "./rowname-surfaces-lib.mjs";

const args = process.argv.slice(2);
const gapsOnly = args.includes("--gaps");
const showAll = args.includes("--all");
const jsonAt = args.indexOf("--json");

// A usage error is neither a finding nor a floor. Catch it before any work, so
// the failure names the flag instead of surfacing deep inside `writeFileSync`.
if (jsonAt !== -1 && (args[jsonAt + 1] === undefined || args[jsonAt + 1].startsWith("--"))) {
  console.error("--json needs a file path: node scripts/check-rowname-surfaces.mjs --json out.json");
  process.exit(2);
}

const repoRoot = path.join(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const { sources, tests } = collectSources(repoRoot);

// A scan that reads nothing passes everything. Fail loudly rather than print an
// empty, reassuring report.
if (sources.size === 0) {
  console.error("no .tsx sources found under src/ — is this being run from a checkout?");
  process.exit(2);
}

const report = buildReport({ sources, tests });
const { summary } = report;

const LEG_NOTE = {
  attribute: "aria-label / ariaLabel / a component's label prop (whitespace-tolerant)",
  content: "no aria-label — name falls back to CONTENT",
  delegated: "per-item component composing a name from a prop entity",
  labelledby: "aria-labelledby — name lives elsewhere, not classifiable here",
};

const lines = [];
const out = (s = "") => lines.push(s);

out("Row-name surfaces — WCAG 2.4.6 enumeration");
out("=".repeat(78));
out("REPORT, NOT A GATE. Always exits 0. Not wired into CI, and should not be.");
out("");
out(`scanned            ${summary.sourceFiles} .tsx sources, ${summary.testFiles} test files`);
out(`tests asserting    ${summary.assertingTests} (matched by CONTENT, never by test name)`);
out(`surfaces           ${summary.sites} sites in ${summary.surfaceFiles} files`);
out(
  `  by leg           attribute ${summary.byLeg.attribute} | content ${summary.byLeg.content} | delegated ${summary.byLeg.delegated} | labelledby ${summary.byLeg.labelledby}`,
);
out(
  `  by name class    FIXED ${summary.byClass.FIXED} | DATA ${summary.byClass.DATA} | TOKENIZED ${summary.byClass.TOKENIZED} | UNRESOLVED ${summary.byClass.UNRESOLVED}`,
);
out(
  `  by coverage      COVERED ${summary.byStatus.COVERED} | COVERED_VIA_PARENT ${summary.byStatus.COVERED_VIA_PARENT} | GAP ${summary.byStatus.GAP}   (files)`,
);
out("");
out("legs");
for (const [leg, note] of Object.entries(LEG_NOTE)) out(`  ${leg.padEnd(11)} ${note}`);
out("");
out("name classes");
out("  FIXED       nothing per-row survives — every row announces the SAME name");
out("  TOKENIZED   routed through the row-token machinery (buildRowTokens/rowLabel/...)");
out("  DATA        some other value reaches the name — collides when that value repeats");
out("  UNRESOLVED  aria-labelledby; nothing static can classify it");
out("");

function detail(surface) {
  const suffix = surface.via ? `  <- ${surface.via} [${surface.markers.join(", ")}]` : "";
  out(`${surface.status.padEnd(18)} ${surface.file}${suffix}`);
  for (const site of surface.sites) {
    out(
      `  ${String(site.line).padStart(5)}  ${site.leg.padEnd(11)} ${site.nameClass.padEnd(10)} <${site.tag}> ${site.name}`,
    );
  }
}

const gaps = report.surfaces.filter((s) => s.status === "GAP");
const covered = report.surfaces.filter((s) => s.status !== "GAP");

out(`GAP — no asserting test found (${gaps.length} files)`);
out("-".repeat(78));
for (const surface of gaps) detail(surface);

if (!gapsOnly) {
  out("");
  out(`COVERED — an asserting test mentions this module (${covered.length} files)`);
  out("-".repeat(78));
  for (const surface of covered) {
    if (showAll) {
      detail(surface);
      continue;
    }
    // One line per file by default. The per-site detail for these is available
    // under --all; burying 13 answerable gaps under 93 covered files is how a
    // report stops being read.
    const classes = [...new Set(surface.sites.map((s) => s.nameClass))].sort().join("/");
    out(
      `${surface.status.padEnd(18)} ${surface.file}  ${surface.sites.length} site(s) ${classes}  <- ${surface.via}`,
    );
  }
}

out("");
out("what this cannot see".toUpperCase());
out("-".repeat(78));
out("  * whether any two names ACTUALLY collide. That depends on the data, and the");
out("    data is not in the source. Only a rendered test can answer it.");
out("  * a list built by anything other than `.map` — a `for` loop, a `flatMap`, or");
out("    rows assembled by a helper in another module.");
out("  * a control inside a component this scanner does not recognise as one. The");
out("    component-name rule is a suffix heuristic and is the weakest rule here.");
out("  * leg (3) is approximate by construction: it fires only when the name is DATA");
out("    and its base identifier is a DESTRUCTURED prop. A component reading its");
out("    entity off a context, or off a prop it never destructures, is missed.");
out("  * whether a COVERED test is VACUOUS. It is not evidence of correctness — see");
out("    src/test/row-unique-names.ts, where a floor-guarded assertion passed against");
out("    a zero-row fixture. A GAP is a question; a COVERED is a weaker question.");
out("  * a GAP may be covered by a test two hops away, or by one that asserts the");
out("    property without using any of the marker phrases.");
out("  * the marker on a COVERED line says how strong the evidence is. A lone");
out("    `unique` can be about a unique id; `expectRowUniqueNames` is the shared");
out("    helper and means someone meant THIS property.");

console.log(lines.join("\n"));

if (jsonAt !== -1) writeFileSync(args[jsonAt + 1], JSON.stringify(report, null, 2));
