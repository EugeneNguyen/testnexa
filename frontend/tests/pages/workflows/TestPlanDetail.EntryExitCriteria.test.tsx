/**
 * PLAN-2 (ADR-0032, UI Design Document
 * `docs/ui-design/2026-09-06-plan-2-entry-exit-criteria-visibility-ui-design.md`
 * §1/§4): `TestPlanDetail`'s "Entry/Exit Criteria" section — the mount-time
 * list scoped to this plan, the four type badges, the exact empty state, full
 * CRUD through the generic `entityCrud` helpers, the re-fetch-not-splice rule
 * every write on this screen follows, and the inline `CAlert` a `403`/`409`
 * surfaces as.
 *
 * Same partial-`vi.mock` convention as `TestPlanDetail.TestSuites.test.tsx`:
 * the API *lib modules* are mocked, never `fetch`.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TestPlanDetail from "../../../src/pages/workflows/TestPlanDetail";
import { getTestPlan, listPlanTestCases, listPlanTestSuites } from "../../../src/lib/api/testPlans";
import type { TestPlanSummary } from "../../../src/lib/api/testPlans";
import { listTestSuites } from "../../../src/lib/api/testSuites";
import type { EntryExitCriteriaSummary } from "../../../src/lib/api/releases";
import {
  createEntity,
  deleteEntity,
  listEntities,
  updateEntity,
} from "../../../src/lib/api/entityCrud";

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

vi.mock("../../../src/lib/api/entityCrud", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/lib/api/entityCrud")>();
  return {
    ...actual,
    listEntities: vi.fn(),
    createEntity: vi.fn(),
    updateEntity: vi.fn(),
    deleteEntity: vi.fn(),
  };
});

const mockGetTestPlan = vi.mocked(getTestPlan);
const mockListPlanTestSuites = vi.mocked(listPlanTestSuites);
const mockListPlanTestCases = vi.mocked(listPlanTestCases);
const mockListTestSuites = vi.mocked(listTestSuites);
const mockListEntities = vi.mocked(listEntities);
const mockCreateEntity = vi.mocked(createEntity);
const mockUpdateEntity = vi.mocked(updateEntity);
const mockDeleteEntity = vi.mocked(deleteEntity);

const PROJECT_ID = "11111111-1111-1111-1111-111111111111";
const PLAN_ID = "22222222-2222-2222-2222-222222222222";
const ENTRY_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const EXIT_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const SUSPENSION_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const RESUMPTION_ID = "dddddddd-dddd-dddd-dddd-dddddddddddd";

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

function criteria(overrides: Partial<EntryExitCriteriaSummary> = {}): EntryExitCriteriaSummary {
  return {
    id: EXIT_ID,
    test_plan_id: PLAN_ID,
    type: "exit",
    condition_text: "All P1 defects closed",
    ...overrides,
  };
}

function envelope(items: EntryExitCriteriaSummary[]) {
  return { items, total: items.length, page: 1, page_size: 25 };
}

/**
 * `listEntities` is one shared mock across every `entityConfigs/*.ts` caller
 * on this page — as of PLAN-3 (ADR-0033) that's no longer just this section's
 * `criteriaConfig`: `TestPlanDetail`'s new "Test Cycles" section also calls it
 * (`testCycleConfig`, `environmentConfig`) on the same mount. Routing by the
 * config's own `path` (rather than relying on call *order*, the way a plain
 * `mockResolvedValueOnce` chain does) keeps this file's assertions scoped to
 * *this* section's own calls regardless of how many other sections' `mount`
 * effects also happen to call the same generic helper — the exact class of
 * cross-section drift `frontend/CLAUDE.md` now documents.
 */
const CRITERIA_PATH = "/entry-exit-criteria";

function mockCriteriaSequence(
  ...responses: Array<ReturnType<typeof envelope>>
) {
  let index = 0;
  mockListEntities.mockImplementation(async (config) => {
    if (config.path !== CRITERIA_PATH) {
      // Test Cycles' own `testCycleConfig`/`environmentConfig` fetches — this
      // file has nothing to say about them, so a fixed empty response keeps
      // that section quiet without affecting any assertion below.
      return envelope([]) as unknown as ReturnType<typeof envelope>;
    }
    const response = responses[Math.min(index, responses.length - 1)];
    index += 1;
    return response;
  });
}

function mockCriteriaRejection(error: unknown) {
  mockListEntities.mockImplementation(async (config) => {
    if (config.path !== CRITERIA_PATH) {
      return envelope([]) as unknown as ReturnType<typeof envelope>;
    }
    throw error;
  });
}

