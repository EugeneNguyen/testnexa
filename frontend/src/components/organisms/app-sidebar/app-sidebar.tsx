/**
 * SHELL-1 (ADR-0018) persistent sidebar, mounted once inside `AppShell` so
 * every `ProtectedRoute` screen gets it for free. Owns exactly one nav-item
 * list — org-home, org-members today — the single, obvious place a future
 * story adds its own entry (AC5); do not scatter per-page `<Link>` back-links
 * the way `OrgHome.tsx`'s pre-existing pattern does.
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
 * SHELL-8 (ADR-0020) adds a "UI Elements" nav group (Colors/Typography/
 * Icons) below the flat org nav-item list — template-parity scaffolding
 * only, **not backed by any FR/NFR or user story** (see that ADR and the
 * three reference pages' own docstrings). Gated on `orgId` the same way the
 * flat list above is (absent entirely on `/orgs/pick`, not disabled
 * controls) for the same reasoning: there is no org context to link into.
 *
 * **DASH-2 (2026-09-07):** "Org home" relabeled "Dashboard" (label text
 * only — `key`/`testId`/`to` all stay `org-home`/`sidebar-nav-org-home`/
 * `/orgs/:orgId`, so no test needs updating for those, only the visible
 * string). This is a distinct page from the separate, unrelated global
 * `/dashboard` placeholder (ADR-0035/DASH-1) — that route is untouched, see
 * this story's own ADR for the naming-collision call.
 *
 * ## AdminLTE v4 (ADR-0042) — what changed from the CoreUI markup
 *
 * Raw HTML, same as under ADR-0037, but every class is now AdminLTE v4's,
 * read verbatim out of the vendored `admin-lte@4.9.1` package (its shipped
 * `dist/css/adminlte.css` and `src/ts/treeview.ts`), never from memory or a
 * v3 tutorial. The renames that matter:
 *
 * | CoreUI (was)       | AdminLTE v4 (now)                       |
 * |--------------------|-----------------------------------------|
 * | `.sidebar`         | `.app-sidebar` (a named CSS-grid area)  |
 * | `.sidebar-header`  | `.sidebar-brand`                        |
 * | `.sidebar-brand`   | `.brand-link` + `.brand-text`           |
 * | (none)             | `.sidebar-wrapper` (the scroll region)  |
 * | `.sidebar-nav`     | `.nav.sidebar-menu.flex-column`         |
 * | `.nav-group`       | `.nav-item` (+ `.menu-open` when open)  |
 * | `.nav-group-toggle`| `.nav-link`                             |
 * | `.nav-group-items` | `.nav.nav-treeview`                     |
 *
 * Three of those are load-bearing in a way that is easy to get wrong:
 *
 * 1. **It is `sidebar-menu`, NOT `nav-sidebar`.** The v3 name has zero
 *    occurrences in v4.9.1's shipped CSS.
 * 2. **`.sidebar-menu` needs Bootstrap's own `nav flex-column`.** AdminLTE's
 *    `.sidebar-menu` rule sets only `white-space: nowrap` — no `display`, no
 *    `list-style`, no `padding` reset — so without `nav flex-column` you get
 *    a bulleted, horizontally-laid-out list. The nested `<ul>` needs
 *    `nav nav-treeview` for the same reason (`.nav-treeview` resets its own
 *    padding/list-style but still needs `nav`).
 * 3. **Nav label text must be wrapped in `<p>`.** `.sidebar-menu .nav-link p`
 *    is what carries the label layout, and the mini-collapse animation sets
 *    `p { width: 0 }` — a bare text node cannot collapse.
 *
 * Group open/closed is still the same hand-rolled `useState<Set<string>>` of
 * open group keys this component has always used (no JS height animation, no
 * plugin) — only the toggled class changed, from CoreUI's `show` to
 * AdminLTE's `menu-open`, and the submenu's inline `style={{display}}` is
 * gone because AdminLTE's CSS owns that now (`.sidebar-menu .nav-treeview {
 * display: none }` / `.sidebar-menu .menu-open > .nav-treeview { display:
 * block }`). `aria-expanded` stays on the group's own `.nav-link` toggle,
 * which is where `treeview.ts` puts it. `data-lte-toggle="treeview"` on the
 * root `<ul>` is convention parity only — nothing listens for it, since we
 * don't load AdminLTE's JS.
 *
 * Two classes were deleted outright rather than translated:
 * - **`sidebar-dark` does not exist in AdminLTE v4** — the whole
 *   `sidebar-dark-*` / `sidebar-light-*` skin family was removed (v4 themes a
 *   sidebar with `--lte-sidebar-*` custom properties or a nested
 *   `data-bs-theme="dark"`). `bg-body-secondary` — AdminLTE's own demo
 *   default — replaces it. This is a deliberate visual change, not parity.
 * - **`vh-100`** existed only to cap the sidebar's height against `AppShell`'s
 *   old `d-flex` row (see that file's docstring). The `.app-wrapper` grid
 *   gives `.app-sidebar` its own row-spanning area, so the cap is both
 *   unnecessary and wrong (it would fight `layout-fixed`).
 *
 * The sidebar's own visible/hidden state is no longer a prop on this
 * component at all: AdminLTE keeps it in `sidebar-collapse`/`sidebar-open`
 * classes on `document.body`, which `AppShell` owns (see its docstring for
 * the full push-menu state machine). The old `visible`/`onVisibleChange`
 * props and the `--cui-is-mobile` breakpoint probe they fed are both gone —
 * `--cui-is-mobile` was a CoreUI CSS custom property that AdminLTE never
 * defines, so `getComputedStyle(...).getPropertyValue("--cui-is-mobile")`
 * would have silently returned `""` forever and the mobile branch would never
 * have fired. Its replacement (`matchMedia("(max-width: 991.98px)")`) lives
 * in `AppShell`, next to the state it actually decides.
 */
