import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import EntityListPage from "./EntityListPage";
import { apiFetch } from "../../../lib/api/client";
import { listEntities } from "../../../lib/api/entityCrud";

/**
 * ADR-0073 — where a row click goes.
 *
 * `EntityTable` owns the affordance itself (covered in
 * `components/organisms/entity-table.test.tsx`); this file covers the
 * destination, which is `EntityListPage`'s, including ADR-0073 Decision §4's
 * `detailPath`-takes-precedence rule.
 *
 * Two fixture entities: `widgets` (no `detailPath` — the 27-entity majority
 * case) and `projectlikes` (declares one, standing in for `Project`'s own
 * ADR-0060 `detailPath: "/projects/:id"` bespoke workspace). The branch under
 * test is on config data, never on an entity name, so a fixture proves it.
 */
vi.mock("../../../pages/admin/registry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../pages/admin/registry")>();
  return {
    ...actual,
    entityLabelByKey: { widgets: "Widgets", projectlikes: "Projectlikes" },
    ADMIN_ENTITY_KEYS: new Set(["widgets", "projectlikes"]),
  };
});

vi.mock("../../../pages/admin/useEntitySchema", () => {
  const configs: Record<string, unknown> = {
    widgets: {
      resource: "widget",
      path: "/widgets",
      methods: ["list", "get", "update", "delete"],
      fields: [{ name: "title", label: "Title", type: "string" }],
    },
    projectlikes: {
      resource: "projectlike",
      path: "/projectlikes",
      detailPath: "/projectlikes/:id",
      detailLinkField: "title",
      methods: ["list", "get"],
      fields: [{ name: "title", label: "Title", type: "string" }],
    },
  };
  const resolveEntityKey = (key: string) => (key.endsWith("s") ? key : `${key}s`);
  return {
    resolveEntityKey,
    useEntitySchema: (key?: string) => {
      const resolved = key ? resolveEntityKey(key) : undefined;
      return {
        config: resolved ? configs[resolved] : undefined,
        label: undefined,
        isLoading: false,
        isError: false,
      };
    },
    useEntitySchemas: () => ({}),
  };
});

vi.mock("../../../lib/api/entityCrud", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/api/entityCrud")>();
  return { ...actual, listEntities: vi.fn(), getEntity: vi.fn(), deleteEntity: vi.fn() };
});

vi.mock("../../../lib/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/api/client")>();
  return { ...actual, apiFetch: vi.fn() };
});

const mockListEntities = vi.mocked(listEntities);
const mockApiFetch = vi.mocked(apiFetch);

const ROWS = [
  { id: "row-1", title: "First" },
  { id: "row-2", title: "Second" },
];

/** Reports the live pathname so a navigation can be asserted on directly. */
function LocationProbe() {
  const location = useLocation();
  return <div data-testid="pathname">{location.pathname}</div>;
}

function renderPage(entity: "widgets" | "projectlikes") {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/orgs/org-1/admin/${entity}`]}>
        <LocationProbe />
        <Routes>
          <Route path="/orgs/:orgId/admin/:entity" element={<EntityListPage />} />
          <Route path="/orgs/:orgId/admin/:entity/:id" element={<div>generic detail</div>} />
          <Route path="/orgs/:orgId/admin/:entity/:id/edit" element={<div>edit form</div>} />
          <Route path="/projectlikes/:id" element={<div>bespoke workspace</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("EntityListPage row click (ADR-0073)", () => {
  afterEach(() => vi.clearAllMocks());

  it("TC-ADMIN-059: clicking a row navigates to that row's generic detail route", async () => {
    mockApiFetch.mockResolvedValue({ codes: [] });
    mockListEntities.mockResolvedValue({ items: ROWS, total: 2, page: 1, page_size: 25 });

    renderPage("widgets");

    fireEvent.click(await screen.findByTestId("entity-table-row-row-2"));

    expect(screen.getByTestId("pathname")).toHaveTextContent("/orgs/org-1/admin/widgets/row-2");
    expect(screen.getByText("generic detail")).toBeInTheDocument();
  });

  /**
   * TC-ADMIN-063: ADR-0073 Decision §4. An entity declaring `detailPath`
   * (ADR-0060 — only `Project` does today) already links its own name cell to
   * that bespoke workspace; a row click must land in the same place, or one
   * row would have two destinations.
   */
  it("TC-ADMIN-063: clicking a row of an entity declaring detailPath navigates there, not to the generic route", async () => {
    mockApiFetch.mockResolvedValue({ codes: [] });
    mockListEntities.mockResolvedValue({ items: ROWS, total: 2, page: 1, page_size: 25 });

    renderPage("projectlikes");

    // The name cell's own ADR-0060 link points at the bespoke path...
    const link = await screen.findByRole("link", { name: "First" });
    expect(link).toHaveAttribute("href", "/projectlikes/row-1");

    // ...and so does a click anywhere else on the same row.
    fireEvent.click(screen.getByTestId("entity-table-row-row-1"));

    expect(screen.getByTestId("pathname")).toHaveTextContent("/projectlikes/row-1");
    expect(screen.getByText("bespoke workspace")).toBeInTheDocument();
  });

  /**
   * TC-ADMIN-061 (page half): the Edit icon still routes to the edit form and
   * the Delete icon still opens the confirm modal — a row click has not
   * swallowed either. `entity-table.test.tsx` covers the propagation
   * mechanism; this covers the real wiring end to end on the page.
   */
  it("TC-ADMIN-061: the Edit and Delete row actions still work, and do not open the detail page", async () => {
    mockApiFetch.mockResolvedValue({
      codes: [
        { code: "widget.update", project_id: null },
        { code: "widget.delete", project_id: null },
      ],
    });
    mockListEntities.mockResolvedValue({ items: ROWS, total: 2, page: 1, page_size: 25 });

    renderPage("widgets");

    fireEvent.click((await screen.findAllByRole("button", { name: "Delete" }))[0]);
    // The confirm modal opened; the route did not change.
    expect(screen.getByText(/Are you sure you want to delete this record/)).toBeInTheDocument();
    expect(screen.getByTestId("pathname")).toHaveTextContent("/orgs/org-1/admin/widgets");
    expect(screen.queryByText("generic detail")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getAllByRole("button", { name: "Edit" })[0]);

    expect(screen.getByTestId("pathname")).toHaveTextContent("/orgs/org-1/admin/widgets/row-1/edit");
    expect(screen.getByText("edit form")).toBeInTheDocument();
    expect(screen.queryByText("generic detail")).not.toBeInTheDocument();
  });
});
