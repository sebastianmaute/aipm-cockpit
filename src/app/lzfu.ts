// src/app/lzfu.ts — MS-OXRTFCP decompression plus RTF -> plain text.
//
// ★★★ NOT OPTIONAL, and this was measured rather than assumed. Two real
// Outlook messages carried NO PR_HTML at all; the only formatted body in each
// was PR_RTF_COMPRESSED with the "LZFu" magic. Without this module a .msg body
// can only ever be the plain-text stream, which loses TABLES — exactly what a
// resourcing or budget mail carries.
//
// Derived from the published MS-OXRTFCP specification, including the fixed
// initial dictionary below, so no third-party code enters the tree.

/** ★★★ TRANSCRIBED FROM MS-OXRTFCP, NOT FROM MEMORY OR A BLOG POST. It is the
 *  specification's fixed initial dictionary, it is byte-exact, and a wrong
 *  byte does not fail loudly — it corrupts whichever decompressed bodies
 *  happen to back-reference that position, silently. (This sentence used to
 *  read "every decompressed body"; see the measurement below for why it does
 *  not.)
 *
 *  Source: [MS-OXRTFCP] "Rich Text Format (RTF) Compression Algorithm",
 *  Release: May 20, 2025 (protocol revision 15.0), section 2.1.2.1
 *  "Dictionary". Extracted programmatically from the published PDF
 *  (https://learn.microsoft.com/en-us/openspecs/exchange_server_protocols/ms-oxrtfcp/65dfe2df-1b69-43fc-8ebd-21819a7463fb,
 *  which links the PDF at
 *  https://officeprotocoldocs-f5hpbjgea6b8gneq.b02.azurefd.net/files/MS-OXRTFCP/%5bMS-OXRTFCP%5d.pdf)
 *  by inflating its FlateDecode content streams and reading the positioned
 *  text-show (Tj) operators verbatim, byte-checked (no hidden separators
 *  between the concatenated font-family names). The spec's own text reads:
 *
 *    The writer MUST initialize the dictionary (starting at offset 0) with
 *    the following ASCII string: { the 207-byte value below } ... After the
 *    dictionary is initialized, the writer MUST set the write offset and the
 *    end offset of the dictionary ... to 207 (pointing to the byte that
 *    follows the pre-loaded string).
 *
 *  That "207" is stated independently of the string's content, and the
 *  extracted string is exactly 207 bytes long — two independent facts from
 *  the same source converging exactly, which is the corroboration this
 *  transcription rests on.
 *
 *  ★★★ WHAT IS ACTUALLY PROVEN, WHICH IS LESS THAN THIS COMMENT USED TO CLAIM.
 *  It said a dictionary "off by even one byte" turns the real fixture's output
 *  into garbage that the body-marker assertion catches. That is FALSE, and was
 *  disproved by mutation rather than argued: substituting a single SAME-LENGTH
 *  character at index 0, 50 and 120 in turn each left `FIXTURE-BODY-MARKER`
 *  present in the decoded output of the real `.msg` fixture (index 0 moved the
 *  output length 75 -> 78; the other two changed it not at all). Only some
 *  dictionary positions are ever back-referenced by a given stream, so a wrong
 *  byte is detected only by luck.
 *
 *  So, precisely: the LENGTH is pinned, loudly, by the throw below. The
 *  CONTENT is corroborated — not proven — by `msg-integration.test.ts`
 *  decoding a real Outlook LZFu stream into readable text, which a wholesale
 *  mistranscription would wreck. NO test in this repo detects a same-length
 *  content error. Do not upgrade that sentence without writing the test that
 *  earns it. */
export const LZFU_INIT_DICT =
  "{\\rtf1\\ansi\\mac\\deff0\\deftab720{\\fonttbl;}{\\f0\\fnil \\froman \\fswiss \\fmodern \\fscript \\fdecor MS Sans SerifSymbolArialTimes New RomanCourier{\\colortbl\\red0\\green0\\blue0\r\n\\par \\pard\\plain\\f0\\fs20\\b\\i\\u\\tab\\tx";

// ★★★ Fail loudly at load rather than silently corrupting every decompressed
// body — a wrong-length constant must never pass unnoticed. Do not pad or
// trim the constant above to satisfy this; if it does not hold, the constant
// itself is wrong and must be re-transcribed.
if (LZFU_INIT_DICT.length !== 207) {
  throw new Error(
    `lzfu.ts: LZFU_INIT_DICT must be exactly 207 bytes (MS-OXRTFCP section 2.1.2.1), got ${LZFU_INIT_DICT.length}`,
  );
}

const DICT_SIZE = 4096;
const MAX_RAW_BYTES = 64 * 1024 * 1024;

/** Decompress a PR_RTF_COMPRESSED stream. Never throws —
 *  a corrupt body must never lose the message. */
