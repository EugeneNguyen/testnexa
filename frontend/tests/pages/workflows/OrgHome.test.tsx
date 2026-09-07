import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import OrgHome from "../../../src/pages/workflows/OrgHome";
import { ApiError } from "../../../src/lib/api/client";
import { createProject, listProjects, updateProject } from "../../../src/lib/api/projects";
import { listRoleAssignments, listRoles } from "../../../src/lib/api/roleAssignments";

// Same partial-mock pattern as Signup.test.tsx: keep the real module shape,
// replace only `createProject`/`updateProject`/`listProjects` with `vi.fn()`s
// so the "New Project" modal / inline edit / initial list fetch can all be
// driven without a real network call. `listProjects` defaults to an empty
// list below (every existing test in this file starts from "no projects yet"
// and adds one via `createProject`'s own optimistic cache write, per
// `OrgHome.tsx`'s docstring) — the fix's own dedicated persistence test
// further down overrides this per-test.
vi.mock("../../../src/lib/api/projects", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/lib/api/projects")>();
  return {
    ...actual,
    createProject: vi.fn(),
    updateProject: vi.fn(),
    listProjects: vi.fn(),
  };
});

// `RoleAssignmentsPanel` (RBAC-3) mounts unconditionally inside `OrgHome` and
// fetches on mount — mocked here to an empty, resolved list so this file's
// own Project-focused tests stay deterministic and don't make a real network
// call. `RoleAssignmentsPanel`'s own behavior has its own dedicated test
// file (`RoleAssignmentsPanel.test.tsx`).
vi.mock("../../../src/lib/api/roleAssignments", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/lib/api/roleAssignments")>();
  return {
    ...actual,
    listRoleAssignments: vi.fn(),
    listRoles: vi.fn(),
    createRoleAssignment: vi.fn(),
  };
});

// SHELL-3 (ADR-0020): `OrgHome` now also mounts the two dashboard stat
// widgets, each its own `useQuery` against `lib/api/dashboard.ts`. Mocked
// here to a resolved value for every test in *this* file, since none of them
// are about the widgets themselves (that's `OrgHome.widgets.test.tsx`,
// TC-SHELL-010/011) — an unmocked call would 404 in jsdom (no real backend)
// and leave the widgets permanently in their loading/error state, which is
// irrelevant noise for the New-Project-modal tests below.
vi.mock("../../../src/lib/api/dashboard", () => ({
  getProjectsTotal: vi.fn().mockResolvedValue(0),
  getActiveMemberTotal: vi.fn().mockResolvedValue(0),
}));

const mockCreateProject = vi.mocked(createProject);
const mockUpdateProject = vi.mocked(updateProject);
const mockListProjects = vi.mocked(listProjects);
const mockListRoleAssignments = vi.mocked(listRoleAssignments);
const mockListRoles = vi.mocked(listRoles);

mockListRoleAssignments.mockResolvedValue([]);
mockListRoles.mockResolvedValue([]);
mockListProjects.mockResolvedValue([]);

const ORG_ID = "11111111-1111-1111-1111-111111111111";

