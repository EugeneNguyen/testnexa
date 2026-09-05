import { Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import ProtectedRoute from "./auth/ProtectedRoute";
import AcceptInvite from "./pages/workflows/AcceptInvite";
import LandingPage from "./pages/workflows/LandingPage";
import Login from "./pages/workflows/Login";
import OrgHome from "./pages/workflows/OrgHome";
import OrgMembers from "./pages/workflows/OrgMembers";
import OrgPicker from "./pages/workflows/OrgPicker";
import ProjectDetail from "./pages/workflows/ProjectDetail";
import Signup from "./pages/workflows/Signup";
import Colors from "./pages/ui-elements/Colors";
import Icons from "./pages/ui-elements/Icons";
import Typography from "./pages/ui-elements/Typography";

function App() {
  return (
    <AuthProvider>
      <Routes>
        {/*
          LANDING-1 (ADR-0024) public landing page: replaces the deleted
          scaffold-verification health-check widget that used to sit at `/`.
          Public route, same tier as `/login`/`/signup` — see
          `LandingPage.tsx`'s own docstring.
        */}
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<Login />} />
        <Route path="/signup" element={<Signup />} />
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
      </Routes>
    </AuthProvider>
  );
}

export default App;
