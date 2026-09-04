import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import AppBreadcrumb from "../src/components/AppBreadcrumb";

/**
 * SHELL-2 (ADR-0020) breadcrumb unit tests, TC-SHELL-007/008.
 *
 * Same per-route-pattern render approach as `AppSidebar.test.tsx`: mount
 * `AppBreadcrumb` as a `Route`'s element so `useLocation()`/`matchPath`
 * resolve against the same path patterns a real `ProtectedRoute` screen
 * would use.
 */
function renderBreadcrumb(initialEntry: string) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/orgs/pick" element={<AppBreadcrumb />} />
        <Route path="/orgs/:orgId" element={<AppBreadcrumb />} />
        <Route path="/orgs/:orgId/members" element={<AppBreadcrumb />} />
        <Route path="/orgs/:orgId/ui-elements/colors" element={<AppBreadcrumb />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("AppBreadcrumb", () => {
  it("TC-SHELL-007: resolves known route segments on /orgs/:orgId/members", () => {
    renderBreadcrumb("/orgs/org-1/members");

    expect(screen.getByText("Org Home")).toBeInTheDocument();
    expect(screen.getByText("Members")).toBeInTheDocument();
    // The active (final) segment is plain text, not a link — only the
    // earlier "Org Home" segment is clickable.
    expect(screen.getByText("Org Home").closest("a")).toHaveAttribute("href", "/orgs/org-1");
    expect(screen.getByText("Members").closest("a")).toBeNull();
  });

  it("renders a single, non-linked segment on /orgs/:orgId", () => {
    renderBreadcrumb("/orgs/org-1");

    expect(screen.getByText("Org Home")).toBeInTheDocument();
    expect(screen.getByText("Org Home").closest("a")).toBeNull();
  });

  it("resolves a nested UI-elements route with 3 segments", () => {
    renderBreadcrumb("/orgs/org-1/ui-elements/colors");

    expect(screen.getByText("Org Home")).toBeInTheDocument();
    expect(screen.getByText("UI Elements")).toBeInTheDocument();
    expect(screen.getByText("Colors")).toBeInTheDocument();
  });

  it("TC-SHELL-008: degrades gracefully on an unmapped/root route (/orgs/pick) — renders nothing, no raw param or undefined fragment", () => {
    const { container } = renderBreadcrumb("/orgs/pick");

    expect(container.querySelector(".breadcrumb")).not.toBeInTheDocument();
    expect(screen.queryByText("undefined")).not.toBeInTheDocument();
    expect(screen.queryByText("pick")).not.toBeInTheDocument();
  });
});
