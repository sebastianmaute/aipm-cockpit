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

// A line that starts a markdown block of its own: a list item, heading, quote, fence, table row or rule.
const BLOCK_START_RE = /^\s*(?:[-*+]\s|\d+[.)]\s|#{1,6}\s|>|```|~~~|\||(?:-{3,}|\*{3,})\s*$)/;

/** Joins hard-wrapped lines into one line per paragraph or list item. GitHub renders every newline
 *  in a release body as <br>, and electron-updater hands that HTML to the update dialog, so a
 *  CHANGELOG wrapped at ~100 columns showed as broken lines in both places. Fenced code, headings,
 *  tables and rules pass through unchanged. */
export function unwrapMarkdown(text) {
  const out = [];
  let inFence = false;
  for (const line of text.split("\n")) {
    const isFence = /^\s*(```|~~~)/.test(line);
    if (inFence || isFence) {
      out.push(line);
      if (isFence) inFence = !inFence;
      continue;
    }
    const prev = out.length > 0 ? out[out.length - 1] : "";
    const joinable = line.trim() !== "" && !BLOCK_START_RE.test(line) && prev.trim() !== ""
      && !/^\s*(?:#{1,6}\s|\||(?:-{3,}|\*{3,})\s*$)/.test(prev);
    if (joinable) out[out.length - 1] = `${prev} ${line.trim()}`;
    else out.push(line);
  }
  return out.join("\n");
}

export function releaseNotes(changelog, version) {
  const section = changelogSection(changelog, version);
  if (section === null || section === "") {
    throw new Error(`CHANGELOG.md has no section "## [${version}]" — add it before tagging`);
  }
  return unwrapMarkdown(`${section}\n\n${UNSIGNED_NOTICE}\n`);
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

/** Compares one release's prerelease flag and assets against `expected`. Returns null when they
 *  match, else a detail string naming the first mismatch. Shared by `classifyRelease` (a
 *  published release) and `verifyDraft` (a still-draft one, checked before it is safe to
 *  publish) so the two can never describe the same kind of mismatch differently.
 *  `expected.assets[].sha256`: lowercase hex. */
function releaseMismatch(release, expected) {
  if (Boolean(release.prerelease) !== Boolean(expected.prerelease)) {
    return `prerelease=${Boolean(release.prerelease)}, expected ${Boolean(expected.prerelease)}`;
  }
  const have = new Map((release.assets ?? []).map((a) => [a.name, a]));
  for (const want of expected.assets) {
    const a = have.get(want.name);
    if (!a) return `lacks ${want.name}`;
    if (a.size !== want.size || a.digest !== `sha256:${want.sha256}`) {
      return `${want.name} differs (size or sha256)`;
    }
    have.delete(want.name);
  }
  if (have.size > 0) return `unexpected file ${[...have.keys()].join(", ")}`;
  return null;
}

/** `releases`: GitHub's `GET /repos/{r}/releases` items. */
export function classifyRelease(releases, expected) {
  const mine = releases.filter((r) => r && r.tag_name === expected.tag);
  if (mine.length === 0) return { state: "absent" };
  if (mine.length > 1) return { state: "conflict", detail: `${mine.length} releases carry ${expected.tag}` };
  const r = mine[0];
  if (r.draft) return { state: "draft", id: r.id };
  const mismatch = releaseMismatch(r, expected);
  if (mismatch) return { state: "conflict", detail: `published ${mismatch}` };
  return { state: "identical" };
}

/** After `gh release create`, checks the still-draft release for `expected.tag` carries exactly
 *  the right prerelease flag and assets — BEFORE `gh release edit --draft=false` makes it
 *  immutable. A mismatch caught here is still cheap to fix (delete the draft, retry); the same
 *  mismatch found after publishing would need a human to inspect an already-live release. */
export function verifyDraft(releases, expected) {
  const mine = releases.filter((r) => r && r.tag_name === expected.tag);
  if (mine.length === 0) return { ok: false, detail: `no release found for ${expected.tag} right after create` };
  if (mine.length > 1) return { ok: false, detail: `${mine.length} releases carry ${expected.tag} right after create` };
  const mismatch = releaseMismatch(mine[0], expected);
  return mismatch ? { ok: false, detail: mismatch } : { ok: true };
}
