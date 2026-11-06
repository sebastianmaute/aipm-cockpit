// @vitest-environment node
// The signed build's update check: an update installs only when its installer is validly signed by
// one of the publisher names the packaged app-update.yml lists. Every failure to establish that --
// PowerShell missing, failing, hanging or answering nonsense -- refuses the update (fail closed),
// unlike electron-updater's own verifier, which resolves `null` (valid) on a PowerShell error.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  INSTALLER_ENV, SIGNATURE_COMMAND, SIGNATURE_TIMEOUT_MS, defaultRun, feedRequiresSignature, powerShellInvocation,
  verifyUpdateSignature, type PowerShellResult, type RunPowerShell,
} from "./update-signature";

const SIGNER = "SignPath Foundation";
const SUBJECT = "CN=SignPath Foundation, O=SignPath Foundation, L=Lewes, S=Delaware, C=US";
const INSTALLER = String.raw`C:\Users\me\AppData\Local\aipm-cockpit-desktop-updater\pending\temp-aipm-cockpit-9.9.9-setup.exe`;

// Get-AuthenticodeSignature | ConvertTo-Json -Compress, as Windows PowerShell 5.1 prints it: the
// SignatureStatus enum as its number (0 = Valid, 2 = NotSigned, 3 = HashMismatch).
function json(status: number | string, subject: string | null, path = INSTALLER): string {
  return JSON.stringify({
    SignerCertificate: subject === null ? null : { Subject: subject, Thumbprint: "AB12" },
    Status: status, StatusMessage: "x", Path: path, SignatureType: 1, IsOSBinary: false,
  });
}
const answer = (stdout: string, exitCode: number | null = 0, stderr = ""): RunPowerShell =>
  vi.fn<RunPowerShell>(() => Promise.resolve<PowerShellResult>({ exitCode, stdout, stderr }));

afterEach(() => { vi.useRealTimers(); });

