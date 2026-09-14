/**
 * REQ-5 (standalone TestCase authoring + Requirement retrofit link,
 * ADR-0068): `EntityFormPage`'s new "Link to Requirement" section, rendered
 * only when `entityKey === "test-cases"` — mirrors
 * `EntityFormPage.Defects.test.tsx`'s own fixture-config-via-mocked-registry
 * convention, extended with a `requirement` fixture config so the section's
 * two `FkAutocomplete` mounts (linked-state display, unlinked-state picker)
 * have something to resolve against.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import EntityFormPage from "./EntityFormPage";
import { getEntity, listEntities } from "../../../lib/api/entityCrud";
import { getTestCaseRequirementLink, linkTestCaseToRequirement } from "../../../lib/api/testCases";
import { ApiError } from "../../../lib/api/client";

/** Real 300ms wait for `FkAutocomplete`'s debounce — real timers throughout
 * this file (unlike `fk-autocomplete.test.tsx`'s own fake-timer suite) since
 * these tests lean on `screen.findByX`/`waitFor`'s own real-timer polling. */
function waitOutDebounce() {
  return new Promise((resolve) => setTimeout(resolve, 350));
}

vi.mock("../../../pages/admin/registry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../pages/admin/registry")>();
  return {
    ...actual,
    entityLabelByKey: { "test-cases": "Test cases", projects: "Projects" },
    ADMIN_ENTITY_KEYS: new Set(["test-cases", "projects"]),
  };
});

vi.mock("../../../pages/admin/useEntitySchema", () => {
  const configs: Record<string, unknown> = {
    "test-cases": {
      resource: "test_case",
      path: "/test-cases",
      methods: ["get", "update", "delete"],
      fields: [{ name: "title", label: "Title", type: "string", required: true }],
    },
    projects: {
      resource: "project",
      path: "/projects",
      methods: ["get", "update"],
      fields: [{ name: "name", label: "Name", type: "string", required: true }],
    },
    requirements: {
      resource: "requirement",
      path: "/requirements",
      methods: ["list", "get", "create", "update", "delete"],
      fields: [{ name: "title", label: "Title", type: "string", required: true }],
    },
  };
  const labels: Record<string, string> = {
    "test-cases": "Test cases",
    projects: "Projects",
    requirements: "Requirements",
  };
  const resolveEntityKey = (key: string) => (key.endsWith("s") ? key : `${key}s`);
  return {
    resolveEntityKey,
    useEntitySchema: (key?: string) => {
      const resolved = key ? resolveEntityKey(key) : undefined;
      return {
        config: resolved ? configs[resolved] : undefined,
        label: resolved ? labels[resolved] : undefined,
        isLoading: false,
        isError: false,
      };
    },
    useEntitySchemas: (keys: string[]) => {
      const out: Record<string, unknown> = {};
      for (const key of keys) {
        const resolved = resolveEntityKey(key);
        if (configs[resolved]) {
          out[resolved] = configs[resolved];
        }
      }
      return out;
    },
  };
});

vi.mock("../../../lib/api/entityCrud", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/api/entityCrud")>();
  return { ...actual, getEntity: vi.fn(), listEntities: vi.fn(), updateEntity: vi.fn().mockResolvedValue({}) };
});

vi.mock("../../../lib/api/defects", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/api/defects")>();
  return { ...actual, listDefectsForTestCase: vi.fn().mockResolvedValue([]) };
});

vi.mock("../../../lib/api/testCases", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/api/testCases")>();
  return { ...actual, getTestCaseRequirementLink: vi.fn(), linkTestCaseToRequirement: vi.fn() };
});

const mockGetEntity = vi.mocked(getEntity);
const mockListEntities = vi.mocked(listEntities);
const mockGetTestCaseRequirementLink = vi.mocked(getTestCaseRequirementLink);
const mockLinkTestCaseToRequirement = vi.mocked(linkTestCaseToRequirement);

const PROJECT_ID = "11111111-1111-1111-1111-111111111111";
const TEST_CASE_ID = "22222222-2222-2222-2222-222222222222";
const REQUIREMENT_ID = "33333333-3333-3333-3333-333333333333";

