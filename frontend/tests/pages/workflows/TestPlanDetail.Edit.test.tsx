/**
 * PLAN-1 (ADR-0031): `TestPlanDetail`'s header card and its "Edit" modal —
 * the read-only field blocks, the status `CBadge`'s colour mapping, the modal
 * reusing the generic admin `TestPlan` field config, and (the story-critical
 * one, TC-PLAN-003's negative case) a `409 invalid_status_transition` rendering
 * as an inline `CAlert` *inside* the modal rather than a toast or a silent
 * revert (UI Design Document §2/§4).
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
  getTestPlan,
  listPlanTestCases,
  listPlanTestSuites,
  updateTestPlan,
} from "../../../src/lib/api/testPlans";
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
const mockUpdateTestPlan = vi.mocked(updateTestPlan);
const mockListPlanTestSuites = vi.mocked(listPlanTestSuites);
const mockListPlanTestCases = vi.mocked(listPlanTestCases);
const mockListTestSuites = vi.mocked(listTestSuites);

const PROJECT_ID = "11111111-1111-1111-1111-111111111111";
const PLAN_ID = "22222222-2222-2222-2222-222222222222";

function testPlan(overrides: Partial<TestPlanSummary> = {}): TestPlanSummary {
  return {
    id: PLAN_ID,
    project_id: PROJECT_ID,
    created_by_actor_id: "99999999-9999-9999-9999-999999999999",
    identifier: "TP-001",
    scope: "Authentication and authorization",
    approach: "Risk-based",
    staffing_and_training: "Two testers, one week of tooling ramp-up",
    schedule: "Sprint 12 to Sprint 14",
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

describe("TestPlanDetail — header card and Edit modal (PLAN-1)", () => {
  beforeEach(() => {
    mockGetTestPlan.mockResolvedValue(testPlan());
    mockListPlanTestSuites.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 25 });
    mockListPlanTestCases.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 25 });
    mockListTestSuites.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 25 });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // --- Header card -----------------------------------------------------------

  it("renders the identifier, status badge, and the four read-only text blocks", async () => {
    await renderAndSettle();

    expect(screen.getByTestId("test-plan-status")).toHaveTextContent("draft");
    const fields = screen.getByTestId("test-plan-fields");
    expect(fields).toHaveTextContent("Authentication and authorization");
    expect(fields).toHaveTextContent("Risk-based");
    expect(fields).toHaveTextContent("Two testers, one week of tooling ramp-up");
    expect(fields).toHaveTextContent("Sprint 12 to Sprint 14");
  });

  it("colour-codes the status badge per the design document (draft/approved/superseded)", async () => {
    await renderAndSettle();
    expect(screen.getByTestId("test-plan-status")).toHaveClass("bg-secondary");

    mockGetTestPlan.mockResolvedValue(testPlan({ status: "approved" }));
    renderTestPlanDetail();
    await waitFor(() =>
      expect(screen.getAllByTestId("test-plan-status")[1]).toHaveClass("bg-success"),
    );

    mockGetTestPlan.mockResolvedValue(testPlan({ status: "superseded" }));
    renderTestPlanDetail();
    await waitFor(() => expect(screen.getAllByTestId("test-plan-status")[2]).toHaveClass("bg-dark"));
  });

  // --- Edit modal: the generic admin field config, reused --------------------

  it("opens an Edit modal whose fields come from the generic admin TestPlan config", async () => {
    await renderAndSettle();
    fireEvent.click(screen.getByTestId("edit-test-plan-btn"));

    // Exactly the config's own writable fields (`entityConfigs/test-plan.ts`),
    // minus `project_id` — this route's fixed scope, which the backend's
    // `UpdateTestPlanRequest` doesn't accept either.
    expect(screen.getByLabelText("Identifier")).toHaveValue("TP-001");
    expect(screen.getByLabelText("Scope")).toHaveValue("Authentication and authorization");
    expect(screen.getByLabelText("Approach")).toHaveValue("Risk-based");
    expect(screen.getByLabelText("Staffing & training")).toBeInTheDocument();
    expect(screen.getByLabelText("Schedule")).toBeInTheDocument();
    expect(screen.getByLabelText("Status")).toHaveValue("draft");
    expect(screen.queryByLabelText("Project")).not.toBeInTheDocument();
  });

  it("PATCHes the edited fields and re-fetches the plan on success", async () => {
    mockUpdateTestPlan.mockResolvedValue(testPlan({ scope: "Authentication only" }));
    await renderAndSettle();
    await waitFor(() => expect(mockGetTestPlan).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByTestId("edit-test-plan-btn"));

    fireEvent.change(screen.getByLabelText("Scope"), { target: { value: "Authentication only" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(mockUpdateTestPlan).toHaveBeenCalledWith(
        PLAN_ID,
        expect.objectContaining({ identifier: "TP-001", scope: "Authentication only" }),
      ),
    );
    // An unchanged status is omitted: ADR-0031's guard rejects a same-value
    // write as an illegal (idempotent) transition, so re-sending it would turn
    // a plain text edit into a spurious 409.
    expect(mockUpdateTestPlan.mock.calls[0][1]).not.toHaveProperty("status");
    await waitFor(() => expect(mockGetTestPlan).toHaveBeenCalledTimes(2));
  });

  it("sends a changed status through the same PATCH route", async () => {
    mockUpdateTestPlan.mockResolvedValue(testPlan({ status: "approved" }));
    await renderAndSettle();
    fireEvent.click(screen.getByTestId("edit-test-plan-btn"));

    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "approved" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(mockUpdateTestPlan).toHaveBeenCalledWith(
        PLAN_ID,
        expect.objectContaining({ status: "approved" }),
      ),
    );
  });

  // --- §4: the transition guard's own surfacing ------------------------------

  it("renders a 409 invalid_status_transition as an inline alert inside the modal, leaving it open", async () => {
    const { ApiError } = await import("../../../src/lib/api/client");
    mockUpdateTestPlan.mockRejectedValue(
      new ApiError("A draft test plan cannot be moved directly to superseded.", 409, {
        code: "invalid_status_transition",
      }),
    );
    await renderAndSettle();
    fireEvent.click(screen.getByTestId("edit-test-plan-btn"));

    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "superseded" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(mockUpdateTestPlan).toHaveBeenCalledWith(
        PLAN_ID,
        expect.objectContaining({ status: "superseded" }),
      ),
    );

    // Inline, inside the still-open modal — not a toast, not a silent revert.
    const modal = screen.getByTestId("edit-test-plan-modal");
    await waitFor(() =>
      expect(modal).toHaveTextContent("A draft test plan cannot be moved directly to superseded."),
    );
    expect(screen.getByLabelText("Status")).toBeInTheDocument();
    // The rejected write changed nothing, so the plan is not re-fetched.
    expect(mockGetTestPlan).toHaveBeenCalledTimes(1);
  });

  it("maps a 422 field_errors response onto the matching field inside the modal", async () => {
    const { ApiError } = await import("../../../src/lib/api/client");
    mockUpdateTestPlan.mockRejectedValue(
      new ApiError("Request failed validation.", 422, {
        field_errors: { identifier: ["Identifier must be unique."] },
      }),
    );
    await renderAndSettle();
    fireEvent.click(screen.getByTestId("edit-test-plan-btn"));

    fireEvent.change(screen.getByLabelText("Identifier"), { target: { value: "TP-002" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Identifier must be unique.")).toBeInTheDocument();
  });

  it("renders a failed plan fetch as a page-level alert", async () => {
    const { ApiError } = await import("../../../src/lib/api/client");
    mockGetTestPlan.mockRejectedValue(new ApiError("Not found.", 404, { code: "not_found" }));
    renderTestPlanDetail();

    expect(await screen.findByTestId("test-plan-load-error")).toHaveTextContent("Not found.");
  });
});
