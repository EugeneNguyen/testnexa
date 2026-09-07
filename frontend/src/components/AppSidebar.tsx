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
 * `colorScheme="dark"` (formerly `CSidebar`'s own prop) is now the literal
 * `sidebar-dark` class, shipped in the already-imported `coreui.min.css` —
 * matches the CoreUI free-demo look with zero bespoke CSS, per this story's
 * ask.
 *
 * `visible`/`onVisibleChange` still round-trip to `AppShell`'s state (see
 * that file's docstring) — `vh-100` (Bootstrap/CoreUI utility, not
 * hand-built logic) caps the sidebar's own height at exactly the viewport
 * height regardless of how tall its `d-flex` row sibling (the
 * header+content column) is.
 *
 * SHELL-8 (ADR-0020) adds a "UI Elements" nav group (Colors/Typography/
 * Icons) below the flat org nav-item list — template-parity scaffolding
 * only, **not backed by any FR/NFR or user story** (see that ADR and the
 * three reference pages' own docstrings). Gated on `orgId` the same way the
 * flat list above is (absent entirely on `/orgs/pick`, not disabled
 * controls) for the same reasoning: there is no org context to link into.
 *
 * Raw HTML per ADR-0037 (2026-09-07), not `@coreui/react`. Every class name
 * below (`sidebar`, `sidebar-dark`, `sidebar-header`, `sidebar-brand`,
 * `sidebar-nav`, `nav-item`, `nav-link`, `nav-group`, `nav-group-toggle`,
 * `nav-group-items`) is the exact class `CSidebar`/`CSidebarHeader`/
 * `CSidebarBrand`/`CSidebarNav`/`CNavItem`/`CNavLink`/`CNavGroup` rendered —
 * confirmed by dumping their actual DOM output before removing the import,
 * not guessed at. The sidebar's own show/hide (`visible` prop) becomes a
 * plain `hide` class, applied when `visible` is false, matching `CSidebar`'s
 * own rendered class exactly.
 *
 * Two accepted, explicitly-documented gaps against `CSidebar`'s original
 * behavior (both flagged in ADR-0037, not silently dropped):
 * - `CSidebar`'s `isInViewport`-geometry-based auto-collapse on a mobile
 *   breakpoint transition is NOT reproduced — this component only handles
 *   the manual toggle (`AppShell`'s toggler button), which is what
 *   TC-SHELL-004 actually tests.
 * - The "UI Elements"/"Admin" nav-group expand/collapse (`CNavGroup`
 *   internally height-animates via a resize measurement) is hand-rolled
 *   here as a plain `useState<Set<string>>` of open group keys, toggling a
 *   `show` class — CoreUI's own CSS still drives the visual transition, but
 *   there is no JS-measured smooth height animation the way `CNavGroup`'s
 *   original implementation had. Purely cosmetic (open/closed state and
 *   the resulting reachable links are identical either way), not something
 *   any existing TC or test asserts on.
 */
import { useEffect, useRef, useState } from "react";
import { NavLink, useParams } from "react-router-dom";
import { orgScopedEntities } from "../pages/admin/registry";

/**
 * Mirrors `CSidebar`'s own `isOnMobile` check byte-for-byte: read the
 * `--cui-is-mobile` CSS custom property (set to `true` by `coreui.min.css`
 * itself, `@media (max-width: 991.98px) { .sidebar { --cui-is-mobile: true } }`
 * — not a hand-picked breakpoint number of our own) off the sidebar element's
 * own computed style. TC-SHELL-004 (narrow-viewport toggle) needs this: below
 * that breakpoint the CSS keeps `.sidebar` permanently off-canvas unless it
 * also has a `show` class — `hide`'s mere absence (this component's desktop
 * behavior) isn't enough on mobile.
 */
function useIsMobileSidebar(ref: React.RefObject<HTMLDivElement | null>) {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    function check() {
      if (ref.current) {
        setIsMobile(Boolean(getComputedStyle(ref.current).getPropertyValue("--cui-is-mobile")));
      }
    }
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, [ref]);

  return isMobile;
}

interface AppSidebarProps {
  visible: boolean;
  /**
   * Vestigial: `CSidebar`'s own geometry-check auto-collapse (the one thing
   * that called this) isn't reproduced (see docstring) — kept in the prop
   * signature only so `AppShell` and existing tests don't need editing just
   * to stop passing it.
   */
  onVisibleChange: (visible: boolean) => void;
}

interface SidebarNavItem {
  key: string;
  label: string;
  to: string;
  end: boolean;
  testId: string;
}

interface SidebarNavGroup {
  key: string;
  label: string;
  testId: string;
  items: { to: string; label: string; testId: string }[];
}

function AppSidebar({ visible }: AppSidebarProps) {
  const { orgId } = useParams<{ orgId?: string }>();
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  const sidebarRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobileSidebar(sidebarRef);

  function toggleGroup(key: string) {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

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

  const navGroups: SidebarNavGroup[] = orgId
    ? [
        {
          key: "ui-elements",
          label: "UI Elements",
          testId: "sidebar-nav-group-ui-elements",
          items: [
            { to: `/orgs/${orgId}/ui-elements/colors`, label: "Colors", testId: "sidebar-nav-ui-colors" },
            {
              to: `/orgs/${orgId}/ui-elements/typography`,
              label: "Typography",
              testId: "sidebar-nav-ui-typography",
            },
            { to: `/orgs/${orgId}/ui-elements/icons`, label: "Icons", testId: "sidebar-nav-ui-icons" },
          ],
        },
        {
          key: "admin",
          label: "Admin",
          testId: "sidebar-nav-group-admin",
          // ADR-0025 generic admin CRUD surface: the 8 org/global-scoped
          // entities (Sitemap's own table), generated from the registry
          // (`pages/admin/registry.ts`) — one item per registry entry,
          // never a hardcoded literal per entity.
          items: orgScopedEntities.map((item) => ({
            to: `/orgs/${orgId}/admin/${item.key}`,
            label: item.label,
            testId: `sidebar-nav-admin-${item.key}`,
          })),
        },
      ]
    : [];

  return (
    <div
      ref={sidebarRef}
      className={[
        "sidebar",
        "sidebar-dark",
        "vh-100",
        // Confirmed empirically against real @coreui/react (not just read
        // off its source, which has confusing internal effect-timing): the
        // SAME "has the toggler been clicked an odd number of times since
        // mount" boolean (`!visible`) maps to a different class depending
        // on the breakpoint's own default state — desktop defaults open
        // (needs `hide` to close), mobile defaults off-canvas-closed (needs
        // `show` to reveal). Not two independent conditions.
        isMobile && !visible ? "show" : null,
        !isMobile && !visible ? "hide" : null,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="sidebar-header">
        <a className="sidebar-brand">TestNexa</a>
      </div>
      <ul className="sidebar-nav">
        {navItems.map((item) => (
          <li className="nav-item" key={item.key}>
            <NavLink to={item.to} end={item.end} className="nav-link" data-testid={item.testId}>
              {item.label}
            </NavLink>
          </li>
        ))}
        {navGroups.map((group) => {
          const isOpen = openGroups.has(group.key);
          return (
            <li
              className={isOpen ? "nav-group show" : "nav-group"}
              data-testid={group.testId}
              key={group.key}
            >
              <a
                href="#"
                className="nav-link nav-group-toggle"
                aria-expanded={isOpen}
                onClick={(event) => {
                  event.preventDefault();
                  toggleGroup(group.key);
                }}
              >
                {group.label}
              </a>
              <ul className="nav-group-items" style={{ display: isOpen ? "block" : "none" }}>
                {group.items.map((item) => (
                  <li className="nav-item" key={item.testId}>
                    <NavLink to={item.to} className="nav-link" data-testid={item.testId}>
                      {item.label}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default AppSidebar;
