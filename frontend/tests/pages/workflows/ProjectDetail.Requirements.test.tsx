import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import ProjectDetail from "../../../src/pages/workflows/ProjectDetail";
import type { RequirementSummary } from "../../../src/lib/api/requirements";
import { createRequirement, listRequirements } from "../../../src/lib/api/requirements";
import { listReleases } from "../../../src/lib/api/releases";

// Same partial-mock pattern as ProjectDetail.test.tsx's own Release mocks —
// `listReleases` is mocked here too (empty result) since both sections fetch
// on the same page mount; this file only asserts the Requirements section.
vi.mock("../../../src/lib/api/releases", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/lib/api/releases")>();
  return { ...actual, listReleases: vi.fn() };
});

vi.mock("../../../src/lib/api/requirements", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/lib/api/requirements")>();
  return {
    ...actual,
    createRequirement: vi.fn(),
    listRequirements: vi.fn(),
  };
});

const mockListReleases = vi.mocked(listReleases);
const mockCreateRequirement = vi.mocked(createRequirement);
const mockListRequirements = vi.mocked(listRequirements);

const PROJECT_ID = "11111111-1111-1111-1111-111111111111";

function requirement(overrides: Partial<RequirementSummary>): RequirementSummary {
  return {
    id: "requirement-id",
    project_id: PROJECT_ID,
    title: "Some requirement",
    description: "Some description",
    external_ref: null,
    source: null,
    ...overrides,
  };
}

function renderProjectDetail(projectId = PROJECT_ID) {
  return render(
    <MemoryRouter initialEntries={[`/projects/${projectId}`]}>
      <Routes>
        <Route path="/projects/:projectId" element={<ProjectDetail />} />
      </Routes>
    </MemoryRouter>,
  );
}

function openNewRequirementModal() {
  fireEvent.click(screen.getByRole("button", { name: /^new requirement$/i }));
}

describe("ProjectDetail — Requirement list + New Requirement modal (REQ-1)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders a requirement list from the mocked API layer", async () => {
    mockListReleases.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 25 });
    mockListRequirements.mockResolvedValue({
      items: [
        requirement({ id: "r1", title: "Login must rate-limit", external_ref: "JIRA-1" }),
        requirement({ id: "r2", title: "Password never logged", source: "security review" }),
      ],
      total: 2,
      page: 1,
      page_size: 25,
    });

    renderProjectDetail();

    await waitFor(() => expect(mockListRequirements).toHaveBeenCalledWith(PROJECT_ID, {}));

    expect(await screen.findByText("Login must rate-limit")).toBeInTheDocument();
    expect(screen.getByText("JIRA-1")).toBeInTheDocument();
    expect(screen.getByText("Password never logged")).toBeInTheDocument();
    expect(screen.getByText("security review")).toBeInTheDocument();
  });

  it("shows an empty state when no requirements exist", async () => {
    mockListReleases.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 25 });
    mockListRequirements.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 25 });

    renderProjectDetail();

    expect(await screen.findByText(/no requirements yet/i)).toBeInTheDocument();
  });

  it("rejects an empty title/description client-side, without calling createRequirement()", async () => {
    mockListReleases.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 25 });
    mockListRequirements.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 25 });
    renderProjectDetail();
    await waitFor(() => expect(mockListRequirements).toHaveBeenCalledTimes(1));

    openNewRequirementModal();
    expect(screen.getByRole("heading", { name: /^new requirement$/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));

    expect(await screen.findByText(/title is required/i)).toBeInTheDocument();
    expect(screen.getByText(/description is required/i)).toBeInTheDocument();
    expect(mockCreateRequirement).not.toHaveBeenCalled();
  });

  it("submits title/description/source/external_ref, closes the modal, and re-fetches the list", async () => {
    mockListReleases.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 25 });
    mockListRequirements.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 25 });
    mockCreateRequirement.mockResolvedValue(requirement({ id: "r3", title: "New requirement" }));
    renderProjectDetail();
    await waitFor(() => expect(mockListRequirements).toHaveBeenCalledTimes(1));

    openNewRequirementModal();
    fireEvent.change(screen.getByLabelText(/^title$/i), { target: { value: "New requirement" } });
    fireEvent.change(screen.getByLabelText(/^description$/i), { target: { value: "New description" } });
    fireEvent.change(screen.getByLabelText(/^source$/i), { target: { value: "stakeholder interview" } });
    fireEvent.change(screen.getByLabelText(/external ref/i), { target: { value: "JIRA-42" } });
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() =>
      expect(mockCreateRequirement).toHaveBeenCalledWith(PROJECT_ID, {
        title: "New requirement",
        description: "New description",
        source: "stakeholder interview",
        external_ref: "JIRA-42",
      }),
    );
    expect(screen.queryByRole("heading", { name: /^new requirement$/i })).not.toBeInTheDocument();
    // 1st call = initial mount, 2nd = post-create re-fetch.
    await waitFor(() => expect(mockListRequirements).toHaveBeenCalledTimes(2));
  });

  it("submits the search box's term as `q` and re-fetches", async () => {
    mockListReleases.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 25 });
    mockListRequirements.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 25 });
    renderProjectDetail();
    await waitFor(() => expect(mockListRequirements).toHaveBeenNthCalledWith(1, PROJECT_ID, {}));

    fireEvent.change(screen.getByLabelText(/search requirements/i), { target: { value: "rate-limit" } });
    fireEvent.click(screen.getByRole("button", { name: /^search$/i }));

    await waitFor(() =>
      expect(mockListRequirements).toHaveBeenNthCalledWith(2, PROJECT_ID, { q: "rate-limit" }),
    );
  });

  it("maps a 422 field_errors.title response onto the title field", async () => {
    mockListReleases.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 25 });
    mockListRequirements.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 25 });
    const { ApiError } = await import("../../../src/lib/api/client");
    mockCreateRequirement.mockRejectedValue(
      new ApiError("Request failed validation.", 422, { field_errors: { title: ["Title is required."] } }),
    );
    renderProjectDetail();
    await waitFor(() => expect(mockListRequirements).toHaveBeenCalledTimes(1));

    openNewRequirementModal();
    fireEvent.change(screen.getByLabelText(/^title$/i), { target: { value: "x" } });
    fireEvent.change(screen.getByLabelText(/^description$/i), { target: { value: "y" } });
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));

    expect(await screen.findByText("Title is required.")).toBeInTheDocument();
  });
});
