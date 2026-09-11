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
import TestPlanDetail from "./TestPlanDetail";
import type { TestPlanSummary } from "../../../lib/api/testPlans";
import {
  getTestPlan,
  listPlanTestCases,
  listPlanTestSuites,
  updateTestPlan,
} from "../../../lib/api/testPlans";
import { listTestSuites } from "../../../lib/api/testSuites";
import { listEntities } from "../../../lib/api/entityCrud";

/**
 * ADR-0053: this screen's field shape — and every `FkAutocomplete`'s
 * ref-entity config — now arrives from `useEntitySchema`, a `useQuery` over
 * `GET /entities/{resource}/schema`, instead of a static `entityConfigs/*.ts`
 * import. The hook is mocked here rather than the transport stubbed, so these
 * pre-existing assertions keep exercising what they always did: the screen's
 * own behaviour, not how its config was obtained.
 *
 * **Each schema object is created once and cached by key.** `FkAutocomplete`
 * lists `refConfig` in an effect's dependency array, so returning a fresh
 * object literal per call re-runs that effect on every render and drowns the
 * component in re-renders (a wall of `act(...)` warnings, and a debounce timer
 * that never fires). The real hook returns a `useMemo`-stable config; a mock
 * has to honour that contract, not just the shape.
 */
const { entitySchemaFor } = vi.hoisted(() => {
  const FIELDS: Record<string, unknown[]> = {
    "test-plans": [{"name": "project_id", "label": "Project", "type": "fk", "refEntity": "project", "labelField": "name", "required": true}, {"name": "identifier", "label": "Identifier", "type": "string", "required": true}, {"name": "scope", "label": "Scope", "type": "string", "showInTable": false}, {"name": "approach", "label": "Approach", "type": "string", "showInTable": false}, {"name": "staffing_and_training", "label": "Staffing & training", "type": "string", "showInTable": false}, {"name": "schedule", "label": "Schedule", "type": "string", "showInTable": false}, {"name": "status", "label": "Status", "type": "enum", "values": ["draft", "approved", "superseded"], "required": true}],
    "entry-exit-criteria": [{"name": "test_plan_id", "label": "Test plan", "type": "fk", "refEntity": "test-plan", "labelField": "identifier", "required": true}, {"name": "type", "label": "Type", "type": "enum", "values": ["entry", "exit", "suspension", "resumption"], "required": true}, {"name": "condition_text", "label": "Condition", "type": "string", "required": true}],
    "test-cases": [{"name": "test_condition_id", "label": "Test condition", "type": "fk", "refEntity": "test-condition", "labelField": "description"}, {"name": "test_level_id", "label": "Test level", "type": "fk", "refEntity": "test-level", "labelField": "name"}, {"name": "test_type_id", "label": "Test type", "type": "fk", "refEntity": "test-type", "labelField": "name"}, {"name": "title", "label": "Title", "type": "string", "required": true}, {"name": "preconditions", "label": "Preconditions", "type": "string", "showInTable": false}, {"name": "expected_result", "label": "Expected result", "type": "string", "showInTable": false}, {"name": "status", "label": "Status", "type": "enum", "values": ["draft", "reviewed", "approved", "deprecated"], "required": true}],
    "test-cycles": [{"name": "test_plan_id", "label": "Test plan", "type": "fk", "refEntity": "test-plan", "labelField": "identifier", "readOnly": true}, {"name": "release_id", "label": "Release", "type": "fk", "refEntity": "release", "labelField": "version_label", "readOnly": true}, {"name": "environment_id", "label": "Environment", "type": "fk", "refEntity": "environment", "labelField": "name"}, {"name": "name", "label": "Name", "type": "string"}, {"name": "start_date", "label": "Start date", "type": "date"}, {"name": "end_date", "label": "End date", "type": "date"}],
    "environments": [{"name": "project_id", "label": "Project", "type": "fk", "refEntity": "project", "labelField": "name", "required": true}, {"name": "name", "label": "Name", "type": "string", "required": true}, {"name": "config_notes", "label": "Config notes", "type": "string"}],
    "releases": [{"name": "project_id", "label": "Project", "type": "fk", "refEntity": "project", "labelField": "name", "required": true, "readOnly": true}, {"name": "version_label", "label": "Version label", "type": "string", "required": true}, {"name": "target_date", "label": "Target date", "type": "date"}]
  };
  const cache: Record<string, unknown> = {};
  return {
    entitySchemaFor: (key: string) => {
      if (!cache[key]) {
        cache[key] = {
          resource: key.replace(/-/g, "_").replace(/s$/, ""),
          path: `/${key}`,
          methods: ["list", "get", "create", "update", "delete"],
          fields: FIELDS[key] ?? [],
        };
      }
      return cache[key];
    },
  };
});

vi.mock("../../admin/useEntitySchema", () => ({
  useEntitySchema: (key: string) => ({
    config: entitySchemaFor(key),
    label: undefined,
    isLoading: false,
    isError: false,
  }),
  useEntitySchemas: (keys: string[]) =>
    Object.fromEntries(keys.map((k) => [k, entitySchemaFor(k)])),
  resolveEntityKey: (key: string) => key,
}));

vi.mock("../../../lib/api/testPlans", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/api/testPlans")>();
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

vi.mock("../../../lib/api/testSuites", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/api/testSuites")>();
  return { ...actual, listTestSuites: vi.fn() };
});

// PLAN-2 (ADR-0032) added an `entityCrud` import to `TestPlanDetail` for its
// Entry/Exit Criteria section. Without this mock that section's mount-time
// list call would reach the real `apiFetch` in jsdom — mocked here (and given
// an empty-envelope default below) so this file keeps testing only its own
// section, exactly as it did before that section existed.
vi.mock("../../../lib/api/entityCrud", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/api/entityCrud")>();
  return {
    ...actual,
    listEntities: vi.fn(),
    createEntity: vi.fn(),
    updateEntity: vi.fn(),
    deleteEntity: vi.fn(),
  };
});

const mockGetTestPlan = vi.mocked(getTestPlan);
const mockUpdateTestPlan = vi.mocked(updateTestPlan);
const mockListPlanTestSuites = vi.mocked(listPlanTestSuites);
const mockListPlanTestCases = vi.mocked(listPlanTestCases);
const mockListTestSuites = vi.mocked(listTestSuites);
const mockListEntities = vi.mocked(listEntities);

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
    mockListEntities.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 25 });
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
    const { ApiError } = await import("../../../../src/lib/api/client");
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
    const { ApiError } = await import("../../../../src/lib/api/client");
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
    const { ApiError } = await import("../../../../src/lib/api/client");
    mockGetTestPlan.mockRejectedValue(new ApiError("Not found.", 404, { code: "not_found" }));
    renderTestPlanDetail();

    expect(await screen.findByTestId("test-plan-load-error")).toHaveTextContent("Not found.");
  });
});
