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
 *
 * `h-100` on both `CContainer` and `CCard` (2026-09-07): without it, this
 * screen's near-empty content ("Nothing here yet.") only occupies the
 * height its own text needs, leaving a large unfilled grey gap below the
 * card down to `AppFooter` — confirmed empirically (`.flex-grow-1`, the
 * `AppShell` content column, is a real flexed 795px in a 900px-tall
 * viewport; the un-stretched `container-fluid`/`card` were only ~104px).
 * `AppShell.tsx`'s own `flex-grow-1` on that content column already
 * resolves to a definite height (a real flex-computed box, not `auto`), so
 * `h-100`'s percentage chain resolves correctly down through both levels —
 * verified against a live render, not assumed from source alone.
 */
import { CCard, CCardBody, CCardHeader, CContainer } from "@coreui/react";

function Dashboard() {
  return (
    <CContainer fluid className="h-100">
      <CCard className="h-100">
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
