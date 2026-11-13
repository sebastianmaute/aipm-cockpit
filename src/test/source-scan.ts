// Test-only source scanning for the registry completeness tests (deployment variables, outbound
// destinations): they read the shipped source as text and must not count a name or a call that only
// appears in a comment, nor lose real code to a "comment" that is really part of a string.

/** A `/` after one of these characters starts a regex literal, not a division. */
const REGEX_AFTER_CHAR = new Set([..."(,=:[!&|?{};+-*%<>~^"]);
/** A `/` after one of these words starts a regex literal, not a division. */
const REGEX_AFTER_WORD =
  /\b(?:return|typeof|case|do|else|in|of|new|delete|void|throw|yield|await|instanceof)$/;

function startsRegex(out: string): boolean {
  const before = out.trimEnd();
  if (before === "") return true;
  return REGEX_AFTER_CHAR.has(before[before.length - 1]) || REGEX_AFTER_WORD.test(before);
}

/** End index (exclusive) of the quoted string opening at `start`; stops at an unescaped line break. */
function quotedEnd(text: string, start: number): number {
  const quote = text[start];
  let i = start + 1;
  while (i < text.length && text[i] !== quote && text[i] !== "\n") i += text[i] === "\\" ? 2 : 1;
  return Math.min(i + 1, text.length);
}

/** End index (exclusive) of the regex literal opening at `start`, flags included, or -1 when the line
 *  ends first (then the `/` was not a regex after all). */
function regexEnd(text: string, start: number): number {
  let i = start + 1;
  let inClass = false;
  while (i < text.length && text[i] !== "\n") {
    const c = text[i];
    if (c === "\\") i += 2;
    else {
      if (c === "[") inClass = true;
      else if (c === "]") inClass = false;
      else if (c === "/" && !inClass) {
        i++;
        while (i < text.length && /[a-z]/i.test(text[i])) i++;
        return i;
      }
      i++;
    }
  }
  return -1;
}

/** The source with its comments removed and everything else kept byte for byte: a `//` or `/*` inside
 *  a string ('…', "…"), a template literal (`…`, including code nested in `${…}`) or a regex literal is
 *  not a comment. A block comment leaves its line breaks behind. Best effort for regex literals: a `/`
 *  after an operator, an opening bracket or a keyword such as `return` starts one; anywhere else it is
 *  a division. JSX text is read as code. */
export function stripComments(text: string): string {
  let out = "";
  let i = 0;
  // One entry per open template literal: -1 while inside its text, else the brace depth of its `${…}`.
  const templates: number[] = [];
  while (i < text.length) {
    const c = text[i];
    const top = templates.length - 1;
    if (top >= 0 && templates[top] === -1) {
      if (c === "\\") {
        out += text.slice(i, i + 2);
        i += 2;
      } else if (c === "`") {
        out += c;
        templates.pop();
        i++;
      } else if (c === "$" && text[i + 1] === "{") {
        out += "${";
        templates[top] = 0;
        i += 2;
      } else {
        out += c;
        i++;
      }
      continue;
    }
    const next = text[i + 1];
    if (c === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") i++;
    } else if (c === "/" && next === "*") {
      const close = text.indexOf("*/", i + 2);
      const end = close === -1 ? text.length : close + 2;
      out += text.slice(i, end).replace(/[^\n]/g, "");
      i = end;
    } else if (c === "'" || c === '"') {
      const end = quotedEnd(text, i);
      out += text.slice(i, end);
      i = end;
    } else if (c === "`") {
      out += c;
      templates.push(-1);
      i++;
    } else if (c === "/" && startsRegex(out)) {
      const end = regexEnd(text, i);
      const stop = end === -1 ? i + 1 : end;
      out += text.slice(i, stop);
      i = stop;
    } else {
      if (top >= 0 && c === "{") templates[top]++;
      else if (top >= 0 && c === "}") templates[top] = templates[top] === 0 ? -1 : templates[top] - 1;
      out += c;
      i++;
    }
  }
  return out;
}

const NODE_HTTP_MODULE = String.raw`["'](?:node:)?https?["']`;
const NAMED_IMPORT = new RegExp(String.raw`import\s*\{([^}]*)\}\s*from\s*${NODE_HTTP_MODULE}`, "g");
const NAMESPACE_IMPORT = new RegExp(
  String.raw`import\s+(?:\*\s+as\s+)?([A-Za-z_$][\w$]*)\s+from\s*${NODE_HTTP_MODULE}`,
  "g",
);
/** `https.get(`, `http.request(` and the like, whatever the module was imported as. */
const MODULE_CALL = /\bhttps?\.(?:get|request)\(/;

const callOf = (name: string): RegExp => new RegExp(String.raw`(?<![\w$.])${name.replace(/\$/g, "\\$")}\(`);

/** Whether the code calls Node's own HTTP client: `https.get(` / `http.request(` (and the other two
 *  pairings), a `get` or `request` imported by name from `node:http(s)` (under any local alias), or
 *  either method on a default or namespace import of that module. A type-only import is not a call. */
export function callsNodeHttp(code: string): boolean {
  if (MODULE_CALL.test(code)) return true;
  for (const m of code.matchAll(NAMESPACE_IMPORT)) {
    if (new RegExp(String.raw`(?<![\w$.])${m[1]}\.(?:get|request)\(`).test(code)) return true;
  }
  for (const m of code.matchAll(NAMED_IMPORT)) {
    for (const spec of m[1].split(",")) {
      const parts = spec.trim().split(/\s+as\s+/);
      if (parts[0] !== "get" && parts[0] !== "request") continue;
      if (callOf(parts[1] ?? parts[0]).test(code)) return true;
    }
  }
  return false;
}
