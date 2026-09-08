import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Icon } from "../../../src/components/atoms/icon";

describe("Icon", () => {
  it("renders the base + name classes", () => {
    const { container } = render(<Icon name="envelope" />);

    const icon = container.querySelector("i");
    expect(icon).toHaveClass("bi", "bi-envelope");
    expect(icon).not.toHaveClass("me-2");
  });

  it("adds me-2 when spaced is set", () => {
    const { container } = render(<Icon name="facebook" spaced />);

    expect(container.querySelector("i")).toHaveClass("me-2");
  });

  it("is hidden from the accessibility tree", () => {
    const { container } = render(<Icon name="google" />);

    expect(container.querySelector("i")).toHaveAttribute("aria-hidden", "true");
  });
});
