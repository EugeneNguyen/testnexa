import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import AppFooter from "../src/components/AppFooter";

/**
 * SHELL-2 (ADR-0019) footer unit test, TC-SHELL-009. Static content,
 * no per-route branching to partition — a single smoke-level render check
 * is the full coverage this component needs.
 */
describe("AppFooter", () => {
  it("TC-SHELL-009: renders", () => {
    render(<AppFooter />);

    expect(screen.getByText("TestNexa")).toBeInTheDocument();
    expect(
      screen.getByText("Self-hosted, ISTQB/IEEE 829-aligned test management"),
    ).toBeInTheDocument();
  });
});