export function decompressRtf(input: Uint8Array): Uint8Array {
  if (input.length < 16) return new Uint8Array(0);
  const dv = new DataView(input.buffer, input.byteOffset, input.byteLength);
  const compSize = dv.getUint32(0, true);
  const rawSizeDeclared = dv.getUint32(4, true);
  const magic = new TextDecoder("latin1").decode(input.subarray(8, 12));

  // ★★ Clamp before allocating. Measured real values are 12204 and 102139;
  //  the field is attacker-controlled and can claim 4 GB.
  const rawSize = Math.min(rawSizeDeclared, MAX_RAW_BYTES);

  if (magic === "MELA") return input.subarray(16, Math.min(input.length, 16 + rawSize));
  if (magic !== "LZFu") return new Uint8Array(0);

  const end = Math.min(input.length, 4 + compSize);
  const dict = new Uint8Array(DICT_SIZE);
  const init = new TextEncoder().encode(LZFU_INIT_DICT);
  dict.set(init.subarray(0, Math.min(init.length, DICT_SIZE)));
  let writeAt = init.length % DICT_SIZE;

  const out = new Uint8Array(rawSize);
  let produced = 0;
  let pos = 16;

  while (pos < end && produced < rawSize) {
    const control = input[pos++];
    for (let bit = 0; bit < 8 && pos < end && produced < rawSize; bit++) {
      if ((control & (1 << bit)) === 0) {
        const byte = input[pos++];
        out[produced++] = byte;
        dict[writeAt] = byte;
        writeAt = (writeAt + 1) % DICT_SIZE;
        continue;
      }
      if (pos + 1 >= end) return out.subarray(0, produced);
      const token = (input[pos] << 8) | input[pos + 1];
      pos += 2;
      const offset = (token >> 4) & 0xfff;
      const length = (token & 0x0f) + 2;
      if (offset === writeAt) return out.subarray(0, produced); // end marker
      for (let i = 0; i < length && produced < rawSize; i++) {
        // ★ Bounds-checked back-reference into the 4096-byte ring buffer.
        const byte = dict[(offset + i) % DICT_SIZE];
        out[produced++] = byte;
        dict[writeAt] = byte;
        writeAt = (writeAt + 1) % DICT_SIZE;
      }
    }
  }
  return out.subarray(0, produced);
}

/** Remove every `{\destname ...}` (or `{\*\destname ...}`) group for the given
 *  destination name, at ANY nesting depth. ★ A single non-nesting-aware regex
 *  (`[^{}]*(\{[^{}]*\})*[^{}]*`) only tolerates exactly one level of nested
 *  braces and silently leaves deeper ones — e.g. `{\fonttbl{\f0 Arial;}}` —
 *  partially un-stripped, which is a metadata leak into the "readable text"
 *  this function promises. Depth-counting from the opening brace is the only
 *  correct way to find the matching close. */
function stripDestinationGroups(input: string, dest: string): string {
  // ★★★ THE DELIMITER IS `(?![A-Za-z])`, NEVER `\b`, and this was a shipped
  //  defect rather than a hypothetical. Per the RTF specification a control
  //  word ends at the first NON-ALPHABETIC character, with an OPTIONAL numeric
  //  parameter following it — so real Outlook writes `\htmltag19`,
  //  `\htmltag34`, `\htmltag161`. A digit is a WORD character and so is the
  //  `g` before it, so `\b` finds no boundary there and the group is never
  //  stripped: measured on this repo's own real `.msg` fixture, all 108
  //  `\htmltag<digit>` groups survived, `rtfToPlainText` returned 40,948
  //  characters of Word `<style>` preamble carrying 531 residual HTML tags,
  //  and the message text sat at index 38,329 — past `MAIL_BODY_FLOOR`, so the
  //  model received the preamble and never the body. The same fixture under
  //  this delimiter yields 75 characters and 0 residual tags.
  const open = new RegExp(`^\\{(?:\\\\\\*)?\\\\${dest}(?![A-Za-z])`, "i");
  let out = "";
  let i = 0;
  while (i < input.length) {
    if (input[i] === "{" && open.test(input.slice(i))) {
      let depth = 0;
      let j = i;
      for (; j < input.length; j++) {
        if (input[j] === "{") depth++;
        else if (input[j] === "}") {
          depth--;
          if (depth === 0) {
            j++;
            break;
          }
        }
      }
      // ★★★ LEAVE AN EMPTY GROUP BEHIND, NEVER NOTHING. Removing the group
      //  outright can butt the control word BEFORE it against the literal text
      //  AFTER it — `\ansi{\*\htmltag19 …}VISIBLE` collapses to `\ansiVISIBLE`
      //  — and `rtfToPlainText`'s catch-all control-word strip is greedy on
      //  `[a-zA-Z]+`, so it eats the visible text as part of the control word's
      //  name. Measured before this line existed:
      //  `{\rtf1\ansi{\*\htmltag19 <b>tag</b>}VISIBLE\par` returned "".
      //  ★★ `{}` rather than a SPACE, and that choice is load-bearing: braces
      //  are stripped only AFTER whitespace-sensitive processing, so a null
      //  group both terminates a control word (a brace is non-alphabetic) and
      //  leaves the output unchanged everywhere the defect does not bite —
      //  measured on the real `.msg` fixture, whose 75-character body decodes
      //  identically under `{}`, under a space AND under no replacement at all.
      //  A space is NOT interchangeable: it would put a space INSIDE a word
      //  that a stripped group had split, turning `Hel{\*\htmltag19 <b>}lo`
      //  into "Hel lo", which is the ordinary shape of a de-encapsulated body.
      //  ★★ So the fixture cannot discriminate any of the three, and the unit
      //  test in `lzfu.test.ts` is the only thing that can — in either
      //  direction.
      //  ★ It is also inert on the remaining passes of the caller's
      //  destination loop: `{}` matches no destination name, and being balanced
      //  it cannot disturb the depth counting of an enclosing group.
      out += "{}";
      i = j;
      continue;
    }
    out += input[i];
    i++;
  }
  return out;
}

