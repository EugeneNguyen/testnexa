/**
 * SHELL-1 (ADR-0018) admin shell: composes `AppSidebar` + `AppHeader` +
 * `AppBreadcrumb` + `AppFooter` + page content, replacing AUTH-3's bare
 * `<AppHeader/>{children}` mount in `ProtectedRoute`.
 *
 * ## Tabler v1.5.1 (ADR-0054, Phase 2) — what replaced the AdminLTE composition
 *
 * The whole shell is now Tabler's own `.page` flow layout (the CTO-supplied
 * "Sidebar layout" doc sample), not AdminLTE's `.app-wrapper` CSS grid:
 *
 *   <div class="page">
 *     <aside class="navbar navbar-vertical navbar-expand-lg">...</aside>  -- AppSidebar
 *     <div class="page-wrapper">
 *       <header class="navbar navbar-expand-md d-print-none">...</header>  -- AppHeader
 *       <main class="page-body">
 *         <div class="app-content-header">{AppBreadcrumb}</div>
 *         <div class="app-content flex-grow-1">{children}</div>
 *       </main>
 *       <footer class="footer footer-transparent d-print-none">...</footer>  -- AppFooter
 *     </div>
 *   </div>
 *
 * There is no named-grid-area coupling the way AdminLTE's `.app-wrapper`
 * had — `AppSidebar` and `.page-wrapper` are laid out by Tabler's own
 * `.page`/`.page-wrapper` CSS (a flex row: the vertical navbar reserves its
 * own width, `.page-wrapper` takes the rest), so DOM order among the two top
 * children matters here (aside first), unlike AdminLTE's grid where it
 * didn't. `.app-content-header`/`.app-content` are this app's own class
 * names, not Tabler's — kept from the AdminLTE era purely as stable hooks
 * for existing tests/selectors; Tabler defines no rule for them, so they are
 * plain unstyled wrapper divs now (see "page content" note below for why
 * that's fine).
 *
 * ## Sidebar state: one boolean, not AdminLTE's collapsed/open pair
 *
 * AdminLTE's `push-menu.ts` state machine (mirrored in this file pre-ADR-0054)
 * needed two independent flags plus a `matchMedia` breakpoint listener
 * because its off-canvas sidebar could be independently collapsed (desktop)
 * or opened (mobile), and `sidebar-collapse`/`sidebar-open` were body-level
 * classes with no innate breakpoint awareness of their own.
 *
 * Tabler's vertical navbar needs none of that: `.navbar-expand-lg` is a
 * standard Bootstrap navbar breakpoint rule, which **forces
 * `.navbar-collapse` visible above the breakpoint regardless of the `show`
 * class**, and hides it below the breakpoint unless `show` is present. So a
 * single `mobileOpen` boolean, toggled by the header's sidebar-toggler
 * button and passed straight down to `AppSidebar` as a prop, is the whole
 * state machine — no breakpoint listener, no responsive-logic port, no body
 * classes, no `.sidebar-overlay` scrim (Tabler's collapse pushes content
 * down in normal flow when open on mobile, it doesn't float over it, so
 * there's nothing to click outside of to dismiss).
 *
 * `sidebar-mini` (SHELL-7, ADR-0046) — the icon-only collapsed rail — has no
 * equivalent here. Retired per ADR-0054's explicit scope reduction; a future
 * story can reach for Tabler's own `navbar-folded-hover` + pin-button
 * pattern if that UX is wanted again.
 *
 * ## Page content is deliberately NOT wrapped in a container here
 *
 * Unchanged from the AdminLTE era (still load-bearing): this component does
 * not wrap `{children}` in a `container`/`container-fluid`. Each page owns
 * its own `<div className="container-fluid px-4">`. Several pages paint a
 * full-bleed `min-vh-100 bg-body-secondary` background *outside* their own
 * container — wrapping `{children}` in a container at this level would nest
 * that background inside the container's padding, shrinking the painted
 * area rather than just the content.
 *
 * `flex-grow-1` on `.app-content` preserves DASH-2's content-fills-the-column
 * behavior: `main.page-body` is `display: flex; flex-direction: column`
 * under Tabler's own CSS (same as AdminLTE's `.app-main` was), so
 * `flex-grow-1` gives the content area a *definite* height for pages that
 * size themselves with `h-100` against it.
 */
import { ReactNode, useState } from "react";
import AppBreadcrumb from "../../organisms/app-breadcrumb";
import AppFooter from "../../organisms/app-footer";
import AppHeader from "../../organisms/app-header";
import AppSidebar from "../../organisms/app-sidebar";

interface AppShellProps {
  children: ReactNode;
}

function AppShell({ children }: AppShellProps) {
  // Mobile-only: above Tabler's `.navbar-expand-lg` breakpoint, CSS forces
  // the sidebar visible regardless of this value (see this file's own
  // docstring for why AdminLTE's collapsed/open pair collapses to one flag).
  const [mobileOpen, setMobileOpen] = useState(false);

  function toggleSidebar() {
    setMobileOpen((prev) => !prev);
  }

  return (
    <div className="page">
      <AppSidebar mobileOpen={mobileOpen} />
      <div className="page-wrapper">
        <AppHeader onToggleSidebar={toggleSidebar} />
        <main className="page-body">
          <div className="app-content-header">
            <AppBreadcrumb />
          </div>
          <div className="app-content flex-grow-1">{children}</div>
        </main>
        <AppFooter />
      </div>
    </div>
  );
}

export default AppShell;