describe("verifyUpdateSignature", () => {
  it("accepts an installer validly signed by the listed publisher (null, electron-updater's 'valid')", async () => {
    const run = answer(json(0, SUBJECT));
    expect(await verifyUpdateSignature([SIGNER], INSTALLER, run)).toBeNull();
    // Accepts the enum's name too (PowerShell 7 with -EnumsAsStrings, or a projection).
    expect(await verifyUpdateSignature([SIGNER], INSTALLER, answer(json("Valid", SUBJECT)))).toBeNull();
    // A full distinguished name matches on every key it names.
    expect(await verifyUpdateSignature(["CN=SignPath Foundation, O=SignPath Foundation"], INSTALLER, run)).toBeNull();
  });

  it("refuses an unsigned installer", async () => {
    const r = await verifyUpdateSignature([SIGNER], INSTALLER, answer(json(2, null)));
    expect(r).toEqual(expect.any(String));
    expect(r).toContain("NotSigned");
  });

  it("refuses a signature that is not Valid even when the signer matches", async () => {
    for (const status of [1, 3, 4, "HashMismatch", "NotTrusted", null]) {
      const r = await verifyUpdateSignature([SIGNER], INSTALLER, answer(json(status as number, SUBJECT)));
      expect(r, String(status)).toEqual(expect.any(String));
    }
  });

  it("refuses a valid signature from another publisher", async () => {
    for (const subject of [
      "CN=Someone Else, O=Someone Else, C=US",
      "CN=SignPath Foundation Ltd, O=SignPath Foundation, C=US",
      "CN=Evil, O=SignPath Foundation, C=US",
      "CN=signpath foundation, C=US",
      "",
    ]) {
      const r = await verifyUpdateSignature([SIGNER], INSTALLER, answer(json(0, subject)));
      expect(r, subject).toEqual(expect.any(String));
    }
    // A DN publisher name must match on every key it names.
    expect(await verifyUpdateSignature(["CN=SignPath Foundation, O=Other"], INSTALLER, answer(json(0, SUBJECT))))
      .toEqual(expect.any(String));
  });

  it("refuses when there is no publisher name to match", async () => {
    expect(await verifyUpdateSignature([], INSTALLER, answer(json(0, SUBJECT)))).toEqual(expect.any(String));
    expect(await verifyUpdateSignature([""], INSTALLER, answer(json(0, "CN=")))).toEqual(expect.any(String));
  });

  it("refuses when PowerShell cannot be started", async () => {
    const run = vi.fn<RunPowerShell>(() => Promise.reject(new Error("spawn powershell.exe ENOENT")));
    const r = await verifyUpdateSignature([SIGNER], INSTALLER, run);
    expect(r).toContain("ENOENT");
    const throwing = vi.fn<RunPowerShell>(() => { throw new Error("sync boom"); });
    expect(await verifyUpdateSignature([SIGNER], INSTALLER, throwing)).toEqual(expect.any(String));
  });

  it("refuses on a non-zero or missing exit code, whatever the output says", async () => {
    expect(await verifyUpdateSignature([SIGNER], INSTALLER, answer(json(0, SUBJECT), 1))).toEqual(expect.any(String));
    expect(await verifyUpdateSignature([SIGNER], INSTALLER, answer(json(0, SUBJECT), null))).toEqual(expect.any(String));
  });

  it("refuses when PowerShell does not answer within the timeout", async () => {
    vi.useFakeTimers();
    const run = vi.fn<RunPowerShell>(() => new Promise<PowerShellResult>(() => {}));
    const pending = verifyUpdateSignature([SIGNER], INSTALLER, run);
    await vi.advanceTimersByTimeAsync(SIGNATURE_TIMEOUT_MS);
    const r = await pending;
    expect(r).toMatch(/timed out/i);
    expect(SIGNATURE_TIMEOUT_MS).toBeLessThanOrEqual(20_000);
    // The process itself is told the same limit, so it is killed rather than left running.
    expect(run).toHaveBeenCalledWith(INSTALLER, SIGNATURE_TIMEOUT_MS);
  });

  it("refuses output it cannot read", async () => {
    for (const out of ["", "garbage", "null", "[]", "42", '"Valid"', "{}", '{"Status":0}', json(0, SUBJECT).slice(0, 40)]) {
      expect(await verifyUpdateSignature([SIGNER], INSTALLER, answer(out)), out).toEqual(expect.any(String));
    }
  });

  it("refuses a verdict about a different file than the one downloaded", async () => {
    const r = await verifyUpdateSignature([SIGNER], INSTALLER, answer(json(0, SUBJECT, String.raw`C:\other\setup.exe`)));
    expect(r).toEqual(expect.any(String));
    // Same file, different case and separators: Windows paths are case-insensitive.
    expect(await verifyUpdateSignature([SIGNER], INSTALLER, answer(json(0, SUBJECT, INSTALLER.toUpperCase().replace(/\\/g, "/")))))
      .toBeNull();
    // An all-ASCII path is compared in full: the same file name in another folder is refused.
    expect(await verifyUpdateSignature([SIGNER], INSTALLER, answer(json(0, SUBJECT, String.raw`C:\elsewhere\temp-aipm-cockpit-9.9.9-setup.exe`))))
      .toEqual(expect.any(String));
  });

  // PowerShell answers in the console code page, so a profile folder named "Jürgen" comes back as
  // "J\uFFFDrgen" (measured on Windows PowerShell 5.1). Only the ASCII file name is then compared.
  it("matches a non-ASCII path by its file name, and still refuses another file name", async () => {
    const path = String.raw`C:\Users\Jürgen Ä\AppData\Local\aipm-cockpit-desktop-updater\pending\temp-aipm-cockpit-9.9.9-setup.exe`;
    const mangled = path.replace(/[^\u0020-\u007e]/g, "\uFFFD");
    expect(await verifyUpdateSignature([SIGNER], path, answer(json(0, SUBJECT, mangled)))).toBeNull();
    expect(await verifyUpdateSignature([SIGNER], path, answer(json(0, SUBJECT, mangled.replace("9.9.9", "6.6.6")))))
      .toEqual(expect.any(String));
    // A non-ASCII file name cannot be compared at all, so it is refused.
    const named = String.raw`C:\Temp\ü-setup.exe`;
    expect(await verifyUpdateSignature([SIGNER], named, answer(json(0, SUBJECT, named)))).toEqual(expect.any(String));
  });

  // The Kelvin sign K (U+212A) lowercases to ASCII "k", so a check on the lowercased path would
  // call it ASCII and compare in full against PowerShell's U+FFFD, refusing every update.
  it("treats a path with the Kelvin sign as non-ASCII and compares the file name only", async () => {
    const path = "C:\\Users\\\u212Aai\\AppData\\Local\\aipm-cockpit-desktop-updater\\pending\\temp-aipm-cockpit-9.9.9-setup.exe";
    expect("\u212A".toLowerCase()).toBe("k");
    const mangled = path.replace("\u212A", "\uFFFD");
    expect(await verifyUpdateSignature([SIGNER], path, answer(json(0, SUBJECT, mangled)))).toBeNull();
    expect(await verifyUpdateSignature([SIGNER], path, answer(json(0, SUBJECT, mangled.replace("9.9.9", "6.6.6")))))
      .toEqual(expect.any(String));
  });

  it("hands the path to the runner verbatim, quotes and spaces included", async () => {
    const odd = String.raw`C:\Temp\it's "a" $(calc); 'x' & y.exe`;
    const run = answer(json(0, SUBJECT, odd));
    expect(await verifyUpdateSignature([SIGNER], odd, run)).toBeNull();
    expect(run).toHaveBeenCalledWith(odd, SIGNATURE_TIMEOUT_MS);
  });
});

