import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Checkbox } from "./checkbox";

describe("Checkbox", () => {
  it("renders a form-check-input checkbox", () => {
    render(<Checkbox aria-label="Remember Me" />);

    const checkbox = screen.getByRole("checkbox", { name: "Remember Me" });
    expect(checkbox).toHaveClass("form-check-input");
  });

  it("calls onChange when toggled", async () => {
    const user = userEvent.setup();
    const handleChange = vi.fn();
    render(<Checkbox aria-label="Remember Me" onChange={handleChange} />);

    await user.click(screen.getByRole("checkbox", { name: "Remember Me" }));

    expect(handleChange).toHaveBeenCalledTimes(1);
  });
});
