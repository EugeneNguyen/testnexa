import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import RoleAssignmentsPanel from "../../src/components/RoleAssignmentsPanel";
import { ApiError } from "../../src/lib/api/client";
import { createRoleAssignment, listRoleAssignments, listRoles } from "../../src/lib/api/roleAssignments";

// Same partial-mock pattern as OrgHome.test.tsx/Signup.test.tsx.
vi.mock("../../src/lib/api/roleAssignments", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/lib/api/roleAssignments")>();
  return {
    ...actual,
    listRoleAssignments: vi.fn(),
    listRoles: vi.fn(),
    createRoleAssignment: vi.fn(),
  };
});

const mockListRoleAssignments = vi.mocked(listRoleAssignments);
const mockListRoles = vi.mocked(listRoles);
const mockCreateRoleAssignment = vi.mocked(createRoleAssignment);

const ORG_ID = "11111111-1111-1111-1111-111111111111";
const ROLE_ORG_ADMIN = "22222222-2222-2222-2222-222222222222";
const ROLE_TESTER = "33333333-3333-3333-3333-333333333333";
const ACTOR_ID = "44444444-4444-4444-4444-444444444444";
const PROJECT_ID = "55555555-5555-5555-5555-555555555555";

function openModal() {
  fireEvent.click(screen.getByRole("button", { name: /^new role assignment$/i }));
}

