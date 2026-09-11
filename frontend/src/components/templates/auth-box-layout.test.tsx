import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AuthBoxLayout } from "./auth-box-layout";

describe("AuthBoxLayout", () => {
  it("renders the brand logo, a card, and the children slot", () => {
    const { container } = render(
      <AuthBoxLayout logoHref="../index2.html">
        <p>Sign in to start your session</p>
      </AuthBoxLayout>,
    );

    // BRAND-1 (ADR-0048): was `name: "Admin LTE"` — the hardcoded AdminLTE
    // wordmark this story removed. The auth screens keep the atom's DEFAULT
    // `size="full"` lockup (TC-DS-030: this template needed no change of its
    // own), so the only thing that moved is the accessible name.
    const brand = screen.getByRole("link", { name: /TestNexa home/i });
    expect(brand).toHaveAttribute("href", "../index2.html");
    expect(brand).toHaveAttribute("data-brand-logo-size", "full");
    expect(container.querySelector(".card")).toBeInTheDocument();
    expect(screen.getByText("Sign in to start your session")).toBeInTheDocument();
  });

  it("applies the full-bleed centering wrapper classes", () => {
    const { container } = render(
      <AuthBoxLayout logoHref="../index2.html">
        <p>content</p>
      </AuthBoxLayout>,
    );

    // ADR-0054 (2026-09-11): the explicit `bg-body-secondary` utility is
    // dropped — under Tabler's cascade (which now wins project-wide), that
    // class resolves to a visibly different, darker gray than `body`'s own
    // background token, painting a mismatched seam instead of a flush page
    // background. `body` already carries Tabler's correct page-background
    // color globally, so this wrapper needs no color class of its own.
    expect(container.firstChild).toHaveClass("min-vh-100", "d-flex", "align-items-center");
    expect(container.firstChild).not.toHaveClass("bg-body-secondary");
  });
});