describe("powerShellInvocation", () => {
  const odd = String.raw`C:\Temp\it's "a" $(calc); 'x' & y.exe`;

  it("passes the path in the environment, never in the command line, and runs no shell", () => {
    const inv = powerShellInvocation(odd, { SystemRoot: String.raw`C:\Windows`, PATH: "p" });
    expect(inv.file).toBe(String.raw`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`);
    for (const a of inv.args) expect(a).not.toContain("calc");
    expect(inv.args).toEqual(expect.arrayContaining(["-NoProfile", "-NonInteractive", "-Command"]));
    const command = inv.args[inv.args.indexOf("-Command") + 1];
    expect(command).toContain(`Get-AuthenticodeSignature -LiteralPath $env:${INSTALLER_ENV} | ConvertTo-Json -Compress`);
    expect(inv.options.env?.[INSTALLER_ENV]).toBe(odd);
    expect(inv.options.shell).toBeFalsy();
    expect(inv.options.timeout).toBe(SIGNATURE_TIMEOUT_MS);
    expect(inv.options.windowsHide).toBe(true);
    expect(command).toBe(SIGNATURE_COMMAND);
  });

  // Constrained Language Mode (AppLocker / WDAC) refuses property setting on non-core types, so a
  // `[Console]::OutputEncoding = …` line made PowerShell exit 1 and every update, signed or not, was
  // refused (measured). The command touches no type's static member at all.
  // Any error must end the script with a non-zero exit code, which the check refuses; PowerShell's
  // default ('Continue') would carry on past a non-terminating one.
  it("stops on the first error", () => {
    expect(SIGNATURE_COMMAND).toContain("$ErrorActionPreference = 'Stop'");
  });

  it("uses no type-static member, which Constrained Language Mode would block", () => {
    expect(SIGNATURE_COMMAND).not.toMatch(/\]::/);
    expect(SIGNATURE_COMMAND).not.toMatch(/\[[A-Za-z][\w.]*\]/);
  });

  it("drops an inherited PSModulePath, in any letter case, so PowerShell 7's modules do not shadow 5.1's", () => {
    const inv = powerShellInvocation(odd, { SystemRoot: "C:\\Windows", PSModulePath: "a", psmodulepath: "b", KEEP: "1" });
    const keys = Object.keys(inv.options.env ?? {});
    expect(keys.filter((k) => k.toLowerCase() === "psmodulepath")).toEqual([]);
    expect(inv.options.env?.KEEP).toBe("1");
  });

  it("falls back to powershell.exe on PATH only when SystemRoot is unset", () => {
    expect(powerShellInvocation(odd, {}).file).toBe("powershell.exe");
  });
});

