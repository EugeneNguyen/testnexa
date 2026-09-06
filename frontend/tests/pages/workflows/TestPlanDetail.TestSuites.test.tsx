/**
 * PLAN-1 (ADR-0031): `TestPlanDetail`'s "Test Suites" membership section —
 * the live included-suites list, the "Include Suite" modal, per-row "Remove",
 * both empty states, and the inline `422`/`409 already_included_in_plan`
 * surfacing (UI Design Document §2/§5).
 *
 * Same partial-`vi.mock` convention as `ProjectDetail.TestSuites.test.tsx`:
 * the API *lib modules* are mocked, never `fetch`.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TestPlanDetail from "../../../src/pages/workflows/TestPlanDetail";
import {
  addTestSuiteToPlan,
  getTestPlan,
  listPlanTestCases,
  listPlanTestSuites,
  removeTestSuiteFromPlan,
} from "../../../src/lib/api/testPlans";
import type { TestPlanSummary } from "../../../src/lib/api/testPlans";
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
const SUITE_B_ID = "44444444-4444-4444-4444-444444444444";

function testPlan(overrides: Partial<TestPlanSummary> = {}): TestPlanSummary {
  return {
    id: PLAN_ID,
    project_id: PROJECT_ID,
    created_by_actor_id: "99999999-9999-9999-9999-999999999999",
    identifier: "TP-001",
    scope: "Authentication and authorization",
    approach: "Risk-based",
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

describe("TestPlanDetail — TestSuite membership (PLAN-1)", () => {
  beforeEach(() => {
    mockGetTestPlan.mockResolvedValue(testPlan());
    mockListPlanTestSuites.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 25 });
    mockListPlanTestCases.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 25 });
    mockListTestSuites.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 25 });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // --- The live membership list ---------------------------------------------

  it("fetches the plan's included suites on mount", async () => {
    await renderAndSettle();
    await waitFor(() => expect(mockListPlanTestSuites).toHaveBeenCalledWith(PLAN_ID));
  });

  it("renders each included suite with its name and purpose badge", async () => {
    mockListPlanTestSuites.mockResolvedValue({
      items: [testSuite()],
      total: 1,
      page: 1,
      page_size: 25,
    });
    await renderAndSettle();

    const row = await screen.findByTestId(`included-suite-${SUITE_ID}`);
    expect(row).toHaveTextContent("Regression");
    expect(row).toHaveTextContent("regression");
  });

  it("shows the empty state, with the design document's exact wording, when no suites are included", async () => {
    await renderAndSettle();
    expect(await screen.findByText("No test suites included yet.")).toBeInTheDocument();
  });

  // --- "Include Suite" -------------------------------------------------------

  it("populates the Include Suite dropdown from the project's own suites", async () => {
    mockListTestSuites.mockResolvedValue({
      items: [testSuite(), testSuite({ id: SUITE_B_ID, name: "Smoke", purpose: "smoke" })],
      total: 2,
      page: 1,
      page_size: 25,
    });
    await renderAndSettle();
    await waitFor(() => expect(mockListTestSuites).toHaveBeenCalledWith(PROJECT_ID));

    fireEvent.click(screen.getByTestId("include-suite-btn"));

    const select = screen.getByTestId("include-suite-select");
    expect(select).not.toBeDisabled();
    expect(screen.getByRole("option", { name: "Regression" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Smoke" })).toBeInTheDocument();
  });

  it("renders the dropdown disabled, with the ordering-dependency placeholder, when the project has no suites", async () => {
    await renderAndSettle();
    fireEvent.click(screen.getByTestId("include-suite-btn"));

    expect(screen.getByTestId("include-suite-select")).toBeDisabled();
    expect(
      screen.getByRole("option", { name: "No suites yet — create one on the Test Suites page" }),
    ).toBeInTheDocument();
  });

  it("includes the selected suite and re-fetches the membership list (not an optimistic splice)", async () => {
    mockListTestSuites.mockResolvedValue({
      items: [testSuite()],
      total: 1,
      page: 1,
      page_size: 25,
    });
    mockListPlanTestSuites
      .mockResolvedValueOnce({ items: [], total: 0, page: 1, page_size: 25 })
      .mockResolvedValueOnce({ items: [testSuite()], total: 1, page: 1, page_size: 25 });
    mockAddTestSuiteToPlan.mockResolvedValue(undefined);
    await renderAndSettle();
    await waitFor(() => expect(mockListPlanTestSuites).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByTestId("include-suite-btn"));
    fireEvent.change(screen.getByTestId("include-suite-select"), { target: { value: SUITE_ID } });
    fireEvent.click(screen.getByTestId("include-suite-submit"));

    await waitFor(() => expect(mockAddTestSuiteToPlan).toHaveBeenCalledWith(PLAN_ID, SUITE_ID));
    await waitFor(() => expect(mockListPlanTestSuites).toHaveBeenCalledTimes(2));
    expect(await screen.findByTestId(`included-suite-${SUITE_ID}`)).toHaveTextContent("Regression");
  });

  it("surfaces a 409 already_included_in_plan as an inline dismissible alert under the section header", async () => {
    const { ApiError } = await import("../../../src/lib/api/client");
    mockListTestSuites.mockResolvedValue({
      items: [testSuite()],
      total: 1,
      page: 1,
      page_size: 25,
    });
    mockAddTestSuiteToPlan.mockRejectedValue(
      new ApiError("This test suite is already included in the plan.", 409, {
        code: "already_included_in_plan",
      }),
    );
    await renderAndSettle();

    fireEvent.click(screen.getByTestId("include-suite-btn"));
    fireEvent.change(screen.getByTestId("include-suite-select"), { target: { value: SUITE_ID } });
    fireEvent.click(screen.getByTestId("include-suite-submit"));

    const alert = await screen.findByTestId("membership-error");
    expect(alert).toHaveTextContent("This test suite is already included in the plan.");

    // Dismissible, per §2's inline-CAlert-not-toast call. Scoped to the alert:
    // the (now-closed) modals keep their own header close buttons in the DOM.
    fireEvent.click(within(alert).getByRole("button", { name: /close/i, hidden: true }));
    await waitFor(() => expect(screen.queryByTestId("membership-error")).not.toBeInTheDocument());
  });

  it("surfaces a 422 cross-project rejection the same inline way as the 409 case", async () => {
    const { ApiError } = await import("../../../src/lib/api/client");
    mockListTestSuites.mockResolvedValue({
      items: [testSuite()],
      total: 1,
      page: 1,
      page_size: 25,
    });
    mockAddTestSuiteToPlan.mockRejectedValue(
      new ApiError("This test suite belongs to a different project.", 422, {
        code: "validation_error",
      }),
    );
    await renderAndSettle();

    fireEvent.click(screen.getByTestId("include-suite-btn"));
    fireEvent.change(screen.getByTestId("include-suite-select"), { target: { value: SUITE_ID } });
    fireEvent.click(screen.getByTestId("include-suite-submit"));

    expect(await screen.findByTestId("membership-error")).toHaveTextContent(
      "This test suite belongs to a different project.",
    );
    // The failed include changed nothing server-side, so the list is not re-fetched.
    expect(mockListPlanTestSuites).toHaveBeenCalledTimes(1);
  });

  // --- "Remove" --------------------------------------------------------------

  it("removes a suite and re-fetches the membership list rather than splicing it locally", async () => {
    mockListPlanTestSuites
      .mockResolvedValueOnce({ items: [testSuite()], total: 1, page: 1, page_size: 25 })
      .mockResolvedValueOnce({ items: [], total: 0, page: 1, page_size: 25 });
    mockRemoveTestSuiteFromPlan.mockResolvedValue(undefined);
    await renderAndSettle();

    fireEvent.click(await screen.findByTestId(`remove-suite-${SUITE_ID}`));

    await waitFor(() => expect(mockRemoveTestSuiteFromPlan).toHaveBeenCalledWith(PLAN_ID, SUITE_ID));
    await waitFor(() => expect(mockListPlanTestSuites).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("No test suites included yet.")).toBeInTheDocument();
  });

  it("surfaces a failed remove inline and still re-fetches, so the suite stays visible", async () => {
    const { ApiError } = await import("../../../src/lib/api/client");
    mockListPlanTestSuites.mockResolvedValue({
      items: [testSuite()],
      total: 1,
      page: 1,
      page_size: 25,
    });
    mockRemoveTestSuiteFromPlan.mockRejectedValue(
      new ApiError("Test suite not found in this plan.", 404, { code: "not_found" }),
    );
    await renderAndSettle();

    fireEvent.click(await screen.findByTestId(`remove-suite-${SUITE_ID}`));

    expect(await screen.findByTestId("membership-error")).toHaveTextContent(
      "Test suite not found in this plan.",
    );
    await waitFor(() => expect(mockListPlanTestSuites).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId(`included-suite-${SUITE_ID}`)).toBeInTheDocument();
  });

  // --- §5: attempt-then-error, no permission-based hide/disable --------------

  it("renders Include/Remove/Edit unconditionally — no permission-based hide or disable", async () => {
    mockListPlanTestSuites.mockResolvedValue({
      items: [testSuite()],
      total: 1,
      page: 1,
      page_size: 25,
    });
    await renderAndSettle();

    expect(screen.getByTestId("include-suite-btn")).toBeEnabled();
    expect(await screen.findByTestId(`remove-suite-${SUITE_ID}`)).toBeEnabled();
    expect(screen.getByTestId("edit-test-plan-btn")).toBeEnabled();
  });
});
