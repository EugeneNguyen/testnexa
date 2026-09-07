/**
 * SHELL-2 (ADR-0020) app footer, mounted once inside `AppShell` alongside
 * `AppBreadcrumb` so both join `AppSidebar`/`AppHeader` in completing the
 * free-template shell shape (FR-SHELL-2). Renders identically on every
 * `ProtectedRoute` screen (TC-SHELL-009) — smoke-level, static content only,
 * no per-route/dynamic behavior to branch on.
 *
 * Raw HTML per ADR-0036, not `@coreui/react` — `CFooter` rendered a single
 * `<div class="footer">` with no other behavior, so this is a direct,
 * lossless port: same markup, same CSS (`@coreui/coreui`, unchanged),
 * confirmed by dumping `CFooter`'s actual rendered DOM before removing the
 * import.
 */
function AppFooter() {
  return (
    <div className="footer">
      <div>TestNexa</div>
      <div className="ms-auto">Self-hosted, ISTQB/IEEE 829-aligned test management</div>
    </div>
  );
}

export default AppFooter;
