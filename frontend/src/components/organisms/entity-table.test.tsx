import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import EntityTable from "./entity-table";
import { getEntity } from "../../lib/api/entityCrud";
import type { EntityConfig } from "../../entityConfigs/types";

/**
 * ADR-0025: `EntityTable` is a generic, config-driven component — these
 * tests exercise the shared rendering/permission logic once, not per
 * entity (per the ADR's own "test the shared logic once" scope note),
 * using a small fixture `EntityConfig` rather than a real one.
 *
 * **ADR-0053:** FK columns resolve their ref-entity configs via
 * `useEntitySchemas([...])` (one batched fetch at the top of the component)
 * instead of the retired `entityConfigByKey` registry map. The hook is mocked
 * here — every test in this file, including the 9 that predate ADR-0053 and
 * have no FK column at all, would otherwise need a `QueryClientProvider`,
 * since `useEntitySchemas` calls `useQueries` unconditionally.
 * `refSchemas` is the mock's own resolved-schema map; a key absent from it is
 * the "schema hasn't landed yet" case.
 */
const { refSchemas } = vi.hoisted(() => ({
  refSchemas: {} as Record<string, unknown>,
}));

vi.mock("../../pages/admin/useEntitySchema", () => ({
  // Same singular -> plural shape the real `resolveEntityKey` implements
  // ("widget-owner" -> "widget-owners"), minus its registry membership check.
  resolveEntityKey: (key: string) => (key.endsWith("s") ? key : `${key}s`),
  useEntitySchemas: () => refSchemas,
}));

vi.mock("../../lib/api/entityCrud", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api/entityCrud")>();
  return { ...actual, getEntity: vi.fn() };
});

const mockGetEntity = vi.mocked(getEntity);

const OWNER_CONFIG: EntityConfig = {
  resource: "widget_owner",
  path: "/widget-owners",
  methods: ["list", "get"],
  fields: [{ name: "name", label: "Name", type: "string" }],
};

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

/** ADR-0053: `badgeColors` is served per-field, already filtered to `values`. */
const BADGE_COLOR_CONFIG: EntityConfig = {
  ...READ_ONLY_CONFIG,
  fields: [
    { name: "title", label: "Title", type: "string" },
    {
      name: "status",
      label: "Status",
      type: "enum",
      values: ["draft", "done"],
      badgeColors: { draft: "warning", done: "success" },
    },
  ],
};

const FK_CONFIG: EntityConfig = {
  ...READ_ONLY_CONFIG,
  fields: [
    { name: "title", label: "Title", type: "string" },
    { name: "owner_id", label: "Owner", type: "fk", refEntity: "widget-owner", labelField: "name" },
  ],
};

const ROWS = [
  { id: "1", title: "First widget", status: "draft" },
  { id: "2", title: "Second widget", status: "done" },
];

