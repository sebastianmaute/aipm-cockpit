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

// The root entry ("") is the project itself, and a `link` entry is a symlink to a local folder;
// neither has a tarball to pin.
const installed = (lock) => Object.entries(lock.packages).filter(([key, entry]) => key !== "" && !entry.link);

describe.each(LOCKFILES)("%s", (file) => {
  const entries = installed(read(file));

  // Anti-vacuity: a parse that found no packages would pass every assertion below.
  it("lists installed packages", () => {
    expect(entries.length).toBeGreaterThan(100);
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
