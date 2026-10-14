// Every local image a Markdown file shows, as repo-relative POSIX paths (§713).
// No shebang: vitest imports this module (scripts/doc-image-refs.test.mjs).
import { posix } from "node:path";

const MD_IMAGE = /!\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g;
const HTML_IMAGE = /<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/gi;

/** Drop fenced code blocks (``` or ~~~), whose image syntax is an example, not a picture. */
function stripFences(markdown) {
  const out = [];
  let fence = null;
  for (const line of markdown.split(/\r?\n/)) {
    const m = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fence) {
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length) fence = null;
      continue;
    }
    if (m) {
      fence = m[1];
      continue;
    }
    out.push(line);
  }
  return out.join("\n");
}

/**
 * @param {string} markdown the file's text
 * @param {string} fromFile the file's repo-relative path; refs resolve against its folder
 * @returns {string[]} local image paths in document order, `#…`/`?…` stripped, remote and data URLs skipped
 */
export function imageRefs(markdown, fromFile) {
  const text = stripFences(markdown);
  const found = [];
  for (const re of [MD_IMAGE, HTML_IMAGE]) {
    for (const m of text.matchAll(re)) found.push({ at: m.index, ref: m[1] });
  }
  const base = posix.dirname(fromFile.replace(/\\/g, "/"));
  return found
    .sort((a, b) => a.at - b.at)
    .map(({ ref }) => ref.replace(/[#?].*$/, ""))
    .filter((ref) => ref !== "" && !/^[a-z][a-z0-9+.-]*:/i.test(ref) && !ref.startsWith("//"))
    .map((ref) => posix.normalize(posix.join(base, ref)));
}
