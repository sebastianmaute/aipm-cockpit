// The signed build's update check: electron-updater's NsisUpdater hands every downloaded installer
// to `verifyUpdateCodeSignature(publisherNames, path)` when the packaged resources/app-update.yml has
// a `publisherName` (NsisUpdater.verifySignature), and refuses the update unless it returns `null`.
// Its default verifier resolves `null` -- valid -- when PowerShell fails or prints to stderr
// (windowsExecutableCodeSignatureVerifier.js, both `handleError` paths), so a broken check would
// install anything. This one fails CLOSED: every outcome other than a readable `Valid` verdict, for
// this very file, from a listed publisher, is a refusal string.
//
// The release workflow's `sign` job writes `publisherName: [SignPath Foundation]` into the packed
// app's app-update.yml (scripts/release-update-feed.mjs); an unsigned build's feed has none, so
// updater.ts leaves electron-updater's default in place there (`feedRequiresSignature`).
//
// No electron import: the root tsc and vitest reach this file directly.
import { execFile, type ExecFileOptions } from "node:child_process";
import { win32 } from "node:path";

/** How long PowerShell may take before the update is refused (electron-updater's own limit). */
export const SIGNATURE_TIMEOUT_MS = 20_000;
/** The environment variable that carries the installer path into PowerShell. */
export const INSTALLER_ENV = "AIPM_UPDATE_INSTALLER";

export interface PowerShellResult {
  /** null when the process ended without an exit code (killed, timed out). */
  exitCode: number | null;
  stdout: string;
  stderr: string;
}
/** Runs the signature query for one file. Rejects only when PowerShell cannot be started. */
export type RunPowerShell = (installerPath: string, timeoutMs: number) => Promise<PowerShellResult>;

// The path is read from the environment inside PowerShell, so no character of it is ever parsed as
// PowerShell syntax.
// ★★ Nothing here may assign a type's static member (`[Console]::OutputEncoding = …`). Under
// Constrained Language Mode (AppLocker / WDAC) that is "Property setting is supported only on core
// types", and with ErrorActionPreference Stop the script exits 1, so EVERY update would be refused,
// signed ones included (measured: exit 1 under ConstrainedLanguage, exit 0 without the assignment).
// The cost of leaving output in the console code page: non-ASCII characters in the reported Path
// come back mangled -- see `sameFile`.
export const SIGNATURE_COMMAND =
  "$ErrorActionPreference = 'Stop'; " +
  `Get-AuthenticodeSignature -LiteralPath $env:${INSTALLER_ENV} | ConvertTo-Json -Compress`;

// A plain map, not NodeJS.ProcessEnv: the root tsc's Next types make that one demand NODE_ENV.
type Env = Record<string, string | undefined>;

/** The process to start: Windows PowerShell by absolute path, the installer path in the
 *  environment, no shell. An inherited PSModulePath is dropped (electron-builder#7127: PowerShell
 *  7's module path makes 5.1 fail to load Get-AuthenticodeSignature's module). */
export function powerShellInvocation(
  installerPath: string,
  env: Env = process.env,
): { file: string; args: string[]; options: ExecFileOptions } {
  const systemRoot = env.SystemRoot ?? env.SYSTEMROOT;
  const file = systemRoot
    ? win32.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")
    : "powershell.exe";
  const childEnv: Env = {};
  for (const [k, v] of Object.entries(env)) if (k.toLowerCase() !== "psmodulepath") childEnv[k] = v;
  childEnv[INSTALLER_ENV] = installerPath;
  return {
    file,
    args: ["-NoProfile", "-NonInteractive", "-InputFormat", "None", "-Command", SIGNATURE_COMMAND],
    options: { env: childEnv as NodeJS.ProcessEnv, timeout: SIGNATURE_TIMEOUT_MS, windowsHide: true, shell: false, encoding: "utf8" },
  };
}

export const defaultRun: RunPowerShell = (installerPath, timeoutMs) =>
  new Promise<PowerShellResult>((resolve, reject) => {
    const { file, args, options } = powerShellInvocation(installerPath);
    execFile(file, args, { ...options, timeout: timeoutMs }, (error, stdout, stderr) => {
      const out = String(stdout);
      const err = String(stderr);
      if (error === null) {
        resolve({ exitCode: 0, stdout: out, stderr: err });
        return;
      }
      // A numeric code is the process's exit code; a string one (ENOENT, EACCES) means it never ran.
      const code = (error as { code?: unknown }).code;
      if (typeof code === "number") resolve({ exitCode: code, stdout: out, stderr: err });
      else if (typeof code === "string") reject(error);
      else resolve({ exitCode: null, stdout: out, stderr: `${err}${error.message}` });
    });
  });

// System.Management.Automation.SignatureStatus, which ConvertTo-Json writes as a number.
const STATUS_NAMES = ["Valid", "UnknownError", "NotSigned", "HashMismatch", "NotTrusted", "NotSupportedFileFormat", "Incompatible"];

function statusName(status: unknown): string {
  if (typeof status === "number") return STATUS_NAMES[status] ?? `status ${status}`;
  if (typeof status === "string") return status;
  return "no status";
}

