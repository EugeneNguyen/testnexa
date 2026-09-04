/**
 * AUTH-2 route guard.
 *
 * While `AuthContext`'s boot-time silent refresh is still in flight
 * (`isInitializing === true`), renders a loading spinner instead of
 * `children` — this is what guarantees no protected page (and therefore no
 * `apiFetch` call it might make) can mount before the boot refresh has had
 * its chance to populate the token store, avoiding a race against it (see
 * `AuthContext.tsx`'s docstring for the full rationale).
 *
 * Once settled: renders `children` if an access token is present, otherwise
 * redirects to `/login` via React Router's `<Navigate>` — a client-side
 * transition, distinct from and unrelated to `apiFetch`'s own reactive
 * 401-interceptor redirect, which uses a hard `window.location.assign`
 * (full page reload). Do not conflate the two mechanisms.
 *
 * AUTH-3 originally rendered a bare `<AppHeader />` above `children`; SHELL-1
 * (ADR-0018) replaces that with `<AppShell>{children}</AppShell>`, which
 * wraps `children` in the persistent sidebar+navbar shell instead (still
 * mounting `AppHeader`, now alongside `AppSidebar`) so every protected page
 * gets a working way back to org home for free without wiring its own.
 */
import { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { CSpinner } from "@coreui/react";
import AppShell from "../components/AppShell";
import { useAuth } from "./AuthContext";

interface ProtectedRouteProps {
  children: ReactNode;
}

function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { isInitializing, accessToken } = useAuth();

  if (isInitializing) {
    return (
      <div className="min-vh-100 d-flex align-items-center justify-content-center">
        <CSpinner color="primary" />
      </div>
    );
  }

  if (!accessToken) {
    return <Navigate to="/login" replace />;
  }

  return <AppShell>{children}</AppShell>;
}

export default ProtectedRoute;
