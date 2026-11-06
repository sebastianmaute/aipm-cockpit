#!/usr/bin/env node
// Gives a packed app's update feed the publisher its updater must require: adds `publisherName:`
// with SignPath Foundation's full certificate subject (PUBLISHER) to
// <app>/resources/app-update.yml. electron-updater's
// NsisUpdater reads publisherName from that file and, when it is there, hands every downloaded
// installer to verifyUpdateCodeSignature (desktop/src/update-signature.ts, which fails closed).
// The release workflow's `repackage` job runs this on the app tree it repackages: `--prepackaged`
// writes no app-update.yml (only electron-builder's after-pack hook does, and a prepackaged run
// skips it), so the file in the tree is the one the `build` job packed, and this is where the
// signed build's copy gets its publisher. The `build` job's own package stays unsigned and
// carries none.
// Every other key is kept byte for byte: the list is appended, in the file's own line endings.
// Usage: node scripts/release-update-feed.mjs <app-dir>
// Exit: 0 written, or already exactly that list; 1 the file carries a different publisherName
// (nothing written); 2 could not run (no argument, the file missing, unreadable, empty or unwritable).
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// SignPath Foundation's code-signing certificate subject, in full, exactly as Windows PowerShell 5.1's
// Get-AuthenticodeSignature prints it (the form electron-updater parses). Measured 2026-11-06 on a
// file SignPath Foundation signed, the MSIX of Kazumi's release 2.4.3: status Valid, issuer
// "GlobalSign GCC R45 CodeSigning CA 2020", valid 2024-12-13 to 2027-09-07, thumbprint
// C4E03C1CB258265C9621822320AB0B25447E7171. A DN publisher name must match on every key it names,
// so a renewed certificate that changes any of these attributes fails `finalize` and
// `attest-signature`, and every installed signed copy would refuse its updates: compare this value
// with the new certificate's subject before the first release signed after a renewal.
export const PUBLISHER = "CN=SignPath Foundation, O=SignPath Foundation, L=Lewes, S=Delaware, C=US";

const KEY = /^publisherName[ \t]*:(.*)$/;

class Conflict extends Error {}

const unquote = (v) => {
  const t = v.trim();
  if (t.length >= 2 && ((t.startsWith("'") && t.endsWith("'")) || (t.startsWith('"') && t.endsWith('"')))) return t.slice(1, -1);
  return t;
};

/** The feed text with the publisher list, and whether that changed it. Throws when the text
 *  already has a publisherName that is not exactly [PUBLISHER], or is empty. */
export function addPublisherName(text) {
  if (text.trim() === "") throw new Error("app-update.yml is empty");
  const lines = text.split(/\r?\n/);
  const keys = lines.flatMap((l, i) => (KEY.test(l) ? [i] : []));
  if (keys.length > 1) throw new Conflict("app-update.yml has more than one publisherName key");
  if (keys.length === 1) {
    const i = keys[0];
    const inline = KEY.exec(lines[i])[1].trim();
    const items = [];
    for (let j = i + 1; j < lines.length; j++) {
      const m = /^[ \t]*-(?:[ \t]+(.*))?$/.exec(lines[j]);
      if (!m) break;
      items.push(unquote(m[1] ?? ""));
    }
    if (inline === "" && items.length === 1 && items[0] === PUBLISHER) return { text, changed: false };
    throw new Conflict(`app-update.yml already has a different publisherName (${inline || JSON.stringify(items)}), not exactly [${PUBLISHER}]`);
  }
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const sep = text.endsWith("\n") ? "" : eol;
  return { text: `${text}${sep}publisherName:${eol}  - ${PUBLISHER}${eol}`, changed: true };
}

/** Adds the publisher list to <appDir>/resources/app-update.yml in place. */
export function writePublisherName(appDir) {
  const path = join(appDir, "resources", "app-update.yml");
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (err) {
    throw new Error(`cannot read ${path}: ${err instanceof Error ? err.message : String(err)}`);
  }
  const r = addPublisherName(text);
  if (r.changed) writeFileSync(path, r.text);
  return { path, changed: r.changed };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [appDir] = process.argv.slice(2);
  try {
    if (!appDir) throw new Error("usage: release-update-feed.mjs <app-dir>");
    const r = writePublisherName(appDir);
    console.log(`[release-update-feed] ${r.path}: publisherName [${PUBLISHER}] ${r.changed ? "written" : "already present"}`);
    process.exit(0);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (err instanceof Conflict) {
      console.error(`[release-update-feed] REFUSED: ${msg}`);
      process.exit(1);
    }
    console.error(`[release-update-feed] CANNOT WRITE: ${msg}`);
    process.exit(2);
  }
}
