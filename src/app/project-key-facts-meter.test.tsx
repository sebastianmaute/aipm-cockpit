import { beforeAll, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { loadI18n } from "./i18n";
import { KEY_FACTS_AMBER_MIN, KeyFactsBanner, KeyFactsMeter } from "./project-key-facts-meter";

function fill(container: HTMLElement) {
  return container.querySelector("[data-key-facts-fill]");
}

describe("KeyFactsMeter", () => {
  it("renders a complete project green with the complete sentence and count", () => {
    const { container } = render(
      <KeyFactsMeter lang="en-US" state={{ kind: "measured", filled: 11, total: 11, missing: [] }} />,
    );
    expect(screen.getByText("Key facts complete")).toBeInTheDocument();
    expect(screen.getByText("11 of 11")).toBeInTheDocument();
    expect(fill(container)?.className).toContain("bg-[var(--rag-green)]");
    expect((fill(container) as HTMLElement).style.width).toBe("100%");
  });

  it(`renders amber from ${KEY_FACTS_AMBER_MIN} filled`, () => {
    const { container } = render(
      <KeyFactsMeter lang="en-US" state={{ kind: "measured", filled: KEY_FACTS_AMBER_MIN, total: 11, missing: ["code", "customer", "regulatory"] }} />,
    );
    expect(screen.getByText("3 key facts missing")).toBeInTheDocument();
    expect(fill(container)?.className).toContain("bg-[var(--rag-amber)]");
  });

  it("renders red below the amber threshold", () => {
    const { container } = render(
      <KeyFactsMeter lang="en-US" state={{ kind: "measured", filled: KEY_FACTS_AMBER_MIN - 1, total: 11, missing: ["code", "customer", "regulatory", "products"] }} />,
    );
    expect(fill(container)?.className).toContain("bg-[var(--rag-red)]");
  });

  it("uses the singular sentence for one missing fact", () => {
    render(<KeyFactsMeter lang="en-US" state={{ kind: "measured", filled: 10, total: 11, missing: ["code"] }} />);
    expect(screen.getByText("1 key fact missing")).toBeInTheDocument();
  });

  // Spec §5.4: unknown is the bare track with NO fill child, told apart by text.
  it("renders unknown as a bare track with no fill, a dash count and a question glyph", () => {
    const { container } = render(<KeyFactsMeter lang="en-US" state={{ kind: "unknown", total: 11 }} />);
    expect(screen.getByText("Key facts not measured here")).toBeInTheDocument();
    expect(screen.getByText("— of 11")).toBeInTheDocument();
    expect(fill(container)).toBeNull();
    expect(container.querySelector("[data-key-facts-unknown-glyph]")).not.toBeNull();
  });

  it("hides the bar from assistive tech so the count text carries the state", () => {
    const { container } = render(
      <KeyFactsMeter lang="en-US" state={{ kind: "measured", filled: 5, total: 11, missing: ["code", "customer", "products", "profitCenter", "naceSection", "deployment"] }} />,
    );
    expect(container.querySelector("[data-key-facts-track]")?.getAttribute("aria-hidden")).toBe("true");
  });
});

// G10: prove the singular/plural DE sentences and the DE unknown-count
// format actually render — `loadI18n("de")` first, since the DE dictionary
// is lazy and `t("de", …)` serves English until it resolves.
describe("KeyFactsMeter — German", () => {
  beforeAll(async () => {
    await loadI18n("de");
  });

  it("renders the singular/plural missing sentences and the unknown count in German", () => {
    render(
      <KeyFactsMeter lang="de" state={{ kind: "measured", filled: 10, total: 11, missing: ["code"] }} />,
    );
    expect(screen.getByText("1 Kernangabe fehlt")).toBeInTheDocument();

    render(
      <KeyFactsMeter
        lang="de"
        state={{ kind: "measured", filled: 8, total: 11, missing: ["code", "customer", "regulatory"] }}
      />,
    );
    expect(screen.getByText("3 Kernangaben fehlen")).toBeInTheDocument();

    render(<KeyFactsMeter lang="de" state={{ kind: "unknown", total: 11 }} />);
    expect(screen.getByText("— von 11")).toBeInTheDocument();
  });
});

describe("KeyFactsBanner", () => {
  it("names the missing facts in declaration order and offers to complete them", () => {
    const onComplete = vi.fn();
    render(<KeyFactsBanner lang="en-US" missing={["code", "customer"]} onComplete={onComplete} />);
    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent("Missing key facts: Project code, Customer");
    fireEvent.click(screen.getByRole("button", { name: "Complete them" }));
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("switches to the success message with no action at eleven of eleven", () => {
    render(<KeyFactsBanner lang="en-US" missing={[]} onComplete={vi.fn()} />);
    expect(screen.getByRole("status")).toHaveTextContent("All key facts are set.");
    expect(screen.queryByRole("button", { name: "Complete them" })).toBeNull();
  });
});
