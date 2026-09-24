# Releases and auto-update on GitHub — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `v*` tag builds the Windows installer on GitHub Actions and, after the owner approves, publishes an immutable GitHub Release that installed desktop apps update from.

**Architecture:** `.github/workflows/release.yml` runs three jobs: `guard` (tag = `APP_VERSION`, commit on `main`), `build` (windows-latest, read-only, uploads installer + blockmap + `latest.yml`) and `publish` (environment `release`, the only job with write permission, no package install: verify, attest, `gh release create`). Pure, dependency-free Node libraries hold every decision; thin CLIs own I/O and exit codes. The desktop shell gains `electron-updater` behind a pure `update-policy` module.

**Tech Stack:** GitHub Actions, `gh` CLI, Node 24 (`.mjs` scripts, vitest), Electron 44 + electron-builder 26 + electron-updater, TypeScript.

**Spec:** `docs/superpowers/specs/2026-09-24-releases-and-updates-design.md`

## Global Constraints

- Work in a clone of `https://github.com/sebastianmaute/aipm-cockpit` (the post-flip history). Never in an old-history checkout.
- Commits: conventional prefix, author `Sebastian Maute <65776548+sebastianmaute@users.noreply.github.com>`, **no trailer of any kind** (no `Claude-Session:`, no `Co-Authored-By:`). Cite register entries as `§N` only; `Closes #NN` only in a PR description. Never `--amend`.
- Never write the GitLab host, group path, project number or any leak-list identifier into a file, commit or message.
- Never read an exit code through a pipe: `cmd > log 2>&1; echo "EXIT=$?"`.
- Never run two vitest processes at once.
- New `.mjs` libraries imported by tests carry **no shebang**.
- Framework-coupled packages are pinned exactly (CONTRIBUTING "Dependencies"): root `next`, `react`, `react-dom`, `eslint-config-next`; desktop `electron`, `electron-builder`, and now `electron-updater`.
- Every workflow `uses:` is pinned to a 40-hex commit SHA with a `# vX` comment; every `actions/checkout` has `persist-credentials: false`; every `run:` containing a pipe declares `shell: bash`; no `${{ … }}` inside a `run:` body — pass values through `env:`.
- Installer name: `aipm-cockpit-<version>-setup.exe`; output dir `desktop/release`; update metadata file `latest.yml`.
- Exit contract for release CLIs: 0 = done/confirmed, 1 = refused (a human must act), 2 = could not run / safe to retry.
- Only Windows NSIS x64 is built. The installer stays unsigned (`signExecutable: false`).
- Updater settings: `autoDownload = false`, `allowPrerelease = false`, `allowDowngrade = false`, `autoInstallOnAppQuit` only after the user chose to download; startup check delay 10 000 ms; checks only when `app.isPackaged`.

## Review Focus

1. A prerelease `APP_VERSION` (`1.14.0-rc.1`) written into the README shields badge — `-` is shields' field separator, so the badge silently breaks unless the version is encoded (`--`). Pinned in Task 1.
2. A stale `latest.yml` beside a freshly built installer (an earlier local build, a partial upload) — the sha512/size must be checked against the installer's own bytes and refused on mismatch. Pinned in Task 2.
3. A re-run of `publish` after it failed half-way and left a **draft** release — the draft must be deleted and recreated, never published with partial files; a **published** release with different files must be refused (exit 1), with identical files accepted (exit 0). Pinned in Task 3.
4. The user clicks "Check for updates…" while a startup check (or a download) is still running — the second check must be ignored, not start a second dialog chain. Pinned in Task 6 (`shouldStartCheck`).
5. Release notes that are HTML, huge, or absent — the dialog must show bounded plain text (and a placeholder when empty). Pinned in Task 6 (`notesToPlainText`).

---

## File map

| File | Task | Responsibility |
|---|---|---|
| `scripts/version-sync-lib.mjs` (+test) | 1 | README badge encodes a prerelease version |
| `scripts/tag-version-lib.test.mjs` | 1 | pins prerelease tags |
| `scripts/release-publish-lib.mjs` (+test) | 2 | pure: names, notes, `latest.yml` check, existing-release classification |
| `scripts/verify-release-assets.mjs` | 2 | CLI: check a release directory |
| `scripts/publish-github-release.mjs` (+integration test) | 3 | CLI: create/publish the GitHub Release through `gh` |
| `desktop/electron-builder.yml` | 4 | `publish:` block |
| `.github/workflows/release.yml` | 4 | the release workflow |
| `scripts/ci-workflow.test.mjs` | 4 | structure rules for `release.yml`; the moved builder cross-check |
| `scripts/check-desktop-types.mjs`, `scripts/gate-local.mjs`, `.github/workflows/ci.yml` | 5 | desktop typecheck gate |
| `desktop/src/lib/update-policy.ts` (+test) | 6 | pure update decisions |
| `desktop/src/updater.ts`, `desktop/src/main.ts`, `desktop/src/lib/menu-model.ts` (+test), `desktop/src/lib/constants.ts`, `desktop/package.json`, `tsconfig.json` | 6 | updater wiring |
| `.github/dependabot.yml`, `scripts/dependabot-config.test.mjs` | 7 | grouped npm updates |
| `SECURITY.md`; repository settings | 8 | hardening |
| docs (RUNBOOK, CONTRIBUTING, AGENTS.md, ci.md, desktop-rollout, roadmap, flip checklist, register) | 9 | docs |
| — | 10 | private rehearsal |

Deleted: `.gitlab-ci.yml` (Task 4), `scripts/publish-release.mjs`, `scripts/publish-release.integration.test.mjs` (Task 3).

---

### Task 1: Prerelease-safe versions

**Files:**
- Modify: `scripts/version-sync-lib.mjs` (README badge satellite; new exports)
- Test: `scripts/version-sync-lib.test.mjs`, `scripts/tag-version-lib.test.mjs`
- Modify: `package.json` (`scriptsDescriptions["tag:check"]`), then `npm run docs:scripts`

**Interfaces:**
- Produces: `encodeBadgeVersion(v: string): string` (`-` → `--`), `decodeBadgeVersion(s: string): string` (`--` → `-`), exported from `version-sync-lib.mjs`.

`classifyTag` already compares the whole remainder after `v`, so `v1.14.0-rc.1` matches `APP_VERSION` `1.14.0-rc.1` today; this task pins that and fixes the one satellite that cannot hold a `-`.

- [ ] **Step 1: Write the failing tests** — append to `scripts/version-sync-lib.test.mjs`:

```js
import { SATELLITES, applyValue, readValue, encodeBadgeVersion, decodeBadgeVersion } from "./version-sync-lib.mjs";

describe("README badge carries a prerelease version", () => {
  const readme = SATELLITES.find((s) => s.file === "README.md");
  const TEXT = "[![version](https://img.shields.io/badge/version-v1.13.2_%22Connelly%22-2e7d32)](./CHANGELOG.md)\n";

  it("doubles every dash, because shields.io splits badge fields on a single dash", () => {
    expect(encodeBadgeVersion("1.14.0-rc.1")).toBe("1.14.0--rc.1");
    expect(encodeBadgeVersion("1.14.0")).toBe("1.14.0");
    expect(decodeBadgeVersion("1.14.0--rc.1")).toBe("1.14.0-rc.1");
  });

  it("round-trips a prerelease version through applyValue and readValue", () => {
    const out = applyValue(readme, TEXT, "1.14.0-rc.1", "Connelly");
    expect(out).toContain("badge/version-v1.14.0--rc.1_%22Connelly%22-2e7d32");
    expect(readValue(readme, out)).toEqual({ version: "1.14.0-rc.1", milestone: "Connelly" });
  });
});
```

(If the file already imports some of these names, merge the import instead of duplicating it.)

Append to `scripts/tag-version-lib.test.mjs`:

```js
describe("prerelease tags", () => {
  it("match only when APP_VERSION carries the same suffix", () => {
    expect(classifyTag("v1.14.0-rc.1", "1.14.0-rc.1").verdict).toBe("match");
    expect(classifyTag("v1.14.0-rc.1", "1.14.0").verdict).toBe("drift");
    expect(classifyTag("v1.14.0", "1.14.0-rc.1").verdict).toBe("drift");
    expect(classifyTag("v1.14.0-rc.2", "1.14.0-rc.1").verdict).toBe("drift");
  });
});
```

- [ ] **Step 2: Run them** — `npx vitest run scripts/version-sync-lib.test.mjs scripts/tag-version-lib.test.mjs > $TMP/t1.log 2>&1; echo "EXIT=$?"`. Expected: EXIT=1, failing on the missing `encodeBadgeVersion` export; the tag-version tests pass already.

- [ ] **Step 3: Implement** — in `scripts/version-sync-lib.mjs`, after `decodeBadgeText`:

```js
/** shields.io splits a badge path on single `-`, so a prerelease version
 *  (`1.14.0-rc.1`) must travel as `1.14.0--rc.1`. Without this the badge's
 *  message ends at `v1.14.0` and the rest is read as a colour — silently. */
export function encodeBadgeVersion(value) {
  return value.replace(/-/g, "--");
}

/** Inverse of `encodeBadgeVersion`. */
export function decodeBadgeVersion(text) {
  return text.replace(/--/g, "-");
}
```

and give the README `version` pattern the hooks:

```js
      {
        key: "version",
        kind: "version",
        re: /(badge\/version-v)([^_]+)(_%22)/,
        encode: encodeBadgeVersion,
        decode: decodeBadgeVersion,
      },
```

- [ ] **Step 4: Update the `tag:check` description** in `package.json` `scriptsDescriptions`:

```
"tag:check": "Assert a tag names exactly src/app/version.ts's APP_VERSION (a prerelease tag like v1.14.0-rc.1 needs the same suffix there). Reads argv[2] — the release workflow's guard job passes the tag — or CI_COMMIT_TAG. Exit 1 is DRIFT — the tag and version.ts disagree, so an installer would misreport its own version; exit 2 means the gate could not scan at all (no tag, or version.ts's shape moved), which demands the opposite response.",
```

