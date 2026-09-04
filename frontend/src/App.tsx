import { useQuery } from "@tanstack/react-query";
import { Route, Routes } from "react-router-dom";
import { CCard, CCardBody, CCol, CContainer, CRow } from "@coreui/react";
import { AuthProvider } from "./auth/AuthContext";
import ProtectedRoute from "./auth/ProtectedRoute";
import { apiFetch } from "./lib/api/client";
import AcceptInvite from "./pages/workflows/AcceptInvite";
import Login from "./pages/workflows/Login";
import OrgHome from "./pages/workflows/OrgHome";
import OrgMembers from "./pages/workflows/OrgMembers";
import OrgPicker from "./pages/workflows/OrgPicker";
import Signup from "./pages/workflows/Signup";
import Colors from "./pages/ui-elements/Colors";
import Icons from "./pages/ui-elements/Icons";
import Typography from "./pages/ui-elements/Typography";

interface HealthResponse {
  status: string;
}

/**
 * Scaffold-verification page only. Proves frontend<->backend wiring by
 * calling the backend health endpoint. Not a real feature screen — bespoke
 * workflow screens, generic CRUD, and auth flow are deferred to a later task.
 * Built with CoreUI (ADR-0012).
 */
function ScaffoldVerificationPage() {
  const { data, isLoading, isError, error } = useQuery<HealthResponse>({
    queryKey: ["health"],
    queryFn: () => apiFetch<HealthResponse>("/api/health"),
  });

  return (
    <div className="min-vh-100 d-flex align-items-center bg-body-secondary">
      <CContainer>
        <CRow className="justify-content-center">
          <CCol md={6} lg={4}>
            <CCard>
              <CCardBody className="p-4">
                <h1 className="mb-3 fs-4">TestNexa Scaffold</h1>
                {isLoading && <p data-testid="health-status">Checking backend...</p>}
                {isError && (
                  <p data-testid="health-status" className="text-danger">
                    Backend: error ({error instanceof Error ? error.message : "unknown error"})
                  </p>
                )}
                {data && (
                  <p data-testid="health-status" className="text-success">
                    Backend: {data.status === "ok" ? "ok" : data.status}
                  </p>
                )}
              </CCardBody>
            </CCard>
          </CCol>
        </CRow>
      </CContainer>
    </div>
  );
}

function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/" element={<ScaffoldVerificationPage />} />
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
        {/*
          SHELL-8 (ADR-0019) "UI Elements" reference pages — template-parity
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
