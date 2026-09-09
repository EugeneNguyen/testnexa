import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Card } from "./card";

describe("Card", () => {
  it("renders children inside .card > .card-body", () => {
    const { container } = render(<Card>Sign in to start your session</Card>);

    expect(container.querySelector(".card")).toBeInTheDocument();
    expect(screen.getByText("Sign in to start your session").closest(".card-body")).toBeInTheDocument();
  });

  it("appends bodyClassName to the inner card-body", () => {
    const { container } = render(<Card bodyClassName="p-4">content</Card>);

    expect(container.querySelector(".card-body")).toHaveClass("p-4");
  });
});