function renderOrgHome(orgId = ORG_ID) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[`/orgs/${orgId}`]}>
        <Routes>
          <Route path="/orgs/:orgId" element={<OrgHome />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function openNewProjectModal() {
  fireEvent.click(screen.getByRole("button", { name: /^new project$/i }));
}

describe("OrgHome — New Project modal", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders the org page with a New Project action and no projects initially", async () => {
    renderOrgHome();

    expect(screen.getByText(`Org: ${ORG_ID}`)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^new project$/i })).toBeInTheDocument();
    // `listProjects` resolves asynchronously (a real fetch, mocked to `[]`) —
    // the empty state only renders once that settles, not synchronously.
    expect(await screen.findByText(/no projects yet/i)).toBeInTheDocument();
  });

  it("opens the modal with name and standards profile fields", () => {
    renderOrgHome();
    openNewProjectModal();

    expect(screen.getByRole("heading", { name: /^new project$/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/^name$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/standards profile/i)).toBeInTheDocument();
  });

  it("rejects an empty name client-side, without calling createProject()", async () => {
    renderOrgHome();
    openNewProjectModal();

    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));

    expect(await screen.findByText(/name is required/i)).toBeInTheDocument();
    expect(mockCreateProject).not.toHaveBeenCalled();
  });

  it("submits with standards_profile omitted when left blank, adds the result to the list, and closes the modal", async () => {
    mockCreateProject.mockResolvedValue({
      id: "proj-1",
      org_id: ORG_ID,
      name: "Checkout Revamp",
      standards_profile: null,
    });
    renderOrgHome();
    openNewProjectModal();

    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: "Checkout Revamp" } });
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() => expect(mockCreateProject).toHaveBeenCalledTimes(1));
    expect(mockCreateProject).toHaveBeenCalledWith(ORG_ID, { name: "Checkout Revamp" });

    expect(await screen.findByText("Checkout Revamp")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /^new project$/i })).not.toBeInTheDocument();
  });

  it("submits with standards_profile included when filled in", async () => {
    mockCreateProject.mockResolvedValue({
      id: "proj-2",
      org_id: ORG_ID,
      name: "Payments Migration",
      standards_profile: "ISO-29119",
    });
    renderOrgHome();
    openNewProjectModal();

    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: "Payments Migration" } });
    fireEvent.change(screen.getByLabelText(/standards profile/i), { target: { value: "ISO-29119" } });
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() => expect(mockCreateProject).toHaveBeenCalledTimes(1));
    expect(mockCreateProject).toHaveBeenCalledWith(ORG_ID, {
      name: "Payments Migration",
      standards_profile: "ISO-29119",
    });

    expect(await screen.findByText("Payments Migration")).toBeInTheDocument();
    expect(await screen.findByText("ISO-29119")).toBeInTheDocument();
  });

  it("shows a 422 field_errors.name collision inline on the name field, keeping the modal open", async () => {
    mockCreateProject.mockRejectedValue(
      new ApiError("Validation failed.", 422, {
        code: "validation_error",
        message: "Validation failed.",
        field_errors: { name: "A project with this name already exists in this organization." },
      }),
    );
    renderOrgHome();
    openNewProjectModal();

    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: "Duplicate" } });
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));

    expect(await screen.findByText(/already exists in this organization/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /^new project$/i })).toBeInTheDocument();
  });

  it("shows a non-field ApiError (e.g. 403 permission_denied) inline as an alert", async () => {
    mockCreateProject.mockRejectedValue(
      new ApiError("You do not have permission to create a project in this organization.", 403, {
        code: "permission_denied",
        message: "You do not have permission to create a project in this organization.",
        field_errors: null,
      }),
    );
    renderOrgHome();
    openNewProjectModal();

    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: "New Project X" } });
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/do not have permission/i);
  });

  it("supports inline standards_profile edit on a listed project via updateProject()", async () => {
    mockCreateProject.mockResolvedValue({
      id: "proj-3",
      org_id: ORG_ID,
      name: "Mobile App",
      standards_profile: null,
    });
    mockUpdateProject.mockResolvedValue({
      id: "proj-3",
      org_id: ORG_ID,
      name: "Mobile App",
      standards_profile: "IEEE-829",
    });

    renderOrgHome();
    openNewProjectModal();
    fireEvent.change(screen.getByLabelText(/^name$/i), { target: { value: "Mobile App" } });
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));
    await screen.findByText("Mobile App");

    fireEvent.click(screen.getByRole("button", { name: /^edit$/i }));
    fireEvent.change(screen.getByLabelText(/standards profile for mobile app/i), {
      target: { value: "IEEE-829" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(mockUpdateProject).toHaveBeenCalledWith("proj-3", { standards_profile: "IEEE-829" }));
    expect(await screen.findByText("IEEE-829")).toBeInTheDocument();
  });
});

describe("OrgHome — project list persists across a remount (bug fix, 2026-09-07)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Reproduces the reported bug directly: create a project, then unmount
   * `OrgHome` (navigating into a project's detail page and back does exactly
   * this — it's a route change, not a page reload) and remount it. Before
   * this fix, the list was local `useState` with no fetch on mount, so a
   * remount always started from an empty list even though the project still
   * existed server-side. `listProjects` is mocked to actually return the
   * project on the second mount, proving the list is now sourced from a real
   * fetch, not carried over via component state that a remount would reset.
   */
  it("re-fetches and shows an existing project after the component unmounts and remounts", async () => {
    mockListProjects.mockResolvedValueOnce([
      { id: "proj-9", org_id: ORG_ID, name: "Persisted Project", standards_profile: null },
    ]);

    const { unmount } = renderOrgHome();
    expect(await screen.findByText("Persisted Project")).toBeInTheDocument();

    unmount();
    mockListProjects.mockResolvedValueOnce([
      { id: "proj-9", org_id: ORG_ID, name: "Persisted Project", standards_profile: null },
    ]);
    renderOrgHome();

    expect(await screen.findByText("Persisted Project")).toBeInTheDocument();
    expect(mockListProjects).toHaveBeenCalledTimes(2);
  });

  it("shows a loading state, then an error alert, on a failed fetch — never a false empty list", async () => {
    mockListProjects.mockRejectedValueOnce(new ApiError("Server error.", 500, null));

    renderOrgHome();

    expect(screen.getByText(/loading projects/i)).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent(/unable to load projects/i);
    expect(screen.queryByText(/no projects yet/i)).not.toBeInTheDocument();
  });
});
