// src/app/html-extract.ts — hostile HTML -> Markdown, for AI ingestion.
//
// ★★ DELIBERATELY NOT `htmlPlainProjection` (rich-text-plain.ts). That helper is
// genuinely DOM-free and would mostly work, but it imports sanitize-html.ts,
// which pulls DOMPurify into the module graph and costs this extractor family
// its zero-import purity. It is also a different job: that one projects
// ALREADY-SANITIZED rich text, this one strips a hostile web page. Sharing
// would couple two things that only look alike.
//
// ★ Output is model-facing only. It is never rendered as HTML anywhere, so this
// module is an EXTRACTOR, not a sanitizer — do not cite it as an XSS boundary.

/** Elements whose entire subtree is noise for a reader. */
const DROP_SUBTREE = ["script", "style", "head", "nav", "footer", "aside", "noscript", "svg"];

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  mdash: "—", ndash: "–", hellip: "…", rsquo: "’", lsquo: "‘",
  ldquo: "“", rdquo: "”", middot: "·", bull: "•", copy: "©",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      const n = Number.parseInt(body.slice(2), 16);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : whole;
    }
    if (body.startsWith("#")) {
      const n = Number.parseInt(body.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : whole;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

function dropSubtrees(html: string): string {
  let out = html;
  for (const tag of DROP_SUBTREE) {
    // Non-greedy, case-insensitive, dot-matches-newline via [\s\S].
    out = out.replace(new RegExp("<" + tag + "\\b[\\s\\S]*?</" + tag + "\\s*>", "gi"), " ");
    // An unterminated one: drop from the open tag to end of input.
    out = out.replace(new RegExp("<" + tag + "\\b[\\s\\S]*$", "i"), " ");
  }
  return out;
}

function cellText(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim().replace(/\|/g, "\\|");
}

/** Render <table> to a Markdown table before generic tag-stripping flattens it.
 *  Tables are the one structure whose loss actually changes meaning — a
 *  resourcing mail's allocations live in one. */
function renderTables(html: string): string {
  return html.replace(/<table\b[\s\S]*?<\/table\s*>/gi, (table) => {
    const rows: string[][] = [];
    const trRe = /<tr\b[\s\S]*?<\/tr\s*>/gi;
    let tr: RegExpExecArray | null;
    while ((tr = trRe.exec(table)) !== null) {
      const cells: string[] = [];
      const cellRe = /<(t[dh])\b[^>]*>([\s\S]*?)<\/\1\s*>/gi;
      let c: RegExpExecArray | null;
      while ((c = cellRe.exec(tr[0])) !== null) cells.push(cellText(c[2]));
      if (cells.length > 0) rows.push(cells);
    }
    if (rows.length === 0) return " ";
    const width = Math.max(...rows.map((r) => r.length));
    const pad = (r: string[]) => [...r, ...Array(width - r.length).fill("")];
    const lines = [
      `| ${pad(rows[0]).join(" | ")} |`,
      `| ${Array(width).fill("---").join(" | ")} |`,
      ...rows.slice(1).map((r) => `| ${pad(r).join(" | ")} |`),
    ];
    return `\n\n${lines.join("\n")}\n\n`;
  });
}

export function extractHtmlMarkdown(html: string): string {
  let s = dropSubtrees(html);
  s = renderTables(s);
  s = s.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi, (_m, lvl: string, inner: string) =>
    `\n\n${"#".repeat(Number(lvl))} ${cellText(inner)}\n\n`);
  s = s.replace(/<li\b[^>]*>([\s\S]*?)<\/li\s*>/gi, (_m, inner: string) => `\n- ${cellText(inner)}`);
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/(p|div|tr|ul|ol|section|article|h[1-6]|blockquote)\s*>/gi, "\n\n");
  s = s.replace(/<[^>]*>/g, " ");            // every remaining tag, incl. unterminated
  s = s.replace(/<[^>]*$/g, " ");            // a trailing "<span" with no ">"
  s = decodeEntities(s);
  s = s.replace(/[ \t ]+/g, " ");
  s = s.split("\n").map((l) => l.trim()).join("\n");
  s = s.replace(/\n{3,}/g, "\n\n").trim();
  return s === "" ? "_(document contained no extractable text)_" : s;
}
