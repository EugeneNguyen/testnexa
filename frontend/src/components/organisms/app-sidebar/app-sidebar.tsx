/**
 * SHELL-1 (ADR-0018) persistent sidebar, mounted once inside `AppShell` so
 * every `ProtectedRoute` screen gets it for free. Owns exactly one nav-item
 * list — org-home, org-members today — the single, obvious place a future
 * story adds its own entry (AC5); do not scatter per-page `<Link>` back-links
 * the way `OrgHome.tsx`'s pre-existing pattern does.
 *
 * `orgId` comes from `useResolvedOrgId()` (SHELL-9, see below), not a
 * required route param: on `/orgs/pick` (`OrgPicker`, no org selected yet)
 * there is no `orgId` to link org-scoped items to, so the nav-item list is
 * empty rather than a disabled/greyed pair (ADR-0018) — a disabled control
 * implies a temporarily-unavailable action, which isn't the case here.
 *
 * Active-route highlighting is React Router's own `NavLink` default
 * className behavior (an "active" class appended when the route matches),
 * not a bespoke `useLocation` comparison. The org-home item passes `end` so
 * it does NOT read "active" while on `/orgs/:orgId/members`.
 *
 * ## Tabler v1.5.1 (ADR-0054, Phase 2) — what changed from AdminLTE v4
 *
 * Raw HTML, same as under ADR-0042/ADR-0037, but every class is now
 * Tabler's own, read verbatim out of the CTO-supplied Tabler page-layout doc
 * (the "Sidebar layout" sample). The renames that matter:
 *
 * | AdminLTE v4 (was)              | Tabler v1.5.1 (now)                    |
 * |---------------------------------|-----------------------------------------|
 * | `.app-sidebar`                  | `.navbar.navbar-vertical.navbar-expand-lg` |
 * | `.sidebar-brand`/`.brand-link`  | `.navbar-brand` (inside `.container-fluid`) |
 * | `.sidebar-wrapper`/`.sidebar-menu` (`nav.sidebar-menu`) | `.collapse.navbar-collapse#sidebar-menu` > `ul.navbar-nav` |
 * | `.nav-item` + `.menu-open`      | `.nav-item.dropdown` (+ `.show` on the toggle link) |
 * | `.nav-link` group toggle        | `.nav-link.dropdown-toggle`             |
 * | `ul.nav.nav-treeview`           | `div.dropdown-menu`                     |
 * | `<p>{label}</p>`                | `<span class="nav-link-title">{label}</span>` |
 *
 * **Groups render as Bootstrap dropdowns, not an AdminLTE treeview.** Tabler's
 * own folded-sidebar doc example uses `.nav-item.dropdown` for a group; the
 * *unfolded* vertical navbar used here renders an open `.dropdown-menu.show`
 * INLINE (normal document flow, pushing content below it down), not as a
 * floating flyout — confirmed live against a running instance (this repo's
 * own "verify empirically, don't trust source-reading" testing rule), not
 * assumed from the doc. Same hand-rolled `useState<Set<string>>` of open
 * group keys as before — only the toggled class changed, from AdminLTE's
 * `menu-open` on the `<li>` to a plain `show` on the `.dropdown-menu` (and
 * `active` on the toggle `<li>`, for `.active` styling parity).
 *
 * **The sidebar's mobile open/closed state is now a prop** (`mobileOpen`),
 * not internal state or a body class: `AppShell` owns it (a single boolean —
 * see its own docstring for why AdminLTE's collapsed/open pair collapses to
 * one flag under Tabler's CSS) and passes it down alongside
 * `AppSidebar`/`AppHeader`. Tabler's `.navbar-expand-lg` rule forces
 * `.navbar-collapse` visible above the breakpoint regardless of the `show`
 * class, so `mobileOpen` only ever matters below it — no
 * `matchMedia`/breakpoint-listener plumbing is needed here at all, unlike
 * AdminLTE's hand-ported `push-menu.ts` state machine.
 *
 * **`sidebar-mini` (SHELL-7, ADR-0046) has no Tabler equivalent in this
 * pass.** AdminLTE's icon-only collapsed rail is retired outright (ADR-0054
 * Consequences) — there is no third, icon-only state, only shown/hidden.
 * The brand logo therefore no longer needs an xl/xs swap pair; a single
 * `sidebar-brand-logo` image replaces `sidebar-brand-logo-xl`/`-xs`
 * (BRAND-1/ADR-0048's mini-rail cross-fade no longer has a target to fade
 * between).
 */
