/**
 * SHELL-2 (ADR-0020) app footer, mounted once inside `AppShell` alongside
 * `AppBreadcrumb` so both join `AppSidebar`/`AppHeader` in completing the
 * free-template shell shape (FR-SHELL-2). Renders identically on every
 * `ProtectedRoute` screen (TC-SHELL-009) — smoke-level, static content only,
 * no per-route/dynamic behavior to branch on.
 *
 * Built with CoreUI (ADR-0012) — `CFooter` only.
 */
import { CFooter } from "@coreui/react";

function AppFooter() {
  return (
    <CFooter>
      <div>TestNexa</div>
      <div className="ms-auto">Self-hosted, ISTQB/IEEE 829-aligned test management</div>
    </CFooter>
  );
}

export default AppFooter;
