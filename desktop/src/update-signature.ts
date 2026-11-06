// The signed build's update check: electron-updater's NsisUpdater hands every downloaded installer
// to `verifyUpdateCodeSignature(publisherNames, path)` when the packaged resources/app-update.yml has
// a `publisherName` (NsisUpdater.verifySignature), and refuses the update unless it returns `null`.
// Its default verifier resolves `null` -- valid -- when PowerShell fails or prints to stderr
// (windowsExecutableCodeSignatureVerifier.js, both `handleError` paths), so a broken check would
// install anything. This one fails CLOSED: every outcome other than a readable `Valid` verdict, for
// this very file, from a listed publisher, is a refusal string.
//
// The release workflow's `repackage` job writes `publisherName:` with SignPath Foundation's full
// certificate subject into the packed app's app-update.yml (scripts/release-update-feed.mjs); an
// unsigned build's feed has none, so
// updater.ts leaves electron-updater's default in place there (`feedRequiresSignature`).
//
// No electron import: the root tsc and vitest reach this file directly.
import { execFile, type ExecFileOptions } from "node:child_process";
import { win32 } from "node:path";

/** How long PowerShell may take before the update is refused. electron-updater's own verifier
 *  allows 20 s; a cold Windows PowerShell start while antivirus scans the freshly downloaded
 *  installer can take longer, and a timeout refuses a genuine update, so this allows 60 s. */
export const SIGNATURE_TIMEOUT_MS = 60_000;
/** The environment variable that carries the installer path into PowerShell. */
export const INSTALLER_ENV = "AIPM_UPDATE_INSTALLER";

/** Starts every refusal that means the check itself could not run on this computer: PowerShell
 *  could not be started, exited non-zero, gave no answer in time, or printed nothing readable. The
 *  other refusals are verdicts (a status other than Valid, a signer not on the list, a verdict about
 *  another file, no publisher to check against). Both kinds refuse the update -- the kind only picks
 *  the words the user is shown (updater.ts), so fail-closed does not depend on it. */
export const CANNOT_RUN_PREFIX = "signature check could not run: ";
export type RefusalKind = "cannot-run" | "mismatch";
/** The kind of a refusal, from its text or from any message that carries it (electron-updater
 *  wraps it as "New version … is not signed by the application owner: <refusal>"). A certificate
 *  subject quoted in a mismatch could carry the prefix too; that changes only the wording shown,
 *  never whether the update is refused. */
export function refusalKind(message: string): RefusalKind {
  return message.includes(CANNOT_RUN_PREFIX) ? "cannot-run" : "mismatch";
}

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

/** A distinguished name's attributes, parsed exactly as electron-updater parses both the signer's
 *  subject and each publisher name: builder-util-runtime's `parseDn` (out/rfc2253Parser.js), ported
 *  line for line. Keys keep their case; `"` toggles quoting and is dropped; a backslash escapes the
 *  next character or a two-digit hex code; `,`, `;` and `+` end an attribute; spaces at either end
 *  of a value are dropped; a repeated key keeps its LAST value. */
function parseDn(dn: string): Map<string, string> {
  let quoted = false;
  let key: string | null = null;
  let token = "";
  let nextNonSpace = 0;
  const seq = dn.trim();
  const result = new Map<string, string>();
  for (let i = 0; i <= seq.length; i++) {
    if (i === seq.length) {
      if (key !== null) result.set(key, token);
      break;
    }
    const ch = seq[i];
    if (quoted) {
      if (ch === '"') {
        quoted = false;
        continue;
      }
    } else {
      if (ch === '"') {
        quoted = true;
        continue;
      }
      if (ch === "\\") {
        i++;
        const ord = parseInt(seq.slice(i, i + 2), 16);
        if (Number.isNaN(ord)) {
          token += seq[i];
        } else {
          i++;
          token += String.fromCharCode(ord);
        }
        continue;
      }
      if (key === null && ch === "=") {
        key = token;
        token = "";
        continue;
      }
      if (ch === "," || ch === ";" || ch === "+") {
        if (key !== null) result.set(key, token);
        key = null;
        token = "";
        continue;
      }
    }
    if (ch === " " && !quoted) {
      if (token.length === 0) continue;
      if (i > nextNonSpace) {
        let j = i;
        while (seq[j] === " ") j++;
        nextNonSpace = j;
      }
      if (
        nextNonSpace >= seq.length ||
        seq[nextNonSpace] === "," ||
        seq[nextNonSpace] === ";" ||
        (key === null && seq[nextNonSpace] === "=") ||
        (key !== null && seq[nextNonSpace] === "+")
      ) {
        i = nextNonSpace - 1;
        continue;
      }
    }
    token += ch;
  }
  return result;
}

/** electron-updater's rule (windowsExecutableCodeSignatureVerifier.js): a name that parses to any
 *  attribute is a DN and must match the subject on every key it names; any other name must equal
 *  the subject's CN exactly. One deliberate difference: an empty name matches nothing here, where
 *  electron-updater would accept it against a subject with an empty CN. The release feed names the
 *  full DN (PUBLISHER in scripts/release-update-feed.mjs). The release workflow's signature checks
 *  (scripts/release-verify-signature.mjs) and its one-way guard (scripts/release-signing-guard.mjs)
 *  use this very function, so CI calls an installer signed only by the rule the installed app
 *  applies to it. */
export function signerMatches(subject: string, publisherNames: string[]): boolean {
  const s = parseDn(subject);
  return publisherNames.some((name) => {
    if (!name) return false;
    const want = parseDn(name);
    if (want.size > 0) return [...want].every(([k, v]) => s.get(k) === v);
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
  if (r.exitCode !== 0) return `${CANNOT_RUN_PREFIX}PowerShell exited with ${r.exitCode ?? "no exit code"}${stderr}`;
  let data: unknown;
  try {
    data = JSON.parse(r.stdout.trim());
  } catch {
    return `${CANNOT_RUN_PREFIX}unreadable output from Get-AuthenticodeSignature${stderr}`;
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return `${CANNOT_RUN_PREFIX}Get-AuthenticodeSignature returned no signature record`;
  }
  const rec = data as { Status?: unknown; Path?: unknown; SignerCertificate?: { Subject?: unknown } | null };
  if (typeof rec.Path !== "string") return `${CANNOT_RUN_PREFIX}Get-AuthenticodeSignature named no file`;
  if (!sameFile(rec.Path, installerPath)) {
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
    if (result === "timeout") return `${CANNOT_RUN_PREFIX}timed out after ${SIGNATURE_TIMEOUT_MS / 1000} s`;
    return judge(publisherNames, installerPath, result);
  } catch (e: unknown) {
    return `${CANNOT_RUN_PREFIX}${e instanceof Error ? e.message : String(e)}`;
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
