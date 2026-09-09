/**
 * PLAN-3 (ADR-0033): `TestPlanDetail`'s "Test Cycles" section — the live cycle
 * list with its client-side-resolved Release/Environment labels, the "Create
 * Cycle" modal's plain path, the inline "+ New Environment" *sequential* two-
 * call path, and the inline `422` surfacing (UI Design Document §1/§2/§3).
 *
 * Same partial-`vi.mock` convention as the sibling
 * `TestPlanDetail.TestSuites.test.tsx`: the API *lib modules* are mocked, never
 * `fetch`. `entityCrud`'s generic `listEntities`/`createEntity`/`getEntity` are
 * mocked here too, since this section reads through the generic factory helpers
 * (only `create` is bespoke) — the `listEntities` stub dispatches on the
 * `EntityConfig.resource` it's handed, which is also what lets the `test_cycle`
 * list's own re-fetch be counted separately from the label lookups.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TestPlanDetail from "./TestPlanDetail";
import { getTestPlan, listPlanTestCases, listPlanTestSuites } from "../../lib/api/testPlans";
import type { TestPlanSummary } from "../../lib/api/testPlans";
import { listTestSuites } from "../../lib/api/testSuites";
import { listReleases } from "../../lib/api/releases";
import { createTestCycle } from "../../lib/api/testCycles";
import type { TestCycleSummary } from "../../lib/api/testCycles";
import { createEntity, getEntity, listEntities } from "../../lib/api/entityCrud";
import type { EntityRow, ListEnvelope } from "../../lib/api/entityCrud";
import type { EntityConfig } from "../../entityConfigs/types";

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

vi.mock("../../lib/api/releases", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api/releases")>();
  return { ...actual, listReleases: vi.fn() };
});

vi.mock("../../lib/api/testCycles", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api/testCycles")>();
  return { ...actual, createTestCycle: vi.fn() };
});

vi.mock("../../lib/api/entityCrud", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api/entityCrud")>();
  return { ...actual, listEntities: vi.fn(), getEntity: vi.fn(), createEntity: vi.fn() };
});

const mockGetTestPlan = vi.mocked(getTestPlan);
const mockListPlanTestSuites = vi.mocked(listPlanTestSuites);
const mockListPlanTestCases = vi.mocked(listPlanTestCases);
const mockListTestSuites = vi.mocked(listTestSuites);
const mockListReleases = vi.mocked(listReleases);
const mockCreateTestCycle = vi.mocked(createTestCycle);
const mockListEntities = vi.mocked(listEntities);
const mockGetEntity = vi.mocked(getEntity);
const mockCreateEntity = vi.mocked(createEntity);

const PROJECT_ID = "11111111-1111-1111-1111-111111111111";
const PLAN_ID = "22222222-2222-2222-2222-222222222222";
const CYCLE_ID = "55555555-5555-5555-5555-555555555555";
const RELEASE_ID = "66666666-6666-6666-6666-666666666666";
const ENV_ID = "77777777-7777-7777-7777-777777777777";
const NEW_ENV_ID = "88888888-8888-8888-8888-888888888888";

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

function testCycle(overrides: Partial<TestCycleSummary> = {}): TestCycleSummary {
  return {
    id: CYCLE_ID,
    test_plan_id: PLAN_ID,
    release_id: RELEASE_ID,
    environment_id: ENV_ID,
    name: "Cycle 1",
    start_date: "2026-01-01",
    end_date: "2026-01-31",
    ...overrides,
  };
}

function envelope<T>(items: T[]): ListEnvelope<T> {
  return { items, total: items.length, page: 1, page_size: 25 };
}

/** Rows the mocked generic `listEntities` hands back, keyed by `config.resource`. */
let cycleRows: TestCycleSummary[] = [];
let environmentRows: EntityRow[] = [];

function releaseEnvelope() {
  return {
    items: [{ id: RELEASE_ID, project_id: PROJECT_ID, version_label: "R-1.0", target_date: null }],
    total: 1,
    page: 1,
    page_size: 25,
  };
}

/** How many times the `test_cycle` list itself was fetched (vs. the label lookups). */
function cycleListCallCount(): number {
  return mockListEntities.mock.calls.filter(
    ([config]) => (config as EntityConfig).resource === "test_cycle",
  ).length;
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
  await waitFor(() => expect(cycleListCallCount()).toBeGreaterThan(0));
}

/**
 * Drive a `FkAutocomplete` the way a user does: type, wait out its 300ms
 * debounce for the dropdown, click the matching option. Not a shortcut past the
 * widget — the id it stores is exactly what the submit payload must carry.
 */
async function pickFromAutocomplete(label: string, term: string, optionLabel: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value: term } });
  const option = await screen.findByRole("button", { name: optionLabel }, { timeout: 3000 });
  fireEvent.click(option);
  // Selecting re-runs the widget's own `getEntity` label lookup; wait for it to
  // land so the assertion below runs against a settled field, not mid-flight.
  await waitFor(() => expect(screen.getByLabelText(label)).toHaveValue(optionLabel));
}