/** A distinguished name's attributes, upper-cased keys, values unquoted. */
function parseDn(dn: string): Map<string, string> {
  const out = new Map<string, string>();
  let part = "";
  let quoted = false;
  const flush = () => {
    const eq = part.indexOf("=");
    if (eq > 0) {
      let v = part.slice(eq + 1).trim();
      if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1).replace(/""/g, '"');
      const k = part.slice(0, eq).trim().toUpperCase();
      if (!out.has(k)) out.set(k, v);
    }
    part = "";
  };
  for (const ch of dn) {
    if (ch === '"') quoted = !quoted;
    if ((ch === "," || ch === ";") && !quoted) flush();
    else part += ch;
  }
  flush();
  return out;
}

/** electron-updater's rule: a name with `=` is a DN and must match the subject on every key it
 *  names; a plain name must equal the subject's CN exactly. The release workflow's signature
 *  checks (scripts/release-verify-signature.mjs) and its one-way guard
 *  (scripts/release-signing-guard.mjs) use this very function, so CI calls an installer signed
 *  only by the rule the installed app applies to it. */
export function signerMatches(subject: string, publisherNames: string[]): boolean {
  const s = parseDn(subject);
  return publisherNames.some((name) => {
    if (!name) return false;
    if (name.includes("=")) {
      const want = parseDn(name);
      return want.size > 0 && [...want].every(([k, v]) => s.get(k) === v);
    }
    return s.get("CN") === name;
  });
}

const isAscii = (s: string) => [...s].every((c) => c.charCodeAt(0) < 0x80);

/** Whether the verdict is about the downloaded file. Windows paths compare case-insensitively.
 *  PowerShell writes in the console code page (SIGNATURE_COMMAND cannot switch it to UTF-8), so a
 *  non-ASCII character in the path -- a profile folder named "Jürgen" -- reads back as U+FFFD and the
 *  full path can never match. For such a path only the file name is compared, and only when the
 *  file name itself is ASCII (electron-updater's `temp-<artifactName>`, always ASCII here). An
 *  all-ASCII path is compared in full. Measured on Windows PowerShell 5.1, 2026-11-06.
 *  ASCII-ness is judged on the path as given, never on its lowercased form: the Kelvin sign K
 *  (U+212A) lowercases to an ASCII "k", yet PowerShell still reads it back as U+FFFD. */
function sameFile(reported: string, expected: string): boolean {
  const original = win32.normalize(expected);
  const a = win32.normalize(reported).toLowerCase();
  if (isAscii(original)) return a === original.toLowerCase();
  const name = win32.basename(original);
  return isAscii(name) && win32.basename(a) === name.toLowerCase();
}

function judge(publisherNames: string[], installerPath: string, r: PowerShellResult): string | null {
  const stderr = r.stderr.trim() ? ` (${r.stderr.trim().split(/\r?\n/)[0]})` : "";
  if (r.exitCode !== 0) return `signature check failed: PowerShell exited with ${r.exitCode ?? "no exit code"}${stderr}`;
  let data: unknown;
  try {
    data = JSON.parse(r.stdout.trim());
  } catch {
    return `signature check failed: unreadable output from Get-AuthenticodeSignature${stderr}`;
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return "signature check failed: Get-AuthenticodeSignature returned no signature record";
  }
  const rec = data as { Status?: unknown; Path?: unknown; SignerCertificate?: { Subject?: unknown } | null };
  if (typeof rec.Path !== "string" || !sameFile(rec.Path, installerPath)) {
    return "signature check failed: the verdict is not about the downloaded installer";
  }
  const status = statusName(rec.Status);
  if (status !== "Valid") return `the installer's signature is ${status}`;
  const subject = rec.SignerCertificate?.Subject;
  if (typeof subject !== "string" || !signerMatches(subject, publisherNames)) {
    return `the installer is signed by "${typeof subject === "string" ? subject : "nobody"}", not by ${publisherNames.join(" | ") || "a listed publisher"}`;
  }
  return null;
}

/** electron-updater's `verifyUpdateCodeSignature` contract: `null` when the installer at
 *  `installerPath` is validly signed by one of `publisherNames`, otherwise why not. Never throws. */
export async function verifyUpdateSignature(
  publisherNames: string[],
  installerPath: string,
  run: RunPowerShell = defaultRun,
): Promise<string | null> {
  if (publisherNames.length === 0 || publisherNames.every((n) => !n)) {
    return "signature check failed: no publisher name to verify against";
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => { timer = setTimeout(() => resolve("timeout"), SIGNATURE_TIMEOUT_MS); });
  try {
    const result = await Promise.race([Promise.resolve().then(() => run(installerPath, SIGNATURE_TIMEOUT_MS)), timeout]);
    if (result === "timeout") return `signature check failed: timed out after ${SIGNATURE_TIMEOUT_MS / 1000} s`;
    return judge(publisherNames, installerPath, result);
  } catch (e: unknown) {
    return `signature check failed: ${e instanceof Error ? e.message : String(e)}`;
  } finally {
    clearTimeout(timer);
  }
}

/** Whether a packaged app-update.yml names a publisher, i.e. whether electron-updater will ask
 *  `verifyUpdateCodeSignature` about each download. Any top-level `publisherName` key counts,
 *  whatever its form, so a feed electron-updater treats as signed is never read as unsigned here. */
export function feedRequiresSignature(appUpdateYml: string): boolean {
  return /^publisherName[ \t]*:/m.test(appUpdateYml);
}
