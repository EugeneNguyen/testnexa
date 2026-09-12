import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import Table from "./Table";

/**
 * DS-2 ([ADR-0041](../../../docs/adr/0041-ds-2-table-container-shared-pagination.md)),
 * Test Design §34 / TC-DS-009..018. These tests exercise the shared
 * container directly with a small fixture row shape — `EntityTable`'s and
 * `OrgHome`'s own test files cover the *migrated screens'* regressions
 * (TC-DS-015/016), not the container's own contract, which is what this
 * file is for.
 *
 * ADR-0042 (CoreUI -> AdminLTE v4): the fixture `columns`/`renderRow` below
 * are raw `<tr>`/`<th scope="col">`/`<td>` now, not
 * `<CTableRow>`/`<CTableHeaderCell>`/`<CTableDataCell>` — that is the
 * container's new caller contract, not a test-only convenience. Every
 * assertion in this file is otherwise unchanged: the rendered class contract
 * (`page-item`/`active`/`disabled`) and every `data-testid` survived the
 * migration intact.
 */

type Row = { id: string; label: string };

function makeRows(n: number): Row[] {
  return Array.from({ length: n }, (_, i) => ({ id: String(i + 1), label: `Row ${i + 1}` }));
}

const columns = (
  <tr>
    <th scope="col">Label</th>
  </tr>
);

function renderRow(row: Row) {
  return (
    <tr key={row.id}>
      <td>{row.label}</td>
    </tr>
  );
}

