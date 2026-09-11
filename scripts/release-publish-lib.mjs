// Pure construction of the GitLab Release payload and its asset URL, and pure
// classification of the Releases API's answers to that payload.
//
// ★ NO SHEBANG — imported by a vitest spec (see tag-version-lib.mjs).
// ★ NO fetch and NO process.exit here. publish-release.mjs owns both, so every
//   decision in this file is testable without a network or a token.
// ★★ NO CLASSIFIER MESSAGE EVER INCLUDES THE RESPONSE BODY — only the status
//   and the tag and asset URL this run built. So redacting CI_JOB_TOKEN out of
//   an echoed body belongs to the CLI, the one place a body is ever printed.

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

/**
 * The ONE emptiness rule, shared by required() and the classifiers' check on
 * `expected`: a string with something other than whitespace in it.
 */
function isNonEmptyString(v) {
  return typeof v === "string" && v.trim() !== "";
}

/**
 * `obj[key]`, or a throw naming `label` when it is not a non-empty string.
 * ★ `obj` may be null/undefined (a missing asset link) — that reads as a
 * missing value, not a TypeError.
 */
function required(obj, key, label = key) {
  const v = obj?.[key];
  if (!isNonEmptyString(v)) {
    // ★ Name only the missing variable, never a blanket claim about WHY it is
    // missing — CI_PROJECT_URL is set on every pipeline (branch, MR, tag),
    // not only a tag one, and the old wording ("this script runs only in a
    // tag pipeline") was wrong on that path.
    throw new Error(`${label} is missing or empty`);
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

/**
 * The `{ tagName, assetUrl }` the two classifiers below confirm against,
 * read out of the payload this run is about to send.
 *
 * ★★ The CLI takes `expected` from HERE and never assembles it by hand: the
 * point of confirming a 201 is that the server echoed back what we SENT, so
 * both values must come from the sent payload itself. Built via required(),
 * so a payload missing either value throws here rather than handing the
 * classifiers an `expected` they would refuse anyway.
 *
 * ★ Exactly ONE asset link, or it throws. The classifiers confirm one URL;
 * confirming only the first of several would report a Release with some of
 * its links missing as done.
 */
export function expectedFromPayload(payload) {
  const links = payload?.assets?.links;
  if (!Array.isArray(links) || links.length !== 1) {
    throw new Error(`payload must carry exactly one asset link (found ${Array.isArray(links) ? links.length : "none"})`);
  }
  return {
    tagName: required(payload, "tag_name"),
    assetUrl: required(links[0], "url", "assets.links[0].url"),
  };
}

/**
 * Does `expected` name BOTH values? Without it there is nothing to confirm
 * against: `expected = {}` once made a 201 whose link had no `url` read as
 * "created", because `undefined === undefined` on both comparisons.
 */
function hasExpected(expected) {
  return isNonEmptyString(expected?.tagName) && isNonEmptyString(expected?.assetUrl);
}

const NO_EXPECTED =
  "CANNOT CONFIRM: no expected tagName and assetUrl to check the response against — a caller bug (build it with expectedFromPayload), not an answer from the API";

/**
 * ★ Names the status's TYPE, never its value: a non-number here is a caller
 * bug (fetch always reports a number), and echoing an arbitrary value would
 * break the no-body-in-a-message rule in this file's header.
 */
function nonNumericStatus(status) {
  return `CANNOT CONFIRM: a non-numeric HTTP status (${typeof status}) — fetch always reports a number, so this is a caller bug`;
}

/** A JSON object — not null, not an array. */
function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * Does a Release response body carry the exact asset link we expect?
 *
 * ★ Compares the FULL url string, never a substring or a name match — a
 * link pointing at a stale job id or a differently-cased path is not "the
 * same" link even if it looks close.
 */
function hasOurLink(json, expected) {
  return Array.isArray(json?.assets?.links) && json.assets.links.some((l) => l && l.url === expected.assetUrl);
}

/**
 * Classify the response to the CREATE `POST .../releases` call.
 *
 * `expected = { tagName, assetUrl }`, from expectedFromPayload() — the tag
 * and asset link this run is SENDING, so the classifier confirms the server
 * echoed back what we actually asked for, never merely that it returned *a*
 * 201. An `expected` missing either value is refused (fail, code 2) before
 * the status is even read.
 *
 * Returns:
 *  - `{ kind: "created" }` — 201, and the body's tag_name and asset link
 *    both match what we sent.
 *  - `{ kind: "check-existing" }` — 409. GitLab's Releases::CreateService
 *    answers 409 when a Release for this tag already exists
 *    (app/services/releases/create_service.rb:
 *    `error(_('Release already exists'), 409)`). That can mean a real prior
 *    release, OR a create that actually SUCCEEDED whose response was lost to
 *    a timeout/reset — the caller must GET the existing Release and pass it
 *    to classifyExistingRelease() to tell those apart. Treating 409 as a
 *    plain refusal makes every retry fail FOREVER once that happens, while
 *    the asset URL this run built never gets attached to anything.
 *  - `{ kind: "fail", code: 1, message }` — a 4xx refusal other than 408,
 *    409 and 429: final, and a human has to act (a 403 says what on).
 *  - `{ kind: "fail", code: 2, message }` — everything else, all of it safe
 *    to retry: any other 2xx (a proxy or an unauthenticated endpoint
 *    answering 200 with an unrelated body is NOT a created release), a
 *    redirect (3xx — the caller must use `redirect: "manual"` so fetch never
 *    follows one into a GET on our behalf), 408 and 429, a 5xx, an
 *    unexpected status (0, NaN, 1xx, 600+), and a non-numeric one.
 *
 * ★★ 408 AND 429 ARE TRANSIENT, SO CODE 2, NOT THE REFUSAL CODE 1. A request
 * timeout or a rate limit says nothing about whether this Release may be
 * created, and a retry is safe BECAUSE of the 409 branch: if the timed-out
 * create did land, the retry answers 409 and classifyExistingRelease()
 * confirms it.
 *
 * ★★★ NOTHING BUT THE 201-AND-CONFIRMED BRANCH MAY RETURN "created". A
 * classifier whose success path is "any 2xx" or a bare `res.ok` is the
 * CRITICAL defect a pre-implementation review measured against the plan's
 * original inline code, run verbatim in a sandbox against a fake API: a 200
 * HTML proxy page exited 0 "created release", and a POST answered 302 was
 * silently re-followed by fetch as a GET (200 []) and ALSO exited 0
 * "created" — the fake server logged both requests.
 */
export function classifyCreateResponse(status, json, expected) {
  if (!hasExpected(expected)) {
    return { kind: "fail", code: 2, message: NO_EXPECTED };
  }
  // ★ Before ANY range comparison: a string "201" coerces through >= and <,
  // and used to land in the 2xx branch reading "HTTP 201 is not 201 Created".
  if (typeof status !== "number") {
    return { kind: "fail", code: 2, message: nonNumericStatus(status) };
  }
  if (status === 201) {
    // ★ The same plain-object rule classifyExistingRelease applies, so the two
    // classifiers agree on what counts as a Release body.
    if (isPlainObject(json) && json.tag_name === expected.tagName && hasOurLink(json, expected)) {
      return { kind: "created" };
    }
    return {
      kind: "fail",
      code: 2,
      message: `CANNOT CONFIRM: 201 but the body lacks tag_name=${expected.tagName} and/or the asset link ${expected.assetUrl}`,
    };
  }
  if (status >= 200 && status < 300) {
    return {
      kind: "fail",
      code: 2,
      message: `CANNOT CONFIRM: HTTP ${status} is not 201 Created — a 2xx from a proxy or an unrelated endpoint is not a created Release`,
    };
  }
  if (status >= 300 && status < 400) {
    return {
      kind: "fail",
      code: 2,
      message: `CANNOT CONFIRM: HTTP ${status} redirect — CI_API_V4_URL is not canonical, and a followed redirect would turn the POST into a GET`,
    };
  }
  if (status === 409) {
    return { kind: "check-existing" };
  }
  if (status === 408 || status === 429) {
    return {
      kind: "fail",
      code: 2,
      message: `CANNOT CONFIRM: HTTP ${status} is transient (a request timeout or a rate limit) — safe to retry, since a create that did land answers 409 next time`,
    };
  }
  if (status >= 400 && status < 500) {
    return {
      kind: "fail",
      code: 1,
      message: `API refused: HTTP ${status}${status === 403 ? " (the tag pusher needs Developer+, and the right to create protected tags)" : ""}`,
    };
  }
  if (status >= 500 && status < 600) {
    return {
      kind: "fail",
      code: 2,
      message: `CANNOT CONFIRM: HTTP ${status} — the API, or a proxy in front of it, is erroring; safe to retry`,
    };
  }
  // 0, NaN, 1xx, 600+ — never a refusal (code 1) and never a success.
  return {
    kind: "fail",
    code: 2,
    message: `CANNOT CONFIRM: unexpected HTTP status ${status}`,
  };
}

/**
 * Classify the GET on a Release that already exists, made after a 409 from
 * the create POST.
 *
 * `expected = { tagName, assetUrl }`, from expectedFromPayload(), the same
 * value classifyCreateResponse takes.
 *
 * Returns `{ code: 0 | 1 | 2, message }`:
 *  - 0 — 200, the body is a Release for OUR tag, and it already carries our
 *    asset link: the earlier create actually succeeded and only its response
 *    was lost — safe to treat this run as done.
 *  - 1 — 200 and a Release for our tag whose asset link list we could READ,
 *    and our link is not in it: a real conflict a human must resolve (add
 *    the link via the Release links API, or delete that Release and retry).
 *  - 2 — anything else. Never guess which of the two outcomes above is true:
 *    a missing `expected`, a non-200 or non-numeric status (404/5xx — the
 *    existing Release could not even be read), or a 200 whose body is not a
 *    JSON object naming our tag with an `assets.links` array (unparsed, an
 *    array, `{}`, another tag's Release, no link list). A 200 `[]` once read
 *    as code 1, "delete that Release" — advice to destroy something nobody
 *    had identified.
 */
export function classifyExistingRelease(status, json, expected) {
  if (!hasExpected(expected)) {
    return { code: 2, message: NO_EXPECTED };
  }
  if (typeof status !== "number") {
    return { code: 2, message: nonNumericStatus(status) };
  }
  if (status !== 200) {
    return {
      code: 2,
      message: `CANNOT CONFIRM: reading the existing Release for ${expected.tagName} returned HTTP ${status}, not 200 — cannot tell whether it carries ${expected.assetUrl}`,
    };
  }
  if (!isPlainObject(json) || json.tag_name !== expected.tagName || !Array.isArray(json.assets?.links)) {
    return {
      code: 2,
      message: `CANNOT CONFIRM: HTTP 200, but the body is not a Release for ${expected.tagName} with a readable asset link list — cannot tell whether it carries ${expected.assetUrl}`,
    };
  }
  if (hasOurLink(json, expected)) {
    return { code: 0, message: `release for ${expected.tagName} already exists with this asset link` };
  }
  return {
    code: 1,
    message: `a Release for ${expected.tagName} exists WITHOUT ${expected.assetUrl} — add the link (Release links API) or delete that Release, then retry`,
  };
}
