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
 * **SHELL-7 (2026-09-08, ADR-0046):** the single flat `Admin` group (8
 * org-scoped CRUD entities, testid `sidebar-nav-group-admin`) is retired and
 * replaced by three named, individually-iconed groups — `Access Control`,
 * `Catalogs`, `Organization` (see `ORG_ENTITY_GROUPS` below) — rendered
 * *before* `UI Elements`, which stays unconditionally last. The 8 children keep
 * their `sidebar-nav-admin-<key>` testids; only the parent changed. `Members`
 * gains an icon, because under the new `sidebar-mini` body class (owned by
 * `AppShell`) an icon-less row collapses to an empty rail slot. See the
 * `nav-treeview` comment in the JSX below for what a `menu-open` group
 * actually does in the mini rail — measured live, not inferred.
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
 *
 * - `test-steps`, `attachments` and the 4 link tables are reached through
 *   their parent entity's own UI (a TestStep only exists inside a TestCase, a
 *   link row only inside the pair it links), so a top-level slot would be a
 *   second, worse path to something already reachable.
 * - `projects` and `organizations` have no meaning *inside* a single project's
 *   own nav — you are already in one; the two bottom "back" links cover
 *   leaving it.
 */
/**
 * Shared renderer for a flat (non-group) nav row. Extracted by SHELL-10
 * (ADR-0050) purely so the org-mode items above the groups and the project-mode
 * "back" links below them render byte-identical markup — the two lists are
 * mutually exclusive at runtime, but duplicating the JSX would let them drift.
 */
function renderFlatItem(item: SidebarNavItem) {
  return (
    <li className="nav-item" key={item.key}>
      <NavLink to={item.to} end={item.end} className="nav-link" data-testid={item.testId}>
        {item.icon && <i className={`nav-icon ${item.icon}`} aria-hidden="true" />}
        <p>{item.label}</p>
      </NavLink>
    </li>
  );
}

export const PROJECT_EXCLUDED_ENTITY_KEYS: string[] = [
  "test-steps",
  "attachments",
  "requirement-test-case-links",
  "requirement-test-condition-links",
  "test-condition-test-case-links",
  "test-case-defect-links",
  "projects",
];

