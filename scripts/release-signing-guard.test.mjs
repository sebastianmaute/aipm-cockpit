// @vitest-environment node
// release-signing-guard: once a release shipped signed, no later release may ship unsigned.
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  decide, runGuard, classifySignature, newestPublished, RELEASES_JQ, RELEASES_PATH, SIGNER,
} from "./release-signing-guard.mjs";

const TAG = "v1.15.0";
const DIR = "/rel";
const NOW = "/rel/aipm-cockpit-1.15.0-setup.exe";
// SignPath Foundation's certificate subject as Get-AuthenticodeSignature prints it; SIGNER is that DN.
const SUBJECT = "CN=SignPath Foundation, O=SignPath Foundation, L=Lewes, S=Delaware, C=US";
const SIGNED = { status: "Valid", subject: SUBJECT };
const UNSIGNED = { status: "NotSigned", subject: "" };
const REPO_CALL = ["api", "repos/{owner}/{repo}", "--jq", ".full_name"];

const LIST_CALL = ["api", RELEASES_PATH, "--jq", RELEASES_JQ];
const rel = (tag, published, { draft = false } = {}) => ({ tag, draft, published });

/** A fake gh: `releases` is the release list as RELEASES_JQ reduces it (null = the list answers
 *  404), `repoOk` whether the repository itself can be read, `assets` whether the download yields
 *  an installer, `fail` makes every call throw. Records each call. */
function fakeGh({ releases = [rel("v1.14.0", "2026-10-01T10:00:00Z")], repoOk = true, assets = true, fail = null } = {}) {
  const calls = [];
  const gh = async (args) => {
    calls.push(args);
    if (fail) throw new Error(fail);
    if (args[0] === "api" && args[1] === "repos/{owner}/{repo}") {
      if (!repoOk) throw new Error("gh api repos failed: HTTP 404");
      return { stdout: "owner/repo\n" };
    }
    if (args[0] === "api" && args[1] === RELEASES_PATH) {
      if (releases === null) return { notFound: true };
      return { stdout: `${JSON.stringify(releases)}\n` };
    }
    if (args[0] === "release" && args[1] === "download") return { files: assets ? [`aipm-cockpit-${args[2].slice(1)}-setup.exe`] : [] };
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

  // The installed app accepts an update only when the subject carries every attribute of the feed's
  // publisher DN with exactly its value (desktop/src/update-signature.ts `signerMatches`, which this
  // guard imports). A subject that merely CONTAINS the name, or shares only its CN, must not count as
  // signed here either, or a release the app would refuse to update from could pass as signed and
  // lock the one-way switch.
  it("names SignPath Foundation's full certificate subject", () => {
    expect(SIGNER).toBe(SUBJECT);
  });

  it.each([
    ["the exact subject", SUBJECT],
    ["the same attributes in another order", "C=US, S=Delaware, L=Lewes, O=SignPath Foundation, CN=SignPath Foundation"],
    ["the exact subject, quoted", 'CN="SignPath Foundation", O="SignPath Foundation", L=Lewes, S=Delaware, C=US'],
    ["the exact subject, spaced around the separators", "CN=SignPath Foundation ,  O=SignPath Foundation , L=Lewes, S=Delaware, C=US"],
  ])("is signed with %s", (_, subject) => {
    expect(classifySignature({ status: "Valid", subject })).toBe("signed");
  });

  it.each([
    ["the CN alone", "CN=SignPath Foundation"],
    ["another O", SUBJECT.replace("O=SignPath Foundation", "O=Other")],
    ["another C", SUBJECT.replace("C=US", "C=DE")],
    ["another L", SUBJECT.replace("L=Lewes", "L=Berlin")],
    ["another S", SUBJECT.replace("S=Delaware", "S=Bavaria")],
    ["no S", "CN=SignPath Foundation, O=SignPath Foundation, L=Lewes, C=US"],
    ["a longer CN", SUBJECT.replace("CN=SignPath Foundation", "CN=SignPath Foundation Ltd")],
    ["a CN with a trailing space inside quotes", SUBJECT.replace("CN=SignPath Foundation", 'CN="SignPath Foundation "')],
    ["a CN in another case", SUBJECT.replace("CN=SignPath Foundation", "CN=SIGNPATH FOUNDATION")],
    ["the name only in O=", SUBJECT.replace("CN=SignPath Foundation", "CN=Someone Else")],
    ["lower-case keys", SUBJECT.replace(/(^|, )([A-Z]+)=/g, (_, sep, k) => `${sep}${k.toLowerCase()}=`)],
  ])("cannot classify a Valid signature with %s", (_, subject) => {
    expect(classifySignature({ status: "Valid", subject })).toBeNull();
  });
});

describe("newestPublished", () => {
  it("takes the newest published release by publish time, prereleases included, drafts skipped", () => {
    const list = [
      rel("v1.16.0", null, { draft: true }),
      rel("v1.14.0", "2026-10-01T10:00:00Z"),
      rel("v1.15.0-rc.1", "2026-10-20T10:00:00Z"),
      rel("v1.13.0", "2026-09-01T10:00:00Z"),
    ];
    expect(newestPublished(JSON.stringify(list))).toBe("v1.15.0-rc.1");
  });

  it("is null for no published release", () => {
    expect(newestPublished("[]")).toBeNull();
    expect(newestPublished(JSON.stringify([rel("v1.0.0", null, { draft: true })]))).toBeNull();
  });

  it.each([
    ["not JSON", "<html>"],
    ["not a list", '{"tag":"v1"}'],
    ["an entry without draft", JSON.stringify([{ tag: "v1.0.0", published: "2026-10-01T10:00:00Z" }])],
    ["a published entry without a tag", JSON.stringify([rel("", "2026-10-01T10:00:00Z")])],
    ["a published entry without a time", JSON.stringify([rel("v1.0.0", null)])],
  ])("throws on %s", (_, stdout) => {
    expect(() => newestPublished(stdout)).toThrow();
  });
});

