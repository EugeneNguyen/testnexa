/**
 * PLAN-2 (ADR-0032, UI Design Document
 * `docs/ui-design/2026-09-06-plan-2-entry-exit-criteria-visibility-ui-design.md`
 * §2/§4): the exit criteria added to `ProjectDetail`'s Release→TestCycle
 * expand-in-place row — the one view where a cycle's exit criteria and its
 * execution progress are visible together, without a separate lookup (AC2).
 *
 * This file also establishes the first unit coverage of that expand at all:
 * `ProjectDetail.test.tsx` mocks `getReleaseTestCycles` but never clicks a
 * release row to exercise it.
 *
 * Same partial-`vi.mock` convention as `ProjectDetail.TestPlans.test.tsx`: the
 * API *lib modules* are mocked, never `fetch`.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ProjectDetail from "./ProjectDetail";
import type { ReleaseSummary, TestCycleSummary } from "../../../lib/api/releases";
import { getReleaseTestCycles, listReleases } from "../../../lib/api/releases";
import { listRequirements } from "../../../lib/api/requirements";
import { listTestLevels, listTestTypes } from "../../../lib/api/taxonomy";
import { listTestSuites } from "../../../lib/api/testSuites";
import { listTestPlans } from "../../../lib/api/testPlans";

vi.mock("../../../lib/api/releases", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/api/releases")>();
  return { ...actual, listReleases: vi.fn(), getReleaseTestCycles: vi.fn() };
});

vi.mock("../../../lib/api/requirements", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/api/requirements")>();
  return { ...actual, listRequirements: vi.fn() };
});

vi.mock("../../../lib/api/taxonomy", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/api/taxonomy")>();
  return { ...actual, listTestLevels: vi.fn(), listTestTypes: vi.fn() };
});

vi.mock("../../../lib/api/testSuites", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/api/testSuites")>();
  return { ...actual, listTestSuites: vi.fn() };
});

vi.mock("../../../lib/api/testPlans", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/api/testPlans")>();
  return { ...actual, listTestPlans: vi.fn() };
});

const mockListReleases = vi.mocked(listReleases);
const mockGetReleaseTestCycles = vi.mocked(getReleaseTestCycles);
const mockListRequirements = vi.mocked(listRequirements);
const mockListTestLevels = vi.mocked(listTestLevels);
const mockListTestTypes = vi.mocked(listTestTypes);
const mockListTestSuites = vi.mocked(listTestSuites);
const mockListTestPlans = vi.mocked(listTestPlans);

const PROJECT_ID = "11111111-1111-1111-1111-111111111111";
const RELEASE_ID = "22222222-2222-2222-2222-222222222222";
const CYCLE_ID = "33333333-3333-3333-3333-333333333333";
const PLAN_ID = "44444444-4444-4444-4444-444444444444";
const CRITERIA_A_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const CRITERIA_B_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

function release(overrides: Partial<ReleaseSummary> = {}): ReleaseSummary {
  return {
    id: RELEASE_ID,
    project_id: PROJECT_ID,
    version_label: "v1.0.0",
    target_date: "2026-01-01",
    ...overrides,
  };
}

function testCycle(overrides: Partial<TestCycleSummary> = {}): TestCycleSummary {
  return {
    id: CYCLE_ID,
    release_id: RELEASE_ID,
    test_plan_id: PLAN_ID,
    environment_id: "55555555-5555-5555-5555-555555555555",
    name: "Cycle 1",
    start_date: "2026-01-02",
    end_date: "2026-01-09",
    executions: [],
    exit_criteria: [],
    ...overrides,
  };
}

function renderProjectDetail() {
  return render(
    <MemoryRouter initialEntries={[`/projects/${PROJECT_ID}`]}>
      <Routes>
        <Route path="/projects/:projectId" element={<ProjectDetail />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Expand the one release row, which lazily fires `getReleaseTestCycles`. */
async function expandRelease() {
  renderProjectDetail();
  const row = await screen.findByText("v1.0.0");
  fireEvent.click(row);
  await waitFor(() => expect(mockGetReleaseTestCycles).toHaveBeenCalledWith(RELEASE_ID));
}

describe("ProjectDetail — Release→TestCycle expand: exit criteria (PLAN-2)", () => {
  beforeEach(() => {
    mockListReleases.mockResolvedValue({ items: [release()], total: 1, page: 1, page_size: 25 });
    mockListRequirements.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 25 });
    mockListTestLevels.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 25 });
    mockListTestTypes.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 25 });
    mockListTestSuites.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 25 });
    mockListTestPlans.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 25 });
    mockGetReleaseTestCycles.mockResolvedValue([testCycle()]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders each cycle's exit criteria in the expanded row, alongside its executions", async () => {
    mockGetReleaseTestCycles.mockResolvedValue([
      testCycle({
        exit_criteria: [
          {
            id: CRITERIA_A_ID,
            test_plan_id: PLAN_ID,
            type: "exit",
            condition_text: "All P1 defects closed",
          },
          {
            id: CRITERIA_B_ID,
            test_plan_id: PLAN_ID,
            type: "exit",
            condition_text: "95% of planned cases executed",
          },
        ],
      }),
    ]);
    await expandRelease();

    const list = await screen.findByTestId(`cycle-exit-criteria-${CYCLE_ID}`);
    expect(list).toHaveTextContent("All P1 defects closed");
    expect(list).toHaveTextContent("95% of planned cases executed");
    expect(screen.getByTestId(`cycle-exit-criteria-label-${CYCLE_ID}`)).toHaveTextContent(
      "Exit criteria:",
    );
    // The executions list's own empty state is untouched by this addition, and
    // deliberately worded differently (§4).
    expect(screen.getByText("No executions yet.")).toBeInTheDocument();
  });

  it("shows the exit-criteria empty state, with the design document's exact wording", async () => {
    await expandRelease();

    expect(await screen.findByTestId(`cycle-exit-criteria-empty-${CYCLE_ID}`)).toHaveTextContent(
      "No exit criteria defined.",
    );
    expect(screen.getByText("No exit criteria defined.")).toBeInTheDocument();
    // Distinct copy from the executions empty state in the same expanded row.
    expect(screen.getByText("No executions yet.")).toBeInTheDocument();
  });

  it("renders every exit_criteria row the backend returned, without re-filtering client-side", async () => {
    // The backend already filtered to `type = exit` (ADR-0032). Even a row this
    // page would never expect to see is rendered as-is rather than dropped —
    // proving there is no second, client-side filter.
    mockGetReleaseTestCycles.mockResolvedValue([
      testCycle({
        exit_criteria: [
          {
            id: CRITERIA_A_ID,
            test_plan_id: PLAN_ID,
            type: "entry",
            condition_text: "Server-side filtering is the only filter",
          },
        ],
      }),
    ]);
    await expandRelease();

    expect(await screen.findByTestId(`cycle-exit-criterion-${CRITERIA_A_ID}`)).toHaveTextContent(
      "Server-side filtering is the only filter",
    );
  });

  it("renders the exit criteria read-only — no per-row edit or delete action", async () => {
    mockGetReleaseTestCycles.mockResolvedValue([
      testCycle({
        exit_criteria: [
          {
            id: CRITERIA_A_ID,
            test_plan_id: PLAN_ID,
            type: "exit",
            condition_text: "All P1 defects closed",
          },
        ],
      }),
    ]);
    await expandRelease();

    const row = await screen.findByTestId(`cycle-exit-criterion-${CRITERIA_A_ID}`);
    expect(row.querySelector("button")).toBeNull();
  });
});
