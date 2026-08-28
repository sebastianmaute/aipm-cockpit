// NOTE: no shebang is executed -- this file is always run as `node scripts/probes/...`.
// A `#!` on an IMPORTED .mjs makes vitest throw a SyntaxError naming the wrong
// file, so probes that are ever imported must not carry one. This one is not
// imported; the line above is a comment, not a shebang.
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { parseEntries, isClosed } from "../followup-claims-lib.mjs";

const src = readFileSync("docs/open-followups.md", "utf8");
const entries = parseEntries(src).filter((e) => !isClosed(e.title));
if (entries.length === 0) {
  console.error("VACUITY: parsed zero open entries -- the register moved or the parser broke.");
  process.exit(2);
}

const undated = entries.filter((e) => !/20\d\d-\d\d-\d\d/.test(e.body.join("\n")));

let recovered = 0;
let unrecoverable = 0;
const byMethod = { title: 0, heading: 0, body: 0 };

for (const e of undated) {
  // Identify the commit that introduced this ENTRY. Pickaxe on the entry TITLE
  // first; on the `## N. ` heading only as a fallback.
  //
  // MEASURED, not reasoned -- and BOTH halves produced a confidently wrong answer
  // before they were measured:
  //
  // 1. `--diff-filter=A` must NOT be added. It filters to commits that add the
  //    FILE, not ones that add the STRING, and this register has exactly one such
  //    commit (480dc383, the 2026-07-27 consolidation). With the flag, 58 of 62
  //    undated entries reported UNRECOVERABLE and the surviving 4 all dated to
  //    480dc383 -- a uniformly wrong answer that reads as a real result.
  //      git log --format=%ad --date=short -S "## 30. " -- docs/open-followups.md
  //      git log --diff-filter=A --format=%ad --date=short -S "## 30. " -- docs/open-followups.md
  //    The first names 2026-07-29; the second is empty.
  //
  // 2. The HEADING is not a stable identifier, because entries get RENUMBERED.
  //    `-S` reports a commit only when the NET occurrence count of the needle
  //    changes, and a renumbering commit that moves one entry off a number and
  //    another onto it leaves that count untouched -- so the needle is invisible
  //    in the very commit that introduced the entry. Measured on 56, which is in
  //    HEAD and whose heading appears in NO diff, by -S or by -G:
  //      git log -S "## 56. " -- docs/open-followups.md                            # empty
  //      git log -S "near-invisible in all three DARK" -- docs/open-followups.md   # bcc567ab 2026-08-03
  //    The title survives renumbering; the number does not.
  //
  // Which needle won is PRINTED per entry, so a reader can tell a title hit from a
  // fallback without re-deriving it.
  const title = e.title.trim();
  const attempts = [
    ["title", title.slice(0, 40)],
    ["heading", `## ${e.n}. `],
    ["body", (e.body.find((l) => l.trim().length > 40) || "").trim().slice(0, 40)],
  ];

  let dates = [];
  let method = "none";
  for (const [name, needle] of attempts) {
    // A short needle matches unrelated prose. Below this it is not evidence.
    if (needle.length < 12) continue;
    const r = spawnSync(
      "git",
      ["log", "--format=%ad", "--date=short", "-S", needle, "--", "docs/open-followups.md"],
      { encoding: "utf8", shell: false },
    );
    dates = r.status === 0 ? r.stdout.trim().split("\n").filter(Boolean) : [];
    if (dates.length > 0) {
      method = name;
      break;
    }
  }

  if (dates.length === 0) {
    console.log(`§${String(e.n).padStart(3)}  UNRECOVERABLE           ${e.title.slice(0, 55)}`);
    unrecoverable++;
  } else {
    // Oldest is the introduction; git log lists newest first.
    console.log(
      `§${String(e.n).padStart(3)}  ${dates[dates.length - 1]}  ${method.padEnd(7)}  ${e.title.slice(0, 55)}`,
    );
    byMethod[method]++;
    recovered++;
  }
}

console.log(`\nundated open entries: ${undated.length}`);
console.log(
  `recovered: ${recovered} (title ${byMethod.title}, heading ${byMethod.heading}, body ${byMethod.body})   UNRECOVERABLE: ${unrecoverable}`,
);
console.log(
  "\nAn UNRECOVERABLE entry gets the literal phrase `never machine-verified` in its\n" +
    "Status line. It does NOT get a guessed date.",
);
process.exit(0);
