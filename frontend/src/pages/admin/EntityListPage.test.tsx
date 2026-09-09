import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import EntityListPage from "./EntityListPage";
import { apiFetch } from "../../lib/api/client";
import { listEntities } from "../../lib/api/entityCrud";

/**
 * ADR-0025 / UI Design Document §5 (FR-ADMIN-2 AC4): "No `<resource>.create`
 * -> the 'New' button above `EntityTable` is absent, not disabled." Uses a
 * fixture global-catalog config (no `scopeField`, so no scope-selector step
 * to drive through first) — the permission-gating logic under test here is
 * `EntityListPage`'s own, shared across every entity, not entity-specific.
 */
vi.mock("./registry", () => ({
  entityConfigByKey: {
    widgets: {
      resource: "widget",
      path: "/widgets",
      methods: ["list", "get", "create"],
      fields: [{ name: "name", label: "Name", type: "string", required: true }],
    },
  },
}));

vi.mock("../../lib/api/entityCrud", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api/entityCrud")>();
  return { ...actual, listEntities: vi.fn(), getEntity: vi.fn(), createEntity: vi.fn(), deleteEntity: vi.fn() };
});

vi.mock("../../lib/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api/client")>();
  return { ...actual, apiFetch: vi.fn() };
});

const mockListEntities = vi.mocked(listEntities);
const mockApiFetch = vi.mocked(apiFetch);

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

describe("EntityListPage — permission-driven create button", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("does not render the New button at all when the actor lacks widget.create", async () => {
    mockApiFetch.mockResolvedValue({ codes: [] });
    mockListEntities.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 25 });

    renderPage();

    await waitFor(() => expect(mockApiFetch).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "New" })).not.toBeInTheDocument();
  });

  it("renders the New button when the actor holds widget.create org-wide", async () => {
    mockApiFetch.mockResolvedValue({ codes: [{ code: "widget.create", project_id: null }] });
    mockListEntities.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 25 });

    renderPage();

    expect(await screen.findByRole("button", { name: "New" })).toBeInTheDocument();
  });
});
