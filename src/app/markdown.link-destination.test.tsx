import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { Markdown } from "./markdown";

// A link in model text carries a label the model chose, so the reader is shown where it goes: the destination host
// (an email link: the address) after the label, inside the link so a screen reader hears it too, and the full
// address as the tooltip. A label that already names the destination gets nothing added.

describe("Markdown link destination", () => {
  it("shows the host after a label that does not name it, and the full address as the tooltip", () => {
    render(<Markdown text="See [the project plan](https://evil.example/plan?id=1)." />);
    const link = screen.getByRole("link", { name: "the project plan (evil.example)" });
    expect(link).toHaveAttribute("href", "https://evil.example/plan?id=1");
    expect(link).toHaveAttribute("title", "https://evil.example/plan?id=1");
  });

  it("shows the host the browser will open, not the one the text spells", () => {
    render(<Markdown text="[docs](https://Docs.EXAMPLE.com:8443/a) and [shop](https://exämple.com/)" />);
    expect(screen.getByRole("link", { name: "docs (docs.example.com:8443)" })).toBeInTheDocument();
    // An internationalised host is shown in its ASCII form, so a look-alike host cannot pass as the real one.
    expect(screen.getByRole("link", { name: "shop (xn--exmple-cua.com)" })).toBeInTheDocument();
  });

  it("adds nothing when the label IS the destination", () => {
    render(
      <Markdown text="[example.com](https://example.com/x) [https://example.com/y](https://example.com/y) [WWW.Example.com/](https://www.example.com)" />,
    );
    const names = screen.getAllByRole("link").map((a) => a.textContent);
    expect(names).toEqual(["example.com", "https://example.com/y", "WWW.Example.com/"]);
  });

  // A label that only CONTAINS the host, or a longer host that contains it, must not hide it: that is the
  // misleading link this exists to show.
  it.each([
    ["paypal.com", "https://pal.com/login", "pal.com"],
    ["Log in at paypal.com", "https://paypal.co/login", "paypal.co"],
    ["paypal.com (not evil.com)", "https://evil.com", "evil.com"],
    ["notevil.com", "https://www.evil.com", "www.evil.com"],
    ["Visit example.com", "https://example.com", "example.com"],
  ])("shows the host when the label %j only mentions it (%s)", (label, url, host) => {
    render(<Markdown text={`[${label}](${url})`} />);
    expect(screen.getByRole("link", { name: `${label} (${host})` })).toBeInTheDocument();
  });

  it("shows the address of an email link", () => {
    render(<Markdown text="[write to us](mailto:team@corp.example?subject=Hi)" />);
    expect(screen.getByRole("link", { name: "write to us (team@corp.example)" })).toBeInTheDocument();
  });

  it("shows where an email link with no address before its query, or an encoded one, really writes to", () => {
    render(<Markdown text="[support](mailto:?to=attacker%40x.example) [desk](mailto:help%40corp.example)" />);
    expect(screen.getByRole("link", { name: "support (attacker@x.example)" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "desk (help@corp.example)" })).toBeInTheDocument();
  });

  it("leaves a link to the app's own pages as it was", () => {
    render(<Markdown text="[open the plan](/plan#budget)" />);
    const link = screen.getByRole("link", { name: "open the plan" });
    expect(link).not.toHaveAttribute("title");
  });
});
