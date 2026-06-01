import { describe, expect, test } from "vitest";
import { render, screen } from "@testing-library/react";
import { useRef } from "react";
import { ReportCard } from "./report-table";

function Harness() {
  const ref = useRef<HTMLDivElement | null>(null);
  return <ReportCard lang="en-US" sizeRef={ref} onResetSize={() => {}}><p>body</p></ReportCard>;
}

describe("ReportCard", () => {
  test("renders content inside a resizable print-root card with corner hint", () => {
    const { container } = render(<Harness />);
    expect(screen.getByText("body")).toBeInTheDocument();
    expect(container.querySelector(".print-root")).toBeTruthy();
    expect(container.textContent).toContain("⠿");
  });

  test("renders a left-aligned heading when title is given, outside the print-hidden toolbar", () => {
    function H() {
      const ref = useRef<HTMLDivElement | null>(null);
      return (
        <ReportCard lang="en-US" sizeRef={ref} onResetSize={() => {}} title="My Report">
          <p>body</p>
        </ReportCard>
      );
    }
    render(<H />);
    const heading = screen.getByRole("heading", { name: "My Report" });
    expect(heading).toBeInTheDocument();
    // the heading must NOT live inside the print:hidden button cluster
    expect(heading.closest('[class*="print:hidden"]')).toBeNull();
  });

  test("omits the heading when no title is given", () => {
    function H() {
      const ref = useRef<HTMLDivElement | null>(null);
      return (
        <ReportCard lang="en-US" sizeRef={ref} onResetSize={() => {}}>
          <p>body</p>
        </ReportCard>
      );
    }
    render(<H />);
    expect(screen.queryByRole("heading")).toBeNull();
  });
});
