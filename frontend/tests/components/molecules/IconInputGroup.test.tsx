import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { IconInputGroup } from "../../../src/components/molecules/icon-input-group";

describe("IconInputGroup", () => {
  it("renders a visually-hidden label bound to the input, plus the icon slot", () => {
    const { container } = render(
      <IconInputGroup id="loginEmail" label="Email" icon="envelope" type="email" placeholder="Email" />,
    );

    const input = screen.getByLabelText("Email");
    expect(input).toHaveClass("form-control");
    expect(container.querySelector(".input-group")).toBeInTheDocument();
    expect(container.querySelector(".bi-envelope")).toBeInTheDocument();
    expect(screen.getByText("Email")).toHaveClass("visually-hidden");
  });

  it("forwards a ref to the underlying input, for RHF register() binding", () => {
    const ref = createRef<HTMLInputElement>();
    render(<IconInputGroup id="loginPassword" label="Password" icon="lock-fill" ref={ref} />);

    expect(ref.current).toBeInstanceOf(HTMLInputElement);
  });

  it("calls onChange as the user types", async () => {
    const user = userEvent.setup();
    const handleChange = vi.fn();
    render(<IconInputGroup id="loginEmail" label="Email" icon="envelope" onChange={handleChange} />);

    await user.type(screen.getByLabelText("Email"), "a");

    expect(handleChange).toHaveBeenCalled();
  });

  it("renders a validation message and marks the input invalid when error is set", () => {
    render(
      <IconInputGroup id="loginEmail" label="Email" icon="envelope" error="Email is required." />,
    );

    expect(screen.getByLabelText("Email")).toHaveClass("is-invalid");
    expect(screen.getByRole("alert")).toHaveTextContent("Email is required.");
  });
});
