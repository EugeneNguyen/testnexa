/**
 * SHELL-2 (ADR-0020) app footer, mounted once inside `AppShell` alongside
 * `AppBreadcrumb` so both join `AppSidebar`/`AppHeader` in completing the
 * free-template shell shape (FR-SHELL-2). Renders identically on every
 * `ProtectedRoute` screen (TC-SHELL-009) — smoke-level, static content only,
 * no per-route/dynamic behavior to branch on.
 *
 * Raw HTML per ADR-0037, not `@coreui/react` — `CFooter` rendered a single
 * `<div class="footer">` with no other behavior, so that was a direct,
 * lossless port: same markup, confirmed by dumping `CFooter`'s actual
 * rendered DOM before removing the import.
 *
 * AdminLTE v4 (ADR-0042): `.footer` → **`.app-footer`**, and the element is a
 * `<footer>` because it is now one of the four named areas of `AppShell`'s
 * `.app-wrapper` CSS grid (`grid-area: lte-app-footer`) — it must stay a
 * *direct* child of `.app-wrapper` or the grid placement breaks. AdminLTE's
 * own `.app-footer` rule supplies padding/border/background but not
 * `display: flex` (its demo positions the right-hand slot with `float-end`),
 * so `d-flex` is added here to keep the existing `ms-auto` push working —
 * the same two-slot layout this footer has always rendered, expressed with
 * Bootstrap's flex utilities rather than a float.
 */
function AppFooter() {
  return (
    <footer className="app-footer d-flex">
      <div>TestNexa</div>
      <div className="ms-auto">Self-hosted, ISTQB/IEEE 829-aligned test management</div>
    </footer>
  );
}

export default AppFooter;
