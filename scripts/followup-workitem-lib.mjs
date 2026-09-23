/** The `**Work item:**` contract for docs/open-followups.md.
 *
 *  Since 2026-09-13 every OPEN entry carries exactly one line starting
 *  `**Work item:**` whose remainder is a GitLab issue (`#NN`) or exactly
 *  `none — decision record`; a CLOSED entry carries none. §531 records that
 *  nothing enforced it, so it would decay the way the Status lines did.
 *
 *  ★★★ THIS READS THE REGISTER ONLY. It proves each entry POINTS at an issue,
 *  never that the issue is open, exists, or is still about this entry — an
 *  issue closed in GitLab while its entry stays open passes here.
 *
 *  ★★ Parsing is NOT re-implemented here, for the reason `followup-status-lib.mjs`
 *  gives: `parseEntries`/`isClosed` come from `followup-claims-lib.mjs`, and fence
 *  state comes from the hardened `stripFencedBlocks`. */
import { isClosed } from "./followup-claims-lib.mjs";
import { stripFencedBlocks } from "./doc-claims-lib.mjs";

export const WORK_ITEM_PREFIX = "**Work item:**";

/** Body lines that START with the prefix, outside fenced blocks.
 *  ★★ START, not contain: the register's prose discusses the convention by name
 *  mid-line (§531 does), and counting those would report DUPLICATE_LINE on the
 *  entry that documents the rule. ★ A fenced sample line is an example, not a
 *  claim — `stripFencedBlocks` blanks it, delimiters included. */
export function workItemLines(entry) {
  const stripped = stripFencedBlocks(entry.body.join("\n"));
  return stripped.filter((l) => l.startsWith(WORK_ITEM_PREFIX));
}

// ★ `[1-9]\d{0,9}`: `#0`, a leading zero (`#012` would read as 12) and an iid
// past ten digits (`Number` loses precision) are malformed, not normalised.
const ISSUE_RE = /^\*\*Work item:\*\* #([1-9]\d{0,9})\s*$/;
const DECISION_RE = /^\*\*Work item:\*\* none — decision record\s*$/;

/** `{kind:"issue", iid}` | `{kind:"decision"}` | `null` (malformed).
 *  ★ Trailing whitespace is the ONLY tolerance. A trailing period, a second
 *  issue, or a hyphen for the em dash is malformed: a line a machine will read
 *  (the GitLab comparison) must have one spelling. */
export function parseWorkItem(line) {
  const m = ISSUE_RE.exec(line);
  if (m) return { kind: "issue", iid: Number(m[1]) };
  if (DECISION_RE.test(line)) return { kind: "decision" };
  return null;
}

function entryViolations(entry, lines) {
  const out = [];
  const base = { n: entry.n, title: entry.title };
  if (lines.length > 1) {
    out.push({ ...base, code: "DUPLICATE_LINE", detail: `${lines.length} lines` });
  }
  if (isClosed(entry.title)) {
    if (lines.length > 0) out.push({ ...base, code: "ON_CLOSED" });
    return out;
  }
  if (lines.length === 0) out.push({ ...base, code: "MISSING" });
  for (const l of lines) {
    if (parseWorkItem(l) === null) out.push({ ...base, code: "MALFORMED", detail: l });
  }
  return out;
}

/** ★★ ISSUE_REUSED keys on the entry OBJECT, not its §number: a number used
 *  twice is the index gate's finding, and keying on it here would fold two
 *  entries into one and hide the reuse. Reported on EVERY entry involved, so a
 *  reader fixing either one sees the other. */
function reusedIssues(open) {
  const byIid = new Map();
  for (const { entry, lines } of open) {
    for (const l of lines) {
      const w = parseWorkItem(l);
      if (w?.kind !== "issue") continue;
      if (!byIid.has(w.iid)) byIid.set(w.iid, new Set());
      byIid.get(w.iid).add(entry);
    }
  }
  const out = [];
  for (const [iid, set] of byIid) {
    if (set.size < 2) continue;
    for (const entry of set) {
      const others = [...set].filter((e) => e !== entry).map((e) => `§${e.n}`);
      out.push({
        n: entry.n,
        title: entry.title,
        code: "ISSUE_REUSED",
        detail: `#${iid} also claimed by ${others.join(", ")}`,
      });
    }
  }
  return out;
}

export function workItemViolations(entries) {
  const scanned = entries.map((entry) => ({ entry, lines: workItemLines(entry) }));
  const out = scanned.flatMap(({ entry, lines }) => entryViolations(entry, lines));
  return [...out, ...reusedIssues(scanned.filter(({ entry }) => !isClosed(entry.title)))];
}

export const REGISTER_LABEL = "source::register";

// ★ Same number rule as ISSUE_RE: `§012:` would otherwise read as §12.
const SECTION_TITLE_RE = /^§([1-9]\d{0,9}):/;

/** The §number an issue title claims, or null when it carries no `§NNN:` prefix. */
export function issueSection(title) {
  const m = SECTION_TITLE_RE.exec(String(title));
  return m ? Number(m[1]) : null;
}

/** Open entries whose ONE Work item line parses. ★ An entry with no line, two
 *  lines or a malformed one is the BLOCKING gate's finding and is skipped here —
 *  reporting it twice, once per gate, would only add noise. */
function linkedEntries(entries) {
  const out = [];
  for (const entry of entries) {
    if (isClosed(entry.title)) continue;
    const lines = workItemLines(entry);
    const work = lines.length === 1 ? parseWorkItem(lines[0]) : null;
    out.push({ n: entry.n, work });
  }
  return out;
}

