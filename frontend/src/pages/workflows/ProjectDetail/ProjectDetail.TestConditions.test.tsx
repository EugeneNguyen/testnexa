/**
 * REQ-3 (ADR-0028): the TestCondition rigor path grafted onto
 * `ProjectDetail`'s existing Requirement list — per-requirement
 * TestCondition section, "New Test Condition" modal, "New Test Case" modal.
 *
 * Same partial-`vi.mock` convention as `ProjectDetail.Requirements.test.tsx`:
 * the API *lib modules* are mocked, never `fetch`, so these assert the exact
 * function + path arg + request body each form submits.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ProjectDetail from "./ProjectDetail";
import type { RequirementSummary } from "../../../lib/api/requirements";
import { listRequirements } from "../../../lib/api/requirements";
import { listReleases } from "../../../lib/api/releases";
import type { TestConditionSummary } from "../../../lib/api/testConditions";
import { createTestCondition, listTestConditions } from "../../../lib/api/testConditions";
import type { TestCaseSummary } from "../../../lib/api/testCases";
import { createTestCaseForTestCondition } from "../../../lib/api/testCases";
import { listTestLevels, listTestTypes } from "../../../lib/api/taxonomy";

vi.mock("../../../lib/api/releases", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/api/releases")>();
  return { ...actual, listReleases: vi.fn() };
});

vi.mock("../../../lib/api/requirements", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/api/requirements")>();
  return { ...actual, createRequirement: vi.fn(), listRequirements: vi.fn() };
});

vi.mock("../../../lib/api/testConditions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/api/testConditions")>();
  return { ...actual, createTestCondition: vi.fn(), listTestConditions: vi.fn() };
});

vi.mock("../../../lib/api/testCases", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/api/testCases")>();
  return { ...actual, createTestCaseForTestCondition: vi.fn() };
});

vi.mock("../../../lib/api/taxonomy", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/api/taxonomy")>();
  return { ...actual, listTestLevels: vi.fn(), listTestTypes: vi.fn() };
});

const mockListReleases = vi.mocked(listReleases);
const mockListRequirements = vi.mocked(listRequirements);
const mockCreateTestCondition = vi.mocked(createTestCondition);
const mockListTestConditions = vi.mocked(listTestConditions);
const mockCreateTestCase = vi.mocked(createTestCaseForTestCondition);
const mockListTestLevels = vi.mocked(listTestLevels);
const mockListTestTypes = vi.mocked(listTestTypes);

const PROJECT_ID = "11111111-1111-1111-1111-111111111111";
const REQUIREMENT_ID = "22222222-2222-2222-2222-222222222222";
const CONDITION_ID = "33333333-3333-3333-3333-333333333333";
const LEVEL_ID = "44444444-4444-4444-4444-444444444444";
const TYPE_ID = "55555555-5555-5555-5555-555555555555";

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
    id: "66666666-6666-6666-6666-666666666666",
    test_condition_id: CONDITION_ID,
    test_level_id: LEVEL_ID,
    test_type_id: TYPE_ID,
    created_by_actor_id: "77777777-7777-7777-7777-777777777777",
    title: "Sixth attempt returns 429",
    preconditions: null,
    expected_result: null,
    status: "draft",
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

/** Mounts the page and waits for its two on-load list fetches to settle. */
async function renderAndSettle() {
  renderProjectDetail();
  expect(await screen.findByText("Login must rate-limit")).toBeInTheDocument();
}

/** Expands a requirement's Test Conditions section (lazy fetch happens here). */
function expandTestConditions(requirementId = REQUIREMENT_ID) {
  fireEvent.click(screen.getByTestId(`tc-section-toggle-${requirementId}`));
}

