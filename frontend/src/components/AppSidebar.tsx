/**
 * SHELL-1 (ADR-0018) persistent sidebar, mounted once inside `AppShell` so
 * every `ProtectedRoute` screen gets it for free. Owns exactly one nav-item
 * list — org-home, org-members today — the single, obvious place a future
 * story adds its own entry (AC5); do not scatter per-page `CButton as={Link}`
 * back-links the way `OrgHome.tsx:193-195`'s pre-existing pattern does.
 *
 * `orgId` comes from `useParams<{orgId?: string}>()`, not a required route
 * param: on `/orgs/pick` (`OrgPicker`, no org selected yet) there is no
 * `orgId` to link org-scoped items to, so the nav-item list is empty rather
 * than a disabled/greyed pair (ADR-0018) — a disabled control implies a
 * temporarily-unavailable action, which isn't the case here.
 *
 * Active-route highlighting is React Router's own `NavLink` default
 * className behavior (an "active" class appended when the route matches),
 * not a bespoke `useLocation` comparison. The org-home item passes `end` so
 * it does NOT read "active" while on `/orgs/:orgId/members`: without `end`,
 * NavLink treats any location starting with the org-home `to` as a match,
 * and `/orgs/:orgId/members` does start with `/orgs/:orgId` — exactly the
 * prefix-match regression this story calls out. The members item doesn't
 * need `end` since nothing is nested under it today.
 *
 * Built with CoreUI (ADR-0012) — `CSidebar`/`CSidebarHeader`/
 * `CSidebarBrand`/`CSidebarNav`/`CNavItem`/`CNavLink` only.
 *
 * `colorScheme="dark"` is `CSidebar`'s own built-in prop (renders its
 * documented `sidebar-dark` class, shipped in the already-imported
 * `coreui.min.css`) — matches the CoreUI free-demo look with zero bespoke
 * CSS, per this story's ask.
 *
 * `visible`/`onVisibleChange` round-trip to `AppShell`'s state (CoreUI's own
 * documented two-way template pattern — see that file's docstring for why
 * this is safe here specifically because of the `vh-100` class below).
 * `vh-100` (Bootstrap/CoreUI utility, not hand-built logic) caps the
 * sidebar's own height at exactly the viewport height regardless of how
 * tall its `d-flex` row sibling (the header+content column) is — without
 * it, `CSidebar`'s default `align-items: stretch` behavior lets the
 * sidebar's rendered height grow to match a taller content column, which
 * breaks `CSidebar`'s own internal `isInViewport` geometry check (see
 * `AppShell.tsx`'s docstring).
 *
 * SHELL-8 (ADR-0020) adds a "UI Elements" `CNavGroup` (Colors/Typography/
 * Icons) below the flat org nav-item list — template-parity scaffolding
 * only, **not backed by any FR/NFR or user story** (see that ADR and the
 * three reference pages' own docstrings). Gated on `orgId` the same way the
 * flat list above is (absent entirely on `/orgs/pick`, not disabled
 * controls) for the same reasoning: there is no org context to link into.
 */
import { NavLink, useParams } from "react-router-dom";
import {
  CNavGroup,
  CNavItem,
  CNavLink,
  CSidebar,
  CSidebarBrand,
  CSidebarHeader,
  CSidebarNav,
} from "@coreui/react";

interface AppSidebarProps {
  visible: boolean;
  onVisibleChange: (visible: boolean) => void;
}

interface SidebarNavItem {
  key: string;
  label: string;
  to: string;
  end: boolean;
  testId: string;
}

function AppSidebar({ visible, onVisibleChange }: AppSidebarProps) {
  const { orgId } = useParams<{ orgId?: string }>();

  // The single, obvious extension point (ADR-0018 AC5): a future story adds
  // its own screen's nav entry here, and nowhere else.
  const navItems: SidebarNavItem[] = orgId
    ? [
        {
          key: "org-home",
          label: "Org home",
          to: `/orgs/${orgId}`,
          end: true,
          testId: "sidebar-nav-org-home",
        },
        {
          key: "org-members",
          label: "Members",
          to: `/orgs/${orgId}/members`,
          end: false,
          testId: "sidebar-nav-org-members",
        },
      ]
    : [];

  return (
    <CSidebar visible={visible} onVisibleChange={onVisibleChange} className="vh-100" colorScheme="dark">
      <CSidebarHeader>
        <CSidebarBrand>TestNexa</CSidebarBrand>
      </CSidebarHeader>
      <CSidebarNav>
        {navItems.map((item) => (
          <CNavItem key={item.key}>
            <CNavLink as={NavLink} to={item.to} end={item.end} data-testid={item.testId}>
              {item.label}
            </CNavLink>
          </CNavItem>
        ))}
        {orgId && (
          <CNavGroup toggler="UI Elements" data-testid="sidebar-nav-group-ui-elements">
            <CNavItem>
              <CNavLink as={NavLink} to={`/orgs/${orgId}/ui-elements/colors`} data-testid="sidebar-nav-ui-colors">
                Colors
              </CNavLink>
            </CNavItem>
            <CNavItem>
              <CNavLink
                as={NavLink}
                to={`/orgs/${orgId}/ui-elements/typography`}
                data-testid="sidebar-nav-ui-typography"
              >
                Typography
              </CNavLink>
            </CNavItem>
            <CNavItem>
              <CNavLink as={NavLink} to={`/orgs/${orgId}/ui-elements/icons`} data-testid="sidebar-nav-ui-icons">
                Icons
              </CNavLink>
            </CNavItem>
          </CNavGroup>
        )}
      </CSidebarNav>
    </CSidebar>
  );
}

export default AppSidebar;
