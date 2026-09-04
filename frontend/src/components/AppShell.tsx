/**
 * SHELL-1 (ADR-0018) admin shell: composes `AppSidebar` + `AppHeader` +
 * page content, replacing AUTH-3's bare `<AppHeader/>{children}` mount in
 * `ProtectedRoute`. Owns the sidebar's `visible` boolean state and passes a
 * toggle handler down to `AppHeader`'s `CHeaderToggler` — CoreUI's own
 * documented `visible`/`onVisibleChange` template pattern (`CSidebar`
 * itself already handles the mobile/desktop responsive behavior; no
 * hand-built breakpoint/media-query logic here, per ADR-0018).
 *
 * `onVisibleChange` round-tripping back into this state matters beyond just
 * the toggler: `CSidebar` forces its sidebar closed on its own whenever it
 * detects a transition into its mobile breakpoint (regardless of the
 * current `visible` prop value) — without syncing that back into this
 * state, this state would go stale (still "true" from desktop) and the
 * *next* toggler click would push the already-internally-closed mobile
 * sidebar to "false" again (a no-op) instead of opening it, a real
 * first-click-does-nothing bug on mobile that a real-browser E2E test
 * caught.
 *
 * `CSidebar`'s `onVisibleChange` is itself derived from an
 * `isInViewport(element)` geometry check (`getBoundingClientRect()` vs.
 * `window.innerHeight`/`innerWidth`), not from toggler/backdrop/ESC
 * interactions directly — so this round-trip is only safe because
 * `AppSidebar` gives `CSidebar` a `vh-100` class capping its own height at
 * the viewport height. Without that, this `d-flex` row's default
 * `align-items: stretch` lets the sidebar's rendered height grow to match
 * its (often taller) content-column sibling, `isInViewport` then reads
 * `rect.bottom > window.innerHeight` on any scrollable page and reports
 * "not visible" on first render even though nothing hid it, and wiring
 * that straight back into this state collapses the "persistent" sidebar on
 * first render of almost every real page — a second real bug, also only
 * reproducible in a real browser (Vitest/jsdom never lays out real
 * geometry, so `getBoundingClientRect()` always returns a zero rect there).
 *
 * `d-flex` on the outer wrapper is a Bootstrap/CoreUI utility class (not
 * Tailwind, per CLAUDE.md) needed so `CSidebar`'s own CSS (`order: -1` on
 * desktop) lays it out beside, not above, the header+content column — the
 * shipped `coreui.min.css` targets the real `<body>` element for this, which
 * this SPA's `#root` div sits inside rather than substitutes for.
 *
 * Built with CoreUI (ADR-0012) — no bespoke nav/layout components.
 *
 * SHELL-2 (ADR-0019) adds `AppBreadcrumb` (route-derived `CBreadcrumb`) and
 * `AppFooter` (`CFooter`), completing the free-template shell shape —
 * breadcrumb sits between the header and page content, footer sits below
 * it, both inside the same `flex-column` content column as the header so
 * they scroll with the page rather than pin to the sidebar's own height.
 */
import { ReactNode, useState } from "react";
import AppBreadcrumb from "./AppBreadcrumb";
import AppFooter from "./AppFooter";
import AppHeader from "./AppHeader";
import AppSidebar from "./AppSidebar";

interface AppShellProps {
  children: ReactNode;
}

function AppShell({ children }: AppShellProps) {
  const [sidebarVisible, setSidebarVisible] = useState(true);

  function toggleSidebar() {
    setSidebarVisible((prev) => !prev);
  }

  return (
    <div className="d-flex">
      <AppSidebar visible={sidebarVisible} onVisibleChange={setSidebarVisible} />
      <div className="d-flex flex-column flex-grow-1 min-vh-100">
        <AppHeader onToggleSidebar={toggleSidebar} />
        <AppBreadcrumb />
        <div className="flex-grow-1">{children}</div>
        <AppFooter />
      </div>
    </div>
  );
}

export default AppShell;
