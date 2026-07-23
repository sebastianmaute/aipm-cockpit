import { render } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { Markdown } from "./markdown";

describe("Markdown", () => {
  it("renders **bold** as <strong> (core sanity)", () => {
    const { container } = render(<Markdown text="a **big** deal" />);
    const strong = container.querySelector("strong");
    expect(strong?.textContent).toBe("big");
  });

  it("renders a fenced code block as <pre><code>, preserving newlines and hiding the fences", () => {
    const { container } = render(<Markdown text={"```ts\nconst a = 1;\nconst b = 2;\n```"} />);
    const code = container.querySelector("pre code");
    expect(code).not.toBeNull();
    expect(code?.textContent).toBe("const a = 1;\nconst b = 2;");
    // No literal fence backticks leaked into the rendered text.
    expect(container.textContent).not.toContain("```");
  });

  it("does not inline-parse inside a fenced block (asterisks stay literal)", () => {
    const { container } = render(<Markdown text={"```\nnot **bold** here\n```"} />);
    expect(container.querySelector("strong")).toBeNull();
    expect(container.querySelector("pre code")?.textContent).toBe("not **bold** here");
  });

  it("renders a leading-language fence with no closing fence (unterminated) as code", () => {
    const { container } = render(<Markdown text={"```\nx = 1\ny = 2"} />);
    expect(container.querySelector("pre code")?.textContent).toBe("x = 1\ny = 2");
    expect(container.textContent).not.toContain("```");
  });

  it("renders a GFM pipe table with header + body cells", () => {
    const md = "| Name | Age |\n| --- | --- |\n| Amy | 3 |\n| Bo | 4 |";
    const { container } = render(<Markdown text={md} />);
    const table = container.querySelector("table");
    expect(table).not.toBeNull();
    const th = Array.from(table!.querySelectorAll("thead th")).map((n) => n.textContent);
    expect(th).toEqual(["Name", "Age"]);
    const firstRow = Array.from(table!.querySelectorAll("tbody tr")[0].querySelectorAll("td")).map((n) => n.textContent);
    expect(firstRow).toEqual(["Amy", "3"]);
    expect(table!.querySelectorAll("tbody tr").length).toBe(2);
    // No raw pipes leaked.
    expect(container.textContent).not.toContain("|");
  });

  it("inline-parses table cells (bold inside a cell renders)", () => {
    const md = "| Col |\n| --- |\n| **hi** |";
    const { container } = render(<Markdown text={md} />);
    expect(container.querySelector("tbody strong")?.textContent).toBe("hi");
  });

  it("treats a pipe line with no separator row as a normal paragraph, not a table", () => {
    const { container } = render(<Markdown text={"a | b | c"} />);
    expect(container.querySelector("table")).toBeNull();
    expect(container.textContent).toContain("a | b | c");
  });
});
