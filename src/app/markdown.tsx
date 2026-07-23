"use client";

// Minimal markdown renderer for Claude's chat replies.
//
// Why hand-rolled instead of react-markdown / marked / remark?
//   • Zero dependencies — we ship one file, no transitive surface.
//   • Auto-escaped: everything flows through React text nodes, so a Claude
//     response that contained literal HTML would render as text, never as
//     markup. We never touch `dangerouslySetInnerHTML`.
//   • Scope is intentionally small: the subset Claude emits in chat replies.
//
// Supported syntax (anything else falls through as text):
//   Block:
//     • Headings: `# H1`, `## H2`, `### H3`
//     • Bulleted lists: lines starting with `-`, `*`, or `+` followed by a space
//     • Numbered lists: lines starting with `1.`, `2.`, … followed by a space
//     • Fenced code blocks: ``` fences → <pre><code> (verbatim, no inline parse)
//     • GFM pipe tables: a header row + a `| --- | --- |` separator → <table>
//     • Paragraphs: separated by blank lines; single \n becomes a <br/>
//   Inline:
//     • `**bold**` / `__bold__`           → <strong>
//     • `*italic*` / `_italic_`           → <em>
//     • `` `code` ``                       → <code>
//     • `[label](https://example.com)`    → <a target="_blank" rel="noopener">
//
// Deliberately NOT supported: blockquotes, images, raw HTML, nested lists.
// Add when Claude actually produces them.

import { type ReactNode } from "react";

type Block =
  | { kind: "p"; lines: string[] }
  | { kind: "h"; level: 1 | 2 | 3; text: string }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] }
  | { kind: "code"; text: string }
  | { kind: "table"; header: string[]; rows: string[][] };

// --- Table helpers --------------------------------------------------------

/** A GFM alignment/separator row: `| --- | :--: |`, `|---|`, etc. Must contain
 *  a pipe (so a bare `---` thematic break is not mistaken for a table) and only
 *  the delimiter charset. One or more columns. */
function isTableSeparator(s: string): boolean {
  const t = s.trim();
  return t.includes("|") && t.includes("-") && /^[\s:|-]+$/.test(t);
}

/** Split one table row into trimmed cells. Honors `\|` escapes; drops the
 *  optional leading/trailing edge pipes. No lookbehind (tsc target < es2018). */
function splitTableRow(s: string): string[] {
  let t = s.trim();
  if (t.startsWith("|")) t = t.slice(1);
  if (t.endsWith("|")) t = t.slice(0, -1);
  const cells: string[] = [];
  let cur = "";
  for (let k = 0; k < t.length; k++) {
    if (t[k] === "\\" && t[k + 1] === "|") { cur += "|"; k++; continue; }
    if (t[k] === "|") { cells.push(cur.trim()); cur = ""; continue; }
    cur += t[k];
  }
  cells.push(cur.trim());
  return cells;
}

// --- Block-level parser ---------------------------------------------------

