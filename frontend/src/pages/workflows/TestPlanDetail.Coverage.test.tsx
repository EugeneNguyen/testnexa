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
import TestPlanDetail from "./TestPlanDetail";
import type { TestPlanSummary } from "../../lib/api/testPlans";
import {
  addTestSuiteToPlan,
  getTestPlan,
  listPlanTestCases,
  listPlanTestSuites,
  removeTestSuiteFromPlan,
} from "../../lib/api/testPlans";
import type { TestCaseSummary } from "../../lib/api/testCases";
import type { TestSuiteSummary } from "../../lib/api/testSuites";
import { listTestSuites } from "../../lib/api/testSuites";
import { listEntities } from "../../lib/api/entityCrud";

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

vi.mock("../admin/useEntitySchema", () => ({
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

vi.mock("../../lib/api/testPlans", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api/testPlans")>();
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

vi.mock("../../lib/api/testSuites", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api/testSuites")>();
  return { ...actual, listTestSuites: vi.fn() };
});

// PLAN-2 (ADR-0032) added an `entityCrud` import to `TestPlanDetail` for its
// Entry/Exit Criteria section. Without this mock that section's mount-time
// list call would reach the real `apiFetch` in jsdom — mocked here (and given
// an empty-envelope default below) so this file keeps testing only its own
// section, exactly as it did before that section existed.
vi.mock("../../lib/api/entityCrud", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api/entityCrud")>();
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
const mockAddTestSuiteToPlan = vi.mocked(addTestSuiteToPlan);
const mockRemoveTestSuiteFromPlan = vi.mocked(removeTestSuiteFromPlan);
const mockListTestSuites = vi.mocked(listTestSuites);
const mockListEntities = vi.mocked(listEntities);

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
    mockListEntities.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 25 });
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
