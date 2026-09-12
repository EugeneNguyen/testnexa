/**
 * Org landing page ("Dashboard"). Started as an AUTH-1 placeholder
 * (`Org: {orgId}` only); PROJ-1 (ADR-0017) extended it with a minimal
 * Project list + "New Project" modal; SHELL-3 (ADR-0020) added the two
 * dashboard stat widgets; DASH-2 (ADR-0039) relabeled it "Dashboard" and
 * turned the Project list into a full management table (Edit/Delete
 * modals, search/sort/pagination).
 *
 * **PROJ-4 (2026-09-09, [ADR-0047](../../../../docs/adr/0047-proj-4-projects-page-sidebar-entry.md), amends ADR-0039):**
 * the full Project CRUD table + its three modals move off this screen onto
 * their own dedicated page, `ProjectsPage.tsx` at `/orgs/:orgId/projects`,
 * reached via `AppSidebar`'s new "Projects" nav item. This screen keeps only
 * the two dashboard stat widgets (FR-SHELL-3) and `RoleAssignmentsPanel`
 * (RBAC-3) — no Project list, no `listProjects`/`createProject`/
 * `updateProject`/`deleteProject` calls happen here anymore. The
 * Project-count widget becomes a `<Link>` to the new Projects page (an
 * explicit, small navigation aid — see that widget's own comment) rather
 * than duplicating the table in two places.
 *
 * DASH-2's own naming-overlap note (NFR-49, unaffected by this story) still
 * applies unchanged: this page is a distinct screen from the separate,
 * unrelated global `/dashboard` placeholder (ADR-0035/DASH-1).
 *
 * **DS-3 (2026-09-08, [ADR-0045](../../../../docs/adr/0045-ds-3-infobox-widget-consolidation.md)):**
 * both count widgets render via the shared `InfoBox` component. Unchanged by
 * this pass — see that ADR/`InfoBox`'s own docstring for the migration.
 */
import { ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { getActiveMemberTotal, getProjectsTotal } from "../../../lib/api/dashboard";
import RoleAssignmentsPanel from "../../../components/RoleAssignmentsPanel";
import { InfoBox } from "../../../components";

/**
 * Renders a `useQuery` count result as a widget's `value` node — the one
 * place loading/error/success are told apart (NFR-27, TC-SHELL-011): a
 * still-in-flight or failed fetch never renders "0", only a real
 * `total: 0` response does.
 */
function widgetValue(isLoading: boolean, isError: boolean, total: number | undefined): ReactNode {
  if (isLoading) {
    return "Loading…";
  }
  if (isError || total === undefined) {
    return "Unable to load";
  }
  return total;
}

/**
 * FR-SHELL-3 Project-count widget. Its own `useQuery` against
 * `lib/api/dashboard.ts`'s `getProjectsTotal`, scoped to the current `orgId`.
 *
 * **PROJ-4:** wrapped in a `<Link>` to the new `/orgs/:orgId/projects` page
 * — the widget itself is unchanged (same query, same count-sourcing, same
 * `data-testid` on the `InfoBox` root per TC-DS-020), only its container is
 * now a link rather than a bare `<div>`.
 */
function ProjectCountWidget({ orgId }: { orgId: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["dashboard", "projects-total", orgId],
    queryFn: () => getProjectsTotal(orgId),
    // A backend error won't start succeeding on retry — TanStack Query's
    // default `retry: 3` would otherwise hold the widget in its loading
    // state for ~7s (exponential backoff) before surfacing the error.
    retry: false,
  });

  return (
    <Link to={`/orgs/${orgId}/projects`} className="text-decoration-none d-block">
      <InfoBox
        color="primary"
        text="Projects"
        number={widgetValue(isLoading, isError, data)}
        icon="fa-solid fa-folder"
        testId="widget-project-count"
      />
    </Link>
  );
}

/**
 * FR-SHELL-3 active-Org-Member-count widget. Its own `useQuery` against
 * `lib/api/dashboard.ts`'s `getActiveMemberTotal`, scoped to the current
 * `orgId`.
 */
function ActiveMemberCountWidget({ orgId }: { orgId: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["dashboard", "active-members-total", orgId],
    queryFn: () => getActiveMemberTotal(orgId),
    retry: false, // see ProjectCountWidget's own comment above
  });

  return (
    <InfoBox
      color="info"
      text="Active org members"
      number={widgetValue(isLoading, isError, data)}
      icon="fa-solid fa-users"
      testId="widget-active-member-count"
    />
  );
}

function OrgHome() {
  const { orgId } = useParams<{ orgId: string }>();

  if (!orgId) {
    return null;
  }

  return (
    <div className="min-vh-100 py-4">
      <div className="container-fluid px-4">
        <div className="row justify-content-center mb-4">
          <div className="col-md-10 col-lg-8">
            <div className="d-flex justify-content-between align-items-center mb-3">
              <h1 className="fs-4 mb-0">Dashboard</h1>
              {/*
                ADR-0042 §4.5.9: a real `<Link>` carrying the button classes,
                not a `<button>` — it must stay an `<a>` so `getByRole("link")`
                and real navigation both keep working. Kept here even though
                `AppSidebar` also links to `/orgs/:orgId/members` now — a
                pre-existing convenience affordance, unaffected by PROJ-4.
              */}
              <Link className="btn btn-outline-secondary" to={`/orgs/${orgId}/members`}>
                Members
              </Link>
            </div>
            <div className="row">
              <div className="col-sm-6">
                <ProjectCountWidget orgId={orgId} />
              </div>
              <div className="col-sm-6">
                <ActiveMemberCountWidget orgId={orgId} />
              </div>
            </div>
          </div>
        </div>
        <div className="row justify-content-center">
          <div className="col-md-10 col-lg-8">
            <RoleAssignmentsPanel orgId={orgId} />
          </div>
        </div>
      </div>
    </div>
  );
}

export default OrgHome;
