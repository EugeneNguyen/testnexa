import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import EntityListPage from "./EntityListPage";
import { apiFetch } from "../../../lib/api/client";

/**
 * ADR-0059: end-to-end proof (short of a real backend) that the generic
 * admin surface's "New" button for `projects`, reached via the org-scoped
 * route `/orgs/:orgId/admin/projects`, actually POSTs to the bespoke
 * `/orgs/{org_id}/projects` route — not the flat `/projects` a plain
 * org-scoped entity's create would otherwise use. `createEntity`/
 * `listEntities` (`lib/api/entityCrud`) are deliberately left un-mocked
 * here (unlike `EntityListPage.test.tsx`'s fixture) — the whole point is to
 * exercise the real `interpolate(config.createPath, routeParams)` call this
 * ADR added, only stubbing the actual network layer underneath it
 * (`apiFetch`).
 */
vi.mock("../../../pages/admin/registry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../pages/admin/registry")>();
  return {
    ...actual,
    entityLabelByKey: { projects: "Projects" },
    ADMIN_ENTITY_KEYS: new Set(["projects"]),
  };
});

vi.mock("../../../pages/admin/useEntitySchema", () => {
  const config = {
    resource: "project",
    path: "/projects",
    createPath: "/orgs/:orgId/projects",
    scopeField: "org_id",
    methods: ["list", "get", "create", "update", "delete"],
    fields: [
      { name: "org_id", label: "Organization", type: "fk", refEntity: "organization", labelField: "name", readOnly: true },
      { name: "name", label: "Name", type: "string", required: true },
      { name: "standards_profile", label: "Standards profile", type: "string" },
    ],
  };
  return {
    resolveEntityKey: (key: string) => key,
    useEntitySchema: () => ({ config, label: "Projects", isLoading: false, isError: false }),
    useEntitySchemas: () => ({ projects: config }),
  };
});

vi.mock("../../../lib/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/api/client")>();
  return { ...actual, apiFetch: vi.fn() };
});

const mockApiFetch = vi.mocked(apiFetch);

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/orgs/org-1/admin/projects"]}>
        <Routes>
          <Route path="/orgs/:orgId/admin/:entity" element={<EntityListPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/**
 * ADR-0060: the retired `ProjectsPage`'s replacement route
 * (`/orgs/:orgId/projects`, `App.tsx`) has no `:entity` segment at all —
 * `entityKeyOverride="projects"` is what makes `EntityListPage` resolve the
 * right entity there instead of an empty `entityKey`. Distinct from the
 * createPath-interpolation proof above: this proves the override mechanism
 * itself, on the actual route shape it's used for.
 */
function renderAtOverrideRoute() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/orgs/org-1/projects"]}>
        <Routes>
          <Route path="/orgs/:orgId/projects" element={<EntityListPage entityKeyOverride="projects" />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("EntityListPage — projects create route override (ADR-0059) + entityKeyOverride (ADR-0060)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("submits the create modal to the bespoke org-nested path, not the flat /projects one", async () => {
    // Routed by (path, method) rather than call order — the permissions
    // fetch, the list fetch, and the create POST don't have a single fixed
    // ordering worth pinning a test to.
    mockApiFetch.mockImplementation((path: string, init?: RequestInit) => {
      if (path.includes("/permissions/mine")) {
        return Promise.resolve({ codes: [{ code: "project.create", project_id: null }] });
      }
      if (init?.method === "POST") {
        return Promise.resolve({ id: "proj-new", org_id: "org-1", name: "New Project", standards_profile: null });
      }
      return Promise.resolve({ items: [], total: 0, page: 1, page_size: 25 });
    });

    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: "New" }));
    fireEvent.change(await screen.findByLabelText("Name"), { target: { value: "New Project" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(mockApiFetch).toHaveBeenCalledWith("/api/v1/orgs/org-1/projects", expect.anything()));

    const postCall = mockApiFetch.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "POST");
    expect(postCall?.[0]).toBe("/api/v1/orgs/org-1/projects");
    const body = JSON.parse((postCall?.[1] as RequestInit).body as string);
    expect(body).toMatchObject({ name: "New Project", org_id: "org-1" });
  });

  it("entityKeyOverride resolves the entity on a route with no :entity segment (ADR-0060)", async () => {
    mockApiFetch
      .mockResolvedValueOnce({ codes: [{ code: "project.create", project_id: null }] })
      .mockResolvedValue({
        items: [{ id: "proj-1", org_id: "org-1", name: "Existing Project", standards_profile: null }],
        total: 1,
        page: 1,
        page_size: 25,
      });

    renderAtOverrideRoute();

    // Not "Unknown admin entity" — proves entityKeyOverride, not the (here
    // absent) :entity route param, resolved the schema.
    expect(await screen.findByRole("heading", { name: "Projects" })).toBeInTheDocument();
    expect(await screen.findByText("Existing Project")).toBeInTheDocument();
  });
});
