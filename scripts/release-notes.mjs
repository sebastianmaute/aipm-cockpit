#!/usr/bin/env node
// Prints user-facing release notes for a date window, built from CHANGELOG.md
// (§527). The grouping lives in release-notes-lib.mjs; this file owns the I/O.
//
//   npm run release-notes                          # the last seven days, today included
//   npm run release-notes -- --since 2026-09-29 --until 2026-10-05
//   npm run release-notes -- --unreleased          # also list what is merged but not released
//
// Exit 0 = notes printed (including "No release in this window"),
// 2 = a bad argument or CHANGELOG.md could not be read.
import { readFileSync } from "node:fs";
import { parseReleases, renderReleaseNotes, selectWindow } from "./release-notes-lib.mjs";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

function fail(message) {
  console.error(`release-notes: ${message}`);
  process.exit(2);
}

function parseArgs(argv) {
  const today = new Date().toISOString().slice(0, 10);
  const opts = { since: null, until: today, unreleased: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--unreleased") opts.unreleased = true;
    else if (arg === "--since" || arg === "--until") {
      const value = argv[++i];
      if (!value || !DATE_RE.test(value)) fail(`${arg} needs a date as YYYY-MM-DD`);
      opts[arg.slice(2)] = value;
    } else fail(`unknown argument "${arg}"`);
  }
  // Seven days ending on `until`, both ends included.
  opts.since ??= new Date(Date.parse(opts.until) - 6 * DAY_MS).toISOString().slice(0, 10);
  if (opts.since > opts.until) fail(`--since ${opts.since} is after --until ${opts.until}`);
  return opts;
}

const opts = parseArgs(process.argv.slice(2));
let changelog;
try {
  changelog = readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8");
} catch (err) {
  fail(`cannot read CHANGELOG.md: ${err instanceof Error ? err.message : String(err)}`);
}
const releases = selectWindow(parseReleases(changelog), opts);
process.stdout.write(renderReleaseNotes(releases, opts));
