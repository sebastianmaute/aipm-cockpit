// Minimal plain-text ↔ Atlassian Document Format (ADF) converter.
//
// ADF is a JSON document tree used by Jira Cloud for rich-text fields like
// `description`. We don't try to round-trip rich formatting — headings, bold,
// links, tables, code blocks all flatten to plain text on import. On export we
// write a flat doc with one paragraph per blank-line-separated block, with
// hard breaks for in-paragraph newlines. This is intentionally lossy: a user
// who relies on rich Jira descriptions will see formatting collapse when
// notes round-trip through this app. For an LOP tracker that's acceptable.
//
// Spec: https://developer.atlassian.com/cloud/jira/platform/apis/document/structure/

type AdfNode = {
  type?: string;
  text?: string;
  content?: AdfNode[];
};

type AdfDoc = {
  type: "doc";
  version: number;
  content: AdfNode[];
};

// --- ADF → plain text ------------------------------------------------------

function inlineToText(nodes: AdfNode[] | undefined): string {
  if (!Array.isArray(nodes)) return "";
  let out = "";
  for (const n of nodes) {
    if (!n || typeof n !== "object") continue;
    if (n.type === "text") out += n.text ?? "";
    else if (n.type === "hardBreak") out += "\n";
    else if (n.type === "mention") {
      // Best-effort: use the mention's text attribute if present.
      const attrs = (n as { attrs?: { text?: string } }).attrs;
      out += attrs?.text ?? "";
    } else if (n.type === "emoji") {
      const attrs = (n as { attrs?: { text?: string; shortName?: string } })
        .attrs;
      out += attrs?.text ?? attrs?.shortName ?? "";
    } else if (Array.isArray(n.content)) {
      out += inlineToText(n.content);
    }
  }
  return out;
}

function listToText(node: AdfNode, ordered: boolean): string {
  if (!Array.isArray(node.content)) return "";
  return node.content
    .map((item, idx) => {
      const text =
        Array.isArray(item.content)
          ? item.content.map((c) => blockToText(c)).join("\n")
          : "";
      const prefix = ordered ? `${idx + 1}. ` : "- ";
      // Indent wrapped lines.
      return text
        .split("\n")
        .map((line, i) => (i === 0 ? prefix + line : "  " + line))
        .join("\n");
    })
    .join("\n");
}

function blockToText(node: AdfNode): string {
  if (!node || typeof node !== "object") return "";
  switch (node.type) {
    case "paragraph":
      return inlineToText(node.content);
    case "heading":
      return inlineToText(node.content);
    case "codeBlock":
      return inlineToText(node.content);
    case "blockquote":
      // Walk children as paragraphs; prefix each line with "> ".
      return (node.content ?? [])
        .map((c) => blockToText(c))
        .join("\n")
        .split("\n")
        .map((l) => "> " + l)
        .join("\n");
    case "bulletList":
      return listToText(node, false);
    case "orderedList":
      return listToText(node, true);
    case "rule":
      return "---";
    case "hardBreak":
      return "";
    default:
      // Fall back to inline extraction for unknown block types.
      return inlineToText(node.content);
  }
}

export function adfToText(adf: unknown): string {
  if (!adf || typeof adf !== "object") return "";
  const root = adf as AdfDoc;
  if (!Array.isArray(root.content)) return "";
  // Blank-line separator between top-level blocks for readability.
  return root.content
    .map((b) => blockToText(b))
    .filter((s) => s.length > 0)
    .join("\n\n");
}

// --- plain text → ADF ------------------------------------------------------

/**
 * Build a minimal ADF doc from plain text. Empty/whitespace-only input
 * produces an empty doc (which clears the Jira field on PUT).
 */
export function textToAdf(text: string): AdfDoc {
  const normalized = (text ?? "").replace(/\r\n?/g, "\n");
  if (!normalized.trim()) {
    return { type: "doc", version: 1, content: [] };
  }
  const paragraphs = normalized.split(/\n{2,}/);
  const content: AdfNode[] = [];
  for (const p of paragraphs) {
    const lines = p.split("\n");
    const inline: AdfNode[] = [];
    for (let i = 0; i < lines.length; i++) {
      if (i > 0) inline.push({ type: "hardBreak" });
      if (lines[i].length > 0) {
        inline.push({ type: "text", text: lines[i] });
      }
    }
    if (inline.length > 0) {
      content.push({ type: "paragraph", content: inline });
    }
  }
  return { type: "doc", version: 1, content };
}
