/**
 * PLAN-1 (ADR-0031): `TestPlanDetail`'s "Covered Test Cases" section — the
 * read-only two-hop coverage query (`GET /test-plans/{id}/test-cases`), its
 * empty state, and the invalidation rule that is the whole point of the
 * section: an include *or* a remove in the "Test Suites" section above
 * re-fetches coverage too, so the derived view never silently drifts from the
 * membership that produces it (UI Design Document §2).
 *
 * Same partial-`vi.mock` convention as `ProjectDetail.TestSuites.test.tsx`:
 * the API *lib modules* are mocked, never `fetch`.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TestPlanDetail from "../../../src/pages/workflows/TestPlanDetail";
import type { TestPlanSummary } from "../../../src/lib/api/testPlans";
import {
  addTestSuiteToPlan,
  getTestPlan,
  listPlanTestCases,
  listPlanTestSuites,
  removeTestSuiteFromPlan,
} from "../../../src/lib/api/testPlans";
import type { TestCaseSummary } from "../../../src/lib/api/testCases";
import type { TestSuiteSummary } from "../../../src/lib/api/testSuites";
import { listTestSuites } from "../../../src/lib/api/testSuites";

vi.mock("../../../src/lib/api/testPlans", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/lib/api/testPlans")>();
  return {
    ...actual,
    getTestPlan: vi.fn(),
    updateTestPlan: vi.fn(),
    listPlanTestSuites: vi.fn(),
    listPlanTestCases: vi.fn(),
    addTestSuiteToPlan: vi.fn(),
    removeTestSuiteFromPlan: vi.fn(),
  };
});

vi.mock("../../../src/lib/api/testSuites", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/lib/api/testSuites")>();
  return { ...actual, listTestSuites: vi.fn() };
});

const mockGetTestPlan = vi.mocked(getTestPlan);
const mockListPlanTestSuites = vi.mocked(listPlanTestSuites);
const mockListPlanTestCases = vi.mocked(listPlanTestCases);
const mockAddTestSuiteToPlan = vi.mocked(addTestSuiteToPlan);
const mockRemoveTestSuiteFromPlan = vi.mocked(removeTestSuiteFromPlan);
const mockListTestSuites = vi.mocked(listTestSuites);

const PROJECT_ID = "11111111-1111-1111-1111-111111111111";
const PLAN_ID = "22222222-2222-2222-2222-222222222222";
const SUITE_ID = "33333333-3333-3333-3333-333333333333";
const CASE_ID = "55555555-5555-5555-5555-555555555555";

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
    status: "draft",
    ...overrides,
  };
}

function testSuite(overrides: Partial<TestSuiteSummary> = {}): TestSuiteSummary {
  return {
    id: SUITE_ID,
    project_id: PROJECT_ID,
    name: "Regression",
    purpose: "regression",
    ...overrides,
  };
}

function testCase(overrides: Partial<TestCaseSummary> = {}): TestCaseSummary {
  return {
    id: CASE_ID,
    test_condition_id: null,
    test_level_id: "66666666-6666-6666-6666-666666666666",
    test_type_id: "77777777-7777-7777-7777-777777777777",
    created_by_actor_id: "99999999-9999-9999-9999-999999999999",
    title: "Sixth attempt returns 429",
    preconditions: null,
    expected_result: null,
    status: "draft",
    ...overrides,
  };
}

function renderTestPlanDetail() {
  return render(
    <MemoryRouter initialEntries={[`/projects/${PROJECT_ID}/test-plans/${PLAN_ID}`]}>
      <Routes>
        <Route path="/projects/:projectId/test-plans/:testPlanId" element={<TestPlanDetail />} />
      </Routes>
    </MemoryRouter>,
  );
}

async function renderAndSettle() {
  renderTestPlanDetail();
  expect(await screen.findByText("TP-001")).toBeInTheDocument();
}

describe("TestPlanDetail — covered test cases (PLAN-1 AC2)", () => {
  beforeEach(() => {
    mockGetTestPlan.mockResolvedValue(testPlan());
    mockListPlanTestSuites.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 25 });
    mockListPlanTestCases.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 25 });
    mockListTestSuites.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 25 });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("fetches the coverage query on mount", async () => {
    await renderAndSettle();
    await waitFor(() => expect(mockListPlanTestCases).toHaveBeenCalledWith(PLAN_ID));
  });

  it("renders each covered test case with its title and status badge, and no per-row action", async () => {
    mockListPlanTestCases.mockResolvedValue({
      items: [testCase()],
      total: 1,
      page: 1,
      page_size: 25,
    });
    await renderAndSettle();

    const item = await screen.findByTestId(`covered-test-case-${CASE_ID}`);
    expect(item).toHaveTextContent("Sixth attempt returns 429");
    expect(item).toHaveTextContent("draft");
    // Derived view, not an editable one (§2) — no buttons on a coverage row.
    expect(item.querySelectorAll("button")).toHaveLength(0);
  });

  it("shows the empty state, with the design document's exact wording, when nothing is covered", async () => {
    await renderAndSettle();
    expect(await screen.findByText("No test cases covered yet")).toBeInTheDocument();
  });

  it("uses wording distinct from the Test Suites section's own empty state", async () => {
    await renderAndSettle();
    expect(await screen.findByText("No test suites included yet.")).toBeInTheDocument();
    expect(screen.getByText("No test cases covered yet")).toBeInTheDocument();
  });

  // --- The invalidation rule: both sections refresh together (§2) ------------

  it("re-fetches coverage after a suite is successfully included", async () => {
    mockListTestSuites.mockResolvedValue({
      items: [testSuite()],
      total: 1,
      page: 1,
      page_size: 25,
    });
    mockAddTestSuiteToPlan.mockResolvedValue(undefined);
    mockListPlanTestCases
      .mockResolvedValueOnce({ items: [], total: 0, page: 1, page_size: 25 })
      .mockResolvedValueOnce({ items: [testCase()], total: 1, page: 1, page_size: 25 });
    await renderAndSettle();
    await waitFor(() => expect(mockListPlanTestCases).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByTestId("include-suite-btn"));
    fireEvent.change(screen.getByTestId("include-suite-select"), { target: { value: SUITE_ID } });
    fireEvent.click(screen.getByTestId("include-suite-submit"));

    await waitFor(() => expect(mockAddTestSuiteToPlan).toHaveBeenCalledWith(PLAN_ID, SUITE_ID));
    // The literal "never silently drifts" assertion: the coverage call fires
    // again, it isn't left showing the pre-include result.
    await waitFor(() => expect(mockListPlanTestCases).toHaveBeenCalledTimes(2));
    expect(await screen.findByTestId(`covered-test-case-${CASE_ID}`)).toBeInTheDocument();
  });

  it("re-fetches coverage after a suite is successfully removed", async () => {
    mockListPlanTestSuites
      .mockResolvedValueOnce({ items: [testSuite()], total: 1, page: 1, page_size: 25 })
      .mockResolvedValueOnce({ items: [], total: 0, page: 1, page_size: 25 });
    mockListPlanTestCases
      .mockResolvedValueOnce({ items: [testCase()], total: 1, page: 1, page_size: 25 })
      .mockResolvedValueOnce({ items: [], total: 0, page: 1, page_size: 25 });
    mockRemoveTestSuiteFromPlan.mockResolvedValue(undefined);
    await renderAndSettle();
    await waitFor(() => expect(mockListPlanTestCases).toHaveBeenCalledTimes(1));
    expect(await screen.findByTestId(`covered-test-case-${CASE_ID}`)).toBeInTheDocument();

    fireEvent.click(await screen.findByTestId(`remove-suite-${SUITE_ID}`));

    await waitFor(() => expect(mockRemoveTestSuiteFromPlan).toHaveBeenCalledWith(PLAN_ID, SUITE_ID));
    await waitFor(() => expect(mockListPlanTestCases).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("No test cases covered yet")).toBeInTheDocument();
  });

  it("renders a failed coverage fetch as its own alert, leaving the membership section usable", async () => {
    const { ApiError } = await import("../../../src/lib/api/client");
    mockListPlanTestCases.mockRejectedValue(
      new ApiError("You do not have permission to perform this action.", 403, {
        code: "permission_denied",
      }),
    );
    await renderAndSettle();

    expect(await screen.findByTestId("coverage-error")).toHaveTextContent(
      "You do not have permission to perform this action.",
    );
    expect(screen.getByTestId("include-suite-btn")).toBeEnabled();
  });
});