describe("EntityTable", () => {
  afterEach(() => {
    Object.keys(refSchemas).forEach((key) => delete refSchemas[key]);
    vi.clearAllMocks();
  });

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

  // ADR-0053: the FK column's ref-entity config comes from the batched
  // `useEntitySchemas` lookup, keyed by the *resolved* (plural) entity key —
  // `refEntity` on the field is singular.
  it("ADR-0053: resolves an fk cell's label via the batched ref-entity schema lookup", async () => {
    refSchemas["widget-owners"] = OWNER_CONFIG;
    mockGetEntity.mockResolvedValue({ id: "owner-1", name: "Alice" });

    render(
      <EntityTable
        config={FK_CONFIG}
        rows={[{ id: "1", title: "First widget", owner_id: "owner-1" }]}
        total={1}
        page={1}
        pageSize={25}
        onPageChange={vi.fn()}
      />,
    );

    expect(await screen.findByText("Alice")).toBeInTheDocument();
    expect(mockGetEntity).toHaveBeenCalledWith(OWNER_CONFIG, "owner-1");
  });

  // The schema now arrives asynchronously, where the registry lookup was
  // synchronous — until it lands there is nothing to call `getEntity` with, and
  // the raw id is what the cell shows (the same fallback a failed lookup uses).
  it("ADR-0053: renders the raw fk id, and fires no request, while the ref-entity schema is unresolved", async () => {
    render(
      <EntityTable
        config={FK_CONFIG}
        rows={[{ id: "1", title: "First widget", owner_id: "owner-1" }]}
        total={1}
        page={1}
        pageSize={25}
        onPageChange={vi.fn()}
      />,
    );

    expect(screen.getByText("owner-1")).toBeInTheDocument();
    await waitFor(() => expect(mockGetEntity).not.toHaveBeenCalled());
  });

  // ADR-0053: enum badge colours are served per-field by the backend, replacing
  // this component's old module-level `ENUM_BADGE_COLORS` constant.
  it("ADR-0053: colours an enum badge from the field's backend-served badgeColors", () => {
    render(
      <EntityTable
        config={BADGE_COLOR_CONFIG}
        rows={ROWS}
        total={2}
        page={1}
        pageSize={25}
        onPageChange={vi.fn()}
      />,
    );

    expect(screen.getByText("draft")).toHaveClass("badge", "bg-warning");
    expect(screen.getByText("done")).toHaveClass("badge", "bg-success");
  });

  // Two enums (`EntryExitCriteria.type`, `TestLog.event_type`) are served with
  // no `badgeColors` key at all, and a partially-coloured enum leaves its other
  // values uncoloured — both must keep rendering the plain grey badge.
  it("ADR-0053: falls back to a plain grey badge for any enum value with no served colour", () => {
    const { rerender } = render(
      <EntityTable config={READ_ONLY_CONFIG} rows={ROWS} total={2} page={1} pageSize={25} onPageChange={vi.fn()} />,
    );
    // No `badgeColors` on the field at all.
    expect(screen.getByText("draft")).toHaveClass("badge", "bg-secondary");
    expect(screen.getByText("done")).toHaveClass("badge", "bg-secondary");

    rerender(
      <EntityTable
        config={{
          ...READ_ONLY_CONFIG,
          fields: [
            { name: "title", label: "Title", type: "string" },
            { name: "status", label: "Status", type: "enum", values: ["draft", "done"], badgeColors: { done: "success" } },
          ],
        }}
        rows={ROWS}
        total={2}
        page={1}
        pageSize={25}
        onPageChange={vi.fn()}
      />,
    );
    // Partially coloured: the uncoloured value still gets grey.
    expect(screen.getByText("draft")).toHaveClass("badge", "bg-secondary");
    expect(screen.getByText("done")).toHaveClass("badge", "bg-success");
  });

  // ADR-0060: restores ProjectsPage's "click a row's name to open it"
  // navigation, generically — only `Project` uses this today, but the
  // mechanism itself is config-driven, not hardcoded to that entity.
  describe("detailPath/detailLinkField (ADR-0060)", () => {
    const DETAIL_LINK_CONFIG: EntityConfig = {
      ...READ_ONLY_CONFIG,
      detailPath: "/widgets/:id",
      detailLinkField: "title",
    };

    it("renders the designated field's cell as a link to the interpolated detail path", () => {
      render(
        <MemoryRouter>
          <EntityTable config={DETAIL_LINK_CONFIG} rows={ROWS} total={2} page={1} pageSize={25} onPageChange={vi.fn()} />
        </MemoryRouter>,
      );

      const link = screen.getByRole("link", { name: "First widget" });
      expect(link).toHaveAttribute("href", "/widgets/1");
      // The other configured field (status) is never linked, even though a
      // config could name any field — only the one designated field is.
      expect(screen.queryByRole("link", { name: "draft" })).not.toBeInTheDocument();
    });

    it("renders a plain cell, no link, when detailPath/detailLinkField isn't configured", () => {
      render(
        <EntityTable config={READ_ONLY_CONFIG} rows={ROWS} total={2} page={1} pageSize={25} onPageChange={vi.fn()} />,
      );

      expect(screen.getByText("First widget")).toBeInTheDocument();
      expect(screen.queryByRole("link")).not.toBeInTheDocument();
    });
  });
});
