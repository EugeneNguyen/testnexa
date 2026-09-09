import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { InfoBox, infoBoxIconColorClassName } from "../../../src/components/molecules/info-box";

/**
 * DS-3 ([ADR-0045](docs/adr/0045-ds-3-infobox-widget-consolidation.md)) unit
 * tests for the shared `InfoBox`. Replaces the deleted
 * `WidgetStatsTile.test.tsx` — every equivalence class that file covered
 * (icon-supplied vs. icon-omitted, testId forwarding, color application,
 * `ReactNode` passthrough, `className` append) is carried over and re-aimed at
 * AdminLTE's own Info Box markup, plus the two classes that are new to this
 * story (Test Design §36).
 *
 * Covers, at this layer:
 *   - **TC-DS-019** — the `.info-box` DOM shape itself, asserted against literal
 *     class strings, and the absence of either retired shape.
 *   - **TC-DS-021** — icon supplied renders a populated `.info-box-icon`; icon
 *     omitted renders *no such element at all*, not an empty one.
 *   - **TC-DS-022** — the component is agnostic to sentinel convention: both
 *     `OrgHome`'s "Loading…"/"Unable to load" strings and `TestCycleDetail`'s
 *     `"—"` render identically as plain `ReactNode`, with no special-casing.
 *
 * TC-DS-020 (existing testids/counts survive the migration) is asserted at the
 * *call sites*, not here — see `OrgHome.widgets.test.tsx` and
 * `TestCycleDetail.test.tsx`, whose own assertions were deliberately left
 * unmodified, which is the actual claim TC-DS-020 makes.
 */