describe("RoleAssignmentsPanel", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("shows a loading state, then an empty state when there are no assignments", async () => {
    mockListRoleAssignments.mockResolvedValue([]);
    mockListRoles.mockResolvedValue([]);

    render(<RoleAssignmentsPanel orgId={ORG_ID} />);

    expect(await screen.findByText(/no role assignments yet/i)).toBeInTheDocument();
  });

  it("renders existing assignments with their role name and scope resolved", async () => {
    mockListRoles.mockResolvedValue([
      { id: ROLE_ORG_ADMIN, name: "org_admin", is_system_role: true },
      { id: ROLE_TESTER, name: "tester", is_system_role: true },
    ]);
    mockListRoleAssignments.mockResolvedValue([
      {
        id: "aa-1",
        actor_id: ACTOR_ID,
        org_id: ORG_ID,
        project_id: null,
        role_id: ROLE_ORG_ADMIN,
        created_at: "2026-09-03T00:00:00Z",
      },
      {
        id: "aa-2",
        actor_id: ACTOR_ID,
        org_id: ORG_ID,
        project_id: PROJECT_ID,
        role_id: ROLE_TESTER,
        created_at: "2026-09-03T00:00:00Z",
      },
    ]);

    render(<RoleAssignmentsPanel orgId={ORG_ID} />);

    expect(await screen.findByText("org_admin")).toBeInTheDocument();
    expect(screen.getByText("tester")).toBeInTheDocument();
    expect(screen.getByText("Org-wide")).toBeInTheDocument();
    expect(screen.getByText(`Project ${PROJECT_ID}`)).toBeInTheDocument();
  });

  it("opens the modal with a role dropdown populated from listRoles()", async () => {
    mockListRoleAssignments.mockResolvedValue([]);
    mockListRoles.mockResolvedValue([{ id: ROLE_ORG_ADMIN, name: "org_admin", is_system_role: true }]);

    render(<RoleAssignmentsPanel orgId={ORG_ID} />);
    await screen.findByText(/no role assignments yet/i);
    openModal();

    expect(screen.getByRole("heading", { name: /^new role assignment$/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/^actor id$/i)).toBeInTheDocument();
    const roleOption = screen.getByRole("option", { name: "org_admin" });
    expect(roleOption).toBeInTheDocument();
  });

  it("rejects a malformed actor id client-side, without calling createRoleAssignment()", async () => {
    mockListRoleAssignments.mockResolvedValue([]);
    mockListRoles.mockResolvedValue([{ id: ROLE_ORG_ADMIN, name: "org_admin", is_system_role: true }]);

    render(<RoleAssignmentsPanel orgId={ORG_ID} />);
    await screen.findByText(/no role assignments yet/i);
    openModal();

    fireEvent.change(screen.getByLabelText(/^actor id$/i), { target: { value: "not-a-uuid" } });
    fireEvent.change(screen.getByLabelText(/^role$/i), { target: { value: ROLE_ORG_ADMIN } });
    fireEvent.click(screen.getByRole("button", { name: /^grant$/i }));

    expect(await screen.findByText(/valid actor id/i)).toBeInTheDocument();
    expect(mockCreateRoleAssignment).not.toHaveBeenCalled();
  });

  it("submits an org-wide grant (project_id omitted) and adds it to the list", async () => {
    mockListRoleAssignments.mockResolvedValue([]);
    mockListRoles.mockResolvedValue([{ id: ROLE_ORG_ADMIN, name: "org_admin", is_system_role: true }]);
    mockCreateRoleAssignment.mockResolvedValue({
      id: "aa-1",
      actor_id: ACTOR_ID,
      org_id: ORG_ID,
      project_id: null,
      role_id: ROLE_ORG_ADMIN,
      created_at: "2026-09-03T00:00:00Z",
    });

    render(<RoleAssignmentsPanel orgId={ORG_ID} />);
    await screen.findByText(/no role assignments yet/i);
    openModal();

    fireEvent.change(screen.getByLabelText(/^actor id$/i), { target: { value: ACTOR_ID } });
    fireEvent.change(screen.getByLabelText(/^role$/i), { target: { value: ROLE_ORG_ADMIN } });
    fireEvent.click(screen.getByRole("button", { name: /^grant$/i }));

    await waitFor(() => expect(mockCreateRoleAssignment).toHaveBeenCalledTimes(1));
    expect(mockCreateRoleAssignment).toHaveBeenCalledWith(ORG_ID, {
      actor_id: ACTOR_ID,
      role_id: ROLE_ORG_ADMIN,
    });

    expect(await screen.findByText("Org-wide")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /^new role assignment$/i })).not.toBeInTheDocument();
  });

  it("submits a project-scoped grant when scope is switched, including project_id", async () => {
    mockListRoleAssignments.mockResolvedValue([]);
    mockListRoles.mockResolvedValue([{ id: ROLE_TESTER, name: "tester", is_system_role: true }]);
    mockCreateRoleAssignment.mockResolvedValue({
      id: "aa-2",
      actor_id: ACTOR_ID,
      org_id: ORG_ID,
      project_id: PROJECT_ID,
      role_id: ROLE_TESTER,
      created_at: "2026-09-03T00:00:00Z",
    });

    render(<RoleAssignmentsPanel orgId={ORG_ID} />);
    await screen.findByText(/no role assignments yet/i);
    openModal();

    fireEvent.change(screen.getByLabelText(/^actor id$/i), { target: { value: ACTOR_ID } });
    fireEvent.change(screen.getByLabelText(/^role$/i), { target: { value: ROLE_TESTER } });
    fireEvent.change(screen.getByLabelText(/^scope$/i), { target: { value: "project-scoped" } });
    fireEvent.change(await screen.findByLabelText(/^project id$/i), { target: { value: PROJECT_ID } });
    fireEvent.click(screen.getByRole("button", { name: /^grant$/i }));

    await waitFor(() => expect(mockCreateRoleAssignment).toHaveBeenCalledTimes(1));
    expect(mockCreateRoleAssignment).toHaveBeenCalledWith(ORG_ID, {
      actor_id: ACTOR_ID,
      role_id: ROLE_TESTER,
      project_id: PROJECT_ID,
    });

    expect(await screen.findByText(`Project ${PROJECT_ID}`)).toBeInTheDocument();
  });

  it("shows a 422 field_errors.actor_id inline on the actor id field, keeping the modal open", async () => {
    mockListRoleAssignments.mockResolvedValue([]);
    mockListRoles.mockResolvedValue([{ id: ROLE_ORG_ADMIN, name: "org_admin", is_system_role: true }]);
    mockCreateRoleAssignment.mockRejectedValue(
      new ApiError("Request failed validation.", 422, {
        code: "validation_error",
        message: "Request failed validation.",
        field_errors: { actor_id: ["This actor is not a member of this organization."] },
      }),
    );

    render(<RoleAssignmentsPanel orgId={ORG_ID} />);
    await screen.findByText(/no role assignments yet/i);
    openModal();

    fireEvent.change(screen.getByLabelText(/^actor id$/i), { target: { value: ACTOR_ID } });
    fireEvent.change(screen.getByLabelText(/^role$/i), { target: { value: ROLE_ORG_ADMIN } });
    fireEvent.click(screen.getByRole("button", { name: /^grant$/i }));

    expect(await screen.findByText(/not a member of this organization/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /^new role assignment$/i })).toBeInTheDocument();
  });

  it("shows a non-field ApiError (e.g. 403 permission_denied) inline as an alert", async () => {
    mockListRoleAssignments.mockResolvedValue([]);
    mockListRoles.mockResolvedValue([{ id: ROLE_ORG_ADMIN, name: "org_admin", is_system_role: true }]);
    mockCreateRoleAssignment.mockRejectedValue(
      new ApiError("You do not have permission to perform this action.", 403, {
        code: "permission_denied",
        message: "You do not have permission to perform this action.",
        field_errors: null,
      }),
    );

    render(<RoleAssignmentsPanel orgId={ORG_ID} />);
    await screen.findByText(/no role assignments yet/i);
    openModal();

    fireEvent.change(screen.getByLabelText(/^actor id$/i), { target: { value: ACTOR_ID } });
    fireEvent.change(screen.getByLabelText(/^role$/i), { target: { value: ROLE_ORG_ADMIN } });
    fireEvent.click(screen.getByRole("button", { name: /^grant$/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/do not have permission/i);
  });

  it("shows a load error inline as an alert when the initial fetch fails", async () => {
    mockListRoleAssignments.mockRejectedValue(new ApiError("Organization not found.", 404));
    mockListRoles.mockResolvedValue([]);

    render(<RoleAssignmentsPanel orgId={ORG_ID} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(/organization not found/i);
  });
});
