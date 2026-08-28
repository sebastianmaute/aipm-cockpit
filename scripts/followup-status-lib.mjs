/** The `**Status:**` contract for OPEN entries in docs/open-followups.md.
 *
 *  ★★★ WHY THIS IS A GATE AND NOT A REPORT. 118 of 175 open entries had no
 *  Status line on 2026-08-28, and nothing had ever checked. An unenforced
 *  convention in this repo decays; the register itself records that as a class.
 *
 *  ★★ Parsing is NOT re-implemented here. `parseEntries`/`isClosed` come from
 *  `followup-claims-lib.mjs`, because a second, differently-spelled heading
 *  parser is a second thing to drift out of agreement with the first. */

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

export const VIOLATION_HELP = {
  MISSING: "no `**Status:**` line — every OPEN entry needs one",
  SAYS_CLOSED: "the Status line says CLOSED; closure lives in the `##` heading",
  NO_DATE: "no ISO YYYY-MM-DD date in the Status block",
  NO_VERIFICATION:
    "names no executed verification — cite a grep/npm/npx/node-scripts command in backticks, or say `never machine-verified`",
};
