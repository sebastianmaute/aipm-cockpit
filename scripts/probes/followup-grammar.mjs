// The executable statement of which command shapes `--run-repro` will spawn.
// No shebang: a `#!` on a .mjs that is ever imported makes vitest throw a
// SyntaxError naming the wrong file.
import { reproEntriesIn } from "../followup-claims-lib.mjs";

// Each row: [command, expected-runnable]. Keep the FALSE rows — a probe that
// only shows what works cannot show what a caller must avoid.
const CASES = [
  ["grep -n foo src/app/x.ts", true],
  ["npm run docs:claims:check", true],
  ["npx tsc --noEmit", true],
  ["node scripts/probes/followup-grammar.mjs", true],
  ['node -e "console.log(1)"', false],
  ["node -e 'console.log(1)'", false],
  ["npm run test:run --silent", false],
  ["grep -n foo src | head -3", false],
];

let bad = 0;
for (const [cmd, want] of CASES) {
  const got = reproEntriesIn("```bash\n" + cmd + "\n```").length > 0;
  if (got !== want) bad++;
  console.log(`${got ? "RUNNABLE" : "rejected"}  ${got === want ? "  " : "!!"}  ${cmd}`);
}
console.log(`\n${CASES.length} cases, ${bad} disagreeing with the documented grammar.`);
console.log("A `node -e` command is NEVER runnable — put computation in a probe like this one.");
process.exit(bad === 0 ? 0 : 1);
