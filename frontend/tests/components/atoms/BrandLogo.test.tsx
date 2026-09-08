import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BrandLogo } from "../../../src/components/atoms/brand-logo";

describe("BrandLogo", () => {
  it("renders the AdminLTE wordmark linking to the given href", () => {
    render(<BrandLogo href="../index2.html" />);

    // Accessible-name computation inserts a space between the <b> node and its
    // sibling text node, even though there's no visible gap ("AdminLTE").
    const link = screen.getByRole("link", { name: "Admin LTE" });
    expect(link).toHaveAttribute("href", "../index2.html");
    expect(link.querySelector("b")).toHaveTextContent("Admin");
  });

  it("renders inside an h1 with centered heading classes", () => {
    render(<BrandLogo href="../index2.html" />);

    expect(screen.getByRole("heading", { level: 1 })).toHaveClass("text-center", "mb-4");
  });
});
