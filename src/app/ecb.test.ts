import { describe, expect, test } from "vitest";
import { parseEcbDailyXml } from "./ecb";

const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref">
 <Cube>
  <Cube time='2026-05-26'>
   <Cube currency='USD' rate='1.0823'/>
   <Cube currency='GBP' rate='0.8512'/>
   <Cube currency='JPY' rate='168.2'/>
  </Cube>
 </Cube>
</gesmes:Envelope>`;

describe("parseEcbDailyXml", () => {
  test("extracts date and EUR-base rates (only supported currencies + EUR=1)", () => {
    const fx = parseEcbDailyXml(SAMPLE, "2026-05-26T10:00:00Z")!;
    expect(fx.base).toBe("EUR");
    expect(fx.date).toBe("2026-05-26");
    expect(fx.rates).toEqual({ EUR: 1, USD: 1.0823, GBP: 0.8512 });
  });
  test("returns null on malformed XML", () => {
    expect(parseEcbDailyXml("<nope/>", "x")).toBeNull();
  });

  test("returns null when no time attribute is present", () => {
    const noTime = `<Cube><Cube><Cube currency='USD' rate='1.08'/></Cube></Cube>`;
    expect(parseEcbDailyXml(noTime, "x")).toBeNull();
  });

  test("drops a zero or non-positive rate but still returns EUR=1", () => {
    const xml = `<Cube time='2026-05-26'><Cube currency='USD' rate='0'/></Cube>`;
    const fx = parseEcbDailyXml(xml, "x")!;
    expect(fx).not.toBeNull();
    expect(fx.rates).toEqual({ EUR: 1 }); // USD dropped (rate not > 0)
  });

  test("excludes unsupported currencies while keeping EUR=1", () => {
    const xml = `<Cube time='2026-05-26'><Cube currency='JPY' rate='168.2'/></Cube>`;
    const fx = parseEcbDailyXml(xml, "x")!;
    expect(fx.rates).toEqual({ EUR: 1 });
  });
});
