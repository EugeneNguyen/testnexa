import { useQuery } from "@tanstack/react-query";
import { Route, Routes } from "react-router-dom";
import { CCard, CCardBody, CCol, CContainer, CRow } from "@coreui/react";
import { AuthProvider } from "./auth/AuthContext";
import ProtectedRoute from "./auth/ProtectedRoute";
import { apiFetch } from "./lib/api/client";
import Login from "./pages/workflows/Login";
import OrgHome from "./pages/workflows/OrgHome";
import OrgPicker from "./pages/workflows/OrgPicker";

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
      </Routes>
    </AuthProvider>
  );
}

export default App;