function renderPage(entity: string, id: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/projects/${PROJECT_ID}/admin/${entity}/${id}/edit`]}>
        <Routes>
          <Route path="/projects/:projectId/admin/:entity/:id/edit" element={<EntityFormPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function mockGetEntityDefault() {
  mockGetEntity.mockImplementation(async (config) => {
    const path = (config as { path: string }).path;
    if (path === "/projects") {
      return { id: PROJECT_ID, org_id: "org-1" };
    }
    if (path === "/requirements") {
      return { id: REQUIREMENT_ID, title: "Login must reject bad passwords" };
    }
    return { id: TEST_CASE_ID, title: "Standalone case", project_id: PROJECT_ID };
  });
}

describe("EntityFormPage — REQ-5 Link to Requirement section", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders the empty state + Link button for a standalone (unlinked) case", async () => {
    mockGetEntityDefault();
    mockGetTestCaseRequirementLink.mockResolvedValue({ requirement_id: null });

    renderPage("test-cases", TEST_CASE_ID);

    expect(await screen.findByTestId("test-case-requirement-link-section")).toBeInTheDocument();
    expect(await screen.findByTestId("test-case-requirement-link-empty")).toHaveTextContent(
      "This test case has no Requirement.",
    );
    expect(screen.getByTestId("test-case-link-requirement-button")).toBeInTheDocument();
  });

  it("renders the linked Requirement's own title (read-only) when already linked", async () => {
    mockGetEntityDefault();
    mockGetTestCaseRequirementLink.mockResolvedValue({ requirement_id: REQUIREMENT_ID });

    renderPage("test-cases", TEST_CASE_ID);

    const linkedField = await screen.findByLabelText("Linked Requirement");
    expect(linkedField).toBeDisabled();
    await waitFor(() => expect(linkedField).toHaveValue("Login must reject bad passwords"));
    expect(screen.queryByTestId("test-case-link-requirement-button")).not.toBeInTheDocument();
  });

  it("renders the fetch error inline without breaking the form above it", async () => {
    mockGetEntityDefault();
    mockGetTestCaseRequirementLink.mockRejectedValue(
      new ApiError("You do not have permission to perform this action.", 403, { code: "permission_denied" }),
    );

    renderPage("test-cases", TEST_CASE_ID);

    expect(await screen.findByTestId("test-case-requirement-link-error")).toBeInTheDocument();
    expect(screen.getByLabelText("Title")).toBeInTheDocument();
  });

  it("does not fetch or render the section for a non-test-case entity", async () => {
    mockGetEntity.mockResolvedValue({ id: PROJECT_ID, org_id: "org-1", name: "Checkout" });

    renderPage("projects", PROJECT_ID);

    await screen.findByLabelText("Name");
    expect(mockGetTestCaseRequirementLink).not.toHaveBeenCalled();
    expect(screen.queryByTestId("test-case-requirement-link-section")).not.toBeInTheDocument();
  });

  it("opens the modal, picks a Requirement, and submits — calling linkTestCaseToRequirement with the right ids", async () => {
    mockGetEntityDefault();
    mockGetTestCaseRequirementLink.mockResolvedValue({ requirement_id: null });
    mockListEntities.mockResolvedValue({
      items: [{ id: REQUIREMENT_ID, title: "Login must reject bad passwords" }],
      total: 1,
      page: 1,
      page_size: 25,
    });
    mockLinkTestCaseToRequirement.mockResolvedValue({
      id: TEST_CASE_ID,
      test_condition_id: null,
      project_id: PROJECT_ID,
      test_level_id: "level-1",
      test_type_id: "type-1",
      created_by_actor_id: "actor-1",
      title: "Standalone case",
      preconditions: null,
      expected_result: null,
      status: "draft",
    });

    renderPage("test-cases", TEST_CASE_ID);

    fireEvent.click(await screen.findByTestId("test-case-link-requirement-button"));

    const picker = await screen.findByLabelText("Requirement");
    fireEvent.change(picker, { target: { value: "login" } });
    await waitOutDebounce();

    fireEvent.click(await screen.findByText("Login must reject bad passwords"));

    fireEvent.click(screen.getByTestId("test-case-link-requirement-submit"));

    await waitFor(() =>
      expect(mockLinkTestCaseToRequirement).toHaveBeenCalledWith(TEST_CASE_ID, {
        requirement_id: REQUIREMENT_ID,
      }),
    );
  });

  it("surfaces a 409 already_linked_to_requirement error inline in the modal", async () => {
    mockGetEntityDefault();
    mockGetTestCaseRequirementLink.mockResolvedValue({ requirement_id: null });
    mockListEntities.mockResolvedValue({
      items: [{ id: REQUIREMENT_ID, title: "Login must reject bad passwords" }],
      total: 1,
      page: 1,
      page_size: 25,
    });
    mockLinkTestCaseToRequirement.mockRejectedValue(
      new ApiError("Test case already has a Requirement link.", 409, {
        code: "already_linked_to_requirement",
      }),
    );

    renderPage("test-cases", TEST_CASE_ID);

    fireEvent.click(await screen.findByTestId("test-case-link-requirement-button"));

    const picker = await screen.findByLabelText("Requirement");
    fireEvent.change(picker, { target: { value: "login" } });
    await waitOutDebounce();
    fireEvent.click(await screen.findByText("Login must reject bad passwords"));
    fireEvent.click(screen.getByTestId("test-case-link-requirement-submit"));

    await waitFor(() =>
      expect(screen.getByText("Test case already has a Requirement link.")).toBeInTheDocument(),
    );
  });
});
