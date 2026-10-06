// @vitest-environment node
// Every installed package in each tracked lockfile carries `resolved` + `integrity`, so the lockfile
// PINS that package's bytes (open-followups §670). Without the hash npm still verifies a tarball
// against the registry's own metadata, but a later install is no longer bound to the SAME contents.
// Neither a clean `npm install` nor `--package-lock-only` backfills a missing hash (measured on
// npm 12.2.0), so a regression here does not heal on its own: fill each entry from the registry's
// metadata for its exact pinned version, then prove it with `npm ci`.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const LOCKFILES = ["package-lock.json", "desktop/package-lock.json"];
const read = (p) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), "utf8"));

// Only registry installs have a tarball to pin. Skipped: the root entry ("") and any other key
// outside `node_modules/` (a workspace folder), a `link` entry (a symlink to a local folder), and
// an `inBundle` entry, which ships inside its parent's tarball and for which npm writes no hash.
// None of the three exists in either lockfile today.
const installed = (lock) =>
  Object.entries(lock.packages).filter(([key, entry]) => key.includes("node_modules/") && !entry.link && !entry.inBundle);

// Well under either lockfile's real count, so a parse that reads almost nothing still fails.
const MIN_INSTALLED = 100;

describe.each(LOCKFILES)("%s", (file) => {
  const entries = installed(read(file));

  // Anti-vacuity: a parse that found no packages would pass every assertion below.
  it("lists installed packages", () => {
    expect(entries.length).toBeGreaterThan(MIN_INSTALLED);
  });

  it("pins every installed package with resolved + integrity", () => {
    const unpinned = entries.filter(([, e]) => !e.resolved || !e.integrity).map(([key]) => key);
    expect(unpinned).toEqual([]);
  });

  it("uses sha512 for every integrity", () => {
    const weak = entries.filter(([, e]) => e.integrity && !e.integrity.startsWith("sha512-")).map(([key]) => key);
    expect(weak).toEqual([]);
  });
});
