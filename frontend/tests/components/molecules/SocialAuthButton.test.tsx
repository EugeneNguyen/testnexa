import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SocialAuthButton } from "../../../src/components/molecules/social-auth-button";

describe("SocialAuthButton", () => {
  it("renders a colored link button with icon + label", () => {
    const { container } = render(
      <SocialAuthButton href="#" icon="facebook" label="Sign in using Facebook" color="primary" />,
    );

    // `Button as="a"` sets role="button" (matches Bootstrap's own anchor-as-button pattern).
    const link = screen.getByRole("button", { name: /Sign in using Facebook/ });
    expect(link).toHaveClass("btn", "btn-primary");
    expect(container.querySelector(".fa-facebook")).toBeInTheDocument();
  });

  it("calls onClick when clicked", async () => {
    const user = userEvent.setup();
    const handleClick = vi.fn();
    render(
      <SocialAuthButton
        href="#"
        icon="google"
        label="Sign in using Google"
        color="danger"
        onClick={handleClick}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Sign in using Google/ }));

    expect(handleClick).toHaveBeenCalledTimes(1);
  });
});
