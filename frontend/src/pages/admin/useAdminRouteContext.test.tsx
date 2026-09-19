import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAdminRouteContext } from "./useAdminRouteContext";
import { getEntitySchema, EntitySchemaResponse } from "../../lib/api/entitySchema";

/**
 * [ADR-0093](../../../docs/adr/0093-retire-test-conditions-standalone-admin-page.md):
 * a `:entity` that isn't a live `ADMIN_ENTITY_KEYS` member (a typo, or a
 * retired key like `test-conditions`) must never reach the schema fetch at
 * all. This is the gate's own unit coverage — TC-SHELL-041's frontend-
 * testable half. It deliberately mocks `getEntitySchema` (the HTTP
 * boundary), never `ADMIN_ENTITY_KEYS`/`useEntitySchema` themselves, so the
 * real registry membership check and the real hook wiring both run for
 * real — only the network call underneath is faked, same scope discipline
 * `useEntitySchema.test.tsx` already established for this file's own
 * dependency.
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
    searchFields: [],
    filterFields: [],
    fields: [],
    ...overrides,
  };
}

/** Renders `useAdminRouteContext()` at a real project-scoped `:entity` route and exposes its result via testids. */
function Probe() {
  const ctx = useAdminRouteContext();
  return (
    <div>
      <span data-testid="entity-key">{ctx.entityKey}</span>
      <span data-testid="config-present">{String(Boolean(ctx.config))}</span>
      <span data-testid="schema-loading">{String(ctx.schemaLoading)}</span>
      <span data-testid="label">{ctx.label ?? "(none)"}</span>
    </div>
  );
}

function renderAtEntity(entity: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/projects/proj-1/admin/${entity}`]}>
        <Routes>
          <Route path="/projects/:projectId/admin/:entity" element={<Probe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("useAdminRouteContext — ADR-0093 registry gate", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("TC-SHELL-041 (unit half): never fetches a schema for the retired `test-conditions` key, and reports it as unknown immediately", async () => {
    mockGetEntitySchema.mockResolvedValue(schemaResponse({ resource: "project", label: "Projects" }));

    renderAtEntity("test-conditions");

    // The "projects" fetch (for org-id resolution) still happens — only the
    // routed entity's own schema fetch is gated.
    await waitFor(() => expect(mockGetEntitySchema).toHaveBeenCalledWith("projects"));

    expect(mockGetEntitySchema).not.toHaveBeenCalledWith("test-conditions");
    expect(screen.getByTestId("config-present").textContent).toBe("false");
    // No loading flash either — the gate skips the fetch outright, it
    // doesn't just wait for a 404.
    expect(screen.getByTestId("schema-loading").textContent).toBe("false");
    expect(screen.getByTestId("label").textContent).toBe("(none)");
  });

  it("still fetches and resolves normally for a real, registry-known entity", async () => {
    mockGetEntitySchema.mockResolvedValue(schemaResponse());

    renderAtEntity("requirements");

    await waitFor(() => expect(screen.getByTestId("config-present").textContent).toBe("true"));

    expect(mockGetEntitySchema).toHaveBeenCalledWith("requirements");
    expect(screen.getByTestId("label").textContent).toBe("Requirements");
  });

  it("also gates a made-up/typo'd key the same way — the fix is general, not a special case for one entity", async () => {
    mockGetEntitySchema.mockResolvedValue(schemaResponse({ resource: "project", label: "Projects" }));

    renderAtEntity("totally-not-a-real-entity");

    await waitFor(() => expect(mockGetEntitySchema).toHaveBeenCalledWith("projects"));

    expect(mockGetEntitySchema).not.toHaveBeenCalledWith("totally-not-a-real-entity");
    expect(screen.getByTestId("config-present").textContent).toBe("false");
  });
});