function AppSidebar() {
  // SHELL-9 (ADR-0050): was a raw `useParams<{orgId?: string}>()` read, which
  // resolved to `undefined` on every `/projects/:projectId/...` screen and left
  // this whole nav empty there. `useResolvedOrgId()` returns the same value on
  // `/orgs/:orgId/...` routes (no fetch) and resolves it via `GET
  // /projects/{id}` on project-scoped ones. Everything below is unchanged: it
  // already branched on "is `orgId` truthy," never on which route produced it.
  // SHELL-10 (ADR-0050) additionally reads `mode`: SHELL-9 made project-scoped
  // routes resolve the same `orgId` an org route would (which is what made the
  // org nav render there at all), so "is `orgId` truthy" can no longer tell the
  // two route kinds apart. `mode` is the explicit signal.
  const { orgId, projectId, mode } = useResolvedOrgId();
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());

  // "Project Overview" points at `/projects/:projectId` itself, so it is a dead
  // affordance while already on that exact route. `end: true` mirrors the
  // exact-match convention the Dashboard nav item already uses, rather than
  // hand-comparing pathnames. Hooks must run unconditionally, so this is
  // computed before the `mode` branch below, not inside it.
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
  // org items are replaced wholesale by the project-mode nav below — the org
  // nav is not rendered alongside it, and not rendered at all.
  const navItems: SidebarNavItem[] = orgId && mode === "org"
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
          // PROJ-4 (ADR-0047): Project CRUD's own dedicated page
          // (`ProjectsPage.tsx`, extracted out of "Dashboard") gets its own
          // flat nav entry — the single extension point this file's own
          // docstring names (AC5), same as every other flat item above/below
          // it. Icon added 2026-09-09 (CTO direct instruction, amending
          // ADR-0047 §2's original "no icon" call) — reuses the same
          // `fa-solid fa-folder` glyph `ProjectCountWidget` (`OrgHome.tsx`)
          // already uses for this entity, so it reads as the same icon
          // everywhere Projects appears. DASH-2/TC-SHELL-021's "Dashboard is
          // the only icon item" invariant no longer holds as stated — see
          // that TC's own row, corrected in place.
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
          // SHELL-7 (ADR-0046): under `sidebar-mini` the collapsed rail shows
          // icons only, so a nav row with no icon renders as an empty slot.
          // This is the one flat item the restructure doesn't regroup, so it
          // needed the icon added rather than inherited from a new group.
          icon: "fa-solid fa-users",
        },
      ]
    : [];

  // ADR-0025 generic admin CRUD surface: the 8 org/global-scoped entities
  // (Sitemap's own table), generated from the registry
  // (`pages/admin/registry.ts`) — one item per registry entry, never a
  // hardcoded literal per entity. SHELL-7 (ADR-0046) replaced the single flat
  // `Admin` group with the 3-way `ORG_ENTITY_GROUPS` partition above; the
  // *child* testids keep the original `sidebar-nav-admin-<key>` convention
  // (only the parent group changed, so churn is limited to what actually
  // moved).
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
        // ADR-0020 template-parity scaffolding, unconditionally last and
        // explicitly out of SHELL-7's scope (no icon, not regrouped).
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
      ]
    : [];

  // SHELL-10 (ADR-0050): project-mode nav. Same generated-from-the-registry
  // discipline as the org side — child labels and routes come from
  // `projectScopedEntities`, never hardcoded, and each group links to the
  // already-shipped generic-admin route (`/projects/:projectId/admin/<entity>`,
  // ADR-0025). No new backend route.
  //
  // Gated on `orgId` too, not just `projectId` — `projectId` alone is
  // available synchronously from the route, but waiting for `orgId` (i.e. for
  // `useResolvedOrgId()`'s fetch to actually resolve) preserves the same
  // "one fetch's worth of blank sidebar, no partial/flickering nav" trade-off
  // ADR-0050 §4 already established for the org nav this replaces — content
  // that depends on a project genuinely existing (its group links point at
  // `/projects/:projectId/admin/...` routes) shouldn't render before that's
  // confirmed.
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

  // SHELL-10 (ADR-0050): the two "back" links, rendered *below* the 4 entity
  // groups (hence a separate array — `navItems` renders above `navGroups`).
  //
  // "Back to Projects" is PROJ-4's existing `/orgs/:orgId/projects` item
  // repositioned, not a new destination — ADR-0050 already established that
  // reusing it beats inventing a second entry pointing at the same place. It
  // needs `orgId`, which on this route only exists once SHELL-9's fetch has
  // resolved, so it is omitted while pending/failed rather than rendered as a
  // dead link (the same graceful-degradation posture as ADR-0050 §4).
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
    <aside className="app-sidebar bg-body-secondary shadow">
      {/* BRAND-1 (ADR-0048 Decision §6, UI Design Document §3.3): BOTH logo
          slots render unconditionally, with AdminLTE's own
          `.brand-image-xl`/`.logo-xl` + `.brand-image-xs`/`.logo-xs` class
          pair. AdminLTE's shipped CSS cross-fades which one is visible off the
          existing `sidebar-mini`/`sidebar-collapse` body classes (SHELL-7,
          ADR-0046) — deliberately no React state and no new JS here, per
          ADR-0042's "use the library's own CSS, don't vendor its plugins".

          DEVIATION from ADR-0048/UI-Design §3.3/TC-DS-027 as originally
          written: those specified `logo-full.svg` (icon + wordmark) for the
          `.brand-image-xl` slot. It cannot go here. AdminLTE positions
          `.logo-xl`/`.logo-xs` ABSOLUTELY (`top:6px;left:12px`), while
          `.brand-text` stays in normal flow at x~89 — so a lockup carrying
          its own wordmark renders *underneath* the `.brand-text` wordmark,
          painting "TestNexa" twice, overlapping (confirmed on a live
          instance, BRAND-1, 2026-09-09). `.brand-text` cannot simply be
          dropped to make room: the already-shipped TC-SHELL-005
          (`e2e/tests/shell-nav.spec.ts`) asserts `.app-sidebar`'s "TestNexa"
          text is VISIBLE, so removing it would regress another story's
          coverage. Both slots therefore use the mark; `logo-full.svg` is
          still used at the login/signup mount, where it stands alone with no
          adjacent `.brand-text` to collide with. All three documents were
          corrected in place 2026-09-09 to match what actually ships — see
          ADR-0048's Consequences amendment for the full reasoning. */}
      <div className="sidebar-brand">
        <a className="brand-link" href="/dashboard" aria-label="TestNexa home" data-testid="sidebar-brand-link">
          <img
            src={logoMarkUrl}
            className="brand-image-xl logo-xl"
            alt=""
            style={{ height: "2.5rem", width: "auto" }}
            data-testid="sidebar-brand-logo-xl"
          />
          <img
            src={logoMarkUrl}
            className="brand-image-xs logo-xs"
            alt=""
            style={{ height: "2rem", width: "auto" }}
            data-testid="sidebar-brand-logo-xs"
          />
          <span className="brand-text fw-light">TestNexa</span>
        </a>
      </div>
      <div className="sidebar-wrapper">
        <nav className="mt-2">
          <ul className="nav sidebar-menu flex-column" data-lte-toggle="treeview" role="menu">
            {navItems.map(renderFlatItem)}
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
                    {group.icon && <i className={`nav-icon ${group.icon}`} aria-hidden="true" />}
                    <p>
                      {group.label}
                      <i className="nav-arrow fa-solid fa-angle-right" aria-hidden="true" />
                    </p>
                  </a>
                  {/* No inline display style: `.sidebar-menu .nav-treeview`
                      is `display: none` and `.menu-open > .nav-treeview` is
                      `display: block` in AdminLTE's own CSS.

                      SHELL-7 (ADR-0046) flagged "what does a `menu-open` group
                      do under `sidebar-mini` + `sidebar-collapse`?" as an open
                      question to answer live, not from source. Measured
                      against a real browser on the isolated stack (2026-09-08,
                      1400x900, real hover + real click):

                      **There is no hover flyout.** AdminLTE's stock flyout is
                      JS-driven (`push-menu.ts`) and we don't vendor that JS
                      (ADR-0042), and no CSS rule closes a `menu-open` treeview
                      when the rail is un-hovered. So an open group simply stays
                      open and its `.nav-treeview` renders *inline inside* the
                      73.59px (4.6rem) rail: submenu `display: block`, each
                      child 57.59x40px and still hit-testable. A rail-row click
                      navigates correctly (verified: reached `/admin/roles`).

                      The cosmetic consequence, accepted rather than worked
                      around here: those child rows show **nothing** while
                      un-hovered — `.sidebar-mini.sidebar-collapse .nav-link p`
                      is `width: 0`, and children deliberately carry no icon
                      (ADR-0046's icon-exclusivity rule, TC-SHELL-026), so an
                      open group reads as N blank 40px rows until hovered.
                      Hovering restores the full 250px width and every label.
                      Giving children icons purely to fill that rail would
                      contradict the ADR's own decision, so it is left as-is
                      and recorded here instead of silently "fixed". */}
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
            {/* SHELL-10 (ADR-0050): the project-mode "back" links, below the 4
                entity groups. Identical markup to the flat `navItems` above —
                same `renderFlatItem` helper, so the two can't drift apart. */}
            {bottomNavItems.map(renderFlatItem)}
          </ul>
        </nav>
      </div>
    </aside>
  );
}

export default AppSidebar;
