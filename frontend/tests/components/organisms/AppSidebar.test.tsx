import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import AppSidebar from "../../../src/components/organisms/app-sidebar";
import { orgScopedEntities } from "../../../src/pages/admin/registry";

/**
 * SHELL-1 (ADR-0018) sidebar unit tests.
 *
 * Each test mounts `AppSidebar` as the element of a matching `Route` so
 * `useParams<{orgId?: string}>()` resolves the same way it would for a real
 * `ProtectedRoute` screen at that path — `AppSidebar` itself is rendered
 * once per route pattern under test, not wrapped around page content, since
 * only its own `orgId`-driven nav-item list is under test here.
 *
 * ADR-0042: `AppSidebar` no longer takes `visible`/`onVisibleChange` — under
 * AdminLTE the sidebar's open/collapsed state lives in classes on
 * `document.body` that `AppShell` owns, not in a prop on this component (see
 * `AppShell.test.tsx` for that half's coverage).
 */
function renderSidebar(initialEntry: string) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/orgs/pick" element={<AppSidebar />} />
        <Route path="/orgs/:orgId" element={<AppSidebar />} />
        <Route path="/orgs/:orgId/projects" element={<AppSidebar />} />
        <Route path="/orgs/:orgId/members" element={<AppSidebar />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("AppSidebar", () => {
  it("renders all three nav items when orgId is present", () => {
    renderSidebar("/orgs/org-1");

    expect(screen.getByTestId("sidebar-nav-org-home")).toBeInTheDocument();
    expect(screen.getByTestId("sidebar-nav-projects")).toBeInTheDocument();
    expect(screen.getByTestId("sidebar-nav-org-members")).toBeInTheDocument();
  });

  // PROJ-4 (ADR-0047, icon added 2026-09-09 per CTO direct instruction): the
  // new "Projects" item sits between "Dashboard" and "Members" (this file's
  // own extension-point docstring), with the same `fa-solid fa-folder` icon
  // `ProjectCountWidget` (`OrgHome.tsx`) already uses for this entity.
  it("labels the projects item 'Projects' with a folder icon, linking to /orgs/:orgId/projects", () => {
    renderSidebar("/orgs/org-1");

    const projectsLink = screen.getByTestId("sidebar-nav-projects");
    expect(projectsLink).toHaveTextContent("Projects");
    const icon = projectsLink.querySelector("i.nav-icon");
    expect(icon).not.toBeNull();
    expect(icon).toHaveClass("fa-solid", "fa-folder");
    expect(icon).toHaveAttribute("aria-hidden", "true");
    expect(projectsLink).toHaveAttribute("href", "/orgs/org-1/projects");
  });

  // DASH-2: label text is "Dashboard" (testid/route unchanged), with an icon.
  // **No longer the only flat item with one** — SHELL-7 added one to
  // `Members`, PROJ-4 added one to `Projects` (see TC-SHELL-026's own test
  // below, extended for both).
  //
  // ADR-0042: the icon was `cilSpeedometer` rendered by `CIcon` as an
  // `<svg>`; it is now Font Awesome's `fa-gauge-high`, which renders as an
  // `<i>` glyph. The assertion moved from "has an <svg> child" to "has an
  // element carrying AdminLTE's `nav-icon` class and the mapped FA class" —
  // an icon-library change, not a behavior change, and the stricter of the
  // two (the old check couldn't tell WHICH icon rendered).
  it("labels the org-home item 'Dashboard' with an icon", () => {
    renderSidebar("/orgs/org-1");

    const orgHomeLink = screen.getByTestId("sidebar-nav-org-home");
    expect(orgHomeLink).toHaveTextContent("Dashboard");
    const icon = orgHomeLink.querySelector("i.nav-icon");
    expect(icon).not.toBeNull();
    expect(icon).toHaveClass("fa-solid", "fa-gauge-high");
    expect(icon).toHaveAttribute("aria-hidden", "true");
  });

  // ADR-0042 §4.4's own "hard-won details": `.sidebar-menu` (NOT v3's
  // `nav-sidebar`, which has zero occurrences in v4.9.1's CSS) sets only
  // `white-space: nowrap`, so it needs Bootstrap's `nav flex-column` or the
  // list renders bulleted and horizontal; and nav labels must be wrapped in
  // `<p>`, which is what `.sidebar-menu .nav-link p` styles and what the
  // mini-collapse animation shrinks to `width: 0`.
  it("renders the AdminLTE sidebar-menu contract (nav flex-column, <p>-wrapped labels)", () => {
    const { container } = renderSidebar("/orgs/org-1");

    const menu = container.querySelector("ul.sidebar-menu");
    expect(menu).not.toBeNull();
    expect(menu).toHaveClass("nav", "flex-column");
    expect(menu).toHaveAttribute("data-lte-toggle", "treeview");
    expect(container.querySelector(".nav-sidebar")).toBeNull();

    expect(screen.getByTestId("sidebar-nav-org-members").querySelector("p")).toHaveTextContent(
      "Members",
    );
  });

  // Treeview contract (`admin-lte/src/ts/treeview.ts`): open state is
  // `menu-open` on the `li.nav-item`, the submenu is `ul.nav.nav-treeview`,
  // and `aria-expanded` sits on the group's own `.nav-link` toggle.
  it("toggles a nav group with AdminLTE's menu-open/nav-treeview classes", async () => {
    const { container } = renderSidebar("/orgs/org-1");

    const group = screen.getByTestId("sidebar-nav-group-ui-elements");
    expect(group).toHaveClass("nav-item");
    expect(group).not.toHaveClass("menu-open");

    const submenu = group.querySelector("ul");
    expect(submenu).toHaveClass("nav", "nav-treeview");

    const toggle = group.querySelector("a.nav-link")!;
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(toggle);
    expect(group).toHaveClass("menu-open");
    expect(toggle).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(toggle);
    expect(group).not.toHaveClass("menu-open");
    // CoreUI's own group classes must be gone entirely.
    expect(container.querySelector(".nav-group, .nav-group-items, .nav-group-toggle")).toBeNull();
  });

  it("marks the org-home item active on /orgs/:orgId but not on /orgs/:orgId/members (prefix-match regression check)", () => {
    const onOrgHome = renderSidebar("/orgs/org-1");
    expect(onOrgHome.getByTestId("sidebar-nav-org-home").className).toMatch(/\bactive\b/);
    onOrgHome.unmount();

    const onMembers = renderSidebar("/orgs/org-1/members");
    expect(onMembers.getByTestId("sidebar-nav-org-home").className).not.toMatch(/\bactive\b/);
  });

  it("marks the members item active on /orgs/:orgId/members", () => {
    renderSidebar("/orgs/org-1/members");
    expect(screen.getByTestId("sidebar-nav-org-members").className).toMatch(/\bactive\b/);
  });

  it("marks the projects item active on /orgs/:orgId/projects, and the dashboard item not active there", () => {
    renderSidebar("/orgs/org-1/projects");
    expect(screen.getByTestId("sidebar-nav-projects").className).toMatch(/\bactive\b/);
    expect(screen.getByTestId("sidebar-nav-org-home").className).not.toMatch(/\bactive\b/);
  });

  it("renders an empty nav-item list (brand only, no org-home/org-members links) when orgId is absent", () => {
    renderSidebar("/orgs/pick");

    expect(screen.getByText("TestNexa")).toBeInTheDocument();
    expect(screen.queryByTestId("sidebar-nav-org-home")).not.toBeInTheDocument();
    expect(screen.queryByTestId("sidebar-nav-projects")).not.toBeInTheDocument();
    expect(screen.queryByTestId("sidebar-nav-org-members")).not.toBeInTheDocument();
  });

  // FR-SHELL-5 (ADR-0026) / TC-SHELL-015 originally asserted CoreUI's
  // `sidebar-dark` skin class on the sidebar root, independent of
  // FR-SHELL-4's app-wide light/dark/auto toggle.
  //
  // ADR-0042: **there is no `sidebar-dark` in AdminLTE v4** — the entire
  // `sidebar-dark-*`/`sidebar-light-*` skin family was removed (zero
  // occurrences in the shipped CSS; v4 themes a sidebar with `--lte-sidebar-*`
  // custom properties or a nested `data-bs-theme`). The class is dropped
  // rather than substituted with an invented one, so this test now asserts
  // AdminLTE's own demo default (`bg-body-secondary`) on the `.app-sidebar`
  // root, plus the *absence* of the retired class. This is a deliberate
  // visual change, recorded in this story's ADR, not a regression.
  it("renders the sidebar root as .app-sidebar with AdminLTE's bg-body-secondary (FR-SHELL-5)", () => {
    const { container } = renderSidebar("/orgs/org-1");

    const sidebar = container.querySelector("aside.app-sidebar");
    expect(sidebar).not.toBeNull();
    expect(sidebar).toHaveClass("bg-body-secondary");
    expect(sidebar).not.toHaveClass("sidebar-dark");
    // `vh-100` existed only to cap the sidebar against `AppShell`'s old
    // `d-flex` row; the `.app-wrapper` grid makes it unnecessary and wrong.
    expect(sidebar).not.toHaveClass("vh-100");
  });

  // ------------------------------------------------------------------
  // SHELL-7 (ADR-0046): org-scoped CRUD nav restructure.
  //
  // Scope note: TC-SHELL-022/023's *width* claims are deliberately NOT
  // asserted here — jsdom does no layout (see `AppShell.tsx`'s docstring and
  // root CLAUDE.md's CSS-layout rule), so a width assertion at this layer
  // would be measuring nothing. Those live in `e2e/tests/shell7-sidebar-
  // mini.spec.ts` against a real browser. What IS real jsdom ground here is
  // the markup: which groups exist, what they contain, which carry icons, and
  // what order they render in.
  // ------------------------------------------------------------------

  /** The 3-way partition ADR-0046 specifies, as the test's own source of truth. */
  const EXPECTED_PARTITION: Record<string, string[]> = {
    "sidebar-nav-group-access-control": [
      "roles",
      "permissions",
      "role-assignments",
      "org-memberships",
    ],
    "sidebar-nav-group-catalogs": ["test-design-techniques", "test-levels", "test-types"],
    "sidebar-nav-group-organization": ["organizations"],
  };

  // TC-SHELL-025: asserted as a complete, non-overlapping partition — every
  // registry entry present exactly once across the 3 groups, nothing
  // duplicated, nothing missing — not spot-checked on 2-3 entities. Derived
  // from `orgScopedEntities` itself, so adding a 9th entity to the registry
  // without assigning it a group fails this test rather than silently
  // dropping it out of the sidebar.
  it("TC-SHELL-025: renders all 8 org-scoped entities as a complete, non-overlapping 3-group partition", () => {
    renderSidebar("/orgs/org-1");

    const seen: string[] = [];
    for (const [groupTestId, entityKeys] of Object.entries(EXPECTED_PARTITION)) {
      const group = screen.getByTestId(groupTestId);
      // Children of THIS group, in DOM order, as their registry keys.
      const renderedKeys = [...group.querySelectorAll("ul.nav-treeview [data-testid]")].map((el) =>
        el.getAttribute("data-testid")!.replace("sidebar-nav-admin-", ""),
      );
      expect(renderedKeys).toEqual(entityKeys);
      seen.push(...renderedKeys);
    }

    // Completeness + non-overlap, against the registry rather than a literal.
    const registryKeys = orgScopedEntities.map((e) => e.key);
    expect(registryKeys).toHaveLength(8);
    expect([...seen].sort()).toEqual([...registryKeys].sort());
    expect(new Set(seen).size).toBe(seen.length);

    // Labels still come from the registry, not hardcoded in the sidebar.
    for (const entityEntry of orgScopedEntities) {
      expect(screen.getByTestId(`sidebar-nav-admin-${entityEntry.key}`)).toHaveTextContent(
        entityEntry.label,
      );
    }

    // Negative assertion: the retired flat group must be GONE, not merely
    // accompanied by the new ones — a regression leaving both rendered would
    // pass every positive check above.
    expect(screen.queryByTestId("sidebar-nav-group-admin")).not.toBeInTheDocument();
    expect(screen.queryByText("Admin")).not.toBeInTheDocument();
  });

  // TC-SHELL-026: icon-exclusivity. Only the 3 groups and the flat items
  // `Members`/`Projects` get an icon; the 8 entity children get none
  // (matching TC-SHELL-021's pre-existing convention rather than silently
  // reinterpreting it — `Dashboard` already has its own icon, asserted in
  // its own test above, not repeated here). `nav-arrow` is the group's
  // disclosure caret, not a nav icon — counted separately so an assertion of
  // "exactly one icon" can't be satisfied by the arrow.
  it("TC-SHELL-026: the 3 groups + Members + Projects render a nav icon, never the 8 entity children", () => {
    renderSidebar("/orgs/org-1");

    const groupIcons: Record<string, string> = {
      "sidebar-nav-group-access-control": "fa-user-shield",
      "sidebar-nav-group-catalogs": "fa-layer-group",
      "sidebar-nav-group-organization": "fa-building",
    };
    for (const [groupTestId, iconClass] of Object.entries(groupIcons)) {
      const toggle = screen.getByTestId(groupTestId).querySelector(":scope > a.nav-link")!;
      const icons = toggle.querySelectorAll("i.nav-icon");
      expect(icons).toHaveLength(1);
      expect(icons[0]).toHaveClass("fa-solid", iconClass);
      expect(icons[0]).toHaveAttribute("aria-hidden", "true");
      expect(toggle.querySelectorAll("i.nav-arrow")).toHaveLength(1);
    }

    // Members (SHELL-7) and Projects (PROJ-4): flat items with their own icon
    // (an icon-less row is an empty slot in the collapsed mini rail).
    const members = screen.getByTestId("sidebar-nav-org-members");
    const memberIcons = members.querySelectorAll("i.nav-icon");
    expect(memberIcons).toHaveLength(1);
    expect(memberIcons[0]).toHaveClass("fa-solid", "fa-users");

    const projects = screen.getByTestId("sidebar-nav-projects");
    const projectIcons = projects.querySelectorAll("i.nav-icon");
    expect(projectIcons).toHaveLength(1);
    expect(projectIcons[0]).toHaveClass("fa-solid", "fa-folder");

    // The 8 children carry no icon of any kind.
    for (const entityEntry of orgScopedEntities) {
      const child = screen.getByTestId(`sidebar-nav-admin-${entityEntry.key}`);
      expect(child.querySelectorAll("i")).toHaveLength(0);
    }

    // `UI Elements` is explicitly out of SHELL-7's scope and keeps no icon.
    const uiToggle = screen
      .getByTestId("sidebar-nav-group-ui-elements")
      .querySelector(":scope > a.nav-link")!;
    expect(uiToggle.querySelectorAll("i.nav-icon")).toHaveLength(0);
  });

  // TC-SHELL-027: asserted as an ORDERED sequence read from the DOM, not six
  // independent presence checks (which would pass on a scrambled order).
  //
  // PROJ-4 (ADR-0047, 2026-09-09): a new "Projects" flat item inserts between
  // "Dashboard" and "Members" — TC-SHELL-027's own row in the Test Cases doc
  // was corrected in place for this same cross-story interaction (found
  // while writing that docs pass, not by SHELL-7's own). Order is otherwise
  // unchanged.
  it("TC-SHELL-027: renders the org-scoped nav in the specified top-to-bottom order", () => {
    const { container } = renderSidebar("/orgs/org-1");

    const topLevel = [...container.querySelectorAll("ul.sidebar-menu > li.nav-item")];
    const labels = topLevel.map((li) =>
      within(li as HTMLElement)
        .getAllByText(/.+/)[0]
        .textContent?.trim(),
    );
    expect(labels).toEqual([
      "Dashboard",
      "Projects",
      "Members",
      "Access Control",
      "Catalogs",
      "Organization",
      "UI Elements",
    ]);
  });

  // The new groups use the same `openGroups` state shape as `UI Elements`
  // (ADR-0046: "no new state shape, just more group keys") — and they are
  // independent, so opening one must not open another.
  it("toggles each new group independently via the existing menu-open mechanism", () => {
    renderSidebar("/orgs/org-1");

    const access = screen.getByTestId("sidebar-nav-group-access-control");
    const catalogs = screen.getByTestId("sidebar-nav-group-catalogs");
    expect(access).not.toHaveClass("menu-open");
    expect(catalogs).not.toHaveClass("menu-open");

    fireEvent.click(access.querySelector(":scope > a.nav-link")!);
    expect(access).toHaveClass("menu-open");
    expect(catalogs).not.toHaveClass("menu-open");

    fireEvent.click(catalogs.querySelector(":scope > a.nav-link")!);
    expect(access).toHaveClass("menu-open");
    expect(catalogs).toHaveClass("menu-open");

    fireEvent.click(access.querySelector(":scope > a.nav-link")!);
    expect(access).not.toHaveClass("menu-open");
    expect(catalogs).toHaveClass("menu-open");
  });

  it("renders none of the 3 new groups when orgId is absent", () => {
    renderSidebar("/orgs/pick");

    for (const groupTestId of Object.keys(EXPECTED_PARTITION)) {
      expect(screen.queryByTestId(groupTestId)).not.toBeInTheDocument();
    }
  });
});