describe("TestPlanDetail — TestCycles (PLAN-3)", () => {
  beforeEach(() => {
    cycleRows = [];
    environmentRows = [{ id: ENV_ID, project_id: PROJECT_ID, name: "Staging", config_notes: null }];

    mockGetTestPlan.mockResolvedValue(testPlan());
    mockListPlanTestSuites.mockResolvedValue(envelope([]));
    mockListPlanTestCases.mockResolvedValue(envelope([]));
    mockListTestSuites.mockResolvedValue(envelope([]));
    mockListReleases.mockResolvedValue(releaseEnvelope());
    // `FkAutocomplete` re-resolves whatever id it currently holds through
    // `getEntity`, to display that row's own label.
    mockGetEntity.mockImplementation(async (_config, id) => {
      if (id === RELEASE_ID) {
        return { id, version_label: "R-1.0" } as EntityRow;
      }
      if (id === ENV_ID) {
        return { id, name: "Staging" } as EntityRow;
      }
      return { id } as EntityRow;
    });

    mockListEntities.mockImplementation(async (config) => {
      switch ((config as EntityConfig).resource) {
        case "test_cycle":
          // `TestCycleSummary` is a declared interface, so it has no implicit
          // index signature to widen into `EntityRow` — hence the double cast.
          return envelope(cycleRows) as unknown as ListEnvelope<EntityRow>;
        case "environment":
          return envelope(environmentRows);
        case "release":
          return releaseEnvelope() as ListEnvelope<EntityRow>;
        default:
          return envelope([]);
      }
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // --- §1: the live list -----------------------------------------------------

  it("shows the empty state, with the design document's exact wording, when the plan has no cycles", async () => {
    await renderAndSettle();
    expect(await screen.findByText("No test cycles yet.")).toBeInTheDocument();
  });

  it("renders each fetched cycle with its dates, resolved Release/Environment labels, and a View in Admin link", async () => {
    cycleRows = [testCycle()];
    await renderAndSettle();

    await waitFor(() =>
      expect(mockListEntities).toHaveBeenCalledWith(
        expect.objectContaining({ resource: "test_cycle" }),
        {},
        { params: { test_plan_id: PLAN_ID } },
      ),
    );

    const row = await screen.findByTestId(`test-cycle-${CYCLE_ID}`);
    expect(row).toHaveTextContent("Cycle 1");
    expect(row).toHaveTextContent("2026-01-01");
    expect(row).toHaveTextContent("2026-01-31");
    // Client-side label resolution (§1) — the ids never render once resolved.
    await waitFor(() => expect(row).toHaveTextContent("R-1.0"));
    await waitFor(() => expect(row).toHaveTextContent("Staging"));

    const link = within(row).getByTestId(`view-in-admin-${CYCLE_ID}`);
    expect(link).toHaveAttribute(
      "href",
      `/projects/${PROJECT_ID}/admin/test-cycles/${CYCLE_ID}/edit`,
    );
    // §1: create-and-view only — edit/delete live on the admin surface.
    expect(within(row).queryByRole("button", { name: /remove|delete|edit/i })).toBeNull();
  });

  // --- §2: the "Create Cycle" modal, plain path ------------------------------

  it("creates a cycle from the selected release/environment and re-fetches the list", async () => {
    mockCreateTestCycle.mockResolvedValue(testCycle());
    await renderAndSettle();
    const listCallsBefore = cycleListCallCount();

    fireEvent.click(screen.getByTestId("create-cycle-btn"));
    await pickFromAutocomplete("Release", "R-1", "R-1.0");
    await pickFromAutocomplete("Environment", "Stag", "Staging");
    fireEvent.change(screen.getByTestId("cycle-name"), { target: { value: "Cycle 1" } });
    fireEvent.change(screen.getByTestId("cycle-start-date"), { target: { value: "2026-01-01" } });

    // The list itself is re-fetched afterward, never spliced locally (§1).
    cycleRows = [testCycle()];
    fireEvent.click(screen.getByTestId("create-cycle-submit"));

    await waitFor(() => expect(mockCreateTestCycle).toHaveBeenCalledTimes(1));
    expect(mockCreateTestCycle).toHaveBeenCalledWith(PLAN_ID, {
      release_id: RELEASE_ID,
      environment_id: ENV_ID,
      name: "Cycle 1",
      start_date: "2026-01-01",
      end_date: null,
    });
    // `test_plan_id` comes from the path segment, never the body.
    expect(mockCreateTestCycle.mock.calls[0][1]).not.toHaveProperty("test_plan_id");

    await waitFor(() => expect(cycleListCallCount()).toBe(listCallsBefore + 1));
    expect(await screen.findByTestId(`test-cycle-${CYCLE_ID}`)).toHaveTextContent("Cycle 1");
  });

  // --- §2/§3: the inline "+ New Environment" sequential path -----------------

  it("creates the inline Environment first, then the cycle with the id it returned", async () => {
    mockCreateEntity.mockResolvedValue({ id: NEW_ENV_ID, name: "Staging 2" });
    mockCreateTestCycle.mockResolvedValue(testCycle({ environment_id: NEW_ENV_ID }));
    await renderAndSettle();

    fireEvent.click(screen.getByTestId("create-cycle-btn"));
    await pickFromAutocomplete("Release", "R-1", "R-1.0");

    fireEvent.click(screen.getByTestId("new-environment-toggle"));
    // The toggle replaces that one field: the autocomplete is gone entirely.
    expect(screen.queryByTestId("create-cycle-environment")).toBeNull();
    fireEvent.change(screen.getByTestId("new-environment-name"), {
      target: { value: "Staging 2" },
    });
    fireEvent.change(screen.getByTestId("cycle-name"), { target: { value: "Cycle 2" } });
    fireEvent.click(screen.getByTestId("create-cycle-submit"));

    await waitFor(() => expect(mockCreateTestCycle).toHaveBeenCalledTimes(1));
    expect(mockCreateEntity).toHaveBeenCalledTimes(1);

    const [envConfig, , envBody] = mockCreateEntity.mock.calls[0];
    expect((envConfig as EntityConfig).resource).toBe("environment");
    expect(envBody).toEqual({ project_id: PROJECT_ID, name: "Staging 2", config_notes: null });

    // Two sequential requests, in this order — ADR-0033 Decision #4. Asserting
    // ordering, not just that both fired: "environment first" is the property.
    expect(mockCreateEntity.mock.invocationCallOrder[0]).toBeLessThan(
      mockCreateTestCycle.mock.invocationCallOrder[0],
    );
    expect(mockCreateTestCycle).toHaveBeenCalledWith(PLAN_ID, {
      release_id: RELEASE_ID,
      environment_id: NEW_ENV_ID,
      name: "Cycle 2",
      start_date: null,
      end_date: null,
    });
  });

  it("never attempts the cycle create when the inline Environment create fails", async () => {
    const { ApiError } = await import("../../../src/lib/api/client");
    mockCreateEntity.mockRejectedValue(
      new ApiError("You do not have permission to create an environment.", 403, {
        code: "permission_denied",
      }),
    );
    await renderAndSettle();

    fireEvent.click(screen.getByTestId("create-cycle-btn"));
    await pickFromAutocomplete("Release", "R-1", "R-1.0");
    fireEvent.click(screen.getByTestId("new-environment-toggle"));
    fireEvent.change(screen.getByTestId("new-environment-name"), { target: { value: "Broken" } });
    fireEvent.change(screen.getByTestId("cycle-name"), { target: { value: "Cycle 3" } });
    fireEvent.click(screen.getByTestId("create-cycle-submit"));

    expect(await screen.findByTestId("cycle-error")).toHaveTextContent(
      "You do not have permission to create an environment.",
    );
    expect(mockCreateTestCycle).not.toHaveBeenCalled();
  });

  it("discards typed inline-environment values when the toggle is switched back off", async () => {
    await renderAndSettle();

    fireEvent.click(screen.getByTestId("create-cycle-btn"));
    fireEvent.click(screen.getByTestId("new-environment-toggle"));
    fireEvent.change(screen.getByTestId("new-environment-name"), {
      target: { value: "Discarded" },
    });

    fireEvent.click(screen.getByTestId("new-environment-toggle"));
    expect(screen.getByTestId("create-cycle-environment")).toBeInTheDocument();
    expect(screen.getByLabelText("Environment")).toHaveValue("");

    fireEvent.click(screen.getByTestId("new-environment-toggle"));
    expect(screen.getByTestId("new-environment-name")).toHaveValue("");
  });

  // --- §1: error surfacing ---------------------------------------------------

  it("surfaces a 422 from the cycle create as the section's dismissible alert", async () => {
    const { ApiError } = await import("../../../src/lib/api/client");
    mockCreateTestCycle.mockRejectedValue(
      new ApiError("Release belongs to a different project.", 422, { code: "validation_error" }),
    );
    await renderAndSettle();

    fireEvent.click(screen.getByTestId("create-cycle-btn"));
    await pickFromAutocomplete("Release", "R-1", "R-1.0");
    await pickFromAutocomplete("Environment", "Stag", "Staging");
    fireEvent.change(screen.getByTestId("cycle-name"), { target: { value: "Cycle 4" } });
    fireEvent.click(screen.getByTestId("create-cycle-submit"));

    const alert = await screen.findByTestId("cycle-error");
    expect(alert).toHaveTextContent("Release belongs to a different project.");

    fireEvent.click(within(alert).getByRole("button", { name: /close/i, hidden: true }));
    await waitFor(() => expect(screen.queryByTestId("cycle-error")).not.toBeInTheDocument());
  });

  // --- §1: attempt-then-error, no permission-based hide/disable --------------

  it("renders Create Cycle unconditionally — no permission-based hide or disable", async () => {
    await renderAndSettle();
    expect(screen.getByTestId("create-cycle-btn")).toBeEnabled();
  });
});
