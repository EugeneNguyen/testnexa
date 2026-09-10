/**
 * SHELL-2 (ADR-0020) app footer, mounted once inside `AppShell` alongside
 * `AppBreadcrumb` so both join `AppSidebar`/`AppHeader` in completing the
 * free-template shell shape (FR-SHELL-2). Renders identically on every
 * `ProtectedRoute` screen (TC-SHELL-009) — smoke-level, static content only,
 * no per-route/dynamic behavior to branch on.
 *
 * ## Tabler v1.5.1 (ADR-0054, Phase 2) — what changed from AdminLTE v4
 *
 * `.app-footer` → `footer.footer.footer-transparent.d-print-none`, Tabler's
 * own footer markup (the CTO-supplied page-layout doc's "Footer" section).
 * `footer-transparent` drops the footer's own background so it blends with
 * the page, matching this component's pre-existing plain (no `bg-*`) look.
 * The two static text pieces render as `list-inline list-inline-dots`
 * groups — Tabler's own convention for this element — instead of two bare
 * `<div>`s with `ms-auto` pushing the second one right; `row
 * text-center align-items-center flex-row-reverse` reproduces that
 * push-right layout without a manual utility class doing it.
 */
function AppFooter() {
  return (
    <footer className="footer footer-transparent d-print-none">
      <div className="container-fluid">
        <div className="row text-center align-items-center flex-row-reverse">
          <div className="col-lg-auto ms-lg-auto">
            <ul className="list-inline list-inline-dots mb-0">
              <li className="list-inline-item">Self-hosted, ISTQB/IEEE 829-aligned test management</li>
            </ul>
          </div>
          <div className="col-12 col-lg-auto mt-3 mt-lg-0">
            <ul className="list-inline list-inline-dots mb-0">
              <li className="list-inline-item">TestNexa</li>
            </ul>
          </div>
        </div>
      </div>
    </footer>
  );
}

export default AppFooter;