Run `npm run docs:scripts` (regenerates CONTRIBUTING's table).

- [ ] **Step 5: Run the tests and the gates** — the same vitest command (EXIT=0), then `npm run version:check`, `npm run docs:scripts:check`, each unpiped with `echo "EXIT=$?"`. All 0.

- [ ] **Step 6: Commit**

```bash
git add scripts/version-sync-lib.mjs scripts/version-sync-lib.test.mjs scripts/tag-version-lib.test.mjs package.json CONTRIBUTING.md
git commit -m "feat: prerelease versions survive the README badge and the tag check"
```

---

### Task 2: The release library and `release:verify`

**Files:**
- Rewrite: `scripts/release-publish-lib.mjs`
- Rewrite: `scripts/release-publish-lib.test.mjs`
- Create: `scripts/verify-release-assets.mjs`
- Modify: `package.json` (`scripts` + `scriptsDescriptions`: add `release:verify`; `release:publish` is changed in Task 3), `npm run docs:scripts`

**Interfaces:**
- Produces (all from `scripts/release-publish-lib.mjs`, no I/O, no `process`):
  - `INSTALLER_DIR = "desktop/release"`, `LATEST_YML = "latest.yml"`
  - `installerName(version: string): string`
  - `expectedAssets(version): string[]` → `[installer, installer + ".blockmap", "latest.yml"]`
  - `releaseTitle(version, milestone): string` → `AI PM Cockpit <v> "<milestone>"`
  - `changelogSection(changelog: string, version: string): string | null`
  - `releaseNotes(changelog, version): string` (throws when the section is missing)
  - `parseLatestYml(text): { version, path, sha512, size, files: {url, sha512, size}[] }` (throws on a shape it cannot read)
  - `checkLatestYml(text, version, installer: {name, sha512, size}): string[]` (problems; `[]` = good)
  - `classifyRelease(releases: object[], expected: {tag, prerelease, assets: {name,size,sha256}[]}): {state: "absent"|"draft"|"identical"|"conflict", detail?: string, id?: number}`

- [ ] **Step 1: Write the failing tests** — replace `scripts/release-publish-lib.test.mjs` entirely:

```js
import { describe, expect, it } from "vitest";
import {
  INSTALLER_DIR, LATEST_YML, installerName, expectedAssets, releaseTitle, changelogSection,
  releaseNotes, parseLatestYml, checkLatestYml, classifyRelease,
} from "./release-publish-lib.mjs";

const SHA512 = "A".repeat(86) + "==";
const LATEST = (over = {}) => {
  const o = { version: "1.14.0", url: "aipm-cockpit-1.14.0-setup.exe", sha512: SHA512, size: 137285908, path: "aipm-cockpit-1.14.0-setup.exe", ...over };
  return [
    `version: ${o.version}`,
    "files:",
    `  - url: ${o.url}`,
    `    sha512: ${o.sha512}`,
    `    size: ${o.size}`,
    `path: ${o.path}`,
    `sha512: ${o.sha512}`,
    "releaseDate: '2026-09-30T10:00:00.000Z'",
    "",
  ].join("\n");
};
const INSTALLER = { name: "aipm-cockpit-1.14.0-setup.exe", sha512: SHA512, size: 137285908 };

describe("names", () => {
  it("builds the installer name and rejects anything that is not semver", () => {
    expect(installerName("1.14.0")).toBe("aipm-cockpit-1.14.0-setup.exe");
    expect(installerName("1.14.0-rc.1")).toBe("aipm-cockpit-1.14.0-rc.1-setup.exe");
    expect(() => installerName("v1.14.0")).toThrow();
    expect(() => installerName("1.14")).toThrow();
  });
  it("expects exactly the installer, its blockmap and latest.yml", () => {
    expect(expectedAssets("1.14.0")).toEqual([
      "aipm-cockpit-1.14.0-setup.exe", "aipm-cockpit-1.14.0-setup.exe.blockmap", LATEST_YML,
    ]);
    expect(INSTALLER_DIR).toBe("desktop/release");
  });
  it("titles a release like the GitLab ones did", () => {
    expect(releaseTitle("1.14.0", "Le Guin")).toBe('AI PM Cockpit 1.14.0 "Le Guin"');
    expect(() => releaseTitle("1.14.0", " ")).toThrow(/milestone/);
  });
});

const CHANGELOG = [
  "# Changelog", "", "Intro.", "",
  '## [1.14.0] - 2026-09-30 "Le Guin"', "", "Auto-update arrives.", "", "### Added", "", "- Updates.", "",
  '## [1.13.2] - 2026-09-22 "Connelly"', "", "Older.", "",
].join("\n");

describe("release notes", () => {
  it("takes exactly the version's CHANGELOG section, without its heading", () => {
    expect(changelogSection(CHANGELOG, "1.14.0")).toBe("Auto-update arrives.\n\n### Added\n\n- Updates.");
    expect(changelogSection(CHANGELOG, "1.13.2")).toBe("Older.");
    expect(changelogSection(CHANGELOG, "1.14")).toBeNull();
    expect(changelogSection(CHANGELOG, "9.9.9")).toBeNull();
  });
  it("appends the unsigned-installer notice and refuses a missing section", () => {
    const notes = releaseNotes(CHANGELOG, "1.14.0");
    expect(notes.startsWith("Auto-update arrives.")).toBe(true);
    expect(notes).toMatch(/not code-signed/);
    expect(notes).toMatch(/SmartScreen/);
    expect(() => releaseNotes(CHANGELOG, "9.9.9")).toThrow(/CHANGELOG\.md has no section/);
  });
});

describe("latest.yml", () => {
  it("parses electron-builder's layout", () => {
    expect(parseLatestYml(LATEST())).toEqual({
      version: "1.14.0", path: INSTALLER.name, sha512: SHA512, size: 137285908,
      files: [{ url: INSTALLER.name, sha512: SHA512, size: 137285908 }],
    });
  });
  it("throws on a shape it cannot read", () => {
    expect(() => parseLatestYml("nonsense: true\n")).toThrow(/latest\.yml/);
  });
  it("accepts a file that describes this installer", () => {
    expect(checkLatestYml(LATEST(), "1.14.0", INSTALLER)).toEqual([]);
  });
  it("names every mismatch", () => {
    expect(checkLatestYml(LATEST({ version: "1.13.2" }), "1.14.0", INSTALLER)).toEqual([
      "latest.yml version is 1.13.2, expected 1.14.0",
    ]);
    const stale = checkLatestYml(LATEST({ sha512: "B".repeat(86) + "==" }), "1.14.0", INSTALLER);
    expect(stale).toContain("latest.yml sha512 does not match the installer");
    expect(stale).toContain("latest.yml files[0].sha512 does not match the installer");
    expect(checkLatestYml(LATEST({ size: 1 }), "1.14.0", INSTALLER)).toContain(
      "latest.yml files[0].size is 1, the installer is 137285908 bytes",
    );
    expect(checkLatestYml(LATEST({ path: "other.exe" }), "1.14.0", INSTALLER)).toContain(
      "latest.yml path is other.exe, expected aipm-cockpit-1.14.0-setup.exe",
    );
    expect(checkLatestYml("junk", "1.14.0", INSTALLER)[0]).toMatch(/cannot read latest\.yml/);
  });
});

const EXPECTED = {
  tag: "v1.14.0", prerelease: false,
  assets: [{ name: "a.exe", size: 3, sha256: "aa" }, { name: "latest.yml", size: 2, sha256: "bb" }],
};
const rel = (over = {}) => ({
  id: 7, tag_name: "v1.14.0", draft: false, prerelease: false,
  assets: [{ name: "a.exe", size: 3, digest: "sha256:aa" }, { name: "latest.yml", size: 2, digest: "sha256:bb" }],
  ...over,
});

describe("classifyRelease", () => {
  it("absent when no release carries the tag", () => {
    expect(classifyRelease([rel({ tag_name: "v1.13.2" })], EXPECTED).state).toBe("absent");
    expect(classifyRelease([], EXPECTED).state).toBe("absent");
  });
  it("draft when an unpublished release carries the tag, whatever its files", () => {
    expect(classifyRelease([rel({ draft: true, assets: [] })], EXPECTED)).toEqual({ state: "draft", id: 7 });
  });
  it("identical when published with exactly these files", () => {
    expect(classifyRelease([rel()], EXPECTED).state).toBe("identical");
  });
  it("conflict on any difference, naming it", () => {
    expect(classifyRelease([rel({ prerelease: true })], EXPECTED)).toMatchObject({ state: "conflict", detail: expect.stringMatching(/prerelease/) });
    expect(classifyRelease([rel({ assets: [rel().assets[0]] })], EXPECTED)).toMatchObject({ state: "conflict", detail: expect.stringMatching(/latest\.yml/) });
    expect(classifyRelease([rel({ assets: [{ ...rel().assets[0], digest: "sha256:zz" }, rel().assets[1]] })], EXPECTED)).toMatchObject({ state: "conflict", detail: expect.stringMatching(/a\.exe/) });
    expect(classifyRelease([rel({ assets: [...rel().assets, { name: "x", size: 1, digest: "sha256:x" }] })], EXPECTED)).toMatchObject({ state: "conflict", detail: expect.stringMatching(/unexpected file x/) });
  });
  it("treats a missing digest as a conflict, never as a match", () => {
    expect(classifyRelease([rel({ assets: [{ name: "a.exe", size: 3 }, rel().assets[1]] })], EXPECTED).state).toBe("conflict");
  });
  it("refuses two releases for one tag", () => {
    expect(classifyRelease([rel(), rel({ id: 8 })], EXPECTED)).toMatchObject({ state: "conflict", detail: expect.stringMatching(/2 releases/) });
  });
});
```

- [ ] **Step 2: Run** — `npx vitest run scripts/release-publish-lib.test.mjs > $TMP/t2.log 2>&1; echo "EXIT=$?"`. Expected EXIT=1 (missing exports).

- [ ] **Step 3: Implement** — replace `scripts/release-publish-lib.mjs` entirely:

```js
// Pure decisions for publishing a desktop release on GitHub Releases.
//
// ★ NO I/O, NO process, NO shebang. The CLIs (verify-release-assets.mjs,
// publish-github-release.mjs) own reading files, running gh and exit codes, so
// every decision here is unit-testable. Spec:
// docs/superpowers/specs/2026-09-24-releases-and-updates-design.md.

/** Where `npm run desktop:package` writes (electron-builder's directories.output
 *  under the --project dir). Pinned against both files by ci-workflow.test.mjs. */
export const INSTALLER_DIR = "desktop/release";
export const LATEST_YML = "latest.yml";

const SEMVER_RE = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

/** The file electron-builder's artifactName produces for `version`. */
export function installerName(version) {
  if (typeof version !== "string" || !SEMVER_RE.test(version)) {
    throw new Error(`version "${version}" is not a plain semver string (expected to match ${SEMVER_RE})`);
  }
  return `aipm-cockpit-${version}-setup.exe`;
}

/** Exactly the files a release carries, in upload order. */
export function expectedAssets(version) {
  const exe = installerName(version);
  return [exe, `${exe}.blockmap`, LATEST_YML];
}

export function releaseTitle(version, milestone) {
  if (typeof milestone !== "string" || milestone.trim() === "") {
    throw new Error("milestone is empty — src/app/version.ts's APP_MILESTONE shape moved");
  }
  installerName(version); // validates the version
  return `AI PM Cockpit ${version} "${milestone}"`;
}

/** The body of `## [<version>] …` up to the next `## ` heading, trimmed; null when absent. */
export function changelogSection(changelog, version) {
  const lines = changelog.split(/\r?\n/);
  const head = `## [${version}]`;
  const start = lines.findIndex((l) => l === head || l.startsWith(`${head} `));
  if (start < 0) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => l.startsWith("## "));
  return (end < 0 ? rest : rest.slice(0, end)).join("\n").trim();
}

export const UNSIGNED_NOTICE = [
  "---",
  "",
  "The installer is not code-signed, so Windows SmartScreen shows a prompt on first run:",
  "**More info → Run anyway**. It installs for the current user and needs no admin rights.",
  "Installed copies from 1.14.0 on check this page for updates and ask before installing one.",
  "Verify a download with `gh attestation verify <file> --repo sebastianmaute/aipm-cockpit`.",
].join("\n");

