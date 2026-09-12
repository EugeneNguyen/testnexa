import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import EntityListPage from "./EntityListPage";
import { apiFetch } from "../../../lib/api/client";
import { listEntities } from "../../../lib/api/entityCrud";

/**
 * ADR-0053 (sort): `EntityListPage` owns the click-header-to-sort toggle
 * state (unsorted -> ascending -> descending -> unsorted) and turns it into
 * the `sort` query param `listEntities` puts on the wire — mirrors
 * `EntityListPage.test.tsx`'s own mocking setup verbatim (same fixture
 * shape, same `./useEntitySchema`/`./registry` mocks), scoped to this one
 * new behavior rather than folded into that file.
 */
vi.mock("../../../pages/admin/registry", () => ({
  entityLabelByKey: {
    widgets: "Widgets",
  },
  ADMIN_ENTITY_KEYS: new Set(["widgets"]),
}));

vi.mock("../../../pages/admin/useEntitySchema", () => {
  const configs: Record<string, unknown> = {
    widgets: {
      resource: "widget",
      path: "/widgets",
      methods: ["list", "get", "create"],
      fields: [
        { name: "name", label: "Name", type: "string", required: true },
        { name: "unsortable_field", label: "Unsortable", type: "string", sortable: false },
      ],
    },
  };
  const labels: Record<string, string> = { widgets: "Widgets" };
  const resolveEntityKey = (key: string) => (key.endsWith("s") ? key : `${key}s`);
  return {
    resolveEntityKey,
    useEntitySchema: (key?: string) => {
      const resolved = key ? resolveEntityKey(key) : undefined;
      return {
        config: resolved ? configs[resolved] : undefined,
        label: resolved ? labels[resolved] : undefined,
        isLoading: false,
        isError: false,
      };
    },
    useEntitySchemas: () => ({}),
  };
});

vi.mock("../../../lib/api/entityCrud", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/api/entityCrud")>();
  return { ...actual, listEntities: vi.fn(), getEntity: vi.fn(), createEntity: vi.fn(), deleteEntity: vi.fn() };
});

vi.mock("../../../lib/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/api/client")>();
  return { ...actual, apiFetch: vi.fn() };
});

const mockListEntities = vi.mocked(listEntities);
const mockApiFetch = vi.mocked(apiFetch);

function lastSortParam(): string | undefined {
  const calls = mockListEntities.mock.calls;
  const lastCall = calls[calls.length - 1];
  return lastCall?.[2]?.sort;
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/orgs/org-1/admin/widgets"]}>
        <Routes>
          <Route path="/orgs/:orgId/admin/:entity" element={<EntityListPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("EntityListPage — click-header-to-sort (ADR-0053)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("fires the initial list request with no sort param", async () => {
    mockApiFetch.mockResolvedValue({ codes: [] });
    mockListEntities.mockResolvedValue({
      items: [{ id: "widget-1", name: "Widget one", unsortable_field: "x" }],
      total: 1,
      page: 1,
      page_size: 25,
    });

    renderPage();

    await waitFor(() => expect(mockListEntities).toHaveBeenCalled());
    expect(lastSortParam()).toBeUndefined();
  });

  it("clicking a sortable column header once sorts ascending", async () => {
    mockApiFetch.mockResolvedValue({ codes: [] });
    mockListEntities.mockResolvedValue({
      items: [{ id: "widget-1", name: "Widget one", unsortable_field: "x" }],
      total: 1,
      page: 1,
      page_size: 25,
    });

    renderPage();
    await waitFor(() => expect(mockListEntities).toHaveBeenCalled());

    fireEvent.click(await screen.findByTestId("entity-table-sort-name"));

    await waitFor(() => expect(lastSortParam()).toBe("name"));
  });

  it("clicking the same column a second time sorts descending", async () => {
    mockApiFetch.mockResolvedValue({ codes: [] });
    mockListEntities.mockResolvedValue({
      items: [{ id: "widget-1", name: "Widget one", unsortable_field: "x" }],
      total: 1,
      page: 1,
      page_size: 25,
    });

    renderPage();
    await waitFor(() => expect(mockListEntities).toHaveBeenCalled());

    // A sort change is a new `queryKey`, so `EntityTable` briefly re-renders
    // with no data (`isLoading` true again, same as any queryKey-changing
    // field) — the header button is torn down and remounted fresh each
    // time, not the same DOM node click-to-click. Re-query it before every
    // click rather than reusing an earlier reference.
    fireEvent.click(await screen.findByTestId("entity-table-sort-name"));
    await waitFor(() => expect(lastSortParam()).toBe("name"));
    fireEvent.click(await screen.findByTestId("entity-table-sort-name"));
    await waitFor(() => expect(lastSortParam()).toBe("-name"));
  });

  it("clicking the same column a third time clears the sort", async () => {
    mockApiFetch.mockResolvedValue({ codes: [] });
    mockListEntities.mockResolvedValue({
      items: [{ id: "widget-1", name: "Widget one", unsortable_field: "x" }],
      total: 1,
      page: 1,
      page_size: 25,
    });

    renderPage();
    await waitFor(() => expect(mockListEntities).toHaveBeenCalled());

    fireEvent.click(await screen.findByTestId("entity-table-sort-name"));
    await waitFor(() => expect(lastSortParam()).toBe("name"));
    fireEvent.click(await screen.findByTestId("entity-table-sort-name"));
    await waitFor(() => expect(lastSortParam()).toBe("-name"));
    fireEvent.click(await screen.findByTestId("entity-table-sort-name"));
    await waitFor(() => expect(lastSortParam()).toBeUndefined());
  });

  it("a field.sortable === false column renders no sort control at all", async () => {
    mockApiFetch.mockResolvedValue({ codes: [] });
    mockListEntities.mockResolvedValue({
      items: [{ id: "widget-1", name: "Widget one", unsortable_field: "x" }],
      total: 1,
      page: 1,
      page_size: 25,
    });

    renderPage();
    await waitFor(() => expect(mockListEntities).toHaveBeenCalled());

    expect(await screen.findByRole("columnheader", { name: "Unsortable" })).toBeInTheDocument();
    expect(screen.queryByTestId("entity-table-sort-unsortable_field")).not.toBeInTheDocument();
  });
});