import { useState } from "react";
import { NavLink, useMatch } from "react-router-dom";
import logoMarkUrl from "../../../assets/brand/logo-mark.svg";
import { orgScopedEntities, projectScopedEntities } from "../../../pages/admin/registry";
import { useResolvedOrgId } from "../../../hooks/useResolvedOrgId";

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
  /**
   * Font Awesome classes, e.g. `"fa-solid fa-user-shield"`. Optional because
   * `UI Elements` (ADR-0020 scaffolding) deliberately still has none —
   * SHELL-7/ADR-0046 only added icons to the three groups it created plus the
   * `Members` flat item, and explicitly does not touch `UI Elements`.
   */
  icon?: string;
  items: { to: string; label: string; testId: string }[];
}

/**
 * SHELL-7 (ADR-0046): the presentation-layer partition of the 8 org-scoped
 * CRUD entities into 3 named, individually-iconed groups. Keyed off each
 * registry entry's own `key` — `orgScopedEntities` itself is NOT reordered or
 * re-keyed (that registry is also consumed by `App.tsx`'s route wiring and
 * `FkAutocomplete`'s ref lookups, so regrouping it there to serve one
 * consumer would have blast radius outside this file).
 *
 * Labels come from the registry, never hardcoded here, so this stays a pure
 * grouping decision. Order *within* a group is this array's own order, which
 * is deliberately not the registry's (Access Control reads Role → Permission
 * → RoleAssignment → OrgMembership, matching ADR-0046's own listing).
 *
 * This must remain a complete, non-overlapping partition of all 8 entries —
 * enforced by `AppSidebar.test.tsx`'s TC-SHELL-025 test, which fails if an
 * entity is missing, duplicated, or added to the registry without landing in
 * a group here.
 */
interface OrgEntityGroup {
  key: string;
  label: string;
  testId: string;
  icon: string;
  /** `orgScopedEntities` keys, in the order they should render in this group. */
  entityKeys: string[];
}

const ORG_ENTITY_GROUPS: OrgEntityGroup[] = [
  {
    key: "access-control",
    label: "Access Control",
    testId: "sidebar-nav-group-access-control",
    icon: "fa-solid fa-user-shield",
    entityKeys: ["roles", "permissions", "role-assignments", "org-memberships"],
  },
  {
    key: "catalogs",
    label: "Catalogs",
    testId: "sidebar-nav-group-catalogs",
    icon: "fa-solid fa-layer-group",
    entityKeys: ["test-design-techniques", "test-levels", "test-types"],
  },
  {
    key: "organization",
    label: "Organization",
    testId: "sidebar-nav-group-organization",
    icon: "fa-solid fa-building",
    entityKeys: ["organizations"],
  },
];

/**
 * SHELL-10 (ADR-0050): the project-mode counterpart to `ORG_ENTITY_GROUPS`
 * above — a complete, non-overlapping partition of the *included* subset of
 * `projectScopedEntities` into 4 named, individually-iconed groups.
 *
 * Same discipline as the org side: labels come from the registry (never
 * hardcoded here), the registry itself is not reordered or re-keyed, and
 * `AppSidebar.test.tsx`'s partition test fails if an entity is missing,
 * duplicated, or added to the registry without landing in a group *or* in
 * `PROJECT_EXCLUDED_ENTITY_KEYS` below.
 *
 * Order within a group is this array's own, deliberately following the
 * ISTQB-ish lifecycle (design → plan → execute → supporting setup) rather than
 * the registry's insertion order.
 */
export const PROJECT_ENTITY_GROUPS: OrgEntityGroup[] = [
  {
    key: "test-design",
    label: "Test Design",
    testId: "sidebar-nav-group-test-design",
    icon: "fa-solid fa-pen-ruler",
    entityKeys: ["requirements", "test-conditions", "test-cases", "test-suites"],
  },
  {
    key: "test-planning",
    label: "Test Planning",
    testId: "sidebar-nav-group-test-planning",
    icon: "fa-solid fa-calendar-check",
    entityKeys: ["test-plans", "entry-exit-criteria", "test-cycles", "releases"],
  },
  {
    key: "execution-defects",
    label: "Execution & Defects",
    testId: "sidebar-nav-group-execution-defects",
    icon: "fa-solid fa-bug",
    entityKeys: ["test-executions", "test-logs", "defects"],
  },
  {
    key: "setup",
    label: "Setup",
    testId: "sidebar-nav-group-setup",
    icon: "fa-solid fa-sliders",
    entityKeys: ["environments", "risk-items"],
  },
];

