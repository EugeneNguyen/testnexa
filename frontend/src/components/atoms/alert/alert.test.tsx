import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Alert } from "./alert";

describe("Alert", () => {
  it("defaults to alert-info with role=alert", () => {
    render(<Alert>info message</Alert>);

    const alert = screen.getByRole("alert");
    expect(alert).toHaveClass("alert", "alert-info");
    expect(alert).toHaveTextContent("info message");
  });

  it("renders the requested color class", () => {
    render(<Alert color="danger">danger message</Alert>);

    expect(screen.getByRole("alert")).toHaveClass("alert-danger");
  });

  it("appends className", () => {
    render(
      <Alert color="warning" className="mt-2">
        content
      </Alert>,
    );

    expect(screen.getByRole("alert")).toHaveClass("alert-warning", "mt-2");
  });
});