describe("InfoBox", () => {
  it("TC-DS-019: renders AdminLTE's own Info Box DOM shape", () => {
    const { container } = render(
      <InfoBox color="primary" text="Projects" number={42} icon="fa-solid fa-folder" />,
    );

    const root = container.firstElementChild;
    expect(root).toHaveClass("info-box");

    // `.info-box-content` is a direct child of the root, and carries exactly the
    // two spans AdminLTE's demo markup does.
    const content = root?.querySelector(":scope > .info-box-content");
    expect(content).not.toBeNull();
    expect(content?.querySelector(".info-box-text")?.textContent).toBe("Projects");
    expect(content?.querySelector(".info-box-number")?.textContent).toBe("42");

    // The icon block is a *sibling* of `.info-box-content`, not nested inside it
    // — the demo's own structure, and what `.info-box`'s `display: flex` assumes.
    expect(root?.querySelector(":scope > .info-box-icon")).not.toBeNull();
  });

  it("TC-DS-019: renders neither retired tile's shape", () => {
    const { container } = render(
      <InfoBox color="primary" text="Projects" number={42} icon="fa-solid fa-folder" />,
    );

    // `WidgetStatsTile`'s root was `div.card.overflow-hidden`; `StatTile`'s was
    // `div.card.h-100.text-center`. Neither survives — nor does `.card` at all,
    // since Info Box is not a Bootstrap card.
    expect(container.querySelector(".card")).toBeNull();
    expect(container.querySelector(".overflow-hidden")).toBeNull();
    expect(container.querySelector(".h-100")).toBeNull();
  });

  it("TC-DS-021: renders a populated .info-box-icon when `icon` is supplied", () => {
    const { container } = render(
      <InfoBox color="warning" text="Blocked" number={7} icon="fa-solid fa-gear" />,
    );

    const iconBlock = container.querySelector(".info-box-icon");
    expect(iconBlock).not.toBeNull();
    // The exact class string read out of AdminLTE's own demo DOM:
    // `info-box-icon text-bg-{color} shadow-sm` (see `InfoBox.tsx`'s header for
    // how this was resolved — it is NOT derivable from the shipped CSS).
    expect(iconBlock).toHaveClass("text-bg-warning");
    expect(iconBlock).toHaveClass("shadow-sm");
    // Font Awesome `<i>`, carrying the caller's own class string verbatim — the
    // demo uses Bootstrap Icons here, which this repo deliberately does not
    // (ADR-0042: exactly one icon library).
    const glyph = iconBlock?.querySelector("i");
    expect(glyph).toHaveClass("fa-solid", "fa-gear");
    expect(glyph).toHaveAttribute("aria-hidden", "true");
  });

  it("TC-DS-021: renders NO .info-box-icon element at all when `icon` is omitted", () => {
    const { container } = render(<InfoBox color="secondary" text="Skipped" number={0} />);

    // Not "an empty one" — the element must be absent entirely, which is what
    // distinguishes this from a rendering bug that would show a blank colored
    // 70px block (`.info-box-icon`'s own fixed width in adminlte.css).
    expect(container.querySelector(".info-box-icon")).toBeNull();
    // The content block is still present and correct without it.
    expect(container.querySelector(".info-box-content .info-box-text")?.textContent).toBe(
      "Skipped",
    );
    expect(container.querySelector(".info-box-content .info-box-number")?.textContent).toBe("0");
  });

  it("TC-DS-021: an omitted icon leaves `.info-box` with exactly one child", () => {
    const { container } = render(<InfoBox color="success" text="Pass" number={3} />);

    // Guards specifically against a `{icon && ...}` style falsy-render leaving a
    // stray text node / empty element behind.
    expect(container.firstElementChild?.children).toHaveLength(1);
    expect(container.firstElementChild?.firstElementChild).toHaveClass("info-box-content");
  });

  it("applies the contextual color class for every member of the color union", () => {
    // Asserted against the component's own exported lookup rather than a
    // re-hardcoded list, so the two can't silently drift apart.
    for (const [color, expectedClass] of Object.entries(infoBoxIconColorClassName)) {
      const { container, unmount } = render(
        <InfoBox
          color={color as keyof typeof infoBoxIconColorClassName}
          text="Label"
          number={1}
          icon="fa-solid fa-bell"
        />,
      );
      expect(container.querySelector(".info-box-icon")).toHaveClass(expectedClass);
      unmount();
    }
  });

  it("does not color the label or the number — Info Box colors only the icon block", () => {
    // A real behavioral difference from the retired `StatTile`, which put
    // `text-{color}` on the number. Asserted so a future "restore the colored
    // number" change is a deliberate decision, not an accident.
    const { container } = render(
      <InfoBox color="danger" text="Fail" number={9} icon="fa-solid fa-bell" />,
    );

    expect(container.querySelector(".info-box-number")).not.toHaveClass("text-danger");
    expect(container.querySelector(".info-box-text")).not.toHaveClass("text-danger");
  });

  it("forwards `testId` to the .info-box root", () => {
    render(<InfoBox color="primary" text="Projects" number={42} testId="widget-project-count" />);

    const root = screen.getByTestId("widget-project-count");
    expect(root).toHaveClass("info-box");
  });

  it("forwards `numberTestId` to the .info-box-number element, not the root", () => {
    // This is what keeps `TestCycleDetail`'s four `-count` testids resolving to
    // the same logical element they did pre-migration (TC-DS-020) — and why
    // their existing `.textContent === "12"`-style assertions still hold, since
    // the number element wraps nothing but the value.
    render(
      <InfoBox
        color="success"
        text="Pass"
        number={12}
        testId="dashboard-tile-pass"
        numberTestId="dashboard-tile-pass-count"
      />,
    );

    const numberEl = screen.getByTestId("dashboard-tile-pass-count");
    expect(numberEl).toHaveClass("info-box-number");
    expect(numberEl.textContent).toBe("12");
    expect(screen.getByTestId("dashboard-tile-pass")).toHaveClass("info-box");
  });

  it("omits both data-testid attributes entirely when neither prop is passed", () => {
    const { container } = render(<InfoBox color="primary" text="Projects" number={42} />);

    expect(container.querySelector(".info-box")).not.toHaveAttribute("data-testid");
    expect(container.querySelector(".info-box-number")).not.toHaveAttribute("data-testid");
  });

  it("TC-DS-022: renders TestCycleDetail's `null` → \"—\" sentinel verbatim", () => {
    // The caller owns the ternary (DS-3 moved it out of the deleted `StatTile`);
    // the component just renders whatever node it's handed.
    render(
      <InfoBox
        color="secondary"
        text="Skipped"
        number="—"
        numberTestId="dashboard-tile-skipped-count"
      />,
    );

    expect(screen.getByTestId("dashboard-tile-skipped-count").textContent).toBe("—");
  });

  it("TC-DS-022: renders OrgHome's loading/error/count tri-state through the same prop", () => {
    const { rerender } = render(
      <InfoBox color="primary" text="Projects" number="Loading…" testId="w" />,
    );
    expect(screen.getByTestId("w")).toHaveTextContent(/loading/i);
    // The two conventions must not leak into each other: a loading tile shows no
    // "—", and (below) a real zero shows a real "0", never "—".
    expect(screen.getByTestId("w").textContent).not.toContain("—");

    rerender(<InfoBox color="primary" text="Projects" number="Unable to load" testId="w" />);
    expect(screen.getByTestId("w")).toHaveTextContent(/unable to load/i);

    rerender(<InfoBox color="primary" text="Projects" number={0} testId="w" />);
    expect(screen.getByTestId("w")).toHaveTextContent("0");
    expect(screen.getByTestId("w").textContent).not.toContain("—");
  });

  it("accepts arbitrary ReactNode for `number` (numbers, strings, JSX)", () => {
    const { rerender } = render(<InfoBox color="primary" text="Count" number={42} />);
    expect(screen.getByText("42")).toBeInTheDocument();

    rerender(<InfoBox color="primary" text="Revenue" number="$1.999,50" />);
    expect(screen.getByText("$1.999,50")).toBeInTheDocument();

    rerender(
      <InfoBox
        color="primary"
        text="Status"
        number={<span data-testid="custom-number">Pending</span>}
      />,
    );
    expect(screen.getByTestId("custom-number")).toBeInTheDocument();
  });

  it("appends a caller-supplied className alongside the base .info-box class", () => {
    const { container } = render(
      <InfoBox color="primary" text="Projects" number={42} className="mb-0" />,
    );

    const root = container.firstElementChild;
    expect(root).toHaveClass("info-box");
    expect(root).toHaveClass("mb-0");
  });

  it("renders no grid-column wrapper of its own — the column is caller-owned", () => {
    // Deliberate contract choice (UI Design Document §2): matches the retired
    // `WidgetStatsTile`, NOT the retired `StatTile`, which wrapped itself in
    // `col-6 col-md-3 mb-3`. `TestCycleDetail`'s call sites now supply that div.
    const { container } = render(<InfoBox color="primary" text="Projects" number={42} />);

    expect(container.firstElementChild).toHaveClass("info-box");
    expect(container.querySelector('[class*="col-"]')).toBeNull();
  });
});
