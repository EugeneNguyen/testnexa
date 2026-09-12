import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import EntityListPage from "./EntityListPage";
import { apiFetch } from "../../../lib/api/client";
import { listEntities } from "../../../lib/api/entityCrud";

/**
 * ADR-0025 / UI Design Document §5 (FR-ADMIN-2 AC4): "No `<resource>.create`
 * -> the 'New' button above `EntityTable` is absent, not disabled." Uses a
 * fixture global-catalog config (no `scopeField`, so no scope-selector step
 * to drive through first) — the permission-gating logic under test here is
 * `EntityListPage`'s own, shared across every entity, not entity-specific.
 *
 * **ADR-0053:** the fixture config is unchanged, but it is now injected by
 * mocking `./useEntitySchema` (the fetch hook every admin surface reads its
 * config from) rather than the deleted `entityConfigByKey` registry map. The
 * registry mock survives for `entityLabelByKey` only — that half stayed
 * frontend-static precisely so the nav/heading label never waits on a fetch.
 *
 * `schemaState` is `vi.hoisted` so a test can flip the hook into its loading
 * state; every existing test runs with `isLoading: false`, i.e. exactly the
 * synchronous config availability the old registry lookup had.
 */
const schemaState = vi.hoisted(() => ({ isLoading: false }));

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
      fields: [{ name: "name", label: "Name", type: "string", required: true }],
    },
  };
  const labels: Record<string, string> = { widgets: "Widgets" };
  const resolveEntityKey = (key: string) => (key.endsWith("s") ? key : `${key}s`);
  return {
    resolveEntityKey,
    useEntitySchema: (key?: string) => {
      const resolved = key ? resolveEntityKey(key) : undefined;
      return {
        config: schemaState.isLoading || !resolved ? undefined : configs[resolved],
        label: resolved ? labels[resolved] : undefined,
        isLoading: Boolean(resolved) && schemaState.isLoading,
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
  return { ...actual, listEntities: vi.fn(), getEntity: vi.fn(), createEntity: vi.fn(), deleteEntity: vi.fn() };
});

vi.mock("../../../lib/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/api/client")>();
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
    schemaState.isLoading = false;
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

  /**
   * ADR-0053: the config is fetched now, so `config === undefined` no longer
   * implies an unknown `:entity`. While the schema is in flight the page must
   * show a spinner, NOT the "Unknown admin entity" error it renders for a
   * genuinely unrecognised slug.
   */
  it("renders a spinner instead of the unknown-entity error while the schema is still loading", async () => {
    schemaState.isLoading = true;
    mockApiFetch.mockResolvedValue({ codes: [] });
    mockListEntities.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 25 });

    renderPage();

    expect(await screen.findByRole("status")).toBeInTheDocument();
    expect(screen.queryByText(/Unknown admin entity/)).not.toBeInTheDocument();
    expect(mockListEntities).not.toHaveBeenCalled();
  });
});
