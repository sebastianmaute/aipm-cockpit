#!/usr/bin/env node
// The one-way signing switch: once a release has shipped a signed installer, no later release may
// ship an unsigned one — an installed signed copy refuses an unsigned update, so its users would be
// stranded, and switching signing off again must not be possible by accident.
// Compares the installer in <dir> with the installer of the newest published release, prereleases
// included (drafts are not published), downloaded with `gh release download`. GitHub's
// releases/latest skips prereleases, so a signed release candidate newer than the latest stable
// release would otherwise let an unsigned release follow it.
// "Signed" means Authenticode status Valid AND a signer whose subject passes the installed app's own
// rule for the publisher SignPath Foundation (`signerMatches` in desktop/src/update-signature.ts:
// the subject's CN equals the name exactly);
// "unsigned" means status NotSigned with no signer. Anything else — a broken, untrusted or foreign
// signature, or output that cannot be read — is neither, and the guard cannot decide.
// Usage: node scripts/release-signing-guard.mjs <tag> <dir>   (needs gh and GH_TOKEN; Windows)
// Exit: 0 allowed; 1 refused (unsigned after a signed release); 2 cannot decide — the release
// workflow fails on it too, so a gh, network or PowerShell failure never lets a release through.
import { execFile } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { installerName } from "./release-publish-lib.mjs";
import { signerMatches } from "../desktop/src/update-signature.ts";

export const SIGNER = "SignPath Foundation";
const run = promisify(execFile);
const API_TIMEOUT_MS = 60_000;
const DOWNLOAD_TIMEOUT_MS = 10 * 60_000;

/** `sig`: { status, subject } as Get-AuthenticodeSignature reports them. Returns "signed",
 *  "unsigned", or null when it is neither (the caller must then refuse to decide). */
export function classifySignature(sig) {
  if (!sig || typeof sig !== "object" || typeof sig.status !== "string") return null;
  const subject = typeof sig.subject === "string" ? sig.subject : "";
  if (sig.status === "Valid" && signerMatches(subject, [SIGNER])) return "signed";
  if (sig.status === "NotSigned" && subject === "") return "unsigned";
  return null;
}

// The first page of releases, newest created first, reduced to what newestPublished reads. Drafts
// are listed only to a token with push access; they are dropped either way.
export const RELEASES_PATH = "repos/{owner}/{repo}/releases?per_page=100";
export const RELEASES_JQ = "[.[] | {tag: .tag_name, draft: .draft, published: .published_at}]";

/** The tag of the newest published (non-draft) release, prereleases included, from RELEASES_JQ's
 *  output; null when there is none. Throws on anything it cannot read, so the guard cannot decide
 *  rather than mistake a broken answer for "no release". */
export function newestPublished(stdout) {
  let list;
  try {
    list = JSON.parse(stdout);
  } catch {
    throw new Error("the release list is not JSON");
  }
  if (!Array.isArray(list)) throw new Error("the release list is not a list");
  let best = null;
  for (const r of list) {
    if (typeof r !== "object" || r === null || typeof r.draft !== "boolean") throw new Error(`unreadable release entry: ${JSON.stringify(r)}`);
    if (r.draft) continue;
    const at = Date.parse(r.published);
    if (typeof r.tag !== "string" || r.tag === "" || Number.isNaN(at)) throw new Error(`unreadable release entry: ${JSON.stringify(r)}`);
    if (best === null || at > best.at) best = { tag: r.tag, at };
  }
  return best === null ? null : best.tag;
}

export function decide({ prevSigned, nowSigned }) {
  if (prevSigned && !nowSigned) {
    return { code: 1, message: "REFUSED: the newest published release is signed and this installer is not — signing cannot be switched off once a signed release has shipped" };
  }
  return { code: 0, message: `allowed (previous ${prevSigned ? "signed" : "unsigned"}, this one ${nowSigned ? "signed" : "unsigned"})` };
}

/** Runs gh. `api` answers { stdout } or { notFound } on HTTP 404; `release download` answers
 *  { files } — the names now in its --dir. Anything else that fails throws. */
