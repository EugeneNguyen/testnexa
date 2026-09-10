/**
 * EXEC-1 (ADR-0034, UI Design Document
 * `docs/ui-design/2026-09-07-exec-1-test-execution-recording-ui-design.md`):
 * `TestCycleDetail` — the four-tile live dashboard (§3), the `executed_at`
 * descending execution history (§4), the "Record Result" modal's submit and
 * post-submit refetch (§5), and the plan-scoped `test_case_id` picker
 * (TC-EXEC-010).
 *
 * Same partial-`vi.mock` convention as the sibling
 * `TestPlanDetail.TestCycles.test.tsx`: the API *lib modules* are mocked, never
 * `fetch`. The one addition here is a partial mock of `lib/api/client` — not to
 * drive the component (nothing on this screen calls `apiFetch` directly), but so
 * `resolvedRequestUrl()` below can replay a recorded `listEntities` call through
 * the *real* helper and read the URL it actually builds. That is what makes the
 * TC-EXEC-010 scoping assertion about a genuinely interpolated
 * `/test-plans/<uuid>/test-cases` path rather than about the arguments alone —
 * `frontend/CLAUDE.md`'s `:paramName` gotcha is precisely a "the placeholder
 * silently stayed literal" bug, which arg-shape assertions cannot catch.
 *
 * Every `listEntities` assertion here is scoped by the config's own resolved
 * list path (`listPath ?? path`), never by call order — the same discipline
 * `TestPlanDetail.EntryExitCriteria.test.tsx` adopted after a shared, unscoped
 * `listEntities` mock shipped a bug. On this screen one shared mock serves three
 * genuinely different callers: the dashboard's four filtered count calls, the
 * history list's unfiltered call (same `/test-executions` path — separated by
 * the presence of `params.result`), and the picker's plan-scoped
 * `/test-plans/:testPlanId/test-cases` call.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TestCycleDetail from "./TestCycleDetail";
import { createTestExecution } from "../../lib/api/testExecutions";
import type {
  TestExecutionResultValue,
  TestExecutionSummary,
} from "../../lib/api/testExecutions";
import { listPlanTestCases } from "../../lib/api/testPlans";
import type { TestCaseSummary } from "../../lib/api/testCases";
import { getProject } from "../../lib/api/projects";
import { listMembers } from "../../lib/api/members";
import { getEntity, listEntities } from "../../lib/api/entityCrud";
import type { EntityRow, ListEnvelope, ListQuery } from "../../lib/api/entityCrud";
import { ApiError, apiFetch } from "../../lib/api/client";
import type { EntityConfig } from "../../entityConfigs/types";

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

vi.mock("../../lib/api/entityCrud", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api/entityCrud")>();
  return { ...actual, listEntities: vi.fn(), getEntity: vi.fn() };
});

vi.mock("../../lib/api/testExecutions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api/testExecutions")>();
  return { ...actual, createTestExecution: vi.fn() };
});

vi.mock("../../lib/api/testPlans", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api/testPlans")>();
  return { ...actual, listPlanTestCases: vi.fn() };
});

vi.mock("../../lib/api/projects", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api/projects")>();
  return { ...actual, getProject: vi.fn() };
});

vi.mock("../../lib/api/members", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api/members")>();
  return { ...actual, listMembers: vi.fn() };
});

// `ApiError` (which `TestCycleDetail` imports for its own error branch) stays
// the real class; only the transport is stubbed.
vi.mock("../../lib/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api/client")>();
  return { ...actual, apiFetch: vi.fn() };
});

const mockListEntities = vi.mocked(listEntities);
const mockGetEntity = vi.mocked(getEntity);
const mockCreateTestExecution = vi.mocked(createTestExecution);
const mockListPlanTestCases = vi.mocked(listPlanTestCases);
const mockGetProject = vi.mocked(getProject);
const mockListMembers = vi.mocked(listMembers);
const mockApiFetch = vi.mocked(apiFetch);

const ORG_ID = "00000000-0000-0000-0000-0000000000aa";
const PROJECT_ID = "11111111-1111-1111-1111-111111111111";
const PLAN_ID = "22222222-2222-2222-2222-222222222222";
const CYCLE_ID = "55555555-5555-5555-5555-555555555555";
const RELEASE_ID = "66666666-6666-6666-6666-666666666666";
const ENV_ID = "77777777-7777-7777-7777-777777777777";
const ACTOR_ID = "99999999-9999-9999-9999-999999999999";

const TC_LOGIN = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const TC_LOGOUT = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
/** In the same org/project, but NOT returned by the plan's coverage query. */
const TC_OUT_OF_PLAN = "cccccccc-cccc-cccc-cccc-cccccccccccc";

