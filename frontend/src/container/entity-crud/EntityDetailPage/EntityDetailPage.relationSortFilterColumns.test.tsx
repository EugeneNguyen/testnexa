import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import EntityDetailPage from "./EntityDetailPage";
import { apiFetch } from "../../../lib/api/client";
import { getEntity, listEntities } from "../../../lib/api/entityCrud";

/**
 * ADR-0092 — a relationship tab's table gets the same sort/Filter/Columns
 * capability a standalone `EntityListPage` has, not a stripped-down view.
 *
 * Same mocking shape as `EntityDetailPage.tabs.test.tsx`, with one relation
 * (`sprockets`) whose fields carry `filterFields`/`sortable` so both the
 * Filter button and the sortable column-header toggle actually render —
 * `EntityDetailPage.tabs.test.tsx`'s own fixture declares neither, which is
 * why those assertions live in a separate file rather than folded into it.
 */
vi.mock("../../../pages/admin/registry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../pages/admin/registry")>();
  return {
    ...actual,
    entityLabelByKey: { widgets: "Widgets" },
    ADMIN_ENTITY_KEYS: new Set(["widgets", "sprockets"]),
  };
});

vi.mock("../../../pages/admin/useEntitySchema", () => {
  const configs: Record<string, unknown> = {
    widgets: {
      resource: "widget",
      path: "/widgets",
      methods: ["list", "get", "update", "delete"],
      fields: [{ name: "title", label: "Title", type: "string", required: true }],
      relations: [
        {
          kind: "one-to-many",
          entity: "sprockets",
          scopeField: "widget_id",
          label: "Sprockets",
          targetEntity: "sprockets",
          targetField: null,
        },
      ],
    },
    sprockets: {
      resource: "sprocket",
      path: "/sprockets",
      methods: ["list", "get", "update", "delete"],
      filterFields: ["name"],
      fields: [
        { name: "name", label: "Name", type: "string", filterable: true, sortable: true },
        { name: "widget_id", label: "Widget", type: "fk", refEntity: "widget", labelField: "title" },
      ],
      relations: [],
    },
  };
  const resolveEntityKey = (key: string) => (key.endsWith("s") ? key : `${key}s`);
  return {
    resolveEntityKey,
    useEntitySchema: (key?: string) => {
      const resolved = key ? resolveEntityKey(key) : undefined;
      return {
        config: resolved ? configs[resolved] : undefined,
        label: resolved ? "Sprockets" : undefined,
        isLoading: false,
        isError: false,
      };
    },
    useEntitySchemas: (keys: string[]) => {
      const out: Record<string, unknown> = {};
      for (const key of keys) {
        const resolved = resolveEntityKey(key);
        if (configs[resolved]) {
          out[resolved] = configs[resolved];
        }
      }
      return out;
    },
  };
});

vi.mock("../../../lib/api/entityCrud", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/api/entityCrud")>();
  return { ...actual, getEntity: vi.fn(), listEntities: vi.fn() };
});

vi.mock("../../../lib/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/api/client")>();
  return { ...actual, apiFetch: vi.fn() };
});

const mockGetEntity = vi.mocked(getEntity);
const mockListEntities = vi.mocked(listEntities);
const mockApiFetch = vi.mocked(apiFetch);

const WIDGET_ROW = { id: "w-1", title: "First widget" };

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/orgs/org-1/admin/widgets/w-1"]}>
        <Routes>
          <Route path="/orgs/:orgId/admin/:entity/:id" element={<EntityDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function primeMocks(items: Record<string, unknown>[] = []) {
  mockApiFetch.mockResolvedValue({ codes: [] });
  mockGetEntity.mockResolvedValue(WIDGET_ROW);
  mockListEntities.mockResolvedValue({ items, total: items.length, page: 1, page_size: 25 });
}

describe("EntityRelationTab sort/filter/columns (ADR-0092)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders the Columns button in a bare relation tab, previously absent entirely", async () => {
    const user = userEvent.setup();
    primeMocks([{ id: "s-1", name: "First sprocket", widget_id: "w-1" }]);

    renderPage();
    await screen.findByTestId("entity-detail-field-title");
    await user.click(screen.getByTestId("entity-detail-tab-sprockets"));

    expect(await screen.findByTestId("entity-table-columns")).toBeInTheDocument();
  });

  it("renders the Filter button when the far entity declares filterFields, and applying a filter re-queries with it", async () => {
    const user = userEvent.setup();
    primeMocks([{ id: "s-1", name: "First sprocket", widget_id: "w-1" }]);

    renderPage();
    await screen.findByTestId("entity-detail-field-title");
    await user.click(screen.getByTestId("entity-detail-tab-sprockets"));

    const filterButton = await screen.findByTestId("entity-table-filter");
    await user.click(filterButton);

    // FilterModal: only one filterable field ("name") exists, so adding a
    // condition auto-assigns it — type a value and apply.
    await user.click(await screen.findByTestId("filter-add-condition"));
    await user.type(screen.getByTestId("filter-value-name"), "First");
    await user.click(screen.getByTestId("filter-apply"));

    await waitFor(() => {
      const calls = mockListEntities.mock.calls;
      const query = calls[calls.length - 1][2] as { params: Record<string, string> };
      expect(query.params).toEqual({ name: "First", widget_id: "w-1" });
    });
  });

  it("clicking a sortable column header toggles sort and re-queries with ?sort=", async () => {
    const user = userEvent.setup();
    primeMocks([{ id: "s-1", name: "First sprocket", widget_id: "w-1" }]);

    renderPage();
    await screen.findByTestId("entity-detail-field-title");
    await user.click(screen.getByTestId("entity-detail-tab-sprockets"));
    await screen.findByText("First sprocket");

    await user.click(await screen.findByTestId("entity-table-sort-name"));

    await waitFor(() => {
      const calls = mockListEntities.mock.calls;
      const query = calls[calls.length - 1][2] as { sort?: string };
      expect(query.sort).toBe("name");
    });

    await user.click(await screen.findByTestId("entity-table-sort-name"));

    await waitFor(() => {
      const calls = mockListEntities.mock.calls;
      const query = calls[calls.length - 1][2] as { sort?: string };
      expect(query.sort).toBe("-name");
    });
  });
});
