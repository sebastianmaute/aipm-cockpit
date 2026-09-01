// src/app/ooxml-links.ts — hyperlink targets and relationship ids for the two
// OOXML renderers. Pure and DOM-free: it takes strings and returns strings, so
// it is testable under bare node and safe to import from either renderer.

/** One external relationship. It has NO part — no zip entry, no content-type
 *  Default — which is exactly what `TargetMode="External"` licenses. */
export type LinkRel = { relId: string; target: string };

/** ★★★ THE ALLOWLIST IS A SECOND BOUNDARY, NOT A REPLACEMENT FOR THE SANITIZER.
 *  `sanitizeRichHtml` already admits `<a href>` (`a` is in RICH_ALLOWED_TAGS,
 *  `href` in ALLOWED_ATTR), and that is the right policy for a value rendered
 *  into the app. This is a different question: the value is about to be written
 *  into a package Word will FOLLOW, so it is re-validated at the boundary where
 *  it leaves the app. */
const SAFE_LINK_SCHEMES = new Set(["http:", "https:", "mailto:"]);

/** The href to use, or undefined if this anchor must degrade to a plain run.
 *
 *  ★ A RELATIVE href is dropped, and that is deliberate rather than an
 *  oversight of the parser: `new URL(x)` with no base throws on one, and a
 *  relative path has no meaning at all inside an exported file that has left
 *  the app. There is no base to resolve it against. */
export function safeLinkTarget(raw: string | null | undefined): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (trimmed === "") return undefined;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return undefined;
  }
  // ★ `URL.protocol` is lower-cased by the parser, so "JavaScript:" is caught
  // by the same membership test as "javascript:" with no extra folding here.
  return SAFE_LINK_SCHEMES.has(parsed.protocol) ? trimmed : undefined;
}

/** Mints relationship ids for one relationship SCOPE and remembers what it
 *  minted. A scope is `word/_rels/document.xml.rels` for DOCX and ONE SLIDE's
 *  `ppt/slides/_rels/slideN.xml.rels` for PPTX — never a whole deck.
 *
 *  ★★ `firstFreeIndex` is the caller's job because the two formats reserve
 *  different things: rId1 is the STYLES part in DOCX and the SLIDE LAYOUT in
 *  PPTX, and media parts already hold ids above it. Pass
 *  `2 + <media count in this scope>`.
 *
 *  ★ Deduping by target is not an optimisation — a description repeating one
 *  address would otherwise mint a relationship per occurrence, and the rels
 *  part grows without bound on a link-heavy document. */
export type LinkSink = {
  relIdFor(target: string): string;
  rels(): readonly LinkRel[];
};

export function createLinkSink(firstFreeIndex: number): LinkSink {
  const byTarget = new Map<string, string>();
  const minted: LinkRel[] = [];
  return {
    relIdFor(target: string): string {
      const existing = byTarget.get(target);
      if (existing !== undefined) return existing;
      const relId = `rId${firstFreeIndex + minted.length}`;
      byTarget.set(target, relId);
      minted.push({ relId, target });
      return relId;
    },
    rels: () => minted,
  };
}
