import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { Button } from "../../../src/components/atoms/button";

describe("Button", () => {
  it("renders as a native button with the base + color classes", () => {
    render(<Button color="primary">Save</Button>);

    const button = screen.getByRole("button", { name: "Save" });
    expect(button).toHaveClass("btn", "btn-primary");
  });

  it("applies outline classes instead of solid color classes when outline is set", () => {
    render(
      <Button color="danger" outline>
        Delete
      </Button>,
    );

    const button = screen.getByRole("button", { name: "Delete" });
    expect(button).toHaveClass("btn-outline-danger");
    expect(button).not.toHaveClass("btn-danger");
  });

  it("applies ghost classes instead of solid color classes when ghost is set", () => {
    render(
      <Button color="info" ghost>
        Info
      </Button>,
    );

    const button = screen.getByRole("button", { name: "Info" });
    expect(button).toHaveClass("btn-ghost-info");
    expect(button).not.toHaveClass("btn-info");
  });

  it("applies size and shape classes", () => {
    render(
      <Button size="lg" shape="pill">
        Big pill
      </Button>,
    );

    const button = screen.getByRole("button", { name: "Big pill" });
    expect(button).toHaveClass("btn-lg", "rounded-pill");
  });

  it("renders as an anchor with role=button when as='a'", () => {
    render(
      <Button as="a" href="/somewhere">
        Go
      </Button>,
    );

    const link = screen.getByRole("button", { name: "Go" });
    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute("href", "/somewhere");
  });

  it("marks a disabled anchor with the .disabled class + aria-disabled + tabindex, not a native disabled attribute", () => {
    render(
      <Button as="a" href="/somewhere" disabled>
        Go
      </Button>,
    );

    const link = screen.getByRole("button", { name: "Go" });
    expect(link).toHaveClass("disabled");
    expect(link).toHaveAttribute("aria-disabled", "true");
    expect(link).toHaveAttribute("tabindex", "-1");
  });

  it("disables a native button via the disabled attribute", () => {
    render(<Button disabled>Save</Button>);

    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("calls the onClick prop when clicked", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save</Button>);

    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("does not call onClick when disabled", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Save
      </Button>,
    );

    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onClick).not.toHaveBeenCalled();
  });

  it("toggles aria-pressed and calls onToggle on each click when toggle is set", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(
      <Button toggle onToggle={onToggle}>
        Toggle
      </Button>,
    );

    const button = screen.getByRole("button", { name: "Toggle" });
    expect(button).toHaveAttribute("aria-pressed", "false");

    await user.click(button);
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(onToggle).toHaveBeenLastCalledWith(true);

    await user.click(button);
    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(onToggle).toHaveBeenLastCalledWith(false);
  });

  it("respects a controlled pressed prop instead of internal toggle state", () => {
    render(
      <Button toggle pressed>
        Toggle
      </Button>,
    );

    expect(screen.getByRole("button", { name: "Toggle" })).toHaveAttribute("aria-pressed", "true");
  });

  it("appends a caller-supplied className alongside the base classes", () => {
    render(<Button className="mt-3">Save</Button>);

    expect(screen.getByRole("button", { name: "Save" })).toHaveClass("btn", "mt-3");
  });
});