const EXECUTIONS_PATH = "/test-executions";
const PLAN_SCOPED_TEST_CASES_PATH = "/test-plans/:testPlanId/test-cases";
const UNSCOPED_TEST_CASES_PATH = "/test-cases";

/** The path `entityCrud.listEntities` would actually request for this config. */
function listPathOf(config: EntityConfig): string {
  return config.listPath ?? config.path;
}

function envelope<T>(items: T[]): ListEnvelope<T> {
  return { items, total: items.length, page: 1, page_size: 25 };
}

function execution(overrides: Partial<TestExecutionSummary> = {}): TestExecutionSummary {
  return {
    id: "e0000000-0000-0000-0000-000000000000",
    test_cycle_id: CYCLE_ID,
    test_case_id: TC_LOGIN,
    executed_by_actor_id: ACTOR_ID,
    result: "pass",
    actual_result: null,
    executed_at: "2026-09-07T14:02:00Z",
    ...overrides,
  };
}

function testCase(id: string, title: string): TestCaseSummary {
  return {
    id,
    test_condition_id: null,
    test_level_id: "d0000000-0000-0000-0000-000000000001",
    test_type_id: "d0000000-0000-0000-0000-000000000002",
    created_by_actor_id: ACTOR_ID,
    title,
    preconditions: null,
    expected_result: null,
    status: "approved",
  };
}

// --- Mutable fixtures the shared mocks read, so a test can re-point them
// mid-run (which is exactly what the "not a local counter" test needs). -------

/** The `total` each `&result=<value>&page_size=1` count call reports. */
let counts: Record<TestExecutionResultValue, number>;
/** What `GET /test-executions?test_cycle_id=` hands back, in API order. */
let historyRows: TestExecutionSummary[];
/** What `GET /test-plans/{id}/test-cases` (the picker + title lookup) returns. */
let planTestCases: TestCaseSummary[];

/** Only the dashboard's four filtered count calls. */
function countCalls() {
  return mockListEntities.mock.calls.filter(
    ([config, , query]) =>
      listPathOf(config as EntityConfig) === EXECUTIONS_PATH &&
      Boolean((query as ListQuery | undefined)?.params?.result),
  );
}

/** Only the history list's own unfiltered call. */
function historyCalls() {
  return mockListEntities.mock.calls.filter(
    ([config, , query]) =>
      listPathOf(config as EntityConfig) === EXECUTIONS_PATH &&
      !(query as ListQuery | undefined)?.params?.result,
  );
}

/** Only the "Record Result" picker's own search calls. */
function pickerCalls() {
  return mockListEntities.mock.calls.filter(
    ([config]) => listPathOf(config as EntityConfig) === PLAN_SCOPED_TEST_CASES_PATH,
  );
}

/**
 * Replay a recorded `listEntities` call through the **real** helper (with only
 * `apiFetch` stubbed) and return the URL it builds. Nothing here re-implements
 * `interpolate`/`buildQueryString` — the production code is what runs, so an
 * un-filled `:testPlanId` placeholder would show up verbatim in the result.
 */
async function resolvedRequestUrl(
  call: [EntityConfig, Record<string, string | undefined> | undefined, ListQuery | undefined],
): Promise<string> {
  const actual = await vi.importActual<typeof import("../../lib/api/entityCrud")>(
    "../../../src/lib/api/entityCrud",
  );
  mockApiFetch.mockResolvedValueOnce(envelope([]) as unknown as never);
  await actual.listEntities(call[0], call[1] ?? {}, call[2] ?? {});
  return String(mockApiFetch.mock.calls[mockApiFetch.mock.calls.length - 1][0]);
}

