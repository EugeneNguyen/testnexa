/**
 * Shared boot-time loading indicator for auth-gated route decisions.
 *
 * Extracted by DASH-1 (ADR-0035) from `ProtectedRoute.tsx`, whose
 * `isInitializing` branch was previously the only place this markup existed.
 * The new root guard (`RootRedirect.tsx`) needs the *identical* indicator for
 * the *identical* reason — neither route may commit to a redirect until
 * `AuthContext`'s boot-time silent refresh has settled — and DASH-1's UI
 * Design Document §2 explicitly asks for reuse rather than a second
 * copy-pasted implementation. Hence one component, two callers.
 *
 * Raw Bootstrap 5 markup per ADR-0042 (AdminLTE v4 design system), replacing
 * `@coreui/react`'s `CSpinner`. **`role="status"` is written explicitly here
 * and must stay**: `CSpinner` applied that role implicitly, and it is exactly
 * what both guards' tests assert on (`ProtectedRoute.test.tsx`,
 * `RootRedirect.test.tsx` — three `getByRole("status")` lookups). A bare
 * `<div className="spinner-border">` without it silently breaks all three.
 * The `visually-hidden` label gives the status region an accessible name;
 * `CSpinner` had none, so this is a small a11y improvement, not a port
 * artifact.
 *
 * The wrapper's full-viewport centering classes are Bootstrap utilities,
 * carried over verbatim so the visual result is unchanged.
 */
function AuthLoadingSpinner() {
  return (
    <div className="min-vh-100 d-flex align-items-center justify-content-center">
      <div className="spinner-border text-primary" role="status">
        <span className="visually-hidden">Loading…</span>
      </div>
    </div>
  );
}

export default AuthLoadingSpinner;
