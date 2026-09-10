import { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveEntityKey, toEntityConfig, useEntitySchema, useEntitySchemas } from "./useEntitySchema";
import { EntitySchemaResponse, getEntitySchema } from "../../lib/api/entitySchema";

/**
 * ADR-0053 (ADMIN-3): unit coverage for the fetch boundary that replaced the
 * deleted static `entityConfigByKey` lookup.
 *
 * Scope note: these tests deliberately mock `getEntitySchema` rather than the
 * HTTP layer beneath it. That is *not* an attempt to prove the frontend and
 * backend agree on the schema contract — a hand-typed mock structurally cannot
 * do that (`frontend/CLAUDE.md`'s own note on mocks staying green through a
 * real contract change), and the claim is instead pinned where it can actually
 * be proven: `backend/tests/integration/test_adr53_entity_schema.py` against
 * the live route, and TC-ADMIN-034's e2e spec against a real browser. What is
 * genuinely unit-testable here, and is what this file covers, is the hook's own
 * logic: which key gets requested, which entity is deliberately never requested
 * at all, and how a fetched response is assembled into the `EntityConfig` shape
 * every downstream component still consumes unchanged.
 */
vi.mock("../../lib/api/entitySchema", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api/entitySchema")>();
  return { ...actual, getEntitySchema: vi.fn() };
});

const mockGetEntitySchema = vi.mocked(getEntitySchema);

function schemaResponse(overrides: Partial<EntitySchemaResponse> = {}): EntitySchemaResponse {
  return {
    resource: "requirement",
    label: "Requirements",
    methods: ["list", "get", "create", "update", "delete"],
    scopeField: "project_id",
    scopeSelector: null,
    scopeResolution: null,
    searchFields: ["title", "description"],
    filterFields: ["external_ref"],
    fields: [
      {
        name: "project_id",
        label: "Project",
        type: "fk",
        required: true,
        showInTable: true,
        refEntity: "project",
        labelField: "name",
      },
      { name: "title", label: "Title", type: "string", required: true, showInTable: true },
    ],
    ...overrides,
  };
}

/**
 * One `QueryClient` per `renderHook` call, created *outside* the wrapper
 * component so a re-render doesn't silently discard the cache — the
 * dedupe/no-fetch assertions below depend on the cache surviving re-renders.
 */
function makeWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("resolveEntityKey", () => {
  it("passes a real plural route slug through unchanged", () => {
    expect(resolveEntityKey("requirements")).toBe("requirements");
    expect(resolveEntityKey("role-assignments")).toBe("role-assignments");
  });

  it("pluralizes a singular `refEntity` alias to its route slug", () => {
    // `FkAutocomplete` resolves an FK column's target from the schema's own
    // `refEntity`, which is singular; the route's `{resource}` param is plural.
    expect(resolveEntityKey("project")).toBe("projects");
    expect(resolveEntityKey("test-case")).toBe("test-cases");
  });

  it("does NOT pluralize a real key that happens not to end in 's'", () => {
    // The load-bearing negative: `entry-exit-criteria` is a real registry key.
    // Pluralizing first and checking membership second would request
    // `entry-exit-criterias` and 404. Membership is checked BEFORE pluralizing
    // precisely so this key survives.
    expect(resolveEntityKey("entry-exit-criteria")).toBe("entry-exit-criteria");
    expect(resolveEntityKey("entry-exit-criteria")).not.toBe("entry-exit-criterias");
  });

  it("returns an unrecognized key unchanged rather than inventing a plural", () => {
    // Neither `widget` nor `widgets` is a registry key. Returning the input
    // verbatim makes the resulting 404 name the key that was actually asked
    // for, instead of a silently mutated one.
    expect(resolveEntityKey("widget")).toBe("widget");
  });
});

describe("toEntityConfig", () => {
  it("assembles the fetched schema plus the frontend-static route wiring", () => {
    const config = toEntityConfig("requirements", schemaResponse());

    expect(config.resource).toBe("requirement");
    // `path` is derived (`pathFor`), not served — ADR-0053 keeps route wiring
    // frontend-static.
    expect(config.path).toBe("/requirements");
    expect(config.methods).toEqual(["list", "get", "create", "update", "delete"]);
    expect(config.scopeField).toBe("project_id");
    expect(config.searchFields).toEqual(["title", "description"]);
    expect(config.filterFields).toEqual(["external_ref"]);
    expect(config.fields).toHaveLength(2);
    expect(config.fields[0]).toMatchObject({
      name: "project_id",
      type: "fk",
      refEntity: "project",
      labelField: "name",
    });
  });

  it("omits a null scope key entirely rather than setting it to undefined", () => {
    const config = toEntityConfig("test-levels", schemaResponse({ scopeField: null }));

    // Downstream components branch on presence (`if (config.scopeSelector)`),
    // so a serialized `null` must become an absent key, not a defined-but-
    // undefined one — `Object.keys` would otherwise report a scope this
    // global-catalog entity does not have.
    expect("scopeField" in config).toBe(false);
    expect("scopeSelector" in config).toBe(false);
    expect("scopeResolution" in config).toBe(false);
  });

  it("carries a served scopeSelector / scopeResolution through when present", () => {
    const branching = toEntityConfig(
      "risk-items",
      schemaResponse({
        scopeField: ["requirement_id", "test_plan_id"],
        scopeSelector: [
          { refEntity: "requirement", paramName: "requirement_id", label: "By requirement" },
          { refEntity: "test-plan", paramName: "test_plan_id", label: "By test plan" },
        ],
      }),
    );
    expect(branching.scopeField).toEqual(["requirement_id", "test_plan_id"]);
    expect(Array.isArray(branching.scopeSelector)).toBe(true);

    const resolved = toEntityConfig(
      "projects",
      schemaResponse({
        scopeField: "org_id",
        scopeResolution: { fromRouteParam: "projectId", viaEntity: "project", viaField: "org_id" },
      }),
    );
    expect(resolved.scopeResolution).toEqual({
      fromRouteParam: "projectId",
      viaEntity: "project",
      viaField: "org_id",
    });
  });

  it("applies ROUTE_OVERRIDES for the one entity whose real routes are path-nested", () => {
    const config = toEntityConfig("releases", schemaResponse({ resource: "release" }));

    expect(config.listPath).toBe("/projects/:projectId/releases");
    expect(config.createPath).toBe("/projects/:projectId/releases");
  });
});

