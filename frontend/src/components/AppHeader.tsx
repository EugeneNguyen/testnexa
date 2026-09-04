/**
 * AUTH-3 app header, mounted once inside `AppShell` (via `ProtectedRoute`)
 * so every current and future protected page gets it for free without
 * wiring its own button (scope plan §1/§4.3). Brand label + sidebar
 * toggler + "Log out" button — no breadcrumbs or user-menu dropdown
 * (explicitly out-of-scope, see the AUTH-3 scope plan §1).
 *
 * SHELL-1 (ADR-0018) adds the `CHeaderToggler`: calls the `onToggleSidebar`
 * handler `AppShell` owns and passes down, flipping `AppSidebar`'s `visible`
 * state via CoreUI's own documented template pattern — no hand-built
 * breakpoint/media-query logic here.
 *
 * Built with CoreUI (ADR-0012) — `CHeader`/`CHeaderBrand`/`CHeaderToggler`/
 * `CContainer`/`CButton`/`CIcon` only, no hand-rolled nav markup, no
 * Tailwind classes.
 *
 * Clicking "Log out" calls `useAuth().logout()` (clears the token store +
 * org state, best-effort revokes the server-side refresh token — see
 * `AuthContext.tsx`/ADR-0014) and then navigates to `/login` via React
 * Router, matching `ProtectedRoute`'s client-side `<Navigate>` style rather
 * than `apiFetch`'s hard `window.location.assign` redirect (scope plan §1).
 */
import { useNavigate } from "react-router-dom";
import { CButton, CContainer, CHeader, CHeaderBrand, CHeaderToggler } from "@coreui/react";
import { CIcon } from "@coreui/icons-react";
import { cilMenu } from "@coreui/icons";
import { useAuth } from "../auth/AuthContext";

interface AppHeaderProps {
  onToggleSidebar: () => void;
}

function AppHeader({ onToggleSidebar }: AppHeaderProps) {
  const { logout } = useAuth();
  const navigate = useNavigate();

  async function handleLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  return (
    <CHeader>
      <CContainer fluid className="d-flex justify-content-between align-items-center">
        <div className="d-flex align-items-center">
          <CHeaderToggler data-testid="sidebar-toggler" onClick={onToggleSidebar}>
            <CIcon icon={cilMenu} size="lg" />
          </CHeaderToggler>
          <CHeaderBrand>TestNexa</CHeaderBrand>
        </div>
        <CButton color="secondary" variant="outline" data-testid="logout-button" onClick={handleLogout}>
          Log out
        </CButton>
      </CContainer>
    </CHeader>
  );
}

export default AppHeader;
