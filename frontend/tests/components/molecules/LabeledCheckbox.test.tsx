import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { LabeledCheckbox } from "../../../src/components/molecules/labeled-checkbox";

describe("LabeledCheckbox", () => {
  it("renders a checkbox with an associated visible label", () => {
    render(<LabeledCheckbox id="flexCheckDefault" label="Remember Me" />);

    expect(screen.getByRole("checkbox", { name: "Remember Me" })).toBeInTheDocument();
    expect(screen.getByText("Remember Me")).toHaveClass("form-check-label");
  });

  it("calls onChange when toggled via the label", async () => {
    const user = userEvent.setup();
    const handleChange = vi.fn();
    render(<LabeledCheckbox id="flexCheckDefault" label="Remember Me" onChange={handleChange} />);

    await user.click(screen.getByText("Remember Me"));

    expect(handleChange).toHaveBeenCalledTimes(1);
  });
});
