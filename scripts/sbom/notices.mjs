// THIRD-PARTY-NOTICES.txt: the full licence text of everything the app ships.
// No shebang: vitest imports this module (scripts/sbom/notices.test.mjs).
//
// Pure of paths: it prints package names and licence files' contents, never a
// `dir`, because the file is published with every release.
import { licenseOf } from "./licences.mjs";

const RULE = "=".repeat(78);
const HEADER = [
  "AI PM Cockpit: third-party notices",
  "",
  "This release ships the third-party software listed below. Each entry gives its",
  "licence and, where the package carries one, the licence text in full.",
].join("\n");

function versionLabel(pkg) {
  if (pkg.versionKnown === false) return "version unknown (bundled inside Next.js)";
  return pkg.vendoredIn ? `${pkg.version} (bundled inside Next.js)` : pkg.version;
}

function licenceNote({ spdx, text, overrideReason, derivedFrom }) {
  if (derivedFrom) {
    const derived = `Derived from ${derivedFrom}; the licence text below is ${derivedFrom}'s.`;
    return `Note: licence established by review: ${overrideReason}\n${derived}`;
  }
  if (overrideReason) return `Note: licence established by review: ${overrideReason}`;
  if (spdx && !text) return "Note: this package ships no licence file; the identifier comes from its package.json.";
  return null;
}

function section(pkg, extra) {
  const licence = licenseOf(pkg);
  const lines = [`=== ${pkg.name} ${versionLabel(pkg)} ===`, `Licence: ${licence.spdx ?? "unknown"}`];
  const note = licenceNote(licence);
  if (note) lines.push(note);
  if (extra) lines.push(extra);
  if (licence.text) lines.push("", licence.text.replace(/\r\n/g, "\n").trimEnd());
  return lines.join("\n");
}

/**
 * @param {Array<{ name: string; version: string; dir: string; vendoredIn?: string; versionKnown?: boolean }>} set
 * @param {{ electron: { name: string; version: string; dir: string } }} options
 * @returns {string}
 */
export function toNotices(set, { electron }) {
  const chromium =
    "Electron includes Chromium and other open-source components. Their licences are in LICENSES.chromium.html, next to the application's executable in the installation folder.";
  const sections = [...set.map((pkg) => section(pkg)), section(electron, chromium)];
  return `${[HEADER, ...sections].join(`\n\n${RULE}\n\n`)}\n`;
}
