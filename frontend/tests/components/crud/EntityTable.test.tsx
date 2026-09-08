import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import EntityTable from "../../../src/components/crud/EntityTable";
import type { EntityConfig } from "../../../src/entityConfigs/types";

/**
 * ADR-0025: `EntityTable` is a generic, config-driven component — these
 * tests exercise the shared rendering/permission logic once, not per
 * entity (per the ADR's own "test the shared logic once" scope note),
 * using a small fixture `EntityConfig` rather than a real one.
 */
const READ_ONLY_CONFIG: EntityConfig = {
  resource: "widget",
  path: "/widgets",
  methods: ["list", "get"],
  fields: [
    { name: "title", label: "Title", type: "string" },
    { name: "status", label: "Status", type: "enum", values: ["draft", "done"] },
  ],
};

const FULL_CRUD_CONFIG: EntityConfig = {
  ...READ_ONLY_CONFIG,
  methods: ["list", "get", "create", "update", "delete"],
};

const ROWS = [
  { id: "1", title: "First widget", status: "draft" },
  { id: "2", title: "Second widget", status: "done" },
];

describe("EntityTable", () => {
  it("renders one column header per field[] entry, labeled from the config", () => {
    render(
      <EntityTable config={READ_ONLY_CONFIG} rows={ROWS} total={2} page={1} pageSize={25} onPageChange={vi.fn()} />,
    );

    expect(screen.getByRole("columnheader", { name: "Title" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Status" })).toBeInTheDocument();
    expect(screen.getByText("First widget")).toBeInTheDocument();
    expect(screen.getByText("Second widget")).toBeInTheDocument();
  });

  it("renders no actions column and no Edit/Delete affordance when methods omits update/delete", () => {
    render(
      <EntityTable
        config={READ_ONLY_CONFIG}
        rows={ROWS}
        total={2}
        page={1}
        pageSize={25}
        onPageChange={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(screen.queryByRole("columnheader", { name: "Actions" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Edit")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Delete")).not.toBeInTheDocument();
  });

  it("renders Edit/Delete icons per row when methods include update/delete and the row-level permission callbacks allow it", () => {
    render(
      <EntityTable
        config={FULL_CRUD_CONFIG}
        rows={ROWS}
        total={2}
        page={1}
        pageSize={25}
        onPageChange={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(screen.getAllByLabelText("Edit")).toHaveLength(2);
    expect(screen.getAllByLabelText("Delete")).toHaveLength(2);
  });

  it("hides a specific row's Edit/Delete icons when the per-row permission callback returns false for that row only", () => {
    render(
      <EntityTable
        config={FULL_CRUD_CONFIG}
        rows={ROWS}
        total={2}
        page={1}
        pageSize={25}
        onPageChange={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
        canEditRow={(row) => row.id === "1"}
        canDeleteRow={() => false}
      />,
    );

    expect(screen.getAllByLabelText("Edit")).toHaveLength(1);
    expect(screen.queryByLabelText("Delete")).not.toBeInTheDocument();
  });

  it("renders a search box only when searchFields is non-empty", () => {
    const { rerender } = render(
      <EntityTable
        config={READ_ONLY_CONFIG}
        rows={ROWS}
        total={2}
        page={1}
        pageSize={25}
        onPageChange={vi.fn()}
        onSearchChange={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("entity-table-search")).not.toBeInTheDocument();

    rerender(
      <EntityTable
        config={{ ...READ_ONLY_CONFIG, searchFields: ["title"] }}
        rows={ROWS}
        total={2}
        page={1}
        pageSize={25}
        onPageChange={vi.fn()}
        onSearchChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId("entity-table-search")).toBeInTheDocument();
  });

  it("renders a 'No records found.' message instead of a table when rows is empty", () => {
    render(<EntityTable config={READ_ONLY_CONFIG} rows={[]} total={0} page={1} pageSize={25} onPageChange={vi.fn()} />);
    expect(screen.getByText("No records found.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  // TC-ADMIN-003: "Paginated ... list renders" -- `EntityTable` derives page
  // count from `total`/`pageSize` and drives `onPageChange` generically,
  // no entity-specific pagination code anywhere on this surface.
  it("renders no pagination controls when everything fits on one page", () => {
    render(<EntityTable config={READ_ONLY_CONFIG} rows={ROWS} total={2} page={1} pageSize={25} onPageChange={vi.fn()} />);
    expect(screen.queryByRole("navigation", { name: /page navigation/i })).not.toBeInTheDocument();
  });

  it("renders one page-number control per page and calls onPageChange with the clicked page", () => {
    const onPageChange = vi.fn();
    render(
      <EntityTable config={READ_ONLY_CONFIG} rows={ROWS} total={55} page={1} pageSize={25} onPageChange={onPageChange} />,
    );

    // ceil(55 / 25) = 3 pages. ADR-0042: each page control is now a real
    // `<button class="page-link">` inside its `<li class="page-item">` (CoreUI
    // rendered `<a>`, or `<span>` for the active one). The `page-item`/`active`
    // class contract the assertions below read is unchanged either way — it
    // lives on the `<li>`, not on the inner control.
    expect(screen.getByText("1").closest("li")).toHaveClass("active");
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();

    fireEvent.click(screen.getByText("2"));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  it("disables Previous on the first page and Next on the last page", () => {
    const { rerender } = render(
      <EntityTable config={READ_ONLY_CONFIG} rows={ROWS} total={55} page={1} pageSize={25} onPageChange={vi.fn()} />,
    );
    expect(screen.getByText("Previous").closest("li")).toHaveClass("disabled");
    expect(screen.getByText("Next").closest("li")).not.toHaveClass("disabled");

    rerender(
      <EntityTable config={READ_ONLY_CONFIG} rows={ROWS} total={55} page={3} pageSize={25} onPageChange={vi.fn()} />,
    );
    expect(screen.getByText("Previous").closest("li")).not.toHaveClass("disabled");
    expect(screen.getByText("Next").closest("li")).toHaveClass("disabled");
  });

  // DS-2/ADR-0041, TC-DS-016: EntityTable's own pagination chrome now comes
  // from `container/Table.tsx` — this is the one genuinely new piece of
  // behavior the migration adds (every assertion above this one is
  // regression coverage, unmodified from before DS-2).
  it("DS-2: renders a Rows-per-page selector (10/25/50/100) and forwards onPageSizeChange", () => {
    const onPageSizeChange = vi.fn();
    render(
      <EntityTable
        config={READ_ONLY_CONFIG}
        rows={ROWS}
        total={55}
        page={1}
        pageSize={25}
        onPageChange={vi.fn()}
        onPageSizeChange={onPageSizeChange}
      />,
    );

    const select = screen.getByLabelText("Rows per page") as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toEqual(["10", "25", "50", "100"]);

    fireEvent.change(select, { target: { value: "100" } });
    expect(onPageSizeChange).toHaveBeenCalledWith(100);
  });
});
