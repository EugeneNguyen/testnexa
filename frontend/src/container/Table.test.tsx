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
  // TC-DS-009
  it("renders the header slot and all rows, no pagination row when everything fits on one page", () => {
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
    expect(screen.queryByTestId("fixture-pagination")).not.toBeInTheDocument();
    expect(screen.queryByTestId("fixture-page-size")).not.toBeInTheDocument();
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

  // TC-DS-014
  it("renders nothing (no pagination row) for an empty items array — caller owns the empty-state message", () => {
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

    expect(screen.queryByTestId("fixture-pagination")).not.toBeInTheDocument();
    expect(screen.queryByTestId("fixture-page-size")).not.toBeInTheDocument();
    expect(screen.queryAllByRole("cell")).toHaveLength(0);
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