export function releaseNotes(changelog, version) {
  const section = changelogSection(changelog, version);
  if (section === null || section === "") {
    throw new Error(`CHANGELOG.md has no section "## [${version}]" — add it before tagging`);
  }
  return `${section}\n\n${UNSIGNED_NOTICE}\n`;
}

/** Reads the fixed layout electron-builder writes; throws on anything else. */
export function parseLatestYml(text) {
  const top = (key) => {
    const m = new RegExp(`^${key}: *'?([^'\\r\\n]+)'?\\s*$`, "m").exec(text);
    return m ? m[1].trim() : null;
  };
  const files = [];
  const re = /^ {2}- url: *(\S+)\r?\n {4}sha512: *(\S+)\r?\n {4}size: *(\d+)\s*$/gm;
  for (const m of text.matchAll(re)) files.push({ url: m[1], sha512: m[2], size: Number(m[3]) });
  const version = top("version");
  const path = top("path");
  const sha512 = top("sha512");
  if (!version || !path || !sha512 || files.length === 0) {
    throw new Error("latest.yml is not in electron-builder's layout (version, files[], path, sha512)");
  }
  return { version, path, sha512, size: files[0].size, files };
}

export function checkLatestYml(text, version, installer) {
  let y;
  try {
    y = parseLatestYml(text);
  } catch (e) {
    return [`cannot read latest.yml: ${e instanceof Error ? e.message : String(e)}`];
  }
  const problems = [];
  if (y.version !== version) problems.push(`latest.yml version is ${y.version}, expected ${version}`);
  if (y.path !== installer.name) problems.push(`latest.yml path is ${y.path}, expected ${installer.name}`);
  if (y.sha512 !== installer.sha512) problems.push("latest.yml sha512 does not match the installer");
  if (y.files.length !== 1) problems.push(`latest.yml lists ${y.files.length} files, expected 1`);
  const f = y.files[0];
  if (f.url !== installer.name) problems.push(`latest.yml files[0].url is ${f.url}, expected ${installer.name}`);
  if (f.sha512 !== installer.sha512) problems.push("latest.yml files[0].sha512 does not match the installer");
  if (f.size !== installer.size) problems.push(`latest.yml files[0].size is ${f.size}, the installer is ${installer.size} bytes`);
  return problems;
}