/**
 * SHELL-10 (ADR-0050): `projectScopedEntities` entries deliberately given no
 * top-level project-nav slot. Declared explicitly (rather than left as
 * "whatever isn't in a group") so the partition test can assert
 * groups + exclusions === the whole registry, and so adding a new
 * project-scoped entity to the registry forces a conscious decision here
 * instead of silently vanishing from the nav.
 */
export const PROJECT_EXCLUDED_ENTITY_KEYS: string[] = [
  "test-steps",
  "attachments",
  "requirement-test-case-links",
  "requirement-test-condition-links",
  "test-condition-test-case-links",
  "test-case-defect-links",
  "projects",
];

/**
 * Shared renderer for a flat (non-group) nav row. Extracted so the org-mode
 * items above the groups and the project-mode "back" links below them render
 * byte-identical markup — the two lists are mutually exclusive at runtime,
 * but duplicating the JSX would let them drift.
 */
function renderFlatItem(item: SidebarNavItem) {
  return (
    <li className="nav-item" key={item.key}>
      <NavLink to={item.to} end={item.end} className="nav-link" data-testid={item.testId}>
        {item.icon && <i className={`nav-link-icon ${item.icon}`} aria-hidden="true" />}
        <span className="nav-link-title">{item.label}</span>
      </NavLink>
    </li>
  );
}

interface AppSidebarProps {
  /**
   * Mobile-only open/closed state, owned by `AppShell` (see this file's own
   * docstring). Above Tabler's `.navbar-expand-lg` breakpoint the CSS forces
   * the nav visible regardless of this value. Defaults to closed so every
   * other mount site (unit tests that render `AppSidebar` standalone to
   * exercise its nav-content logic, not the mobile toggle) doesn't need to
   * pass it.
   */
  mobileOpen?: boolean;
}

