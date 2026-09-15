/**
 * ADR-0071 (COLPREF-1) — the integration seam the two unit suites either side
 * of it cannot prove on their own: that a preference chosen in
 * `ColumnPreferencesModal` actually changes the columns `EntityTable` paints,
 * reaches `localStorage`, and is still in force on a **fresh mount**.
 *
 * The fresh-mount case is the important one and is deliberately written as
 * unmount → remount, not as a re-render: `frontend/CLAUDE.md` documents (from
 * `OrgHome`'s four-story-old list bug) that a create-then-assert test passes
 * identically whether state is persisted or merely held in memory, and only
 * an unmount can tell the two apart. It is the closest unit-level proxy for
 * the browser reload that `e2e/tests/colpref1-column-preferences.spec.ts`
 * exercises for real.
 *
 * Covers TC-ADMIN-047..052 at the component level.
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import EntityTable from "./entity-table";
import type { EntityConfig } from "../../entityConfigs/types";
import { columnPreferencesKey } from "../../lib/columnPreferences";

vi.mock("../../pages/admin/useEntitySchema", () => ({
  resolveEntityKey: (key: string) => (key.endsWith("s") ? key : `${key}s`),
  useEntitySchemas: () => ({}),
}));

const WIDGET_CONFIG: EntityConfig = {
  resource: "widget",
  path: "/widgets",
  methods: ["list", "get"],
  fields: [
    { name: "title", label: "Title", type: "string" },
    { name: "status", label: "Status", type: "enum", values: ["draft", "done"] },
    { name: "owner", label: "Owner", type: "string" },
    { name: "notes", label: "Notes", type: "string", showInTable: false },
  ],
};

/** A different entity, to prove the storage key really is per-entity. */
const GADGET_CONFIG: EntityConfig = { ...WIDGET_CONFIG, resource: "gadget", path: "/gadgets" };

/** ADR-0060 detail navigation — makes `title` a locked column. */
const LINKED_CONFIG: EntityConfig = {
  ...WIDGET_CONFIG,
  detailPath: "/widgets/:id",
  detailLinkField: "title",
};

const ROWS = [
  { id: "1", title: "First widget", status: "draft", owner: "ada" },
  { id: "2", title: "Second widget", status: "done", owner: "grace" },
];

function renderTable(config: EntityConfig = WIDGET_CONFIG) {
  return render(
    <MemoryRouter>
      <EntityTable
        title="Widgets"
        config={config}
        rows={ROWS}
        total={ROWS.length}
        page={1}
        pageSize={25}
        onPageChange={vi.fn()}
      />
    </MemoryRouter>,
  );
}

function headerLabels(): string[] {
  const table = screen.getByRole("table");
  return within(table)
    .getAllByRole("columnheader")
    .map((th) => th.textContent?.trim() ?? "");
}

