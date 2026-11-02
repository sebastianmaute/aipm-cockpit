// What licence a package carries, and whether a deny list rules it out.
// No shebang: vitest imports this module (scripts/sbom/notices.test.mjs).
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { LICENCE_OVERRIDES } from "./licence-overrides.mjs";

const LICENCE_FILE = /^(licen[cs]e|copying)/i;
const ID_SHAPE = /^[A-Za-z0-9][A-Za-z0-9.-]*\+?$/;
// Well-formed as an id, and saying there is no licence we could honour.
const NOT_A_LICENCE = /^(unlicensed|unknown|none|noassertion|proprietary|custom|commercial|licenseref-.*|documentref-.*)$/i;

/** One id, or `id WITH exception`, or a parenthesised expression. */
function parseAtom(tokens) {
  const token = tokens.shift();
  if (token === "(") {
    const inner = parseAny(tokens);
    return inner && tokens.shift() === ")" ? inner : null;
  }
  if (!token || !ID_SHAPE.test(token) || NOT_A_LICENCE.test(token) || /^(and|or|with)$/i.test(token)) return null;
  if (tokens[0]?.toUpperCase() === "WITH") {
    tokens.shift();
    if (!ID_SHAPE.test(tokens.shift() ?? "")) return null;
  }
  return { id: token };
}

function parseChain(tokens, operator, parseNext) {
  const first = parseNext(tokens);
  if (!first) return null;
  const parts = [first];
  while (tokens[0]?.toUpperCase() === operator) {
    tokens.shift();
    const next = parseNext(tokens);
    if (!next) return null;
    parts.push(next);
  }
  return parts.length === 1 ? first : { [operator]: parts };
}

function parseAny(tokens) {
  return parseChain(tokens, "OR", (rest) => parseChain(rest, "AND", parseAtom));
}

/**
 * An SPDX licence expression as a tree, or null when it is not one. The ids are
 * checked for shape, not against the SPDX list, so "BSD" passes as an id.
 *
 * @param {string} expression
 * @returns {object | null}
 */
export function parseLicence(expression) {
  const tokens = expression.match(/\(|\)|[^\s()]+/g) ?? [];
  const tree = parseAny(tokens);
  return tree && tokens.length === 0 ? tree : null;
}

/** `GPL-3.0-or-later` and `GPL-3.0-only` both rule out the family `GPL-3.0`. */
function familyOf(id) {
  return id.toLowerCase().replace(/\+$/, "").replace(/-(only|or-later)$/, "");
}

/**
 * Whether a parsed expression can only be taken under a denied licence: a choice
 * (OR) is denied when every branch is, a conjunction (AND) when any part is. An
 * id counts when it is in a denied family, deprecated spellings and exception
 * forms included (`GPL-3.0`, `GPL-3.0+`, `GPL-2.0-with-classpath-exception`).
 *
 * @param {object} tree from parseLicence
 * @param {string[]} deny
 */
export function isDenied(tree, deny) {
  if (tree.OR) return tree.OR.every((part) => isDenied(part, deny));
  if (tree.AND) return tree.AND.some((part) => isDenied(part, deny));
  const family = familyOf(tree.id);
  return deny.map(familyOf).some((denied) => family === denied || family.startsWith(`${denied}-`));
}

/** What a package.json says, in the current or either legacy form, or null. */
function declaredLicence(manifest) {
  const { license, licenses } = manifest ?? {};
  if (typeof license === "string") return license;
  if (typeof license?.type === "string") return license.type;
  if (Array.isArray(licenses)) {
    const types = licenses.map((entry) => entry?.type).filter((type) => typeof type === "string");
    if (types.length > 0) return types.join(" OR ");
  }
  return null;
}

function readManifest(dir) {
  const file = join(dir, "package.json");
  let contents;
  try {
    contents = readFileSync(file, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
  try {
    return JSON.parse(contents);
  } catch (err) {
    throw new Error(`${file}: ${err.message}`, { cause: err });
  }
}

/** The name of the first licence file directly in `dir`, by plain sort order. */
function licenceFileName(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
  const names = entries.filter((e) => e.isFile() && LICENCE_FILE.test(e.name)).map((e) => e.name);
  return names.sort()[0] ?? null;
}

/**
 * @param {{ name: string; dir: string; vendoredIn?: string }} pkg
 * @returns {{
 *   spdx: string | null;
 *   text: string | null;
 *   file: string | null;
 *   declared: string | null;
 *   overrideReason?: string;
 * }} `file` is a bare name, so that no build path can reach a published file.
 *   `declared` is what the package said, usable as an id or not.
 */
export function licenseOf(pkg) {
  const declared = declaredLicence(readManifest(pkg.dir));
  const file = licenceFileName(pkg.dir);
  const text = file ? readFileSync(join(pkg.dir, file), "utf8") : null;
  if (declared && parseLicence(declared)) return { spdx: declared, text, file, declared };
  const override = pkg.vendoredIn && !declared && Object.hasOwn(LICENCE_OVERRIDES, pkg.name) ? LICENCE_OVERRIDES[pkg.name] : null;
  if (override) return { spdx: override.spdx, text, file, declared, overrideReason: override.reason };
  return { spdx: null, text, file, declared };
}
