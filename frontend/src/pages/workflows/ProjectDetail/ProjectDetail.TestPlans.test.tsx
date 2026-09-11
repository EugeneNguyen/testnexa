/**
 * PLAN-1 (ADR-0031, UI Design Document §1): the thin "Test Plans" section
 * added to `ProjectDetail` — the one section on that page whose rows *link
 * out* (to `/projects/:projectId/test-plans/:testPlanId`) instead of expanding
 * in place.
 *
 * Same partial-`vi.mock` convention as `ProjectDetail.TestSuites.test.tsx`:
 * the API *lib modules* are mocked, never `fetch`.
 */
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ProjectDetail from "./ProjectDetail";
import { listRequirements } from "../../../lib/api/requirements";
import { listReleases } from "../../../lib/api/releases";
import { listTestLevels, listTestTypes } from "../../../lib/api/taxonomy";
import { listTestSuites } from "../../../lib/api/testSuites";
import type { TestPlanSummary } from "../../../lib/api/testPlans";
import { listTestPlans } from "../../../lib/api/testPlans";

vi.mock("../../../lib/api/releases", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/api/releases")>();
  return { ...actual, listReleases: vi.fn() };
});

vi.mock("../../../lib/api/requirements", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/api/requirements")>();
  return { ...actual, listRequirements: vi.fn() };
});

vi.mock("../../../lib/api/taxonomy", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/api/taxonomy")>();
  return { ...actual, listTestLevels: vi.fn(), listTestTypes: vi.fn() };
});

vi.mock("../../../lib/api/testSuites", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/api/testSuites")>();
  return { ...actual, listTestSuites: vi.fn() };
});

vi.mock("../../../lib/api/testPlans", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/api/testPlans")>();
  return { ...actual, listTestPlans: vi.fn() };
});

const mockListReleases = vi.mocked(listReleases);
const mockListRequirements = vi.mocked(listRequirements);
const mockListTestLevels = vi.mocked(listTestLevels);
const mockListTestTypes = vi.mocked(listTestTypes);
const mockListTestSuites = vi.mocked(listTestSuites);
const mockListTestPlans = vi.mocked(listTestPlans);

const PROJECT_ID = "11111111-1111-1111-1111-111111111111";
const PLAN_ID = "22222222-2222-2222-2222-222222222222";

function testPlan(overrides: Partial<TestPlanSummary> = {}): TestPlanSummary {
  return {
    id: PLAN_ID,
    project_id: PROJECT_ID,
    created_by_actor_id: "99999999-9999-9999-9999-999999999999",
    identifier: "TP-001",
    scope: null,
    approach: null,
    staffing_and_training: null,
    schedule: null,
    status: "approved",
    ...overrides,
  };
}

function renderProjectDetail() {
  return render(
    <MemoryRouter initialEntries={[`/projects/${PROJECT_ID}`]}>
      <Routes>
        <Route path="/projects/:projectId" element={<ProjectDetail />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ProjectDetail — Test Plans section (PLAN-1)", () => {
  beforeEach(() => {
    mockListReleases.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 25 });
    mockListRequirements.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 25 });
    mockListTestLevels.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 25 });
    mockListTestTypes.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 25 });
    mockListTestSuites.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 25 });
    mockListTestPlans.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 25 });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("fetches the project's test plans on page load", async () => {
    renderProjectDetail();
    await waitFor(() => expect(mockListTestPlans).toHaveBeenCalledWith(PROJECT_ID));
  });

  it("shows an empty state when the project has no test plans", async () => {
    renderProjectDetail();
    expect(await screen.findByText("No test plans yet.")).toBeInTheDocument();
  });

  it("links each row to that plan's own detail route rather than expanding in place", async () => {
    mockListTestPlans.mockResolvedValue({ items: [testPlan()], total: 1, page: 1, page_size: 25 });
    renderProjectDetail();

    const link = await screen.findByRole("link", { name: "TP-001" });
    expect(link).toHaveAttribute("href", `/projects/${PROJECT_ID}/test-plans/${PLAN_ID}`);
    expect(screen.getByTestId(`test-plan-row-${PLAN_ID}`)).toHaveTextContent("approved");
  });
});
