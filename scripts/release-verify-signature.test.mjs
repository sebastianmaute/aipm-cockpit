// @vitest-environment node
// release-verify-signature: the release's signature check is the installed app's own verifier, fed
// the publisher names the packaged feed hands it.
import { isAbsolute } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { parseArgs, publisherNamesFromFeed, runVerify } from "./release-verify-signature.mjs";
import { addPublisherName, PUBLISHER } from "./release-update-feed.mjs";

const BUILD_FEED = "owner: sebastianmaute\nrepo: aipm-cockpit\nprovider: github\nupdaterCacheDirName: aipm-cockpit-desktop-updater\n";

describe("publisherNamesFromFeed", () => {
  // The feed the sign job writes, read with the js-yaml electron-updater reads it with.
  it("reads the list release-update-feed.mjs writes, in either line ending", () => {
    expect(publisherNamesFromFeed(addPublisherName(BUILD_FEED).text)).toEqual([PUBLISHER]);
    expect(publisherNamesFromFeed(addPublisherName(BUILD_FEED.replace(/\n/g, "\r\n")).text)).toEqual([PUBLISHER]);
  });

  it("turns a single name into a one-item list, as NsisUpdater does", () => {
    expect(publisherNamesFromFeed(`${BUILD_FEED}publisherName: ${PUBLISHER}\n`)).toEqual([PUBLISHER]);
  });

  it.each([
    ["no publisherName", BUILD_FEED],
    ["an empty value", `${BUILD_FEED}publisherName:\n`],
    ["an empty list", `${BUILD_FEED}publisherName: []\n`],
    ["a non-string item", `${BUILD_FEED}publisherName:\n  - 42\n`],
    ["an empty document", ""],
  ])("throws on %s", (_, text) => {
    expect(() => publisherNamesFromFeed(text)).toThrow();
  });
});

describe("parseArgs", () => {
  it("takes a feed or a publisher, then the file", () => {
    expect(parseArgs(["--feed", "a.yml", "x.exe"])).toEqual({ feed: "a.yml", file: "x.exe" });
    expect(parseArgs(["--publisher", PUBLISHER, "x.exe"])).toEqual({ publisher: PUBLISHER, file: "x.exe" });
  });

  it.each([[[]], [["x.exe"]], [["--feed", "a.yml"]], [["--name", "a", "x.exe"]], [["--feed", "a.yml", "x.exe", "y"]]])(
    "refuses %j", (argv) => {
      expect(() => parseArgs(argv)).toThrow(/usage/);
    });
});

describe("runVerify", () => {
  const SIGNED_FEED = addPublisherName(BUILD_FEED).text;

  it("passes the feed's names and the absolute path to the verifier; null is exit 0", async () => {
    const verify = vi.fn(async () => null);
    const r = await runVerify({ argv: ["--feed", "feed.yml", "rel/setup.exe"], verify, readFile: () => SIGNED_FEED });
    expect(r.code).toBe(0);
    expect(verify).toHaveBeenCalledTimes(1);
    const [names, file] = verify.mock.calls[0];
    expect(names).toEqual([PUBLISHER]);
    expect(isAbsolute(file)).toBe(true);
    expect(file.replace(/\\/g, "/")).toMatch(/\/rel\/setup\.exe$/);
  });

  it("is exit 1 with the verifier's reason when it refuses", async () => {
    const verify = async () => 'the installer is signed by "CN=Someone", not by SignPath Foundation';
    const r = await runVerify({ argv: ["--publisher", PUBLISHER, "x.exe"], verify });
    expect(r.code).toBe(1);
    expect(r.message).toContain('signed by "CN=Someone"');
  });

  it.each([
    ["the feed cannot be read", () => { throw new Error("ENOENT"); }],
    ["the feed names no publisher", () => BUILD_FEED],
  ])("cannot check (exit 2) when %s, and never calls the verifier", async (_, readFile) => {
    const verify = vi.fn(async () => null);
    const r = await runVerify({ argv: ["--feed", "feed.yml", "x.exe"], verify, readFile });
    expect(r.code).toBe(2);
    expect(verify).not.toHaveBeenCalled();
  });

  it("cannot check (exit 2) on bad arguments", async () => {
    expect((await runVerify({ argv: ["x.exe"], verify: async () => null })).code).toBe(2);
  });
});
