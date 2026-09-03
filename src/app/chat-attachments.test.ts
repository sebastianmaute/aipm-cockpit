// src/app/chat-attachments.test.ts — pure unit tests for chat attachment classifier/builder
import { describe, it, expect } from "vitest";
import {
  classifyAttachment,
  buildAttachmentBlock,
  checkAttachmentSize,
  MAX_ATTACHMENT_BYTES,
  ATTACHMENT_ACCEPT,
  type AttachmentKind,
  type AttachmentBlock,
  type ImageBlock,
  type DocumentBlock,
} from "./chat-attachments";

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

  it("classifies text/html as text", () => {
    expect(classifyAttachment("text/html", "page.html")).toBe("text");
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

  it("falls back to .html extension → text", () => {
    expect(classifyAttachment(GENERIC, "page.HTML")).toBe("text");
  });

  it("falls back to .htm extension → text", () => {
    expect(classifyAttachment(GENERIC, "page.htm")).toBe("text");
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
                       ".vtt", ".docx", ".xlsx", ".xlsm", ".pptx"]) {
      expect(tokens).toContain(ext);
      expect(classifyAttachment("application/octet-stream", `f${ext}`)).not.toBeNull();
    }
  });

  it("offers the MIME types too, so an extensionless file still passes the picker", () => {
    const tokens = ATTACHMENT_ACCEPT.split(",");
    expect(tokens).toContain("application/pdf");
    expect(tokens).toContain("text/plain");
    expect(tokens).toContain("image/*");
  });

  it("lists no token twice", () => {
    const tokens = ATTACHMENT_ACCEPT.split(",");
    expect(new Set(tokens).size).toBe(tokens.length);
  });
});