// ADR-0053: this screen's `FkAutocomplete` now resolves its ref-entity config
// through `useEntitySchema` (a `useQuery`) instead of a synchronous static
// import, so the tree needs a `QueryClientProvider` it never needed before.
// Same wrapper every admin-surface test already uses; `retry: false` keeps a
// failed fetch from stalling the test on react-query's own backoff.
function renderTestCycleDetail() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter
        initialEntries={[`/projects/${PROJECT_ID}/test-plans/${PLAN_ID}/test-cycles/${CYCLE_ID}`]}
      >
        <Routes>
          <Route
            path="/projects/:projectId/test-plans/:testPlanId/test-cycles/:testCycleId"
            element={<TestCycleDetail />}
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function renderAndSettle() {
  renderTestCycleDetail();
  expect(await screen.findByTestId("test-cycle-name")).toHaveTextContent("Cycle 1");
  // The header button is `disabled` until the cycle itself resolves.
  await waitFor(() => expect(screen.getByTestId("record-result-btn")).toBeEnabled());
  await waitFor(() => expect(countCalls().length).toBeGreaterThanOrEqual(4));
  await waitFor(() => expect(historyCalls().length).toBeGreaterThanOrEqual(1));
}

/**
 * Drive the `FkAutocomplete` the way a user does — type, wait out its 300ms
 * debounce, click the option — same helper shape as the sibling
 * `TestPlanDetail.TestCycles.test.tsx`. Not a shortcut past the widget: the id
 * it stores is exactly what the submit payload must carry.
 */
async function pickTestCase(term: string, optionLabel: string) {
  fireEvent.change(screen.getByLabelText("Test case"), { target: { value: term } });
  const option = await screen.findByRole("button", { name: optionLabel }, { timeout: 3000 });
  fireEvent.click(option);
  // Selecting re-runs the widget's own `getEntity` label lookup; wait for it so
  // the submit below runs against a settled field, not a mid-flight one.
  await waitFor(() => expect(screen.getByLabelText("Test case")).toHaveValue(optionLabel));
}

