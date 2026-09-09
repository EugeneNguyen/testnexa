import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button } from "../../atoms/button";
import { ButtonStack } from ".";

describe("ButtonStack", () => {
  it("renders every child button", () => {
    render(
      <ButtonStack>
        <Button>One</Button>
        <Button>Two</Button>
      </ButtonStack>,
    );

    expect(screen.getByRole("button", { name: "One" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Two" })).toBeInTheDocument();
  });

  it("defaults to the stacked layout classes", () => {
    const { container } = render(
      <ButtonStack>
        <Button>One</Button>
      </ButtonStack>,
    );

    expect(container.firstElementChild).toHaveClass("d-grid", "gap-2");
  });

  it("applies the stacked-responsive layout classes", () => {
    const { container } = render(
      <ButtonStack layout="stacked-responsive">
        <Button>One</Button>
      </ButtonStack>,
    );

    expect(container.firstElementChild).toHaveClass("d-grid", "gap-2", "d-md-block");
  });

  it("applies the stacked-narrow layout classes", () => {
    const { container } = render(
      <ButtonStack layout="stacked-narrow">
        <Button>One</Button>
      </ButtonStack>,
    );

    expect(container.firstElementChild).toHaveClass("d-grid", "gap-2", "col-6", "mx-auto");
  });

  it("adds me-md-2 spacing to every child but the last in the inline-end layout", () => {
    render(
      <ButtonStack layout="inline-end">
        <Button>One</Button>
        <Button>Two</Button>
      </ButtonStack>,
    );

    expect(screen.getByRole("button", { name: "One" })).toHaveClass("me-md-2");
    expect(screen.getByRole("button", { name: "Two" })).not.toHaveClass("me-md-2");
  });

  it("does not add me-md-2 spacing for non-inline-end layouts", () => {
    render(
      <ButtonStack layout="stacked">
        <Button>One</Button>
        <Button>Two</Button>
      </ButtonStack>,
    );

    expect(screen.getByRole("button", { name: "One" })).not.toHaveClass("me-md-2");
  });

  it("appends a caller-supplied className alongside the layout classes", () => {
    const { container } = render(
      <ButtonStack className="mt-4">
        <Button>One</Button>
      </ButtonStack>,
    );

    expect(container.firstElementChild).toHaveClass("d-grid", "mt-4");
  });
});
