// What licence a package carries, and whether a deny list rules it out.
// No shebang: vitest imports this module (scripts/sbom/notices.test.mjs).
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { LICENCE_OVERRIDES } from "./licence-overrides.mjs";
import { SPDX_EXCEPTION_IDS, SPDX_LICENCE_IDS } from "./spdx-ids.mjs";

const LICENCE_FILE = /^(licen[cs]e|copying)/i;
const byLowerCase = (ids) => new Map(ids.map((id) => [id.toLowerCase(), id]));
const LICENCE_IDS = byLowerCase(SPDX_LICENCE_IDS);
const EXCEPTION_IDS = byLowerCase(SPDX_EXCEPTION_IDS);

/** The SPDX spelling of a listed licence id, a trailing `+` kept, or null. */
function canonicalLicence(token) {
  const plus = token.endsWith("+") ? "+" : "";
  const id = LICENCE_IDS.get((plus ? token.slice(0, -1) : token).toLowerCase());
  return id ? `${id}${plus}` : null;
}

/**
 * A recursive-descent reader over the tokens. Every token it accepts goes to
 * `out` in SPDX spelling (operators upper case), so a parse yields both the tree
 * and the normalised text.
 */
function reader(tokens) {
  const out = [];
  const isOperator = (word) => tokens[0]?.toUpperCase() === word;

  function atom() {
    const token = tokens.shift();
    if (token === "(") {
      out.push("(");
      const inner = any();
      if (!inner || tokens.shift() !== ")") return null;
      out.push(")");
      return inner;
    }
    const id = token ? canonicalLicence(token) : null;
    if (!id) return null;
    out.push(id);
    if (!isOperator("WITH")) return { id };
    tokens.shift();
    const exception = EXCEPTION_IDS.get((tokens.shift() ?? "").toLowerCase());
    if (!exception) return null;
    out.push("WITH", exception);
    return { id, exception };
  }

  function chain(operator, next) {
    const first = next();
    if (!first) return null;
    const parts = [first];
    while (isOperator(operator)) {
      tokens.shift();
      out.push(operator);
      const part = next();
      if (!part) return null;
      parts.push(part);
    }
    return parts.length === 1 ? first : { [operator]: parts };
  }

  function any() {
    return chain("OR", () => chain("AND", atom));
  }

  const tree = any();
  return tree && tokens.length === 0 ? { tree, text: out.join(" ").replace(/\( /g, "(").replace(/ \)/g, ")") } : null;
}

const tokensOf = (expression) => expression.match(/\(|\)|[^\s()]+/g) ?? [];

/**
 * An SPDX licence expression as a tree, or null when it is not one. Every id must
 * be on the reviewed list in spdx-ids.mjs; `and`/`or`/`with` are read in any case.
 *
 * @param {string} expression
 * @returns {object | null}
 */
export function parseLicence(expression) {
  return reader(tokensOf(expression))?.tree ?? null;
}

/**
 * The expression in SPDX spelling (`mit or apache-2.0` -> `MIT OR Apache-2.0`),
 * parentheses kept, or null when it is not an SPDX expression.
 *
 * @param {string} expression
 * @returns {string | null}
 */
export function normaliseLicence(expression) {
  return reader(tokensOf(expression))?.text ?? null;
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
  const spdx = declared ? normaliseLicence(declared) : null;
  if (spdx) return { spdx, text, file, declared };
  const override = pkg.vendoredIn && !declared && Object.hasOwn(LICENCE_OVERRIDES, pkg.name) ? LICENCE_OVERRIDES[pkg.name] : null;
  if (override) return { spdx: override.spdx, text, file, declared, overrideReason: override.reason };
  return { spdx: null, text, file, declared };
}
