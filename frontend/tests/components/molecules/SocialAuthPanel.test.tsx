import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SocialAuthPanel } from "../../../src/components/molecules/social-auth-panel";

describe("SocialAuthPanel", () => {
  it("renders the divider text and one button per provider", () => {
    render(
      <SocialAuthPanel
        providers={[
          { href: "#", icon: "facebook", label: "Sign in using Facebook", color: "primary" },
          { href: "#google", icon: "google", label: "Sign in using Google", color: "danger" },
        ]}
      />,
    );

    expect(screen.getByText("- OR -")).toBeInTheDocument();
    // `Button as="a"` sets role="button" (matches Bootstrap's own anchor-as-button pattern).
    expect(screen.getByRole("button", { name: /Facebook/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Google/ })).toBeInTheDocument();
  });

  it("accepts a custom divider text", () => {
    render(
      <SocialAuthPanel
        providers={[{ href: "#", icon: "facebook", label: "Sign in using Facebook", color: "primary" }]}
        dividerText="Or continue with"
      />,
    );

    expect(screen.getByText("Or continue with")).toBeInTheDocument();
  });

  it("renders nothing for an empty providers array", () => {
    const { container } = render(<SocialAuthPanel providers={[]} />);

    expect(container).toBeEmptyDOMElement();
  });
});
