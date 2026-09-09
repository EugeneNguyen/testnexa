import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import AppBreadcrumb from "./app-breadcrumb";
import { allEntities } from "../../pages/admin/registry";

/**
 * SHELL-2 (ADR-0020) breadcrumb unit tests, TC-SHELL-007/008 and
 * TC-SHELL-016/017/018/019 (the 2026-09-07 coverage correction).
 *
 * Same per-route-pattern render approach as `AppSidebar.test.tsx`: mount
 * `AppBreadcrumb` as a `Route`'s element so `useLocation()`/`matchPath`
 * resolve against the same path patterns a real `ProtectedRoute` screen
 * would use.
 */
function renderBreadcrumb(initialEntry: string) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/orgs/pick" element={<AppBreadcrumb />} />
        <Route path="/orgs/:orgId" element={<AppBreadcrumb />} />
        <Route path="/orgs/:orgId/projects" element={<AppBreadcrumb />} />
        <Route path="/orgs/:orgId/members" element={<AppBreadcrumb />} />
        <Route path="/orgs/:orgId/ui-elements/colors" element={<AppBreadcrumb />} />
        <Route path="/orgs/:orgId/admin/:entity" element={<AppBreadcrumb />} />
        <Route path="/orgs/:orgId/admin/:entity/:id/edit" element={<AppBreadcrumb />} />
        <Route path="/projects/:projectId" element={<AppBreadcrumb />} />
        <Route path="/projects/:projectId/test-plans/:testPlanId" element={<AppBreadcrumb />} />
        <Route
          path="/projects/:projectId/test-plans/:testPlanId/test-cycles/:testCycleId"
          element={<AppBreadcrumb />}
        />
        <Route path="/projects/:projectId/admin/:entity" element={<AppBreadcrumb />} />
        <Route path="/projects/:projectId/admin/:entity/:id/edit" element={<AppBreadcrumb />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("AppBreadcrumb", () => {
  it("TC-SHELL-007: resolves known route segments on /orgs/:orgId/members", () => {
    renderBreadcrumb("/orgs/org-1/members");

    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    expect(screen.getByText("Members")).toBeInTheDocument();
    // The active (final) segment is plain text, not a link — only the
    // earlier "Dashboard" segment is clickable.
    expect(screen.getByText("Dashboard").closest("a")).toHaveAttribute("href", "/orgs/org-1");
    expect(screen.getByText("Members").closest("a")).toBeNull();
  });

  it("renders a single, non-linked segment on /orgs/:orgId", () => {
    renderBreadcrumb("/orgs/org-1");

    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    expect(screen.getByText("Dashboard").closest("a")).toBeNull();
  });

  it("PROJ-4: resolves Dashboard -> Projects on /orgs/:orgId/projects, Dashboard linked", () => {
    renderBreadcrumb("/orgs/org-1/projects");

    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    expect(screen.getByText("Dashboard").closest("a")).toHaveAttribute("href", "/orgs/org-1");
    expect(screen.getByText("Projects")).toBeInTheDocument();
    expect(screen.getByText("Projects").closest("a")).toBeNull();
  });

  it("resolves a nested UI-elements route with 3 segments", () => {
    renderBreadcrumb("/orgs/org-1/ui-elements/colors");

    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    expect(screen.getByText("UI Elements")).toBeInTheDocument();
    expect(screen.getByText("Colors")).toBeInTheDocument();
  });

  it("TC-SHELL-008: degrades gracefully on an unmapped/root route (/orgs/pick) — renders nothing, no raw param or undefined fragment", () => {
    const { container } = renderBreadcrumb("/orgs/pick");

    expect(container.querySelector(".breadcrumb")).not.toBeInTheDocument();
    expect(screen.queryByText("undefined")).not.toBeInTheDocument();
    expect(screen.queryByText("pick")).not.toBeInTheDocument();
  });

  it("TC-SHELL-016: renders a single unlinked crumb on /projects/:projectId, no Dashboard ancestor", () => {
    renderBreadcrumb("/projects/proj-1");

    expect(screen.getByText("Project")).toBeInTheDocument();
    expect(screen.getByText("Project").closest("a")).toBeNull();
    // The TC's own title says "no Dashboard ancestor" — the route carries no
    // `orgId` param to link back with, so the trail must be exactly one crumb.
    expect(screen.queryByText("Dashboard")).not.toBeInTheDocument();
  });

  it("TC-SHELL-017: resolves the TestPlan/TestCycle chain nested under Project, not Dashboard", () => {
    renderBreadcrumb("/projects/proj-1/test-plans/plan-1/test-cycles/cycle-1");

    expect(screen.getByText("Project")).toBeInTheDocument();
    expect(screen.getByText("Project").closest("a")).toHaveAttribute("href", "/projects/proj-1");
    expect(screen.getByText("Test Plan")).toBeInTheDocument();
    expect(screen.getByText("Test Plan").closest("a")).toHaveAttribute(
      "href",
      "/projects/proj-1/test-plans/plan-1",
    );
    expect(screen.getByText("Test Cycle")).toBeInTheDocument();
    expect(screen.getByText("Test Cycle").closest("a")).toBeNull();
    expect(screen.queryByText("Dashboard")).not.toBeInTheDocument();
  });

  it("TC-SHELL-018: resolves an org-scoped admin list route's entity label from the registry", () => {
    renderBreadcrumb("/orgs/org-1/admin/roles");

    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    // The TC says "Dashboard" links — assert the href, not just its presence.
    expect(screen.getByText("Dashboard").closest("a")).toHaveAttribute("href", "/orgs/org-1");
    // "Roles" is the registry's own label for the `roles` key, not a
    // hardcoded string in this component.
    expect(allEntities.find((e) => e.key === "roles")?.label).toBe("Roles");
    expect(screen.getByText("Roles")).toBeInTheDocument();
    expect(screen.getByText("Roles").closest("a")).toBeNull();
  });

  it("TC-SHELL-019: resolves a project-scoped admin edit route as Project -> entity label -> Edit", () => {
    renderBreadcrumb("/projects/proj-1/admin/test-cases/tc-1/edit");

    expect(screen.getByText("Project")).toBeInTheDocument();
    expect(screen.getByText("Project").closest("a")).toHaveAttribute("href", "/projects/proj-1");
    expect(screen.getByText("Test cases")).toBeInTheDocument();
    expect(screen.getByText("Test cases").closest("a")).toHaveAttribute(
      "href",
      "/projects/proj-1/admin/test-cases",
    );
    expect(screen.getByText("Edit")).toBeInTheDocument();
    expect(screen.getByText("Edit").closest("a")).toBeNull();
  });
});
