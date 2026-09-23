/** Pure planner for importing the register's open GitLab issues into a fresh GitHub
 *  repository with their numbers preserved (sub-project 4 spec,
 *  docs/superpowers/specs/2026-09-23-issues-migration-design.md). No network, no
 *  filesystem, no shebang — the CLI (import-issues.mjs) owns I/O. */
import { isClosed, parseEntries } from "./followup-claims-lib.mjs";
import { issueSection } from "./followup-workitem-lib.mjs";
import { scanMessage } from "./identifier-leak-lib.mjs";

export const BODY_CAP = 20000;
export const TITLE_CAP = 256;
export const PLACEHOLDER_TITLE = "placeholder (deleted after import)";
export const STUB_TITLE_RE = /^GitLab #(\d+), closed before the migration$/;
const CUT_MARK = "\n\n… (cut — read the full entry in the register)";
const INDEX_ROW_RE = /^\| \[§(\d+)\]\(#([^)\s]+)\)/;
const OPEN_SUFFIX_RE = /\s+—\s+open\s*$/i;
const REGISTER_PATH = "docs/open-followups.md";

export function parseIndexAnchors(registerText) {
  const out = new Map();
  for (const line of registerText.split(/\r?\n/)) {
    const m = INDEX_ROW_RE.exec(line);
    if (m) out.set(Number(m[1]), m[2]);
  }
  return out;
}

/** An imported issue's title: `§N: <heading>`, minus the heading's trailing open marker.
 *  The title must survive a round trip through GitHub unchanged, because `--resume`
 *  compares the planned title with the listed one EXACTLY. So it drops Markdown bold
 *  markers (`**`, which a GitHub title shows literally), collapses every run of whitespace
 *  to one space and trims both ends — including after the cap, so a cut never ends in a
 *  space. Backticks stay: GitHub renders them in a title, and a `**` INSIDE a code span is
 *  literal text there (§429's heading quotes `**Status:**`), so only bold outside a code
 *  span is dropped. */
function stripBold(text) {
  return text
    .split(/(`[^`]*`)/)
    .map((part, i) => (i % 2 === 1 ? part : part.replaceAll("**", "")))
    .join("");
}

export function entryTitle(entry) {
  const heading = stripBold(entry.title).replace(OPEN_SUFFIX_RE, "").replace(/\s+/g, " ").trim();
  return `§${entry.n}: ${heading}`.slice(0, TITLE_CAP).trimEnd();
}

function paragraphs(lines) {
  return lines
    .join("\n")
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p !== "");
}

function pointer({ section, repoUrl, pointerStyle, anchor }) {
  const file = `${repoUrl}/blob/main/${REGISTER_PATH}`;
  if (pointerStyle === "anchor") {
    if (!anchor) throw new Error(`§${section} has no index anchor to link to`);
    return `Register entry [§${section}](${file}#${anchor}).`;
  }
  return `Register entry §${section} in [${REGISTER_PATH}](${file}) — search for \`## ${section}.\``;
}

export function issueBody(entry, { n, repoUrl, pointerStyle, anchor, date }) {
  const paras = paragraphs(entry.body);
  const status = paras.find((p) => p.startsWith("**Status:**"));
  const first = paras.find((p) => !p.startsWith("**Status:**") && !p.startsWith("**Work item:**"));
  const footer =
    `\n\n---\n_Imported from GitLab #${n} on ${date}. The register entry is the source of truth; ` +
    `update it, not this issue._`;
  let main = [pointer({ section: entry.n, repoUrl, pointerStyle, anchor }), status, first].filter(Boolean).join("\n\n");
  const room = BODY_CAP - footer.length;
  if (main.length > room) main = main.slice(0, room - CUT_MARK.length) + CUT_MARK;
  return main + footer;
}

export function stubIssue(gitlabIssue) {
  const section = issueSection(gitlabIssue.title);
  const body =
    section === null
      ? "This number belonged to a GitLab issue closed before the migration. It is kept so old citations resolve."
      : `This number belonged to the GitLab issue for register entry §${section}, closed before the migration. ` +
        "The closed entry in docs/open-followups.md is the record.";
  return { title: `GitLab #${gitlabIssue.iid}, closed before the migration`, body };
}

export function planImport(gitlabIssues, registerText, { repoUrl, pointerStyle, date }) {
  const byIid = new Map();
  for (const gi of gitlabIssues) {
    if (byIid.has(gi.iid)) throw new Error(`GitLab #${gi.iid} appears twice in the issue list`);
    byIid.set(gi.iid, gi);
  }
  const openEntries = new Map(
    parseEntries(registerText)
      .filter((e) => !isClosed(e.title))
      .map((e) => [e.n, e]),
  );
  const anchors = parseIndexAnchors(registerText);
  const usedSections = new Map();
  const max = Math.max(0, ...byIid.keys());
  const actions = [];
  for (let n = 1; n <= max; n += 1) {
    const gi = byIid.get(n);
    if (!gi) {
      actions.push({ n, kind: "placeholder", title: PLACEHOLDER_TITLE, body: "", labels: [] });
      continue;
    }
    if (gi.state === "closed") {
      actions.push({ n, kind: "stub", ...stubIssue(gi), labels: [] });
      continue;
    }
    if (gi.state !== "opened") {
      throw new Error(`GitLab #${n} has an unexpected state "${gi.state}"`);
    }
    const section = issueSection(gi.title);
    if (section === null) throw new Error(`open GitLab #${n} has no §NNN: title`);
    const claimedBy = usedSections.get(section);
    if (claimedBy !== undefined) {
      throw new Error(`GitLab #${claimedBy} and #${n} both name §${section} — one tracker issue per open entry`);
    }
    const entry = openEntries.get(section);
    if (!entry) throw new Error(`open GitLab #${n} names §${section}, which is not an OPEN register entry`);
    usedSections.set(section, n);
    actions.push({
      n,
      kind: "open",
      title: entryTitle(entry),
      body: issueBody(entry, { n, repoUrl, pointerStyle, anchor: anchors.get(section), date }),
      labels: [...gi.labels],
    });
  }
  return actions;
}

export function leakCheckPlan(actions, patterns) {
  let hitLines = 0;
  const classes = {};
  const actionsHit = [];
  for (const a of actions) {
    const r = scanMessage(`${a.title}\n${a.body}`, patterns);
    if (r.hitLines === 0) continue;
    hitLines += r.hitLines;
    actionsHit.push(a.n);
    for (const [k, v] of Object.entries(r.classes)) classes[k] = (classes[k] ?? 0) + v;
  }
  return { hitLines, classes, actionsHit };
}