describe("useEntitySchema", () => {
  it("requests the resolved plural key and returns the assembled config plus the backend label", async () => {
    mockGetEntitySchema.mockResolvedValue(schemaResponse());
    const { result } = renderHook(() => useEntitySchema("requirements"), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(mockGetEntitySchema).toHaveBeenCalledWith("requirements");
    expect(result.current.config?.resource).toBe("requirement");
    expect(result.current.config?.path).toBe("/requirements");
    // The heading label is backend-served, not re-derived from the route slug.
    expect(result.current.label).toBe("Requirements");
    expect(result.current.isError).toBe(false);
  });

  it("fetches the plural slug even when handed a singular refEntity alias", async () => {
    mockGetEntitySchema.mockResolvedValue(schemaResponse({ resource: "project", label: "Projects" }));
    const { result } = renderHook(() => useEntitySchema("project"), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(mockGetEntitySchema).toHaveBeenCalledWith("projects");
  });

  it("reports the loading state the static import never had", () => {
    // ADR-0053's own accepted trade-off: every admin page now waits on a fetch
    // before it can render anything. `config` must be undefined meanwhile —
    // a page that rendered a half-config would render the wrong columns.
    mockGetEntitySchema.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useEntitySchema("requirements"), { wrapper: makeWrapper() });

    expect(result.current.isLoading).toBe(true);
    expect(result.current.config).toBeUndefined();
  });

  it("serves `releases` from the static config without ever fetching", async () => {
    const { result } = renderHook(() => useEntitySchema("releases"), { wrapper: makeWrapper() });

    // `Release` has no backend `CrudEntityConfig` to derive from (100% bespoke
    // routes), so `GET /entities/releases/schema` is a deliberate 404 — see
    // TC-ADMIN-033. Requesting it at all would be the bug.
    await waitFor(() => expect(result.current.config).toBeDefined());
    expect(mockGetEntitySchema).not.toHaveBeenCalled();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.config?.resource).toBe("release");
    expect(result.current.config?.listPath).toBe("/projects/:projectId/releases");
    // No fetch happened, so there is no backend-served label to report; the
    // caller falls back to the frontend-static `entityLabelByKey`.
    expect(result.current.label).toBeUndefined();
  });

  it("fetches nothing and reports no config for an undefined entity key", () => {
    const { result } = renderHook(() => useEntitySchema(undefined), { wrapper: makeWrapper() });

    expect(mockGetEntitySchema).not.toHaveBeenCalled();
    expect(result.current.config).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
  });

  it("surfaces a fetch failure as isError with no config", async () => {
    mockGetEntitySchema.mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useEntitySchema("requirements"), { wrapper: makeWrapper() });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.config).toBeUndefined();
  });
});

describe("useEntitySchemas", () => {
  it("resolves a batch of keys, deduping aliases of the same entity into one fetch", async () => {
    mockGetEntitySchema.mockImplementation(async (key: string) =>
      schemaResponse({ resource: key.replace(/s$/, ""), label: key }),
    );

    // `EntityTable` resolves one ref-entity config per FK column, and the
    // column list is data — so the single hook can't be called in a loop.
    // "project" and "projects" are the same entity by two names.
    const { result } = renderHook(() => useEntitySchemas(["project", "projects", "requirements"]), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(Object.keys(result.current)).toHaveLength(2));

    expect(mockGetEntitySchema).toHaveBeenCalledTimes(2);
    expect(mockGetEntitySchema).toHaveBeenCalledWith("projects");
    expect(mockGetEntitySchema).toHaveBeenCalledWith("requirements");
    expect(result.current.projects?.path).toBe("/projects");
    expect(result.current.requirements?.path).toBe("/requirements");
  });

  it("mixes the static `releases` config into a batch without fetching it", async () => {
    mockGetEntitySchema.mockResolvedValue(schemaResponse());

    const { result } = renderHook(() => useEntitySchemas(["releases", "requirements"]), {
      wrapper: makeWrapper(),
    });

    await waitFor(() => expect(Object.keys(result.current)).toHaveLength(2));

    expect(mockGetEntitySchema).toHaveBeenCalledTimes(1);
    expect(mockGetEntitySchema).toHaveBeenCalledWith("requirements");
    expect(result.current.releases?.resource).toBe("release");
  });
});
