import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { LoginForm } from "../../../src/components/organisms/login-form";

describe("LoginForm", () => {
  it("renders email/password fields, remember-me checkbox, and submit button", () => {
    render(
      <LoginForm emailFieldProps={{}} passwordFieldProps={{}} onSubmit={vi.fn()} />,
    );

    expect(screen.getByLabelText("Email")).toBeInTheDocument();
    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Remember Me" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign In" })).toBeInTheDocument();
  });

  it("calls onSubmit when the form is submitted", async () => {
    const user = userEvent.setup();
    const handleSubmit = vi.fn((event) => event.preventDefault());
    render(<LoginForm emailFieldProps={{}} passwordFieldProps={{}} onSubmit={handleSubmit} />);

    await user.click(screen.getByRole("button", { name: "Sign In" }));

    expect(handleSubmit).toHaveBeenCalledTimes(1);
  });

  it("disables the submit button and shows a busy label while submitting", () => {
    render(
      <LoginForm emailFieldProps={{}} passwordFieldProps={{}} onSubmit={vi.fn()} submitting />,
    );

    expect(screen.getByRole("button", { name: "Signing in..." })).toBeDisabled();
  });
});
