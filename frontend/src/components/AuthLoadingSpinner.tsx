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
 * `CSpinner` renders `role="status"`, which is what both guards' tests assert
 * on; the wrapper's full-viewport centering classes are CoreUI/Bootstrap
 * utilities (ADR-0012), carried over verbatim so the visual result is
 * unchanged from what `ProtectedRoute` shipped.
 */
import { CSpinner } from "@coreui/react";

function AuthLoadingSpinner() {
  return (
    <div className="min-vh-100 d-flex align-items-center justify-content-center">
      <CSpinner color="primary" />
    </div>
  );
}

export default AuthLoadingSpinner;
