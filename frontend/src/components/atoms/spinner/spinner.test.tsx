import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Spinner } from "./spinner";

describe("Spinner", () => {
  it("renders a role=status spinner with default 'Loading...' text", () => {
    render(<Spinner />);

    const status = screen.getByRole("status");
    expect(status).toHaveClass("spinner-border", "text-primary");
    expect(status).toHaveTextContent("Loading...");
  });

  it("appends wrapperClassName to the centering wrapper", () => {
    const { container } = render(<Spinner wrapperClassName="py-3" />);

    expect(container.firstChild).toHaveClass("d-flex", "justify-content-center", "py-3");
  });

  it("supports a custom label", () => {
    render(<Spinner label="Fetching defects..." />);

    expect(screen.getByRole("status")).toHaveTextContent("Fetching defects...");
  });
});