/** RTF -> plain text.
 *  ★★ Not a full RTF renderer and must not become one: the goal is readable
 *  text for a model, so groups that carry no reader-visible content are dropped
 *  wholesale rather than interpreted.
 *  ★★ IT DOES NOT DE-ENCAPSULATE HTML, and this line used to say it did. For a
 *  `\fromhtml1` message it DISCARDS the `\htmltag` groups that carry the HTML
 *  markup and keeps the interleaved literal text; it never reconstructs or
 *  parses an HTML document. That is the right trade for feeding a model plain
 *  text, but a caller wanting the original HTML will not find it here. */
export function rtfToPlainText(rtf: string): string {
  let s = rtf;
  // Destination groups whose content is metadata, never body text.
  for (const dest of ["fonttbl", "colortbl", "stylesheet", "info", "generator", "pntext", "htmltag"]) {
    s = stripDestinationGroups(s, dest);
  }
  s = s.replace(/\\par[d]?\b/g, "\n");
  s = s.replace(/\\tab\b/g, "\t");
  s = s.replace(/\\line\b/g, "\n");
  s = s.replace(/\\'([0-9a-fA-F]{2})/g, (_m, h: string) =>
    new TextDecoder("windows-1252").decode(new Uint8Array([Number.parseInt(h, 16)])));
  // ★★★ `\uN` CARRIES A SIGNED 16-BIT VALUE, so Word and Outlook write every
  //  code point above U+7FFF as a NEGATIVE number and every non-BMP character
  //  as a negative SURROGATE PAIR. Reading the sign literally and rejecting it
  //  (the `code >= 0` this replaced) silently deleted CJK above U+8000, every
  //  fullwidth form and every emoji from an `rtf-degraded` body: measured,
  //  `A\u-223 B` produced "AB" where the character is U+FF21. Adding 65536
  //  recovers the unsigned code unit the writer meant.
  //  ★★ `String.fromCodePoint` is the RIGHT builder for a surrogate half and
  //  needs no pairing logic here: D800..DFFF are valid code point VALUES, so it
  //  returns that single code unit (it throws only below 0 or above 0x10FFFF),
  //  and the two halves of a pair — emitted by two separate replacements —
  //  recombine into one astral character purely by being adjacent. An UNPAIRED
  //  half therefore stays one unpaired code unit instead of throwing or
  //  consuming the text after it; hostile input can produce one.
  //  ★★★ THE SIGNED-16 TEST MUST RUN ON `signed`, NOT ON THE CORRECTED VALUE,
  //  and this is where an earlier revision got it wrong in the dangerous
  //  direction. The comment claimed an out-of-range negative was "still
  //  dropped rather than wrapping onto some real character", and the test
  //  sampled `\u-70000` — but `signed + 0x10000` corrects ANY negative, so
  //  only values at or below -65536 land back under zero and get dropped.
  //  Everything in -65535..-32769 is equally out of range and was corrected
  //  anyway: measured, `\u-40000` minted U+63C0, a real CJK character, into
  //  text handed to the model. The claimed bound and the actual bound agreed
  //  at exactly the one value the test used. RTF gives `\uN` no meaning
  //  outside signed 16 bits, so fabricating a character is strictly worse
  //  than dropping one — reject before correcting.
  s = s.replace(/\\u(-?\d+)\s?\??/g, (_m, n: string) => {
    const signed = Number.parseInt(n, 10);
    if (signed < -0x8000 || signed > 0xffff) return "";
    const code = signed < 0 ? signed + 0x10000 : signed;
    return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
  });
  s = s.replace(/\\[a-zA-Z]+-?\d*\s?/g, ""); // remaining control words
  s = s.replace(/[{}]/g, "");
  s = s.replace(/\\\\/g, "\\");
  s = s.replace(/[ \t]+/g, " ");
  s = s.split("\n").map((l) => l.trim()).join("\n");
  return s.replace(/\n{3,}/g, "\n\n").trim();
}
