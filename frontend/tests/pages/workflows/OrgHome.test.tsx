import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import OrgHome from "../../../src/pages/workflows/OrgHome";
import { listRoleAssignments, listRoles } from "../../../src/lib/api/roleAssignments";

/**
 * PROJ-4 (ADR-0047): `OrgHome`'s own Project-CRUD tests (New Project modal,
 * Edit/Delete modals, search/sort/pagination, TC-PROJ-019..024, the
 * unmount/remount persistence regression test) all moved verbatim to
 * `ProjectsPage.test.tsx` — the component they exercise moved too. What's
 * left here is what's left on the page itself: the "Dashboard" heading, the
 * "Members" link, and that `RoleAssignmentsPanel` still mounts (its own
 * behavior has its own dedicated test file). The two dashboard stat widgets
 * (including the Project-count widget's new `<Link>` wrapper) have their own
 * file, `OrgHome.widgets.test.tsx` — unaffected by this pass, since the
 * widgets themselves didn't move.
 */
vi.mock("../../../src/lib/api/roleAssignments", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/lib/api/roleAssignments")>();
  return {
    ...actual,
    listRoleAssignments: vi.fn(),
    listRoles: vi.fn(),
    createRoleAssignment: vi.fn(),
  };
});

vi.mock("../../../src/lib/api/dashboard", () => ({
  getProjectsTotal: vi.fn().mockResolvedValue(0),
  getActiveMemberTotal: vi.fn().mockResolvedValue(0),
}));

const mockListRoleAssignments = vi.mocked(listRoleAssignments);
const mockListRoles = vi.mocked(listRoles);

mockListRoleAssignments.mockResolvedValue({ items: [], total: 0, page: 1, page_size: 25 });
mockListRoles.mockResolvedValue([]);

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

describe("OrgHome — Dashboard (widgets + RoleAssignmentsPanel only, PROJ-4)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders the Dashboard heading and a Members link", () => {
    renderOrgHome();

    expect(screen.getByRole("heading", { name: /^dashboard$/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^members$/i })).toHaveAttribute(
      "href",
      `/orgs/${ORG_ID}/members`,
    );
  });

  it("no longer renders a Project table or a New Project action (moved to ProjectsPage, PROJ-4)", () => {
    renderOrgHome();

    expect(screen.queryByRole("button", { name: /^new project$/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/no projects yet/i)).not.toBeInTheDocument();
  });

  it("the Project-count widget links to the dedicated Projects page", () => {
    renderOrgHome();

    expect(screen.getByTestId("widget-project-count").closest("a")).toHaveAttribute(
      "href",
      `/orgs/${ORG_ID}/projects`,
    );
  });
});
