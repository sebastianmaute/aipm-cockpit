// src/app/chat-attachments.test.ts — pure unit tests for chat attachment classifier/builder
import { describe, it, expect } from "vitest";
import {
  classifyAttachment,
  buildAttachmentBlock,
  checkAttachmentSize,
  MAX_ATTACHMENT_BYTES,
  MAX_MAIL_BYTES,
  ATTACHMENT_ACCEPT,
  PDF_EXTENSIONS,
  IMAGE_EXTENSIONS,
  TEXT_EXTENSIONS,
  HTML_EXTENSIONS,
  OFFICE_EXTENSIONS,
  MAIL_EXTENSIONS,
  type AttachmentKind,
  type AttachmentBlock,
  type ImageBlock,
  type DocumentBlock,
} from "./chat-attachments";
import { loadI18n, t } from "./i18n";

// ---------------------------------------------------------------------------
// classifyAttachment — mime-type path
// ---------------------------------------------------------------------------
describe("classifyAttachment — mime type", () => {
  it("classifies application/pdf as pdf", () => {
    // Arrange + Act + Assert
    expect(classifyAttachment("application/pdf", "file.pdf")).toBe("pdf");
  });

  it("classifies image/png as image", () => {
    expect(classifyAttachment("image/png", "photo.png")).toBe("image");
  });

  it("classifies image/jpeg as image", () => {
    expect(classifyAttachment("image/jpeg", "photo.jpg")).toBe("image");
  });

  it("classifies image/gif as image", () => {
    expect(classifyAttachment("image/gif", "anim.gif")).toBe("image");
  });

  it("classifies image/webp as image", () => {
    expect(classifyAttachment("image/webp", "photo.webp")).toBe("image");
  });

  it("classifies text/plain as text", () => {
    expect(classifyAttachment("text/plain", "notes.txt")).toBe("text");
  });

  it("classifies text/markdown as text", () => {
    expect(classifyAttachment("text/markdown", "readme.md")).toBe("text");
  });

  it("classifies text/csv as text", () => {
    expect(classifyAttachment("text/csv", "data.csv")).toBe("text");
  });

  it("classifies text/html as html, not text", () => {
    expect(classifyAttachment("text/html", "page.html")).toBe("html");
  });

  it("classifies text/vtt as text", () => {
    expect(classifyAttachment("text/vtt", "transcript.vtt")).toBe("text");
  });

  it("returns null for unsupported mime application/zip", () => {
    expect(classifyAttachment("application/zip", "archive.zip")).toBeNull();
  });

  it("returns null for unsupported mime application/x-msdownload", () => {
    expect(classifyAttachment("application/x-msdownload", "setup.exe")).toBeNull();
  });

  it("returns null for unsupported image subtype image/tiff", () => {
    expect(classifyAttachment("image/tiff", "scan.tiff")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// classifyAttachment — extension fallback (mime = application/octet-stream)
// ---------------------------------------------------------------------------
describe("classifyAttachment — extension fallback", () => {
  const GENERIC = "application/octet-stream";

  it("falls back to .pdf extension → pdf", () => {
    expect(classifyAttachment(GENERIC, "document.pdf")).toBe("pdf");
  });

  it("falls back to .png extension → image", () => {
    expect(classifyAttachment(GENERIC, "photo.PNG")).toBe("image");
  });

  it("falls back to .jpg extension → image", () => {
    expect(classifyAttachment(GENERIC, "photo.jpg")).toBe("image");
  });

  it("falls back to .jpeg extension → image", () => {
    expect(classifyAttachment(GENERIC, "photo.JPEG")).toBe("image");
  });

  it("falls back to .gif extension → image", () => {
    expect(classifyAttachment(GENERIC, "anim.GIF")).toBe("image");
  });

  it("falls back to .webp extension → image", () => {
    expect(classifyAttachment(GENERIC, "photo.webp")).toBe("image");
  });

  it("falls back to .txt extension → text", () => {
    expect(classifyAttachment(GENERIC, "notes.TXT")).toBe("text");
  });

  it("falls back to .md extension → text", () => {
    expect(classifyAttachment(GENERIC, "readme.md")).toBe("text");
  });

  it("falls back to .markdown extension → text", () => {
    expect(classifyAttachment(GENERIC, "README.MARKDOWN")).toBe("text");
  });

  it("falls back to .csv extension → text", () => {
    expect(classifyAttachment(GENERIC, "data.csv")).toBe("text");
  });

  it("falls back to .html extension → html", () => {
    expect(classifyAttachment(GENERIC, "page.HTML")).toBe("html");
  });

  it("falls back to .htm extension → html", () => {
    expect(classifyAttachment(GENERIC, "page.htm")).toBe("html");
  });

  it("falls back to .vtt extension → text", () => {
    expect(classifyAttachment(GENERIC, "captions.VTT")).toBe("text");
  });

  it("returns null for unknown extension .exe", () => {
    expect(classifyAttachment(GENERIC, "setup.exe")).toBeNull();
  });

  it("classifies .docx extension as office (Office ingestion)", () => {
    expect(classifyAttachment(GENERIC, "report.docx")).toBe("office");
  });
});

// ---------------------------------------------------------------------------
// Office (OOXML) support
// ---------------------------------------------------------------------------
describe("chat-attachments office support", () => {
  it("classifies the four Office formats as 'office'", () => {
    expect(
      classifyAttachment(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "a.docx",
      ),
    ).toBe("office");
    expect(classifyAttachment("application/octet-stream", "b.xlsx")).toBe("office");
    expect(classifyAttachment("", "c.xlsm")).toBe("office");
    expect(classifyAttachment("", "d.pptx")).toBe("office");
  });

  it("builds a text document block for an office attachment (data = extracted Markdown)", () => {
    const block = buildAttachmentBlock("office", "application/octet-stream", "## Sheet: A\n\n| x |");
    expect(block).toEqual({
      type: "document",
      source: { type: "text", media_type: "text/plain", data: "## Sheet: A\n\n| x |" },
    });
  });
});

// ---------------------------------------------------------------------------
// checkAttachmentSize
// ---------------------------------------------------------------------------
describe("checkAttachmentSize", () => {
  it("returns null when byte length is exactly MAX_ATTACHMENT_BYTES", () => {
    expect(checkAttachmentSize(MAX_ATTACHMENT_BYTES)).toBeNull();
  });

  it("returns null when byte length is below the limit", () => {
    expect(checkAttachmentSize(0)).toBeNull();
    expect(checkAttachmentSize(1024)).toBeNull();
    expect(checkAttachmentSize(MAX_ATTACHMENT_BYTES - 1)).toBeNull();
  });

  it("returns 'too-large' when byte length exceeds MAX_ATTACHMENT_BYTES", () => {
    expect(checkAttachmentSize(MAX_ATTACHMENT_BYTES + 1)).toBe("too-large");
    expect(checkAttachmentSize(MAX_ATTACHMENT_BYTES * 2)).toBe("too-large");
  });

  it("MAX_ATTACHMENT_BYTES equals 20 MB", () => {
    expect(MAX_ATTACHMENT_BYTES).toBe(20 * 1024 * 1024);
  });

  // ★★ MEASURED. A real workshop mail with one .pptx attached was 17.8 MB —
  //  89% of the old 20 MB cap. Mail envelopes carry their attachments inline,
  //  so the envelope must be allowed to be larger than any one attachment.
  it("allows a mail envelope larger than the flat-file cap", () => {
    expect(checkAttachmentSize(30 * 1024 * 1024, "mail")).toBeNull();
    expect(checkAttachmentSize(30 * 1024 * 1024, "text")).toBe("too-large");
    expect(checkAttachmentSize(70 * 1024 * 1024, "mail")).toBe("too-large");
  });
});

// ---------------------------------------------------------------------------
// buildAttachmentBlock — pdf
// ---------------------------------------------------------------------------
describe("buildAttachmentBlock — pdf", () => {
  it("produces a document block with base64 source and application/pdf media_type", () => {
    // Arrange
    const kind: AttachmentKind = "pdf";
    const base64Data = "JVBERi0xLjQ="; // fake base64

    // Act
    const block = buildAttachmentBlock(kind, "application/pdf", base64Data);

    // Assert
    expect(block.type).toBe("document");
    const doc = block as DocumentBlock;
    expect(doc.source.type).toBe("base64");
    expect(doc.source.media_type).toBe("application/pdf");
    expect(doc.source.data).toBe(base64Data);
  });

  it("returns a new object on each call (immutable)", () => {
    const a = buildAttachmentBlock("pdf", "application/pdf", "abc");
    const b = buildAttachmentBlock("pdf", "application/pdf", "abc");
    expect(a).not.toBe(b);
  });
});

// ---------------------------------------------------------------------------
// buildAttachmentBlock — image
// ---------------------------------------------------------------------------
describe("buildAttachmentBlock — image", () => {
  it("produces an image block with base64 source for image/png", () => {
    // Arrange
    const kind: AttachmentKind = "image";
    const base64Data = "iVBORw0KGgo=";

    // Act
    const block = buildAttachmentBlock(kind, "image/png", base64Data);

    // Assert
    expect(block.type).toBe("image");
    const img = block as ImageBlock;
    expect(img.source.type).toBe("base64");
    expect(img.source.media_type).toBe("image/png");
    expect(img.source.data).toBe(base64Data);
  });

  it("normalizes image/jpg to image/jpeg", () => {
    const block = buildAttachmentBlock("image", "image/jpg", "abc") as ImageBlock;
    expect(block.source.media_type).toBe("image/jpeg");
  });

  it("preserves image/jpeg unchanged", () => {
    const block = buildAttachmentBlock("image", "image/jpeg", "abc") as ImageBlock;
    expect(block.source.media_type).toBe("image/jpeg");
  });

  it("preserves image/gif", () => {
    const block = buildAttachmentBlock("image", "image/gif", "abc") as ImageBlock;
    expect(block.source.media_type).toBe("image/gif");
  });

  it("preserves image/webp", () => {
    const block = buildAttachmentBlock("image", "image/webp", "abc") as ImageBlock;
    expect(block.source.media_type).toBe("image/webp");
  });

  it("returns a new object on each call (immutable)", () => {
    const a = buildAttachmentBlock("image", "image/png", "abc");
    const b = buildAttachmentBlock("image", "image/png", "abc");
    expect(a).not.toBe(b);
  });
});

// ---------------------------------------------------------------------------
// buildAttachmentBlock — text
// ---------------------------------------------------------------------------
describe("buildAttachmentBlock — text", () => {
  it("produces a document block with text source and text/plain media_type", () => {
    // Arrange
    const kind: AttachmentKind = "text";
    const utf8Text = "Hello, world!\nSecond line.";

    // Act
    const block = buildAttachmentBlock(kind, "text/plain", utf8Text);

    // Assert
    expect(block.type).toBe("document");
    const doc = block as DocumentBlock;
    expect(doc.source.type).toBe("text");
    expect(doc.source.media_type).toBe("text/plain");
    expect(doc.source.data).toBe(utf8Text);
  });

  it("forces media_type to text/plain even when mime is text/markdown", () => {
    const block = buildAttachmentBlock("text", "text/markdown", "# heading") as DocumentBlock;
    expect(block.source.media_type).toBe("text/plain");
  });

  it("forces media_type to text/plain even when mime is text/csv", () => {
    const block = buildAttachmentBlock("text", "text/csv", "a,b\n1,2") as DocumentBlock;
    expect(block.source.media_type).toBe("text/plain");
  });

  it("returns a new object on each call (immutable)", () => {
    const a = buildAttachmentBlock("text", "text/plain", "hi");
    const b = buildAttachmentBlock("text", "text/plain", "hi");
    expect(a).not.toBe(b);
  });
});

// ---------------------------------------------------------------------------
// Type narrowing smoke test — AttachmentBlock union is usable
// ---------------------------------------------------------------------------
describe("AttachmentBlock type narrowing", () => {
  it("can narrow an AttachmentBlock to ImageBlock by type discriminant", () => {
    const block: AttachmentBlock = buildAttachmentBlock("image", "image/png", "data");
    if (block.type === "image") {
      // TypeScript should accept this without error
      const _img: ImageBlock = block;
      expect(_img.source.type).toBe("base64");
    }
  });

  it("can narrow an AttachmentBlock to DocumentBlock by type discriminant", () => {
    const block: AttachmentBlock = buildAttachmentBlock("pdf", "application/pdf", "data");
    if (block.type === "document") {
      const _doc: DocumentBlock = block;
      expect(_doc.source.type).toBe("base64");
    }
  });
});

// ---------------------------------------------------------------------------
// ATTACHMENT_ACCEPT — single source for every file picker's accept= string
// ---------------------------------------------------------------------------
describe("ATTACHMENT_ACCEPT", () => {
  // ★ THE DEFECT THIS EXISTS FOR. Three consumers hand-wrote this string and
  //  drifted: the wizard's list was a strict subset missing .markdown and every
  //  MIME type, so a correctly-typed file with no extension was filtered out of
  //  its picker while classifyAttachment would have accepted it.
  it("offers every extension classifyAttachment accepts", () => {
    const tokens = ATTACHMENT_ACCEPT.split(",");
    for (const ext of [".pdf", ".png", ".jpg", ".jpeg", ".gif", ".webp",
                       ".txt", ".md", ".markdown", ".csv", ".html", ".htm",
                       ".vtt", ".docx", ".xlsx", ".xlsm", ".pptx",
                       ".eml", ".mhtml", ".mht", ".msg"]) {
      expect(tokens).toContain(ext);
      expect(classifyAttachment("application/octet-stream", `f${ext}`)).not.toBeNull();
    }
    // A seventh extension set added to ATTACHMENT_ACCEPT's spread and forgotten
    // above would be invisible to the loop — pin the count too.
    expect(tokens.filter((t) => t.startsWith(".")).length).toBe(22);
  });

  // ★ Round-trips every DERIVED token, not just a fixed trio — 8 of the 11
  //  ACCEPT_MIMES entries carried no assertion before this, and they are the
  //  longest, most typo-prone strings in the file (e.g. a single dropped "s"
  //  in "spreadsheetml.sheet" leaves the whole suite green while the picker
  //  silently stops matching extensionless .xlsx files). image/* is excluded:
  //  it is a wildcard, not a concrete type classifyAttachment recognises.
  it("offers the MIME types too, so an extensionless file still passes the picker", () => {
    const tokens = ATTACHMENT_ACCEPT.split(",");
    expect(tokens).toContain("application/pdf");
    expect(tokens).toContain("text/plain");
    expect(tokens).toContain("image/*");
    // Pins the MIME-token count so emptying ACCEPT_MIMES down to just
    // "image/*" (which the loop below skips) still fails: the loop over an
    // absent token does nothing, so this count is the only thing that would
    // catch it.
    expect(tokens.filter((t) => !t.startsWith(".")).length).toBe(14);
    for (const token of tokens) {
      if (token === "image/*") continue;
      if (token.startsWith(".")) {
        expect(classifyAttachment("application/octet-stream", `file${token}`)).not.toBeNull();
      } else {
        expect(classifyAttachment(token, "file")).not.toBeNull();
      }
    }
  });

  it("lists no token twice", () => {
    const tokens = ATTACHMENT_ACCEPT.split(",");
    expect(new Set(tokens).size).toBe(tokens.length);
  });
});

describe("html classification", () => {
  it("classifies html as its own kind, not as text", () => {
    expect(classifyAttachment("text/html", "page.html")).toBe("html");
    expect(classifyAttachment("application/octet-stream", "page.htm")).toBe("html");
  });

  it("still classifies plain text as text", () => {
    expect(classifyAttachment("text/plain", "notes.txt")).toBe("text");
    expect(classifyAttachment("text/csv", "rows.csv")).toBe("text");
  });

  it("builds a text block for html, since the caller passes extracted Markdown", () => {
    expect(buildAttachmentBlock("html", "text/html", "## Title")).toEqual({
      type: "document",
      source: { type: "text", media_type: "text/plain", data: "## Title" },
    });
  });
});

describe("mail classification", () => {
  it("classifies eml, mhtml and mht as mail", () => {
    expect(classifyAttachment("message/rfc822", "a.eml")).toBe("mail");
    expect(classifyAttachment("application/octet-stream", "a.eml")).toBe("mail");
    expect(classifyAttachment("application/octet-stream", "page.mhtml")).toBe("mail");
    expect(classifyAttachment("multipart/related", "page.mht")).toBe("mail");
  });

  it("offers the mail extensions in the shared accept list", () => {
    const tokens = ATTACHMENT_ACCEPT.split(",");
    for (const ext of [".eml", ".mhtml", ".mht", ".msg"]) expect(tokens).toContain(ext);
  });

  // ★ Pins the MIME half of the mail branch on its own, with no mail
  //  extension in the filename to fall back on. Every other multipart/related
  //  assertion in this file pairs it with ".mht", so the extension fallback
  //  alone would keep them green even if this MIME check were deleted.
  it("classifies multipart/related as mail from the MIME type alone", () => {
    expect(classifyAttachment("multipart/related", "file")).toBe("mail");
  });

  // ★ .msg is BINARY (CFBF), unlike eml/mhtml/mht — see mail-extract.ts.
  //  classifyAttachment itself never sees the bytes, only mime/filename, but
  //  it must still route .msg to "mail" alongside the text formats so the
  //  orchestrator's format-aware parseMail (not a text decode) is reached.
  it("classifies msg as mail and offers it in the picker", () => {
    expect(classifyAttachment("application/vnd.ms-outlook", "a.msg")).toBe("mail");
    expect(classifyAttachment("application/octet-stream", "a.msg")).toBe("mail");
    expect(ATTACHMENT_ACCEPT.split(",")).toContain(".msg");
  });
});

// ---------------------------------------------------------------------------
// The picker's hint against the picker's own accept list
// ---------------------------------------------------------------------------

/** ★★★ THE HINT IS THE ONLY PLACE A USER LEARNS WHAT THEY MAY ATTACH, and
 *  nothing tied it to `ATTACHMENT_ACCEPT` — so it under-disclosed by THREE
 *  whole families and one cap while every test in this file stayed green. It
 *  read "PDF, image (PNG/JPG/GIF/WebP), or text (TXT/MD/CSV) files — up to 20 MB
 *  each" long after HTML, Office and mail were accepted, and after mail gained
 *  the wider `MAX_MAIL_BYTES` envelope. A user with a `.msg` was told to convert
 *  it; the picker would have taken it.
 *
 *  ★★ The families are read from the SAME sets `classifyAttachment` and
 *  `ATTACHMENT_ACCEPT` consult, so a NEW family is covered the moment it is
 *  declared — not when somebody remembers to extend a list here. */
const HINT_FAMILIES: ReadonlyArray<{ family: string; exts: ReadonlySet<string> }> = [
  { family: "pdf", exts: PDF_EXTENSIONS },
  { family: "image", exts: IMAGE_EXTENSIONS },
  { family: "text", exts: TEXT_EXTENSIONS },
  { family: "html", exts: HTML_EXTENSIONS },
  { family: "office", exts: OFFICE_EXTENSIONS },
  { family: "mail", exts: MAIL_EXTENSIONS },
];

/** Families the hint never names. Returns the NAMES rather than a boolean so a
 *  red run says which family went undisclosed, which is the whole finding. */
function familiesMissingFrom(hint: string): string[] {
  const upper = hint.toUpperCase();
  return HINT_FAMILIES.filter(
    (f) => ![...f.exts].some((ext) => upper.includes(ext.slice(1).toUpperCase())),
  ).map((f) => f.family);
}

describe("JSON attachments", () => {
  it("classifies a .json file as text by extension", () => {
    expect(classifyAttachment("", "sample-workspace-small.json")).toBe("text");
  });
  it("classifies application/json as text by MIME", () => {
    expect(classifyAttachment("application/json", "noext")).toBe("text");
  });
  it("offers .json in the shared picker accept list", () => {
    const parts = ATTACHMENT_ACCEPT.split(",");
    expect(parts).toContain(".json");
    expect(parts).toContain("application/json");
  });
});

describe("the attachment hint discloses what the picker accepts", () => {
  // ★★★ THE NEGATIVE CONTROL, AND IT RUNS FIRST ON PURPOSE. A predicate that
  //  cannot fail passes every hint, including an empty one — and this exact
  //  shape (an absence assertion with no positive observable) is why the defect
  //  below shipped. The historical string is the fixture: it must report
  //  html + office + mail, and reporting fewer means the predicate is broken,
  //  not that the string was fine.
  it("names every family a hint omits", () => {
    const shipped =
      "Attach PDF, image (PNG/JPG/GIF/WebP), or text (TXT/MD/CSV) files — up to 20 MB each.";
    expect(familiesMissingFrom(shipped)).toEqual(["html", "office", "mail"]);
    expect(familiesMissingFrom("")).toEqual(HINT_FAMILIES.map((f) => f.family));
  });

  it("names every accepted family in English", () => {
    expect(familiesMissingFrom(t("en-US", "chatAttachmentHint"))).toEqual([]);
  });

  // ★ The DE dictionary is lazy — a DE assertion without `loadI18n("de")` reads
  //  the EN fallback and passes for the wrong reason.
  it("names every accepted family in German", async () => {
    await loadI18n("de");
    expect(familiesMissingFrom(t("de", "chatAttachmentHint"))).toEqual([]);
  });

  // ★★ Mail rides `MAX_MAIL_BYTES`, not `MAX_ATTACHMENT_BYTES` — a hint quoting
  //  only the flat-file cap tells a user their 40 MB mailbox export is too
  //  large when `checkAttachmentSize` would admit it. Both numbers are derived,
  //  so raising either cap without re-wording the hint is a red run.
  it("quotes both size caps, in both languages", async () => {
    await loadI18n("de");
    const flat = `${MAX_ATTACHMENT_BYTES / 1024 / 1024} MB`;
    const mail = `${MAX_MAIL_BYTES / 1024 / 1024} MB`;
    expect(flat).not.toBe(mail); // anti-vacuity: two distinct caps, or this proves nothing
    for (const lang of ["en-US", "de"] as const) {
      const hint = t(lang, "chatAttachmentHint");
      expect(hint).toContain(flat);
      expect(hint).toContain(mail);
    }
  });
});
