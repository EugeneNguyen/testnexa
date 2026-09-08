import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WidgetStatsTile } from "../../../src/components/shared/widget-stats-tile";

describe("WidgetStatsTile", () => {
  it("renders the value and the title", () => {
    render(<WidgetStatsTile color="primary" title="Widget title" value="$1.999,50" />);

    expect(screen.getByText("$1.999,50")).toBeInTheDocument();
    expect(screen.getByText("Widget title")).toBeInTheDocument();
  });

  it("renders no icon block (B-variant) when icon prop is omitted", () => {
    const { container } = render(
      <WidgetStatsTile color="info" title="Widget title" value="$1.999,50" />,
    );

    // No colored icon block: no element with both bg-* and text-white utility classes
    // alongside the icon's `icon icon-xl` class. Verified by absence of any `me-3`
    // (the icon-block uses `me-3` to separate from the text stack; the text
    // stack's own wrapper does not).
    const iconBlocks = container.querySelectorAll(".me-3");
    expect(iconBlocks).toHaveLength(0);
  });

  it("renders the icon block (A-variant) when icon prop is supplied", () => {
    const { container } = render(
      <WidgetStatsTile
        color="warning"
        title="Widget title"
        value="$1.999,50"
        icon="fa-solid fa-gear"
      />,
    );

    const iconBlock = container.querySelector(".bg-warning.text-white.p-4.me-3");
    expect(iconBlock).not.toBeNull();
    // ADR-0042: the icon is a Font Awesome `<i>` carrying the caller's own
    // class string plus this component's `fa-2x` size, not CoreUI's
    // `<svg class="icon icon-xl">`.
    expect(iconBlock?.querySelector("i.fa-solid.fa-gear.fa-2x")).not.toBeNull();
  });

  it("color-coordinates the icon block bg and the value text by the `color` prop", () => {
    const { container } = render(
      <WidgetStatsTile
        color="danger"
        title="Widget title"
        value="$1.999,50"
        icon="fa-solid fa-bell"
      />,
    );

    expect(container.querySelector(".bg-danger.text-white")).not.toBeNull();
    expect(container.querySelector(".text-danger.fw-semibold")).not.toBeNull();
  });

  it("appends a caller-supplied className alongside the base card classes", () => {
    const { container } = render(
      <WidgetStatsTile color="primary" title="Widget title" value="$1.999,50" className="mt-3" />,
    );

    const card = container.firstElementChild;
    expect(card).toHaveClass("card");
    expect(card).toHaveClass("overflow-hidden");
    expect(card).toHaveClass("mt-3");
  });

  it("forwards the testId prop to the card root as a data-testid attribute", () => {
    render(
      <WidgetStatsTile
        color="primary"
        title="Projects"
        value={42}
        testId="widget-projects-count"
      />,
    );

    expect(screen.getByTestId("widget-projects-count")).toBeInTheDocument();
  });

  it("accepts ReactNode values (JSX, numbers, formatted strings)", () => {
    const { rerender } = render(
      <WidgetStatsTile color="primary" title="Count" value={42} />,
    );
    expect(screen.getByText("42")).toBeInTheDocument();

    rerender(
      <WidgetStatsTile
        color="primary"
        title="Status"
        value={<span data-testid="custom-value">Pending</span>}
      />,
    );
    expect(screen.getByTestId("custom-value")).toBeInTheDocument();
  });
});
