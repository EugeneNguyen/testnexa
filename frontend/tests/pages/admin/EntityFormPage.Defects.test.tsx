/**
 * EXEC-3 (raise a Defect from a failed TestExecution, ADR-0044):
 * `EntityFormPage`'s new read-only "Defects" section, rendered only when
 * `entityKey === "test-cases"` — `GET /test-cases/{id}/defects`, most recent
 * first exactly as the route returns it, no client-side re-sort.
 *
 * Same fixture-config-via-mocked-registry convention as
 * `EntityListPage.test.tsx` — the section's own gate (`entityKey ===
 * "test-cases"`) fires off the URL's `:entity` param directly, not off the
 * config's own content, so a minimal fixture config (no FK fields, avoiding
 * `FkAutocomplete` entirely) is enough to exercise it.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import EntityFormPage from "../../../src/pages/admin/EntityFormPage";
import { getEntity } from "../../../src/lib/api/entityCrud";
import { listDefectsForTestCase } from "../../../src/lib/api/defects";
import { ApiError } from "../../../src/lib/api/client";

vi.mock("../../../src/pages/admin/registry", () => ({
  entityConfigByKey: {
    "test-cases": {
      resource: "test_case",
      path: "/test-cases",
      methods: ["get", "update", "delete"],
      fields: [{ name: "title", label: "Title", type: "string", required: true }],
    },
    projects: {
      resource: "project",
      path: "/projects",
      methods: ["get", "update"],
      fields: [{ name: "name", label: "Name", type: "string", required: true }],
    },
  },
}));

vi.mock("../../../src/lib/api/entityCrud", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/lib/api/entityCrud")>();
  return { ...actual, getEntity: vi.fn(), updateEntity: vi.fn().mockResolvedValue({}) };
});

vi.mock("../../../src/lib/api/defects", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/lib/api/defects")>();
  return { ...actual, listDefectsForTestCase: vi.fn() };
});

const mockGetEntity = vi.mocked(getEntity);
const mockListDefectsForTestCase = vi.mocked(listDefectsForTestCase);

const PROJECT_ID = "11111111-1111-1111-1111-111111111111";
const TEST_CASE_ID = "22222222-2222-2222-2222-222222222222";

function renderPage(entity: string, id: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/projects/${PROJECT_ID}/admin/${entity}/${id}/edit`]}>
        <Routes>
          <Route path="/projects/:projectId/admin/:entity/:id/edit" element={<EntityFormPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("EntityFormPage — EXEC-3 TestCase Defects section", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders the empty state when the test case has no defects", async () => {
    mockGetEntity.mockImplementation(async (config) => {
      if ((config as { path: string }).path === "/projects") {
        return { id: PROJECT_ID, org_id: "org-1" };
      }
      return { id: TEST_CASE_ID, title: "Login flow" };
    });
    mockListDefectsForTestCase.mockResolvedValue([]);

    renderPage("test-cases", TEST_CASE_ID);

    expect(await screen.findByTestId("test-case-defects-section")).toBeInTheDocument();
    expect(await screen.findByTestId("test-case-defects-empty")).toHaveTextContent(
      "No defects raised against this test case yet.",
    );
  });

  it("renders defects most-recent-first exactly as the route returns them, no client re-sort", async () => {
    mockGetEntity.mockImplementation(async (config) => {
      if ((config as { path: string }).path === "/projects") {
        return { id: PROJECT_ID, org_id: "org-1" };
      }
      return { id: TEST_CASE_ID, title: "Login flow" };
    });
    mockListDefectsForTestCase.mockResolvedValue([
      {
        id: "d-3",
        test_execution_id: "e-2",
        reported_by_actor_id: "actor-1",
        external_ref: "third",
        severity: "low",
        status: "open",
      },
      {
        id: "d-2",
        test_execution_id: "e-2",
        reported_by_actor_id: "actor-1",
        external_ref: "second",
        severity: "medium",
        status: "investigating",
      },
      {
        id: "d-1",
        test_execution_id: "e-1",
        reported_by_actor_id: "actor-1",
        external_ref: null,
        severity: "critical",
        status: "closed",
      },
    ]);

    renderPage("test-cases", TEST_CASE_ID);

    const list = await screen.findByTestId("test-case-defects-list");
    const items = list.querySelectorAll("li");
    expect(items).toHaveLength(3);
    // Rendered in the exact order the (mocked) API returned -- most-recent-first
    // is the server's own guarantee, not a client-side sort this test could
    // accidentally validate against itself.
    expect(items[0]).toHaveAttribute("data-testid", "test-case-defect-d-3");
    expect(items[1]).toHaveAttribute("data-testid", "test-case-defect-d-2");
    expect(items[2]).toHaveAttribute("data-testid", "test-case-defect-d-1");

    // A null external_ref never renders as a blank cell.
    expect(screen.getByTestId("test-case-defect-d-1-external-ref")).toHaveTextContent(
      "(no external ref)",
    );
    expect(screen.getByTestId("test-case-defect-d-3-severity")).toHaveTextContent("low");
    expect(screen.getByTestId("test-case-defect-d-2-status")).toHaveTextContent("investigating");
  });

  it("renders the fetch error inline without breaking the form above it", async () => {
    mockGetEntity.mockImplementation(async (config) => {
      if ((config as { path: string }).path === "/projects") {
        return { id: PROJECT_ID, org_id: "org-1" };
      }
      return { id: TEST_CASE_ID, title: "Login flow" };
    });
    mockListDefectsForTestCase.mockRejectedValue(
      new ApiError("You do not have permission to perform this action.", 403, {
        code: "permission_denied",
      }),
    );

    renderPage("test-cases", TEST_CASE_ID);

    expect(await screen.findByTestId("test-case-defects-error")).toBeInTheDocument();
    // The form itself still rendered above the section.
    expect(screen.getByLabelText("Title")).toBeInTheDocument();
  });

  it("does not fetch or render the section for a non-test-case entity", async () => {
    mockGetEntity.mockResolvedValue({ id: PROJECT_ID, org_id: "org-1", name: "Checkout" });

    renderPage("projects", PROJECT_ID);

    await screen.findByLabelText("Name");
    expect(mockListDefectsForTestCase).not.toHaveBeenCalled();
    expect(screen.queryByTestId("test-case-defects-section")).not.toBeInTheDocument();
  });
});
