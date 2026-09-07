/**
 * DASH-1 root guard (ADR-0035). `/` is not a screen — it's a pure
 * `accessToken`-gated redirect, evaluated in this order:
 *
 * 1. `isInitializing` (boot-time silent refresh still in flight) -> spinner.
 *    Checked first, unconditionally — an `accessToken` already present must
 *    not short-circuit this, since `AuthContext`'s boot effect can still be
 *    settling `isInitializing` even when a token is already in the store.
 * 2. No `accessToken` -> `/login`.
 * 3. `accessToken` present -> `/dashboard`.
 *
 * **Deliberately never reads `orgContext`/`orgs`.** The superseded LANDING-1
 * version of this guard (ADR-0024) branched on `orgContext` to send an
 * authenticated visitor to `/orgs/{id}` or `/orgs/pick` — but `orgContext`/
 * `orgs` are only ever populated by `login()`/`signup()`/`acceptInvite()`'s
 * own response bodies, never by the boot-time silent refresh (`POST
 * /auth/refresh` returns `{access_token}` only, see `AuthContext.tsx`'s own
 * docstring). So a visitor with a perfectly valid session cookie who reloaded
 * `/` had `accessToken` restored but `orgContext`/`orgs` stuck at
 * `null`/`[]`, and fell through to the public landing page — indistinguishable
 * from being logged out. Routing to the empty `/dashboard` placeholder
 * instead needs no org resolution at all, which is what makes dropping the
 * `orgContext` dependency here a real fix rather than a workaround (see
 * ADR-0035's Context/Decision sections).
 *
 * `Login.tsx`/`Signup.tsx`/`AcceptInvite.tsx`'s own separate post-auth
 * `orgContext`/`orgs` redirect (to `/orgs/{id}` or `/orgs/pick`, run
 * immediately after an explicit login/signup/accept-invite) is untouched —
 * this guard only governs a direct/reloaded hit on `/`.
 */
import { Navigate } from "react-router-dom";
import AuthLoadingSpinner from "../../components/AuthLoadingSpinner";
import { useAuth } from "../../auth/AuthContext";

function RootRedirect() {
  const { isInitializing, accessToken } = useAuth();

  if (isInitializing) {
    return <AuthLoadingSpinner />;
  }

  if (!accessToken) {
    return <Navigate to="/login" replace />;
  }

  return <Navigate to="/dashboard" replace />;
}

export default RootRedirect;
