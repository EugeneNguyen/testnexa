/**
 * AUTH-3 app header, mounted once inside `ProtectedRoute` so every current
 * and future protected page gets it for free without wiring its own button
 * (scope plan §1/§4.3). Minimal by design: brand label + "Log out" button
 * only — no sidebar, breadcrumbs, or user-menu dropdown (explicitly
 * out-of-scope, see the AUTH-3 scope plan §1).
 *
 * Built with CoreUI (ADR-0012) — `CHeader`/`CHeaderBrand`/`CContainer`/
 * `CButton` only, no hand-rolled nav markup, no Tailwind classes.
 *
 * Clicking "Log out" calls `useAuth().logout()` (clears the token store +
 * org state, best-effort revokes the server-side refresh token — see
 * `AuthContext.tsx`/ADR-0014) and then navigates to `/login` via React
 * Router, matching `ProtectedRoute`'s client-side `<Navigate>` style rather
 * than `apiFetch`'s hard `window.location.assign` redirect (scope plan §1).
 */
import { useNavigate } from "react-router-dom";
import { CButton, CContainer, CHeader, CHeaderBrand } from "@coreui/react";
import { useAuth } from "../auth/AuthContext";

function AppHeader() {
  const { logout } = useAuth();
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  return (
    <CHeader>
      <CContainer fluid className="d-flex justify-content-between align-items-center">
        <CHeaderBrand>TestNexa</CHeaderBrand>
        <CButton color="secondary" variant="outline" data-testid="logout-button" onClick={handleLogout}>
          Log out
        </CButton>
      </CContainer>
    </CHeader>
  );
}

export default AppHeader;
