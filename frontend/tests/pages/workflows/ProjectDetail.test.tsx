import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import ProjectDetail from "../../../src/pages/workflows/ProjectDetail";
import type { ReleaseSummary } from "../../../src/lib/api/releases";
import { createRelease, listReleases } from "../../../src/lib/api/releases";

// Same partial-mock pattern as OrgHome.test.tsx/Signup.test.tsx: keep the
// real module shape, replace only the network-calling exports with
// `vi.fn()`s so `ProjectDetail`'s release list/"New Release" modal can be
// driven without a real network call.
vi.mock("../../../src/lib/api/releases", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/lib/api/releases")>();
  return {
    ...actual,
    createRelease: vi.fn(),
    listReleases: vi.fn(),
    getReleaseTestCycles: vi.fn(),
  };
});

const mockCreateRelease = vi.mocked(createRelease);
const mockListReleases = vi.mocked(listReleases);

const PROJECT_ID = "11111111-1111-1111-1111-111111111111";

function release(overrides: Partial<ReleaseSummary>): ReleaseSummary {
  return {
    id: "release-id",
    project_id: PROJECT_ID,
    version_label: "v1.0.0",
    target_date: null,
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

function openNewReleaseModal() {
  fireEvent.click(screen.getByRole("button", { name: /^new release$/i }));
}

describe("ProjectDetail — release list + New Release modal", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders a sorted release list from the mocked API layer", async () => {
    mockListReleases.mockResolvedValue({
      items: [
        release({ id: "r1", version_label: "v1.0.0", target_date: "2026-01-01" }),
        release({ id: "r2", version_label: "v1.1.0", target_date: "2026-02-01" }),
      ],
      total: 2,
      page: 1,
      page_size: 25,
    });

    renderProjectDetail();

    await waitFor(() =>
      expect(mockListReleases).toHaveBeenCalledWith(PROJECT_ID, { sort: "target_date", order: "asc" }),
    );

    const rows = await screen.findAllByRole("row");
    // rows[0] is the header row.
    expect(within(rows[1]).getByText("v1.0.0")).toBeInTheDocument();
    expect(within(rows[1]).getByText("2026-01-01")).toBeInTheDocument();
    expect(within(rows[2]).getByText("v1.1.0")).toBeInTheDocument();
    expect(within(rows[2]).getByText("2026-02-01")).toBeInTheDocument();
  });

  it("rejects an empty version_label client-side, without calling createRelease()", async () => {
    mockListReleases.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 25 });
    renderProjectDetail();
    await waitFor(() => expect(mockListReleases).toHaveBeenCalledTimes(1));

    openNewReleaseModal();
    expect(screen.getByRole("heading", { name: /^new release$/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));

    expect(await screen.findByText(/version label is required/i)).toBeInTheDocument();
    expect(mockCreateRelease).not.toHaveBeenCalled();
  });

  it("submits version_label/target_date, closes the modal, and re-fetches the list", async () => {
    mockListReleases.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 25 });
    mockCreateRelease.mockResolvedValue(
      release({ id: "r3", version_label: "v2.0.0", target_date: "2026-03-01" }),
    );
    renderProjectDetail();
    await waitFor(() => expect(mockListReleases).toHaveBeenCalledTimes(1));

    openNewReleaseModal();
    fireEvent.change(screen.getByLabelText(/version label/i), { target: { value: "v2.0.0" } });
    fireEvent.change(screen.getByLabelText(/target date/i), { target: { value: "2026-03-01" } });
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() =>
      expect(mockCreateRelease).toHaveBeenCalledWith(PROJECT_ID, {
        version_label: "v2.0.0",
        target_date: "2026-03-01",
      }),
    );
    expect(screen.queryByRole("heading", { name: /^new release$/i })).not.toBeInTheDocument();
    // Modal submit success re-fetches the list (2nd call = initial mount, 3rd = post-create).
    await waitFor(() => expect(mockListReleases).toHaveBeenCalledTimes(2));
  });

  it("re-invokes listReleases with the toggled order when the sort header is clicked", async () => {
    mockListReleases.mockResolvedValue({
      items: [release({ id: "r1", version_label: "v1.0.0", target_date: "2026-01-01" })],
      total: 1,
      page: 1,
      page_size: 25,
    });

    renderProjectDetail();

    await waitFor(() =>
      expect(mockListReleases).toHaveBeenNthCalledWith(1, PROJECT_ID, { sort: "target_date", order: "asc" }),
    );

    fireEvent.click(screen.getByRole("button", { name: /target date/i }));

    await waitFor(() =>
      expect(mockListReleases).toHaveBeenNthCalledWith(2, PROJECT_ID, { sort: "target_date", order: "desc" }),
    );
  });
});
