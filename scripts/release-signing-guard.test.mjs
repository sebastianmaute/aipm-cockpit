// @vitest-environment node
// release-signing-guard: once a release shipped signed, no later release may ship unsigned.
import { describe, expect, it } from "vitest";
import { decide, runGuard, parseSignature, SIGNER } from "./release-signing-guard.mjs";

const TAG = "v1.15.0";
const DIR = "/rel";
const NOW = "/rel/aipm-cockpit-1.15.0-setup.exe";
const SIGNED = { status: "Valid", subject: `CN=${SIGNER}, O=${SIGNER}, L=Berlin, C=DE` };
const UNSIGNED = { status: "NotSigned", subject: "" };

/** A fake gh: `latest` is the previous release's tag (null = none published), `assets` whether
 *  its download yields an installer, `fail` makes every call throw. Records each call. */
function fakeGh({ latest = "v1.14.0", assets = true, fail = null } = {}) {
  const calls = [];
  const gh = async (args) => {
    calls.push(args);
    if (fail) throw new Error(fail);
    if (args[0] === "api") {
      if (latest === null) return { notFound: true };
      return { stdout: `${latest}\n` };
    }
    if (args[0] === "release" && args[1] === "download") return { files: assets ? ["aipm-cockpit-1.14.0-setup.exe"] : [] };
    throw new Error(`unexpected gh ${args.join(" ")}`);
  };
  return { gh, calls };
}
// path.join gives "\" on Windows; compare in "/" form.
const sigs = (now, prev) => async (path) => (path.replace(/\\/g, "/") === NOW ? now : prev);

describe("decide", () => {
  it.each([
    [false, false, 0],
    [false, true, 0],
    [true, true, 0],
    [true, false, 1],
  ])("previous signed=%s, now signed=%s → %i", (prevSigned, nowSigned, code) => {
    expect(decide({ prevSigned, nowSigned }).code).toBe(code);
  });
});

describe("parseSignature", () => {
  it("is signed only when Valid AND the signer is SignPath Foundation", () => {
    expect(parseSignature(SIGNED)).toBe(true);
    expect(parseSignature(UNSIGNED)).toBe(false);
    expect(parseSignature({ status: "Valid", subject: "CN=Someone Else" })).toBe(false);
    expect(parseSignature({ status: "HashMismatch", subject: SIGNED.subject })).toBe(false);
  });
});

describe("runGuard", () => {
  const run = (gh, signature) => runGuard({ tag: TAG, dir: DIR, gh, signature, tmp: "/tmp/prev" });

  it("refuses an unsigned installer after a signed release (exit 1)", async () => {
    const { gh, calls } = fakeGh();
    expect((await run(gh, sigs(UNSIGNED, SIGNED))).code).toBe(1);
    expect(calls[1]).toEqual(["release", "download", "v1.14.0", "--pattern", "*-setup.exe", "--dir", "/tmp/prev"]);
  });

  it.each([
    ["unsigned after unsigned", UNSIGNED, UNSIGNED],
    ["signed after unsigned", SIGNED, UNSIGNED],
    ["signed after signed", SIGNED, SIGNED],
  ])("passes %s (exit 0)", async (_, now, prev) => {
    expect((await run(fakeGh().gh, sigs(now, prev))).code).toBe(0);
  });

  it("passes when no release has been published yet (exit 0)", async () => {
    const { gh, calls } = fakeGh({ latest: null });
    expect((await run(gh, sigs(UNSIGNED, SIGNED))).code).toBe(0);
    expect(calls).toHaveLength(1);
  });

  it("cannot decide when gh fails (exit 2)", async () => {
    expect((await run(fakeGh({ fail: "network down" }).gh, sigs(UNSIGNED, SIGNED))).code).toBe(2);
  });

  it("cannot decide when the previous release has no installer (exit 2)", async () => {
    expect((await run(fakeGh({ assets: false }).gh, sigs(UNSIGNED, SIGNED))).code).toBe(2);
  });

  it("cannot decide when a signature cannot be read (exit 2)", async () => {
    const broken = async () => { throw new Error("powershell missing"); };
    expect((await run(fakeGh().gh, broken)).code).toBe(2);
  });

  it("cannot decide on a malformed tag (exit 2)", async () => {
    const r = await runGuard({ tag: "1.15.0", dir: DIR, gh: fakeGh().gh, signature: sigs(SIGNED, SIGNED), tmp: "/t" });
    expect(r.code).toBe(2);
  });
});
