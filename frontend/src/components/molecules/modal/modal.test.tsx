import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Modal } from "./modal";

describe("Modal", () => {
  it("renders nothing at all when not visible", () => {
    const { container } = render(
      <Modal visible={false} title="Title" onClose={vi.fn()}>
        content
      </Modal>,
    );

    expect(container).toBeEmptyDOMElement();
  });

  it("renders the header, title and children when visible", () => {
    render(
      <Modal visible title="My Title" onClose={vi.fn()}>
        <div className="modal-body">body content</div>
      </Modal>,
    );

    expect(screen.getByRole("heading", { name: "My Title" })).toBeInTheDocument();
    expect(screen.getByText("body content").closest(".modal-body")).toBeInTheDocument();
  });

  it("calls onClose when the close button is clicked", () => {
    const onClose = vi.fn();
    render(
      <Modal visible title="Title" onClose={onClose}>
        content
      </Modal>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose on Escape", () => {
    const onClose = vi.fn();
    render(
      <Modal visible title="Title" onClose={onClose}>
        content
      </Modal>,
    );

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("lets the caller supply its own .modal-body + .modal-footer inside one <form>", () => {
    render(
      <Modal visible title="New thing" onClose={vi.fn()}>
        <form>
          <Modal.Body>fields</Modal.Body>
          <Modal.Footer>
            <button type="submit">Save</button>
          </Modal.Footer>
        </form>
      </Modal>,
    );

    const form = screen.getByText("fields").closest("form");
    expect(form?.querySelector(".modal-footer")).toBeInTheDocument();
  });

  it("Modal.Body/Modal.Footer render as direct children with no wrapping <form>", () => {
    const { container } = render(
      <Modal visible title="Delete" onClose={vi.fn()}>
        <Modal.Body>Are you sure?</Modal.Body>
        <Modal.Footer>
          <button type="button">Delete</button>
        </Modal.Footer>
      </Modal>,
    );

    expect(screen.getByText("Are you sure?").closest(".modal-body")).toBeInTheDocument();
    expect(container.querySelector(".modal-footer")).toBeInTheDocument();
  });

  it("appends className to Modal.Body/Modal.Footer", () => {
    const { container } = render(
      <Modal visible title="Title" onClose={vi.fn()}>
        <Modal.Body className="p-4">body</Modal.Body>
        <Modal.Footer className="justify-content-start">footer</Modal.Footer>
      </Modal>,
    );

    expect(container.querySelector(".modal-body")).toHaveClass("p-4");
    expect(container.querySelector(".modal-footer")).toHaveClass("justify-content-start");
  });
});