function parseBlocks(input: string): Block[] {
  const lines = input.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;

  function isBlank(s: string): boolean {
    return s.trim() === "";
  }

  while (i < lines.length) {
    const line = lines[i];

    if (isBlank(line)) {
      i++;
      continue;
    }

    // Fenced code block: ``` … ``` (verbatim; no inline parse). An unterminated
    // fence (no closing ```) runs to the end so stray backticks never leak.
    if (/^\s*```/.test(line)) {
      i++; // opening fence
      const codeLines: string[] = [];
      while (i < lines.length && !/^\s*```/.test(lines[i])) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++; // closing fence
      blocks.push({ kind: "code", text: codeLines.join("\n") });
      continue;
    }

    // GFM pipe table: a header row immediately followed by a separator row.
    if (line.includes("|") && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const header = splitTableRow(line);
      i += 2; // header + separator
      const rows: string[][] = [];
      while (
        i < lines.length &&
        !isBlank(lines[i]) &&
        lines[i].includes("|") &&
        !/^(#{1,3}\s+|\s*[-*+]\s+|\s*\d+\.\s+|\s*```)/.test(lines[i])
      ) {
        rows.push(splitTableRow(lines[i]));
        i++;
      }
      blocks.push({ kind: "table", header, rows });
      continue;
    }

    // Heading
    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({
        kind: "h",
        level: heading[1].length as 1 | 2 | 3,
        text: heading[2],
      });
      i++;
      continue;
    }

    // Bullet list
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*+]\s+/, ""));
        i++;
      }
      blocks.push({ kind: "ul", items });
      continue;
    }

    // Numbered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ""));
        i++;
      }
      blocks.push({ kind: "ol", items });
      continue;
    }

    // Paragraph: greedily collect non-blank, non-block-start lines.
    const para: string[] = [line];
    i++;
    while (
      i < lines.length &&
      !isBlank(lines[i]) &&
      !/^(#{1,3}\s+|\s*[-*+]\s+|\s*\d+\.\s+|\s*```)/.test(lines[i]) &&
      !(lines[i].includes("|") && i + 1 < lines.length && isTableSeparator(lines[i + 1]))
    ) {
      para.push(lines[i]);
      i++;
    }
    blocks.push({ kind: "p", lines: para });
  }

  return blocks;
}

// --- Inline parser --------------------------------------------------------
//
// We hand-roll a single-pass scanner rather than chaining regex replaces
// because chained replaces can't easily produce React nodes, and naïve
// regex replace on already-converted markup is fragile.

function parseInline(input: string): ReactNode[] {
  const out: ReactNode[] = [];
  let i = 0;
  let keyCounter = 0;
  const nextKey = () => `m-${keyCounter++}`;

  // Buffer for plain text we haven't flushed yet.
  let buffer = "";
  function flushBuffer() {
    if (buffer) {
      out.push(buffer);
      buffer = "";
    }
  }

  while (i < input.length) {
    const ch = input[i];

    // Inline code: `code`
    if (ch === "`") {
      const end = input.indexOf("`", i + 1);
      if (end > i) {
        flushBuffer();
        out.push(
          <code
            key={nextKey()}
            className="rounded bg-surface-muted px-1 py-0.5 font-mono text-xs text-foreground"
          >
            {input.slice(i + 1, end)}
          </code>,
        );
        i = end + 1;
        continue;
      }
    }

    // Bold: **text** or __text__
    if (
      (ch === "*" && input[i + 1] === "*") ||
      (ch === "_" && input[i + 1] === "_")
    ) {
      const marker = ch + ch;
      const end = input.indexOf(marker, i + 2);
      if (end > i + 1) {
        flushBuffer();
        out.push(
          <strong key={nextKey()} className="font-semibold">
            {parseInline(input.slice(i + 2, end))}
          </strong>,
        );
        i = end + 2;
        continue;
      }
    }

    // Italic: *text* or _text_
    // Guarded by surrounding char checks so we don't eat `**bold**` (handled above)
    // or `snake_case_identifiers`.
    if (
      (ch === "*" && input[i + 1] !== "*") ||
      (ch === "_" && input[i + 1] !== "_")
    ) {
      // For underscores, require non-word character (or start) before and
      // after to avoid intra-word matches like `snake_case`.
      const isUnderscore = ch === "_";
      const prev = i === 0 ? "" : input[i - 1];
      if (!isUnderscore || !/\w/.test(prev)) {
        let end = i + 1;
        while (end < input.length) {
          if (input[end] === ch) {
            const after = input[end + 1] ?? "";
            if (!isUnderscore || !/\w/.test(after)) break;
          }
          end++;
        }
        if (end < input.length && end > i + 1) {
          flushBuffer();
          out.push(
            <em key={nextKey()} className="italic">
              {parseInline(input.slice(i + 1, end))}
            </em>,
          );
          i = end + 1;
          continue;
        }
      }
    }

    // Link: [label](url)
    if (ch === "[") {
      const closeBracket = input.indexOf("]", i + 1);
      if (closeBracket > i && input[closeBracket + 1] === "(") {
        const closeParen = input.indexOf(")", closeBracket + 2);
        if (closeParen > closeBracket) {
          const label = input.slice(i + 1, closeBracket);
          const url = input.slice(closeBracket + 2, closeParen).trim();
          // Only allow safe URL schemes; everything else falls through as text.
          if (/^(https?:|mailto:)/i.test(url) || url.startsWith("/")) {
            flushBuffer();
            out.push(
              <a
                key={nextKey()}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-ui-dark-blue underline underline-offset-2 hover:opacity-80 dark:text-ui-blue"
              >
                {parseInline(label)}
              </a>,
            );
            i = closeParen + 1;
            continue;
          }
        }
      }
    }

    // Default: accumulate plain text.
    buffer += ch;
    i++;
  }

  flushBuffer();
  return out;
}