/** `releases`: GitHub's `GET /repos/{r}/releases` items. `expected.assets[].sha256`: lowercase hex. */
export function classifyRelease(releases, expected) {
  const mine = releases.filter((r) => r && r.tag_name === expected.tag);
  if (mine.length === 0) return { state: "absent" };
  if (mine.length > 1) return { state: "conflict", detail: `${mine.length} releases carry ${expected.tag}` };
  const r = mine[0];
  if (r.draft) return { state: "draft", id: r.id };
  if (Boolean(r.prerelease) !== Boolean(expected.prerelease)) {
    return { state: "conflict", detail: `published with prerelease=${Boolean(r.prerelease)}, expected ${Boolean(expected.prerelease)}` };
  }
  const have = new Map((r.assets ?? []).map((a) => [a.name, a]));
  for (const want of expected.assets) {
    const a = have.get(want.name);
    if (!a) return { state: "conflict", detail: `published release lacks ${want.name}` };
    if (a.size !== want.size || a.digest !== `sha256:${want.sha256}`) {
      return { state: "conflict", detail: `published ${want.name} differs (size or sha256)` };
    }
    have.delete(want.name);
  }
  if (have.size > 0) return { state: "conflict", detail: `unexpected file ${[...have.keys()].join(", ")}` };
  return { state: "identical" };
}
```

- [ ] **Step 4: Create `scripts/verify-release-assets.mjs`:**

```js
#!/usr/bin/env node
// Checks a release directory before anything is published.
// Usage: node scripts/verify-release-assets.mjs <dir> <tag>
// Exit: 0 the files are exactly right; 1 they are wrong (named); 2 could not check.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const [dir, tag] = process.argv.slice(2);
try {
  const { expectedAssets, installerName, checkLatestYml, LATEST_YML } = await import("./release-publish-lib.mjs");
  if (!dir || !tag || !tag.startsWith("v")) throw new Error("usage: verify-release-assets.mjs <dir> <tag v…>");
  const version = tag.slice(1);
  const want = expectedAssets(version);
  const have = readdirSync(dir).sort();
  const problems = [];
  for (const f of want) if (!have.includes(f)) problems.push(`missing ${f}`);
  for (const f of have) if (!want.includes(f)) problems.push(`unexpected ${f}`);
  if (problems.length === 0) {
    const exe = installerName(version);
    const bytes = readFileSync(join(dir, exe));
    const installer = { name: exe, sha512: createHash("sha512").update(bytes).digest("base64"), size: statSync(join(dir, exe)).size };
    problems.push(...checkLatestYml(readFileSync(join(dir, LATEST_YML), "utf8"), version, installer));
  }
  if (problems.length > 0) {
    for (const p of problems) console.error(`[release:verify] ${p}`);
    process.exit(1);
  }
  console.log(`[release:verify] ok — ${want.join(", ")} for ${tag}`);
  process.exit(0);
} catch (err) {
  console.error(`[release:verify] CANNOT CHECK: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(2);
}
```

Add to `package.json` `scripts`: `"release:verify": "node scripts/verify-release-assets.mjs"`, and to `scriptsDescriptions`: `"release:verify": "Check a downloaded release directory before publishing: exactly the installer, its blockmap and latest.yml for the tag, with latest.yml's version, path, sha512 and size matching the installer's bytes. Usage: npm run release:verify -- <dir> <tag>. Exit 1 names each problem; exit 2 means it could not check."`. Run `npm run docs:scripts`.

- [ ] **Step 5: Run** the lib tests (EXIT=0), then a CLI smoke: make a temp dir with the three files where `latest.yml` carries a wrong sha512 → `node scripts/verify-release-assets.mjs <dir> v1.14.0; echo "EXIT=$?"` prints the sha512 problems, EXIT=1; with a correct sha512 (compute it with `node -e "console.log(require('crypto').createHash('sha512').update(require('fs').readFileSync('<exe>')).digest('base64'))"`) EXIT=0; with a missing dir EXIT=2.

- [ ] **Step 6: Commit**

```bash
git add scripts/release-publish-lib.mjs scripts/release-publish-lib.test.mjs scripts/verify-release-assets.mjs package.json CONTRIBUTING.md
git commit -m "feat: release library for GitHub Releases and a pre-publish file check"
```

(`release-publish-lib.test.mjs` no longer reads `.gitlab-ci.yml`; its builder cross-check moves to Task 4.)

---

### Task 3: `publish-github-release.mjs`

**Files:**
- Create: `scripts/publish-github-release.mjs`, `scripts/publish-github-release.integration.test.mjs`
- Delete: `scripts/publish-release.mjs`, `scripts/publish-release.integration.test.mjs`
- Modify: `package.json` (`release:publish` → the new script; description), `scripts/gate-local.test.mjs` and `scripts/check-followup-github.mjs` comments that name the deleted files, `npm run docs:scripts`

**Interfaces:**
- Consumes: `expectedAssets`, `releaseTitle`, `releaseNotes`, `classifyRelease` (Task 2); `readSourceFrom`, `SOURCE_FILE` from `scripts/version-sync-lib.mjs`.
- Produces: CLI `node scripts/publish-github-release.mjs <dir> <tag>`; env `GITHUB_REPOSITORY` (owner/repo), `GH_TOKEN`; test hook `PUBLISH_RELEASE_TEST_GH` (path to a fake `gh` node script) honoured only when `VITEST` is set, else exit 2.

★ `classifyRelease` compares each published asset's `digest` (`"sha256:<hex>"`, carried by GitHub's release-asset objects since 2025). Task 10 Step 4 proves the field exists on a real release; if it is absent there, stop and rule — never fall back to size-only matching.

Flow: list releases (`gh api repos/<r>/releases --paginate`) → `classifyRelease`:
- `identical` → exit 0 ("already published").
- `conflict` → exit 1.
- `draft` → `gh api -X DELETE repos/<r>/releases/<id>`, then as `absent`.
- `absent` → `gh release create <tag> <files…> --repo <r> --draft --verify-tag --title <t> --notes-file <f> [--prerelease]`, then `gh release edit <tag> --repo <r> --draft=false`, then list again: must be `identical` → exit 0, else exit 2.
- Any `gh` failure → exit 2.

- [ ] **Step 1: Write the failing integration test** — `scripts/publish-github-release.integration.test.mjs`:

```js
// @vitest-environment node
//
// The real CLI against a fake `gh` (a node script that keeps its state in a JSON file).
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const CLI = join(process.cwd(), "scripts", "publish-github-release.mjs");
const VERSION = /export const APP_VERSION = "([^"]+)"/.exec(readFileSync("src/app/version.ts", "utf8"))[1];
const TAG = `v${VERSION}`;
const EXE = `aipm-cockpit-${VERSION}-setup.exe`;

const FAKE_GH = String.raw`
const fs = require("fs");
const state = JSON.parse(fs.readFileSync(process.env.FAKE_GH_STATE, "utf8"));
const a = process.argv.slice(2);
state.calls.push(a.join(" "));
const save = () => fs.writeFileSync(process.env.FAKE_GH_STATE, JSON.stringify(state));
const sha = (f) => require("crypto").createHash("sha256").update(fs.readFileSync(f)).digest("hex");
if (state.failOn && a.join(" ").includes(state.failOn)) { save(); process.stderr.write("boom"); process.exit(1); }
if (a[0] === "api" && a[1] === "-X" && a[2] === "DELETE") { state.releases = state.releases.filter((r) => !a[3].endsWith("/" + r.id)); save(); process.exit(0); }
if (a[0] === "api") { save(); process.stdout.write(JSON.stringify(state.releases)); process.exit(0); }
if (a[0] === "release" && a[1] === "create") {
  const files = a.slice(3).filter((x, i, all) => !x.startsWith("--") && !(all[i - 1] || "").match(/^--(repo|title|notes-file)$/));
  state.releases.push({ id: 100 + state.releases.length, tag_name: a[2], draft: true, prerelease: a.includes("--prerelease"),
    assets: files.map((f) => ({ name: require("path").basename(f), size: fs.statSync(f).size, digest: state.noDigest ? undefined : "sha256:" + sha(f) })) });
  save(); process.exit(0);
}
if (a[0] === "release" && a[1] === "edit") { state.releases.find((r) => r.tag_name === a[2]).draft = false; save(); process.exit(0); }
save(); process.exit(3);
`;

function setup(state = {}) {
  const root = mkdtempSync(join(tmpdir(), "pub-"));
  const dir = join(root, "release");
  mkdirSync(dir);
  writeFileSync(join(dir, EXE), "exe-bytes");
  writeFileSync(join(dir, `${EXE}.blockmap`), "map");
  writeFileSync(join(dir, "latest.yml"), "yml");
  const gh = join(root, "gh.cjs");
  writeFileSync(gh, FAKE_GH);
  const stateFile = join(root, "state.json");
  writeFileSync(stateFile, JSON.stringify({ calls: [], releases: [], ...state }));
  const run = (env = {}) => spawnSync(process.execPath, [CLI, dir, TAG], {
    encoding: "utf8",
    env: { ...process.env, VITEST: "1", GITHUB_REPOSITORY: "o/r", GH_TOKEN: "t", PUBLISH_RELEASE_TEST_GH: gh, FAKE_GH_STATE: stateFile, ...env },
  });
  const read = () => JSON.parse(readFileSync(stateFile, "utf8"));
  const digest = (name) => "sha256:" + createHash("sha256").update(readFileSync(join(dir, name))).digest("hex");
  return { run, read, digest, dir };
}

describe("publish-github-release.mjs against a fake gh", () => {
  it("creates a draft with the three files, publishes it, and confirms (exit 0)", () => {
    const t = setup();
    const r = t.run();
    expect(r.status, r.stderr).toBe(0);
    const s = t.read();
    expect(s.releases).toHaveLength(1);
    expect(s.releases[0]).toMatchObject({ tag_name: TAG, draft: false });
    expect(s.releases[0].assets.map((a) => a.name)).toEqual([EXE, `${EXE}.blockmap`, "latest.yml"]);
    expect(s.calls.find((c) => c.startsWith("release create"))).toMatch(/--draft --verify-tag/);
  });

  it("deletes a leftover draft and recreates it", () => {
    const t = setup({ releases: [{ id: 5, tag_name: TAG, draft: true, prerelease: false, assets: [] }] });
    expect(t.run().status).toBe(0);
    const s = t.read();
    expect(s.calls).toContain("api -X DELETE repos/o/r/releases/5");
    expect(s.releases.map((x) => x.id)).not.toContain(5);
  });

  it("exits 0 without writing when an identical release is already published", () => {
    const t = setup();
    const files = [EXE, `${EXE}.blockmap`, "latest.yml"];
    const t2 = setup({ releases: [{ id: 9, tag_name: TAG, draft: false, prerelease: VERSION.includes("-"),
      assets: files.map((n) => ({ name: n, size: readFileSync(join(t.dir, n)).length, digest: t.digest(n) })) }] });
    const r = t2.run();
    expect(r.status, r.stderr).toBe(0);
    expect(t2.read().calls.some((c) => c.startsWith("release"))).toBe(false);
  });

  it("refuses (exit 1) a published release with different files", () => {
    const t = setup({ releases: [{ id: 9, tag_name: TAG, draft: false, prerelease: VERSION.includes("-"), assets: [] }] });
    const r = t.run();
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/REFUSED/);
  });

  it("exits 2 when gh fails, and when a published release cannot be confirmed", () => {
    expect(setup({ failOn: "release create" }).run().status).toBe(2);
    expect(setup({ noDigest: true }).run().status).toBe(2);
  });

  it("refuses the fake-gh hook outside vitest (exit 2)", () => {
    const t = setup();
    expect(t.run({ VITEST: "" }).status).toBe(2);
  });
});
```

- [ ] **Step 2: Run** — `npx vitest run scripts/publish-github-release.integration.test.mjs > $TMP/t3.log 2>&1; echo "EXIT=$?"` → EXIT=1 (no CLI yet).

- [ ] **Step 3: Implement `scripts/publish-github-release.mjs`:**

```js
#!/usr/bin/env node
// Creates and publishes the GitHub Release for a tag from a verified release directory.
// Usage: node scripts/publish-github-release.mjs <dir> <tag>   (env GITHUB_REPOSITORY, GH_TOKEN)
// Exit: 0 published, or an identical release already was; 1 REFUSED — a published
// release for the tag differs (immutable releases cannot be fixed in place: publish
// a new version); 2 could not run or could not confirm — safe to re-run.
// ★ Draft first, files, then publish: with immutable releases the files lock at publish.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [dir, tag] = process.argv.slice(2);
const repo = process.env.GITHUB_REPOSITORY;
const say = (m) => console.log(`[release:publish] ${m}`);
const fail = (code, m) => {
  console.error(`[release:publish] ${m}`);
  process.exit(code);
};

let ghBin = "gh";
if (process.env.PUBLISH_RELEASE_TEST_GH) {
  if (!process.env.VITEST) fail(2, "PUBLISH_RELEASE_TEST_GH is a test hook and is refused outside vitest");
  ghBin = process.execPath;
}
const gh = (args) =>
  execFileSync(ghBin, process.env.PUBLISH_RELEASE_TEST_GH ? [process.env.PUBLISH_RELEASE_TEST_GH, ...args] : args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

try {
  if (!dir || !tag || !tag.startsWith("v") || !repo) throw new Error("usage: publish-github-release.mjs <dir> <tag v…> with GITHUB_REPOSITORY set");
  const lib = await import("./release-publish-lib.mjs");
  const { readSourceFrom, SOURCE_FILE } = await import("./version-sync-lib.mjs");
  const version = tag.slice(1);
  const { milestone } = readSourceFrom(readFileSync(SOURCE_FILE, "utf8"));
  const files = lib.expectedAssets(version).map((n) => join(dir, n));
  const expected = {
    tag,
    prerelease: version.includes("-"),
    assets: files.map((f, i) => ({
      name: lib.expectedAssets(version)[i],
      size: statSync(f).size,
      sha256: createHash("sha256").update(readFileSync(f)).digest("hex"),
    })),
  };
  const list = () => JSON.parse(gh(["api", `repos/${repo}/releases`, "--paginate"]) || "[]");

  let verdict = lib.classifyRelease(list(), expected);
  if (verdict.state === "identical") {
    say(`ok — ${tag} is already published with exactly these files`);
    process.exit(0);
  }
  if (verdict.state === "conflict") fail(1, `REFUSED: ${verdict.detail}. Publish a new version instead.`);
  if (verdict.state === "draft") {
    say(`deleting leftover draft ${verdict.id} for ${tag}`);
    gh(["api", "-X", "DELETE", `repos/${repo}/releases/${verdict.id}`]);
  }

  const notesFile = join(mkdtempSync(join(tmpdir(), "notes-")), "notes.md");
  writeFileSync(notesFile, lib.releaseNotes(readFileSync("CHANGELOG.md", "utf8"), version));
  gh([
    "release", "create", tag, ...files, "--repo", repo, "--draft", "--verify-tag",
    "--title", lib.releaseTitle(version, milestone), "--notes-file", notesFile,
    ...(expected.prerelease ? ["--prerelease"] : []),
  ]);
  gh(["release", "edit", tag, "--repo", repo, "--draft=false"]);

  verdict = lib.classifyRelease(list(), expected);
  if (verdict.state !== "identical") fail(2, `published, but could not confirm it (${verdict.state}${verdict.detail ? ": " + verdict.detail : ""})`);
  say(`ok — published ${tag} with ${expected.assets.map((a) => a.name).join(", ")}`);
  process.exit(0);
} catch (err) {
  const detail = err && typeof err === "object" && "stderr" in err ? String(err.stderr).trim() : "";
  fail(2, `CANNOT PUBLISH: ${err instanceof Error ? err.message : String(err)}${detail ? ` — ${detail}` : ""}`);
}
```

Note: the fake gh's `release create` argument filter drops values after `--repo`, `--title`, `--notes-file`; keep the real CLI's argument order as written so the fake parses it.

- [ ] **Step 4: Retire the GitLab publisher.** `git rm scripts/publish-release.mjs scripts/publish-release.integration.test.mjs`. In `package.json` set `"release:publish": "node scripts/publish-github-release.mjs"` and its description to: `"Create and publish the GitHub Release for a tag from a verified release directory (the release workflow's publish job; needs gh, GITHUB_REPOSITORY and GH_TOKEN). Usage: npm run release:publish -- <dir> <tag>. Drafts, uploads the installer, blockmap and latest.yml, then publishes; a leftover draft is deleted and recreated. Exit 0 = published or already identical; 1 = REFUSED, a published release differs (publish a new version); 2 = could not run or confirm, safe to re-run."`. Update the comment in `scripts/gate-local.test.mjs` to name `scripts/publish-github-release.integration.test.mjs`, and in `scripts/check-followup-github.mjs` replace "see publish-release.mjs for the measured" with a self-contained sentence (the measured case: a trailing-slash strip written as a regex is quadratic on a long run of slashes). Run `npm run docs:scripts`.

- [ ] **Step 5: Run** the integration test (EXIT=0), then `npm run docs:scripts:check` and `npx eslint --max-warnings=0 scripts` (each unpiped, EXIT=0).

- [ ] **Step 6: Commit**

```bash
git add -A scripts/publish-github-release.mjs scripts/publish-github-release.integration.test.mjs scripts/publish-release.mjs scripts/publish-release.integration.test.mjs scripts/gate-local.test.mjs scripts/check-followup-github.mjs package.json CONTRIBUTING.md
git commit -m "feat: publish GitHub Releases through gh; retire the GitLab publisher"
```

---

### Task 4: `release.yml`, the builder's `publish:` block, and retiring `.gitlab-ci.yml`

**Files:**
- Create: `.github/workflows/release.yml`
- Modify: `desktop/electron-builder.yml` (top-level `publish:`), `scripts/ci-workflow.test.mjs`
- Delete: `.gitlab-ci.yml`; migrate `scripts/doc-claims-lib.test.mjs`'s `.gitlab-ci.yml` fixtures
- Modify: any doc `path:LINE` citation into `.gitlab-ci.yml` that `docs:claims:check` then reports

**Interfaces:**
- Consumes: `INSTALLER_DIR`, `installerName`, `expectedAssets` (Task 2); `npm run release:verify`, `npm run release:publish` (Tasks 2–3); `jobIds`, `jobBlock`, `unpinnedUses`, `topLevelBlock` from `scripts/ci-workflow-lib.mjs`.

- [ ] **Step 1: Resolve the attestation action's pin.** Run `gh api repos/actions/attest-build-provenance/releases/latest --jq .tag_name` then `git ls-remote https://github.com/actions/attest-build-provenance "refs/tags/<tag>^{}" "refs/tags/<tag>"` and take the commit SHA (the `^{}` line when present). Use it as `<ATTEST_SHA>` with `# <tag>` below.

- [ ] **Step 2: Write the failing structure tests** — in `scripts/ci-workflow.test.mjs`, add `const RELEASE = read(".github/workflows/release.yml");` beside the other reads, import `{ INSTALLER_DIR, installerName, expectedAssets } from "./release-publish-lib.mjs"`, and add:

```js
describe("release.yml", () => {
  workflowRules("release.yml", RELEASE);

  it("runs on v* tags only", () => {
    // topLevelBlock returns the block's lines trimmed, blanks dropped.
    expect(topLevelBlock(RELEASE, "on")).toEqual(["push:", "tags:", '- "v*"']);
  });

  it("has guard, build, publish, chained in that order", () => {
    expect(jobIds(RELEASE)).toEqual(["guard", "build", "publish"]);
    expect(jobBlock(RELEASE, "build")).toMatch(/^\s+needs: guard$/m);
    expect(jobBlock(RELEASE, "publish")).toMatch(/^\s+needs: \[guard, build\]$/m);
  });

  it("reads by default, and only publish can write", () => {
    expect(topLevelBlock(RELEASE, "permissions")).toEqual(["contents: read"]);
    for (const id of ["guard", "build"]) expect(jobBlock(RELEASE, id)).not.toMatch(/permissions:|: write/);
    const pub = jobBlock(RELEASE, "publish");
    expect(pub).toMatch(/permissions:\n\s+contents: write\n\s+id-token: write\n\s+attestations: write/);
  });

  it("publish runs in the release environment and installs no packages", () => {
    const pub = jobBlock(RELEASE, "publish");
    expect(pub).toMatch(/^\s+environment: release$/m);
    expect(pub).not.toMatch(/npm (ci|install|i )|npx /);
    expect(pub).toMatch(/npm run release:verify -- /);
    expect(pub).toMatch(/npm run release:publish -- /);
  });

  it("attests only on a public repository", () => {
    expect(jobBlock(RELEASE, "publish")).toMatch(/if: \$\{\{ !github\.event\.repository\.private \}\}\n\s+uses: actions\/attest-build-provenance@/);
  });

  it("guards the tag against APP_VERSION and main before building", () => {
    const g = jobBlock(RELEASE, "guard");
    expect(g).toMatch(/node scripts\/check-tag-version\.mjs "\$TAG"/);
    expect(g).toMatch(/git merge-base --is-ancestor "\$GITHUB_SHA" origin\/main/);
  });

  it("every job has a timeout", () => {
    for (const id of jobIds(RELEASE)) expect(jobBlock(RELEASE, id)).toMatch(/^\s+timeout-minutes: \d+$/m);
  });

  it("builds on windows and uploads exactly the files the builder writes and publish expects", () => {
    const b = jobBlock(RELEASE, "build");
    expect(b).toMatch(/^\s+runs-on: windows-latest$/m);
    const V = "${{ needs.guard.outputs.version }}";
    const paths = [...b.matchAll(/^\s+(desktop\/release\/\S+)$/gm)].map((m) => m[1].replaceAll(V, "9.9.9"));
    expect(paths).toEqual(expectedAssets("9.9.9").map((f) => `${INSTALLER_DIR}/${f}`));
  });
});

describe("electron-builder.yml agrees with the release library", () => {
  const eb = read("desktop/electron-builder.yml");
  it("writes installerName() into INSTALLER_DIR, with no nested artifactName", () => {
    const name = /^artifactName:\s*["']?([^"'\s]+)/m.exec(eb)?.[1];
    expect(name?.replace(/\$\{version\}/g, "9.9.9")).toBe(installerName("9.9.9"));
    expect(/^\s+artifactName:/m.test(eb)).toBe(false);
    const pkg = JSON.parse(read("package.json"));
    const project = /--project\s+(\S+)/.exec(pkg.scripts["desktop:package"])?.[1];
    const output = /^directories:\n\s+output:\s*(\S+)/m.exec(eb)?.[1];
    expect(`${project}/${output}`).toBe(INSTALLER_DIR);
  });
  it("publishes to this repository on GitHub", () => {
    expect(eb).toMatch(/^publish:\n\s+provider: github\n\s+owner: sebastianmaute\n\s+repo: aipm-cockpit$/m);
  });
});
```

If `workflowRules` is defined after the `describe` blocks that use it in the file, place this block after it. Run: `npx vitest run scripts/ci-workflow.test.mjs > $TMP/t4.log 2>&1; echo "EXIT=$?"` → EXIT=1 (no release.yml).

- [ ] **Step 3: Write `.github/workflows/release.yml`** (substitute `<ATTEST_SHA>`/`<ATTEST_TAG>` from Step 1; the other SHAs are the ones `ci.yml` already pins):

```yaml
# Builds and publishes a desktop release when a v* tag is pushed.
# Design: docs/superpowers/specs/2026-09-24-releases-and-updates-design.md
# ★ Only `publish` can write, it installs no packages, and it waits for the owner's approval
#   (environment `release`). The installer is unsigned, so this gate is what stands in front of
#   every installed copy's auto-update.
name: release

on:
  push:
    tags:
      - "v*"

permissions:
  contents: read

concurrency:
  group: release-${{ github.ref }}
  cancel-in-progress: false

env:
  NEXT_TELEMETRY_DISABLED: "1"

jobs:
  guard:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    outputs:
      version: ${{ steps.v.outputs.version }}
      prerelease: ${{ steps.v.outputs.prerelease }}
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          fetch-depth: 0
          persist-credentials: false
      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with:
          node-version: "24"
      - name: The tag names APP_VERSION
        env:
          TAG: ${{ github.ref_name }}
        run: node scripts/check-tag-version.mjs "$TAG"
      - name: The tagged commit is on main
        shell: bash
        run: git merge-base --is-ancestor "$GITHUB_SHA" origin/main
      - id: v
        shell: bash
        env:
          TAG: ${{ github.ref_name }}
        run: |
          v="${TAG#v}"
          echo "version=$v" >> "$GITHUB_OUTPUT"
          if [[ "$v" == *-* ]]; then echo "prerelease=true" >> "$GITHUB_OUTPUT"; else echo "prerelease=false" >> "$GITHUB_OUTPUT"; fi

  build:
    needs: guard
    runs-on: windows-latest
    timeout-minutes: 45
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with:
          node-version: "24"
          cache: npm
      - run: npm ci
      - name: Standalone app build
        env:
          NEXT_STANDALONE: "1"
        run: npm run build
      - run: npm run desktop:copy-static
      - run: npm --prefix desktop ci
      - run: npm --prefix desktop run build
      - run: npm run desktop:package
      - name: The package holds the three files and no sharp
        shell: bash
        env:
          VERSION: ${{ needs.guard.outputs.version }}
        run: |
          ls -l "desktop/release/aipm-cockpit-$VERSION-setup.exe" "desktop/release/aipm-cockpit-$VERSION-setup.exe.blockmap" desktop/release/latest.yml
          if find desktop/release/win-unpacked -type d -path '*node_modules/sharp' | grep -q .; then
            echo "sharp is inside the package; the extraResources filter stopped working" >&2
            exit 1
          fi
      - uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a # v7.0.1
        with:
          name: release-files
          path: |
            desktop/release/aipm-cockpit-${{ needs.guard.outputs.version }}-setup.exe
            desktop/release/aipm-cockpit-${{ needs.guard.outputs.version }}-setup.exe.blockmap
            desktop/release/latest.yml
          if-no-files-found: error
          retention-days: 7

  publish:
    needs: [guard, build]
    runs-on: ubuntu-latest
    timeout-minutes: 15
    environment: release
    permissions:
      contents: write
      id-token: write
      attestations: write
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with:
          node-version: "24"
      - uses: actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c # v8.0.1
        with:
          name: release-files
          path: ${{ runner.temp }}/release
      - name: Verify the files
        env:
          TAG: ${{ github.ref_name }}
          DIR: ${{ runner.temp }}/release
        run: npm run release:verify -- "$DIR" "$TAG"
      - name: Attest build provenance
        if: ${{ !github.event.repository.private }}
        uses: actions/attest-build-provenance@<ATTEST_SHA> # <ATTEST_TAG>
        with:
          subject-path: ${{ runner.temp }}/release/*
      - name: Attestation skipped (private repository)
        if: ${{ github.event.repository.private }}
        run: echo "Provenance attestation skipped - attestations on a private repository need GitHub Enterprise."
      - name: Publish the GitHub Release
        env:
          GH_TOKEN: ${{ github.token }}
          TAG: ${{ github.ref_name }}
          DIR: ${{ runner.temp }}/release
        run: npm run release:publish -- "$DIR" "$TAG"
```

- [ ] **Step 4: Add the builder's `publish:` block** to `desktop/electron-builder.yml`, top level, directly after `directories:`:

```yaml
# The update feed electron-updater reads: electron-builder writes latest.yml beside the installer
# and embeds this as resources/app-update.yml. `desktop:package` keeps `--publish never`; the release
# workflow's publish job uploads the files (spec 2026-09-24-releases-and-updates-design.md).
publish:
  provider: github
  owner: sebastianmaute
  repo: aipm-cockpit
```

- [ ] **Step 5: Verify locally that `--publish never` still writes `latest.yml`** (spec "to verify"; this machine is Windows): `NEXT_STANDALONE=1 npm run build`, `npm run desktop:copy-static`, `npm --prefix desktop ci`, `npm --prefix desktop run build`, `npm run desktop:package`, each with `echo "EXIT=$?"`. Then `ls desktop/release/latest.yml desktop/release/win-unpacked/resources/app-update.yml` must list both, then copy exactly the installer, its `.blockmap` and `latest.yml` into a fresh temp dir and run `npm run release:verify -- <that dir> v<APP_VERSION>`: EXIT=0 (`desktop/release` itself also holds `win-unpacked` and builder debug files, which verify would rightly call unexpected). If `latest.yml` is absent, stop and report — the workflow design depends on it.

- [ ] **Step 6: Retire `.gitlab-ci.yml`.** `git rm .gitlab-ci.yml`. In `scripts/doc-claims-lib.test.mjs`, the `paths(...)` example and the `resolveCandidates` `sources` fixture are synthetic strings and stay. Only the regression test "indexes root-level config files" reads the real tree: delete its `expect(sources).toContain(".gitlab-ci.yml")` line and reword the comment above it to cite `vitest.config.ts:24` alone (the dotfile case stays covered by the synthetic "resolves a dotfile cited without its leading dot" test). Then `npm run docs:claims:check > $TMP/dc.log 2>&1; echo "EXIT=$?"`: for each citation into `.gitlab-ci.yml` it reports, rewrite the doc sentence to name the removed job in prose (e.g. "the former GitLab `desktop-package-tag` job") without a line number. Do NOT re-baseline to admit anything.

- [ ] **Step 7: Run** `npx vitest run scripts/ > $TMP/t4b.log 2>&1; echo "EXIT=$?"` (EXIT=0), `npm run docs:claims:check`, `npm run docs:symbols:check`, `npx eslint --max-warnings=0 scripts`, and actionlint on the new file: `docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint@sha256:b1934ee5f1c509618f2508e6eb47ee0d3520686341fec936f3b79331f9315667 .github/workflows/release.yml` (if Docker is unavailable, note it; CI's static job runs actionlint over every workflow).

- [ ] **Step 8: Commit**

```bash
git add .github/workflows/release.yml desktop/electron-builder.yml scripts/ci-workflow.test.mjs scripts/doc-claims-lib.test.mjs docs
git commit -m "feat: tag-triggered release workflow on GitHub Actions; retire .gitlab-ci.yml"
```

---

### Task 5: Typecheck the desktop shell in CI

**Files:**
- Create: `scripts/check-desktop-types.mjs`
- Modify: `package.json` (`desktop:typecheck` + description), `scripts/gate-local.mjs`, `.github/workflows/ci.yml` (static job), `docs/AGENTS/ci.md` (static job description)

Why: `desktop/src/main.ts` (and Task 6's `updater.ts`) are excluded from the root `tsc`, so today they are typechecked only when a release is built. A type error would first appear on a tag.

- [ ] **Step 1: Create `scripts/check-desktop-types.mjs`:**

```js
#!/usr/bin/env node
// Typechecks desktop/ (tsc -p desktop/tsconfig.json --noEmit), which the root tsc excludes.
// Needs desktop/node_modules (electron's and electron-updater's types). Missing: locally a
// visible SKIP (exit 0); under CI (env CI set) exit 2, so a workflow that forgot
// `npm --prefix desktop ci` cannot pass by skipping.
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";

if (!existsSync("desktop/node_modules/electron/package.json")) {
  if (process.env.CI) {
    console.error("[desktop:typecheck] CANNOT CHECK: desktop/node_modules is missing (run npm --prefix desktop ci)");
    process.exit(2);
  }
  console.log("[desktop:typecheck] SKIPPED: desktop/node_modules is missing (npm --prefix desktop ci to enable)");
  process.exit(0);
}
const r = spawnSync("npx", ["tsc", "-p", "desktop/tsconfig.json", "--noEmit"], { stdio: "inherit", shell: process.platform === "win32" });
process.exit(r.status === 0 ? 0 : r.status === null ? 2 : 1);
```

`package.json`: `"desktop:typecheck": "node scripts/check-desktop-types.mjs"`; description: `"Typecheck the Electron shell (desktop/tsconfig.json), which the root tsc excludes. Needs desktop/node_modules: locally it SKIPS visibly without them, under CI it exits 2. Exit 1 = type errors."`. `npm run docs:scripts`.

- [ ] **Step 2: Wire it.** In `scripts/gate-local.mjs` add `s("static", ["npm", "run", "desktop:typecheck"]),` after the `npx tsc --noEmit` step. In `.github/workflows/ci.yml` `static` job, directly after `- run: npm ci`, add:

```yaml
      # desktop:typecheck needs electron's types; the binary itself is not needed.
      - run: npm --prefix desktop ci --ignore-scripts
```

In `docs/AGENTS/ci.md`'s `static` bullet, mention the desktop install and `desktop:typecheck`.

- [ ] **Step 3: Run** `npm --prefix desktop ci --ignore-scripts`, then `npm run desktop:typecheck; echo "EXIT=$?"` → 0 (fix any real type error it finds in `desktop/src` in this task). Then `npx vitest run scripts/gate-local.test.mjs scripts/ci-workflow.test.mjs > $TMP/t5.log 2>&1; echo "EXIT=$?"` → 0; `npm run docs:scripts:check` → 0.

- [ ] **Step 4: Commit**

```bash
git add scripts/check-desktop-types.mjs scripts/gate-local.mjs .github/workflows/ci.yml docs/AGENTS/ci.md package.json CONTRIBUTING.md
git commit -m "ci: typecheck the desktop shell in the static gates"
```

---

### Task 6: Auto-update in the desktop app

**Files:**
- Create: `desktop/src/lib/update-policy.ts`, `desktop/src/lib/update-policy.test.ts`, `desktop/src/updater.ts`
- Modify: `desktop/src/lib/menu-model.ts` (+ `menu-model.test.ts`), `desktop/src/main.ts`, `desktop/src/lib/constants.ts` (comment only), `desktop/package.json` + `desktop/package-lock.json`, root `tsconfig.json` (`exclude`), CONTRIBUTING "Dependencies" (add `electron-updater`)

**Interfaces:**
- Produces from `update-policy.ts`:
  - `STARTUP_CHECK_DELAY_MS = 10_000`
  - `type UpdateTrigger = "startup" | "manual"`
  - `type UpdateDecision = {kind:"silent"} | {kind:"prompt"; version:string; notes:string} | {kind:"up-to-date"} | {kind:"error"; message:string}`
  - `shouldStartCheck(inFlight: boolean): boolean`
  - `decideOnAvailable(trigger, available: {version:string; releaseNotes?: unknown}, skipped: string|null): UpdateDecision`
  - `decideOnNotAvailable(trigger): UpdateDecision`
  - `decideOnError(trigger, err: unknown): UpdateDecision`
  - `notesToPlainText(notes: unknown, max = 1500): string`
  - `parseSkipped(text: string|null): string|null`, `serializeSkipped(version: string): string`
- Produces from `updater.ts`: `createUpdater(deps: {log(line:string):void; window(): BrowserWindow|null}): {check(trigger: UpdateTrigger): void}`
- `HelpMenuAction` `"open-releases"` → `"check-for-updates"`.

- [ ] **Step 1: Write the failing policy tests** — `desktop/src/lib/update-policy.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  STARTUP_CHECK_DELAY_MS, decideOnAvailable, decideOnError, decideOnNotAvailable,
  notesToPlainText, parseSkipped, serializeSkipped, shouldStartCheck,
} from "./update-policy";

describe("update policy", () => {
  it("waits 10 s after start", () => expect(STARTUP_CHECK_DELAY_MS).toBe(10_000));

  it("never starts a second check while one is running", () => {
    expect(shouldStartCheck(false)).toBe(true);
    expect(shouldStartCheck(true)).toBe(false);
  });

  it("prompts for an available version, with plain-text notes", () => {
    expect(decideOnAvailable("startup", { version: "1.14.1", releaseNotes: "<p>Fixes <b>x</b></p>" }, null)).toEqual({
      kind: "prompt", version: "1.14.1", notes: "Fixes x",
    });
  });

  it("stays silent at startup for a skipped version, but a manual check still offers it", () => {
    expect(decideOnAvailable("startup", { version: "1.14.1" }, "1.14.1")).toEqual({ kind: "silent" });
    expect(decideOnAvailable("manual", { version: "1.14.1" }, "1.14.1").kind).toBe("prompt");
    expect(decideOnAvailable("startup", { version: "1.14.2" }, "1.14.1").kind).toBe("prompt");
  });

  it("reports up to date and errors only for a manual check", () => {
    expect(decideOnNotAvailable("startup")).toEqual({ kind: "silent" });
    expect(decideOnNotAvailable("manual")).toEqual({ kind: "up-to-date" });
    expect(decideOnError("startup", new Error("404"))).toEqual({ kind: "silent" });
    expect(decideOnError("manual", new Error("net::ERR_INTERNET_DISCONNECTED"))).toEqual({
      kind: "error", message: "net::ERR_INTERNET_DISCONNECTED",
    });
    expect(decideOnError("manual", "x".repeat(500))).toMatchObject({ kind: "error", message: expect.stringMatching(/…$/) });
  });

  it("turns any notes shape into bounded plain text", () => {
    expect(notesToPlainText(undefined)).toBe("No release notes.");
    expect(notesToPlainText("")).toBe("No release notes.");
    expect(notesToPlainText([{ version: "1.14.1", note: "<ul><li>A</li><li>B &amp; C</li></ul>" }])).toBe("A\nB & C");
    expect(notesToPlainText("<h2>T</h2>\n\n\n\n<p>x</p>")).toBe("T\n\nx");
    const long = notesToPlainText("y".repeat(5000));
    expect(long.length).toBe(1500);
    expect(long.endsWith("…")).toBe(true);
  });

  it("reads and writes the skipped version, tolerating junk", () => {
    expect(parseSkipped(serializeSkipped("1.14.1"))).toBe("1.14.1");
    expect(parseSkipped(null)).toBeNull();
    expect(parseSkipped("{not json")).toBeNull();
    expect(parseSkipped('{"skippedVersion":42}')).toBeNull();
  });
});
```

Run: `npx vitest run desktop/src/lib/update-policy.test.ts > $TMP/t6.log 2>&1; echo "EXIT=$?"` → EXIT=1.

- [ ] **Step 2: Implement `desktop/src/lib/update-policy.ts`:**

```ts
// What the updater does, decided without Electron so it is unit-testable (the wiring is
// desktop/src/updater.ts). Spec: docs/superpowers/specs/2026-09-24-releases-and-updates-design.md §2.
export const STARTUP_CHECK_DELAY_MS = 10_000;
const NOTES_MAX = 1500;
const ERROR_MAX = 300;

export type UpdateTrigger = "startup" | "manual";
export type UpdateDecision =
  | { kind: "silent" }
  | { kind: "prompt"; version: string; notes: string }
  | { kind: "up-to-date" }
  | { kind: "error"; message: string };

export function shouldStartCheck(inFlight: boolean): boolean {
  return !inFlight;
}

export function decideOnAvailable(
  trigger: UpdateTrigger,
  available: { version: string; releaseNotes?: unknown },
  skipped: string | null,
): UpdateDecision {
  if (trigger === "startup" && skipped === available.version) return { kind: "silent" };
  return { kind: "prompt", version: available.version, notes: notesToPlainText(available.releaseNotes) };
}

export function decideOnNotAvailable(trigger: UpdateTrigger): UpdateDecision {
  return trigger === "manual" ? { kind: "up-to-date" } : { kind: "silent" };
}

export function decideOnError(trigger: UpdateTrigger, err: unknown): UpdateDecision {
  if (trigger !== "manual") return { kind: "silent" };
  return { kind: "error", message: clip(err instanceof Error ? err.message : String(err), ERROR_MAX) };
}

function clip(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

export function notesToPlainText(notes: unknown, max = NOTES_MAX): string {
  const raw = Array.isArray(notes)
    ? notes.map((n) => (n && typeof n === "object" && "note" in n ? String((n as { note: unknown }).note ?? "") : "")).join("\n")
    : typeof notes === "string"
      ? notes
      : "";
  const text = raw
    .replace(/<\/(p|li|h[1-6]|div)>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .split("\n").map((l) => l.trim()).join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text === "" ? "No release notes." : clip(text, max);
}

export function parseSkipped(text: string | null): string | null {
  if (text === null) return null;
  try {
    const v = (JSON.parse(text) as { skippedVersion?: unknown }).skippedVersion;
    return typeof v === "string" ? v : null;
  } catch {
    return null;
  }
}

export function serializeSkipped(version: string): string {
  return JSON.stringify({ skippedVersion: version });
}
```

Run the test → EXIT=0.

- [ ] **Step 3: Menu model.** In `menu-model.ts` change the union to `"open-help" | "show-version" | "check-for-updates"` and `updates: "check-for-updates"`; rewrite the "Check for updates…" ordering comment's reason ("the only entry that leaves the app for an external browser") to: it is the only entry that talks to the network. In `menu-model.test.ts` change every `"open-releases"` expectation to `"check-for-updates"`; the `RELEASES_URL` ⇄ `APP_RELEASES_URL` equality test stays. Run `npx vitest run desktop/src/lib/menu-model.test.ts` → EXIT=0.

- [ ] **Step 4: Dependency.** `npm view electron-updater version` → `<X>`; `npm --prefix desktop install electron-updater@<X> --save-exact`. `desktop/package.json` gains `"dependencies": { "electron-updater": "<X>" }`. Add `electron-updater` to CONTRIBUTING's exact-pinned list sentence (desktop packages: `electron`, `electron-builder`, `electron-updater`). Add `"desktop/src/updater.ts"` to root `tsconfig.json` `exclude`.

- [ ] **Step 5: Create `desktop/src/updater.ts`:**

```ts
// electron-updater wired to the pure policy in lib/update-policy.ts. Checks only in a packaged
// build; nothing downloads or installs without the user's click. Excluded from the root tsc
// like main.ts; typechecked by `npm run desktop:typecheck`.
import { app, dialog, shell, type BrowserWindow } from "electron";
import { autoUpdater } from "electron-updater";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { RELEASES_URL } from "./lib/constants";
import {
  decideOnAvailable, decideOnError, decideOnNotAvailable, parseSkipped, serializeSkipped,
  shouldStartCheck, type UpdateDecision, type UpdateTrigger,
} from "./lib/update-policy";

export interface Updater {
  check(trigger: UpdateTrigger): void;
}

export function createUpdater(deps: { log(line: string): void; window(): BrowserWindow | null }): Updater {
  const skipFile = () => join(app.getPath("userData"), "update-skip.json");
  const readSkipped = (): string | null => {
    try {
      return parseSkipped(readFileSync(skipFile(), "utf8"));
    } catch {
      return null;
    }
  };
  let inFlight = false;
  let trigger: UpdateTrigger = "startup";

  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = false;
  autoUpdater.allowDowngrade = false;
  autoUpdater.logger = {
    info: (m: unknown) => deps.log(`updater: ${String(m)}`),
    warn: (m: unknown) => deps.log(`updater warn: ${String(m)}`),
    error: (m: unknown) => deps.log(`updater error: ${String(m)}`),
    debug: () => {},
  };

  const box = async (opts: Electron.MessageBoxOptions): Promise<number> => {
    const w = deps.window();
    const r = w && !w.isDestroyed() ? await dialog.showMessageBox(w, opts) : await dialog.showMessageBox(opts);
    return r.response;
  };
  const act = async (d: UpdateDecision): Promise<void> => {
    if (d.kind === "silent") return;
    if (d.kind === "up-to-date") {
      await box({ type: "info", title: "AI PM Cockpit", message: `You have the latest version (${app.getVersion()}).`, buttons: ["OK"] });
      return;
    }
    if (d.kind === "error") {
      const r = await box({ type: "warning", title: "AI PM Cockpit", message: "Could not check for updates.", detail: d.message, buttons: ["OK", "Open releases page"], defaultId: 0, cancelId: 0 });
      if (r === 1) void shell.openExternal(RELEASES_URL).catch((e: unknown) => deps.log(`open releases page: ${String(e)}`));
      return;
    }
    const r = await box({
      type: "info", title: "Update available", message: `AI PM Cockpit ${d.version} is available.`, detail: d.notes,
      buttons: ["Download and install", "Later", "Skip this version"], defaultId: 0, cancelId: 1,
    });
    if (r === 2) {
      try { writeFileSync(skipFile(), serializeSkipped(d.version)); } catch (e: unknown) { deps.log(`updater skip write: ${String(e)}`); }
      return;
    }
    if (r !== 0) return;
    inFlight = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.downloadUpdate().catch((e: unknown) => deps.log(`updater download: ${String(e)}`));
  };

  autoUpdater.on("update-available", (info) => {
    inFlight = false;
    void act(decideOnAvailable(trigger, info, readSkipped()));
  });
  autoUpdater.on("update-not-available", () => {
    inFlight = false;
    void act(decideOnNotAvailable(trigger));
  });
  autoUpdater.on("error", (err) => {
    inFlight = false;
    deps.window()?.setProgressBar(-1);
    void act(decideOnError(trigger, err));
  });
  autoUpdater.on("download-progress", (p) => deps.window()?.setProgressBar(p.percent / 100));
  autoUpdater.on("update-downloaded", (info) => {
    inFlight = false;
    deps.window()?.setProgressBar(-1);
    void box({
      type: "info", title: "Update ready", message: `AI PM Cockpit ${info.version} is ready to install.`,
      buttons: ["Restart now", "On next quit"], defaultId: 0, cancelId: 1,
    }).then((r) => {
      // quitAndInstall goes through app.quit(), so before-quit (killServer) and the window's own
      // close handling run first; isSilent=true reuses the existing per-user install directory.
      if (r === 0) setImmediate(() => autoUpdater.quitAndInstall(true, true));
    });
  });

  return {
    check(t: UpdateTrigger): void {
      if (!app.isPackaged) {
        if (t === "manual") void box({ type: "info", title: "AI PM Cockpit", message: "Updates are checked only in the installed app.", buttons: ["OK"] });
        return;
      }
      if (!shouldStartCheck(inFlight)) {
        deps.log(`updater: ${t} check ignored, one is already running`);
        return;
      }
      inFlight = true;
      trigger = t;
      autoUpdater.checkForUpdates().catch((e: unknown) => deps.log(`updater check: ${String(e)}`));
    },
  };
}
```

- [ ] **Step 6: Wire `main.ts`.**
  - Import `import { createUpdater, type Updater } from "./updater";` and `import { STARTUP_CHECK_DELAY_MS } from "./lib/update-policy";`; drop `RELEASES_URL` from the constants import if nothing else uses it.
  - Module scope: `let updater: Updater | null = null;`
  - In `start()`, first line: `updater = createUpdater({ log, window: () => (win && !win.isDestroyed() ? win : null) });` and after `await win.loadURL(APP_ORIGIN);`: `setTimeout(() => updater?.check("startup"), STARTUP_CHECK_DELAY_MS);`
  - In `helpMenuClick`, replace `case "open-releases": return openReleasesPage;` with `case "check-for-updates": return () => updater?.check("manual");`.
  - Delete `openReleasesPage()` and its comment block; update the other comment that counts `shell.openExternal` call sites so it names the updater's "Open releases page" button instead of the Help menu item.
- [ ] **Step 7: Rewrite the `RELEASES_URL` comment** in `constants.ts`: it is the page the updater's error dialog offers and the Version panel links to; the in-app updater reads the public GitHub Releases feed (`latest.yml`) configured in `electron-builder.yml`'s `publish:` block; the installer is unsigned, so publishing is gated by an owner approval (release workflow). Keep the value unchanged.

- [ ] **Step 8: Run** `npx vitest run desktop/ > $TMP/t6b.log 2>&1; echo "EXIT=$?"` (0), `npm run desktop:typecheck` (0, with desktop deps installed), `npx tsc --noEmit` (0), `npx eslint --max-warnings=0 desktop scripts` (0).

- [ ] **Step 9: Commit**

```bash
git add desktop/src tsconfig.json desktop/package.json desktop/package-lock.json CONTRIBUTING.md
git commit -m "feat(desktop): ask-then-install auto-update from GitHub Releases"
```

---

### Task 7: Dependabot for npm

**Files:**
- Modify: `.github/dependabot.yml`
- Create: `scripts/dependabot-config.test.mjs`

- [ ] **Step 1: Write the failing test** — `scripts/dependabot-config.test.mjs`:

```js
// @vitest-environment node
// Every exactly pinned (framework-coupled) package stays out of Dependabot's grouped PRs, so each
// arrives alone for a human decision (CONTRIBUTING "Dependencies"). The pinned set is DERIVED from
// each package.json, so a newly pinned package fails here until it is excluded too.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const pinned = (pkgPath) => {
  const p = JSON.parse(read(pkgPath));
  return Object.entries({ ...p.dependencies, ...p.devDependencies }).filter(([, v]) => /^\d/.test(v)).map(([k]) => k).sort();
};
const YML = read(".github/dependabot.yml");
const entry = (dir) => {
  const blocks = YML.split(/\n  - package-ecosystem: /).slice(1);
  return blocks.find((b) => b.startsWith("npm") && new RegExp(`\\n    directory: ${dir.replace("/", "\\/")}\\n`).test(b));
};
const excluded = (block) => [...block.matchAll(/exclude-patterns: \[([^\]]*)\]/g)].flatMap((m) => m[1].split(",").map((s) => s.trim().replace(/"/g, ""))).sort();

describe("dependabot.yml", () => {
  it("covers github-actions, root npm and desktop npm, weekly", () => {
    expect(YML).toMatch(/- package-ecosystem: github-actions\n    directory: \//);
    expect(entry("/")).toBeTruthy();
    expect(entry("/desktop")).toBeTruthy();
    expect(YML.match(/interval: weekly/g)).toHaveLength(3);
  });
  it("groups minor and patch only", () => {
    for (const d of ["/", "/desktop"]) expect(entry(d)).toMatch(/update-types: \[minor, patch\]/);
  });
  it("excludes every exactly pinned package from the group", () => {
    expect(excluded(entry("/"))).toEqual(expect.arrayContaining(pinned("package.json")));
    expect(excluded(entry("/desktop"))).toEqual(expect.arrayContaining(pinned("desktop/package.json")));
    expect(pinned("desktop/package.json")).toContain("electron-updater");
  });
});
```

Run → EXIT=1.

- [ ] **Step 2: Write `.github/dependabot.yml`** — list the root pinned set with CONTRIBUTING's command (`node -e "…"` under "Dependencies") and put every name in the root `exclude-patterns`:

```yaml
# Weekly updates. Minor and patch versions arrive as one grouped PR per npm directory; majors and
# every exactly pinned framework package (CONTRIBUTING "Dependencies") arrive one PR each, for a
# human decision. scripts/dependabot-config.test.mjs derives the pinned set from each package.json.
# Container digests (semgrep, actionlint) are not covered; re-resolve them by hand.
version: 2
updates:
  - package-ecosystem: github-actions
    directory: /
    schedule:
      interval: weekly
    groups:
      actions:
        patterns: ["*"]
  - package-ecosystem: npm
    directory: /
    schedule:
      interval: weekly
    groups:
      npm-minor-patch:
        update-types: [minor, patch]
        exclude-patterns: [next, react, react-dom, eslint-config-next]
  - package-ecosystem: npm
    directory: /desktop
    schedule:
      interval: weekly
    groups:
      desktop-minor-patch:
        update-types: [minor, patch]
        exclude-patterns: [electron, electron-builder, electron-updater]
```

(Extend the root list if the command prints more names.)

- [ ] **Step 3: Run** the test (EXIT=0) and `npx vitest run scripts/ci-workflow.test.mjs` (EXIT=0).

- [ ] **Step 4: Commit**

```bash
git add .github/dependabot.yml scripts/dependabot-config.test.mjs
git commit -m "ci: grouped weekly Dependabot updates for both npm directories"
```

---

### Task 8: Repository hardening and `SECURITY.md` (controller task; some steps need the owner)

**Files:** Create `SECURITY.md`. Everything else is repository settings via `gh api`. If the permission classifier blocks a settings write, stop and hand that exact command to the owner (`! <command>`); do not look for another route.

- [ ] **Step 1: `SECURITY.md`:**

```markdown
# Security policy

## Supported versions

Only the latest release on the [Releases page](https://github.com/sebastianmaute/aipm-cockpit/releases) receives fixes.

## Reporting a vulnerability

Please report privately through GitHub: **Security → Report a vulnerability** on this repository.
Do not open a public issue. You can expect a first answer within a week.

## Verifying a download

The Windows installer is **not code-signed**. Each release's files carry a build-provenance
attestation made by this repository's release workflow. Verify a download with:

    gh attestation verify aipm-cockpit-<version>-setup.exe --repo sebastianmaute/aipm-cockpit

Installed copies check this repository's releases for updates and install one only after you agree.
```

Commit: `git add SECURITY.md && git commit -m "docs: security policy"`.

- [ ] **Step 2: Tag ruleset.** Write to a temp file and apply:

```json
{"name":"release tags","target":"tag","enforcement":"active",
 "conditions":{"ref_name":{"include":["refs/tags/v*"],"exclude":[]}},
 "bypass_actors":[{"actor_id":5,"actor_type":"RepositoryRole","bypass_mode":"always"}],
 "rules":[{"type":"creation"},{"type":"update"},{"type":"deletion"}]}
```

`gh api -X POST repos/sebastianmaute/aipm-cockpit/rulesets --input <file> --jq '.id'`. Verify: `gh api repos/sebastianmaute/aipm-cockpit/rulesets --jq '.[]|"\(.name) \(.target) \(.enforcement)"'` lists `release tags tag active`.

- [ ] **Step 3: Immutable releases.** Probe `gh api -X PUT repos/sebastianmaute/aipm-cockpit/immutable-releases -i 2>&1 | head -1`. 204 → done; verify with `gh api repos/sebastianmaute/aipm-cockpit/immutable-releases`. Anything else → the owner enables it in Settings → General → Releases ("Enable release immutability"); record which path worked in the ledger.

- [ ] **Step 4: Environment `release`.**

```bash
gh api -X PUT repos/sebastianmaute/aipm-cockpit/environments/release --input - <<'EOF'
{"reviewers":[{"type":"User","id":65776548}],"prevent_self_review":false,
 "deployment_branch_policy":{"protected_branches":false,"custom_branch_policies":true}}
EOF
gh api -X POST repos/sebastianmaute/aipm-cockpit/environments/release/deployment-branch-policies -f name='v*' -f type=tag
gh api repos/sebastianmaute/aipm-cockpit/environments/release --jq '{rules:[.protection_rules[].type]}'
```

Expected rules include `required_reviewers` and `branch_policy`. If the reviewer rule is rejected or absent (private-repo plan limit), record it: the rehearsal runs ungated and the reviewer is added at flip step 10a (Task 9 writes that into the checklist).

- [ ] **Step 5: Actions policy.**

```bash
gh api -X PUT repos/sebastianmaute/aipm-cockpit/actions/permissions -F enabled=true -f allowed_actions=selected -F sha_pinning_required=true
gh api -X PUT repos/sebastianmaute/aipm-cockpit/actions/permissions/selected-actions -F github_owned_allowed=true -F verified_allowed=false
gh api repos/sebastianmaute/aipm-cockpit/actions/permissions --jq .
```

Then prove the `docker://` actionlint step still runs: `gh workflow run ci.yml --repo sebastianmaute/aipm-cockpit --ref main`, wait for the run, and confirm the `static` job succeeded (its actionlint step ran). If it fails on the policy, add `-f 'patterns_allowed[]=rhysd/actionlint@*'` to the selected-actions call and re-run; if still refused, revert `allowed_actions` to `all` and record why.

- [ ] **Step 6: Tidy.** `gh api -X PATCH repos/sebastianmaute/aipm-cockpit -F has_projects=false -f homepage=https://github.com/sebastianmaute/aipm-cockpit/releases --jq '{has_projects,homepage}'`.

---

### Task 9: Docs

**Files:** `docs/RUNBOOK.md`, `CONTRIBUTING.md`, `AGENTS.md`, `docs/AGENTS/ci.md`, `docs/desktop-rollout.md`, `docs/superpowers/specs/2026-09-20-github-migration-roadmap.md`, `docs/superpowers/specs/2026-09-23-flip-checklist.md`, `docs/open-followups.md` (§487, §563). `AGENTS.md` and `docs/open-followups.md` are LF; `src/**` CRLF rules do not apply here.

- [ ] **Step 1: RUNBOOK** — replace the paused "Publishing a desktop release" section with "Publishing a desktop release (GitHub)":
  1. Bump `src/app/version.ts` (`APP_VERSION`, `APP_BUILD_DATE`, milestone), `npm run version:sync`, add the `## [<v>] - <date> "<milestone>"` section to `CHANGELOG.md` (publish refuses without it), merge to `main`.
  2. Tag the merge commit: `git tag v<v> <sha> && git push origin v<v>` (only the owner can create `v*` tags).
  3. The `release` workflow runs `guard` → `build` (~20–30 min on Windows) → waits for approval: Actions → the run → "Review deployments" → approve `release`.
  4. `publish` verifies, attests (public repo), drafts, uploads, publishes. Check the release page: three files, notes, not a draft.
  5. Exit codes: `release:verify` 1 = wrong files (fix the build, delete the tag, re-tag after a new commit); `release:publish` 1 = a published release differs (publish a new version), 2 = re-run the job.
  - **Withdrawing a bad release:** releases are immutable. Publish a fixed patch version at once; on the bad one, untick "Set as the latest release" (`gh release edit v<bad> --latest=false` if a newer one exists). Installed copies only move forward (`allowDowngrade` is off).
  - **Rollback of a deployment** stays as it is.
- [ ] **Step 2: CONTRIBUTING** — replace "No releases and no tags are made until releasing moves to GitHub Releases." with a short "Releasing" checklist pointing at the RUNBOOK section; keep the regenerated scripts table (Tasks 1–5 already ran `docs:scripts`).
- [ ] **Step 3: AGENTS.md** — in the "CI is GitHub Actions" bullet, replace the sentences about `.gitlab-ci.yml` staying in the tree and "No releases or tags until then" with: releases run from `.github/workflows/release.yml` on a `v*` tag (guard → build → approval-gated publish); the GitLab pipeline file is gone; the GitLab project is a read-only mirror. In the "Releasing" bullet add: add the CHANGELOG section before tagging; tag only from `main`.
- [ ] **Step 4: docs/AGENTS/ci.md** — add a `release.yml` section (jobs, permissions, environment, the attestation condition, exit codes, the verify/publish scripts). Delete the "Legacy — the GitLab pipeline" section; keep one sentence saying the GitLab pipeline was removed in sub-project 5 and the GitLab project only mirrors GitHub through `ci/gitlab-sync.yml`. Run `npm run docs:symbols:check` and fix any backticked name that no longer exists (use an absence marker from `ABSENCE_MARKERS` where a removed name is mentioned on purpose).
- [ ] **Step 5: docs/desktop-rollout.md** — download from the GitHub Releases page (no sign-in once public); installs from 1.13.x need one manual install of the first release with the updater; after that the app asks before updating; SmartScreen "More info → Run anyway"; optional `gh attestation verify`.
- [ ] **Step 6: Roadmap** — sub-project 5 section: link the spec and this plan; status line.
- [ ] **Step 7: Flip checklist** — replace the last line ("The sub-project 5 steps … slot in before step 10 …") with the order: sub-project 5 merged and rehearsed (Task 10) before step 10; add **step 10a** after step 10:
  - secret scanning + push protection: `gh api -X PATCH repos/sebastianmaute/aipm-cockpit -f 'security_and_analysis[secret_scanning][status]=enabled' -f 'security_and_analysis[secret_scanning_push_protection][status]=enabled'`;
  - CodeQL default setup: `gh api -X PATCH repos/sebastianmaute/aipm-cockpit/code-scanning/default-setup -f state=configured`;
  - private vulnerability reporting: `gh api -X PUT repos/sebastianmaute/aipm-cockpit/private-vulnerability-reporting`;
  - if Task 8 could not set the `release` environment's reviewer while private, set it now (the Task 8 Step 4 command);
  - verify each: `gh api repos/sebastianmaute/aipm-cockpit --jq .security_and_analysis`, `gh api repos/sebastianmaute/aipm-cockpit/code-scanning/default-setup --jq .state`, `gh api repos/sebastianmaute/aipm-cockpit/private-vulnerability-reporting --jq .enabled`;
  - then the first real release and the updater proof (spec §4 rollout steps 4–5).
- [ ] **Step 8: Register §487 and §563** — add a dated paragraph to each (2026-09-2x, owner decision 2026-09-24): auto-update ships unsigned; the guards standing in for signing are the approval-gated publish job, the tag ruleset, immutable releases, provenance attestations and sha512 in `latest.yml`; both entries stay open as the signing follow-up. Update each index row's status column if it summarises the state.
- [ ] **Step 9: Run** `npm run docs:claims:check`, `npm run docs:symbols:check`, `npm run followups:index:check`, `npm run followups:status:check`, `npm run followups:workitems:check`, `LEAK_LIST_FILE=<list> npm run leaks:check` — each unpiped, all 0.
- [ ] **Step 10: Commit** — `git add docs AGENTS.md CONTRIBUTING.md && git commit -m "docs: releasing on GitHub, the updater, and flip step 10a (§487, §563)"`.

---

### Task 10: Private rehearsal (controller + owner; after the PR merges)

Nothing here is automated by a subagent: tags, merges and approvals need the owner's say.

- [ ] **Step 1:** Open the PR for Tasks 1–9; CI green; owner merges.
- [ ] **Step 2:** On a branch: `APP_VERSION = "1.14.0-rc.1"`, `npm run version:sync`, CHANGELOG section `## [1.14.0-rc.1] - <date> "<milestone>"` ("Release pipeline rehearsal; not for use."). PR, green, owner merges. Check the README badge renders (`--` encoding).
- [ ] **Step 3:** Owner tags: `git tag v1.14.0-rc.1 <merge sha> && git push origin v1.14.0-rc.1`. Watch `release`: `guard` ok; `build` ok with the three files; approval (if the environment gate exists); `publish` exit 0 with "Attestation skipped (private repository)".
- [ ] **Step 4:** Verify: `gh release view v1.14.0-rc.1 --json isDraft,isPrerelease,assets --jq '{isDraft,isPrerelease,assets:[.assets[].name]}'` → `isDraft:false`, `isPrerelease:true`, the three names; download them (`gh release download v1.14.0-rc.1 -D <tmp>`) and `npm run release:verify -- <tmp> v1.14.0-rc.1` → 0. Re-run the `publish` job once → exit 0 "already published" (idempotence).
- [ ] **Step 5:** Install the downloaded installer on Windows; the app starts; Help → "Check for updates…" shows the "Could not check" dialog (private feed → 404) with the releases-page button — expected while private.
- [ ] **Step 6:** Clean up: `gh release delete v1.14.0-rc.1 --yes --cleanup-tag` (the owner's admin bypass allows the tag deletion; immutability may refuse deleting a published release — if so, record it and leave the prerelease, which `allowPrerelease: false` hides from updaters). Restore `APP_VERSION` for the next real version in the release PR that follows the flip.
- [ ] **Step 7:** Record the rehearsal (run ids, durations, sizes, which settings needed the owner) in the spec under "Rehearsed <date>", in a docs PR.