describe("Table container", () => {
  // TC-DS-009 (superseded): pagination now renders even on a single page —
  // Previous/Next are just disabled — see this file's own TC-DS-009 note.
  it("renders the header slot, all rows, and a (disabled) pagination row when everything fits on one page", () => {
    render(
      <Table
        mode="server"
        items={makeRows(3)}
        total={3}
        page={1}
        pageSize={10}
        rowKey={(r) => r.id}
        columns={columns}
        renderRow={renderRow}
        header={<div data-testid="toolbar">Toolbar</div>}
        testIdPrefix="fixture"
      />,
    );

    expect(screen.getByTestId("toolbar")).toBeInTheDocument();
    expect(screen.getByText("Row 1")).toBeInTheDocument();
    expect(screen.getByText("Row 3")).toBeInTheDocument();
    expect(screen.getByTestId("fixture-pagination")).toBeInTheDocument();
    expect(screen.getByTestId("fixture-page-size")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });

  // TC-DS-010 (server mode: page-boundary navigation)
  it("server mode: first page disables Previous, middle page enables both, last page disables Next", () => {
    const onPageChange = vi.fn();
    const { rerender } = render(
      <Table
        mode="server"
        items={makeRows(10).slice(0, 10)}
        total={25}
        page={1}
        pageSize={10}
        onPageChange={onPageChange}
        onPageSizeChange={vi.fn()}
        rowKey={(r) => r.id}
        columns={columns}
        renderRow={renderRow}
        testIdPrefix="fixture"
      />,
    );

    // Page 1 of 3 (25 rows / 10 per page): Previous disabled, Next enabled.
    expect(screen.getByText("Previous").closest("li")).toHaveClass("disabled");
    expect(screen.getByText("Next").closest("li")).not.toHaveClass("disabled");

    // Middle page (2 of 3): both enabled.
    rerender(
      <Table
        mode="server"
        items={makeRows(10)}
        total={25}
        page={2}
        pageSize={10}
        onPageChange={onPageChange}
        onPageSizeChange={vi.fn()}
        rowKey={(r) => r.id}
        columns={columns}
        renderRow={renderRow}
        testIdPrefix="fixture"
      />,
    );
    expect(screen.getByText("Previous").closest("li")).not.toHaveClass("disabled");
    expect(screen.getByText("Next").closest("li")).not.toHaveClass("disabled");

    // Last page (3 of 3, 5 rows): Next disabled, Previous enabled.
    rerender(
      <Table
        mode="server"
        items={makeRows(5)}
        total={25}
        page={3}
        pageSize={10}
        onPageChange={onPageChange}
        onPageSizeChange={vi.fn()}
        rowKey={(r) => r.id}
        columns={columns}
        renderRow={renderRow}
        testIdPrefix="fixture"
      />,
    );
    expect(screen.getByText("Previous").closest("li")).not.toHaveClass("disabled");
    expect(screen.getByText("Next").closest("li")).toHaveClass("disabled");

    // "3" is the currently-active page. Pre-ADR-0042 that was a hard
    // constraint (CoreUI's `CPaginationItem` rendered the active item as a
    // <span> and dropped its onClick); post-migration it is a real <button>
    // that would fire. Clicking a *non-active* page is still the right way to
    // prove `onPageChange` is wired (`frontend/CLAUDE.md`), so this is
    // unchanged — only the active item's accessible state is newly assertable.
    expect(screen.getByText("3")).toHaveAttribute("aria-current", "page");
    fireEvent.click(screen.getByText("2"));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  // TC-DS-010 (client mode: page-boundary navigation, exact row sets)
  it("client mode: renders the correct row slice per page and none from the other page", () => {
    render(
      <Table
        mode="client"
        items={makeRows(12)}
        defaultPageSize={10}
        rowKey={(r) => r.id}
        columns={columns}
        renderRow={renderRow}
        testIdPrefix="fixture"
      />,
    );

    expect(screen.getByText("Row 1")).toBeInTheDocument();
    expect(screen.getByText("Row 10")).toBeInTheDocument();
    expect(screen.queryByText("Row 11")).not.toBeInTheDocument();
    expect(screen.queryByText("Row 12")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("2"));

    expect(screen.getByText("Row 11")).toBeInTheDocument();
    expect(screen.getByText("Row 12")).toBeInTheDocument();
    expect(screen.queryByText("Row 1")).not.toBeInTheDocument();
  });

  // TC-DS-011 (server mode)
  it("server mode: changing page size fires onPageSizeChange AND onPageChange(1)", () => {
    const onPageChange = vi.fn();
    const onPageSizeChange = vi.fn();
    render(
      <Table
        mode="server"
        items={makeRows(10)}
        total={100}
        page={3}
        pageSize={10}
        onPageChange={onPageChange}
        onPageSizeChange={onPageSizeChange}
        rowKey={(r) => r.id}
        columns={columns}
        renderRow={renderRow}
        testIdPrefix="fixture"
      />,
    );

    fireEvent.change(screen.getByTestId("fixture-page-size"), { target: { value: "25" } });

    expect(onPageSizeChange).toHaveBeenCalledWith(25);
    expect(onPageChange).toHaveBeenCalledWith(1);
  });

  // TC-DS-011 (client mode)
  it("client mode: changing page size resets to page 1 and re-slices with the new size", () => {
    render(
      <Table
        mode="client"
        items={makeRows(30)}
        defaultPageSize={10}
        rowKey={(r) => r.id}
        columns={columns}
        renderRow={renderRow}
        testIdPrefix="fixture"
      />,
    );

    fireEvent.click(screen.getByText("3"));
    expect(screen.getByText("Row 21")).toBeInTheDocument();

    fireEvent.change(screen.getByTestId("fixture-page-size"), { target: { value: "25" } });

    // Page 1 of the new (coarser) pagination, not page 3 reinterpreted.
    expect(screen.getByText("Row 1")).toBeInTheDocument();
    expect(screen.getByText("Row 25")).toBeInTheDocument();
    expect(screen.queryByText("Row 26")).not.toBeInTheDocument();
  });

  // TC-DS-012 (frontend side: the selector itself only ever offers the 4 canonical options)
  it("page-size selector offers exactly 10/25/50/100, nothing else", () => {
    render(
      <Table
        mode="client"
        items={makeRows(150)}
        defaultPageSize={10}
        rowKey={(r) => r.id}
        columns={columns}
        renderRow={renderRow}
        testIdPrefix="fixture"
      />,
    );

    const select = screen.getByTestId("fixture-page-size") as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).toEqual(["10", "25", "50", "100"]);
  });

  // TC-DS-014 (superseded): pagination still renders (disabled) for an empty
  // items array; the caller still owns the empty-state message/row content.
  it("renders no rows for an empty items array — caller owns the empty-state message", () => {
    render(
      <Table
        mode="client"
        items={[]}
        defaultPageSize={10}
        rowKey={(r) => r.id}
        columns={columns}
        renderRow={renderRow}
        testIdPrefix="fixture"
      />,
    );

    expect(screen.getByTestId("fixture-pagination")).toBeInTheDocument();
    expect(screen.getByTestId("fixture-page-size")).toBeInTheDocument();
    expect(screen.queryAllByRole("cell")).toHaveLength(0);
  });

  // TC-DS-NEW-01: Tabler cascade pass — default `table-vcenter` matches Tabler's polished look.
  it("renders the table with `table-vcenter` by default (Tabler-style default)", () => {
    const { container } = render(
      <Table
        mode="client"
        items={makeRows(3)}
        defaultPageSize={10}
        rowKey={(r) => r.id}
        columns={columns}
        renderRow={renderRow}
        testIdPrefix="fixture"
      />,
    );

    const table = container.querySelector("table");
    expect(table).not.toBeNull();
    expect(table!.className).toContain("table");
    expect(table!.className).toContain("table-vcenter");
    expect(table!.className).toContain("table-hover");
  });

  // TC-DS-NEW-02: stickyHeader adds `sticky-top` to the thead only.
  it("`stickyHeader` adds `sticky-top` to the thead", () => {
    const { container } = render(
      <Table
        mode="client"
        items={makeRows(3)}
        defaultPageSize={10}
        rowKey={(r) => r.id}
        columns={columns}
        renderRow={renderRow}
        stickyHeader
        testIdPrefix="fixture"
      />,
    );

    const thead = container.querySelector("thead");
    expect(thead).not.toBeNull();
    expect(thead!.className).toContain("sticky-top");
  });

  // TC-DS-NEW-03: responsive breakpoint variants.
  it("`responsive=\"md\"` uses the breakpoint-scoped `table-responsive-md` wrapper", () => {
    const { container } = render(
      <Table
        mode="client"
        items={makeRows(3)}
        defaultPageSize={10}
        rowKey={(r) => r.id}
        columns={columns}
        renderRow={renderRow}
        responsive="md"
        testIdPrefix="fixture"
      />,
    );

    // TC-DS-NEW-03: responsive breakpoint variants.
    const wrapper = container.querySelector("div.table-responsive-md");
    expect(wrapper).not.toBeNull();
    expect(wrapper!.querySelector("table")).not.toBeNull();
  });

  // TC-DS-NEW-03b: `responsive={false}` drops the wrapper entirely.
  it("`responsive={false}` renders no `table-responsive` wrapper around the table", () => {
    const { container } = render(
      <Table
        mode="client"
        items={makeRows(3)}
        defaultPageSize={10}
        rowKey={(r) => r.id}
        columns={columns}
        renderRow={renderRow}
        responsive={false}
        testIdPrefix="fixture"
      />,
    );

    expect(container.querySelector(".table-responsive")).toBeNull();
    expect(container.querySelector(".table-responsive-md")).toBeNull();
    expect(container.querySelector("table")).not.toBeNull();
  });

  // TC-DS-NEW-04: caption prop renders a real <caption> inside the <table>.
  it("`caption` prop renders a real <caption> element inside the <table>", () => {
    const { container } = render(
      <Table
        mode="client"
        items={makeRows(3)}
        defaultPageSize={10}
        rowKey={(r) => r.id}
        columns={columns}
        renderRow={renderRow}
        caption={<span>List of fixtures</span>}
        testIdPrefix="fixture"
      />,
    );

    const caption = container.querySelector("table > caption");
    expect(caption).not.toBeNull();
    expect(caption!.textContent).toBe("List of fixtures");
  });

  // TC-DS-NEW-05: card mode wraps the table in `<div class="card">` with a
  // `.card-header` holding the title (h3.card-title) and the `cardActions`
  // slot (`.card-actions` div), and the table itself gets `card-table`
  // instead of `table-vcenter table-hover`. Backward compat: callers that
  // don't pass `cardTitle` get the original wrapper-less rendering.
  it("card mode: `cardTitle` wraps everything in `.card`, with a `.card-header` + h3.card-title", () => {
    const { container } = render(
      <Table
        mode="client"
        items={makeRows(3)}
        defaultPageSize={10}
        rowKey={(r) => r.id}
        columns={columns}
        renderRow={renderRow}
        cardTitle="Projects"
        testIdPrefix="fixture"
      />,
    );

    const card = container.querySelector(".card");
    expect(card).not.toBeNull();
    const header = card!.querySelector(".card-header");
    expect(header).not.toBeNull();
    expect(header!.querySelector("h3.card-title")!.textContent).toBe("Projects");
    // Table className swaps to card-table in card mode.
    const table = card!.querySelector("table");
    expect(table!.className).toContain("card-table");
    expect(table!.className).not.toContain("table-vcenter");
    // No `table-responsive` wrapper inside a card.
    expect(card!.querySelector(".table-responsive")).toBeNull();
  });

  // TC-DS-NEW-06: cardActions renders inside `.card-actions` div, alongside title.
  it("card mode: `cardActions` renders inside `.card-actions` next to the title", () => {
    const onClick = vi.fn();
    const { container } = render(
      <Table
        mode="client"
        items={makeRows(3)}
        defaultPageSize={10}
        rowKey={(r) => r.id}
        columns={columns}
        renderRow={renderRow}
        cardTitle="Projects"
        cardActions={
          <button type="button" className="btn btn-primary" onClick={onClick}>
            New Project
          </button>
        }
        testIdPrefix="fixture"
      />,
    );

    const actions = container.querySelector(".card-header > .card-actions");
    expect(actions).not.toBeNull();
    const button = actions!.querySelector("button");
    expect(button).not.toBeNull();
    expect(button!.textContent).toBe("New Project");
    fireEvent.click(button!);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  // TC-DS-NEW-07: no `cardTitle` → original wrapper-less rendering, no `.card`.
  it("without `cardTitle`: no `.card` wrapper, original `table-vcenter table-hover` classes", () => {
    const { container } = render(
      <Table
        mode="client"
        items={makeRows(3)}
        defaultPageSize={10}
        rowKey={(r) => r.id}
        columns={columns}
        renderRow={renderRow}
        testIdPrefix="fixture"
      />,
    );

    expect(container.querySelector(".card")).toBeNull();
    expect(container.querySelector(".card-header")).toBeNull();
    const table = container.querySelector("table");
    expect(table!.className).toContain("table-vcenter");
    expect(table!.className).not.toContain("card-table");
  });

  // TC-DS-018
  it("does not persist a page-size change — unmount and remount returns to defaultPageSize", () => {
    const { unmount } = render(
      <Table
        mode="client"
        items={makeRows(30)}
        defaultPageSize={10}
        rowKey={(r) => r.id}
        columns={columns}
        renderRow={renderRow}
        testIdPrefix="fixture"
      />,
    );

    fireEvent.change(screen.getByTestId("fixture-page-size"), { target: { value: "25" } });
    expect((screen.getByTestId("fixture-page-size") as HTMLSelectElement).value).toBe("25");

    unmount();

    render(
      <Table
        mode="client"
        items={makeRows(30)}
        defaultPageSize={10}
        rowKey={(r) => r.id}
        columns={columns}
        renderRow={renderRow}
        testIdPrefix="fixture"
      />,
    );

    // Fresh mount, no persistence layer — back to the caller's default.
    expect((screen.getByTestId("fixture-page-size") as HTMLSelectElement).value).toBe("10");
  });
});
