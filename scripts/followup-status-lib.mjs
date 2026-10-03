/** The `**Status:**` contract for OPEN entries in docs/open-followups.md.
 *
 *  ★★★ WHY THIS IS A GATE AND NOT A REPORT. 118 of 175 open entries had no
 *  Status line on 2026-08-28, and nothing had ever checked. An unenforced
 *  convention in this repo decays; the register itself records that as a class.
 *
 *  ★★ Parsing is NOT re-implemented here. `parseEntries`/`isClosed` come from
 *  `followup-claims-lib.mjs`, because a second, differently-spelled heading
 *  parser is a second thing to drift out of agreement with the first. */

import { isClosed } from "./followup-claims-lib.mjs";

/** The Status BLOCK: from the `**Status:**` line to the next blank line.
 *  ★★ Status lines WRAP in this register, so a single-line match would read
 *  only the first physical line and fail a conformant entry whose date or
 *  command sits on the second. For a blocking gate that is the expensive
 *  direction of error. */
export function statusBlock(entry) {
  const i = entry.body.findIndex((l) => /^\*\*Status:\*\*/.test(l));
  if (i === -1) return null;
  const out = [entry.body[i]];
  for (let j = i + 1; j < entry.body.length; j++) {
    if (entry.body[j].trim() === "") break;
    out.push(entry.body[j]);
  }
  return out.join("\n");
}

/** Clause 4 of the contract: the block names the last EXECUTED verification, or
 *  says outright that none has been run.
 *
 *  ★★★ THE PATTERN IS COMMAND-SHAPED, NOT MERELY BACKTICKED, AND THAT WAS
 *  MEASURED RATHER THAN CHOSEN ON TASTE. The first cut accepted any backticked
 *  span. Against the real register on 2026-08-28 that admitted 53 of the 100
 *  entries carrying a Status line, while the command-shaped rule admitted 43 —
 *  and every one of the 43 passed via the never-verified escape below, because
 *  NOT ONE pre-existing Status line cited a command. So the extra 10 were
 *  passing on a backticked FILENAME or SYMBOL: certified as "names a
 *  verification" while naming none. That is the exact silence this contract
 *  exists to end, so the loose rule would have been a gate that reports success.
 *  Reproduce by relaxing the regex and re-running the real-register test.
 *
 *  ★★ The escape hatch is deliberate and is the honest answer for most entries.
 *  `**Status:** open — never machine-verified.` is greppable; silence is not.
 *  Without it the gate would push authors toward inventing a verification,
 *  which is strictly worse than admitting none was run. */
const VERIFICATION_RE = /`\s*(?:grep|npm run|npx|node scripts)\b[^`]*`/;
const NEVER_VERIFIED_RE = /never machine-verified/i;

export function statusViolations(entry) {
  const block = statusBlock(entry);
  if (block === null) return ["MISSING"];
  const out = [];
  // The heading owns closure. A body line claiming it breaks every count.
  if (/\bCLOSED\b/.test(block)) out.push("SAYS_CLOSED");
  if (!/\b20\d\d-\d\d-\d\d\b/.test(block)) out.push("NO_DATE");
  if (!VERIFICATION_RE.test(block) && !NEVER_VERIFIED_RE.test(block)) {
    out.push("NO_VERIFICATION");
  }
  return out;
}

/** ★★★ CLOSED ENTRIES ARE GATED FROM A CUTOFF DATE, NOT BASELINED (§429, owner decision
 *  2026-10-03). A closure is the moment a fabricated verification is most tempting and, until
 *  this, the one Status line the gate never read. Widening the filter outright lights up the 124
 *  historical closures that name no command, so only entries whose heading says
 *  ` — CLOSED <date>` with a date ON OR AFTER this cutoff are checked; everything closed
 *  earlier stays ungated BY DESIGN (rewriting history to satisfy a new rule would invent
 *  verifications that were never run). The cutoff is the day AFTER the batch that introduced
 *  this rule closed its own entries (2026-10-03), so none of those closures is judged
 *  retroactively. Moving it earlier needs the entries it newly covers to conform first. */
export const CLOSED_CUTOFF = "2026-10-04";

/** The date in a heading's `CLOSED <date>` suffix, or null.
 *  ★★ Case-SENSITIVE, like `isClosed`: that is the real heading form, and a lowercase
 *  "closed" is not a closure marker anywhere in this register's tooling. */
export function closedDate(title) {
  const m = /\bCLOSED (\d{4}-\d{2}-\d{2})\b/.exec(title);
  return m ? m[1] : null;
}

/** True for a closed entry whose closure date is on or after the cutoff (inclusive; ISO
 *  dates compare correctly as strings). A closed entry with no parsable date is ungated. */
export function isGatedClosed(title, cutoff = CLOSED_CUTOFF) {
  const d = closedDate(title);
  return d !== null && d >= cutoff;
}

/** ★★ A DECISION CLOSURE HAS NO NATURAL COMMAND, so it may carry this marker instead (owner
 *  ruling 2026-10-03): `owner decision <ISO date>` or `owner ruling <ISO date>`. Without it,
 *  closing an accepted-risk or decided-not-to-build entry would push the author toward a token
 *  `grep` added only to pass, the fabrication this gate exists to prevent.
 *  ★ NARROW ON PURPOSE. The date must FOLLOW the phrase directly: the house form "accepted by
 *  owner ruling: …" names no date of its own and does not pass, and neither does a bare
 *  "owner" or "decided by the owner". Case-sensitive except the first letter, which may be
 *  capitalised at a sentence start ("Owner decision 2026-09-23" is already in the register). */
const OWNER_DECISION_RE = /\b[Oo]wner (?:decision|ruling) 20\d\d-\d\d-\d\d\b/;

/** The contract for a gated CLOSED entry. Per universe: `SAYS_CLOSED` INVERTS (the Status
 *  must open with CLOSED, so a closure cannot hide behind an open-style note), `NO_DATE` means
 *  the same as for an open entry, and `NO_VERIFICATION` is satisfied by a command (as for an
 *  open entry) OR by the owner-decision marker above. The `never machine-verified` escape is
 *  NOT accepted: a closure claims the work is done, and admitting nothing was run is the
 *  open-entry honesty, not a closure's. */
export function closedStatusViolations(entry) {
  const block = statusBlock(entry);
  if (block === null) return ["MISSING"];
  const out = [];
  if (!/^\*\*Status:\*\*\s*CLOSED\b/.test(block)) out.push("NOT_SAYS_CLOSED");
  if (!/\b20\d\d-\d\d-\d\d\b/.test(block)) out.push("NO_DATE");
  if (!VERIFICATION_RE.test(block) && !OWNER_DECISION_RE.test(block)) {
    out.push("NO_VERIFICATION");
  }
  return out;
}

/** The violations for any entry the gate covers, picking the universe from the heading. */
export function entryViolations(entry) {
  return isClosed(entry.title) ? closedStatusViolations(entry) : statusViolations(entry);
}

export const VIOLATION_HELP = {
  MISSING: "no `**Status:**` line — every OPEN entry needs one",
  SAYS_CLOSED: "the Status line says CLOSED; closure lives in the `##` heading",
  NO_DATE: "no ISO YYYY-MM-DD date in the Status block",
  NO_VERIFICATION:
    "names no executed verification — cite a grep/npm/npx/node-scripts command in backticks (an open entry may instead say `never machine-verified`; a closed one may not, but a decision closure may say `owner decision <YYYY-MM-DD>`)",
  NOT_SAYS_CLOSED: "a closed entry's Status must open with `**Status:** CLOSED <date>`",
};
