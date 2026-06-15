import { describe, it, expect } from "vitest";
import { htmlToPlainText } from "./html-to-text";

describe("htmlToPlainText", () => {
  it("converts block tags + br to newlines and strips tags", () => {
    expect(htmlToPlainText("<p>Hi</p><p>There</p>")).toBe("Hi\nThere");
    expect(htmlToPlainText("a<br>b")).toBe("a\nb");
    expect(htmlToPlainText("<b>bold</b> <i>x</i>")).toBe("bold x");
  });
  it("decodes common entities", () => {
    expect(htmlToPlainText("A &amp; B &lt;x&gt; &nbsp;y")).toBe("A & B <x>  y");
  });
  it("collapses 3+ blank lines and trims", () => {
    expect(htmlToPlainText("<p>a</p><br><br><br><p>b</p>")).toBe("a\n\nb");
  });
});
