// @vitest-environment node
// release-update-feed: the sign job gives the packed app's resources/app-update.yml the updater's
// publisherName, so a signed build's updater refuses any update it cannot verify.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { PUBLISHER, addPublisherName, writePublisherName } from "./release-update-feed.mjs";

const CLI = fileURLToPath(new URL("./release-update-feed.mjs", import.meta.url));
const RELEASE_YML = readFileSync(fileURLToPath(new URL("../.github/workflows/release.yml", import.meta.url)), "utf8");
// js-yaml as electron-updater loads app-update.yml with it (AppUpdater.js loadUpdateConfig).
const yaml = createRequire(new URL("../desktop/package.json", import.meta.url))("js-yaml");

// What electron-builder's after-pack hook writes for this repo's `publish:` block.
const FEED = "owner: sebastianmaute\nrepo: aipm-cockpit\nprovider: github\nupdaterCacheDirName: aipm-cockpit-desktop-updater\n";
const crlf = (s) => s.replace(/\n/g, "\r\n");

// The sign job's update-feed check, its .NET pattern taken from release.yml and run in JS (the
// same translation ci-workflow.test.mjs pins: '' is one ', (?m) is the "m" flag).
function feedCheck() {
  const text = RELEASE_YML.replace(/\r\n/g, "\n");
  const at = text.indexOf("- name: The repackaged app's updater requires the SignPath Foundation signature");
  expect(at, "the update-feed check step").toBeGreaterThan(-1);
  const ps = /-notmatch '((?:[^']|'')*)'/.exec(text.slice(at))?.[1];
  expect(ps, "the update-feed check's pattern").toBeTruthy();
  return new RegExp(ps.replace(/''/g, "'").replace(/^\(\?m\)/, ""), "m");
}

const dirs = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
function appTree(feed) {
  const app = mkdtempSync(join(tmpdir(), "update-feed-"));
  dirs.push(app);
  mkdirSync(join(app, "resources"));
  if (feed !== undefined) writeFileSync(join(app, "resources", "app-update.yml"), feed);
  return app;
}
const feedOf = (app) => readFileSync(join(app, "resources", "app-update.yml"), "utf8");
const cli = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8" });

describe("addPublisherName", () => {
  it("appends the publisher list and keeps every other key byte for byte, LF and CRLF", () => {
    for (const eol of ["\n", "\r\n"]) {
      const text = FEED.replace(/\n/g, eol);
      const r = addPublisherName(text);
      expect(r.changed).toBe(true);
      expect(r.text).toBe(`${text}publisherName:${eol}  - ${PUBLISHER}${eol}`);
      expect(r.text.startsWith(text)).toBe(true);
      // electron-updater reads exactly that list, and the other keys as before.
      expect(yaml.load(r.text)).toEqual({ ...yaml.load(text), publisherName: [PUBLISHER] });
      // The sign job's check after the repackage accepts it.
      expect(feedCheck().test(r.text), JSON.stringify(eol)).toBe(true);
      expect(feedCheck().test(text)).toBe(false);
    }
  });

  it("names SignPath Foundation", () => {
    expect(PUBLISHER).toBe("SignPath Foundation");
  });

  it("adds a line break first when the file ends without one", () => {
    expect(addPublisherName("owner: x").text).toBe(`owner: x\npublisherName:\n  - ${PUBLISHER}\n`);
    expect(addPublisherName("owner: x\r\nrepo: y").text).toBe(`owner: x\r\nrepo: y\r\npublisherName:\r\n  - ${PUBLISHER}\r\n`);
  });

  it("is idempotent when the list is already exactly SignPath Foundation", () => {
    for (const text of [
      `${FEED}publisherName:\n  - ${PUBLISHER}\n`,
      crlf(`${FEED}publisherName:\n  - '${PUBLISHER}'\n`),
      `publisherName:\n  - "${PUBLISHER}"\n${FEED}`,
    ]) {
      const r = addPublisherName(text);
      expect(r, text).toEqual({ text, changed: false });
    }
    const once = addPublisherName(FEED).text;
    expect(addPublisherName(once)).toEqual({ text: once, changed: false });
  });

  it("refuses a publisherName that is anything else", () => {
    for (const text of [
      `${FEED}publisherName:\n  - Someone Else\n`,
      `${FEED}publisherName:\n  - ${PUBLISHER}\n  - Someone Else\n`,
      `${FEED}publisherName: ${PUBLISHER}\n`,
      `${FEED}publisherName: [${PUBLISHER}]\n`,
      `${FEED}publisherName:\n`,
      `${FEED}publisherName:\n  - ${PUBLISHER} Ltd\n`,
      `${FEED}publisherName:\n  - ${PUBLISHER}\npublisherName:\n  - ${PUBLISHER}\n`,
    ]) {
      expect(() => addPublisherName(text), text).toThrow(/publisherName/);
    }
  });

  it("refuses an empty feed", () => {
    expect(() => addPublisherName("")).toThrow(/empty/);
    expect(() => addPublisherName(" \n")).toThrow(/empty/);
  });
});

describe("writePublisherName", () => {
  it("writes the list into <app>/resources/app-update.yml", () => {
    const app = appTree(crlf(FEED));
    expect(writePublisherName(app)).toEqual({ path: join(app, "resources", "app-update.yml"), changed: true });
    expect(feedOf(app)).toBe(`${crlf(FEED)}publisherName:\r\n  - ${PUBLISHER}\r\n`);
    expect(writePublisherName(app).changed).toBe(false);
  });
});

describe("the CLI", () => {
  it("exits 0 and writes, then exits 0 again without changing anything", () => {
    const app = appTree(FEED);
    const first = cli(app);
    expect(first.status, first.stderr).toBe(0);
    const after = feedOf(app);
    expect(feedCheck().test(after)).toBe(true);
    const second = cli(app);
    expect(second.status, second.stderr).toBe(0);
    expect(feedOf(app)).toBe(after);
  });

  it("exits 1 and leaves the file alone when it carries a different publisherName", () => {
    const text = `${FEED}publisherName:\n  - Someone Else\n`;
    const app = appTree(text);
    const r = cli(app);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/publisherName/);
    expect(feedOf(app)).toBe(text);
  });

  it("exits 2 when the feed is missing or unreadable, or no app directory is given", () => {
    const missing = cli(appTree());
    expect(missing.status).toBe(2);
    expect(missing.stderr).toMatch(/app-update\.yml/);
    const dirAsFile = appTree();
    mkdirSync(join(dirAsFile, "resources", "app-update.yml"));
    expect(cli(dirAsFile).status).toBe(2);
    expect(cli().status).toBe(2);
  });
});
