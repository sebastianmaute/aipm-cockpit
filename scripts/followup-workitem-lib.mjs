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

const ISSUE_RE = /^\*\*Work item:\*\* #(\d+)\s*$/;
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

export const VIOLATION_HELP = {
  MISSING:
    "add `**Work item:** #NN` after the Status block, creating the GitLab issue in the same change, or `**Work item:** none — decision record`",
  DUPLICATE_LINE: "keep exactly one `**Work item:**` line at the start of a line; delete the rest",
  MALFORMED:
    "the remainder must be exactly `#NN` or `none — decision record` (em dash), with nothing after it",
  ON_CLOSED: "a closed entry carries no `**Work item:**` line; delete it and close the GitLab issue",
  ISSUE_REUSED:
    "one GitLab issue per open entry; create a separate issue for one of them, or merge the entries",
};
