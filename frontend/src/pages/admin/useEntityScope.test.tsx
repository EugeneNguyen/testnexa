import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useEntityScope } from "./useEntityScope";
import { getEntity } from "../../lib/api/entityCrud";
import type { EntityConfig } from "../../entityConfigs/types";

/**
 * ADR-0060 regression test: found live (not by any mock) when the retired
 * `ProjectsPage`'s replacement route rendered "No records found." forever —
 * `Project`'s config carries a `scopeResolution` (for its project-scoped
 * generic-admin route specifically) *and* a plain `scopeField: "org_id"`
 * (satisfiable directly on its org-scoped routes) at the same time. The old
 * branch order checked `scopeResolution` first — since `Project`'s config
 * always has one, it permanently won on every route, including routes whose
 * `routeParams` could never satisfy `scopeResolution.fromRouteParam`
 * (`:orgId`-only routes have no `:projectId` at all) — `scope.ready` stayed
 * `false` forever, silently, with no error anywhere.
 *
 * No existing test caught this: `EntityListPage.projectsCreate.test.tsx`'s
 * own hand-built "projects" fixture omitted `scopeResolution` entirely,
 * unlike the real backend-served schema for `Project`, which always
 * includes it (`derive_entity_schema` serves it unconditionally whenever
 * `config.scope_resolution is not None`, regardless of which frontend route
 * is asking). This file tests `useEntityScope` directly against that exact
 * real shape, not a simplified stand-in.
 */
vi.mock("../../lib/api/entityCrud", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api/entityCrud")>();
  return { ...actual, getEntity: vi.fn() };
});

vi.mock("./useEntitySchema", () => ({
  // `viaConfig` (the "project" entity's own config, used only to build the
  // `getEntity` call for the scopeResolution fetch) — a real-shaped stand-in
  // is enough; only `resource`/`path` matter to `getEntity`.
  useEntitySchema: (key?: string) =>
    key
      ? { config: { resource: "project", path: "/projects", methods: ["get"], fields: [] }, label: "Projects", isLoading: false, isError: false }
      : { config: undefined, label: undefined, isLoading: false, isError: false },
}));

const mockGetEntity = vi.mocked(getEntity);

/** The real shape `derive_entity_schema` serves for `Project` — both `scopeField` and `scopeResolution` set. */
const PROJECT_CONFIG: EntityConfig = {
  resource: "project",
  path: "/projects",
  scopeField: "org_id",
  scopeResolution: { fromRouteParam: "projectId", viaEntity: "project", viaField: "org_id" },
  methods: ["list", "get", "create", "update", "delete"],
  fields: [],
};

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

describe("useEntityScope — scopeField-vs-scopeResolution priority (ADR-0060)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("resolves immediately from routeParams.orgId, never fetching, when :orgId is already in the route", () => {
    const { result } = renderHook(() => useEntityScope(PROJECT_CONFIG, { orgId: "org-1" }), { wrapper });

    expect(result.current.scope).toEqual({ ready: true, field: "org_id", value: "org-1" });
    expect(mockGetEntity).not.toHaveBeenCalled();
  });

  it("falls back to the scopeResolution fetch when routeParams.orgId is absent but :projectId is present", async () => {
    mockGetEntity.mockResolvedValue({ org_id: "org-from-fetch" });

    const { result } = renderHook(() => useEntityScope(PROJECT_CONFIG, { projectId: "proj-1" }), { wrapper });

    expect(result.current.scope).toEqual({ ready: false });

    await waitFor(() =>
      expect(result.current.scope).toEqual({ ready: true, field: "org_id", value: "org-from-fetch" }),
    );
  });

  it("stays not-ready (never crashes) when neither :orgId nor :projectId is present", () => {
    const { result } = renderHook(() => useEntityScope(PROJECT_CONFIG, {}), { wrapper });

    expect(result.current.scope).toEqual({ ready: false });
    expect(mockGetEntity).not.toHaveBeenCalled();
  });
});
