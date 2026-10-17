// §715 demo recorder: the pure command-line layer of record.mjs — arguments, which videos a run takes,
// where each one lands, the exit code, and the secret scan over a take's output. No Playwright here, so
// cli.test.mjs runs it without a browser. See README.md.
import path from 'node:path';

const TIERS = ['big', 'chapters', 'ai', 'features'];
const ONE_OF = 'choose one of --video, --tier, --all, --list';

/** `--video <id> | --tier <tier> | --all | --list`, plus `--rehearse`, `--with-ai`, `--probe`. */
export function parseArgs(argv) {
  const has = (flag) => argv.includes(flag);
  const valueOf = (flag) => {
    const i = argv.indexOf(flag);
    return i < 0 ? undefined : argv[i + 1];
  };
  const args = {
    list: has('--list'),
    video: valueOf('--video'),
    tier: valueOf('--tier'),
    all: has('--all'),
    rehearse: has('--rehearse'),
    withAi: has('--with-ai'),
    probe: has('--probe'),
  };
  const chosen = [args.list, args.video !== undefined, args.tier !== undefined, args.all].filter(Boolean).length;
  if (chosen !== 1) throw new Error(ONE_OF);
  if (args.tier !== undefined && !TIERS.includes(args.tier)) throw new Error('unknown tier ' + args.tier);
  return args;
}

/** The videos a run takes, in definition order. A hand-recorded video is never taken by --all or --tier;
 *  `--list` lists every definition. */
export function selectVideos(defs, args) {
  if (args.list) return defs;
  if (args.video !== undefined) {
    const def = defs.find((d) => d.id === args.video);
    if (!def) throw new Error('unknown video ' + args.video);
    return [def];
  }
  const takeable = defs.filter((d) => !d.handRecorded);
  return args.all ? takeable : takeable.filter((d) => d.tier === args.tier);
}

/** `<out>/<tier>/<NN>-<id>.webm`, NN = 1-based position within the tier (hand-recorded ones count). */
export function outPath(out, def, defs) {
  const n = defs.filter((d) => d.tier === def.tier).indexOf(def) + 1;
  return path.join(out, def.tier, `${String(n).padStart(2, '0')}-${def.id}.webm`);
}

/** Any skip, failure or warning fails the run. */
export function exitCode({ warnings, skipped, failed }) {
  return warnings || skipped || failed ? 1 : 0;
}

/** Occurrences of any non-empty secret in `text`. */
export function findSecrets(text, secrets) {
  let n = 0;
  for (const s of secrets) {
    if (!s) continue;
    for (let i = text.indexOf(s); i >= 0; i = text.indexOf(s, i + s.length)) n++;
  }
  return n;
}