describe("runGuard", () => {
  const run = (gh, signature) => runGuard({ tag: TAG, dir: DIR, gh, signature, tmp: "/tmp/prev" });

  it("refuses an unsigned installer after a signed release (exit 1)", async () => {
    const { gh, calls } = fakeGh();
    expect((await run(gh, sigs(UNSIGNED, SIGNED))).code).toBe(1);
    expect(calls[0]).toEqual(REPO_CALL);
    expect(calls[1]).toEqual(LIST_CALL);
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

  // A revoked (or re-chained) certificate makes the previous installer read NotTrusted on the
  // runner. A freshly and validly signed installer strands nobody, so it must still pass — that is
  // the way out after a revocation. The previous reading is logged, not decided on.
  const REVOKED = { status: "NotTrusted", subject: SIGNED.subject };

  it("passes a validly signed installer after a previous one that no longer reads Valid (exit 0)", async () => {
    const r = await run(fakeGh().gh, sigs(SIGNED, REVOKED));
    expect(r.code).toBe(0);
    expect(r.message).toContain("previous release could not be classified");
    expect(r.message).toContain("NotTrusted");
  });

  it("cannot decide on an unsigned installer after a previous one that no longer reads Valid (exit 2)", async () => {
    const r = await run(fakeGh().gh, sigs(UNSIGNED, REVOKED));
    expect(r.code).toBe(2);
    expect(r.message).toContain("CANNOT DECIDE");
  });

  // Signed by any other CN is not "validly signed by the expected publisher": it gets no pass, and
  // after a signed release it fails the release.
  it("fails an installer signed by another CN after a signed release (exit 2, never 0)", async () => {
    const r = await run(fakeGh().gh, sigs({ status: "Valid", subject: SUBJECT.replace("CN=SignPath Foundation", "CN=SignPath Foundation Ltd") }, SIGNED));
    expect(r.code).toBe(2);
    expect(r.message).toContain("aipm-cockpit-1.15.0-setup.exe");
  });

  it("logs what the previous installer read as when this one is signed", async () => {
    expect((await run(fakeGh().gh, sigs(SIGNED, SIGNED))).message).toContain("previous v1.14.0 signed");
    expect((await run(fakeGh().gh, sigs(SIGNED, UNSIGNED))).message).toContain("previous v1.14.0 unsigned");
  });

  it.each([
    ["the repository cannot be read", { releases: [], repoOk: false }],
    ["gh fails", { fail: "network down" }],
    ["the previous release has no installer", { assets: false }],
  ])("passes a validly signed installer when %s, and says so (exit 0)", async (_, opts) => {
    const r = await run(fakeGh(opts).gh, sigs(SIGNED, SIGNED));
    expect(r.code).toBe(0);
    expect(r.message).toContain("previous release could not be classified");
  });

  it("cannot decide when this installer's signature is neither signed nor NotSigned (exit 2)", async () => {
    expect((await run(fakeGh().gh, sigs({ status: "UnknownError", subject: "" }, SIGNED))).code).toBe(2);
  });

  it("passes when the repository is readable and has no release yet (exit 0)", async () => {
    const { gh, calls } = fakeGh({ releases: [] });
    expect((await run(gh, sigs(UNSIGNED, SIGNED))).code).toBe(0);
    expect(calls).toHaveLength(2);
  });

  it("passes when the only releases are drafts, which are not published (exit 0)", async () => {
    const { gh, calls } = fakeGh({ releases: [rel("v1.15.0", null, { draft: true })] });
    expect((await run(gh, sigs(UNSIGNED, SIGNED))).code).toBe(0);
    expect(calls).toHaveLength(2);
  });

  it("cannot decide on an empty list when the repository itself cannot be read (exit 2)", async () => {
    expect((await run(fakeGh({ releases: [], repoOk: false }).gh, sigs(UNSIGNED, SIGNED))).code).toBe(2);
  });

  it("cannot decide when the release list answers 404 (exit 2)", async () => {
    expect((await run(fakeGh({ releases: null }).gh, sigs(UNSIGNED, SIGNED))).code).toBe(2);
  });

  it("cannot decide when the release list cannot be read (exit 2)", async () => {
    const { gh } = fakeGh();
    const broken = async (args) => (args[1] === RELEASES_PATH ? { stdout: "<html>" } : gh(args));
    expect((await run(broken, sigs(UNSIGNED, SIGNED))).code).toBe(2);
  });

  // releases/latest skips prereleases: a signed release candidate published after the latest stable
  // release must still count, or an unsigned release could follow it.
  it("compares with a signed prerelease newer than the latest stable release, and refuses an unsigned one (exit 1)", async () => {
    const releases = [rel("v1.14.0", "2026-10-01T10:00:00Z"), rel("v1.15.0-rc.1", "2026-10-20T10:00:00Z")];
    const { gh, calls } = fakeGh({ releases });
    const byFile = async (path) => {
      const p = path.replace(/\\/g, "/");
      if (p === NOW) return UNSIGNED;
      return p.endsWith("aipm-cockpit-1.15.0-rc.1-setup.exe") ? SIGNED : UNSIGNED;
    };
    const r = await run(gh, byFile);
    expect(r.code).toBe(1);
    expect(r.message).toContain("v1.15.0-rc.1");
    expect(calls[2][2]).toBe("v1.15.0-rc.1");
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
