// Weekly user-facing release notes from CHANGELOG.md (§527). Pure: the CLI in
// release-notes.mjs owns reading the file, the arguments and the exit codes.
//
// ★ CHANGELOG.md stays the one source. The notes only regroup what is already
// there: every user-facing bullet of every version dated in the window, cut to
// its bold lead (or first sentence) and tagged with its version. "Development"
// and "Notes" are for contributors and are left out, and so are pre-releases,
// whose entries reappear in the release they lead to. So is any other heading
// not listed below; list it here to bring it in.
// ★ A register reference such as "(§512)" means nothing to a user, so a
// parenthesis that opens with one is cut from every line.

/** The headings a user reads, in the order the notes print them. */
export const USER_FACING_HEADINGS = ["Added", "Changed", "Removed", "Fixed", "Accessibility", "Security"];

/** A parenthesis whose content starts with a register number, backticked or not: "(§512)", "(§7 A4)", "(`§578`)". */
const REGISTER_REF_RE = /\s*\(`?§[^)]*\)/g;

const VERSION_RE = /^## \[([^\]]+)\](?: - (\d{4}-\d{2}-\d{2}))?/;

/**
 * Every `## [version]` block, newest first as the file has them. The
 * `[Unreleased]` block has a null date. Each section maps a `### Heading` to
 * its bullets, a bullet's wrapped continuation lines joined with one space.
 */
export function parseReleases(changelog) {
  const releases = [];
  let release = null;
  let heading = null;
  for (const line of changelog.split(/\r?\n/)) {
    const v = VERSION_RE.exec(line);
    if (v) {
      release = { version: v[1], date: v[2] ?? null, sections: {} };
      releases.push(release);
      heading = null;
      continue;
    }
    if (!release) continue;
    if (line.startsWith("### ")) {
      heading = line.slice(4).trim();
      release.sections[heading] = [];
      continue;
    }
    if (!heading) continue;
    const bullets = release.sections[heading];
    if (line.startsWith("- ")) bullets.push(line.slice(2).trim());
    else if (/^\s+\S/.test(line) && bullets.length > 0) bullets[bullets.length - 1] += ` ${line.trim()}`;
  }
  return releases;
}

/**
 * The line a reader scans: a bullet's bold lead when it has one, else its first
 * sentence. A sentence ends at ". " outside backticks, so "0.35.5" or a dotted
 * name in code does not cut it short.
 */
export function headline(bullet) {
  return leadOf(bullet).replace(REGISTER_REF_RE, "");
}

function leadOf(bullet) {
  const bold = /^\*\*(.+?)\*\*/.exec(bullet);
  if (bold) return bold[1].trim();
  let inCode = false;
  for (let i = 0; i < bullet.length; i++) {
    if (bullet[i] === "`") inCode = !inCode;
    if (!inCode && bullet[i] === "." && (i === bullet.length - 1 || bullet[i + 1] === " ")) {
      return bullet.slice(0, i + 1);
    }
  }
  return bullet;
}

/** Released versions dated within [since, until] (inclusive), plus Unreleased when asked. */
export function selectWindow(releases, { since, until, unreleased = false }) {
  return releases.filter((r) => {
    if (r.date === null) return unreleased && r.version === "Unreleased";
    if (r.version.includes("-")) return false;
    return r.date >= since && r.date <= until;
  });
}

/** The notes as Markdown, one heading per user-facing heading that has bullets. */
export function renderReleaseNotes(releases, { since, until }) {
  const out = [`# Release notes, ${since} to ${until}`, ""];
  if (releases.length === 0) return [...out, "No release in this window.", ""].join("\n");
  const tag = (r) => (r.date === null ? "not yet released" : r.version);
  const names = releases.map((r) => (r.date === null ? "not yet released" : `${r.version} (${r.date})`));
  out.push(`Versions: ${names.join(", ")}.`, "");
  for (const heading of USER_FACING_HEADINGS) {
    const lines = releases.flatMap((r) => (r.sections[heading] ?? []).map((b) => `- ${headline(b)} (${tag(r)})`));
    if (lines.length === 0) continue;
    out.push(`## ${heading}`, "", ...lines, "");
  }
  return out.join("\n");
}
