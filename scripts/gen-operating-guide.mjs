// scripts/gen-operating-guide.mjs
// Reads the shipped /lib leadership guide and emits a TS constant so the client
// can seed it without a runtime fetch. Mirrors the repo's "prebuild keeps
// generated docs in sync" convention. Committed output + a sync-guard test.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const SRC = join(process.cwd(), "lib", "project-leadership-operating-guide.md");
const FEATURE_SRC = join(process.cwd(), "lib", "app-feature-guide.md");
const ACTION_SRC = join(process.cwd(), "lib", "ai-action-guides.md");
const OUT = join(process.cwd(), "src", "app", "operating-guide-builtin.generated.ts");

const content = readFileSync(SRC, "utf8");

/** Parse the feature md into ordered guide seeds: always-on overview
 *  (builtin-app-overview, scope {}) + one per "## Title" + "<!-- views: a,b -->"
 *  section (builtin-feature-<firstView>, scope {views:[...]}). Throws on an
 *  unknown view id. Pure. */
export function parseFeatureGuide(md, validViews) {
  const lines = md.split(/\r?\n/);
  const guides = [];
  let cur = null;
  const flush = () => {
    if (!cur) return;
    const content = [`## ${cur.title}`, ...cur.body].join("\n").trim();
    if (cur.title === "Overview") guides.push({ id: "builtin-app-overview", name: "App overview", content, scope: {} });
    else if (cur.scopeViews) guides.push({ id: `builtin-feature-${cur.scopeViews[0]}`, name: `Feature: ${cur.title}`, content, scope: { views: cur.scopeViews } });
    else throw new Error(`app-feature-guide: section "${cur.title}" has no "<!-- views: ... -->" marker (and is not Overview) — it would be silently dropped`);
    cur = null;
  };
  for (const line of lines) {
    const h = /^## (.+)$/.exec(line);
    if (h) { flush(); cur = { title: h[1].trim(), scopeViews: null, body: [] }; continue; }
    const sm = /^<!--\s*views:\s*([^>]+?)\s*-->$/.exec(line.trim());
    if (sm && cur) {
      const views = sm[1].split(",").map((v) => v.trim()).filter(Boolean);
      for (const v of views) if (!validViews.includes(v)) throw new Error(`app-feature-guide: unknown view id "${v}" in section "${cur.title}"`);
      cur.scopeViews = views;
      continue;
    }
    if (cur) cur.body.push(line);
  }
  flush();
  return guides;
}

/** The AppView ids a feature guide section may scope to. Exported so the
 *  sync-guard test can parse the source md with the same valid-view list the
 *  generator uses (DRY). Script-only — not part of the generated output. */
/** MUST mirror `AppView` in src/app/nav-config.ts. It is duplicated rather than
 *  imported because this script is .mjs and AppView is a TS type — nothing
 *  gates the two against each other. This list silently omitted `insights`,
 *  `documents` and `help` for as long as those views existed, which does not
 *  fail: it makes a guide section for them THROW as an unknown view id, so the
 *  view simply goes undocumented. Re-derive after adding a view:
 *    grep -A40 'export type AppView' src/app/nav-config.ts */
export const VALID_VIEWS = ["projects","open-points","dashboard","actions","insights","trends","history","chat","gantt","milestones","resources","directory","workload","calendar","planning","manage-roles","budget","budget-report","raid","raid-report","changes","change-report","forecast","stakeholders","raci","stakeholder-map","knowledge","documents","reports","activity","settings","help","learning-insights","steering-committee","timelog","portfolio-health"];

/** The AI actions an action guide may target (§701). MUST mirror `AI_TARGETS`
 *  in src/app/operating-guide.ts minus "chat" — duplicated for the same reason
 *  as VALID_VIEWS; `operating-guide-targets.test.ts` pins the two together. */
export const VALID_ACTION_TARGETS = ["wbs","alloc","committeeReport","projectProposal","raci","digest","insightRecommend","jobAnalysis","dedup","weights","inlineEdit","forecastImport"];

/** Parse lib/ai-action-guides.md: one guide per "## Title" section carrying a
 *  "<!-- targets: a,b -->" marker (id builtin-action-<firstTarget>, scope
 *  {targets:[...]}). Text before the first section is the file's preamble and
 *  is not a guide. Throws on an untagged section, an unknown target, or two
 *  sections claiming the same first target (their ids would collide). Pure. */
export function parseActionGuides(md, validTargets) {
  const lines = md.split(/\r?\n/);
  const guides = [];
  const seen = new Set();
  let cur = null;
  const flush = () => {
    if (!cur) return;
    if (!cur.targets) throw new Error(`ai-action-guides: section "${cur.title}" has no "<!-- targets: ... -->" marker — it would reach no action`);
    const id = `builtin-action-${cur.targets[0]}`;
    if (seen.has(id)) throw new Error(`ai-action-guides: two sections start with target "${cur.targets[0]}"`);
    seen.add(id);
    guides.push({ id, name: `AI action: ${cur.title}`, content: [`## ${cur.title}`, ...cur.body].join("\n").trim(), scope: { targets: cur.targets } });
    cur = null;
  };
  for (const line of lines) {
    const h = /^## (.+)$/.exec(line);
    if (h) { flush(); cur = { title: h[1].trim(), targets: null, body: [] }; continue; }
    const tm = /^<!--\s*targets:\s*([^>]+?)\s*-->$/.exec(line.trim());
    if (tm && cur) {
      const targets = tm[1].split(",").map((v) => v.trim()).filter(Boolean);
      for (const v of targets) if (!validTargets.includes(v)) throw new Error(`ai-action-guides: unknown target "${v}" in section "${cur.title}"`);
      cur.targets = targets;
      continue;
    }
    if (cur) cur.body.push(line);
  }
  flush();
  return guides;
}

const isMain = process.argv[1] ? process.argv[1].replace(/\\/g, "/").endsWith("gen-operating-guide.mjs") : false;
if (isMain) {
  const featureGuides = existsSync(FEATURE_SRC) ? parseFeatureGuide(readFileSync(FEATURE_SRC, "utf8"), VALID_VIEWS) : [];
  const actionGuides = parseActionGuides(readFileSync(ACTION_SRC, "utf8"), VALID_ACTION_TARGETS);
  const out = `// AUTO-GENERATED by scripts/gen-operating-guide.mjs — do not edit by hand.
// Sources: lib/project-leadership-operating-guide.md, lib/app-feature-guide.md, lib/ai-action-guides.md
export const BUILTIN_GUIDE_ID = "builtin-leadership";
export const BUILTIN_GUIDE_NAME = "Project Leadership Operating Guide";
export const BUILTIN_GUIDE_CONTENT = ${JSON.stringify(content)};
export const BUILTIN_FEATURE_GUIDES: { id: string; name: string; content: string; scope: { views?: string[] } }[] = ${JSON.stringify(featureGuides, null, 2)};
export const BUILTIN_ACTION_GUIDES: { id: string; name: string; content: string; scope: { targets: string[] } }[] = ${JSON.stringify(actionGuides, null, 2)};
`;
  // Force LF so the output is byte-identical on every platform (the template
  // literal above inherits this file's own EOL, which is CRLF on a Windows
  // autocrlf checkout, while JSON.stringify emits LF — a mix that makes the
  // regenerated file differ from the committed blob). Pinned LF in .gitattributes.
  writeFileSync(OUT, out.replace(/\r\n/g, "\n"), "utf8");
  console.log(`gen-operating-guide: wrote ${OUT} (leadership ${content.length} chars, ${featureGuides.length} feature guides, ${actionGuides.length} action guides)`);
}