function entrySideProblems(links, issueByIid, add) {
  const mismatched = new Set();
  for (const { n, work } of links) {
    if (work?.kind !== "issue") continue;
    const issue = issueByIid.get(work.iid);
    if (!issue) {
      add("ISSUE_NOT_OPEN", `§${n} → #${work.iid}, which is not an open issue`);
      continue;
    }
    const section = issueSection(issue.title);
    if (section !== n) {
      const titled = section === null ? "has no §NNN: title" : `is titled §${section}`;
      add("ISSUE_SECTION_MISMATCH", `§${n} → #${work.iid}, which ${titled}`);
      mismatched.add(work.iid);
    }
  }
  return mismatched;
}

function sectionCollisions(registerIssues, add) {
  const bySection = new Map();
  for (const issue of registerIssues) {
    const s = issueSection(issue.title);
    if (s === null) continue;
    if (!bySection.has(s)) bySection.set(s, []);
    bySection.get(s).push(issue.iid);
  }
  for (const [s, iids] of bySection) {
    if (iids.length > 1) add("SECTION_ON_TWO_ISSUES", `§${s} on ${iids.map((i) => `#${i}`).join(", ")}`);
  }
}

/** Compare the register's Work item lines with the OPEN tracker issues (GitLab
 *  or GitHub), in both directions. `entries` is `parseEntries` output (closed
 *  ones are filtered here); `issues` is `[{iid, title, labels}]`, every open
 *  issue fetched.
 *
 *  ★ An open issue with NEITHER a `§NNN:` title NOR the register label is not
 *  register work and is ignored. Either one alone makes it register work.
 *
 *  ★★ NO DOUBLE REPORT: an issue already reported as ISSUE_SECTION_MISMATCH is
 *  never ALSO reported as ISSUE_UNLINKED. Both findings would describe the SAME
 *  issue from its two ends: some entry links it (so it is linked, just to the
 *  wrong §), and the mismatch detail already names the § the title claims, so the
 *  reader sees both sides from one line. Reporting it twice made one wrong link
 *  read as two defects. */
export function compareWithTracker(entries, issues) {
  const problems = [];
  const add = (code, detail) => problems.push({ code, detail });
  const links = linkedEntries(entries);
  const issueByIid = new Map(issues.map((i) => [i.iid, i]));
  const linkedIidByN = new Map();
  for (const { n, work } of links) {
    if (work?.kind === "issue") linkedIidByN.set(n, work.iid);
  }
  const openNumbers = new Set(links.map((l) => l.n));
  // null = no, several or a malformed Work item line: the blocking gate's finding.
  const workByN = new Map(links.map((l) => [l.n, l.work]));

  const mismatched = entrySideProblems(links, issueByIid, add);

  const registerIssues = issues.filter(
    (i) => issueSection(i.title) !== null || (i.labels ?? []).includes(REGISTER_LABEL),
  );
  for (const issue of registerIssues) {
    const section = issueSection(issue.title);
    const labelled = (issue.labels ?? []).includes(REGISTER_LABEL);
    if (section === null) {
      add("ISSUE_UNTITLED", `#${issue.iid} is labelled ${REGISTER_LABEL} but its title has no §NNN: prefix`);
      continue;
    }
    if (!labelled) add("ISSUE_UNLABELLED", `#${issue.iid} (§${section}) lacks ${REGISTER_LABEL}`);
    if (!openNumbers.has(section)) {
      add("ISSUE_WITHOUT_ENTRY", `#${issue.iid} is titled §${section}, which is not an open entry`);
    } else if (
      workByN.get(section) !== null &&
      linkedIidByN.get(section) !== issue.iid &&
      !mismatched.has(issue.iid)
    ) {
      const has = linkedIidByN.has(section) ? `#${linkedIidByN.get(section)}` : "no issue";
      add("ISSUE_UNLINKED", `#${issue.iid} is titled §${section}, but §${section}'s Work item line names ${has}`);
    }
  }
  sectionCollisions(registerIssues, add);

  const counts = {
    openEntries: links.length,
    linked: links.filter((l) => l.work?.kind === "issue").length,
    decisionRecords: links.filter((l) => l.work?.kind === "decision").length,
    openIssues: issues.length,
    // ★★ The CLI's floor reads THIS, not openIssues: a fetch full of unrelated
    // issues and empty of register ones is a blind scan, not 200+ findings.
    registerIssues: registerIssues.length,
  };
  return { problems, counts };
}

export const TRACKER_PROBLEM_HELP = {
  ISSUE_NOT_OPEN:
    "the issue was closed or the number is wrong: reopen it, or close the entry, or fix the number",
  ISSUE_SECTION_MISMATCH: "the Work item line points at another entry's issue: fix the number or the issue title",
  ISSUE_WITHOUT_ENTRY: "the entry is closed or does not exist: close the issue, or fix its §number",
  ISSUE_UNLINKED: "the entry's Work item line names something else: link this issue, or close the duplicate",
  SECTION_ON_TWO_ISSUES: "one issue per open entry: close the duplicate issue",
  ISSUE_UNTITLED: `retitle it \`§NNN: <entry heading>\`, or remove ${REGISTER_LABEL} if it is not register work`,
  ISSUE_UNLABELLED: `add the ${REGISTER_LABEL} label`,
};

export const VIOLATION_HELP = {
  MISSING:
    "add `**Work item:** #NN` after the Status block, creating the tracker issue in the same change, or `**Work item:** none — decision record`",
  DUPLICATE_LINE: "keep exactly one `**Work item:**` line at the start of a line; delete the rest",
  MALFORMED:
    "the remainder must be exactly `#NN` or `none — decision record` (em dash), with nothing after it",
  ON_CLOSED: "a closed entry carries no `**Work item:**` line; delete it and close the tracker issue",
  ISSUE_REUSED:
    "one tracker issue per open entry; create a separate issue for one of them, or merge the entries",
};
