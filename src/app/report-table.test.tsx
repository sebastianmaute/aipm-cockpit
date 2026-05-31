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
});