describe("TestCycleDetail — EXEC-1", () => {
  beforeEach(() => {
    counts = { pass: 12, fail: 3, blocked: 1, skipped: 0 };
    historyRows = [];
    planTestCases = [testCase(TC_LOGIN, "Login flow"), testCase(TC_LOGOUT, "Logout flow")];

    mockGetProject.mockResolvedValue({
      id: PROJECT_ID,
      org_id: ORG_ID,
      name: "Checkout",
      standards_profile: null,
    });
    mockListMembers.mockResolvedValue({
      items: [
        {
          membership_id: "m0000000-0000-0000-0000-000000000001",
          user_id: ACTOR_ID,
          email: "priya@example.com",
          status: "active",
          joined_at: "2026-01-01T00:00:00Z",
        },
      ],
      total: 1,
      page: 1,
      page_size: 200,
    });
    mockListPlanTestCases.mockImplementation(async () => envelope(planTestCases));

    mockGetEntity.mockImplementation(async (config, id) => {
      switch ((config as EntityConfig).path) {
        case "/test-cycles":
          return {
            id,
            test_plan_id: PLAN_ID,
            release_id: RELEASE_ID,
            environment_id: ENV_ID,
            name: "Cycle 1",
            start_date: "2026-09-01",
            end_date: "2026-09-30",
          } as EntityRow;
        case "/test-plans":
          return { id, identifier: "TP-001" } as EntityRow;
        case "/releases":
          return { id, version_label: "R-1.0" } as EntityRow;
        case "/environments":
          return { id, name: "Staging" } as EntityRow;
        case "/test-cases": {
          // The picker's selected-value label lookup.
          const match = planTestCases.find((row) => row.id === id);
          return { id, title: match ? match.title : String(id) } as EntityRow;
        }
        default:
          return { id } as EntityRow;
      }
    });

    mockListEntities.mockImplementation(async (config, _routeParams, query) => {
      const path = listPathOf(config as EntityConfig);
      const listQuery = (query ?? {}) as ListQuery;

      if (path === EXECUTIONS_PATH) {
        const result = listQuery.params?.result as TestExecutionResultValue | undefined;
        if (result) {
          // The dashboard reads `total` only — `items` is deliberately empty,
          // which is also what a real `page_size=1` count call looks like.
          return { items: [], total: counts[result], page: 1, page_size: 1 } as unknown as
            ListEnvelope<EntityRow>;
        }
        return {
          items: historyRows,
          total: historyRows.length,
          page: 1,
          page_size: 200,
        } as unknown as ListEnvelope<EntityRow>;
      }

      if (path === PLAN_SCOPED_TEST_CASES_PATH) {
        // Behave like the real route: `?q=` narrows the plan's own coverage
        // set. A TestCase outside `planTestCases` is unreachable by any term.
        const term = String(listQuery.q ?? "").toLowerCase();
        const matches = term
          ? planTestCases.filter((row) => row.title.toLowerCase().includes(term))
          : planTestCases;
        return envelope(matches) as unknown as ListEnvelope<EntityRow>;
      }

      return envelope([]) as unknown as ListEnvelope<EntityRow>;
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // --- §3: the dashboard ------------------------------------------------------

  it("renders each of the four tiles from its own independently-filtered count call", async () => {
    await renderAndSettle();

    // Four distinct totals, deliberately: a fixture where several values share
    // a count cannot distinguish "correctly filtered per value" from "the
    // `result` filter is ignored and every call returns the cycle's full
    // count" (Test Design §30's live-dashboard aggregation class).
    await waitFor(() =>
      expect(screen.getByTestId("dashboard-tile-pass-count").textContent).toBe("12"),
    );
    expect(screen.getByTestId("dashboard-tile-fail-count").textContent).toBe("3");
    expect(screen.getByTestId("dashboard-tile-blocked-count").textContent).toBe("1");
    // Zero renders as a literal `0` — never blank, never a hidden tile (§3).
    expect(screen.getByTestId("dashboard-tile-skipped-count").textContent).toBe("0");
    expect(screen.getByTestId("dashboard-tile-skipped")).toBeInTheDocument();

    // One call per result value, each carrying its own `result` filter.
    for (const result of ["pass", "fail", "blocked", "skipped"] as TestExecutionResultValue[]) {
      expect(mockListEntities).toHaveBeenCalledWith(
        expect.objectContaining({ path: EXECUTIONS_PATH }),
        {},
        { pageSize: 1, params: { test_cycle_id: CYCLE_ID, result } },
      );
    }
    expect(countCalls()).toHaveLength(4);
  });

  // --- §4: the execution history ---------------------------------------------

  it("renders the history ordered executed_at descending, whatever order the API returns", async () => {
    const oldest = execution({
      id: "e0000000-0000-0000-0000-00000000000a",
      executed_at: "2026-09-05T09:15:00Z",
      result: "pass",
    });
    const middle = execution({
      id: "e0000000-0000-0000-0000-00000000000b",
      executed_at: "2026-09-07T13:40:00Z",
      result: "fail",
      actual_result: "Timeout on submit.",
      test_case_id: TC_LOGOUT,
    });
    const newest = execution({
      id: "e0000000-0000-0000-0000-00000000000c",
      executed_at: "2026-09-07T14:02:00Z",
      result: "blocked",
    });
    // Deliberately neither ascending nor descending: an implementation that
    // simply reverses the API order would fail this as surely as one that
    // does not sort at all.
    historyRows = [middle, oldest, newest];

    await renderAndSettle();

    const list = await screen.findByTestId("execution-history-list");
    await waitFor(() => expect(within(list).getAllByRole("listitem")).toHaveLength(3));
    expect(
      within(list)
        .getAllByRole("listitem")
        .map((item) => item.getAttribute("data-testid")),
    ).toEqual([
      `execution-${newest.id}`,
      `execution-${middle.id}`,
      `execution-${oldest.id}`,
    ]);

    // Row content comes from the response too, not from a placeholder.
    expect(screen.getByTestId(`execution-${middle.id}-result`)).toHaveTextContent("fail");
    expect(screen.getByTestId(`execution-${middle.id}-notes`)).toHaveTextContent(
      "Timeout on submit.",
    );
    await waitFor(() =>
      expect(screen.getByTestId(`execution-${middle.id}-test-case`)).toHaveTextContent(
        "Logout flow",
      ),
    );
  });

  // --- §5: the Record Result modal -------------------------------------------

  it("submits POST /test-cycles/{id}/executions and refetches both the dashboard and the history", async () => {
    mockCreateTestExecution.mockResolvedValue(execution());
    await renderAndSettle();
    const countCallsBefore = countCalls().length;
    const historyCallsBefore = historyCalls().length;

    fireEvent.click(screen.getByTestId("record-result-btn"));
    await pickTestCase("Login", "Login flow");
    fireEvent.change(screen.getByTestId("record-result-select"), { target: { value: "fail" } });
    fireEvent.change(screen.getByTestId("record-actual-result"), {
      target: { value: "Timeout on submit." },
    });
    fireEvent.change(screen.getByTestId("record-executed-at"), {
      target: { value: "2026-09-07T14:02" },
    });
    fireEvent.click(screen.getByTestId("record-result-submit"));

    await waitFor(() => expect(mockCreateTestExecution).toHaveBeenCalledTimes(1));
    const [calledCycleId, payload] = mockCreateTestExecution.mock.calls[0];
    // The cycle id travels in the path segment, never the body.
    expect(calledCycleId).toBe(CYCLE_ID);
    expect(payload).toEqual({
      test_case_id: TC_LOGIN,
      result: "fail",
      actual_result: "Timeout on submit.",
      // `datetime-local` is zone-less local wall-clock; the wire value is UTC.
      executed_at: new Date("2026-09-07T14:02").toISOString(),
    });
    expect(payload.executed_at.endsWith("Z")).toBe(true);
    expect(payload).not.toHaveProperty("test_cycle_id");
    // Server-owned: there is no client-side way to record "as" another actor.
    expect(payload).not.toHaveProperty("executed_by_actor_id");

    // Both views re-read the server afterwards (§5's "refetch both").
    await waitFor(() => expect(countCalls().length).toBe(countCallsBefore + 4));
    await waitFor(() => expect(historyCalls().length).toBe(historyCallsBefore + 1));
    await waitFor(() => expect(screen.queryByTestId("record-result-modal")).toBeNull());
  });

  /**
   * Test Design §30's "frontend structural class": the tiles must derive from
   * the API response, not from a local counter. The re-mocked totals are chosen
   * so that none of them equals its own old value plus one (12 -> 40, 3 -> 9,
   * 1 -> 5, 0 -> 7) — a `setCounts(c => c + 1)` implementation would render
   * 13/4/2/1 here and fail every one of these assertions.
   */
  it("shows newly fetched totals after a record — never the old totals plus one", async () => {
    mockCreateTestExecution.mockResolvedValue(execution({ result: "pass" }));
    await renderAndSettle();
    await waitFor(() =>
      expect(screen.getByTestId("dashboard-tile-pass-count").textContent).toBe("12"),
    );
    const historyCallsBefore = historyCalls().length;

    fireEvent.click(screen.getByTestId("record-result-btn"));
    await pickTestCase("Login", "Login flow");
    fireEvent.change(screen.getByTestId("record-executed-at"), {
      target: { value: "2026-09-07T14:02" },
    });

    // Re-point every fixture the screen reads *before* submitting, so the
    // post-submit render can only match by having re-fetched.
    counts = { pass: 40, fail: 9, blocked: 5, skipped: 7 };
    const recorded = execution({
      id: "e0000000-0000-0000-0000-00000000000f",
      result: "pass",
      executed_at: "2026-09-07T14:02:00Z",
    });
    historyRows = [recorded];

    fireEvent.click(screen.getByTestId("record-result-submit"));

    await waitFor(() => expect(mockCreateTestExecution).toHaveBeenCalledTimes(1));

    await waitFor(() =>
      expect(screen.getByTestId("dashboard-tile-pass-count").textContent).toBe("40"),
    );
    expect(screen.getByTestId("dashboard-tile-fail-count").textContent).toBe("9");
    expect(screen.getByTestId("dashboard-tile-blocked-count").textContent).toBe("5");
    expect(screen.getByTestId("dashboard-tile-skipped-count").textContent).toBe("7");

    // Explicitly not old-plus-one, the shape a local increment would produce.
    expect(screen.getByTestId("dashboard-tile-pass-count").textContent).not.toBe("13");
    expect(screen.getByTestId("dashboard-tile-skipped-count").textContent).not.toBe("1");

    // The history is re-fetched too, never spliced locally.
    await waitFor(() => expect(historyCalls().length).toBe(historyCallsBefore + 1));
    expect(await screen.findByTestId(`execution-${recorded.id}`)).toBeInTheDocument();
  });

  // --- TC-EXEC-010: the picker is scoped to the plan's coverage query ---------

  it("lists picker options from GET /test-plans/{testPlanId}/test-cases, with the placeholder interpolated", async () => {
    await renderAndSettle();

    fireEvent.click(screen.getByTestId("record-result-btn"));
    fireEvent.change(screen.getByLabelText("Test case"), { target: { value: "Login" } });
    await waitFor(() => expect(pickerCalls().length).toBeGreaterThanOrEqual(1), { timeout: 3000 });

    const [config, routeParams, query] = pickerCalls()[0] as [
      EntityConfig,
      Record<string, string | undefined> | undefined,
      ListQuery | undefined,
    ];
    expect(config.listPath).toBe(PLAN_SCOPED_TEST_CASES_PATH);
    expect(routeParams).toEqual({ testPlanId: PLAN_ID });
    expect(query?.q).toBe("Login");

    // The real helper builds the real URL: the placeholder is gone, the plan's
    // own id is in the path (`frontend/CLAUDE.md`'s `:paramName` gotcha).
    const url = await resolvedRequestUrl([config, routeParams, query]);
    expect(url).toBe(`/api/v1/test-plans/${PLAN_ID}/test-cases?q=Login`);
    expect(url).not.toContain(":testPlanId");

    // ...and never the unscoped project-wide list (which has no route at all).
    expect(
      mockListEntities.mock.calls.filter(
        ([called]) => listPathOf(called as EntityConfig) === UNSCOPED_TEST_CASES_PATH,
      ),
    ).toHaveLength(0);
  });

  it("never offers a TestCase absent from the plan's coverage query as a selectable option", async () => {
    // Exists in the same project, but the plan's coverage query does not
    // return it — so no search term can surface it in the picker.
    const outOfPlan = testCase(TC_OUT_OF_PLAN, "Billing export");
    expect(planTestCases.map((row) => row.id)).not.toContain(outOfPlan.id);

    await renderAndSettle();
    fireEvent.click(screen.getByTestId("record-result-btn"));

    // Positive control first: an in-plan case *is* offered, so a null result
    // below means "filtered out", not "the widget never rendered options".
    await pickTestCase("Login", "Login flow");

    fireEvent.change(screen.getByLabelText("Test case"), { target: { value: "Billing" } });
    await waitFor(
      () => expect(pickerCalls().some(([, , query]) => (query as ListQuery)?.q === "Billing")).toBe(
        true,
      ),
      { timeout: 3000 },
    );
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: outOfPlan.title })).toBeNull(),
    );
    expect(screen.queryByText(outOfPlan.title)).toBeNull();
  });

  /**
   * UI Design Document §5: a `422` (out-of-scope `TestCase`) renders as a
   * dismissible `CAlert` **inside** the modal, and the modal stays open.
   *
   * The "stays open" half is the substantive claim, not decoration: closing on
   * failure would discard the user's typed `actual_result` and their chosen
   * `executed_at`, forcing a full retype to retry. So this asserts the typed
   * values are still present afterwards, not merely that some alert appeared —
   * a version that closed the modal and rendered a section-level alert would
   * satisfy an alert-only assertion just as well.
   *
   * The scoped picker is supposed to make this `422` structurally unreachable
   * from the UI, but the backend route stays the actual enforcement boundary
   * (NFR-10), so the branch is real and must be handled.
   */
  it("keeps the Record Result modal open on a 422 and shows the error inside it", async () => {
    const message = "This test case is not in scope for this test cycle's test plan.";
    mockCreateTestExecution.mockRejectedValue(
      new ApiError(message, 422, { code: "validation_error", message, field_errors: null }),
    );
    await renderAndSettle();
    const historyCallsBefore = historyCalls().length;

    fireEvent.click(screen.getByTestId("record-result-btn"));
    await pickTestCase("Login", "Login flow");
    fireEvent.change(screen.getByTestId("record-actual-result"), {
      target: { value: "Notes worth not losing." },
    });
    fireEvent.click(screen.getByTestId("record-result-submit"));

    await waitFor(() => expect(mockCreateTestExecution).toHaveBeenCalledTimes(1));

    // The alert renders, and renders *within* the still-open modal.
    const modal = await screen.findByTestId("record-result-modal");
    const alert = await screen.findByTestId("record-error");
    expect(within(modal).getByTestId("record-error")).toBe(alert);
    expect(alert).toHaveTextContent(/not in scope/i);

    // The user's work survived the failure — the whole point of staying open.
    expect(screen.getByTestId("record-actual-result")).toHaveValue("Notes worth not losing.");
    expect(screen.getByLabelText("Test case")).toHaveValue("Login flow");

    // A failed write must not be followed by a refetch: nothing changed
    // server-side, and a refetch here would imply the opposite.
    expect(historyCalls().length).toBe(historyCallsBefore);
  });
});
