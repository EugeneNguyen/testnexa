import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AuthBoxLayout } from "../../../src/components/templates/auth-box-layout";

describe("AuthBoxLayout", () => {
  it("renders the brand logo, a card, and the children slot", () => {
    const { container } = render(
      <AuthBoxLayout logoHref="../index2.html">
        <p>Sign in to start your session</p>
      </AuthBoxLayout>,
    );

    // See BrandLogo.test.tsx for why the accessible name is "Admin LTE", not "AdminLTE".
    expect(screen.getByRole("link", { name: "Admin LTE" })).toHaveAttribute("href", "../index2.html");
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