// The real PowerShell, on Windows only: an unsigned file whose name would run commands if it were
// spliced into the command string is checked, refused as NotSigned, and runs nothing.
describe.skipIf(process.platform !== "win32")("defaultRun on Windows", () => {
  const dirs: string[] = [];
  afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });

  it("checks a file whose name carries quotes and a subexpression, and runs none of it", async () => {
    const dir = mkdtempSync(join(tmpdir(), "upd-sig-"));
    dirs.push(dir);
    const marker = `aipm-inject-${process.pid}-${Date.now()}`;
    const file = join(dir, `a'; Set-Content -LiteralPath ${marker}-1 -Value 1; 'b $(Set-Content ${marker}-2 1) x.ps1`);
    // A script, not an exe: Get-AuthenticodeSignature calls a non-PE .exe UnknownError, an unsigned
    // script NotSigned -- which it can only say after reading the very file named.
    writeFileSync(file, "# unsigned\r\n");
    const r = await verifyUpdateSignature([SIGNER], file, defaultRun);
    // Injection first, so a run that executed the name says so (spliced into a quoted -LiteralPath,
    // as electron-updater does before escaping, the first Set-Content runs: measured).
    const ran = [process.cwd(), dir].flatMap((where) => [1, 2].map((n) => join(where, `${marker}-${n}`))).filter((f) => existsSync(f));
    for (const f of ran) rmSync(f, { force: true });
    expect(ran, "commands from the file name ran").toEqual([]);
    expect(r).toContain("NotSigned");
  }, 30_000);

  // The session is switched to ConstrainedLanguage first: the restrictions AppLocker / WDAC impose,
  // though not an enforced policy. The old UTF-8 line exited 1 here.
  it("answers under Constrained Language Mode", () => {
    const dir = mkdtempSync(join(tmpdir(), "upd-sig-"));
    dirs.push(dir);
    const file = join(dir, "temp-x-setup.ps1");
    writeFileSync(file, "# unsigned\r\n");
    const inv = powerShellInvocation(file);
    const args = inv.args.map((a) => (a === SIGNATURE_COMMAND ? `$ExecutionContext.SessionState.LanguageMode = 'ConstrainedLanguage'; ${a}` : a));
    expect(args).not.toEqual(inv.args);
    const r = spawnSync(inv.file, args, { env: inv.options.env, encoding: "utf8", windowsHide: true, timeout: SIGNATURE_TIMEOUT_MS });
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout.trim()).Status).toBe(2); // NotSigned: it read the file
  }, 30_000);

  it("checks a file in a folder whose name is not ASCII", async () => {
    const dir = mkdtempSync(join(tmpdir(), "upd-sig-Jürgen Ä-"));
    dirs.push(dir);
    const file = join(dir, "temp-aipm-cockpit-9.9.9-setup.ps1");
    writeFileSync(file, "# unsigned\r\n");
    // NotSigned, not "not about the downloaded installer": the file-name match held.
    expect(await verifyUpdateSignature([SIGNER], file, defaultRun)).toContain("NotSigned");
  }, 30_000);
});

describe("feedRequiresSignature", () => {
  it("is true when app-update.yml has a publisherName key, in either list or scalar form", () => {
    expect(feedRequiresSignature("owner: x\npublisherName:\n  - SignPath Foundation\nrepo: y\n")).toBe(true);
    expect(feedRequiresSignature("publisherName:\r\n  - SignPath Foundation\r\n")).toBe(true);
    expect(feedRequiresSignature("provider: github\npublisherName: SignPath Foundation\n")).toBe(true);
  });

  it("is false for the unsigned build's feed and for the name elsewhere", () => {
    expect(feedRequiresSignature("owner: sebastianmaute\nrepo: aipm-cockpit\nprovider: github\nupdaterCacheDirName: aipm-cockpit-desktop-updater\n")).toBe(false);
    expect(feedRequiresSignature("# publisherName:\nowner: x\n")).toBe(false);
    expect(feedRequiresSignature("notpublisherName: x\n")).toBe(false);
    expect(feedRequiresSignature("")).toBe(false);
  });
});
