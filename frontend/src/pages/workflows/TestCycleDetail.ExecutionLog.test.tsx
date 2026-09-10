/**
 * EXEC-2 (append-only `TestLog`, this story's own ADR): `TestCycleDetail`'s
 * "History" button per execution row, the ordered-timeline modal (`GET
 * /executions/{id}/logs`, AC3), and the comment/attachment form (`POST
 * /executions/{id}/comments`, AC1's comment/attachment triggers).
 *
 * Same partial-`vi.mock` convention as the sibling `TestCycleDetail.test.tsx`
 * (EXEC-1): API *lib modules* are mocked, never `fetch`. This file owns its
 * own minimal fixture setup (project/members/plan-test-cases/entity lookups)
 * rather than sharing state with the EXEC-1 file, matching this repo's
 * one-file-per-story-feature-area convention (`frontend/CLAUDE.md`).
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TestCycleDetail from "./TestCycleDetail";
import type { TestExecutionSummary } from "../../lib/api/testExecutions";
import { listPlanTestCases } from "../../lib/api/testPlans";
import type { TestCaseSummary } from "../../lib/api/testCases";
import { getProject } from "../../lib/api/projects";
import { listMembers } from "../../lib/api/members";
import { getEntity, listEntities } from "../../lib/api/entityCrud";
import type { EntityRow, ListEnvelope, ListQuery } from "../../lib/api/entityCrud";
import { addTestExecutionComment, listTestExecutionLogs } from "../../lib/api/testLogs";
import type { TestLogSummary } from "../../lib/api/testLogs";
import { ApiError } from "../../lib/api/client";
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

vi.mock("../../lib/api/testLogs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api/testLogs")>();
  return { ...actual, listTestExecutionLogs: vi.fn(), addTestExecutionComment: vi.fn() };
});

const mockListEntities = vi.mocked(listEntities);
const mockGetEntity = vi.mocked(getEntity);
const mockListPlanTestCases = vi.mocked(listPlanTestCases);
const mockGetProject = vi.mocked(getProject);
const mockListMembers = vi.mocked(listMembers);
const mockListTestExecutionLogs = vi.mocked(listTestExecutionLogs);
const mockAddTestExecutionComment = vi.mocked(addTestExecutionComment);

const ORG_ID = "00000000-0000-0000-0000-0000000000aa";
const PROJECT_ID = "11111111-1111-1111-1111-111111111111";
const PLAN_ID = "22222222-2222-2222-2222-222222222222";
const CYCLE_ID = "55555555-5555-5555-5555-555555555555";
const RELEASE_ID = "66666666-6666-6666-6666-666666666666";
const ENV_ID = "77777777-7777-7777-7777-777777777777";
const ACTOR_ID = "99999999-9999-9999-9999-999999999999";
const EXECUTION_ID = "e0000000-0000-0000-0000-000000000000";
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
    id: EXECUTION_ID,
    test_cycle_id: CYCLE_ID,
    test_case_id: TC_LOGIN,
    executed_by_actor_id: ACTOR_ID,
    result: "pass",
    actual_result: null,
    executed_at: "2026-09-07T14:02:00Z",
    ...overrides,
  };
}

function log(overrides: Partial<TestLogSummary> = {}): TestLogSummary {
  return {
    id: "l0000000-0000-0000-0000-000000000001",
    test_execution_id: EXECUTION_ID,
    logged_at: "2026-09-07T14:02:00Z",
    event_type: "status_change",
    payload: { kind: "status_change", from: null, to: "pass" },
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

async function renderAndOpenHistory() {
  renderTestCycleDetail();
  expect(await screen.findByTestId("test-cycle-name")).toHaveTextContent("Cycle 1");
  const historyBtn = await screen.findByTestId(`execution-${EXECUTION_ID}-view-history`);
  fireEvent.click(historyBtn);
  await screen.findByTestId("execution-history-modal");
}

describe("TestCycleDetail — EXEC-2 execution log", () => {
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

  it("opens the history modal and renders the ordered timeline (AC3)", async () => {
    mockListTestExecutionLogs.mockResolvedValue([
      log({ id: "l1", logged_at: "2026-09-07T14:00:00Z", event_type: "status_change", payload: { kind: "status_change", from: null, to: "pass" } }),
      log({ id: "l2", logged_at: "2026-09-07T14:05:00Z", event_type: "status_change", payload: { kind: "status_change", from: "pass", to: "fail" } }),
    ]);

    await renderAndOpenHistory();

    expect(mockListTestExecutionLogs).toHaveBeenCalledWith(EXECUTION_ID);

    const timeline = await screen.findByTestId("execution-log-timeline");
    const entries = within(timeline).getAllByTestId(/^execution-log-entry-l[12]$/);
    // Oldest first, exactly as the API returns it -- no client-side reorder.
    expect(entries.map((el) => el.dataset.testid)).toEqual([
      "execution-log-entry-l1",
      "execution-log-entry-l2",
    ]);
    expect(screen.getByTestId("execution-log-entry-l2-summary")).toHaveTextContent(
      "pass → fail",
    );
  });

  it("shows a distinct badge and payload.kind summary for an agent_action row (Q3 default)", async () => {
    mockListTestExecutionLogs.mockResolvedValue([
      log({
        id: "l1",
        event_type: "agent_action",
        payload: { kind: "comment", text: "agent left a note", actor_type: "ai_agent" },
      }),
    ]);

    await renderAndOpenHistory();

    expect(await screen.findByTestId("execution-log-entry-l1-type")).toHaveTextContent(
      "agent_action",
    );
    expect(screen.getByTestId("execution-log-entry-l1-summary")).toHaveTextContent(
      "agent left a note",
    );
  });

  it("renders the load error inline when the timeline fetch fails", async () => {
    mockListTestExecutionLogs.mockRejectedValue(
      new ApiError("Test execution not found.", 404, { code: "not_found" }),
    );

    await renderAndOpenHistory();

    expect(await screen.findByTestId("execution-log-load-error")).toHaveTextContent(
      "Test execution not found.",
    );
  });

  it("submits a comment, then re-fetches the timeline (never a local splice)", async () => {
    mockListTestExecutionLogs
      .mockResolvedValueOnce([log({ id: "l1" })])
      .mockResolvedValueOnce([
        log({ id: "l1" }),
        log({ id: "l2", event_type: "comment", payload: { kind: "comment", text: "Looks correct" } }),
      ]);
    mockAddTestExecutionComment.mockResolvedValue(
      log({ id: "l2", event_type: "comment", payload: { kind: "comment", text: "Looks correct" } }),
    );

    await renderAndOpenHistory();
    await screen.findByTestId("execution-log-entry-l1");

    fireEvent.change(screen.getByTestId("add-comment-text"), {
      target: { value: "Looks correct" },
    });
    fireEvent.click(screen.getByTestId("add-comment-submit"));

    await waitFor(() =>
      expect(mockAddTestExecutionComment).toHaveBeenCalledWith(EXECUTION_ID, {
        text: "Looks correct",
        attachment_url: null,
        file_name: null,
      }),
    );
    // Re-fetch, not a locally-spliced row.
    await waitFor(() => expect(mockListTestExecutionLogs).toHaveBeenCalledTimes(2));
    expect(await screen.findByTestId("execution-log-entry-l2")).toHaveTextContent(
      "Looks correct",
    );
    // The form clears after a successful submit.
    expect(screen.getByTestId("add-comment-text")).toHaveValue("");
  });

  it("supplying an attachment URL is still submitted as such (Q4 default: no file upload)", async () => {
    mockAddTestExecutionComment.mockResolvedValue(
      log({ event_type: "attachment", payload: { kind: "attachment", text: "see screenshot" } }),
    );

    await renderAndOpenHistory();

    fireEvent.change(screen.getByTestId("add-comment-text"), {
      target: { value: "see screenshot" },
    });
    fireEvent.change(screen.getByTestId("add-comment-attachment-url"), {
      target: { value: "https://example.com/evidence.png" },
    });
    fireEvent.change(screen.getByTestId("add-comment-file-name"), {
      target: { value: "evidence.png" },
    });
    fireEvent.click(screen.getByTestId("add-comment-submit"));

    await waitFor(() =>
      expect(mockAddTestExecutionComment).toHaveBeenCalledWith(EXECUTION_ID, {
        text: "see screenshot",
        attachment_url: "https://example.com/evidence.png",
        file_name: "evidence.png",
      }),
    );
  });

  it("rejects an empty comment client-side without calling the API", async () => {
    await renderAndOpenHistory();

    fireEvent.click(screen.getByTestId("add-comment-submit"));

    expect(await screen.findByText("Comment text is required")).toBeInTheDocument();
    expect(mockAddTestExecutionComment).not.toHaveBeenCalled();
  });

  it("keeps the modal open with an inline error when the comment submit fails", async () => {
    mockAddTestExecutionComment.mockRejectedValue(
      new ApiError("You do not have permission to perform this action.", 403, {
        code: "permission_denied",
      }),
    );

    await renderAndOpenHistory();

    fireEvent.change(screen.getByTestId("add-comment-text"), { target: { value: "hi" } });
    fireEvent.click(screen.getByTestId("add-comment-submit"));

    expect(await screen.findByTestId("add-comment-error")).toHaveTextContent(
      "You do not have permission to perform this action.",
    );
    expect(screen.getByTestId("execution-history-modal")).toBeInTheDocument();
    // The typed text is not discarded on failure.
    expect(screen.getByTestId("add-comment-text")).toHaveValue("hi");
  });

  it("closing the modal clears its state so reopening starts fresh", async () => {
    mockListTestExecutionLogs.mockResolvedValue([log({ id: "l1" })]);

    await renderAndOpenHistory();
    await screen.findByTestId("execution-log-entry-l1");

    fireEvent.click(screen.getByTestId("execution-history-close"));
    await waitFor(() =>
      expect(screen.queryByTestId("execution-history-modal")).not.toBeInTheDocument(),
    );

    mockListTestExecutionLogs.mockClear();
    fireEvent.click(screen.getByTestId(`execution-${EXECUTION_ID}-view-history`));
    await screen.findByTestId("execution-history-modal");
    await waitFor(() => expect(mockListTestExecutionLogs).toHaveBeenCalledWith(EXECUTION_ID));
  });
});
