// @vitest-environment node
// release-signing-guard: once a release shipped signed, no later release may ship unsigned.
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decide, runGuard, classifySignature, SIGNER } from "./release-signing-guard.mjs";

const TAG = "v1.15.0";
const DIR = "/rel";
const NOW = "/rel/aipm-cockpit-1.15.0-setup.exe";
const SIGNED = { status: "Valid", subject: `CN=${SIGNER}, O=${SIGNER}, L=Berlin, C=DE` };
const UNSIGNED = { status: "NotSigned", subject: "" };
const REPO_CALL = ["api", "repos/{owner}/{repo}", "--jq", ".full_name"];

/** A fake gh: `latest` is the previous release's tag (null = GitHub answers 404 — none published),
 *  `repoOk` whether the repository itself can be read, `assets` whether the download yields an
 *  installer, `fail` makes every call throw. Records each call. */
function fakeGh({ latest = "v1.14.0", repoOk = true, assets = true, fail = null } = {}) {
  const calls = [];
  const gh = async (args) => {
    calls.push(args);
    if (fail) throw new Error(fail);
    if (args[0] === "api" && args[1] === "repos/{owner}/{repo}") {
      if (!repoOk) throw new Error("gh api repos failed: HTTP 404");
      return { stdout: "owner/repo\n" };
    }
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

describe("classifySignature", () => {
  it("is signed only when Valid AND the signer is SignPath Foundation, unsigned only when NotSigned", () => {
    expect(classifySignature(SIGNED)).toBe("signed");
    expect(classifySignature(UNSIGNED)).toBe("unsigned");
  });

  // Anything else is neither: a broken or foreign signature must never read as "unsigned", or a
  // signed release whose signature check misbehaves would let an unsigned release through.
  it.each([
    ["Valid with another signer", { status: "Valid", subject: "CN=Someone Else" }],
    ["HashMismatch", { status: "HashMismatch", subject: SIGNED.subject }],
    ["UnknownError", { status: "UnknownError", subject: "" }],
    ["NotTrusted", { status: "NotTrusted", subject: SIGNED.subject }],
    ["NotSigned with a signer", { status: "NotSigned", subject: SIGNED.subject }],
    ["no status", { subject: SIGNED.subject }],
    ["not an object", null],
  ])("cannot classify %s", (_, sig) => {
    expect(classifySignature(sig)).toBeNull();
  });

  // The installed app accepts an update only when the subject's CN EQUALS the feed's publisher name
  // (desktop/src/update-signature.ts `signerMatches`, which this guard imports). A subject that
  // merely CONTAINS the name must not count as signed here either, or a release the app would refuse
  // to update from could pass as signed and lock the one-way switch.
  it.each([
    ["the exact CN", `CN=${SIGNER}, O=${SIGNER}, C=DE`],
    ["the exact CN, quoted", `CN="${SIGNER}", O=Other, C=DE`],
    ["the exact CN, spaced around the separators", `O=Other ,  CN=${SIGNER} , C=DE`],
  ])("is signed with %s", (_, subject) => {
    expect(classifySignature({ status: "Valid", subject })).toBe("signed");
  });

  it.each([
    ["a longer CN", `CN=${SIGNER} Ltd, O=${SIGNER}, C=DE`],
    ["a CN with a trailing space inside quotes", `CN="${SIGNER} ", O=${SIGNER}, C=DE`],
    ["a CN in another case", `CN=${SIGNER.toUpperCase()}, O=${SIGNER}, C=DE`],
    ["the name only in O=", `CN=Someone Else, O=${SIGNER}, C=DE`],
    ["a quoted CN holding a comma", `CN="${SIGNER}, Inc.", O=Other, C=DE`],
  ])("cannot classify a Valid signature with %s", (_, subject) => {
    expect(classifySignature({ status: "Valid", subject })).toBeNull();
  });
});

describe("runGuard", () => {
  const run = (gh, signature) => runGuard({ tag: TAG, dir: DIR, gh, signature, tmp: "/tmp/prev" });

  it("refuses an unsigned installer after a signed release (exit 1)", async () => {
    const { gh, calls } = fakeGh();
    expect((await run(gh, sigs(UNSIGNED, SIGNED))).code).toBe(1);
    expect(calls[0]).toEqual(REPO_CALL);
    expect(calls[2]).toEqual(["release", "download", "v1.14.0", "--pattern", "*-setup.exe", "--dir", "/tmp/prev"]);
  });

  it.each([
    ["unsigned after unsigned", UNSIGNED, UNSIGNED],
    ["signed after unsigned", SIGNED, UNSIGNED],
    ["signed after signed", SIGNED, SIGNED],
  ])("passes %s (exit 0)", async (_, now, prev) => {
    expect((await run(fakeGh().gh, sigs(now, prev))).code).toBe(0);
  });

  it.each([
    ["UnknownError", { status: "UnknownError", subject: "" }],
    ["NotTrusted", { status: "NotTrusted", subject: SIGNED.subject }],
    ["HashMismatch", { status: "HashMismatch", subject: SIGNED.subject }],
    ["Valid, another signer", { status: "Valid", subject: "CN=Someone Else" }],
  ])("cannot decide when the previous installer's signature is %s (exit 2), never reads it as unsigned", async (_, prev) => {
    expect((await run(fakeGh().gh, sigs(UNSIGNED, prev))).code).toBe(2);
  });

  it("cannot decide when this installer's signature is neither signed nor NotSigned (exit 2)", async () => {
    expect((await run(fakeGh().gh, sigs({ status: "UnknownError", subject: "" }, SIGNED))).code).toBe(2);
  });

  it("passes when the repository is readable and has no release yet (exit 0)", async () => {
    const { gh, calls } = fakeGh({ latest: null });
    expect((await run(gh, sigs(UNSIGNED, SIGNED))).code).toBe(0);
    expect(calls).toHaveLength(2);
  });

  it("cannot decide on a 404 when the repository itself cannot be read (exit 2)", async () => {
    expect((await run(fakeGh({ latest: null, repoOk: false }).gh, sigs(UNSIGNED, SIGNED))).code).toBe(2);
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

  it("removes the download directory it created", async () => {
    const { gh, calls } = fakeGh();
    const r = await runGuard({ tag: TAG, dir: DIR, gh, signature: sigs(SIGNED, SIGNED) });
    expect(r.code).toBe(0);
    const into = calls[2][calls[2].indexOf("--dir") + 1];
    expect(typeof into).toBe("string");
    expect(existsSync(into)).toBe(false);
  });
});
