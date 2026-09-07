import { Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import ProtectedRoute from "./auth/ProtectedRoute";
import AcceptInvite from "./pages/workflows/AcceptInvite";
import Dashboard from "./pages/workflows/Dashboard";
import Login from "./pages/workflows/Login";
import OrgHome from "./pages/workflows/OrgHome";
import OrgMembers from "./pages/workflows/OrgMembers";
import OrgPicker from "./pages/workflows/OrgPicker";
import ProjectDetail from "./pages/workflows/ProjectDetail";
import RootRedirect from "./pages/workflows/RootRedirect";
import Signup from "./pages/workflows/Signup";
import TestCycleDetail from "./pages/workflows/TestCycleDetail";
import TestPlanDetail from "./pages/workflows/TestPlanDetail";
import Colors from "./pages/ui-elements/Colors";
import Icons from "./pages/ui-elements/Icons";
import Typography from "./pages/ui-elements/Typography";
import EntityFormPage from "./pages/admin/EntityFormPage";
import EntityListPage from "./pages/admin/EntityListPage";

function App() {
  return (
    <AuthProvider>
      <Routes>
        {/*
          DASH-1 (ADR-0035): `/` is a pure auth-state redirect, not a screen.
          It supersedes LANDING-1's public `LandingPage` (ADR-0024), which is
          deleted outright — no marketing/pitch page exists anywhere in the
          product now, by explicit decision. Logged out -> `/login`, logged in
          -> `/dashboard`, boot refresh still in flight -> a spinner. The guard
          reads `accessToken` only, never `orgContext`/`orgs`; see
          `RootRedirect.tsx`'s docstring for why that is the fix, not a
          shortcut.
        */}
        <Route path="/" element={<RootRedirect />} />
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
        {/*
          DASH-1 (ADR-0035) dashboard placeholder — the authenticated
          destination of the root guard above. Deliberately empty this pass;
          `ProtectedRoute`-wrapped like every other authenticated screen, which
          is also what makes a logged-out direct hit on `/dashboard` redirect
          to `/login` without a second bespoke guard.
        */}
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <Dashboard />
            </ProtectedRoute>
          }
        />
        {/*
          RBAC-2 (ADR-0017) public accept-invite route: the invitee has no
          account/credentials yet (new-email invite path), so this must sit
          outside ProtectedRoute — matching the backend's own
          `POST /invites/{token}/accept` being public, token-gated, not
          `Authorization`-gated.
        */}
        <Route path="/invites/:token/accept" element={<AcceptInvite />} />
        <Route
          path="/orgs/pick"
          element={
            <ProtectedRoute>
              <OrgPicker />
            </ProtectedRoute>
          }
        />
        <Route
          path="/orgs/:orgId"
          element={
            <ProtectedRoute>
              <OrgHome />
            </ProtectedRoute>
          }
        />
        {/*
          RBAC-2 org member management: authenticated (ProtectedRoute) — see
          `OrgMembers.tsx`'s own docstring for why org_admin-gating happens
          by attempting `GET /orgs/{org_id}/members` and rendering its
          403/404 rather than a pre-emptive client-side role check (no such
          signal exists anywhere in `AuthContext`/`GET /auth/me` yet).
        */}
        <Route
          path="/orgs/:orgId/members"
          element={
            <ProtectedRoute>
              <OrgMembers />
            </ProtectedRoute>
          }
        />
        <Route
          path="/projects/:projectId"
          element={
            <ProtectedRoute>
              <ProjectDetail />
            </ProtectedRoute>
          }
        />
        {/*
          PLAN-1 (ADR-0031, UI Design Document §1): a `TestPlan`'s own detail
          route — deliberately its own URL rather than another `ProjectDetail`
          expand-in-place section, since PLAN-2's entry/exit criteria and
          PLAN-3's TestCycle view are known, imminent extensions of this same
          object. PLAN-2 (ADR-0032) has since landed on this same route, as
          predicted; PLAN-3's TestCycle *creation* landed here too, and EXEC-1
          (ADR-0034) has now given the cycle itself its own nested route
          below (see the next Route). Sits above
          the generic `/projects/:projectId/admin/:entity`
          routes below only for readability — react-router ranks the static
          `test-plans` segment over the `:entity` param either way.
        */}
        <Route
          path="/projects/:projectId/test-plans/:testPlanId"
          element={
            <ProtectedRoute>
              <TestPlanDetail />
            </ProtectedRoute>
          }
        />
        {/*
          EXEC-1 (ADR-0034, UI Design Document §1): the sitemap's reserved
          `TestExecutionRunner` path, partially resolved (FR-EXEC-1 only —
          FR-EXEC-2's TestLog timeline and FR-EXEC-3's defect flow stay
          reserved). Nested under the TestPlan route above for the same reason
          that one is nested under the project: a TestCycle's execution history
          plus its live pass/fail dashboard is enough surface to need its own
          addressable URL rather than an expand-in-place section of
          `TestPlanDetail`, whose "Test Cycles" rows now link here.
        */}
        <Route
          path="/projects/:projectId/test-plans/:testPlanId/test-cycles/:testCycleId"
          element={
            <ProtectedRoute>
              <TestCycleDetail />
            </ProtectedRoute>
          }
        />
        {/*
          SHELL-2/3/4 (ADR-0020) "UI Elements" reference pages — template-parity
          scaffolding only, no FR/NFR/story backs these three routes (see
          `AppSidebar.tsx`'s and each page's own docstring). Org-scoped
          (`/orgs/:orgId/ui-elements/*`) to match the sidebar nav group's own
          `orgId`-gated visibility, same posture as the org-home/members
          routes above.
        */}
        <Route
          path="/orgs/:orgId/ui-elements/colors"
          element={
            <ProtectedRoute>
              <Colors />
            </ProtectedRoute>
          }
        />
        <Route
          path="/orgs/:orgId/ui-elements/typography"
          element={
            <ProtectedRoute>
              <Typography />
            </ProtectedRoute>
          }
        />
        <Route
          path="/orgs/:orgId/ui-elements/icons"
          element={
            <ProtectedRoute>
              <Icons />
            </ProtectedRoute>
          }
        />
        {/*
          ADR-0025 generic admin CRUD surface: 2 page components
          (`EntityListPage`/`EntityFormPage`), routed generically off the
          `:entity` param — the registry (`pages/admin/registry.ts`) maps it
          to an `EntityConfig`, not 28 separate route declarations here. See
          the Sitemap's own "generic admin CRUD surface" table for the full
          28-entity list these 4 routes serve (8 org/global-scoped, 20
          project-scoped).
        */}
        <Route
          path="/orgs/:orgId/admin/:entity"
          element={
            <ProtectedRoute>
              <EntityListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/orgs/:orgId/admin/:entity/:id/edit"
          element={
            <ProtectedRoute>
              <EntityFormPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/projects/:projectId/admin/:entity"
          element={
            <ProtectedRoute>
              <EntityListPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/projects/:projectId/admin/:entity/:id/edit"
          element={
            <ProtectedRoute>
              <EntityFormPage />
            </ProtectedRoute>
          }
        />
      </Routes>
    </AuthProvider>
  );
}

export default App;
