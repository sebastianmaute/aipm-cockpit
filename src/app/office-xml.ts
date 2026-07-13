// src/app/office-xml.ts — pure, i18n-free shared helpers for OOXML text extraction.

const utf8 = new TextDecoder("utf-8");

/** Decode a byte array as UTF-8. */
export function decodeUtf8(bytes: Uint8Array): string {
  return utf8.decode(bytes);
}

const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

/** Unescape the five predefined XML entities plus numeric (&#NN; / &#xHH;). */
export function unescapeXml(input: string): string {
  return input.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|amp|lt|gt|quot|apos);/g, (whole, body: string) => {
    if (body[0] === "#") {
      const code =
        body[1] === "x" || body[1] === "X"
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
      return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return NAMED[body] ?? whole;
  });
}

/**
 * Return the ordered inner text of every `<tag ...>...</tag>` occurrence,
 * XML-unescaped. The optional attribute group + closing `>` guard against a
 * prefix collision (`<w:t>` must not match `<w:tbl>`). Self-closing tags and
 * tags with child elements are out of scope — OOXML text tags (w:t/a:t/t) hold
 * pure text.
 */
export function extractRuns(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "g");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push(unescapeXml(m[1]));
  return out;
}
