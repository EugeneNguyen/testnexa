/**
 * DASH-1 dashboard placeholder (ADR-0035, UI Design Document §3).
 *
 * The authenticated destination of the new `/` root guard
 * (`RootRedirect.tsx`). Routed at `/dashboard` and wrapped in the existing
 * `ProtectedRoute` in `App.tsx`, which gives it the `AppShell`
 * (sidebar + navbar) for free and makes a logged-out direct navigation to
 * `/dashboard` redirect to `/login` through the same mechanism every other
 * protected route already uses — no second bespoke guard.
 *
 * **Deliberately empty.** Content is explicitly out of scope for ADR-0035:
 * no stat widgets (nothing borrowed from `OrgHome`'s `CWidgetStats*`
 * pattern), no counts, no charts, and — a hard requirement, NFR-47, not a
 * stub that merely happens not to need data yet — **no `apiFetch`/`useQuery`
 * call of any kind**. A future story that gives this screen real content
 * needs its own ADR/UI-Design update, including a decision on whether it
 * becomes org-scoped (`/orgs/:orgId/dashboard`, matching `OrgHome`'s
 * convention) or stays a single global route.
 *
 * None of the deleted `LandingPage`'s marketing/pitch copy is ported here —
 * ADR-0035 removes that content from the product entirely.
 *
 * Built with CoreUI (ADR-0012), same `CContainer`/`CCard`/`CCardBody` page
 * shell every other bespoke screen uses.
 */
import { CCard, CCardBody, CCardHeader, CContainer } from "@coreui/react";

function Dashboard() {
  return (
    <CContainer fluid>
      <CCard>
        <CCardHeader>
          <h1 className="mb-0 fs-4">Dashboard</h1>
        </CCardHeader>
        <CCardBody>
          <p className="mb-0 text-body-secondary">Nothing here yet.</p>
        </CCardBody>
      </CCard>
    </CContainer>
  );
}

export default Dashboard;
