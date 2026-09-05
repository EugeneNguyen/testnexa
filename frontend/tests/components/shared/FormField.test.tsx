import { createRef } from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import FormField from "../../../src/components/shared/FormField";

describe("FormField", () => {
  it("pairs the label to the input via htmlFor/id", () => {
    render(<FormField id="email" label="Email" type="email" />);
    const input = screen.getByLabelText("Email");
    expect(input).toHaveAttribute("id", "email");
    expect(input).toHaveAttribute("type", "email");
  });

  it("defaults to type=text", () => {
    render(<FormField id="name" label="Name" />);
    expect(screen.getByLabelText("Name")).toHaveAttribute("type", "text");
  });

  it("renders no CFormFeedback and invalid=false when no error is passed", () => {
    render(<FormField id="email" label="Email" />);
    expect(screen.getByLabelText("Email")).not.toHaveClass("is-invalid");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("surfaces an error via CFormFeedback and marks the input invalid", () => {
    render(<FormField id="email" label="Email" error="Email is required." />);
    const input = screen.getByLabelText("Email");
    expect(input).toHaveClass("is-invalid");
    expect(screen.getByText("Email is required.")).toBeInTheDocument();
  });

  it("forwards a ref to the underlying input (RHF register() compatibility)", () => {
    const ref = createRef<HTMLInputElement>();
    render(<FormField id="email" label="Email" ref={ref} />);
    expect(ref.current).toBeInstanceOf(HTMLInputElement);
    expect(ref.current?.id).toBe("email");
  });

  it("spreads rest props (RHF register() onChange/onBlur/name) onto the input", () => {
    render(<FormField id="email" label="Email" name="email" data-testid="email-input" />);
    expect(screen.getByTestId("email-input")).toHaveAttribute("name", "email");
  });
});