/** Only this section's own `listEntities` calls — see `mockCriteriaSequence` above. */
function criteriaCalls() {
  return mockListEntities.mock.calls.filter(([config]) => config.path === CRITERIA_PATH);
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

describe("TestPlanDetail — Entry/Exit Criteria (PLAN-2)", () => {
  beforeEach(() => {
    mockGetTestPlan.mockResolvedValue(testPlan());
    mockListPlanTestSuites.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 25 });
    mockListPlanTestCases.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 25 });
    mockListTestSuites.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 25 });
    mockCriteriaSequence(envelope([]));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // --- The list ---------------------------------------------------------------

  it("fetches the plan's criteria on mount, scoped by ?test_plan_id=", async () => {
    await renderAndSettle();

    await waitFor(() => expect(criteriaCalls()).toHaveLength(1));
    expect(mockListEntities).toHaveBeenCalledWith(
      expect.objectContaining({ path: "/entry-exit-criteria" }),
      {},
      { params: { test_plan_id: PLAN_ID } },
    );
  });

  it("filters test_plan_id out of the config it lists/creates with — the route already fixes it", async () => {
    await renderAndSettle();
    await waitFor(() => expect(criteriaCalls()).toHaveLength(1));

    const config = criteriaCalls()[0][0];
    expect(config.fields.map((field) => field.name)).toEqual(["type", "condition_text"]);
  });

  it("renders each row's condition text and its type as a badge", async () => {
    mockCriteriaSequence(envelope([criteria()]));
    await renderAndSettle();

    const row = await screen.findByTestId(`criteria-${EXIT_ID}`);
    expect(row).toHaveTextContent("exit");
    expect(row).toHaveTextContent("All P1 defects closed");
  });

  it("colours all four criteria types per §1's mapping", async () => {
    mockCriteriaSequence(
      envelope([
        criteria({ id: ENTRY_ID, type: "entry", condition_text: "Environment provisioned" }),
        criteria({ id: EXIT_ID, type: "exit", condition_text: "All P1 defects closed" }),
        criteria({ id: SUSPENSION_ID, type: "suspension", condition_text: "Build unavailable" }),
        criteria({ id: RESUMPTION_ID, type: "resumption", condition_text: "Build restored" }),
      ]),
    );
    await renderAndSettle();

    const expected: Array<[string, string, string]> = [
      [ENTRY_ID, "entry", "bg-info"],
      [EXIT_ID, "exit", "bg-success"],
      [SUSPENSION_ID, "suspension", "bg-warning"],
      [RESUMPTION_ID, "resumption", "bg-secondary"],
    ];
    for (const [id, type, badgeClass] of expected) {
      const row = await screen.findByTestId(`criteria-${id}`);
      const badge = within(row).getByText(type);
      expect(badge).toHaveClass(badgeClass);
    }
  });

  it("shows the empty state, with the design document's exact wording, when the plan has no criteria", async () => {
    await renderAndSettle();
    expect(await screen.findByText("No entry/exit criteria defined yet.")).toBeInTheDocument();
  });

  it("surfaces a failed list fetch as its own inline alert", async () => {
    const { ApiError } = await import("../../../src/lib/api/client");
    mockCriteriaRejection(
      new ApiError("You do not have permission to perform this action.", 403, {
        code: "permission_denied",
      }),
    );
    await renderAndSettle();

    expect(await screen.findByTestId("criteria-load-error")).toHaveTextContent(
      "You do not have permission to perform this action.",
    );
  });

  // --- "Add Criteria" ---------------------------------------------------------

  it("creates a criteria row with test_plan_id merged in, then re-fetches (not an optimistic splice)", async () => {
    mockCriteriaSequence(envelope([]), envelope([criteria()]));
    mockCreateEntity.mockResolvedValue(criteria() as unknown as Record<string, unknown>);
    await renderAndSettle();
    await waitFor(() => expect(criteriaCalls()).toHaveLength(1));

    fireEvent.click(screen.getByTestId("add-criteria-btn"));
    fireEvent.change(screen.getByLabelText("Type"), { target: { value: "exit" } });
    fireEvent.change(screen.getByLabelText("Condition"), {
      target: { value: "All P1 defects closed" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() =>
      expect(mockCreateEntity).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/entry-exit-criteria" }),
        {},
        { type: "exit", condition_text: "All P1 defects closed", test_plan_id: PLAN_ID },
      ),
    );
    await waitFor(() => expect(criteriaCalls()).toHaveLength(2));
    expect(await screen.findByTestId(`criteria-${EXIT_ID}`)).toHaveTextContent(
      "All P1 defects closed",
    );
  });

  it("never renders a test_plan_id input in the Add modal — the field is fixed by the route", async () => {
    await renderAndSettle();
    fireEvent.click(screen.getByTestId("add-criteria-btn"));

    expect(screen.getByLabelText("Type")).toBeInTheDocument();
    expect(screen.queryByLabelText("Test plan")).not.toBeInTheDocument();
  });

  // --- "Edit" -----------------------------------------------------------------

  it("edits a row through the same form, pre-filled, then re-fetches", async () => {
    mockCriteriaSequence(
      envelope([criteria()]),
      envelope([criteria({ condition_text: "All P1 and P2 defects closed" })]),
    );
    mockUpdateEntity.mockResolvedValue(criteria() as unknown as Record<string, unknown>);
    await renderAndSettle();

    fireEvent.click(await screen.findByTestId(`edit-criteria-${EXIT_ID}`));

    // Pre-filled from the row, not blank.
    expect(screen.getByLabelText("Condition")).toHaveValue("All P1 defects closed");
    expect(screen.getByLabelText("Type")).toHaveValue("exit");

    fireEvent.change(screen.getByLabelText("Condition"), {
      target: { value: "All P1 and P2 defects closed" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() =>
      expect(mockUpdateEntity).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/entry-exit-criteria" }),
        EXIT_ID,
        { type: "exit", condition_text: "All P1 and P2 defects closed" },
      ),
    );
    await waitFor(() => expect(criteriaCalls()).toHaveLength(2));
    expect(await screen.findByTestId(`criteria-${EXIT_ID}`)).toHaveTextContent(
      "All P1 and P2 defects closed",
    );
  });

  // --- "Delete" ---------------------------------------------------------------

  it("deletes a row with no confirmation modal, then re-fetches rather than splicing locally", async () => {
    mockCriteriaSequence(envelope([criteria()]), envelope([]));
    mockDeleteEntity.mockResolvedValue(undefined);
    await renderAndSettle();

    fireEvent.click(await screen.findByTestId(`delete-criteria-${EXIT_ID}`));

    await waitFor(() =>
      expect(mockDeleteEntity).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/entry-exit-criteria" }),
        EXIT_ID,
      ),
    );
    await waitFor(() => expect(criteriaCalls()).toHaveLength(2));
    expect(await screen.findByText("No entry/exit criteria defined yet.")).toBeInTheDocument();
  });

  // --- Error surfacing --------------------------------------------------------

  it("surfaces a 403 from a create as a dismissible alert under the section header", async () => {
    const { ApiError } = await import("../../../src/lib/api/client");
    mockCreateEntity.mockRejectedValue(
      new ApiError("You do not have permission to perform this action.", 403, {
        code: "permission_denied",
      }),
    );
    await renderAndSettle();

    fireEvent.click(screen.getByTestId("add-criteria-btn"));
    fireEvent.change(screen.getByLabelText("Type"), { target: { value: "entry" } });
    fireEvent.change(screen.getByLabelText("Condition"), {
      target: { value: "Environment provisioned" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));

    const alert = await screen.findByTestId("criteria-error");
    expect(alert).toHaveTextContent("You do not have permission to perform this action.");

    // Dismissible, per §1's inline-CAlert-not-toast call.
    fireEvent.click(within(alert).getByRole("button", { name: /close/i, hidden: true }));
    await waitFor(() => expect(screen.queryByTestId("criteria-error")).not.toBeInTheDocument());
  });

  it("keeps a 422's field_errors on their own field inside the modal", async () => {
    const { ApiError } = await import("../../../src/lib/api/client");
    mockCreateEntity.mockRejectedValue(
      new ApiError("Validation failed.", 422, {
        code: "validation_error",
        field_errors: { condition_text: "Condition must be under 500 characters." },
      }),
    );
    await renderAndSettle();

    fireEvent.click(screen.getByTestId("add-criteria-btn"));
    fireEvent.change(screen.getByLabelText("Type"), { target: { value: "entry" } });
    fireEvent.change(screen.getByLabelText("Condition"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));

    expect(
      await screen.findByText("Condition must be under 500 characters."),
    ).toBeInTheDocument();
    // The failed create changed nothing server-side, so the list is not re-fetched.
    expect(criteriaCalls()).toHaveLength(1);
  });

  it("surfaces a failed delete inline and still re-fetches, so the row stays visible", async () => {
    const { ApiError } = await import("../../../src/lib/api/client");
    mockCriteriaSequence(envelope([criteria()]));
    mockDeleteEntity.mockRejectedValue(
      new ApiError("Entry exit criteria not found.", 404, { code: "not_found" }),
    );
    await renderAndSettle();

    fireEvent.click(await screen.findByTestId(`delete-criteria-${EXIT_ID}`));

    expect(await screen.findByTestId("criteria-error")).toHaveTextContent(
      "Entry exit criteria not found.",
    );
    await waitFor(() => expect(criteriaCalls()).toHaveLength(2));
    expect(screen.getByTestId(`criteria-${EXIT_ID}`)).toBeInTheDocument();
  });

  // --- §1: attempt-then-error, no permission-based hide/disable ---------------

  it("renders Add/Edit/Delete unconditionally — no permission-based hide or disable", async () => {
    mockCriteriaSequence(envelope([criteria()]));
    await renderAndSettle();

    expect(screen.getByTestId("add-criteria-btn")).toBeEnabled();
    expect(await screen.findByTestId(`edit-criteria-${EXIT_ID}`)).toBeEnabled();
    expect(screen.getByTestId(`delete-criteria-${EXIT_ID}`)).toBeEnabled();
  });
});