function openColumnsModal() {
  fireEvent.click(screen.getByTestId("entity-table-columns"));
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("EntityTable — Columns header button", () => {
  it("renders an icon-only Columns button in the card header", () => {
    renderTable();
    const button = screen.getByTestId("entity-table-columns");
    expect(button).toHaveAccessibleName("Columns");
    expect(button).toHaveTextContent("");
  });

  it("renders no modal until the button is clicked", () => {
    renderTable();
    expect(screen.queryByTestId("column-preferences-list")).toBeNull();
  });

  it("opens a modal listing every table field of the served schema (TC-ADMIN-047)", () => {
    renderTable();
    openColumnsModal();
    const list = screen.getByTestId("column-preferences-list");
    expect(within(list).getAllByRole("checkbox").map((cb) => cb.getAttribute("id"))).toEqual([
      "column-pref-title",
      "column-pref-status",
      "column-pref-owner",
    ]);
    // `showInTable: false` fields are not table columns, so they are not
    // offered here either — the modal and the table read the same set.
    expect(screen.queryByLabelText("Notes")).toBeNull();
  });

  it("defaults to every column visible, in config order", () => {
    renderTable();
    expect(headerLabels()).toEqual(["Title", "Status", "Owner"]);
  });
});

describe("EntityTable — hiding a column (TC-ADMIN-048)", () => {
  it("removes exactly that column's header and cells, leaving the others intact", () => {
    renderTable();
    openColumnsModal();
    fireEvent.click(screen.getByLabelText("Status"));
    fireEvent.click(screen.getByTestId("column-preferences-apply"));

    expect(headerLabels()).toEqual(["Title", "Owner"]);
    // Gone from *every* row, not just the first (TC-ADMIN-048's literal wording).
    expect(screen.queryByText("draft")).toBeNull();
    expect(screen.queryByText("done")).toBeNull();
    // Every surviving column's cells still render, in both rows, asserted by
    // name — a test that only counted columns could pass while dropping the
    // wrong one.
    expect(screen.getByText("First widget")).toBeInTheDocument();
    expect(screen.getByText("Second widget")).toBeInTheDocument();
    expect(screen.getByText("ada")).toBeInTheDocument();
    expect(screen.getByText("grace")).toBeInTheDocument();
  });

  it("closes the modal on apply", () => {
    renderTable();
    openColumnsModal();
    fireEvent.click(screen.getByTestId("column-preferences-apply"));
    expect(screen.queryByTestId("column-preferences-list")).toBeNull();
  });

  it("leaves the table untouched when the modal is cancelled", () => {
    renderTable();
    openColumnsModal();
    fireEvent.click(screen.getByLabelText("Status"));
    fireEvent.click(screen.getByTestId("column-preferences-cancel"));
    expect(headerLabels()).toEqual(["Title", "Status", "Owner"]);
    expect(window.localStorage.getItem(columnPreferencesKey("widget"))).toBeNull();
  });
});

describe("EntityTable — reordering columns (TC-ADMIN-049)", () => {
  it("renders the columns in the chosen order", () => {
    renderTable();
    openColumnsModal();
    fireEvent.click(screen.getByTestId("column-preferences-up-owner"));
    fireEvent.click(screen.getByTestId("column-preferences-apply"));
    expect(headerLabels()).toEqual(["Title", "Owner", "Status"]);
  });

  it("moves each row's cells with its header, not just the header", () => {
    renderTable();
    openColumnsModal();
    fireEvent.click(screen.getByTestId("column-preferences-up-owner"));
    fireEvent.click(screen.getByTestId("column-preferences-apply"));

    const firstRow = screen.getByText("First widget").closest("tr")!;
    expect(within(firstRow).getAllByRole("cell").map((td) => td.textContent?.trim())).toEqual([
      "First widget",
      "ada",
      "draft",
    ]);
  });
});

describe("EntityTable — persistence (TC-ADMIN-050)", () => {
  it("writes the preference to the per-entity localStorage key", () => {
    renderTable();
    openColumnsModal();
    fireEvent.click(screen.getByLabelText("Status"));
    fireEvent.click(screen.getByTestId("column-preferences-apply"));

    expect(JSON.parse(window.localStorage.getItem(columnPreferencesKey("widget"))!)).toEqual({
      v: 1,
      order: ["title", "status", "owner"],
      hidden: ["status"],
    });
  });

  it("still honours a hidden column after a full unmount and remount", () => {
    const first = renderTable();
    openColumnsModal();
    fireEvent.click(screen.getByLabelText("Status"));
    fireEvent.click(screen.getByTestId("column-preferences-apply"));
    expect(headerLabels()).toEqual(["Title", "Owner"]);

    first.unmount();
    renderTable();
    expect(headerLabels()).toEqual(["Title", "Owner"]);
  });

  it("still honours a reorder after a full unmount and remount", () => {
    const first = renderTable();
    openColumnsModal();
    fireEvent.click(screen.getByTestId("column-preferences-up-owner"));
    fireEvent.click(screen.getByTestId("column-preferences-apply"));

    first.unmount();
    renderTable();
    expect(headerLabels()).toEqual(["Title", "Owner", "Status"]);
  });

  it("reopening the modal shows the persisted state, not the config default", () => {
    const first = renderTable();
    openColumnsModal();
    fireEvent.click(screen.getByLabelText("Status"));
    fireEvent.click(screen.getByTestId("column-preferences-apply"));
    first.unmount();

    renderTable();
    openColumnsModal();
    expect(screen.getByLabelText("Status")).not.toBeChecked();
    expect(screen.getByLabelText("Title")).toBeChecked();
  });
});

describe("EntityTable — per-entity isolation (TC-ADMIN-051)", () => {
  it("a preference set on one entity leaves another entity at its own defaults", () => {
    const widgets = renderTable(WIDGET_CONFIG);
    openColumnsModal();
    fireEvent.click(screen.getByLabelText("Status"));
    fireEvent.click(screen.getByTestId("column-preferences-apply"));
    expect(headerLabels()).toEqual(["Title", "Owner"]);
    widgets.unmount();

    renderTable(GADGET_CONFIG);
    expect(headerLabels()).toEqual(["Title", "Status", "Owner"]);
    expect(window.localStorage.getItem(columnPreferencesKey("gadget"))).toBeNull();
  });

  it("re-reads storage when the same mounted table switches entity", () => {
    window.localStorage.setItem(
      columnPreferencesKey("gadget"),
      JSON.stringify({ v: 1, order: ["owner", "title", "status"], hidden: ["status"] }),
    );
    const view = renderTable(WIDGET_CONFIG);
    expect(headerLabels()).toEqual(["Title", "Status", "Owner"]);

    view.rerender(
      <MemoryRouter>
        <EntityTable
          title="Gadgets"
          config={GADGET_CONFIG}
          rows={ROWS}
          total={ROWS.length}
          page={1}
          pageSize={25}
          onPageChange={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(headerLabels()).toEqual(["Owner", "Title"]);
  });
});

describe("EntityTable — locked columns (TC-ADMIN-052)", () => {
  it("disables the detailLinkField's checkbox", () => {
    renderTable(LINKED_CONFIG);
    openColumnsModal();
    expect(screen.getByLabelText("Title")).toBeDisabled();
    expect(screen.getByLabelText("Status")).not.toBeDisabled();
  });

  it("renders a locked column even when a stale stored preference hides it", () => {
    window.localStorage.setItem(
      columnPreferencesKey("widget"),
      JSON.stringify({ v: 1, order: [], hidden: ["title", "status"] }),
    );
    renderTable(LINKED_CONFIG);
    expect(headerLabels()).toEqual(["Title", "Owner"]);
  });

  it("disables the last remaining visible checkbox so the table can never lose every column", () => {
    renderTable();
    openColumnsModal();
    fireEvent.click(screen.getByLabelText("Status"));
    fireEvent.click(screen.getByLabelText("Owner"));
    expect(screen.getByLabelText("Title")).toBeDisabled();
    expect(screen.getByLabelText("Title")).toBeChecked();
    fireEvent.click(screen.getByTestId("column-preferences-apply"));
    expect(headerLabels()).toEqual(["Title"]);
  });

  it("persists a hidden column AND a reorder together in one stored object (TC-ADMIN-050)", () => {
    // TC-ADMIN-050's literal precondition is one column hidden *and* two
    // columns reordered in the same session — a write path that persists
    // `hidden` but drops `order` (or vice versa) passes each half separately
    // and fails only here.
    const first = renderTable();
    openColumnsModal();
    fireEvent.click(screen.getByLabelText("Status"));
    // Two moves, so `owner` and `title` swap relative to config order — a
    // single move would leave the surviving pair in their original sequence
    // and prove nothing about `order` being persisted.
    fireEvent.click(screen.getByTestId("column-preferences-up-owner"));
    fireEvent.click(screen.getByTestId("column-preferences-up-owner"));
    fireEvent.click(screen.getByTestId("column-preferences-apply"));
    expect(headerLabels()).toEqual(["Owner", "Title"]);

    expect(JSON.parse(window.localStorage.getItem(columnPreferencesKey("widget"))!)).toEqual({
      v: 1,
      order: ["owner", "title", "status"],
      hidden: ["status"],
    });

    first.unmount();
    renderTable();
    expect(headerLabels()).toEqual(["Owner", "Title"]);
  });
});

describe("EntityTable — reset and degradation", () => {
  it("Reset to defaults clears the stored preference and restores config order", () => {
    renderTable();
    openColumnsModal();
    fireEvent.click(screen.getByLabelText("Status"));
    fireEvent.click(screen.getByTestId("column-preferences-apply"));
    expect(headerLabels()).toEqual(["Title", "Owner"]);

    openColumnsModal();
    fireEvent.click(screen.getByTestId("column-preferences-reset"));
    expect(headerLabels()).toEqual(["Title", "Status", "Owner"]);
    expect(window.localStorage.getItem(columnPreferencesKey("widget"))).toBeNull();
  });

  it("falls back to config defaults on a corrupt stored value (NFR-71)", () => {
    window.localStorage.setItem(columnPreferencesKey("widget"), "{not json");
    renderTable();
    expect(headerLabels()).toEqual(["Title", "Status", "Owner"]);
  });

  it("renders normally when localStorage access throws outright (NFR-71)", () => {
    vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(() => renderTable()).not.toThrow();
    expect(headerLabels()).toEqual(["Title", "Status", "Owner"]);
  });
});
