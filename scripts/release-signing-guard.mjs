#!/usr/bin/env node
// The one-way signing switch: once a release has shipped a signed installer, no later release may
// ship an unsigned one — an installed signed copy refuses an unsigned update, so its users would be
// stranded, and switching signing off again must not be possible by accident.
// Compares the installer in <dir> with the installer of the latest published release (GitHub's
// "latest": not a draft, not a prerelease), downloaded with `gh release download`.
// "Signed" means Authenticode status Valid AND a signer subject naming SignPath Foundation;
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

export const SIGNER = "SignPath Foundation";
const run = promisify(execFile);
const API_TIMEOUT_MS = 60_000;
const DOWNLOAD_TIMEOUT_MS = 10 * 60_000;

/** `sig`: { status, subject } as Get-AuthenticodeSignature reports them. Returns "signed",
 *  "unsigned", or null when it is neither (the caller must then refuse to decide). */
export function classifySignature(sig) {
  if (!sig || typeof sig !== "object" || typeof sig.status !== "string") return null;
  const subject = typeof sig.subject === "string" ? sig.subject : "";
  if (sig.status === "Valid" && subject.includes(SIGNER)) return "signed";
  if (sig.status === "NotSigned" && subject === "") return "unsigned";
  return null;
}

export function decide({ prevSigned, nowSigned }) {
  if (prevSigned && !nowSigned) {
    return { code: 1, message: "REFUSED: the latest published release is signed and this installer is not — signing cannot be switched off once a signed release has shipped" };
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
    // A 404 on releases/latest means "no release" only if the repository itself answers; without
    // this, a wrong repository or a token that cannot see it would read as a first release.
    const repo = await gh(["api", "repos/{owner}/{repo}", "--jq", ".full_name"]);
    if (repo.notFound || !String(repo.stdout ?? "").trim()) throw new Error("the repository cannot be read");
    const latest = await gh(["api", "repos/{owner}/{repo}/releases/latest", "--jq", ".tag_name"]);
    if (latest.notFound) return { code: 0, message: "allowed (no release has been published yet)" };
    const prevTag = String(latest.stdout ?? "").trim();
    if (!prevTag) throw new Error("the latest release has no tag name");
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
