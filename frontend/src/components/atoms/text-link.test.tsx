import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TextLink } from "./text-link";

describe("TextLink", () => {
  it("renders an anchor with the given href and text", () => {
    render(<TextLink href="forgot-password.html">I forgot my password</TextLink>);

    const link = screen.getByRole("link", { name: "I forgot my password" });
    expect(link).toHaveAttribute("href", "forgot-password.html");
    expect(link).not.toHaveClass("text-center");
  });

  it("adds text-center when centered is set", () => {
    render(
      <TextLink href="register.html" centered>
        Register a new membership
      </TextLink>,
    );

    expect(screen.getByRole("link", { name: "Register a new membership" })).toHaveClass("text-center");
  });
});
