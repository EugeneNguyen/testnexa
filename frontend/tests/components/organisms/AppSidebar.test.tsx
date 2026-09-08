import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import AppSidebar from "../../../src/components/organisms/app-sidebar";

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
        <Route path="/orgs/:orgId/members" element={<AppSidebar />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("AppSidebar", () => {
  it("renders both nav items when orgId is present", () => {
    renderSidebar("/orgs/org-1");

    expect(screen.getByTestId("sidebar-nav-org-home")).toBeInTheDocument();
    expect(screen.getByTestId("sidebar-nav-org-members")).toBeInTheDocument();
  });

  // DASH-2: label text is "Dashboard" (testid/route unchanged), with an icon
  // — the only sidebar nav item that gets one.
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

  it("renders an empty nav-item list (brand only, no org-home/org-members links) when orgId is absent", () => {
    renderSidebar("/orgs/pick");

    expect(screen.getByText("TestNexa")).toBeInTheDocument();
    expect(screen.queryByTestId("sidebar-nav-org-home")).not.toBeInTheDocument();
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
});
