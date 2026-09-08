import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TextInput } from "../../../src/components/atoms/text-input";

describe("TextInput", () => {
  it("renders a form-control input with placeholder/type", () => {
    render(<TextInput placeholder="Email" type="email" aria-label="Email" />);

    const input = screen.getByRole("textbox", { name: "Email" });
    expect(input).toHaveClass("form-control");
    expect(input).toHaveAttribute("type", "email");
  });

  it("adds is-invalid when invalid is set", () => {
    render(<TextInput invalid aria-label="Password" />);

    expect(screen.getByLabelText("Password")).toHaveClass("is-invalid");
  });

  it("calls onChange as the user types", async () => {
    const user = userEvent.setup();
    const handleChange = vi.fn();
    render(<TextInput aria-label="Email" onChange={handleChange} />);

    await user.type(screen.getByLabelText("Email"), "a");

    expect(handleChange).toHaveBeenCalled();
  });
});