import { useState } from "react";
import { NavLink, useParams } from "react-router-dom";
import { orgScopedEntities } from "../../../pages/admin/registry";

interface SidebarNavItem {
  key: string;
  label: string;
  to: string;
  end: boolean;
  testId: string;
  /** Font Awesome classes, e.g. `"fa-solid fa-gauge-high"` (ADR-0042 §3.2). */
  icon?: string;
}

interface SidebarNavGroup {
  key: string;
  label: string;
  testId: string;
  items: { to: string; label: string; testId: string }[];
}

function AppSidebar() {
  const { orgId } = useParams<{ orgId?: string }>();
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());

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
          label: "Dashboard",
          to: `/orgs/${orgId}`,
          end: true,
          testId: "sidebar-nav-org-home",
          // Was `cilSpeedometer` (a @coreui/icons path array rendered as an
          // <svg> by CIcon); ADR-0042 §3.2 maps it to Font Awesome's
          // fa-gauge-high, which renders as an <i> glyph instead.
          icon: "fa-solid fa-gauge-high",
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
    <aside className="app-sidebar bg-body-secondary shadow">
      <div className="sidebar-brand">
        <a className="brand-link">
          <span className="brand-text fw-light">TestNexa</span>
        </a>
      </div>
      <div className="sidebar-wrapper">
        <nav className="mt-2">
          <ul className="nav sidebar-menu flex-column" data-lte-toggle="treeview" role="menu">
            {navItems.map((item) => (
              <li className="nav-item" key={item.key}>
                <NavLink to={item.to} end={item.end} className="nav-link" data-testid={item.testId}>
                  {item.icon && <i className={`nav-icon ${item.icon}`} aria-hidden="true" />}
                  <p>{item.label}</p>
                </NavLink>
              </li>
            ))}
            {navGroups.map((group) => {
              const isOpen = openGroups.has(group.key);
              return (
                <li
                  className={isOpen ? "nav-item menu-open" : "nav-item"}
                  data-testid={group.testId}
                  key={group.key}
                >
                  <a
                    href="#"
                    className="nav-link"
                    aria-expanded={isOpen}
                    onClick={(event) => {
                      event.preventDefault();
                      toggleGroup(group.key);
                    }}
                  >
                    <p>
                      {group.label}
                      <i className="nav-arrow fa-solid fa-angle-right" aria-hidden="true" />
                    </p>
                  </a>
                  {/* No inline display style: `.sidebar-menu .nav-treeview`
                      is `display: none` and `.menu-open > .nav-treeview` is
                      `display: block` in AdminLTE's own CSS. */}
                  <ul className="nav nav-treeview">
                    {group.items.map((item) => (
                      <li className="nav-item" key={item.testId}>
                        <NavLink to={item.to} className="nav-link" data-testid={item.testId}>
                          <p>{item.label}</p>
                        </NavLink>
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
    </aside>
  );
}

export default AppSidebar;
