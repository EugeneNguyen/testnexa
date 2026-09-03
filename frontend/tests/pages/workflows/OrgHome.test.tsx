import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import OrgHome from "../../../src/pages/workflows/OrgHome";
import { ApiError } from "../../../src/lib/api/client";
import { createProject, updateProject } from "../../../src/lib/api/projects";

// Same partial-mock pattern as Signup.test.tsx: keep the real module shape,
// replace only `createProject`/`updateProject` with `vi.fn()`s so the "New
// Project" modal / inline edit can be driven without a real network call.
vi.mock("../../../src/lib/api/projects", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/lib/api/projects")>();
  return {
    ...actual,
    createProject: vi.fn(),
    updateProject: vi.fn(),
  };
});

const mockCreateProject = vi.mocked(createProject);
const mockUpdateProject = vi.mocked(updateProject);

const ORG_ID = "11111111-1111-1111-1111-111111111111";

function renderOrgHome(orgId = ORG_ID) {
  return render(
    <MemoryRouter initialEntries={[`/orgs/${orgId}`]}>
      <Routes>
        <Route path="/orgs/:orgId" element={<OrgHome />} />
      </Routes>
    </MemoryRouter>,
  );
}

function openNewProjectModal() {
  fireEvent.click(screen.getByRole("button", { name: /^new project$/i }));
}

describe("OrgHome — New Project modal", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders the org page with a New Project action and no projects initially", () => {
    renderOrgHome();

    expect(screen.getByText(`Org: ${ORG_ID}`)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^new project$/i })).toBeInTheDocument();
    expect(screen.getByText(/no projects yet/i)).toBeInTheDocument();
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
