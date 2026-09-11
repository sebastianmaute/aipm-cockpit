// Pure construction of the GitLab Release payload and its asset URL.
//
// ★ NO SHEBANG — imported by a vitest spec (see tag-version-lib.mjs).
// ★ NO fetch and NO process.exit here. publish-release.mjs owns both, so every
//   decision in this file is testable without a network or a token.

/**
 * The job whose artifact the asset link points at.
 *
 * ★★★ THIS STRING IS PART OF EVERY PUBLISHED DOWNLOAD URL. Renaming the CI job
 * without changing it here — or changing it here without renaming the job —
 * silently 404s the download on every Release, past ones included. It is
 * exported so the test pins it against one source rather than two literals.
 */
export const ARTIFACT_JOB = "desktop-package-tag";

/** Where electron-builder's artifactName puts the installer, relative to the repo root. */
export const INSTALLER_DIR = "desktop/release";

function required(env, key) {
  const v = env[key];
  if (typeof v !== "string" || v.trim() === "") {
    // ★ Name only the missing variable, never a blanket claim about WHY it is
    // missing — CI_PROJECT_URL is set on every pipeline (branch, MR, tag),
    // not only a tag one, and the old wording ("this script runs only in a
    // tag pipeline") was wrong on that path.
    throw new Error(`${key} is missing or empty`);
  }
  return v;
}

/** A plain dotted-triple semver, optionally with a `-pre.release` tag — nothing else. */
const SEMVER_RE = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;

/**
 * `aipm-cockpit-<version>-setup.exe`, matching desktop/electron-builder.yml's artifactName.
 *
 * ★★★ FAILS CLOSED on anything that is not a plain semver, rather than trying
 * to URL-encode whatever came in. `#` is a legal character in a git ref and
 * starts a URL FRAGMENT — left unescaped it silently truncates the asset URL
 * at that point, handing out a link that looks valid and 404s (or worse,
 * resolves to something else). `version` comes from src/app/version.ts's
 * APP_VERSION, so this should never fire outside a corrupted build; if it
 * does, the pipeline must stop rather than publish a link nobody can trust.
 */
export function installerName(version) {
  if (typeof version !== "string" || !SEMVER_RE.test(version)) {
    throw new Error(`version "${version}" is not a plain semver string (expected to match ${SEMVER_RE})`);
  }
  return `aipm-cockpit-${version}-setup.exe`;
}

/**
 * The PER-TAG artifact URL.
 *
 * ★★★ Deliberately not the per-job-id form. `/-/jobs/<id>/artifacts/raw/...`
 * names one execution and dies when the job is re-run — which is a normal thing
 * to do to a release build. `/-/jobs/artifacts/<tag>/raw/<path>?job=<name>`
 * resolves to the latest successful run of that job at that ref, so the link
 * survives a re-run.
 *
 * ★ This exact web-form URL (`/-/jobs/artifacts/<ref>/raw/<path>?job=<name>`)
 * is not documented in GitLab's current REST/GraphQL API reference — it is
 * served by `Projects::ArtifactsController` (GitLab's own Rails source),
 * which resolves `<ref>` against the LATEST SUCCESSFUL PIPELINE for that ref.
 * That is why the link 404s until the whole tag pipeline succeeds, not merely
 * until `desktop-package-tag` does — the same "no needs:" reasoning
 * publish-release itself relies on (see .gitlab-ci.yml).
 *
 * ★ GitLab's own release_fields guidance advises AGAINST linking job
 * artifacts from a Release because they are ephemeral — an artifact that
 * later expires turns a page meant to stay valid indefinitely into a dead
 * link. `desktop-package-tag` sets `expire_in: never` specifically to close
 * that gap for this one link.
 *
 * ★★ Downloading needs PROJECT MEMBERSHIP, not merely a signed-in account:
 * per GitLab's permissions docs ("Download artifacts",
 * https://docs.gitlab.com/user/permissions/), an `internal` project serves
 * artifacts only to a Guest with project-based pipeline visibility enabled,
 * or to Reporter and up — a signed-in non-member gets nothing. Stated by
 * those docs, NOT YET VERIFIED on this instance; Task 11 checks it with a
 * non-member account. docs/desktop-rollout.md carries the same caveat so a
 * colleague hits a clear permission error rather than being surprised by one.
 */
export function buildAssetUrl(env, version) {
  const base = required(env, "CI_PROJECT_URL");
  const tag = required(env, "CI_COMMIT_TAG");
  return `${base}/-/jobs/artifacts/${tag}/raw/${INSTALLER_DIR}/${installerName(version)}?job=${ARTIFACT_JOB}`;
}

/**
 * The POST body for `POST /projects/:id/releases`.
 *
 * ★ `description` LINKS CHANGELOG.md rather than quoting it. Parsing a
 * release section out of it is real work with a real failure mode (a heading
 * rename silently empties the notes), and the file is one click away. Link,
 * do not restate — the same rule the doc set runs on.
 */
export function buildReleasePayload(env, version, milestone) {
  const tag = required(env, "CI_COMMIT_TAG");
  const projectUrl = required(env, "CI_PROJECT_URL");
  if (typeof milestone !== "string" || milestone.trim() === "") {
    throw new Error("milestone is empty — src/app/version.ts's APP_MILESTONE shape moved");
  }

  const exe = installerName(version);
  const changelogUrl = `${projectUrl}/-/blob/${encodeURIComponent(tag)}/CHANGELOG.md`;

  return {
    tag_name: tag,
    name: `AI PM Cockpit ${version} "${milestone}"`,
    description: [
      `Windows desktop installer for AI PM Cockpit ${version} "${milestone}".`,
      "",
      `- Download: **${exe}** (asset link below)`,
      "- First run, and what to do if it does not start: `docs/desktop-rollout.md`",
      `- What changed: [CHANGELOG.md](${changelogUrl})`,
      "",
      "The installer is not code-signed, so Windows shows a SmartScreen prompt on",
      "first run: **More info → Run anyway**. It installs for the current user and",
      "needs no admin rights.",
    ].join("\n"),
    assets: {
      links: [
        {
          name: `${exe} (Windows installer)`,
          url: buildAssetUrl(env, version),
          link_type: "package",
        },
      ],
    },
  };
}