function AppSidebar({ mobileOpen = false }: AppSidebarProps) {
  // SHELL-9 (ADR-0050): resolves `orgId` on both `/orgs/:orgId/...` routes
  // (route param, no fetch) and `/projects/:projectId/...` routes (a `GET
  // /projects/{id}` fetch, read `org_id`). SHELL-10 (ADR-0050) additionally
  // reads `mode`, the explicit org-vs-project route-kind signal.
  const { orgId, projectId, mode } = useResolvedOrgId();
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());

  // "Project Overview" points at `/projects/:projectId` itself, so it is a dead
  // affordance while already on that exact route. Hooks must run
  // unconditionally, so this is computed before the `mode` branch below.
  const isOnProjectOverview = useMatch({ path: "/projects/:projectId", end: true }) !== null;

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
  //
  // SHELL-10 (ADR-0050): org-mode only. On a project-scoped route these flat
  // org items are replaced wholesale by the project-mode nav below.
  const navItems: SidebarNavItem[] = orgId && mode === "org"
    ? [
        {
          key: "org-home",
          label: "Dashboard",
          to: `/orgs/${orgId}`,
          end: true,
          testId: "sidebar-nav-org-home",
          icon: "fa-solid fa-gauge-high",
        },
        {
          // PROJ-4 (ADR-0047): Project CRUD's own dedicated page gets its own
          // flat nav entry — the single extension point this file's own
          // docstring names (AC5). Icon reuses the same `fa-solid fa-folder`
          // glyph `ProjectCountWidget` (`OrgHome.tsx`) already uses.
          key: "projects",
          label: "Projects",
          to: `/orgs/${orgId}/projects`,
          end: false,
          testId: "sidebar-nav-projects",
          icon: "fa-solid fa-folder",
        },
        {
          key: "org-members",
          label: "Members",
          to: `/orgs/${orgId}/members`,
          end: false,
          testId: "sidebar-nav-org-members",
          icon: "fa-solid fa-users",
        },
      ]
    : [];

  // ADR-0025 generic admin CRUD surface: the org/global-scoped entities
  // (Sitemap's own table), generated from the registry
  // (`pages/admin/registry.ts`) — one item per registry entry, never a
  // hardcoded literal per entity.
  const entityByKey = new Map(orgScopedEntities.map((item) => [item.key, item]));

  const orgNavGroups: SidebarNavGroup[] = orgId && mode === "org"
    ? [
        ...ORG_ENTITY_GROUPS.map((group) => ({
          key: group.key,
          label: group.label,
          testId: group.testId,
          icon: group.icon,
          items: group.entityKeys.flatMap((entityKey) => {
            const entry = entityByKey.get(entityKey);
            return entry
              ? [
                  {
                    to: `/orgs/${orgId}/admin/${entry.key}`,
                    label: entry.label,
                    testId: `sidebar-nav-admin-${entry.key}`,
                  },
                ]
              : [];
          }),
        })),
      ]
    : [];

  // SHELL-10 (ADR-0050): project-mode nav. Same generated-from-the-registry
  // discipline as the org side.
  //
  // Gated on `orgId` too, not just `projectId` (SHELL-10's own documented
  // fix): content that depends on a project genuinely existing shouldn't
  // render before `useResolvedOrgId()`'s fetch has confirmed it.
  const projectEntityByKey = new Map(projectScopedEntities.map((item) => [item.key, item]));

  const projectNavGroups: SidebarNavGroup[] =
    mode === "project" && projectId && orgId
      ? PROJECT_ENTITY_GROUPS.map((group) => ({
          key: group.key,
          label: group.label,
          testId: group.testId,
          icon: group.icon,
          items: group.entityKeys.flatMap((entityKey) => {
            const entry = projectEntityByKey.get(entityKey);
            return entry
              ? [
                  {
                    to: `/projects/${projectId}/admin/${entry.key}`,
                    label: entry.label,
                    testId: `sidebar-nav-admin-${entry.key}`,
                  },
                ]
              : [];
          }),
        }))
      : [];

  const navGroups: SidebarNavGroup[] = mode === "project" ? projectNavGroups : orgNavGroups;

  // SHELL-10 (ADR-0050): the two "back" links, rendered *below* the entity
  // groups (hence a separate array — `navItems` renders above `navGroups`).
  const bottomNavItems: SidebarNavItem[] =
    mode === "project" && projectId
      ? [
          ...(isOnProjectOverview
            ? []
            : [
                {
                  key: "project-overview",
                  label: "Project Overview",
                  to: `/projects/${projectId}`,
                  end: true,
                  testId: "sidebar-nav-project-overview",
                  icon: "fa-solid fa-circle-info",
                },
              ]),
          ...(orgId
            ? [
                {
                  key: "back-to-projects",
                  label: "Back to Projects",
                  to: `/orgs/${orgId}/projects`,
                  end: false,
                  testId: "sidebar-nav-back-to-projects",
                  icon: "fa-solid fa-arrow-left",
                },
              ]
            : []),
        ]
      : [];

  return (
    <aside
      className="navbar navbar-vertical navbar-expand-lg"
      // FR-SHELL-5 (ADR-0026): the sidebar keeps its own dark scheme
      // regardless of the app-wide light/dark/auto toggle — AdminLTE
      // expressed this as a static `bg-body-secondary` utility (no v4 skin
      // class existed); Tabler's own documented mechanism for the same claim
      // is a per-navigation `data-bs-theme` override (its "Navigation theme"
      // doc: "the attribute colors whichever navigation the page shows").
      data-bs-theme="dark"
      data-testid="app-sidebar"
    >
      <div className="container-fluid">
        <h1 className="navbar-brand">
          <a href="/dashboard" aria-label="TestNexa home" data-testid="sidebar-brand-link">
            <img
              src={logoMarkUrl}
              className="navbar-brand-image"
              alt=""
              style={{ height: "2rem", width: "auto" }}
              data-testid="sidebar-brand-logo"
            />
            <span className="brand-text ps-2">TestNexa</span>
          </a>
        </h1>
        <div className={mobileOpen ? "collapse navbar-collapse show" : "collapse navbar-collapse"} id="sidebar-menu">
          <ul className="navbar-nav pt-lg-3">
            {navItems.map(renderFlatItem)}
            {navGroups.map((group) => {
              const isOpen = openGroups.has(group.key);
              return (
                <li className={isOpen ? "nav-item dropdown active" : "nav-item dropdown"} data-testid={group.testId} key={group.key}>
                  <a
                    href="#"
                    className="nav-link dropdown-toggle"
                    aria-expanded={isOpen}
                    onClick={(event) => {
                      event.preventDefault();
                      toggleGroup(group.key);
                    }}
                  >
                    {group.icon && <i className={`nav-link-icon ${group.icon}`} aria-hidden="true" />}
                    <span className="nav-link-title">{group.label}</span>
                  </a>
                  <div className={isOpen ? "dropdown-menu show" : "dropdown-menu"}>
                    {group.items.map((item) => (
                      <NavLink to={item.to} className="dropdown-item" data-testid={item.testId} key={item.testId}>
                        {item.label}
                      </NavLink>
                    ))}
                  </div>
                </li>
              );
            })}
            {/* SHELL-10 (ADR-0050): the project-mode "back" links, below the
                entity groups. Identical markup to the flat `navItems` above —
                same `renderFlatItem` helper, so the two can't drift apart. */}
            {bottomNavItems.map(renderFlatItem)}
          </ul>
        </div>
      </div>
    </aside>
  );
}

export default AppSidebar;
