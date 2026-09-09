import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import EntityListPage from "./EntityListPage";
import attachment from "../../entityConfigs/attachment";
import { apiFetch } from "../../lib/api/client";
import { getEntity, listEntities } from "../../lib/api/entityCrud";

/**
 * TC-ADMIN-019: "Attachment scope-selector resolves via TestCase" — once a
 * TestCase is picked, the resulting `GET /attachments` list call is scoped
 * with `?test_case_id=<id>`, matching the backend's `resolve_via_test_case`
 * chain (ADR-0022/ADR-0025).
 *
 * Uses the real `attachment` entityConfig (not a fixture stand-in) so the
 * config wiring under test is the actual shipped one. `ScopeSelector` itself
 * is mocked here rather than driven through its real `FkAutocomplete` child:
 * `test-case.ts`'s config has no `list` method (no `GET /test-cases` route
 * exists yet — see that file's own docstring), so `FkAutocomplete` always
 * renders disabled for this `refEntity` and a real user cannot actually pick
 * a TestCase through today's UI at all — a genuine, already-documented,
 * pre-existing gap (`ScopeSelector.tsx`'s own docstring), not something this
 * test can honestly claim to close end-to-end. What *is* real and this test
 * does prove: once a scope value is resolved (however it eventually gets
 * resolved), `EntityListPage`'s generic scope -> list-query wiring carries
 * `test_case_id` through correctly for this specific config, so the moment
 * `test-case.ts` gains a `list` route, the rest of this chain already works.
 */
vi.mock("./registry", async () => {
  const actual = await import("../../../src/entityConfigs/attachment");
  return {
    entityConfigByKey: {
      attachments: actual.default,
      projects: { resource: "project", path: "/projects", methods: ["list", "get"], fields: [] },
    },
  };
});

vi.mock("../../components/molecules/scope-selector", () => ({
  default: ({
    options,
    onResolved,
  }: {
    options: { paramName: string } | { paramName: string }[];
    onResolved: (field: string, value: string) => void;
  }) => {
    const option = Array.isArray(options) ? options[0] : options;
    return (
      <button onClick={() => onResolved(option.paramName, "test-case-1")}>Resolve TestCase scope (test)</button>
    );
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
const mockGetEntity = vi.mocked(getEntity);
const mockApiFetch = vi.mocked(apiFetch);

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/projects/proj-1/admin/attachments"]}>
        <Routes>
          <Route path="/projects/:projectId/admin/:entity" element={<EntityListPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("EntityListPage — Attachment scope-selector resolves via TestCase (TC-ADMIN-019)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("fires no list request until the scope is resolved, then scopes the list by test_case_id", async () => {
    mockGetEntity.mockResolvedValue({ id: "proj-1", org_id: "org-1" });
    mockApiFetch.mockResolvedValue({ codes: [] });
    mockListEntities.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 25 });

    renderPage();

    const resolveButton = await screen.findByRole("button", { name: /resolve testcase scope/i });
    expect(mockListEntities).not.toHaveBeenCalled();

    fireEvent.click(resolveButton);

    await waitFor(() => expect(mockListEntities).toHaveBeenCalled());
    expect(mockListEntities).toHaveBeenCalledWith(
      expect.objectContaining({ resource: attachment.resource }),
      expect.anything(),
      expect.objectContaining({ params: expect.objectContaining({ test_case_id: "test-case-1" }) }),
    );
  });
});
