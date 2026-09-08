import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Icon } from "../../../src/components/atoms/icon";

describe("Icon", () => {
  it("renders the base + name classes", () => {
    const { container } = render(<Icon name="envelope" />);

    const icon = container.querySelector("i");
    expect(icon).toHaveClass("fa-solid", "fa-envelope");
    expect(icon).not.toHaveClass("me-2");
  });

  it("adds me-2 when spaced is set", () => {
    const { container } = render(<Icon name="facebook" variant="brands" spaced />);

    expect(container.querySelector("i")).toHaveClass("me-2");
  });

  it("is hidden from the accessibility tree", () => {
    const { container } = render(<Icon name="google" variant="brands" />);

    expect(container.querySelector("i")).toHaveAttribute("aria-hidden", "true");
  });

  // Brand glyphs (Facebook, Google, ...) live ONLY in Font Awesome's
  // `fa-brands` font — they do not exist in `fa-solid`, so a brand icon
  // rendered with the default variant silently shows nothing. This asserts
  // the variant actually reaches the class list rather than being dropped.
  it("renders brand icons in the fa-brands style, not the solid default", () => {
    const { container } = render(<Icon name="google" variant="brands" />);

    const icon = container.querySelector("i");
    expect(icon).toHaveClass("fa-brands", "fa-google");
    expect(icon).not.toHaveClass("fa-solid");
  });

  it("defaults to the solid variant", () => {
    const { container } = render(<Icon name="lock" />);

    expect(container.querySelector("i")).toHaveClass("fa-solid", "fa-lock");
  });
});
