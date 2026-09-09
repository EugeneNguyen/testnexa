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

    expect(container.firstChild).toHaveClass("min-vh-100", "d-flex", "align-items-center", "bg-body-secondary");
  });
});
