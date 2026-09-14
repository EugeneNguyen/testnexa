import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Textarea } from "./textarea";

describe("Textarea", () => {
  it("renders a form-control textarea", () => {
    render(<Textarea aria-label="Description" />);

    const textarea = screen.getByRole("textbox", { name: "Description" });
    expect(textarea.tagName).toBe("TEXTAREA");
    expect(textarea).toHaveClass("form-control");
  });

  it("defaults to 3 rows", () => {
    render(<Textarea aria-label="Description" />);

    expect(screen.getByLabelText("Description")).toHaveAttribute("rows", "3");
  });

  it("adds is-invalid when invalid is set", () => {
    render(<Textarea invalid aria-label="Description" />);

    expect(screen.getByLabelText("Description")).toHaveClass("is-invalid");
  });

  it("calls onChange as the user types", async () => {
    const user = userEvent.setup();
    const handleChange = vi.fn();
    render(<Textarea aria-label="Description" onChange={handleChange} />);

    await user.type(screen.getByLabelText("Description"), "a");

    expect(handleChange).toHaveBeenCalled();
  });
});
