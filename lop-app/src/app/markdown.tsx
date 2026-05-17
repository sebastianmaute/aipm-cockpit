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
//     • Paragraphs: separated by blank lines; single \n becomes a <br/>
//   Inline:
//     • `**bold**` / `__bold__`           → <strong>
//     • `*italic*` / `_italic_`           → <em>
//     • `` `code` ``                       → <code>
//     • `[label](https://example.com)`    → <a target="_blank" rel="noopener">
//
// Deliberately NOT supported: blockquotes, tables, images, raw HTML, nested
// lists, fenced code blocks. Add when Claude actually produces them.

import { type ReactNode } from "react";

type Block =
  | { kind: "p"; lines: string[] }
  | { kind: "h"; level: 1 | 2 | 3; text: string }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] };

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
      !/^(#{1,3}\s+|\s*[-*+]\s+|\s*\d+\.\s+)/.test(lines[i])
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
            className="rounded bg-zinc-200 px-1 py-0.5 font-mono text-xs text-zinc-900 dark:bg-zinc-700 dark:text-zinc-100"
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
                className="text-AIPM-dark-blue underline underline-offset-2 hover:opacity-80 dark:text-AIPM-blue"
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
                className="my-1.5 text-sm font-semibold text-AIPM-dark-blue first:mt-0 dark:text-AIPM-light-grey"
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
          case "p":
            return renderParagraph(b.lines, key);
        }
      })}
    </>
  );
}