describe("ProjectDetail — TestCondition rigor path (REQ-3)", () => {
  beforeEach(() => {
    mockListReleases.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 25 });
    mockListRequirements.mockResolvedValue({
      items: [requirement()],
      total: 1,
      page: 1,
      page_size: 25,
    });
    mockListTestConditions.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 25 });
    mockListTestLevels.mockResolvedValue({
      items: [{ id: LEVEL_ID, name: "System" }],
      total: 1,
      page: 1,
      page_size: 25,
    });
    mockListTestTypes.mockResolvedValue({
      items: [{ id: TYPE_ID, name: "Security" }],
      total: 1,
      page: 1,
      page_size: 25,
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // --- Section: lazy list ---------------------------------------------------

  it("does not fetch test conditions on page load, only on first expand", async () => {
    await renderAndSettle();
    expect(mockListTestConditions).not.toHaveBeenCalled();

    expandTestConditions();

    await waitFor(() => expect(mockListTestConditions).toHaveBeenCalledWith(REQUIREMENT_ID));
    expect(mockListTestConditions).toHaveBeenCalledTimes(1);
  });

  it("renders the fetched conditions with their priority, and an empty state when there are none", async () => {
    mockListTestConditions.mockResolvedValue({
      items: [testCondition()],
      total: 1,
      page: 1,
      page_size: 25,
    });
    await renderAndSettle();
    expandTestConditions();

    const row = await screen.findByTestId(`test-condition-row-${CONDITION_ID}`);
    expect(row).toHaveTextContent("Sixth failed attempt is rejected");
    expect(row).toHaveTextContent("high");
    expect(screen.getByTestId(`new-test-case-btn-${CONDITION_ID}`)).toBeInTheDocument();
  });

  it("shows the empty state when a requirement has no test conditions", async () => {
    await renderAndSettle();
    expandTestConditions();

    expect(await screen.findByText("No test conditions yet.")).toBeInTheDocument();
  });

  // --- "New Test Condition" modal ------------------------------------------

  it("rejects an empty description/priority client-side, without calling createTestCondition()", async () => {
    await renderAndSettle();
    expandTestConditions();
    fireEvent.click(await screen.findByTestId(`new-test-condition-btn-${REQUIREMENT_ID}`));
    expect(screen.getByTestId("test-condition-modal")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("test-condition-submit"));

    expect(await screen.findByText(/description is required/i)).toBeInTheDocument();
    expect(screen.getByText(/priority is required/i)).toBeInTheDocument();
    expect(mockCreateTestCondition).not.toHaveBeenCalled();
  });

  it("rejects a priority outside low/medium/high, without calling createTestCondition()", async () => {
    await renderAndSettle();
    expandTestConditions();
    fireEvent.click(await screen.findByTestId(`new-test-condition-btn-${REQUIREMENT_ID}`));

    fireEvent.change(screen.getByTestId("test-condition-description"), {
      target: { value: "Sixth failed attempt is rejected" },
    });

    // A `<select>` can only hold a value one of its own options declares, so
    // an out-of-range value is injected via a rogue option — this is the
    // schema's `refine` under test (the guard against a tampered/stale
    // option), not the browser's own select behaviour.
    const priority = screen.getByTestId("test-condition-priority") as HTMLSelectElement;
    const rogueOption = document.createElement("option");
    rogueOption.value = "urgent";
    rogueOption.textContent = "urgent";
    priority.append(rogueOption);
    fireEvent.change(priority, { target: { value: "urgent" } });
    expect(priority.value).toBe("urgent");

    fireEvent.click(screen.getByTestId("test-condition-submit"));

    expect(await screen.findByText(/priority is required/i)).toBeInTheDocument();
    expect(mockCreateTestCondition).not.toHaveBeenCalled();
  });

  it("submits description/priority to createTestCondition(), closes the modal, and re-fetches that requirement's list", async () => {
    mockCreateTestCondition.mockResolvedValue(testCondition({ priority: "medium" }));
    await renderAndSettle();
    expandTestConditions();
    await waitFor(() => expect(mockListTestConditions).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByTestId(`new-test-condition-btn-${REQUIREMENT_ID}`));

    fireEvent.change(screen.getByTestId("test-condition-description"), {
      target: { value: "Sixth failed attempt is rejected" },
    });
    fireEvent.change(screen.getByTestId("test-condition-priority"), { target: { value: "medium" } });
    fireEvent.click(screen.getByTestId("test-condition-submit"));

    await waitFor(() =>
      expect(mockCreateTestCondition).toHaveBeenCalledWith(REQUIREMENT_ID, {
        description: "Sixth failed attempt is rejected",
        priority: "medium",
      }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: /^new test condition$/i })).not.toBeInTheDocument(),
    );
    // 1st call = first expand, 2nd = post-create re-fetch.
    await waitFor(() => expect(mockListTestConditions).toHaveBeenCalledTimes(2));
  });

  it("maps a 422 field_errors.description response onto the description field", async () => {
    const { ApiError } = await import("../../../../src/lib/api/client");
    mockCreateTestCondition.mockRejectedValue(
      new ApiError("Request failed validation.", 422, {
        field_errors: { description: ["Description must be unique."] },
      }),
    );
    await renderAndSettle();
    expandTestConditions();
    fireEvent.click(await screen.findByTestId(`new-test-condition-btn-${REQUIREMENT_ID}`));

    fireEvent.change(screen.getByTestId("test-condition-description"), { target: { value: "dupe" } });
    fireEvent.change(screen.getByTestId("test-condition-priority"), { target: { value: "low" } });
    fireEvent.click(screen.getByTestId("test-condition-submit"));

    expect(await screen.findByText("Description must be unique.")).toBeInTheDocument();
  });

  // --- "New Test Case" modal ------------------------------------------------

  it("populates the test level/type selects from one catalog fetch per page load", async () => {
    mockListTestConditions.mockResolvedValue({
      items: [testCondition()],
      total: 1,
      page: 1,
      page_size: 25,
    });
    await renderAndSettle();
    await waitFor(() => expect(mockListTestLevels).toHaveBeenCalledTimes(1));
    expect(mockListTestTypes).toHaveBeenCalledTimes(1);

    expandTestConditions();
    fireEvent.click(await screen.findByTestId(`new-test-case-btn-${CONDITION_ID}`));
    expect(screen.getByRole("option", { name: "System" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Security" })).toBeInTheDocument();

    // Re-opening the modal must not re-fetch the global catalog.
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    fireEvent.click(screen.getByTestId(`new-test-case-btn-${CONDITION_ID}`));
    expect(mockListTestLevels).toHaveBeenCalledTimes(1);
    expect(mockListTestTypes).toHaveBeenCalledTimes(1);
  });

  it("rejects an empty title/test level/test type client-side, without calling createTestCaseForTestCondition()", async () => {
    mockListTestConditions.mockResolvedValue({
      items: [testCondition()],
      total: 1,
      page: 1,
      page_size: 25,
    });
    await renderAndSettle();
    expandTestConditions();
    fireEvent.click(await screen.findByTestId(`new-test-case-btn-${CONDITION_ID}`));
    expect(screen.getByTestId("test-case-modal")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("test-case-submit"));

    expect(await screen.findByText(/title is required/i)).toBeInTheDocument();
    expect(screen.getByText(/test level is required/i)).toBeInTheDocument();
    expect(screen.getByText(/test type is required/i)).toBeInTheDocument();
    expect(mockCreateTestCase).not.toHaveBeenCalled();
  });

  it("submits every field to createTestCaseForTestCondition(), closes the modal, and toasts", async () => {
    mockListTestConditions.mockResolvedValue({
      items: [testCondition()],
      total: 1,
      page: 1,
      page_size: 25,
    });
    mockCreateTestCase.mockResolvedValue(testCase());
    await renderAndSettle();
    expandTestConditions();
    fireEvent.click(await screen.findByTestId(`new-test-case-btn-${CONDITION_ID}`));

    fireEvent.change(screen.getByTestId("test-case-title"), {
      target: { value: "Sixth attempt returns 429" },
    });
    fireEvent.change(screen.getByTestId("test-case-preconditions"), {
      target: { value: "Five failed attempts already recorded" },
    });
    fireEvent.change(screen.getByTestId("test-case-expected-result"), {
      target: { value: "HTTP 429" },
    });
    fireEvent.change(screen.getByTestId("test-case-test-level"), { target: { value: LEVEL_ID } });
    fireEvent.change(screen.getByTestId("test-case-test-type"), { target: { value: TYPE_ID } });
    fireEvent.click(screen.getByTestId("test-case-submit"));

    await waitFor(() =>
      expect(mockCreateTestCase).toHaveBeenCalledWith(CONDITION_ID, {
        title: "Sixth attempt returns 429",
        preconditions: "Five failed attempts already recorded",
        expected_result: "HTTP 429",
        test_level_id: LEVEL_ID,
        test_type_id: TYPE_ID,
      }),
    );
    expect(
      await screen.findByText("Test case created and linked to this test condition"),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole("heading", { name: /^new test case$/i })).not.toBeInTheDocument(),
    );
    // No per-condition TestCase list exists to re-fetch (ADR-0028 YAGNI), so
    // the condition list must not be re-queried either.
    expect(mockListTestConditions).toHaveBeenCalledTimes(1);
  });

  it("omits blank optional fields from the create body rather than sending empty strings", async () => {
    mockListTestConditions.mockResolvedValue({
      items: [testCondition()],
      total: 1,
      page: 1,
      page_size: 25,
    });
    mockCreateTestCase.mockResolvedValue(testCase());
    await renderAndSettle();
    expandTestConditions();
    fireEvent.click(await screen.findByTestId(`new-test-case-btn-${CONDITION_ID}`));

    fireEvent.change(screen.getByTestId("test-case-title"), { target: { value: "Minimal case" } });
    fireEvent.change(screen.getByTestId("test-case-test-level"), { target: { value: LEVEL_ID } });
    fireEvent.change(screen.getByTestId("test-case-test-type"), { target: { value: TYPE_ID } });
    fireEvent.click(screen.getByTestId("test-case-submit"));

    await waitFor(() =>
      expect(mockCreateTestCase).toHaveBeenCalledWith(CONDITION_ID, {
        title: "Minimal case",
        test_level_id: LEVEL_ID,
        test_type_id: TYPE_ID,
      }),
    );
  });

  it("surfaces a 403 from createTestCaseForTestCondition() as an inline alert (attempt-then-error, no pre-hidden button)", async () => {
    mockListTestConditions.mockResolvedValue({
      items: [testCondition()],
      total: 1,
      page: 1,
      page_size: 25,
    });
    const { ApiError } = await import("../../../../src/lib/api/client");
    mockCreateTestCase.mockRejectedValue(
      new ApiError("You do not have permission to perform this action.", 403, {
        code: "permission_denied",
      }),
    );
    await renderAndSettle();
    expandTestConditions();
    fireEvent.click(await screen.findByTestId(`new-test-case-btn-${CONDITION_ID}`));

    fireEvent.change(screen.getByTestId("test-case-title"), { target: { value: "Denied case" } });
    fireEvent.change(screen.getByTestId("test-case-test-level"), { target: { value: LEVEL_ID } });
    fireEvent.change(screen.getByTestId("test-case-test-type"), { target: { value: TYPE_ID } });
    fireEvent.click(screen.getByTestId("test-case-submit"));

    expect(
      await screen.findByText("You do not have permission to perform this action."),
    ).toBeInTheDocument();
  });
});