async function defaultGh(args) {
  try {
    const isDownload = args[0] === "release" && args[1] === "download";
    const { stdout } = await run("gh", args, {
      windowsHide: true, maxBuffer: 1024 * 1024, timeout: isDownload ? DOWNLOAD_TIMEOUT_MS : API_TIMEOUT_MS,
    });
    if (args[0] === "release" && args[1] === "download") return { files: readdirSync(args[args.indexOf("--dir") + 1]) };
    return { stdout };
  } catch (err) {
    if (args[0] === "api" && /HTTP 404/.test(String(err?.stderr ?? ""))) return { notFound: true };
    throw new Error(`gh ${args.slice(0, 2).join(" ")} failed: ${String(err?.stderr ?? err?.message ?? err).trim()}`);
  }
}

/** Reads a file's Authenticode signature with PowerShell 7 (`pwsh`, as the workflow's own checks
 *  use). Not Windows PowerShell: started from a pwsh-launched process it inherits pwsh's
 *  PSModulePath and cannot load Get-AuthenticodeSignature's module (measured). The path reaches
 *  PowerShell through an environment variable, never through the command text. */
async function defaultSignature(path) {
  const script = "$s = Get-AuthenticodeSignature -LiteralPath $env:GUARD_FILE; "
    + "$subject = ''; if ($s.SignerCertificate) { $subject = $s.SignerCertificate.Subject }; "
    + "[pscustomobject]@{ status = $s.Status.ToString(); subject = $subject } | ConvertTo-Json -Compress";
  const { stdout } = await run("pwsh", ["-NoProfile", "-NonInteractive", "-Command", script], {
    windowsHide: true, timeout: 60_000, env: { ...process.env, GUARD_FILE: path },
  });
  const sig = JSON.parse(stdout);
  if (typeof sig?.status !== "string") throw new Error(`unreadable signature output for ${path}`);
  return sig;
}

/** "signed" or "unsigned" for the file at `path`; throws when it is neither. */
async function signedState(signature, path) {
  const sig = await signature(path);
  const state = classifySignature(sig);
  if (state === null) {
    throw new Error(`${path}: signature is neither SignPath Foundation-signed nor unsigned (status ${sig?.status ?? "unreadable"}, signer "${sig?.subject ?? ""}")`);
  }
  return state;
}

/** Returns { code, message }; never throws. A download directory it creates is removed. */
export async function runGuard({ tag, dir, gh = defaultGh, signature = defaultSignature, tmp }) {
  let created = null;
  try {
    if (typeof tag !== "string" || !tag.startsWith("v")) throw new Error(`tag "${tag}" does not start with v`);
    const now = join(dir, installerName(tag.slice(1)));
    // An empty release list means "no release" only if the repository itself answers; without
    // this, a wrong repository or a token that cannot see it would read as a first release.
    const repo = await gh(["api", "repos/{owner}/{repo}", "--jq", ".full_name"]);
    if (repo.notFound || !String(repo.stdout ?? "").trim()) throw new Error("the repository cannot be read");
    const list = await gh(["api", RELEASES_PATH, "--jq", RELEASES_JQ]);
    if (list.notFound) throw new Error("the release list cannot be read");
    const prevTag = newestPublished(String(list.stdout ?? ""));
    if (prevTag === null) return { code: 0, message: "allowed (no release has been published yet)" };
    const into = tmp ?? (created = mkdtempSync(join(tmpdir(), "signing-guard-")));
    const { files } = await gh(["release", "download", prevTag, "--pattern", "*-setup.exe", "--dir", into]);
    const prev = (files ?? []).filter((f) => f.endsWith("-setup.exe"));
    if (prev.length !== 1) throw new Error(`${prevTag} has ${prev.length} installers, expected 1`);
    const prevSigned = (await signedState(signature, join(into, prev[0]))) === "signed";
    const nowSigned = (await signedState(signature, now)) === "signed";
    const d = decide({ prevSigned, nowSigned });
    return { code: d.code, message: `${d.message} — compared with ${prevTag}` };
  } catch (err) {
    return { code: 2, message: `CANNOT DECIDE: ${err instanceof Error ? err.message : String(err)}` };
  } finally {
    if (created) rmSync(created, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [tag, dir] = process.argv.slice(2);
  const r = await runGuard({ tag, dir });
  (r.code === 0 ? console.log : console.error)(`[release-signing-guard] ${r.message}`);
  process.exit(r.code);
}
