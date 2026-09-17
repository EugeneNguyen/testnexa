import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import EntityListPage from "./EntityListPage";
import { apiFetch } from "../../../lib/api/client";
import { createEntity, createViaCompoundRoute, getEntity, listEntities } from "../../../lib/api/entityCrud";

/**
 * ADR-0086 — `child_compound_creates`' own parent-picker generalization,
 * the sibling `EntityListPage.childCompoundCreate.test.tsx` (ADR-0080)
 * couldn't exercise: there, the declaration's `farField` always equals the
 * standalone list's own `scope.field` (zero picker, the record being
 * listed already IS the parent). `TestCycle`'s new `project_id` arm
 * (ADR-0084) is the first live case where that's false — the bespoke
 * route needs a `test_plan_id`, which a project-scoped list doesn't carry
 * — so a parent must be picked first, mirroring
 * `EntityDetailPage.compoundCreate.test.tsx`'s own TC-ADMIN-125 picker
 * flow, adapted for a standalone list page (no `relation`, no `linkCreate`
 * second call — `links_automatically` is always `true` for the one live
 * case, ADR-0079's own `TestCycle` declaration).
 *
 * ADR-0087: the picker's own widget is now conditional on the declaration's
 * `parentSelect` flag (`FkSelect` when `true`, `FkAutocomplete` otherwise —
 * see `EntityListPage.tsx`'s `ParentPickerControl`). This mock's synthetic
 * `widget` parent deliberately leaves `parentSelect` unset (`false`), the
 * same posture the real `requirement`/`test-execution` parents take — a
 * generic example ref entity isn't a vetted bounded catalog, so this file's
 * own interactions stay `type` + click a dropdown row. See
 * `TestPlanDetail.TestCycles.test.tsx` for the sibling case where the real
 * parent (`test-plan`) *does* set the flag and the interaction is
 * `selectOptions`.
 */
vi.mock("../../../pages/admin/registry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../pages/admin/registry")>();
  return {
    ...actual,
    entityLabelByKey: { "sprockets-no-create": "Sprockets", widgets: "Widgets" },
    ADMIN_ENTITY_KEYS: new Set(["sprockets-no-create", "widgets"]),
  };
});

vi.mock("../../../pages/admin/useEntitySchema", () => {
  const configs: Record<string, unknown> = {
    "sprockets-no-create": {
      resource: "sprocket",
      path: "/sprockets",
      // No `create` — the whole point. Scoped by `project_id` directly
      // (`TestCycle`'s own real shape after ADR-0084), so `useEntityScope`
      // resolves it immediately from the route, zero `ScopeSelector` step.
      methods: ["list", "get", "update", "delete"],
      scopeField: "project_id",
      fields: [{ name: "name", label: "Name", type: "string", required: true }],
      childCompoundCreates: [
        {
          farField: "project_id",
          // Placeholder differs from `farField` — the parent-picker trigger.
          pathTemplate: "/widgets/{widget_id}/sprockets",
          permission: "sprocket.author",
          linksAutomatically: true,
          parentEntity: "widget",
          parentLabel: "Widget",
          parentLabelField: "title",
          parentFilters: {},
        },
      ],
    },
    widgets: {
      resource: "widget",
      path: "/widgets",
      methods: ["list", "get"],
      // Shape-B: scoped directly by `project_id`, so the picker's own scope
      // (`pickerScopeParams`) resolves from the route with no extra step.
      scopeField: "project_id",
      fields: [],
    },
    // `useAdminRouteContext`'s own org-id resolution hop on a project-scoped
    // route (`getEntity(projectConfig, projectId)`) needs this — same
    // precedent `EntityListPage.childCompoundCreate.test.tsx` already
    // establishes, easy to forget since nothing in this test's own
    // assertions ever names "project" directly.
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

function primeMocks() {
  mockApiFetch.mockResolvedValue({ codes: [{ code: "sprocket.author", project_id: null }] });
  mockGetEntity.mockResolvedValue({ id: "proj-1", org_id: "org-1" });
  mockListEntities.mockImplementation((config: unknown) => {
    if ((config as { path?: string }).path === "/widgets") {
      return Promise.resolve({
        items: [{ id: "widget-1", title: "First widget" }],
        total: 1,
        page: 1,
        page_size: 25,
      });
    }
    return Promise.resolve({ items: [], total: 0, page: 1, page_size: 25 });
  });
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

describe("EntityListPage child_compound_creates parent picker (ADR-0086)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("New renders immediately — project_id resolves from the route with no ScopeSelector step", async () => {
    primeMocks();
    renderPage();

    expect(await screen.findByRole("button", { name: "New" })).toBeInTheDocument();
  });

  it("opening New shows the parent picker, gates the form until a parent is chosen, and locks it once picked", async () => {
    const user = userEvent.setup();
    primeMocks();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "New" }));

    expect(document.getElementById("entity-list-compound-parent-picker")).not.toBeNull();
    expect(screen.queryByLabelText(/^name$/i)).not.toBeInTheDocument();

    await user.type(screen.getByLabelText("Widget", { exact: true }), "First");
    await waitFor(() =>
      expect(
        mockListEntities.mock.calls.some(([config]) => (config as { path?: string }).path === "/widgets"),
      ).toBe(true),
    );

    await user.click(await screen.findByText("First widget"));
    expect(await screen.findByLabelText(/^name$/i)).toBeInTheDocument();
  });

  it("submitting after picking a parent calls the compound route with the PICKED parent id, not scope.value", async () => {
    const user = userEvent.setup();
    primeMocks();
    renderPage();

    await user.click(await screen.findByRole("button", { name: "New" }));
    await user.type(screen.getByLabelText("Widget", { exact: true }), "First");
    await user.click(await screen.findByText("First widget"));

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
