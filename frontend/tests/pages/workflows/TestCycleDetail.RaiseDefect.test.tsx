/**
 * EXEC-3 (raise a Defect from a failed TestExecution, ADR-0041):
 * `TestCycleDetail`'s "Raise Defect" button — only on `fail`-result
 * execution-history rows — and its modal (`POST /executions/{id}/defects`).
 *
 * Same partial-`vi.mock` convention as the sibling `TestCycleDetail.
 * ExecutionLog.test.tsx` (EXEC-2): API *lib modules* are mocked, never
 * `fetch`. This file owns its own minimal fixture setup rather than sharing
 * state with the EXEC-1/EXEC-2 files, matching this repo's
 * one-file-per-story-feature-area convention (`frontend/CLAUDE.md`).
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TestCycleDetail from "../../../src/pages/workflows/TestCycleDetail";
import type { TestExecutionSummary } from "../../../src/lib/api/testExecutions";
import { listPlanTestCases } from "../../../src/lib/api/testPlans";
import type { TestCaseSummary } from "../../../src/lib/api/testCases";
import { getProject } from "../../../src/lib/api/projects";
import { listMembers } from "../../../src/lib/api/members";
import { getEntity, listEntities } from "../../../src/lib/api/entityCrud";
import type { EntityRow, ListEnvelope, ListQuery } from "../../../src/lib/api/entityCrud";
import { listTestExecutionLogs } from "../../../src/lib/api/testLogs";
import { createDefectForExecution } from "../../../src/lib/api/defects";
import { ApiError } from "../../../src/lib/api/client";
import type { EntityConfig } from "../../../src/entityConfigs/types";

vi.mock("../../../src/lib/api/entityCrud", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/lib/api/entityCrud")>();
  return { ...actual, listEntities: vi.fn(), getEntity: vi.fn() };
});

vi.mock("../../../src/lib/api/testPlans", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/lib/api/testPlans")>();
  return { ...actual, listPlanTestCases: vi.fn() };
});

vi.mock("../../../src/lib/api/projects", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/lib/api/projects")>();
  return { ...actual, getProject: vi.fn() };
});

vi.mock("../../../src/lib/api/members", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/lib/api/members")>();
  return { ...actual, listMembers: vi.fn() };
});

vi.mock("../../../src/lib/api/testLogs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/lib/api/testLogs")>();
  return { ...actual, listTestExecutionLogs: vi.fn(), addTestExecutionComment: vi.fn() };
});

vi.mock("../../../src/lib/api/defects", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/lib/api/defects")>();
  return { ...actual, createDefectForExecution: vi.fn() };
});

const mockListEntities = vi.mocked(listEntities);
const mockGetEntity = vi.mocked(getEntity);
const mockListPlanTestCases = vi.mocked(listPlanTestCases);
const mockGetProject = vi.mocked(getProject);
const mockListMembers = vi.mocked(listMembers);
const mockListTestExecutionLogs = vi.mocked(listTestExecutionLogs);
const mockCreateDefectForExecution = vi.mocked(createDefectForExecution);

const ORG_ID = "00000000-0000-0000-0000-0000000000aa";
const PROJECT_ID = "11111111-1111-1111-1111-111111111111";
const PLAN_ID = "22222222-2222-2222-2222-222222222222";
const CYCLE_ID = "55555555-5555-5555-5555-555555555555";
const RELEASE_ID = "66666666-6666-6666-6666-666666666666";
const ENV_ID = "77777777-7777-7777-7777-777777777777";
const ACTOR_ID = "99999999-9999-9999-9999-999999999999";
const FAIL_EXECUTION_ID = "e0000000-0000-0000-0000-00000000fa11";
const PASS_EXECUTION_ID = "e0000000-0000-0000-0000-000000005a55";
const TC_LOGIN = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

const EXECUTIONS_PATH = "/test-executions";

function listPathOf(config: EntityConfig): string {
  return config.listPath ?? config.path;
}

function envelope<T>(items: T[]): ListEnvelope<T> {
  return { items, total: items.length, page: 1, page_size: 25 };
}

function execution(overrides: Partial<TestExecutionSummary> = {}): TestExecutionSummary {
  return {
    id: FAIL_EXECUTION_ID,
    test_cycle_id: CYCLE_ID,
    test_case_id: TC_LOGIN,
    executed_by_actor_id: ACTOR_ID,
    result: "fail",
    actual_result: null,
    executed_at: "2026-09-08T09:14:00Z",
    ...overrides,
  };
}

let historyRows: TestExecutionSummary[];
let planTestCases: TestCaseSummary[];

function renderTestCycleDetail() {
  return render(
    <MemoryRouter
      initialEntries={[`/projects/${PROJECT_ID}/test-plans/${PLAN_ID}/test-cycles/${CYCLE_ID}`]}
    >
      <Routes>
        <Route
          path="/projects/:projectId/test-plans/:testPlanId/test-cycles/:testCycleId"
          element={<TestCycleDetail />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("TestCycleDetail — EXEC-3 Raise Defect", () => {
  beforeEach(() => {
    historyRows = [execution()];
    planTestCases = [
      {
        id: TC_LOGIN,
        test_condition_id: null,
        test_level_id: "d0000000-0000-0000-0000-000000000001",
        test_type_id: "d0000000-0000-0000-0000-000000000002",
        created_by_actor_id: ACTOR_ID,
        title: "Login flow",
        preconditions: null,
        expected_result: null,
        status: "approved",
      },
    ];

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
        case "/test-cases":
          return { id, title: "Login flow" } as EntityRow;
        default:
          return { id } as EntityRow;
      }
    });

    mockListEntities.mockImplementation(async (config, _routeParams, query) => {
      const path = listPathOf(config as EntityConfig);
      const listQuery = (query ?? {}) as ListQuery;
      if (path === EXECUTIONS_PATH) {
        const result = listQuery.params?.result;
        if (result) {
          return { items: [], total: 0, page: 1, page_size: 1 } as unknown as ListEnvelope<EntityRow>;
        }
        return {
          items: historyRows,
          total: historyRows.length,
          page: 1,
          page_size: 200,
        } as unknown as ListEnvelope<EntityRow>;
      }
      return envelope([]) as unknown as ListEnvelope<EntityRow>;
    });

    mockListTestExecutionLogs.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("shows 'Raise Defect' only on a fail-result row, not a pass-result row", async () => {
    historyRows = [execution({ result: "fail" }), execution({ id: PASS_EXECUTION_ID, result: "pass" })];

    renderTestCycleDetail();
    await screen.findByTestId("test-cycle-name");

    expect(await screen.findByTestId(`execution-${FAIL_EXECUTION_ID}-raise-defect`)).toBeInTheDocument();
    expect(screen.queryByTestId(`execution-${PASS_EXECUTION_ID}-raise-defect`)).not.toBeInTheDocument();
  });

  it("submits external_ref/severity/status and closes the modal on success", async () => {
    mockCreateDefectForExecution.mockResolvedValue({
      id: "d0000000-0000-0000-0000-000000000001",
      test_execution_id: FAIL_EXECUTION_ID,
      reported_by_actor_id: ACTOR_ID,
      external_ref: "JIRA-4821",
      severity: "high",
      status: "open",
    });

    renderTestCycleDetail();
    await screen.findByTestId("test-cycle-name");

    fireEvent.click(await screen.findByTestId(`execution-${FAIL_EXECUTION_ID}-raise-defect`));
    await screen.findByTestId("raise-defect-modal");

    fireEvent.change(screen.getByTestId("raise-defect-external-ref"), {
      target: { value: "JIRA-4821" },
    });
    fireEvent.change(screen.getByTestId("raise-defect-severity"), {
      target: { value: "high" },
    });
    fireEvent.click(screen.getByTestId("raise-defect-submit"));

    await waitFor(() =>
      expect(mockCreateDefectForExecution).toHaveBeenCalledWith(FAIL_EXECUTION_ID, {
        external_ref: "JIRA-4821",
        severity: "high",
        status: null,
      }),
    );
    await waitFor(() =>
      expect(screen.queryByTestId("raise-defect-modal")).not.toBeInTheDocument(),
    );
  });

  it("keeps the modal open with an inline error when the submit fails (e.g. 422 no-longer-fail race)", async () => {
    mockCreateDefectForExecution.mockRejectedValue(
      new ApiError("Defects can only be raised against a failed test execution.", 422, {
        code: "validation_error",
      }),
    );

    renderTestCycleDetail();
    await screen.findByTestId("test-cycle-name");

    fireEvent.click(await screen.findByTestId(`execution-${FAIL_EXECUTION_ID}-raise-defect`));
    await screen.findByTestId("raise-defect-modal");

    fireEvent.change(screen.getByTestId("raise-defect-severity"), { target: { value: "low" } });
    fireEvent.click(screen.getByTestId("raise-defect-submit"));

    expect(await screen.findByTestId("raise-defect-error")).toHaveTextContent(
      "Defects can only be raised against a failed test execution.",
    );
    expect(screen.getByTestId("raise-defect-modal")).toBeInTheDocument();
  });

  it("closing and reopening the modal resets the form", async () => {
    renderTestCycleDetail();
    await screen.findByTestId("test-cycle-name");

    fireEvent.click(await screen.findByTestId(`execution-${FAIL_EXECUTION_ID}-raise-defect`));
    await screen.findByTestId("raise-defect-modal");
    fireEvent.change(screen.getByTestId("raise-defect-external-ref"), {
      target: { value: "leftover text" },
    });
    fireEvent.click(screen.getByTestId("raise-defect-cancel"));
    await waitFor(() => expect(screen.queryByTestId("raise-defect-modal")).not.toBeInTheDocument());

    fireEvent.click(await screen.findByTestId(`execution-${FAIL_EXECUTION_ID}-raise-defect`));
    await screen.findByTestId("raise-defect-modal");
    expect(screen.getByTestId("raise-defect-external-ref")).toHaveValue("");
  });
});
