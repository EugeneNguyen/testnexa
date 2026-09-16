import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import EntityListPage from "./EntityListPage";
import { apiFetch } from "../../../lib/api/client";
import { createEntity, createViaCompoundRoute, getEntity, listEntities } from "../../../lib/api/entityCrud";

/**
 * ADR-0080 — the standalone `/admin/<entity>` list page (not a relation
 * tab) is a second host for ADR-0079's `child_compound_creates`. A CTO
 * follow-up ("http://.../admin/test-conditions should use the crud")
 * found the same underlying gap ADR-0079 closed for relation tabs still
 * open here: `TestCondition`'s own list page had no "New" button at all,
 * because `EntityListPage`'s `canCreate` only ever checked
 * `config.methods.includes("create")`.
 *
 * The fix needs no new picker UI: every entity that declares
 * `child_compound_creates` also declares a `scopeSelector` for the SAME
 * field (the generic list route requires it too, since these entities are
 * always scoped) — so by the time any row renders, `scope.field`/
 * `scope.value` already equal the declaration's own `farField`/picked id.
 *
 * Fixture mirrors `EntityListPage.scopeSelector.test.tsx`'s own shape (a
 * synthetic `sprockets-no-create` entity, `ScopeSelector` mocked to resolve
 * a fixed id) plus `EntityDetailPage.childCompoundCreate.test.tsx`'s own
 * not-a-plausible-convention permission code.
 */
vi.mock("../../../pages/admin/registry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../pages/admin/registry")>();
  return {
    ...actual,
    entityLabelByKey: { "sprockets-no-create": "Sprockets", projects: "Projects" },
    ADMIN_ENTITY_KEYS: new Set(["sprockets-no-create", "projects"]),
  };
});

vi.mock("../../../pages/admin/useEntitySchema", () => {
  const configs: Record<string, unknown> = {
    "sprockets-no-create": {
      resource: "sprocket",
      path: "/sprockets",
      // No `create` — the whole point, same as `TestCondition`'s real config.
      methods: ["list", "get", "update", "delete"],
      scopeField: "widget_id",
      scopeSelector: { refEntity: "widget", paramName: "widget_id" },
      fields: [
        { name: "widget_id", label: "Widget", type: "fk", refEntity: "widget", labelField: "title" },
        { name: "name", label: "Name", type: "string", required: true },
      ],
      childCompoundCreates: [
        {
          farField: "widget_id",
          pathTemplate: "/widgets/{widget_id}/sprockets",
          // Deliberately not `sprocket.create` — proves the gate reads the
          // declared code, not a conventionally-derived one.
          permission: "sprocket.author",
          linksAutomatically: true,
          parentEntity: null,
          parentLabel: null,
          parentLabelField: null,
          parentFilters: {},
        },
      ],
    },
    projects: { resource: "project", path: "/projects", methods: ["list", "get"], fields: [] },
  };
  const resolveEntityKey = (key: string) => (key.endsWith("s") || key.includes("-") ? key : `${key}s`);
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

vi.mock("../../../components/molecules/scope-selector", () => ({
  default: ({ onResolved }: { onResolved: (field: string, value: string) => void }) => (
    <button onClick={() => onResolved("widget_id", "widget-1")}>Resolve Widget scope (test)</button>
  ),
}));

vi.mock("../../../lib/api/entityCrud", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/api/entityCrud")>();
  return {
    ...actual,
    listEntities: vi.fn(),
    getEntity: vi.fn(),
    createEntity: vi.fn(),
    createViaCompoundRoute: vi.fn(),
    deleteEntity: vi.fn(),
  };
});

vi.mock("../../../lib/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/api/client")>();
  return { ...actual, apiFetch: vi.fn() };
});

const mockListEntities = vi.mocked(listEntities);
const mockGetEntity = vi.mocked(getEntity);
const mockCreateEntity = vi.mocked(createEntity);
const mockCreateViaCompoundRoute = vi.mocked(createViaCompoundRoute);
const mockApiFetch = vi.mocked(apiFetch);

function primeMocks(codes: string[]) {
  mockApiFetch.mockResolvedValue({ codes: codes.map((code) => ({ code, project_id: null })) });
  mockGetEntity.mockResolvedValue({ id: "proj-1", org_id: "org-1" });
  mockListEntities.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 25 });
  mockCreateViaCompoundRoute.mockResolvedValue({ id: "new-1" });
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/projects/proj-1/admin/sprockets-no-create"]}>
        <Routes>
          <Route path="/projects/:projectId/admin/:entity" element={<EntityListPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("EntityListPage standalone-list compound create (ADR-0080)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("no New button before the scope is resolved, and none via a plausible-but-undeclared permission", async () => {
    primeMocks(["sprocket.create"]);
    renderPage();

    const resolveButton = await screen.findByRole("button", { name: /resolve widget scope/i });
    expect(screen.queryByRole("button", { name: "New" })).not.toBeInTheDocument();

    fireEvent.click(resolveButton);
    await waitFor(() => expect(mockListEntities).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: "New" })).not.toBeInTheDocument();
  });

  it("New renders once the scope resolves, granted the declared permission", async () => {
    primeMocks(["sprocket.author"]);
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /resolve widget scope/i }));
    await waitFor(() => expect(mockListEntities).toHaveBeenCalled());

    expect(await screen.findByRole("button", { name: "New" })).toBeInTheDocument();
  });

  it("submitting New calls the bespoke compound route with the resolved scope value, not the generic create", async () => {
    primeMocks(["sprocket.author"]);
    const user = userEvent.setup();
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /resolve widget scope/i }));
    await waitFor(() => expect(mockListEntities).toHaveBeenCalled());

    await user.click(await screen.findByRole("button", { name: "New" }));
    await user.type(await screen.findByLabelText(/^name$/i), "New sprocket");
    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(mockCreateViaCompoundRoute).toHaveBeenCalledTimes(1));
    expect(mockCreateViaCompoundRoute).toHaveBeenCalledWith(
      expect.objectContaining({ pathTemplate: "/widgets/{widget_id}/sprockets" }),
      { widget_id: "widget-1" },
      expect.objectContaining({ name: "New sprocket" }),
    );
    expect(mockCreateEntity).not.toHaveBeenCalled();
  });
});
