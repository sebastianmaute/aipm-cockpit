// The release's signature check, made by the installed app's own code: runs
// `verifyUpdateSignature` from desktop/src/update-signature.ts -- the function a signed build hands
// every downloaded update to -- on a file the release is about to ship. If it refuses the file here,
// it would refuse that file as an update too, and the release must not go out.
//
// --feed <app-update.yml>  the publisher names come from that feed, read the way electron-updater
//                          reads it (js-yaml `load`; a single name counts as a one-item list), so
//                          the check uses exactly the list the installed app will use.
// --publisher <name>       one name given directly, for a file checked before the feed exists.
//
// Usage: node scripts/release-verify-signature.mjs (--feed <app-update.yml> | --publisher <name>) <file>
// Exit: 0 verified; 1 refused (the reason is printed); 2 could not run (arguments, or a feed that is
// missing, unreadable or names no publisher). Windows only, like the verifier. js-yaml is loaded
// from desktop/node_modules (electron-updater's own dependency), so `npm --prefix desktop ci` first.
// Node strips the .ts file's types itself (Node 22.18+, 24); the release workflow sets up Node 24.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { verifyUpdateSignature } from "../desktop/src/update-signature.ts";

const USAGE = "usage: release-verify-signature.mjs (--feed <app-update.yml> | --publisher <name>) <file>";

const defaultLoadYaml = (text) => createRequire(new URL("../desktop/package.json", import.meta.url))("js-yaml").load(text);

/** The publisher names a feed hands the verifier, as electron-updater's NsisUpdater.verifySignature
 *  derives them. Throws when the feed names none, or a name that is not a non-empty string. */
export function publisherNamesFromFeed(text, loadYaml = defaultLoadYaml) {
  const doc = loadYaml(text);
  const value = doc && typeof doc === "object" ? doc.publisherName : undefined;
  if (value === undefined || value === null) throw new Error("the feed names no publisherName");
  const names = Array.isArray(value) ? value : [value];
  if (names.length === 0 || names.some((n) => typeof n !== "string" || n === "")) {
    throw new Error(`the feed's publisherName is not a list of names: ${JSON.stringify(value)}`);
  }
  return names;
}

/** Parses the arguments; throws with the usage line when they do not fit. */
export function parseArgs(argv) {
  const [flag, value, file, ...rest] = argv;
  if ((flag !== "--feed" && flag !== "--publisher") || !value || !file || rest.length > 0) throw new Error(USAGE);
  return flag === "--feed" ? { feed: value, file } : { publisher: value, file };
}

/** Returns { code, message }; never throws. */
export async function runVerify({ argv, verify = verifyUpdateSignature, readFile = (p) => readFileSync(p, "utf8"), loadYaml = defaultLoadYaml }) {
  let args;
  let names;
  try {
    args = parseArgs(argv);
    names = args.feed !== undefined ? publisherNamesFromFeed(readFile(args.feed), loadYaml) : [args.publisher];
  } catch (err) {
    return { code: 2, message: `CANNOT CHECK: ${err instanceof Error ? err.message : String(err)}` };
  }
  // The verifier compares the path Get-AuthenticodeSignature reports with this one, so it is absolute.
  const file = resolve(args.file);
  const refusal = await verify(names, file);
  if (refusal !== null) return { code: 1, message: `REFUSED: ${file}: ${refusal}` };
  return { code: 0, message: `verified: ${file} is validly signed by ${names.join(" | ")}` };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const r = await runVerify({ argv: process.argv.slice(2) });
  (r.code === 0 ? console.log : console.error)(`[release-verify-signature] ${r.message}`);
  process.exit(r.code);
}
