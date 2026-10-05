// open-followups §154 — the validator must catch each silent Word failure it
// claims to, or a green run over the real packages proves nothing. Every case
// here is a VALID package with exactly one defect injected.
import { describe, expect, it } from "vitest";
import { validateDocxPackage } from "./docx-package-validator";
import { DOC_STYLES, buildDocxPackage } from "../app/ooxml-docx-primitives";
import { createNumberingSink } from "../app/ooxml-docx-numbering";
import { readZipEntries } from "../app/unzip";
import { buildZip } from "../app/zip";

const pkg = (body: string, numberingXml?: string) =>
  buildDocxPackage(body, DOC_STYLES, "portrait", [], [], numberingXml);

const listPart = () => {
  const sink = createNumberingSink();
  const numPr = sink.numPrFor({ ordered: true, depth: 0, index: 0 });
  return { numPr, xml: sink.partXml() };
};

/** Re-zip a package with one part edited, added or removed. */
async function rezip(blob: Blob, edit: (parts: Map<string, string>) => void): Promise<Blob> {
  const parts = new Map<string, string>();
  for (const [path, bytes] of await readZipEntries(await blob.arrayBuffer())) {
    parts.set(path, new TextDecoder().decode(bytes));
  }
  edit(parts);
  return buildZip([...parts].map(([path, data]) => ({ path, data })));
}

const expectOneProblem = async (blob: Blob, fragment: string) => {
  const problems = await validateDocxPackage(blob);
  expect(problems).toHaveLength(1);
  expect(problems[0]).toContain(fragment);
};

describe("validateDocxPackage (§154)", () => {
  it("accepts a valid package, with and without a numbering part", async () => {
    expect(await validateDocxPackage(pkg(`<w:p><w:pPr><w:pStyle w:val="Title"/><w:jc w:val="both"/></w:pPr></w:p>`))).toEqual([]);
    const { numPr, xml } = listPart();
    expect(await validateDocxPackage(pkg(`<w:p><w:pPr><w:pStyle w:val="ListParagraph"/>${numPr}</w:pPr></w:p>`, xml))).toEqual([]);
  });

  it("reports a w:pStyle that styles.xml does not declare", async () => {
    await expectOneProblem(pkg(`<w:p><w:pPr><w:pStyle w:val="Nope"/></w:pPr></w:p>`), `w:pStyle "Nope"`);
  });

  it("reports a w:jc value outside ST_Jc", async () => {
    await expectOneProblem(pkg(`<w:p><w:pPr><w:jc w:val="justify"/></w:pPr></w:p>`), `"justify" is not in ST_Jc`);
  });

  it("reports <w:pPr> and <w:rPr> children out of sequence", async () => {
    await expectOneProblem(
      pkg(`<w:p><w:pPr><w:jc w:val="left"/><w:pStyle w:val="Title"/></w:pPr></w:p>`),
      "out of sequence at <pStyle>",
    );
    await expectOneProblem(
      pkg(`<w:p><w:r><w:rPr><w:color w:val="000000"/><w:b/></w:rPr><w:t>x</w:t></w:r></w:p>`),
      "out of sequence at <b>",
    );
  });

  it("reports a <w:numPr> with numId before ilvl", async () => {
    const { xml } = listPart();
    await expectOneProblem(
      pkg(`<w:p><w:pPr><w:numPr><w:numId w:val="1"/><w:ilvl w:val="0"/></w:numPr></w:pPr></w:p>`, xml),
      "out of sequence at <ilvl>",
    );
  });

  it("reports a child element it does not know rather than skipping it", async () => {
    await expectOneProblem(pkg(`<w:p><w:pPr><w:madeUp/></w:pPr></w:p>`), "<madeUp> this validator does not know");
  });

  it("reports a numId with no numbering part, and one the part does not define", async () => {
    await expectOneProblem(
      pkg(`<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr></w:p>`),
      "has no word/numbering.xml",
    );
    const { xml } = listPart();
    await expectOneProblem(
      pkg(`<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="7"/></w:numPr></w:pPr></w:p>`, xml),
      "w:numId 7 is not defined",
    );
  });

  it("reports a w:num naming an undefined abstractNum", async () => {
    const { numPr, xml } = listPart();
    await expectOneProblem(
      pkg(`<w:p><w:pPr>${numPr}</w:pPr></w:p>`, xml!.replace(`<w:abstractNumId w:val="1"/>`, `<w:abstractNumId w:val="9"/>`)),
      "undefined abstractNum 9",
    );
  });

  it("reports a numbering part no relationship points at", async () => {
    const { numPr, xml } = listPart();
    const blob = await rezip(pkg(`<w:p><w:pPr>${numPr}</w:pPr></w:p>`, xml), (parts) => {
      const rels = parts.get("word/_rels/document.xml.rels")!;
      parts.set("word/_rels/document.xml.rels", rels.replace(/\s*<Relationship Id="rIdNumbering"[^>]*\/>/, ""));
    });
    await expectOneProblem(blob, "no document relationship of the numbering type");
  });

  it("reports a part with no content type, and an override for a missing part", async () => {
    await expectOneProblem(await rezip(pkg("<w:p/>"), (p) => p.set("word/extra.bin", "x")), "word/extra.bin: no content type");
    // Deleting a part also orphans its relationship, so both are reported.
    const problems = await validateDocxPackage(await rezip(pkg("<w:p/>"), (p) => p.delete("word/styles.xml")));
    expect(problems).toContain("[Content_Types].xml: override for missing part /word/styles.xml");
    expect(problems).toContain("word/_rels/document.xml.rels: rId1 targets missing part word/styles.xml");
  });

  it("reports a part whose content type is present but wrong", async () => {
    const { numPr, xml } = listPart();
    const blob = await rezip(pkg(`<w:p><w:pPr>${numPr}</w:pPr></w:p>`, xml), (parts) => {
      const types = parts.get("[Content_Types].xml")!;
      parts.set("[Content_Types].xml", types.replace("wordprocessingml.numbering+xml", "wordprocessingml.numbring+xml"));
    });
    await expectOneProblem(blob, `/word/numbering.xml has content type`);
  });

  it("reports a relationship whose target part is missing", async () => {
    const blob = await rezip(pkg("<w:p/>"), (parts) => {
      const rels = parts.get("word/_rels/document.xml.rels")!;
      parts.set(
        "word/_rels/document.xml.rels",
        rels.replace("</Relationships>", `<Relationship Id="rId9" Type="x" Target="media/gone.png"/></Relationships>`),
      );
    });
    await expectOneProblem(blob, "rId9 targets missing part word/media/gone.png");
  });

  it("reports a body reference to an undefined relationship", async () => {
    await expectOneProblem(
      pkg(`<w:p><w:hyperlink xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId42"/></w:p>`),
      "undefined relationship rId42",
    );
  });

  it("reports a part that is not well-formed XML", async () => {
    const problems = await validateDocxPackage(await rezip(pkg("<w:p/>"), (p) => p.set("word/styles.xml", "<w:styles>")));
    expect(problems).toContain("word/styles.xml: not well-formed XML");
  });
});
