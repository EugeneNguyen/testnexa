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
 * AUTH-3: once authenticated, renders `<AppHeader />` above `children` so
 * every protected page gets the navbar (brand + "Log out" button) for free
 * without wiring its own (scope plan §1/§4.3).
 */
import { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { CSpinner } from "@coreui/react";
import AppHeader from "../components/AppHeader";
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

  return (
    <>
      <AppHeader />
      {children}
    </>
  );
}

export default ProtectedRoute;
