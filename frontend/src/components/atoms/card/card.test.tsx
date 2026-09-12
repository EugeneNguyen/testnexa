import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Card } from "./card";

describe("Card", () => {
  it("renders the bare .card wrapper with no auto .card-body", () => {
    const { container } = render(<Card>plain content</Card>);

    expect(container.querySelector(".card")).toBeInTheDocument();
    expect(container.querySelector(".card-body")).not.toBeInTheDocument();
    expect(screen.getByText("plain content")).toBeInTheDocument();
  });

  it("appends className to the outer .card", () => {
    const { container } = render(<Card className="h-100">content</Card>);

    expect(container.querySelector(".card")).toHaveClass("h-100");
  });

  it("composes Header, Body and Footer in order", () => {
    render(
      <Card>
        <Card.Header>
          <h3 className="card-title">Title</h3>
        </Card.Header>
        <Card.Body>Body content</Card.Body>
        <Card.Footer>Footer content</Card.Footer>
      </Card>,
    );

    expect(screen.getByText("Title").closest(".card-header")).toBeInTheDocument();
    expect(screen.getByText("Body content").closest(".card-body")).toBeInTheDocument();
    expect(screen.getByText("Footer content").closest(".card-footer")).toBeInTheDocument();
  });

  it("appends className to each section independently", () => {
    const { container } = render(
      <Card>
        <Card.Header className="d-flex">header</Card.Header>
        <Card.Body className="p-4">body</Card.Body>
        <Card.Footer className="text-end">footer</Card.Footer>
      </Card>,
    );

    expect(container.querySelector(".card-header")).toHaveClass("d-flex");
    expect(container.querySelector(".card-body")).toHaveClass("p-4");
    expect(container.querySelector(".card-footer")).toHaveClass("text-end");
  });

  it("supports Header + Body with no Footer (EntityListPage's shape)", () => {
    const { container } = render(
      <Card>
        <Card.Header>header only</Card.Header>
        <Card.Body>body only</Card.Body>
      </Card>,
    );

    expect(container.querySelector(".card-footer")).not.toBeInTheDocument();
  });

  it("Card.Title renders an h3.card-title by default", () => {
    render(<Card.Title>My Title</Card.Title>);

    const title = screen.getByText("My Title");
    expect(title.tagName).toBe("H3");
    expect(title).toHaveClass("card-title");
  });

  it("Card.Title supports a different heading level via `as`", () => {
    render(<Card.Title as="h5">Featured</Card.Title>);

    expect(screen.getByText("Featured").tagName).toBe("H5");
  });
});