/** Render a paragraph block: nodes per line, <br/> between lines. */
function renderParagraph(lines: string[], key: string): ReactNode {
  const children: ReactNode[] = [];
  lines.forEach((line, idx) => {
    if (idx > 0) children.push(<br key={`${key}-br-${idx}`} />);
    children.push(
      <span key={`${key}-l-${idx}`}>{parseInline(line)}</span>,
    );
  });
  return (
    <p key={key} className="my-1 first:mt-0 last:mb-0">
      {children}
    </p>
  );
}

// --- Public component -----------------------------------------------------

export function Markdown({ text }: { text: string }) {
  const blocks = parseBlocks(text);
  return (
    <>
      {blocks.map((b, idx) => {
        const key = `b-${idx}`;
        switch (b.kind) {
          case "h":
            if (b.level === 1) {
              return (
                <h1 key={key} className="my-2 text-base font-semibold first:mt-0">
                  {parseInline(b.text)}
                </h1>
              );
            }
            if (b.level === 2) {
              return (
                <h2 key={key} className="my-2 text-sm font-semibold first:mt-0">
                  {parseInline(b.text)}
                </h2>
              );
            }
            return (
              <h3
                key={key}
                className="my-1.5 text-sm font-semibold text-ui-dark-blue first:mt-0 dark:text-ui-light-grey"
              >
                {parseInline(b.text)}
              </h3>
            );
          case "ul":
            return (
              <ul
                key={key}
                className="my-1 ml-4 list-disc space-y-0.5 first:mt-0 last:mb-0"
              >
                {b.items.map((it, j) => (
                  <li key={`${key}-${j}`}>{parseInline(it)}</li>
                ))}
              </ul>
            );
          case "ol":
            return (
              <ol
                key={key}
                className="my-1 ml-4 list-decimal space-y-0.5 first:mt-0 last:mb-0"
              >
                {b.items.map((it, j) => (
                  <li key={`${key}-${j}`}>{parseInline(it)}</li>
                ))}
              </ol>
            );
          case "code":
            return (
              <pre
                key={key}
                className="my-1.5 overflow-x-auto rounded bg-surface-muted p-2 first:mt-0 last:mb-0"
              >
                <code className="font-mono text-xs text-foreground">{b.text}</code>
              </pre>
            );
          case "table":
            return (
              <div key={key} className="my-1.5 overflow-x-auto first:mt-0 last:mb-0">
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr>
                      {b.header.map((h, j) => (
                        <th
                          key={`${key}-h-${j}`}
                          className="border border-line bg-surface-muted px-2 py-1 text-left font-semibold"
                        >
                          {parseInline(h)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.rows.map((row, r) => (
                      <tr key={`${key}-r-${r}`}>
                        {row.map((c, j) => (
                          <td
                            key={`${key}-r-${r}-c-${j}`}
                            className="border border-line px-2 py-1 align-top"
                          >
                            {parseInline(c)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          case "p":
            return renderParagraph(b.lines, key);
        }
      })}
    </>
  );
}
