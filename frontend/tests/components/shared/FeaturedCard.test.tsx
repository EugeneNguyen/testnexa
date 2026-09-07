import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FeaturedCard } from "../../../src/components/shared/FeaturedCard";

const PROPS = {
  headerText: "Featured",
  title: "Special title treatment",
  bodyText: "With supporting text below as a natural lead-in to additional content.",
  ctaLabel: "Go somewhere",
  ctaHref: "#",
  footerText: "2 days ago",
};

describe("FeaturedCard", () => {
  it("renders header, title, body text, CTA, and footer", () => {
    render(<FeaturedCard {...PROPS} />);

    expect(screen.getByText("Featured")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Special title treatment" })).toBeInTheDocument();
    expect(
      screen.getByText("With supporting text below as a natural lead-in to additional content."),
    ).toBeInTheDocument();
    expect(screen.getByText("2 days ago")).toBeInTheDocument();
  });

  it("renders the CTA as a link pointing at ctaHref", () => {
    render(<FeaturedCard {...PROPS} />);

    const cta = screen.getByRole("link", { name: "Go somewhere" });
    expect(cta).toHaveAttribute("href", "#");
  });

  it("appends a caller-supplied className alongside the base text-center class", () => {
    const { container } = render(<FeaturedCard {...PROPS} className="mt-3" />);

    const card = container.firstElementChild;
    expect(card).toHaveClass("text-center");
    expect(card).toHaveClass("mt-3");
  });
});
