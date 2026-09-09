import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LoginPanel } from "./login-panel";

describe("LoginPanel", () => {
  it("renders the message, login form, social providers, and footer links", () => {
    render(
      <LoginPanel
        loginFormProps={{ emailFieldProps: {}, passwordFieldProps: {}, onSubmit: vi.fn() }}
        socialAuthProviders={[
          { href: "#", icon: "facebook", label: "Sign in using Facebook", color: "primary" },
        ]}
        forgotPasswordHref="forgot-password.html"
        registerHref="register.html"
      />,
    );

    expect(screen.getByText("Sign in to start your session")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign In" })).toBeInTheDocument();
    // `Button as="a"` sets role="button" (matches Bootstrap's own anchor-as-button pattern).
    expect(screen.getByRole("button", { name: /Facebook/ })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "I forgot my password" })).toHaveAttribute(
      "href",
      "forgot-password.html",
    );
    expect(screen.getByRole("link", { name: "Register a new membership" })).toHaveAttribute(
      "href",
      "register.html",
    );
  });

  it("accepts a custom message", () => {
    render(
      <LoginPanel
        message="Welcome back"
        loginFormProps={{ emailFieldProps: {}, passwordFieldProps: {}, onSubmit: vi.fn() }}
        socialAuthProviders={[]}
        forgotPasswordHref="forgot-password.html"
        registerHref="register.html"
      />,
    );

    expect(screen.getByText("Welcome back")).toBeInTheDocument();
  });
});
