/**
 * REQ-4 (ADR-0030): the TestSuite membership feature grafted onto
 * `ProjectDetail` — the "Test Suites" section (list, create, live membership
 * view, remove) plus the TestCondition section's new TestCase sub-list and
 * "Add to suite" action (UI Design Document, 2026-09-06).
 *
 * Same partial-`vi.mock` convention as `ProjectDetail.TestConditions.test.tsx`:
 * the API *lib modules* are mocked, never `fetch`.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ProjectDetail from "../../../src/pages/workflows/ProjectDetail";
import type { RequirementSummary } from "../../../src/lib/api/requirements";
import { listRequirements } from "../../../src/lib/api/requirements";
import { listReleases } from "../../../src/lib/api/releases";
import type { TestConditionSummary } from "../../../src/lib/api/testConditions";
import { listTestConditions } from "../../../src/lib/api/testConditions";
import type { TestCaseSummary } from "../../../src/lib/api/testCases";
import { listTestCasesForTestCondition } from "../../../src/lib/api/testCases";
import { listTestLevels, listTestTypes } from "../../../src/lib/api/taxonomy";
import type { TestSuiteSummary } from "../../../src/lib/api/testSuites";
import {
  addTestCaseToSuite,
  createTestSuite,
  listSuiteTestCases,
  listTestSuites,
  removeTestCaseFromSuite,
} from "../../../src/lib/api/testSuites";

vi.mock("../../../src/lib/api/releases", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/lib/api/releases")>();
  return { ...actual, listReleases: vi.fn() };
});

vi.mock("../../../src/lib/api/requirements", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/lib/api/requirements")>();
  return { ...actual, createRequirement: vi.fn(), listRequirements: vi.fn() };
});

vi.mock("../../../src/lib/api/testConditions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/lib/api/testConditions")>();
  return { ...actual, createTestCondition: vi.fn(), listTestConditions: vi.fn() };
});

vi.mock("../../../src/lib/api/testCases", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/lib/api/testCases")>();
  return {
    ...actual,
    createTestCaseForTestCondition: vi.fn(),
    listTestCasesForTestCondition: vi.fn(),
  };
});

vi.mock("../../../src/lib/api/taxonomy", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/lib/api/taxonomy")>();
  return { ...actual, listTestLevels: vi.fn(), listTestTypes: vi.fn() };
});

vi.mock("../../../src/lib/api/testSuites", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/lib/api/testSuites")>();
  return {
    ...actual,
    createTestSuite: vi.fn(),
    listTestSuites: vi.fn(),
    listSuiteTestCases: vi.fn(),
    addTestCaseToSuite: vi.fn(),
    removeTestCaseFromSuite: vi.fn(),
  };
});

const mockListReleases = vi.mocked(listReleases);
const mockListRequirements = vi.mocked(listRequirements);
const mockListTestConditions = vi.mocked(listTestConditions);
const mockListTestCasesForTestCondition = vi.mocked(listTestCasesForTestCondition);
const mockListTestLevels = vi.mocked(listTestLevels);
const mockListTestTypes = vi.mocked(listTestTypes);
const mockCreateTestSuite = vi.mocked(createTestSuite);
const mockListTestSuites = vi.mocked(listTestSuites);
const mockListSuiteTestCases = vi.mocked(listSuiteTestCases);
const mockAddTestCaseToSuite = vi.mocked(addTestCaseToSuite);
const mockRemoveTestCaseFromSuite = vi.mocked(removeTestCaseFromSuite);

const PROJECT_ID = "11111111-1111-1111-1111-111111111111";
const REQUIREMENT_ID = "22222222-2222-2222-2222-222222222222";
const CONDITION_ID = "33333333-3333-3333-3333-333333333333";
const LEVEL_ID = "44444444-4444-4444-4444-444444444444";
const TYPE_ID = "55555555-5555-5555-5555-555555555555";
const SUITE_ID = "66666666-6666-6666-6666-666666666666";
const SUITE_B_ID = "77777777-7777-7777-7777-777777777777";
const CASE_ID = "88888888-8888-8888-8888-888888888888";

function requirement(overrides: Partial<RequirementSummary> = {}): RequirementSummary {
  return {
    id: REQUIREMENT_ID,
    project_id: PROJECT_ID,
    title: "Login must rate-limit",
    description: "Some description",
    external_ref: null,
    source: null,
    ...overrides,
  };
}

function testCondition(overrides: Partial<TestConditionSummary> = {}): TestConditionSummary {
  return {
    id: CONDITION_ID,
    requirement_id: REQUIREMENT_ID,
    description: "Sixth failed attempt is rejected",
    priority: "high",
    ...overrides,
  };
}

function testCase(overrides: Partial<TestCaseSummary> = {}): TestCaseSummary {
  return {
    id: CASE_ID,
    test_condition_id: CONDITION_ID,
    test_level_id: LEVEL_ID,
    test_type_id: TYPE_ID,
    created_by_actor_id: "99999999-9999-9999-9999-999999999999",
    title: "Sixth attempt returns 429",
    preconditions: null,
    expected_result: null,
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

function renderProjectDetail() {
  return render(
    <MemoryRouter initialEntries={[`/projects/${PROJECT_ID}`]}>
      <Routes>
        <Route path="/projects/:projectId" element={<ProjectDetail />} />
      </Routes>
    </MemoryRouter>,
  );
}

async function renderAndSettle() {
  renderProjectDetail();
  expect(await screen.findByText("Login must rate-limit")).toBeInTheDocument();
}

function expandTestConditions(requirementId = REQUIREMENT_ID) {
  fireEvent.click(screen.getByTestId(`tc-section-toggle-${requirementId}`));
}

async function toggleConditionCases(conditionId = CONDITION_ID) {
  fireEvent.click(await screen.findByTestId(`tc-cases-toggle-${conditionId}`));
}

describe("ProjectDetail — TestSuite membership (REQ-4)", () => {
  beforeEach(() => {
    mockListReleases.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 25 });
    mockListRequirements.mockResolvedValue({
      items: [requirement()],
      total: 1,
      page: 1,
      page_size: 25,
    });
    mockListTestConditions.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 25 });
    mockListTestLevels.mockResolvedValue({ items: [{ id: LEVEL_ID, name: "System" }], total: 1, page: 1, page_size: 25 });
    mockListTestTypes.mockResolvedValue({ items: [{ id: TYPE_ID, name: "Security" }], total: 1, page: 1, page_size: 25 });
    mockListTestSuites.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 25 });
    mockListTestCasesForTestCondition.mockResolvedValue([]);
    mockListSuiteTestCases.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 25 });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // --- Test Suites section: eager list, unlike TestConditions' lazy fetch --

  it("fetches the project's TestSuites on page load (not lazily, unlike TestConditions)", async () => {
    await renderAndSettle();
    await waitFor(() => expect(mockListTestSuites).toHaveBeenCalledWith(PROJECT_ID));
  });

  it("shows the empty state when the project has no suites yet", async () => {
    await renderAndSettle();
    expect(await screen.findByText("No test suites yet.")).toBeInTheDocument();
  });

  it("renders each fetched suite with its name and purpose badge", async () => {
    mockListTestSuites.mockResolvedValue({ items: [testSuite()], total: 1, page: 1, page_size: 25 });
    await renderAndSettle();

    const row = await screen.findByTestId(`test-suite-row-${SUITE_ID}`);
    expect(row).toHaveTextContent("Regression");
    expect(row).toHaveTextContent("regression");
  });

  // --- "New Test Suite" modal ------------------------------------------------

  it("rejects an empty name client-side, without calling createTestSuite()", async () => {
    await renderAndSettle();
    fireEvent.click(screen.getByTestId("new-test-suite-btn"));
    expect(screen.getByTestId("test-suite-modal")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("test-suite-submit"));

    expect(await screen.findByText(/name is required/i)).toBeInTheDocument();
    expect(mockCreateTestSuite).not.toHaveBeenCalled();
  });

  it("submits name/purpose to createTestSuite(), closes the modal, and re-fetches the suite list", async () => {
    mockCreateTestSuite.mockResolvedValue(testSuite());
    await renderAndSettle();
    await waitFor(() => expect(mockListTestSuites).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByTestId("new-test-suite-btn"));

    fireEvent.change(screen.getByTestId("test-suite-name"), { target: { value: "Regression" } });
    fireEvent.change(screen.getByTestId("test-suite-purpose"), { target: { value: "regression" } });
    fireEvent.click(screen.getByTestId("test-suite-submit"));

    await waitFor(() =>
      expect(mockCreateTestSuite).toHaveBeenCalledWith(PROJECT_ID, {
        name: "Regression",
        purpose: "regression",
      }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: /^new test suite$/i })).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(mockListTestSuites).toHaveBeenCalledTimes(2));
  });

  it("omits a blank purpose from the create body rather than sending an empty string", async () => {
    mockCreateTestSuite.mockResolvedValue(testSuite({ purpose: null }));
    await renderAndSettle();
    fireEvent.click(screen.getByTestId("new-test-suite-btn"));

    fireEvent.change(screen.getByTestId("test-suite-name"), { target: { value: "Smoke" } });
    fireEvent.click(screen.getByTestId("test-suite-submit"));

    await waitFor(() =>
      expect(mockCreateTestSuite).toHaveBeenCalledWith(PROJECT_ID, { name: "Smoke" }),
    );
  });

  it("maps a 422 field_errors.name response onto the name field", async () => {
    const { ApiError } = await import("../../../src/lib/api/client");
    mockCreateTestSuite.mockRejectedValue(
      new ApiError("Request failed validation.", 422, {
        field_errors: { name: ["Name must be unique."] },
      }),
    );
    await renderAndSettle();
    fireEvent.click(screen.getByTestId("new-test-suite-btn"));

    fireEvent.change(screen.getByTestId("test-suite-name"), { target: { value: "dupe" } });
    fireEvent.click(screen.getByTestId("test-suite-submit"));

    expect(await screen.findByText("Name must be unique.")).toBeInTheDocument();
  });

  // --- Live membership view ---------------------------------------------------

  it("does not fetch a suite's membership until its row is expanded", async () => {
    mockListTestSuites.mockResolvedValue({ items: [testSuite()], total: 1, page: 1, page_size: 25 });
    await renderAndSettle();
    await screen.findByTestId(`test-suite-row-${SUITE_ID}`);
    expect(mockListSuiteTestCases).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId(`test-suite-row-${SUITE_ID}`));

    await waitFor(() => expect(mockListSuiteTestCases).toHaveBeenCalledWith(SUITE_ID));
  });

  it("shows the empty-membership state distinct from the section-level empty state", async () => {
    mockListTestSuites.mockResolvedValue({ items: [testSuite()], total: 1, page: 1, page_size: 25 });
    await renderAndSettle();
    fireEvent.click(await screen.findByTestId(`test-suite-row-${SUITE_ID}`));

    expect(await screen.findByText("No test cases in this suite yet.")).toBeInTheDocument();
  });

  it("renders each member with a Remove button, and removing re-fetches (AC2: live, not a stale snapshot)", async () => {
    mockListTestSuites.mockResolvedValue({ items: [testSuite()], total: 1, page: 1, page_size: 25 });
    mockListSuiteTestCases
      .mockResolvedValueOnce({ items: [testCase()], total: 1, page: 1, page_size: 25 })
      .mockResolvedValueOnce({ items: [], total: 0, page: 1, page_size: 25 });
    mockRemoveTestCaseFromSuite.mockResolvedValue(undefined);
    await renderAndSettle();
    fireEvent.click(await screen.findByTestId(`test-suite-row-${SUITE_ID}`));

    const memberRow = await screen.findByTestId(`suite-member-${SUITE_ID}-${CASE_ID}`);
    expect(memberRow).toHaveTextContent("Sixth attempt returns 429");

    fireEvent.click(screen.getByTestId(`remove-from-suite-${SUITE_ID}-${CASE_ID}`));

    await waitFor(() => expect(mockRemoveTestCaseFromSuite).toHaveBeenCalledWith(SUITE_ID, CASE_ID));
    // Re-fetched (2nd call), not spliced locally — proves liveness, not an
    // optimistic client-side update standing in for the server's own state.
    await waitFor(() => expect(mockListSuiteTestCases).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("No test cases in this suite yet.")).toBeInTheDocument();
  });

  it("re-fetches membership on every expand, never restoring a cached copy from a prior expand", async () => {
    mockListTestSuites.mockResolvedValue({ items: [testSuite()], total: 1, page: 1, page_size: 25 });
    mockListSuiteTestCases.mockResolvedValue({ items: [testCase()], total: 1, page: 1, page_size: 25 });
    await renderAndSettle();
    const row = await screen.findByTestId(`test-suite-row-${SUITE_ID}`);

    fireEvent.click(row); // expand
    await waitFor(() => expect(mockListSuiteTestCases).toHaveBeenCalledTimes(1));
    fireEvent.click(row); // collapse
    fireEvent.click(row); // expand again

    await waitFor(() => expect(mockListSuiteTestCases).toHaveBeenCalledTimes(2));
  });

  // --- TestCondition's TestCase sub-list + "Add to suite" --------------------

  it("does not fetch a condition's TestCases until its own sub-toggle is clicked", async () => {
    mockListTestConditions.mockResolvedValue({ items: [testCondition()], total: 1, page: 1, page_size: 25 });
    await renderAndSettle();
    expandTestConditions();
    await screen.findByTestId(`test-condition-row-${CONDITION_ID}`);
    expect(mockListTestCasesForTestCondition).not.toHaveBeenCalled();

    await toggleConditionCases();

    await waitFor(() => expect(mockListTestCasesForTestCondition).toHaveBeenCalledWith(CONDITION_ID));
  });

  it("shows 'No test cases yet.' for a condition with none", async () => {
    mockListTestConditions.mockResolvedValue({ items: [testCondition()], total: 1, page: 1, page_size: 25 });
    await renderAndSettle();
    expandTestConditions();
    await toggleConditionCases();

    expect(await screen.findByText("No test cases yet.")).toBeInTheDocument();
  });

  it("renders each condition's TestCase with an 'Add to suite' toggle, disabled when the project has no suites", async () => {
    mockListTestConditions.mockResolvedValue({ items: [testCondition()], total: 1, page: 1, page_size: 25 });
    mockListTestCasesForTestCondition.mockResolvedValue([testCase()]);
    await renderAndSettle();
    expandTestConditions();
    await toggleConditionCases();

    const item = await screen.findByTestId(`tc-case-item-${CASE_ID}`);
    expect(item).toHaveTextContent("Sixth attempt returns 429");
    expect(screen.getByTestId(`add-to-suite-toggle-${CASE_ID}`)).toBeDisabled();
  });

  it("adds a TestCase to the selected suite via the dropdown, and refreshes that suite's membership if it's the one currently expanded", async () => {
    mockListTestSuites.mockResolvedValue({
      items: [testSuite(), testSuite({ id: SUITE_B_ID, name: "Smoke" })],
      total: 2,
      page: 1,
      page_size: 25,
    });
    mockListTestConditions.mockResolvedValue({ items: [testCondition()], total: 1, page: 1, page_size: 25 });
    mockListTestCasesForTestCondition.mockResolvedValue([testCase()]);
    mockAddTestCaseToSuite.mockResolvedValue(undefined);
    mockListSuiteTestCases.mockResolvedValue({ items: [testCase()], total: 1, page: 1, page_size: 25 });
    await renderAndSettle();

    // Expand the suite first so the "currently expanded" re-fetch is observable.
    fireEvent.click(await screen.findByTestId(`test-suite-row-${SUITE_ID}`));
    await waitFor(() => expect(mockListSuiteTestCases).toHaveBeenCalledTimes(1));

    expandTestConditions();
    await toggleConditionCases();
    fireEvent.click(await screen.findByTestId(`add-to-suite-toggle-${CASE_ID}`));
    fireEvent.click(screen.getByTestId(`add-to-suite-${CASE_ID}-${SUITE_ID}`));

    await waitFor(() => expect(mockAddTestCaseToSuite).toHaveBeenCalledWith(SUITE_ID, CASE_ID));
    await waitFor(() => expect(mockListSuiteTestCases).toHaveBeenCalledTimes(2));
  });

  it("surfaces a 422 cross-project rejection as a dismissible inline alert next to the case, not a toast", async () => {
    const { ApiError } = await import("../../../src/lib/api/client");
    mockListTestSuites.mockResolvedValue({ items: [testSuite()], total: 1, page: 1, page_size: 25 });
    mockListTestConditions.mockResolvedValue({ items: [testCondition()], total: 1, page: 1, page_size: 25 });
    mockListTestCasesForTestCondition.mockResolvedValue([testCase()]);
    mockAddTestCaseToSuite.mockRejectedValue(
      new ApiError("This test case belongs to a different project.", 422, {
        code: "validation_error",
      }),
    );
    await renderAndSettle();
    expandTestConditions();
    await toggleConditionCases();
    fireEvent.click(await screen.findByTestId(`add-to-suite-toggle-${CASE_ID}`));
    fireEvent.click(screen.getByTestId(`add-to-suite-${CASE_ID}-${SUITE_ID}`));

    const alert = await screen.findByTestId(`add-to-suite-error-${CASE_ID}`);
    expect(alert).toHaveTextContent("This test case belongs to a different project.");

    // Dismissible, per the UI Design Document's inline-CAlert-not-toast call.
    fireEvent.click(screen.getByRole("button", { name: /close/i, hidden: true }));
    await waitFor(() =>
      expect(screen.queryByTestId(`add-to-suite-error-${CASE_ID}`)).not.toBeInTheDocument(),
    );
  });

  it("surfaces a 409 duplicate-add rejection inline the same way as the 422 case", async () => {
    const { ApiError } = await import("../../../src/lib/api/client");
    mockListTestSuites.mockResolvedValue({ items: [testSuite()], total: 1, page: 1, page_size: 25 });
    mockListTestConditions.mockResolvedValue({ items: [testCondition()], total: 1, page: 1, page_size: 25 });
    mockListTestCasesForTestCondition.mockResolvedValue([testCase()]);
    mockAddTestCaseToSuite.mockRejectedValue(
      new ApiError("This test case is already in the suite.", 409, { code: "already_in_suite" }),
    );
    await renderAndSettle();
    expandTestConditions();
    await toggleConditionCases();
    fireEvent.click(await screen.findByTestId(`add-to-suite-toggle-${CASE_ID}`));
    fireEvent.click(screen.getByTestId(`add-to-suite-${CASE_ID}-${SUITE_ID}`));

    expect(await screen.findByTestId(`add-to-suite-error-${CASE_ID}`)).toHaveTextContent(
      "This test case is already in the suite.",
    );
  });
});
